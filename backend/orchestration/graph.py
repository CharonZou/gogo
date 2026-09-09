"""LangGraph 编排内核：DAG 执行图 + 断点续跑（checkpointer）。

对标 DeerFlow 2.0 / EvoFlow 的 LangGraph 运行时，替换自研 asyncio 执行循环：

- 执行图：execute（拓扑推进 DAG，并行批次）→ verify（验收）→ 终态
- checkpointer：AsyncSqliteSaver 落盘（独立 checkpoints.db），thread_id = task_id
  → 同任务重新触发时从 checkpoint 恢复，跳过已完成子任务（断点续跑）
- 业务台账（tasks/subtasks）与 checkpoint 双写：台账供 API 查询，checkpoint 供运行时恢复
- 周边（LLM 网关 / 沙箱 / 工具 / 记忆 / agents / assistant / API）不在此层，保持自研

状态 schema 只含可序列化简单数据；业务对象（tools / db_path / 并发参数）经
config.configurable 注入，不进 checkpoint。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from backend.core import db
from backend.orchestration.executor import _run_subtask
from backend.tools.executor import ToolExecutor

# 流式事件回调：每轮节点输出推给订阅者（WebSocket / 日志）
StreamCallback = Callable[[dict], Awaitable[None]]


class RunState(TypedDict, total=False):
    task_id: str
    done: list[str]
    failed: list[str]
    final_status: str


def _cfg(config: RunnableConfig) -> dict[str, Any]:
    return config["configurable"]


def _needs_approval(sub: dict) -> bool:
    """子任务是否需人工审批：tool=human 或 tool_args.approval=true。"""
    if (sub["tool"] or "noop") == "human":
        return True
    try:
        args = json.loads(sub["tool_args"] or "{}")
    except json.JSONDecodeError:
        return False
    return bool(args.get("approval"))


async def execute_node(state: RunState, config: RunnableConfig) -> dict:
    """拓扑推进 DAG：每轮取依赖全部完成的子任务，最多 max_concurrency 个并行。

    语义与旧 execute_dag 一致：失败重试（max_retries）、fail-fast。
    恢复语义：checkpoint 中的 done 集合跳过已完成子任务。
    """
    cfg = _cfg(config)
    path: str = cfg["db_path"]
    task_id: str = state["task_id"]
    tools: ToolExecutor = cfg["tools"]
    max_concurrency: int = cfg["max_concurrency"]
    max_retries: int = cfg["max_retries"]

    # 取消标记：已取消的任务不再推进，落 CANCELLED 终态
    task = await db.get_task(path, task_id)
    if task is not None and task.get("cancelled"):
        await db.update_task_status(path, task_id, "CANCELLED")
        return {"done": [], "failed": [], "final_status": "CANCELLED"}

    await db.update_task_status(path, task_id, "RUNNING")

    subtasks = await db.list_subtasks(path, task_id)
    if not subtasks:
        return {"done": [], "failed": [], "final_status": "DONE"}

    deps: dict[str, list[str]] = {
        s["id"]: json.loads(s["depends_on"] or "[]") for s in subtasks
    }
    # 恢复语义：DB 中已 DONE 的子任务并入完成集合（不重跑 + 解锁下游），
    # checkpoint 丢失时也能据此断点续跑（双保险）。
    done: set[str] = set(state.get("done", []))
    done.update(s["id"] for s in subtasks if s["status"] == "DONE")
    failed: set[str] = set(state.get("failed", []))
    # 硬性终态：白名单拒绝 / 人工拒绝不随 FAILED 重跑（避免恢复后重复审批）
    failed.update(
        s["id"]
        for s in subtasks
        if s["status"] == "FAILED"
        and (s["error"] or "").startswith(("[whitelist]", "[rejected]"))
    )

    while len(done) < len(subtasks) and not failed:
        # 每轮执行前再检查取消（用户在 RUNNING 中点了取消）
        task = await db.get_task(path, task_id)
        if task is not None and task.get("cancelled"):
            await db.update_task_status(path, task_id, "CANCELLED")
            return {"done": sorted(done), "failed": sorted(failed), "final_status": "CANCELLED"}

        ready = [
            s
            for s in subtasks
            if s["id"] not in done
            and s["id"] not in failed
            and s["status"] in ("PENDING", "FAILED", "WAITING_APPROVAL")
            and all(d in done for d in deps[s["id"]])
        ]
        if not ready:
            # 依赖缺失或成环（或全部已完成），无法推进
            missing = [s["id"] for s in subtasks if s["id"] not in done and s["id"] not in failed]
            failed.update(missing)
            break

        # 审批门（human-in-the-loop）：待执行子任务需要审批时挂起等人工
        for s in ready:
            if _needs_approval(s):
                await db.update_subtask(path, s["id"], status="WAITING_APPROVAL")
                await db.update_task_status(path, task_id, "INTERRUPTED")
                # interrupt 为同步挂起：首次运行在此暂停（返回 __interrupt__），
                # resume 后立即返回人工决策（{"approve": true/false}）
                decision = interrupt({"subtask_id": s["id"], "title": s["title"]})
                if not decision.get("approve"):
                    await db.update_subtask(
                        path,
                        s["id"],
                        status="FAILED",
                        error="[rejected] 人工未批准该子任务",
                    )
                    failed.add(s["id"])
                    continue
                # 已批准：标记 APPROVED（非 PENDING），恢复重跑时不再进 ready 重复审批
                await db.update_subtask(path, s["id"], status="APPROVED")

        # 已拒绝（failed 集合）的子任务不再入批执行
        batch = [s for s in ready if s["id"] not in failed][:max_concurrency]
        outcomes = await asyncio.gather(
            *(_run_subtask(path, s, tools, max_retries=max_retries) for s in batch)
        )
        for s, ok in zip(batch, outcomes):
            if ok:
                done.add(s["id"])
            else:
                failed.add(s["id"])
                break  # fail-fast：一个失败即整体失败

    final = "DONE" if (not failed and len(done) == len(subtasks)) else "FAILED"
    return {
        "done": sorted(done),
        "failed": sorted(failed),
        "final_status": final,
    }


async def verify_node(state: RunState, config: RunnableConfig) -> dict:
    """验收：MVP 自动通过。DONE → VERIFYING → DONE；否则 FAILED。"""
    path: str = _cfg(config)["db_path"]
    task_id: str = state["task_id"]
    if state.get("final_status") == "DONE":
        await db.update_task_status(path, task_id, "VERIFYING")
        await db.update_task_status(path, task_id, "DONE")
    else:
        await db.update_task_status(path, task_id, "FAILED")
    return {}


def build_graph() -> StateGraph:
    """构建执行图：START → execute → verify → END。"""
    graph = StateGraph(RunState)
    graph.add_node("execute", execute_node)
    graph.add_node("verify", verify_node)
    graph.add_edge(START, "execute")
    graph.add_edge("execute", "verify")
    graph.add_edge("verify", END)
    return graph


def default_checkpoint_path(sqlite_path: str) -> str:
    """checkpoints.db 与业务库同目录（避免污染业务 schema）。"""
    from pathlib import Path

    return str(Path(sqlite_path).with_name("checkpoints.db"))


async def run_graph(
    path: str,
    task_id: str,
    tools: ToolExecutor,
    *,
    max_concurrency: int = 2,
    max_retries: int = 1,
    checkpoint_path: str | None = None,
    stream_callback: StreamCallback | None = None,
) -> str:
    """执行任务的计划 DAG（LangGraph 图 + checkpointer），返回最终状态。

    同 task_id 重新调用即断点续跑：从 checkpoint 恢复 done 集合，
    已完成子任务不再重跑。遇审批门（interrupt）挂起返回 INTERRUPTED，
    由 resume_graph 继续。stream_callback 每轮节点输出异步推流。
    """
    ckpt = checkpoint_path or default_checkpoint_path(path)
    async with AsyncSqliteSaver.from_conn_string(ckpt) as saver:
        await saver.setup()
        compiled = build_graph().compile(checkpointer=saver)
        config = {
            "configurable": {
                "thread_id": task_id,
                "db_path": path,
                "tools": tools,
                "max_concurrency": max_concurrency,
                "max_retries": max_retries,
            }
        }
        return await _stream_graph(compiled, config, task_id, stream_callback)


async def resume_graph(
    path: str,
    task_id: str,
    decision: dict,
    tools: ToolExecutor,
    *,
    max_concurrency: int = 2,
    max_retries: int = 1,
    checkpoint_path: str | None = None,
    stream_callback: StreamCallback | None = None,
) -> str:
    """继续被审批门挂起的任务：Command(resume=decision) 恢复执行。"""
    ckpt = checkpoint_path or default_checkpoint_path(path)
    async with AsyncSqliteSaver.from_conn_string(ckpt) as saver:
        await saver.setup()
        compiled = build_graph().compile(checkpointer=saver)
        config = {
            "configurable": {
                "thread_id": task_id,
                "db_path": path,
                "tools": tools,
                "max_concurrency": max_concurrency,
                "max_retries": max_retries,
            }
        }
        return await _stream_graph(
            compiled, config, task_id, stream_callback, resume=decision
        )


async def _stream_graph(
    compiled: Any,
    config: dict,
    task_id: str,
    stream_callback: StreamCallback | None,
    *,
    resume: dict | None = None,
) -> str:
    """ainvoke/astream 统一入口：遇 interrupt 返回 INTERRUPTED，事件异步推送。"""
    if resume is not None:
        result = await compiled.ainvoke(Command(resume=resume), config)
        return _finish_stream(compiled, config, task_id, result, stream_callback)

    final = "PENDING"
    async for chunk in compiled.astream(
        {"task_id": task_id, "done": [], "failed": [], "final_status": "PENDING"},
        config,
        stream_mode="updates",
    ):
        if "__interrupt__" in chunk:
            # 审批门挂起：停止推进，返回 INTERRUPTED 由 resume_graph 续跑
            final = "INTERRUPTED"
            break
        for node_name, node_out in chunk.items():
            if not isinstance(node_out, dict) or "final_status" not in node_out:
                continue
            final = node_out["final_status"]
            if stream_callback is not None:
                try:
                    await stream_callback(
                        {
                            "task_id": task_id,
                            "node": node_name,
                            "done": node_out.get("done", []),
                            "failed": node_out.get("failed", []),
                            "final_status": final,
                        }
                    )
                except Exception:  # noqa: BLE001, S110 - 推流失败不影响执行
                    pass
    if final == "PENDING":
        # 兜底：astream 挂起时以 DB 状态为准（中断发生在节点内部）
        from backend.core import db

        task = await db.get_task(config["configurable"]["db_path"], task_id)
        if task is not None and task["status"] == "INTERRUPTED":
            final = "INTERRUPTED"
    return final


def _finish_stream(
    compiled: Any,
    config: dict,
    task_id: str,
    result: dict,
    stream_callback: StreamCallback | None,
) -> str:
    """resume 后无更多中断直接收束；仍有中断则继续 INTERRUPTED。"""
    if "__interrupt__" in result:
        return "INTERRUPTED"
    final = result.get("final_status", "PENDING")
    if stream_callback is not None:
        # 同步路径（resume 后未再挂起）：补一条终态事件
        try:
            asyncio.get_running_loop().create_task(
                stream_callback(
                    {
                        "task_id": task_id,
                        "node": "execute",
                        "done": result.get("done", []),
                        "failed": result.get("failed", []),
                        "final_status": final,
                    }
                )
            )
        except Exception:  # noqa: BLE001, S110 - 推流失败不影响执行
            pass
    return final
