"""P1.1 任务中心扩展测试：todo/字段/更新/派发/完成。"""

from __future__ import annotations

import pytest

from backend.core import db
from backend.orchestration.supervisor import Supervisor


@pytest.fixture
def sv(tmp_path) -> Supervisor:
    return Supervisor(db_path=str(tmp_path / "t.db"))


# ---------- 创建 ----------

async def test_create_todo_without_goal(sv: Supervisor) -> None:
    created = await sv.create_task(kind="todo", title="买牛奶", due_at="2026-09-09")
    assert created["status"] == "PENDING"
    st = await sv.status(created["task_id"])
    assert st["kind"] == "todo"
    assert st["title"] == "买牛奶"
    assert st["due_at"] == "2026-09-09"
    assert st["priority"] == "medium"


async def test_create_task_requires_goal(sv: Supervisor) -> None:
    with pytest.raises(ValueError, match="goal"):
        await sv.create_task(kind="task")


async def test_create_todo_requires_title(sv: Supervisor) -> None:
    with pytest.raises(ValueError, match="title"):
        await sv.create_task(kind="todo")


async def test_create_rejects_bad_kind_and_priority(sv: Supervisor) -> None:
    with pytest.raises(ValueError, match="类型"):
        await sv.create_task(kind="bogus", goal="x")
    with pytest.raises(ValueError, match="优先级"):
        await sv.create_task(goal="x", priority="urgent")


# ---------- 更新 / 派发 / 完成 ----------

async def test_update_task_fields(sv: Supervisor) -> None:
    created = await sv.create_task("做演示", priority="low")
    updated = await sv.update_task(created["task_id"], priority="high", due_at="2026-09-09")
    assert updated["priority"] == "high"
    assert updated["due_at"] == "2026-09-09"


async def test_update_missing_task(sv: Supervisor) -> None:
    with pytest.raises(KeyError):
        await sv.update_task("nope", priority="high")


async def test_assign_to_agent(sv: Supervisor) -> None:
    from backend.agents.manager import AgentManager

    agent = await AgentManager(db_path=sv.db_path).hire("小周", role="周报专员")
    created = await sv.create_task("写周报", kind="todo", title="写周报")
    assigned = await sv.assign_task(created["task_id"], agent["id"])
    assert assigned["assignee_id"] == agent["id"]


async def test_assign_missing_agent(sv: Supervisor) -> None:
    created = await sv.create_task("写周报", kind="todo", title="写周报")
    with pytest.raises(KeyError, match="员工"):
        await sv.assign_task(created["task_id"], "no-such-agent")


async def test_complete_sets_done(sv: Supervisor) -> None:
    created = await sv.create_task("买牛奶", kind="todo", title="买牛奶")
    done = await sv.complete_task(created["task_id"])
    assert done["status"] == "DONE"
    assert done["done_at"]


async def test_complete_running_rejected(sv: Supervisor) -> None:
    created = await sv.create_task("执行中任务")
    await db.update_task_status(sv.db_path, created["task_id"], "RUNNING")
    with pytest.raises(ValueError, match="执行中"):
        await sv.complete_task(created["task_id"])
