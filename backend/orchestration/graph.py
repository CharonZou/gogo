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
from typing import Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph

from backend.core import db
from backend.orchestration.executor import _run_subtask
from backend.tools.executor import ToolExecutor


class RunState(TypedDict, total=False):
    task_id: str
    done: list[str]
    failed: list[str]
    final_status: str


def _cfg(config: RunnableConfig) -> dict[str, Any]:
    return config["configurable"]


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
    # 白名单拒绝（[whitelist] 前缀）为硬性终态，不随 FAILED 重跑
    failed.update(
        s["id"]
        for s in subtasks
        if s["status"] == "FAILED"
        and (s["error"] or "").startswith("[whitelist]")
    )

    while len(done) < len(subtasks) and not failed:
        ready = [
            s
            for s in subtasks
            if s["id"] not in done
            and s["id"] not in failed
            and s["status"] in ("PENDING", "FAILED")
            and all(d in done for d in deps[s["id"]])
        ]
        if not ready:
            # 依赖缺失或成环（或全部已完成），无法推进
            missing = [s["id"] for s in subtasks if s["id"] not in done and s["id"] not in failed]
            failed.update(missing)
            break

        batch = ready[:max_concurrency]
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
) -> str:
    """执行任务的计划 DAG（LangGraph 图 + checkpointer），返回最终状态。

    同 task_id 重新调用即断点续跑：从 checkpoint 恢复 done 集合，
    已完成子任务不再重跑。
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
        result = await compiled.ainvoke(
            {"task_id": task_id, "done": [], "failed": [], "final_status": "PENDING"},
            config,
        )
    return result["final_status"]
