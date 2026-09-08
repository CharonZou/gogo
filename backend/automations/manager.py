"""自动化管理器：cron/一次性任务 CRUD + 手动触发执行（P2.2）。

执行语义：触发 → 记录 run（running）→ 调 runner 执行 prompt → 落 run 结果。
默认 runner：supervisor.create_task + plan + approve + run（全自动闭环）；
LLM 未配置时任务保留 PENDING，可手动接管，run 记为 failed。
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from backend.automations.cron import next_match, validate_cron
from backend.core import db
from backend.core.config import get_settings

Runner = Callable[[dict], Awaitable[dict]]


class AutomationManager:
    def __init__(
        self,
        db_path: str | None = None,
        supervisor=None,
        runner: Runner | None = None,
    ) -> None:
        self.db_path = db_path or db.get_db_path()
        self.supervisor = supervisor
        self.runner = runner or self._default_runner
        self.settings = get_settings()
        self._initialized = False

    async def _ensure_db(self) -> None:
        if self._initialized:
            return
        await db.init_db(self.db_path)
        self._initialized = True

    # ---------- CRUD ----------

    async def create(
        self,
        name: str,
        prompt: str,
        schedule: str = "",
        *,
        trigger_type: str = "cron",
        thread_mode: str = "fresh",
        max_duration_minutes: int = 30,
    ) -> dict:
        if not name or not name.strip():
            raise ValueError("自动化名称不能为空")
        if not prompt or not prompt.strip():
            raise ValueError("自动化 Prompt 不能为空")
        if trigger_type not in ("cron", "once"):
            raise ValueError(f"非法触发类型：{trigger_type}")
        if thread_mode not in ("fresh", "sticky"):
            raise ValueError(f"非法线程模式：{thread_mode}")
        if trigger_type == "cron":
            validate_cron(schedule)
        await self._ensure_db()
        automation_id = uuid.uuid4().hex[:12]
        await db.insert_automation(
            self.db_path,
            automation_id,
            name.strip(),
            prompt.strip(),
            schedule,
            trigger_type=trigger_type,
            thread_mode=thread_mode,
            max_duration_minutes=max_duration_minutes,
            next_run_at=compute_next_run(schedule),
        )
        return await db.get_automation(self.db_path, automation_id)

    async def update(
        self,
        automation_id: str,
        *,
        name: str | None = None,
        prompt: str | None = None,
        schedule: str | None = None,
        status: str | None = None,
        thread_mode: str | None = None,
        max_duration_minutes: int | None = None,
    ) -> dict:
        await self.get(automation_id)
        if status is not None and status not in ("active", "paused", "completed"):
            raise ValueError(f"非法状态：{status}")
        if schedule is not None and (schedule := schedule.strip()):
            validate_cron(schedule)
        await db.update_automation(
            self.db_path,
            automation_id,
            name=name.strip() if name else None,
            prompt=prompt,
            schedule=schedule,
            status=status,
            thread_mode=thread_mode,
            max_duration_minutes=max_duration_minutes,
        )
        return await db.get_automation(self.db_path, automation_id)

    async def get(self, automation_id: str) -> dict:
        await self._ensure_db()
        auto = await db.get_automation(self.db_path, automation_id)
        if auto is None:
            raise KeyError(f"自动化任务不存在：{automation_id}")
        return auto

    async def list(self) -> list[dict]:
        await self._ensure_db()
        return await db.list_automations(self.db_path)

    async def delete(self, automation_id: str) -> dict:
        await self.get(automation_id)
        await db.delete_automation(self.db_path, automation_id)
        return {"deleted": automation_id}

    # ---------- 执行 ----------

    async def trigger(self, automation_id: str, *, manual: bool = True) -> dict:
        """触发执行：建 run 记录 → runner 执行 → 落结果。手动触发不改调度。"""
        auto = await self.get(automation_id)
        run_id = uuid.uuid4().hex[:12]
        await db.insert_automation_run(
            self.db_path,
            run_id,
            automation_id,
            trigger_type="manual" if manual else "schedule",
        )
        now = _fmt(datetime.now(UTC))
        try:
            result = await self.runner(auto)
            ok = bool(result.get("ok"))
            await db.finish_automation_run(
                self.db_path,
                run_id,
                status="success" if ok else "failed",
                task_id=str(result.get("task_id", "")),
                output=str(result.get("output", "")),
                error=str(result.get("error", "")),
            )
        except Exception as exc:  # noqa: BLE001  # runner 异常也记录
            await db.finish_automation_run(
                self.db_path, run_id, status="failed", error=str(exc)
            )
            ok = False
        await db.mark_automation_fired(
            self.db_path,
            automation_id,
            run_at=now,
            status=self._post_fire_status(auto, ok),
            next_run_at=compute_next_run(auto["schedule"]) or None,
        )
        return await self._run_payload(run_id, automation_id, ok)

    async def runs(self, automation_id: str) -> list[dict]:
        await self.get(automation_id)
        return await db.list_automation_runs(self.db_path, automation_id)

    def _post_fire_status(self, auto: dict, ok: bool) -> str | None:
        """一次性任务触发后转 paused（同规格 once_fired → paused）；其余保持。"""
        if auto["trigger_type"] == "once" and ok:
            return "paused"
        return None

    async def _run_payload(self, run_id: str, automation_id: str, ok: bool) -> dict:
        run = await self.get_run(run_id)
        auto = await db.get_automation(self.db_path, automation_id)
        return {
            "run_id": run_id,
            "status": run["status"],
            "task_id": run["task_id"],
            "error": run["error"],
            "ok": ok,
            "automation": auto,
        }

    async def get_run(self, run_id: str) -> dict:
        run = await db.get_automation_run(self.db_path, run_id)
        if run is None:
            raise KeyError(f"自动化运行记录不存在：{run_id}")
        return run

    # ---------- 默认 runner ----------

    async def _default_runner(self, auto: dict) -> dict:
        """supervisor 闭环：建任务 → plan（LLM 拆解）→ approve → 后台执行。"""
        if self.supervisor is None:
            raise RuntimeError("自动化未接入 supervisor，无法执行")
        task = await self.supervisor.create_task(
            auto["prompt"], "automation", kind="task", title=auto["name"]
        )
        task_id = task["task_id"]
        try:
            await self.supervisor.plan(task_id)
            await self.supervisor.approve(task_id)
            asyncio.create_task(self.supervisor.run(task_id))
            return {
                "ok": True,
                "task_id": task_id,
                "output": "已创建任务并授权执行",
            }
        except Exception as exc:  # noqa: BLE001  # 任务保留 PENDING，可手动接管
            return {"ok": False, "task_id": task_id, "error": str(exc)}


def _fmt(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def compute_next_run(schedule: str, after: datetime | None = None) -> str:
    """计算下次触发时间（cron 任务；一次性/空 schedule 返回空）。"""
    if not schedule:
        return ""
    nxt = next_match(schedule, after or datetime.now(UTC))
    return _fmt(nxt) if nxt else ""
