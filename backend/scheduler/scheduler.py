"""自动化调度器：asyncio 事件循环按 tick 扫描 cron 命中并触发执行。

- 启动/停止随 app lifespan；
- tick 内按「当前分钟命中 + last_run_at 分钟去重」防重复触发；
- 并发受 automation_max_concurrent 限制，超出的等下一 tick（简单排队）；
- 总开关 automation_scheduler_enabled（对应 ROCHEFLOW_AUTOMATION_SCHEDULER）。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime

from backend.automations.cron import match_cron
from backend.core.config import get_settings

logger = logging.getLogger(__name__)


class AutomationScheduler:
    def __init__(
        self,
        manager,
        *,
        tick_seconds: int | None = None,
        max_concurrent: int | None = None,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        settings = get_settings()
        self.manager = manager
        self.tick_seconds = tick_seconds or settings.automation_tick_seconds
        self.max_concurrent = max_concurrent or settings.automation_max_concurrent
        self.now_fn = now_fn or (lambda: datetime.now(UTC))
        self._running = False
        self._task: asyncio.Task | None = None
        self._active = 0  # 当前正在执行数
        self._fired_minutes: dict[str, str] = {}  # automation_id -> 已触发分钟串

    # ---------- 生命周期 ----------

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="automation-scheduler")

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

    @property
    def active_count(self) -> int:
        return self._active

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._tick()
            except Exception:  # 单次 tick 异常不终止循环
                logger.exception("自动化调度 tick 异常，等待下一轮")
            await asyncio.sleep(self.tick_seconds)

    async def _tick(self) -> None:
        now = self.now_fn()
        autos = await self.manager.list()
        due = self.check_due(autos, now)
        for auto in due:
            if self._active >= self.max_concurrent:
                break
            self._active += 1
            self._fired_minutes[auto["id"]] = now.strftime("%Y-%m-%d %H:%M")
            try:
                await self.manager.trigger(auto["id"], manual=False)
            finally:
                self._active -= 1

    # ---------- 纯函数（可测） ----------

    def check_due(self, autos: list[dict], now: datetime) -> list[dict]:
        """筛出本分钟该触发的 active cron 任务（分钟级去重）。"""
        minute_key = now.strftime("%Y-%m-%d %H:%M")
        due: list[dict] = []
        for auto in autos:
            if auto["status"] != "active":
                continue
            if auto["trigger_type"] != "cron":
                continue
            if not auto["schedule"]:
                continue
            if self._fired_minutes.get(auto["id"]) == minute_key:
                continue
            if not match_cron(auto["schedule"], now):
                continue
            due.append(auto)
        return due
