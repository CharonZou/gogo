"""值班调度器（P3.1）：员工按 schedule 到点自动上班。

- 复用 5 字段 cron（automations.cron.match_cron）与分钟级去重；
- 命中后触发 agent_manager.duty_shift(agent_id)：自动上班 → 自动接单 → 写工作汇报；
- 总开关 duty_scheduler_enabled，随 app lifespan 启停。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime

from backend.automations.cron import match_cron
from backend.core.config import get_settings

logger = logging.getLogger(__name__)


class DutyScheduler:
    def __init__(
        self,
        agent_manager,
        *,
        tick_seconds: int | None = None,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        settings = get_settings()
        self.agent_manager = agent_manager
        self.tick_seconds = tick_seconds or settings.duty_tick_seconds
        self.now_fn = now_fn or (lambda: datetime.now(UTC))
        self._running = False
        self._task: asyncio.Task | None = None
        self._fired_minutes: dict[str, str] = {}  # agent_id -> 已触发分钟串

    # ---------- 生命周期 ----------

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="duty-scheduler")

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    @property
    def running(self) -> bool:
        return self._running

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._tick()
            except Exception:
                logger.exception("值班调度 tick 异常，等待下一轮")
            await asyncio.sleep(self.tick_seconds)

    async def _tick(self) -> None:
        now = self.now_fn()
        for agent in await self.agent_manager.list():
            if not self.check_due(agent, now):
                continue
            self._fired_minutes[agent["id"]] = now.strftime("%Y-%m-%d %H:%M")
            try:
                await self.agent_manager.duty_shift(agent["id"])
            except Exception:
                logger.exception("值班上班失败：agent=%s", agent["id"])

    # ---------- 纯函数（可测） ----------

    def check_due(self, agent: dict, now: datetime) -> bool:
        """判断员工是否在本分钟该自动上班：auto_work 开 + cron 命中 + 分钟去重。"""
        if not agent.get("auto_work"):
            return False
        schedule = agent.get("schedule_json") or {}
        cron = (schedule.get("cron") or "").strip()
        if not cron:
            return False
        if self._fired_minutes.get(agent["id"]) == now.strftime("%Y-%m-%d %H:%M"):
            return False
        return match_cron(cron, now)
