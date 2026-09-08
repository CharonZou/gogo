"""DAG 执行引擎：按依赖拓扑推进子任务，支持并行与重试。

语义：
- 每轮取「依赖全部完成」的待执行子任务，最多 max_concurrency 个并行。
- 子任务失败时按 max_retries 重试；重试耗尽后任务整体失败（fail-fast）。
- 全部完成后任务进入 VERIFYING → DONE（MVP 简化验收为自动通过）。
"""

from __future__ import annotations

import asyncio
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
) -> str:
    """执行任务的计划 DAG，返回最终状态 DONE / FAILED。"""
    await db.update_task_status(path, task_id, "RUNNING")

    subtasks = await db.list_subtasks(path, task_id)
    if not subtasks:
        await db.update_task_status(path, task_id, "DONE")
        return "DONE"

    deps: dict[str, list[str]] = {
        s["id"]: json.loads(s["depends_on"] or "[]") for s in subtasks
    }
    by_id = {s["id"]: s for s in subtasks}
    done: set[str] = set()
    failed = False

    while len(done) < len(subtasks) and not failed:
        ready = [
            s
            for s in subtasks
            if s["id"] not in done
            and s["status"] in ("PENDING", "FAILED")
            and all(d in done for d in deps[s["id"]])
        ]
        if not ready:
            failed = True  # 依赖缺失或成环，无法推进
            break

        batch = ready[:max_concurrency]
        outcomes = await asyncio.gather(
            *(
                _run_subtask(path, s, tools, max_retries=max_retries)
                for s in batch
            )
        )
        for s, ok in zip(batch, outcomes):
            if ok:
                done.add(s["id"])
            else:
                failed = True
                break

    final = "DONE" if (not failed and len(done) == len(subtasks)) else "FAILED"
    if final == "DONE":
        await db.update_task_status(path, task_id, "VERIFYING")
        await db.update_task_status(path, task_id, "DONE")
    else:
        await db.update_task_status(path, task_id, "FAILED")
    return final


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
        except Exception as exc:  # 工具失败，尝试重试
            last_error = f"第 {attempt + 1} 次失败：{exc}"
            if attempt < max_retries:
                continue

    await db.update_subtask(path, sub["id"], status="FAILED", error=last_error)
    return False
