"""Supervisor：澄清意图 → 拆子任务 DAG → 授权 → 验收。

真实实现：任务落库、LLM 规划落库、授权后由执行引擎推进。
规划器可注入（测试用 fake），默认走 LLM 网关。
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from backend.core import db
from backend.core.config import get_settings
from backend.llm.client import LLMClient
from backend.orchestration.executor import execute_dag
from backend.orchestration.graph import default_checkpoint_path
from backend.orchestration.planner import (
    parse_plan,
    plan_to_dict,
    plan_to_json,
    plan_with_llm,
)
from backend.tools.executor import ToolExecutor, build_default_executor

Planner = Callable[[str], Awaitable[dict]]

_initialized_paths: set[str] = set()


class Supervisor:
    def __init__(
        self,
        db_path: str | None = None,
        llm: LLMClient | None = None,
        planner: Planner | None = None,
        tools: ToolExecutor | None = None,
        *,
        max_concurrency: int | None = None,
        max_retries: int | None = None,
        checkpoint_path: str | None = None,
    ) -> None:
        settings = get_settings()
        self.db_path = db_path or db.get_db_path()
        self.llm = llm or LLMClient()
        self.planner = planner or _default_planner(self.llm)
        self.tools = tools or build_default_executor()
        self.max_concurrency = max_concurrency or settings.max_concurrency
        self.max_retries = max_retries if max_retries is not None else settings.max_retries
        self.checkpoint_path = checkpoint_path or default_checkpoint_path(self.db_path)

    async def _ensure_db(self) -> None:
        """惰性初始化 schema（幂等，按路径缓存）。"""
        if self.db_path in _initialized_paths:
            return
        await db.init_db(self.db_path)
        _initialized_paths.add(self.db_path)

    # ---------- Plan → Execute → Verify 闭环 ----------

    async def create_task(
        self,
        goal: str | None = None,
        source: str = "rpc",
        *,
        kind: str = "task",
        title: str | None = None,
        due_at: str | None = None,
        priority: str = "medium",
    ) -> dict:
        """创建任务（PENDING）。kind=todo 用 title，task/report 用 goal。"""
        if kind not in ("todo", "task", "report"):
            raise ValueError(f"非法任务类型：{kind}")
        if priority not in ("low", "medium", "high"):
            raise ValueError(f"非法优先级：{priority}")
        if kind == "todo" and not title:
            raise ValueError("待办（todo）需要提供 title")
        if kind in ("task", "report") and not goal:
            raise ValueError(f"{kind} 类型需要提供 goal")
        await self._ensure_db()
        task_id = uuid.uuid4().hex[:12]
        await db.insert_task(
            self.db_path,
            task_id,
            goal or "",
            source,
            kind=kind,
            title=title,
            due_at=due_at,
            priority=priority,
        )
        return {"task_id": task_id, "status": "PENDING"}

    async def update_task(
        self,
        task_id: str,
        *,
        goal: str | None = None,
        title: str | None = None,
        due_at: str | None = None,
        priority: str | None = None,
    ) -> dict:
        """修改任务（标题 / 截止 / 优先级 / 目标）。"""
        await self._ensure_db()
        if await db.get_task(self.db_path, task_id) is None:
            raise KeyError(f"任务不存在：{task_id}")
        if priority is not None and priority not in ("low", "medium", "high"):
            raise ValueError(f"非法优先级：{priority}")
        await db.update_task(
            self.db_path,
            task_id,
            goal=goal,
            title=title,
            due_at=due_at,
            priority=priority,
        )
        return await db.get_task(self.db_path, task_id)

    async def assign_task(self, task_id: str, agent_id: str) -> dict:
        """派给智能体员工。"""
        await self._ensure_db()
        if await db.get_task(self.db_path, task_id) is None:
            raise KeyError(f"任务不存在：{task_id}")
        if await db.get_agent(self.db_path, agent_id) is None:
            raise KeyError(f"智能体员工不存在：{agent_id}")
        await db.assign_task(self.db_path, task_id, agent_id)
        return await db.get_task(self.db_path, task_id)

    async def complete_task(self, task_id: str) -> dict:
        """标记完成（执行中不允许手动完成）。"""
        await self._ensure_db()
        task = await db.get_task(self.db_path, task_id)
        if task is None:
            raise KeyError(f"任务不存在：{task_id}")
        if task["status"] in ("RUNNING", "VERIFYING"):
            raise ValueError(f"任务执行中（{task['status']}），不允许手动完成")
        await db.complete_task(self.db_path, task_id)
        return await db.get_task(self.db_path, task_id)

    async def plan(self, task_id: str) -> dict:
        """规划：LLM 拆解目标 → 校验 → 子任务落库，任务进入 PLANNED。"""
        await self._ensure_db()
        task = await db.get_task(self.db_path, task_id)
        if task is None:
            raise KeyError(f"任务不存在：{task_id}")
        if task["status"] not in ("PENDING", "PLANNED", "FAILED"):
            raise ValueError(f"当前状态不允许规划：{task['status']}")

        raw = await self.planner(task["goal"])
        plan = parse_plan(raw)

        await db.delete_subtasks(self.db_path, task_id)  # 重规划时清旧计划
        for position, sub in enumerate(plan):
            await db.insert_subtask(
                self.db_path,
                sub.id,
                task_id,
                sub.title,
                sub.description,
                sub.depends_on,
                sub.tool,
                sub.tool_args,
                position,
            )
        await db.update_task_status(
            self.db_path, task_id, "PLANNED", plan_json=plan_to_json(plan)
        )
        return plan_to_dict(plan)

    async def approve(self, task_id: str) -> dict:
        """授权：仅允许 PLANNED 状态，进入 APPROVED 并启动后台执行。"""
        await self._ensure_db()
        task = await db.get_task(self.db_path, task_id)
        if task is None:
            raise KeyError(f"任务不存在：{task_id}")
        if task["status"] != "PLANNED":
            raise ValueError(f"需先完成规划（当前状态：{task['status']}）")
        await db.update_task_status(self.db_path, task_id, "APPROVED")
        return {"task_id": task_id, "status": "APPROVED", "message": "已授权，等待执行"}

    async def run(self, task_id: str) -> dict:
        """同步执行计划 DAG（供后台任务 / 测试直接调用）。"""
        await self._ensure_db()
        task = await db.get_task(self.db_path, task_id)
        if task is None:
            raise KeyError(f"任务不存在：{task_id}")
        if task["status"] not in ("APPROVED", "PENDING", "PLANNED"):
            raise ValueError(f"当前状态不允许执行：{task['status']}")
        final = await execute_dag(
            self.db_path,
            task_id,
            self.tools,
            max_concurrency=self.max_concurrency,
            max_retries=self.max_retries,
            checkpoint_path=self.checkpoint_path,
        )
        return {"task_id": task_id, "status": final}

    async def status(self, task_id: str) -> dict:
        """任务状态 + 子任务明细。"""
        await self._ensure_db()
        task = await db.get_task(self.db_path, task_id)
        if task is None:
            raise KeyError(f"任务不存在：{task_id}")
        subtasks = await db.list_subtasks(self.db_path, task_id)
        return {**task, "subtasks": subtasks}

    # ---------- 查询 ----------

    async def list(self, limit: int = 50) -> list[dict]:
        await self._ensure_db()
        return await db.list_tasks(self.db_path, limit=limit)


def _default_planner(llm: LLMClient) -> Planner:
    """默认规划器：LLM 网关（闭包）。"""

    async def _plan(goal: str) -> dict:
        return await plan_with_llm(llm, goal)

    return _plan
