"""RocheFlow FastAPI 入口（Phase 2：Plan → Execute → Verify 闭环）。

无头引擎的本地 RPC 面：HTTP + WebSocket。
流程：POST /tasks 创建 → POST /tasks/{id}/plan 规划 → POST /tasks/{id}/approve 授权执行 →
     GET /tasks/{id} 查看状态与子任务明细。
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.core import db
from backend.core.config import get_settings
from backend.core.schemas import TaskCreate
from backend.llm.client import LLMNotConfiguredError
from backend.orchestration.supervisor import Supervisor

settings = get_settings()
supervisor = Supervisor()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init_db()
    yield


app = FastAPI(
    title="RocheFlow Agent Engine",
    version="0.2.0",
    description="无头智能体引擎：编排 / 沙箱 / 记忆 / 技能 / MCP / 调度",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, LLMNotConfiguredError):
        return HTTPException(status_code=503, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@app.get("/health")
async def health() -> dict:
    """存活探针。"""
    return {"status": "ok", "service": "rocheflow", "version": "0.2.0"}


@app.post("/api/v1/tasks")
async def create_task(payload: TaskCreate) -> dict:
    """创建任务（PENDING）。"""
    return await supervisor.create_task(payload.goal, payload.source)


@app.get("/api/v1/tasks")
async def list_tasks() -> list[dict]:
    """任务列表。"""
    return await supervisor.list()


@app.post("/api/v1/tasks/{task_id}/plan")
async def plan_task(task_id: str) -> dict:
    """规划：LLM 拆解目标为子任务 DAG 并落库（PLANNED）。"""
    try:
        return await supervisor.plan(task_id)
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


@app.post("/api/v1/tasks/{task_id}/approve")
async def approve_task(task_id: str) -> dict:
    """授权执行：后台运行计划 DAG。"""
    try:
        result = await supervisor.approve(task_id)
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc
    asyncio.create_task(supervisor.run(task_id))
    return result


@app.get("/api/v1/tasks/{task_id}")
async def task_status(task_id: str) -> dict:
    """任务状态 + 子任务明细。"""
    try:
        return await supervisor.status(task_id)
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


@app.get("/api/v1/workflows/example")
async def example_workflow() -> dict:
    """示例计划 DAG（networkx 序列化，冒烟用）。"""
    from backend.orchestration.dag import build_empty_dag, to_dict

    graph = build_empty_dag()
    graph.add_node("plan")
    graph.add_node("execute")
    graph.add_edge("plan", "execute")
    return to_dict(graph)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    """WebSocket 回声桩：后续承载任务流式输出。"""
    await ws.accept()
    try:
        while True:
            data = await ws.receive_text()
            await ws.send_text(f"rocheflow: {data}")
    except WebSocketDisconnect:
        pass
