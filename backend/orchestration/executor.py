"""工具执行与 DAG 执行入口。

自 LangGraph 内核（graph.py）落地后，execute_dag 委托 run_graph，
保留签名兼容（外部 / 旧测试仍可按原样调用）。
"""

from __future__ import annotations

import json

from backend.core import db
from backend.tools.executor import ToolExecutor


async def execute_dag(
    path: str,
    task_id: str,
    tools: ToolExecutor,
    *,
    max_concurrency: int = 2,
    max_retries: int = 1,
    checkpoint_path: str | None = None,
) -> str:
    """执行任务的计划 DAG（LangGraph 图 + checkpointer），返回最终状态。"""
    from backend.orchestration.graph import run_graph  # 延迟导入避免循环

    return await run_graph(
        path,
        task_id,
        tools,
        max_concurrency=max_concurrency,
        max_retries=max_retries,
        checkpoint_path=checkpoint_path,
    )


async def _run_subtask(
    path: str, sub: dict, tools: ToolExecutor, *, max_retries: int
) -> bool:
    await db.update_subtask(path, sub["id"], status="RUNNING")
    tool = sub["tool"] or "noop"
    try:
        tool_args = json.loads(sub["tool_args"] or "{}")
    except json.JSONDecodeError:
        tool_args = {}

    last_error: str | None = None
    for attempt in range(max_retries + 1):
        try:
            result = await tools.call(tool, **tool_args)
            await db.update_subtask(
                path,
                sub["id"],
                status="DONE",
                result=json.dumps(result, ensure_ascii=False, default=str),
            )
            return True
        except Exception as exc:  # noqa: BLE001  # 工具失败，尝试重试
            last_error = f"第 {attempt + 1} 次失败：{exc}"
            if attempt < max_retries:
                continue

    await db.update_subtask(path, sub["id"], status="FAILED", error=last_error)
    return False
