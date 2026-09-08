"""LangGraph 编排内核测试：执行图、checkpointer 持久化、断点续跑。"""

from __future__ import annotations

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from backend.orchestration.supervisor import Supervisor
from backend.tools.executor import ToolExecutor, ToolSpec

PLAN_RESUME = {
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


async def fake_planner(goal: str) -> dict:
    return PLAN_RESUME


def counting_executor(calls: list[str]) -> ToolExecutor:
    async def noop_a() -> dict:
        calls.append("noop_a")
        return {"result": "a"}

    async def noop_b() -> dict:
        calls.append("noop_b")
        return {"result": "b"}

    ex = ToolExecutor()
    ex.register(ToolSpec("noop_a", "计数工具 a", noop_a))
    ex.register(ToolSpec("noop_b", "计数工具 b", noop_b))
    return ex


async def test_langgraph_lifecycle_executes_all(tmp_path) -> None:
    """普通闭环：LangGraph 执行图跑完全部子任务。"""
    calls: list[str] = []
    sv = Supervisor(
        db_path=str(tmp_path / "db.sqlite"),
        planner=fake_planner,
        tools=counting_executor(calls),
        max_concurrency=2,
        max_retries=0,
        checkpoint_path=str(tmp_path / "ck.db"),
    )
    created = await sv.create_task("演示任务")
    task_id = created["task_id"]
    await sv.plan(task_id)
    await sv.approve(task_id)
    result = await sv.run(task_id)

    assert result["status"] == "DONE"
    assert calls == ["noop_a", "noop_b"]
    st = await sv.status(task_id)
    assert st["status"] == "DONE"
    assert {s["status"] for s in st["subtasks"]} == {"DONE"}


async def test_checkpoint_persisted(tmp_path) -> None:
    """执行后 checkpoint 落盘（thread_id = task_id 可查到）。"""
    sv = Supervisor(
        db_path=str(tmp_path / "db.sqlite"),
        planner=fake_planner,
        tools=counting_executor([]),
        max_concurrency=2,
        max_retries=0,
        checkpoint_path=str(tmp_path / "ck.db"),
    )
    created = await sv.create_task("持久化任务")
    task_id = created["task_id"]
    await sv.plan(task_id)
    await sv.approve(task_id)
    await sv.run(task_id)

    async with AsyncSqliteSaver.from_conn_string(str(tmp_path / "ck.db")) as saver:
        await saver.setup()
        tup = await saver.aget_tuple({"configurable": {"thread_id": task_id}})
        assert tup is not None
        assert tup.checkpoint is not None


async def test_resume_skips_done_subtask(tmp_path) -> None:
    """断点续跑：已完成的子任务不重跑，且解锁下游。"""
    calls: list[str] = []
    sv = Supervisor(
        db_path=str(tmp_path / "db.sqlite"),
        planner=fake_planner,
        tools=counting_executor(calls),
        max_concurrency=2,
        max_retries=0,
        checkpoint_path=str(tmp_path / "ck.db"),
    )
    created = await sv.create_task("断点续跑")
    task_id = created["task_id"]
    await sv.plan(task_id)

    # 模拟中断前 t1 已完成落库（DB 状态 DONE），t2 尚未执行
    from backend.core import db

    await db.update_subtask(
        str(tmp_path / "db.sqlite"), f"{task_id}-t1", status="DONE"
    )

    await sv.approve(task_id)
    result = await sv.run(task_id)

    assert result["status"] == "DONE"
    assert calls == ["noop_b"]  # t1 未重跑
    st = await sv.status(task_id)
    statuses = {s["id"]: s["status"] for s in st["subtasks"]}
    assert statuses == {f"{task_id}-t1": "DONE", f"{task_id}-t2": "DONE"}
