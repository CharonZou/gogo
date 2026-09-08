"""Phase 2 测试：规划校验、Supervisor 闭环、执行引擎、记忆、API 流程。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.llm.client import LLMNotConfiguredError
from backend.main import app
from backend.memory.store import MemoryStore
from backend.orchestration.planner import parse_plan
from backend.orchestration.supervisor import Supervisor
from backend.tools.executor import build_default_executor

# ---------- 计划 JSON 样例 ----------

PLAN_OK = {
    "tasks": [
        {
            "id": "t1",
            "title": "搜集资料",
            "description": "搜集背景资料",
            "depends_on": [],
            "acceptance": "资料清单",
            "tool": "noop",
        },
        {
            "id": "t2",
            "title": "生成报告",
            "description": "基于资料生成报告",
            "depends_on": ["t1"],
            "acceptance": "报告文档",
            "tool": "bash",
            "tool_args": {"command": "echo report-done"},
        },
    ]
}

PLAN_CYCLE = {
    "tasks": [
        {"id": "a", "title": "a", "depends_on": ["b"]},
        {"id": "b", "title": "b", "depends_on": ["a"]},
    ]
}

PLAN_BAD_DEP = {
    "tasks": [
        {"id": "a", "title": "a", "depends_on": []},
        {"id": "b", "title": "b", "depends_on": ["nope"]},
    ]
}


async def fake_planner(goal: str) -> dict:
    return PLAN_OK


# ---------- 规划校验 ----------

def test_parse_plan_ok() -> None:
    plan = parse_plan(PLAN_OK)
    assert len(plan) == 2
    assert plan[1].tool == "bash"
    assert plan[1].depends_on == ["t1"]


def test_parse_plan_rejects_cycle() -> None:
    with pytest.raises(ValueError, match="环"):
        parse_plan(PLAN_CYCLE)


def test_parse_plan_rejects_missing_dependency() -> None:
    with pytest.raises(ValueError, match="依赖不存在"):
        parse_plan(PLAN_BAD_DEP)


# ---------- Supervisor 闭环（真实 DB + fake 规划器） ----------

@pytest.fixture
def tmp_supervisor(tmp_path) -> Supervisor:
    db_file = tmp_path / "rocheflow.db"
    sandbox = tmp_path / "sandbox"
    return Supervisor(
        db_path=str(db_file),
        planner=fake_planner,
        tools=build_default_executor(sandbox_root=str(sandbox)),
        max_concurrency=2,
        max_retries=0,
    )


async def test_full_lifecycle(tmp_supervisor: Supervisor) -> None:
    created = await tmp_supervisor.create_task("做一个演示")
    task_id = created["task_id"]
    assert created["status"] == "PENDING"

    plan = await tmp_supervisor.plan(task_id)
    # subtask id 映射为 {task_id}-{plan_id}（全局主键防并发冲突）
    assert [t["id"] for t in plan["tasks"]] == [f"{task_id}-t1", f"{task_id}-t2"]

    st = await tmp_supervisor.status(task_id)
    assert st["status"] == "PLANNED"
    assert len(st["subtasks"]) == 2

    await tmp_supervisor.approve(task_id)
    result = await tmp_supervisor.run(task_id)
    assert result["status"] == "DONE"

    st = await tmp_supervisor.status(task_id)
    assert st["status"] == "DONE"
    statuses = {s["id"]: s["status"] for s in st["subtasks"]}
    assert statuses == {f"{task_id}-t1": "DONE", f"{task_id}-t2": "DONE"}
    # t2 的 bash 输出已写入结果
    t2 = next(s for s in st["subtasks"] if s["id"] == f"{task_id}-t2")
    assert "report-done" in t2["result"]


async def test_approve_requires_plan(tmp_supervisor: Supervisor) -> None:
    created = await tmp_supervisor.create_task("未规划就授权")
    with pytest.raises(ValueError, match="需先完成规划"):
        await tmp_supervisor.approve(created["task_id"])


async def test_failure_and_retry_exhausted(tmp_path) -> None:
    async def failing_planner(goal: str) -> dict:
        return {
            "tasks": [
                {
                    "id": "t1",
                    "title": "必然失败",
                    "depends_on": [],
                    "tool": "bash",
                    "tool_args": {"command": "exit 1"},
                }
            ]
        }

    sv = Supervisor(
        db_path=str(tmp_path / "db.sqlite"),
        planner=failing_planner,
        tools=build_default_executor(sandbox_root=str(tmp_path / "sb")),
        max_concurrency=1,
        max_retries=1,
    )
    created = await sv.create_task("失败任务")
    await sv.plan(created["task_id"])
    await sv.approve(created["task_id"])
    result = await sv.run(created["task_id"])
    assert result["status"] == "FAILED"

    st = await sv.status(created["task_id"])
    assert st["status"] == "FAILED"
    sub = st["subtasks"][0]
    assert sub["status"] == "FAILED"
    assert "失败" in sub["error"]


async def test_replan_clears_old_subtasks(tmp_supervisor: Supervisor) -> None:
    created = await tmp_supervisor.create_task("重规划")
    await tmp_supervisor.plan(created["task_id"])
    await tmp_supervisor.plan(created["task_id"])  # 二次规划
    st = await tmp_supervisor.status(created["task_id"])
    assert len(st["subtasks"]) == 2  # 没有重复累积


async def test_llm_not_configured_raises(tmp_path) -> None:
    sv = Supervisor(db_path=str(tmp_path / "db.sqlite"))  # 默认 planner，未配置 key
    created = await sv.create_task("会失败")
    with pytest.raises(LLMNotConfiguredError):
        await sv.plan(created["task_id"])


# ---------- 记忆 ----------

async def test_memory_store(tmp_path) -> None:
    store = MemoryStore(str(tmp_path / "mem.sqlite"))
    await store.save_fact("user.name", "小周")
    await store.save_fact("user.stack", "Python + FastAPI")
    assert await store.get_fact("user.name") == "小周"

    hits = await store.search("Python")
    assert any(h["key"] == "user.stack" for h in hits)


# ---------- API 流程 ----------

def test_api_plan_requires_llm_key() -> None:
    with TestClient(app) as client:
        created = client.post("/api/v1/tasks", json={"goal": "测试"})
        task_id = created.json()["task_id"]
        resp = client.post(f"/api/v1/tasks/{task_id}/plan")
        assert resp.status_code == 503  # 未配置 LLM_API_KEY


def test_api_approve_without_plan() -> None:
    with TestClient(app) as client:
        created = client.post("/api/v1/tasks", json={"goal": "测试"})
        task_id = created.json()["task_id"]
        resp = client.post(f"/api/v1/tasks/{task_id}/approve")
        assert resp.status_code == 400


def test_api_task_not_found() -> None:
    with TestClient(app) as client:
        resp = client.get("/api/v1/tasks/does-not-exist")
        assert resp.status_code == 404
