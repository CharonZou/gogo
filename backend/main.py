"""RocheFlow FastAPI 入口。

无头引擎的本地 RPC 面：HTTP + WebSocket。
客户端（Roche 壳 / CLI / IM 网关）通过本服务集成编排能力。
"""

from __future__ import annotations

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import get_settings
from backend.core.schemas import TaskCreate
from backend.orchestration.dag import build_empty_dag, to_dict
from backend.orchestration.supervisor import Supervisor

settings = get_settings()

app = FastAPI(
    title="RocheFlow Agent Engine",
    version="0.1.0",
    description="无头智能体引擎：编排 / 沙箱 / 记忆 / 技能 / MCP / 调度",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

supervisor = Supervisor()


@app.get("/health")
async def health() -> dict:
    """存活探针。"""
    return {"status": "ok", "service": "rocheflow", "version": "0.1.0"}


@app.post("/api/v1/tasks")
async def create_task(payload: TaskCreate) -> dict:
    """创建任务（桩）：后续接入 Plan → Execute → Verify 状态机。"""
    task_id = supervisor.create_task_stub(
        {"goal": payload.goal, "source": payload.source}
    )
    return {"task_id": task_id, "status": "PENDING"}


@app.get("/api/v1/workflows/example")
async def example_workflow() -> dict:
    """返回一个示例计划 DAG（networkx 序列化）。"""
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
