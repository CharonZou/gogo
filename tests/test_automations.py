"""P2.2 自动化调度测试：cron 匹配 / 管理 / 触发执行 / 调度循环 / API。"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from backend.automations.cron import CronError, match_cron, next_match, validate_cron
from backend.automations.manager import AutomationManager
from backend.main import app
from backend.scheduler.scheduler import AutomationScheduler

# ---------- cron 匹配 ----------

def test_cron_every_minute() -> None:
    assert match_cron("* * * * *", datetime(2026, 9, 8, 10, 30, tzinfo=UTC))


def test_cron_daily_at_nine() -> None:
    cron = "0 9 * * *"
    assert match_cron(cron, datetime(2026, 9, 8, 9, 0, tzinfo=UTC))
    assert not match_cron(cron, datetime(2026, 9, 8, 9, 1, tzinfo=UTC))
    assert not match_cron(cron, datetime(2026, 9, 8, 8, 0, tzinfo=UTC))


def test_cron_step_minutes() -> None:
    cron = "*/15 * * * *"
    for minute in (0, 15, 30, 45):
        assert match_cron(cron, datetime(2026, 9, 8, 10, minute, tzinfo=UTC))
    assert not match_cron(cron, datetime(2026, 9, 8, 10, 7, tzinfo=UTC))


def test_cron_weekday_range() -> None:
    cron = "0 9 * * 1-5"
    assert match_cron(cron, datetime(2026, 9, 8, 9, 0, tzinfo=UTC))  # 周二
    assert not match_cron(cron, datetime(2026, 9, 12, 9, 0, tzinfo=UTC))  # 周六


def test_cron_day_list() -> None:
    cron = "0 9 1,15 * *"
    assert match_cron(cron, datetime(2026, 9, 1, 9, 0, tzinfo=UTC))
    assert match_cron(cron, datetime(2026, 9, 15, 9, 0, tzinfo=UTC))
    assert not match_cron(cron, datetime(2026, 9, 8, 9, 0, tzinfo=UTC))


def test_cron_dow_zero_and_seven_both_sunday() -> None:
    sunday = datetime(2026, 9, 13, 9, 0, tzinfo=UTC)  # 周日
    assert match_cron("0 9 * * 0", sunday)
    assert match_cron("0 9 * * 7", sunday)


def test_cron_invalid_expressions() -> None:
    for bad in ("0 9 * *", "60 9 * * *", "0 25 * * *", "0 9 * * * abc", "0 9 * 13 *"):
        with pytest.raises(CronError):
            validate_cron(bad)


def test_cron_next_match() -> None:
    nxt = next_match("0 9 * * *", datetime(2026, 9, 8, 8, 0, tzinfo=UTC))
    assert nxt == datetime(2026, 9, 8, 9, 0, tzinfo=UTC)
    nxt2 = next_match("30 8 * * *", datetime(2026, 9, 8, 8, 30, tzinfo=UTC))
    assert nxt2 == datetime(2026, 9, 9, 8, 30, tzinfo=UTC)  # after 不含本身


# ---------- 管理器 ----------

@pytest.fixture
def mgr(tmp_path) -> AutomationManager:
    return AutomationManager(db_path=str(tmp_path / "auto.db"))


async def _ok_runner(auto: dict) -> dict:
    return {"ok": True, "task_id": "t-1", "output": "done"}


async def _fail_runner(auto: dict) -> dict:
    return {"ok": False, "task_id": "t-2", "error": "模拟失败"}


async def test_create_cron_automation(mgr: AutomationManager) -> None:
    auto = await mgr.create("每日晨报", "总结今天的科技新闻", "0 9 * * *")
    assert auto["name"] == "每日晨报"
    assert auto["status"] == "active"
    assert auto["trigger_type"] == "cron"
    assert auto["next_run_at"]  # 已计算下次触发
    assert auto["run_count"] == 0


async def test_create_once_without_schedule(mgr: AutomationManager) -> None:
    auto = await mgr.create("一次性提醒", "提醒我提交周报", trigger_type="once")
    assert auto["trigger_type"] == "once"
    assert auto["schedule"] == ""


async def test_create_rejects_invalid(mgr: AutomationManager) -> None:
    with pytest.raises(ValueError, match="名称"):
        await mgr.create("  ", "p")
    with pytest.raises(ValueError, match="Prompt"):
        await mgr.create("n", "  ")
    with pytest.raises(ValueError, match="cron"):
        await mgr.create("n", "p", "bad cron")
    with pytest.raises(ValueError, match="触发类型"):
        await mgr.create("n", "p", trigger_type="bogus")


async def test_crud_cycle(mgr: AutomationManager) -> None:
    auto = await mgr.create("日报", "写日报", "0 8 * * *")
    lst = await mgr.list()
    assert any(a["id"] == auto["id"] for a in lst)

    paused = await mgr.update(auto["id"], status="paused")
    assert paused["status"] == "paused"

    with pytest.raises(ValueError, match="状态"):
        await mgr.update(auto["id"], status="bogus")

    got = await mgr.get(auto["id"])
    assert got["name"] == "日报"

    with pytest.raises(KeyError):
        await mgr.get("nope")

    assert (await mgr.delete(auto["id"]))["deleted"] == auto["id"]
    with pytest.raises(KeyError):
        await mgr.delete(auto["id"])


async def test_trigger_success(tmp_path) -> None:
    mgr = AutomationManager(db_path=str(tmp_path / "a.db"), runner=_ok_runner)
    auto = await mgr.create("日报", "写日报", "0 8 * * *")
    out = await mgr.trigger(auto["id"])
    assert out["status"] == "success"
    assert out["ok"] is True
    assert out["task_id"] == "t-1"

    after = await mgr.get(auto["id"])
    assert after["run_count"] == 1
    assert after["last_run_at"]
    assert after["status"] == "active"  # cron 任务保持 active

    runs = await mgr.runs(auto["id"])
    assert len(runs) == 1
    assert runs[0]["trigger_type"] == "manual"
    assert runs[0]["status"] == "success"


async def test_trigger_failure(tmp_path) -> None:
    mgr = AutomationManager(db_path=str(tmp_path / "a.db"), runner=_fail_runner)
    auto = await mgr.create("日报", "写日报", "0 8 * * *")
    out = await mgr.trigger(auto["id"])
    assert out["status"] == "failed"
    assert out["ok"] is False
    assert out["error"] == "模拟失败"


async def test_trigger_once_pauses_after_success(tmp_path) -> None:
    mgr = AutomationManager(db_path=str(tmp_path / "a.db"), runner=_ok_runner)
    auto = await mgr.create("一次性", "提醒", trigger_type="once")
    out = await mgr.trigger(auto["id"])
    assert out["status"] == "success"
    after = await mgr.get(auto["id"])
    assert after["status"] == "paused"  # 一次性跑完自动暂停


async def test_trigger_missing(mgr: AutomationManager) -> None:
    with pytest.raises(KeyError):
        await mgr.trigger("nope")


# ---------- 调度循环 ----------

def _mgr_with_runner(tmp_path, runner):
    return AutomationManager(db_path=str(tmp_path / "s.db"), runner=runner)


async def test_scheduler_check_due_and_dedup(tmp_path) -> None:
    mgr = AutomationManager(db_path=str(tmp_path / "s.db"), runner=_ok_runner)
    cron_auto = await mgr.create("每分钟", "x", "*/1 * * * *")
    paused = await mgr.create("暂停", "x", "*/1 * * * *")
    await mgr.update(paused["id"], status="paused")
    await mgr.create("一次性", "x", trigger_type="once")

    sched = AutomationScheduler(mgr, tick_seconds=999)
    now = datetime(2026, 9, 8, 10, 0, 30, tzinfo=UTC)
    due = sched.check_due(await mgr.list(), now)
    assert [a["id"] for a in due] == [cron_auto["id"]]  # 仅 active cron

    # 同分钟去重
    sched._fired_minutes[cron_auto["id"]] = now.strftime("%Y-%m-%d %H:%M")
    due2 = sched.check_due(await mgr.list(), now)
    assert due2 == []

    # 下一分钟重新触发
    due3 = sched.check_due(await mgr.list(), datetime(2026, 9, 8, 10, 1, tzinfo=UTC))
    assert due3 and due3[0]["id"] == cron_auto["id"]


async def test_scheduler_tick_triggers(tmp_path) -> None:
    calls: list[str] = []
    async def runner(auto: dict) -> dict:
        calls.append(auto["id"])
        return {"ok": True, "task_id": "t", "output": "ok"}

    mgr = AutomationManager(db_path=str(tmp_path / "s.db"), runner=runner)
    auto = await mgr.create("每分钟", "x", "*/1 * * * *")
    sched = AutomationScheduler(mgr, tick_seconds=999)

    now = datetime(2026, 9, 8, 10, 0, tzinfo=UTC)
    sched.now_fn = lambda: now
    await sched._tick()
    assert calls == [auto["id"]]
    assert sched.active_count == 0  # 执行完释放

    # 同分钟不再触发（去重生效）
    await sched._tick()
    assert calls == [auto["id"]]
    assert (await mgr.get(auto["id"]))["run_count"] == 1


async def test_scheduler_start_stop(tmp_path) -> None:
    mgr = AutomationManager(db_path=str(tmp_path / "s.db"), runner=_ok_runner)
    sched = AutomationScheduler(mgr, tick_seconds=999)
    assert not sched.running
    sched.start()
    assert sched.running
    await sched.stop()
    assert not sched.running
    await sched.stop()  # 幂等


# ---------- API 层 ----------

def test_api_automation_full_cycle() -> None:
    with TestClient(app) as client:
        created = client.post(
            "/api/v1/automations",
            json={"name": "每日晨报", "prompt": "总结今天科技新闻", "schedule": "0 9 * * *"},
        )
        assert created.status_code == 200
        auto = created.json()
        assert auto["status"] == "active"
        assert auto["next_run_at"]

        lst = client.get("/api/v1/automations").json()
        assert any(a["id"] == auto["id"] for a in lst)

        st = client.get("/api/v1/automations/scheduler/status").json()
        assert st["running"] is True  # lifespan 已启动调度器
        assert st["enabled"] is True

        paused = client.patch(
            f"/api/v1/automations/{auto['id']}", json={"status": "paused"}
        ).json()
        assert paused["status"] == "paused"

        assert client.get("/api/v1/automations/nope").status_code == 404
        assert client.delete(f"/api/v1/automations/{auto['id']}").json()["deleted"] == auto["id"]


def test_api_automation_trigger_no_llm_keeps_task_pending() -> None:
    """测试环境无 LLM：触发 → run failed + 任务已创建 PENDING（可手动接管）。"""
    with TestClient(app) as client:
        auto = client.post(
            "/api/v1/automations",
            json={"name": "自动跑", "prompt": "分析季度数据", "schedule": "0 10 * * *"},
        ).json()
        out = client.post(f"/api/v1/automations/{auto['id']}/trigger").json()
        assert out["status"] == "failed"
        assert out["task_id"]

        task = client.get(f"/api/v1/tasks/{out['task_id']}").json()
        assert task["status"] == "PENDING"
        assert task["source"] == "automation"

        runs = client.get(f"/api/v1/automations/{auto['id']}/runs").json()
        assert len(runs) == 1
        assert runs[0]["status"] == "failed"

        after = client.get(f"/api/v1/automations/{auto['id']}").json()
        assert after["run_count"] == 1


def test_api_automation_rejects_bad_cron() -> None:
    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/automations",
            json={"name": "坏任务", "prompt": "x", "schedule": "not a cron"},
        )
        assert resp.status_code == 400
