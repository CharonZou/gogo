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

from backend.agents.manager import AgentManager
from backend.core import db
from backend.core.config import get_settings
from backend.core.schemas import (
    AgentCreate,
    AgentUpdate,
    AssignRequest,
    ChatRequest,
    TaskCreate,
    TaskUpdate,
)
from backend.llm.client import LLMNotConfiguredError
from backend.orchestration.supervisor import Supervisor

settings = get_settings()
supervisor = Supervisor()
agent_manager = AgentManager()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init_db()
    yield


app = FastAPI(
    title="RocheFlow Agent Engine",
    version="0.3.0",
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
    return {"status": "ok", "service": "rocheflow", "version": "0.3.0"}


@app.post("/api/v1/tasks")
async def create_task(payload: TaskCreate) -> dict:
    """创建任务 / 待办（PENDING）。"""
    try:
        return await supervisor.create_task(
            payload.goal,
            payload.source,
            kind=payload.kind,
            title=payload.title,
            due_at=payload.due_at,
            priority=payload.priority,
        )
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


@app.get("/api/v1/tasks")
async def list_tasks() -> list[dict]:
    """任务列表。"""
    return await supervisor.list()


@app.patch("/api/v1/tasks/{task_id}")
async def update_task(task_id: str, payload: TaskUpdate) -> dict:
    """修改任务（标题 / 截止 / 优先级 / 目标）。"""
    try:
        return await supervisor.update_task(
            task_id,
            goal=payload.goal,
            title=payload.title,
            due_at=payload.due_at,
            priority=payload.priority,
        )
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


@app.post("/api/v1/tasks/{task_id}/assign")
async def assign_task(task_id: str, payload: AssignRequest) -> dict:
    """派给智能体员工。"""
    try:
        return await supervisor.assign_task(task_id, payload.agent_id)
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


@app.post("/api/v1/tasks/{task_id}/complete")
async def complete_task(task_id: str) -> dict:
    """标记完成。"""
    try:
        return await supervisor.complete_task(task_id)
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


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


@app.post("/api/v1/agents")
async def hire_agent(payload: AgentCreate) -> dict:
    """雇佣智能体员工。"""
    try:
        return await agent_manager.hire(
            payload.name,
            role=payload.role,
            soul=payload.soul,
            model=payload.model,
            tool_whitelist=payload.tool_whitelist,
            schedule_json=payload.schedule_json,
        )
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


@app.get("/api/v1/agents")
async def list_agents() -> list[dict]:
    """智能体员工列表。"""
    return await agent_manager.list()


@app.get("/api/v1/agents/{agent_id}")
async def get_agent(agent_id: str) -> dict:
    """员工详情。"""
    try:
        return await agent_manager.get(agent_id)
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


@app.patch("/api/v1/agents/{agent_id}")
async def update_agent(agent_id: str, payload: AgentUpdate) -> dict:
    """修改员工配置。"""
    try:
        return await agent_manager.update(
            agent_id,
            name=payload.name,
            role=payload.role,
            soul=payload.soul,
            model=payload.model,
            tool_whitelist=payload.tool_whitelist,
            schedule_json=payload.schedule_json,
        )
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


@app.post("/api/v1/agents/{agent_id}/activate")
async def activate_agent(agent_id: str) -> dict:
    """员工上班。"""
    try:
        return await agent_manager.set_status(agent_id, "on_duty")
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


@app.post("/api/v1/agents/{agent_id}/deactivate")
async def deactivate_agent(agent_id: str) -> dict:
    """员工下班。"""
    try:
        return await agent_manager.set_status(agent_id, "off_duty")
    except Exception as exc:  # noqa: BLE001
        raise _http_error(exc) from exc


@app.post("/api/v1/agents/{agent_id}/chat")
async def chat_agent(agent_id: str, payload: ChatRequest) -> dict:
    """直接对话：员工基于人设回答。"""
    try:
        return await agent_manager.chat(agent_id, payload.message)
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
