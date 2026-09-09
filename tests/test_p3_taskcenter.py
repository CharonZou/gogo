"""P3.2 测试：任务中心管理 API / interrupt 审批门 / WebSocket 流式事件。

- 管理：列表过滤、删除级联、取消（终态互斥）、再跑一次（复用计划）
- 审批门：tool_args.approval=true 挂起 INTERRUPTED → resume approve/拒绝
- 流式：stream_callback 收节点事件；WS 路由经 hub 广播实时进度
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from backend.agents.manager import AgentManager
from backend.core import db
from backend.orchestration.supervisor import Supervisor
from backend.tools.executor import ToolExecutor, ToolSpec

PLAN_SIMPLE = {
    "tasks": [
        {"id": "t1", "title": "第一步", "depends_on": [], "tool": "noop_a", "tool_args": {}},
        {
            "id": "t2",
            "title": "第二步",
            "depends_on": ["t1"],
            "tool": "noop_b",
            "tool_args": {},
        },
    ]
}

PLAN_APPROVAL = {
    "tasks": [
        {
            "id": "a1",
            "title": "需审批子任务",
            "depends_on": [],
            "tool": "noop_a",
            "tool_args": {"approval": True},
        },
        {
            "id": "a2",
            "title": "第二步",
            "depends_on": ["a1"],
            "tool": "noop_b",
            "tool_args": {},
        },
    ]
}


async def fake_planner(goal: str) -> dict:
    return PLAN_SIMPLE


async def fake_planner_approval(goal: str) -> dict:
    return PLAN_APPROVAL


def counting_executor(calls: list[str]) -> ToolExecutor:
    async def noop_a() -> dict:
        calls.append("noop_a")
        return {"result": "a"}

    async def noop_b() -> dict:
        calls.append("noop_b")
        return {"result": "b"}

    ex = ToolExecutor()
    ex.register(ToolSpec("noop_a", "a", noop_a))
    ex.register(ToolSpec("noop_b", "b", noop_b))
    return ex


@pytest.fixture
def sv(tmp_path) -> Supervisor:
    return Supervisor(db_path=str(tmp_path / "t.db"))


def make_sv(tmp_path, calls: list[str] | None = None, planner=None) -> Supervisor:
    return Supervisor(
        db_path=str(tmp_path / "db.sqlite"),
        planner=planner or fake_planner,
        tools=counting_executor(calls if calls is not None else []),
        max_concurrency=2,
        max_retries=0,
        checkpoint_path=str(tmp_path / "ck.db"),
    )


# ---------- 任务中心管理 ----------


async def test_list_filters_kind_status_source(sv: Supervisor) -> None:
    t1 = await sv.create_task("普通任务")
    t2 = await sv.create_task("待办", kind="todo", title="买牛奶")
    t3 = await sv.create_task("值班任务", source="duty")
    await db.update_task_status(sv.db_path, t3["task_id"], "RUNNING")

    kinds = {t["kind"] for t in await sv.list(kind="todo")}
    assert kinds == {"todo"}
    running = {t["id"] for t in await sv.list(status="RUNNING")}
    assert running == {t3["task_id"]}
    duty = {t["id"] for t in await sv.list(source="duty")}
    assert duty == {t3["task_id"]}
    all_ids = {t["id"] for t in await sv.list()}
    assert all_ids == {t1["task_id"], t2["task_id"], t3["task_id"]}


async def test_list_filter_assignee(sv: Supervisor) -> None:
    agent = await AgentManager(db_path=sv.db_path).hire("小周", role="周报专员")
    await sv.create_task("自己的")
    mine = await sv.create_task("派给小周")
    await sv.assign_task(mine["task_id"], agent["id"])

    rows = await sv.list(assignee_id=agent["id"])
    assert [r["id"] for r in rows] == [mine["task_id"]]


async def test_delete_task_cascades(tmp_path) -> None:
    sv = make_sv(tmp_path)
    created = await sv.create_task("要删除的任务")
    task_id = created["task_id"]
    await sv.plan(task_id)
    assert await db.list_subtasks(sv.db_path, task_id)

    result = await sv.delete_task(task_id)
    assert result == {"deleted": task_id}
    assert await db.get_task(sv.db_path, task_id) is None
    assert await db.list_subtasks(sv.db_path, task_id) == []


async def test_delete_missing_task(sv: Supervisor) -> None:
    with pytest.raises(KeyError, match="不存在"):
        await sv.delete_task("nope")


async def test_cancel_pending_sets_cancelled(sv: Supervisor) -> None:
    created = await sv.create_task("待取消")
    task = await sv.cancel_task(created["task_id"])
    assert task["status"] == "CANCELLED"


async def test_cancel_terminal_rejected(sv: Supervisor) -> None:
    created = await sv.create_task("已终态")
    await db.update_task_status(sv.db_path, created["task_id"], "DONE")
    with pytest.raises(ValueError, match="终态"):
        await sv.cancel_task(created["task_id"])


async def test_cancel_running_marks_flag(tmp_path) -> None:
    sv = make_sv(tmp_path)
    created = await sv.create_task("执行中取消")
    task_id = created["task_id"]
    await sv.plan(task_id)
    await db.update_task_status(sv.db_path, task_id, "RUNNING")
    task = await sv.cancel_task(task_id)
    # 执行中只打取消标记，终态由执行引擎下一轮落 CANCELLED
    assert task["cancelled"] == 1
    assert task["status"] == "RUNNING"


async def test_rerun_reuses_plan(tmp_path) -> None:
    calls: list[str] = []
    sv = make_sv(tmp_path, calls)
    created = await sv.create_task("再跑一次")
    task_id = created["task_id"]
    await sv.plan(task_id)
    await sv.approve(task_id)
    assert (await sv.run(task_id))["status"] == "DONE"
    assert calls == ["noop_a", "noop_b"]

    result = await sv.rerun_task(task_id)
    assert result["status"] == "APPROVED"
    # 后台重跑，轮询等终态
    for _ in range(100):
        await asyncio.sleep(0.05)
        st = await sv.status(task_id)
        if st["status"] in ("DONE", "FAILED"):
            break
    assert st["status"] == "DONE"
    assert calls == ["noop_a", "noop_b", "noop_a", "noop_b"]
    assert {s["status"] for s in st["subtasks"]} == {"DONE"}


async def test_rerun_non_terminal_rejected(sv: Supervisor) -> None:
    created = await sv.create_task("执行中")
    with pytest.raises(ValueError, match="终态"):
        await sv.rerun_task(created["task_id"])


# ---------- interrupt 审批门（human-in-the-loop） ----------


async def test_approval_gate_interrupts(tmp_path) -> None:
    sv = make_sv(tmp_path, planner=fake_planner_approval)
    created = await sv.create_task("带审批门")
    task_id = created["task_id"]
    await sv.plan(task_id)
    await sv.approve(task_id)
    result = await sv.run(task_id)

    assert result["status"] == "INTERRUPTED"
    st = await sv.status(task_id)
    assert st["status"] == "INTERRUPTED"
    waiting = [s for s in st["subtasks"] if s["id"].endswith("-a1")]
    assert waiting and waiting[0]["status"] == "WAITING_APPROVAL"


async def test_resume_approve_true_executes(tmp_path) -> None:
    calls: list[str] = []
    sv = make_sv(tmp_path, calls, planner=fake_planner_approval)
    created = await sv.create_task("放行")
    task_id = created["task_id"]
    await sv.plan(task_id)
    await sv.approve(task_id)
    assert (await sv.run(task_id))["status"] == "INTERRUPTED"

    result = await sv.resume(task_id, {"approve": True})
    assert result["status"] == "DONE"
    assert calls == ["noop_a", "noop_b"]
    st = await sv.status(task_id)
    assert {s["status"] for s in st["subtasks"]} == {"DONE"}


async def test_resume_approve_false_rejects(tmp_path) -> None:
    calls: list[str] = []
    sv = make_sv(tmp_path, calls, planner=fake_planner_approval)
    created = await sv.create_task("拒绝")
    task_id = created["task_id"]
    await sv.plan(task_id)
    await sv.approve(task_id)
    assert (await sv.run(task_id))["status"] == "INTERRUPTED"

    result = await sv.resume(task_id, {"approve": False})
    assert result["status"] == "FAILED"
    assert calls == []  # 审批子任务被拒绝，下游不执行
    st = await sv.status(task_id)
    rejected = [s for s in st["subtasks"] if s["id"].endswith("-a1")]
    assert rejected and rejected[0]["status"] == "FAILED"
    assert "[rejected]" in (rejected[0]["error"] or "")


async def test_resume_non_interrupted_rejected(tmp_path) -> None:
    sv = make_sv(tmp_path, planner=fake_planner_approval)
    created = await sv.create_task("未挂起")
    task_id = created["task_id"]
    await sv.plan(task_id)
    with pytest.raises(ValueError, match="挂起"):
        await sv.resume(task_id, {"approve": True})


# ---------- 流式事件 ----------


async def test_stream_callback_receives_events(tmp_path) -> None:
    events: list[dict] = []

    async def collect(event: dict) -> None:
        events.append(event)

    sv = make_sv(tmp_path)
    created = await sv.create_task("流式")
    task_id = created["task_id"]
    await sv.plan(task_id)
    await sv.approve(task_id)
    await sv.run(task_id, stream_callback=collect)

    assert events, "应收到至少一条节点事件"
    assert events[0]["task_id"] == task_id
    final = events[-1]
    assert final["final_status"] == "DONE"
    assert final["node"] in ("execute", "verify")


async def test_ws_route_broadcasts_hub_events(tmp_path) -> None:
    """WS 路由接线：hub 广播 → /ws/tasks/{id} 实时推送。"""
    from backend import main
    from backend.core.events import hub

    task_id = "ws-demo-task"
    with TestClient(main.app) as client, client.websocket_connect(
        f"/ws/tasks/{task_id}"
    ) as ws:
        client.portal.call(
            hub.publish,
            task_id,
            {"task_id": task_id, "node": "execute", "done": [], "failed": [], "final_status": "RUNNING"},
        )
        data = ws.receive_json()
        assert data["task_id"] == task_id
        assert data["final_status"] == "RUNNING"

        client.portal.call(
            hub.publish,
            task_id,
            {"task_id": task_id, "node": "verify", "done": ["x"], "failed": [], "final_status": "DONE"},
        )
        data = ws.receive_json()
        assert data["final_status"] == "DONE"
        assert data["done"] == ["x"]
