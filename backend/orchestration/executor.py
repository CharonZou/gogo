"""工具执行与 DAG 执行入口。

自 LangGraph 内核（graph.py）落地后，execute_dag 委托 run_graph，
保留签名兼容（外部 / 旧测试仍可按原样调用）。
"""

from __future__ import annotations

import fnmatch
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
    stream_callback=None,
) -> str:
    """执行任务的计划 DAG（LangGraph 图 + checkpointer），返回最终状态。

    若任务已派给智能体员工且该员工配置了工具白名单，
    非终态子任务使用白名单外工具的直接标记 FAILED（安全护栏）。
    stream_callback 透传给 run_graph 做 WebSocket 流式推送。
    """
    await _apply_agent_tool_whitelist(path, task_id)

    from backend.orchestration.graph import run_graph  # 延迟导入避免循环

    return await run_graph(
        path,
        task_id,
        tools,
        max_concurrency=max_concurrency,
        max_retries=max_retries,
        checkpoint_path=checkpoint_path,
        stream_callback=stream_callback,
    )


async def _apply_agent_tool_whitelist(path: str, task_id: str) -> None:
    """按任务 assignee 的工具白名单过滤未执行子任务（空白名单 = 不限制）。"""
    task = await db.get_task(path, task_id)
    if task is None or not task.get("assignee_id"):
        return
    agent = await db.get_agent(path, task["assignee_id"])
    if agent is None:
        return
    whitelist: list[str] = agent.get("tool_whitelist") or []
    if not whitelist:
        return
    for sub in await db.list_subtasks(path, task_id):
        if sub["status"] in ("DONE", "FAILED"):
            continue  # 终态不重判，保持既有结果
        if not _tool_allowed(sub["tool"] or "noop", whitelist):
            await db.update_subtask(
                path,
                sub["id"],
                status="FAILED",
                error=f"[whitelist] 工具「{sub['tool']}」不在该员工工具白名单内，已拒绝执行",
            )


def _tool_allowed(tool: str, whitelist: list[str]) -> bool:
    """白名单匹配：支持精确名与 mcp__<server>__* 通配。"""
    return any(fnmatch.fnmatch(tool, pattern) for pattern in whitelist)


async def _run_subtask(
    path: str, sub: dict, tools: ToolExecutor, *, max_retries: int
) -> bool:
    await db.update_subtask(path, sub["id"], status="RUNNING")
    tool = sub["tool"] or "noop"
    try:
        tool_args = json.loads(sub["tool_args"] or "{}")
    except json.JSONDecodeError:
        tool_args = {}
    # 审批元数据（approval）是图内 human-in-the-loop 标记，不是工具参数
    tool_args.pop("approval", None)

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
