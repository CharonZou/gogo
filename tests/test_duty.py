"""P3.1 值班闭环测试：auto_work CRUD / duty_shift（自动上班+接单+汇报）/ 调度命中。"""

from __future__ import annotations

import asyncio

import pytest

from backend.agents.duty import DutyScheduler
from backend.agents.manager import AgentManager
from backend.automations.cron import validate_cron
from backend.core import db


class FakeSupervisor:
    """测试用：plan→PLANNED，approve→APPROVED，run→DONE（不碰 LLM）。"""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path

    async def plan(self, task_id: str) -> dict:
        await db.update_task_status(self.db_path, task_id, "PLANNED")
        return {"tasks": []}

    async def approve(self, task_id: str) -> dict:
        await db.update_task_status(self.db_path, task_id, "APPROVED")
        return {"task_id": task_id, "status": "APPROVED"}

    async def run(self, task_id: str) -> dict:
        await db.update_task_status(self.db_path, task_id, "DONE")
        return {"task_id": task_id, "status": "DONE"}


@pytest.fixture
def agent_manager(tmp_path) -> AgentManager:
    path = str(tmp_path / "duty.db")
    return AgentManager(db_path=path, supervisor=FakeSupervisor(path))


async def _mk_task(agent_manager: AgentManager, goal: str) -> dict:
    await agent_manager._ensure_db()
    from backend.orchestration.supervisor import _initialized_paths

    _initialized_paths.add(agent_manager.db_path)
    tid = "t-" + goal[:6]
    await db.insert_task(agent_manager.db_path, tid, goal, "rpc")
    return {"task_id": tid}


def test_hire_and_update_auto_work(agent_manager) -> None:
    async def body():
        agent = await agent_manager.hire(
            "值班员", schedule_json={"cron": "0 9 * * 1-5"}, auto_work=True
        )
        assert agent["auto_work"] is True
        assert agent["status"] == "off_duty"

        updated = await agent_manager.update(agent["id"], auto_work=False)
        assert updated["auto_work"] is False
        updated2 = await agent_manager.update(agent["id"], auto_work=True)
        assert updated2["auto_work"] is True

    asyncio.run(body())


def test_duty_shift_picks_tasks_and_writes_report(agent_manager) -> None:
    async def body():
        agent = await agent_manager.hire("值班员", schedule_json={"cron": "* * * * *"})
        t1 = await _mk_task(agent_manager, "待办任务一")
        t2 = await _mk_task(agent_manager, "待办任务二")
        await db.assign_task(agent_manager.db_path, t1["task_id"], agent["id"])
        await db.assign_task(agent_manager.db_path, t2["task_id"], agent["id"])

        result = await agent_manager.duty_shift(agent["id"])
        assert result["status"] == "on_duty"
        assert result["picked"] == 2

        # 值班后员工在岗，任务已授权执行
        agent_after = await agent_manager.get(agent["id"])
        assert agent_after["status"] == "on_duty"
        for tid in (t1["task_id"], t2["task_id"]):
            task = await db.get_task(agent_manager.db_path, tid)
            assert task["status"] in ("APPROVED", "DONE")

        # 工作汇报（kind=report）进任务中心，指派给员工且已完成
        await asyncio.sleep(0.2)  # 等后台 run 落 DONE
        tasks = await db.list_tasks(agent_manager.db_path, limit=50)
        reports = [
            t for t in tasks if t["kind"] == "report" and t["assignee_id"] == agent["id"]
        ]
        assert len(reports) == 1
        assert "值班轮次" in reports[0]["goal"]
        assert "待办任务一" in reports[0]["goal"]
        assert reports[0]["status"] == "DONE"

    asyncio.run(body())


def test_duty_shift_no_pending_still_reports(agent_manager) -> None:
    async def body():
        agent = await agent_manager.hire("闲岗")
        result = await agent_manager.duty_shift(agent["id"])
        assert result["picked"] == 0
        tasks = await db.list_tasks(agent_manager.db_path, limit=50)
        reports = [t for t in tasks if t["kind"] == "report"]
        assert len(reports) == 1
        assert "无待处理任务" in reports[0]["goal"]

    asyncio.run(body())


def test_duty_scheduler_check_due(agent_manager) -> None:
    from datetime import UTC, datetime

    sched = DutyScheduler(agent_manager, now_fn=lambda: datetime(2026, 9, 9, 9, 0, tzinfo=UTC))

    base = {
        "id": "a1",
        "auto_work": True,
        "schedule_json": {"cron": "0 9 * * *"},
    }
    assert sched.check_due(base, datetime(2026, 9, 9, 9, 0, tzinfo=UTC))
    assert not sched.check_due(base, datetime(2026, 9, 9, 10, 0, tzinfo=UTC))

    off = dict(base, auto_work=False)
    assert not sched.check_due(off, datetime(2026, 9, 9, 9, 0, tzinfo=UTC))

    no_cron = dict(base, schedule_json={})
    assert not sched.check_due(no_cron, datetime(2026, 9, 9, 9, 0, tzinfo=UTC))

    # 分钟级去重：_tick 已触发过本分钟则跳过（模拟首次 tick 写入后）
    fresh = dict(base, id="a9")
    assert sched.check_due(fresh, datetime(2026, 9, 9, 9, 0, tzinfo=UTC))
    sched._fired_minutes["a9"] = "2026-09-09 09:00"
    assert not sched.check_due(fresh, datetime(2026, 9, 9, 9, 0, tzinfo=UTC))


def test_duty_schedule_cron_validated():
    # 值班 cron 复用 5 字段 cron 校验（非法应报错）
    validate_cron("0 9 * * 1-5")
    with pytest.raises(ValueError):
        validate_cron("0 9 * *")
