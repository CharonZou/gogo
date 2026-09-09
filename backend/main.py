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

from backend.agents.duty import DutyScheduler
from backend.agents.manager import AgentManager
from backend.apps.manager import AppManager
from backend.assistant.service import AssistantService
from backend.automations.manager import AutomationManager
from backend.core import db
from backend.core.config import get_settings
from backend.core.events import hub
from backend.core.schemas import (
    AgentCreate,
    AgentUpdate,
    AppCreate,
    AppRunRequest,
    AppUpdate,
    AssignRequest,
    AssistantMessage,
    AutomationCreate,
    AutomationUpdate,
    ChatRequest,
    KBImportRequest,
    KBSearchRequest,
    MCPEnableRequest,
    MCPServerUpsert,
    ResumeRequest,
    SkillEnableRequest,
    SkillUpsert,
    TaskCreate,
    TaskUpdate,
    WorkflowCreate,
    WorkflowUpdate,
)
from backend.kb.manager import KBManager
from backend.llm.client import LLMNotConfiguredError
from backend.mcp.manager import MCPManager
from backend.orchestration.supervisor import Supervisor
from backend.scheduler.scheduler import AutomationScheduler
from backend.skills.manager import SkillManager
from backend.workflows.manager import WorkflowManager

settings = get_settings()
supervisor = Supervisor()
kb_manager = KBManager()
skill_manager = SkillManager()
agent_manager = AgentManager(
    kb_manager=kb_manager, skills_manager=skill_manager, supervisor=supervisor
)
workflow_manager = WorkflowManager()
app_manager = AppManager()
automation_manager = AutomationManager(supervisor=supervisor)
automation_scheduler = AutomationScheduler(automation_manager)
duty_scheduler = DutyScheduler(agent_manager)
mcp_manager = MCPManager(executor=supervisor.tools)
assistant = AssistantService(supervisor, agent_manager)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init_db()
    # 技能扫描（目录存在才注册）
    await skill_manager.scan(
        settings.skills_public_dir, settings.skills_custom_dir
    )
    # MCP：连接全部 enabled 服务器（失败不阻断启动）
    if settings.mcp_enabled:
        await mcp_manager.load_enabled()
    if settings.automation_scheduler_enabled:
        automation_scheduler.start()
    if settings.duty_scheduler_enabled:
        duty_scheduler.start()
    yield
    await automation_scheduler.stop()
    await duty_scheduler.stop()
    await mcp_manager.shutdown()


app = FastAPI(
    title="RocheFlow Agent Engine",
    version="0.5.0",
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
    return {"status": "ok", "service": "rocheflow", "version": "0.5.0"}


@app.post("/api/v1/assistant/message")
async def assistant_message(payload: AssistantMessage) -> dict:
    """小秘书小R：自然语言 → 意图路由 → 创建内容。"""
    try:
        return await assistant.handle(payload.message)
    except Exception as exc:
        raise _http_error(exc) from exc


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
    except Exception as exc:
        raise _http_error(exc) from exc


@app.get("/api/v1/tasks")
async def list_tasks(
    limit: int = 50,
    kind: str | None = None,
    status: str | None = None,
    assignee_id: str | None = None,
    source: str | None = None,
) -> list[dict]:
    """任务列表（可按类型 / 状态 / 指派员工 / 来源过滤）。"""
    try:
        return await supervisor.list(
            limit=min(max(limit, 1), 200),
            kind=kind,
            status=status,
            assignee_id=assignee_id,
            source=source,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


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
    except Exception as exc:
        raise _http_error(exc) from exc


@app.delete("/api/v1/tasks/{task_id}")
async def delete_task(task_id: str) -> dict:
    """删除任务及其子任务（不可恢复）。"""
    try:
        return await supervisor.delete_task(task_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/tasks/{task_id}/cancel")
async def cancel_task(task_id: str) -> dict:
    """取消任务：未执行直接置 CANCELLED；执行中置取消标记，引擎下一轮停止。"""
    try:
        return await supervisor.cancel_task(task_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/tasks/{task_id}/rerun")
async def rerun_task(task_id: str) -> dict:
    """再跑一次：复用已绑定计划重建子任务并后台执行（无需重新规划）。"""
    try:
        return await supervisor.rerun_task(task_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/tasks/{task_id}/resume")
async def resume_task(task_id: str, payload: ResumeRequest) -> dict:
    """继续审批门挂起的任务：approve=true 放行，false 拒绝该子任务。"""
    try:
        result = await supervisor.resume(
            task_id, {"approve": payload.approve}, stream_callback=hub.stream_callback(task_id)
        )
    except Exception as exc:
        raise _http_error(exc) from exc
    if result["status"] == "INTERRUPTED":
        # 仍有下一个审批门：继续挂起，等下一轮 resume
        pass
    return result


@app.post("/api/v1/tasks/{task_id}/assign")
async def assign_task(task_id: str, payload: AssignRequest) -> dict:
    """派给智能体员工。"""
    try:
        return await supervisor.assign_task(task_id, payload.agent_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/tasks/{task_id}/complete")
async def complete_task(task_id: str) -> dict:
    """标记完成。"""
    try:
        return await supervisor.complete_task(task_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/tasks/{task_id}/plan")
async def plan_task(task_id: str) -> dict:
    """规划：LLM 拆解目标为子任务 DAG 并落库（PLANNED）。"""
    try:
        return await supervisor.plan(task_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/tasks/{task_id}/approve")
async def approve_task(task_id: str) -> dict:
    """授权执行：后台运行计划 DAG（进度经 WebSocket 流式推送）。"""
    try:
        result = await supervisor.approve(task_id)
    except Exception as exc:
        raise _http_error(exc) from exc
    asyncio.create_task(
        supervisor.run(task_id, stream_callback=hub.stream_callback(task_id))
    )
    return result


@app.websocket("/ws/tasks/{task_id}")
async def task_events_ws(websocket: WebSocket, task_id: str) -> None:
    """任务执行流式事件：订阅 /ws/tasks/{id} 即可实时收节点进度与终态。"""
    await websocket.accept()
    q = await hub.subscribe(task_id)
    try:
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=20)
                await websocket.send_json(event)
            except TimeoutError:
                # 心跳保活：20s 无事件发 ping，客户端可据此判断连接存活
                await websocket.send_json({"task_id": task_id, "type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        await hub.unsubscribe(task_id, q)


@app.get("/api/v1/tasks/{task_id}")
async def task_status(task_id: str) -> dict:
    """任务状态 + 子任务明细。"""
    try:
        return await supervisor.status(task_id)
    except Exception as exc:
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
            skill_whitelist=payload.skill_whitelist,
            auto_work=payload.auto_work,
        )
    except Exception as exc:
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
    except Exception as exc:
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
            skill_whitelist=payload.skill_whitelist,
            auto_work=payload.auto_work,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/agents/{agent_id}/activate")
async def activate_agent(agent_id: str) -> dict:
    """员工上班。"""
    try:
        return await agent_manager.set_status(agent_id, "on_duty")
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/agents/{agent_id}/deactivate")
async def deactivate_agent(agent_id: str) -> dict:
    """员工下班。"""
    try:
        return await agent_manager.set_status(agent_id, "off_duty")
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/agents/{agent_id}/duty")
async def duty_agent(agent_id: str) -> dict:
    """手动值班一轮：自动上班 → 自动接单 → 写工作汇报。"""
    try:
        return await agent_manager.duty_shift(agent_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/agents/{agent_id}/chat")
async def chat_agent(agent_id: str, payload: ChatRequest) -> dict:
    """直接对话：员工基于人设回答。"""
    try:
        return await agent_manager.chat(agent_id, payload.message)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.get("/api/v1/workflows")
async def list_workflows() -> list[dict]:
    """工作流模板列表。"""
    return await workflow_manager.list()


@app.post("/api/v1/workflows")
async def create_workflow(payload: WorkflowCreate) -> dict:
    """创建工作流模板：步骤 DAG 校验后落库（draft）。"""
    try:
        return await workflow_manager.create(
            payload.name,
            payload.description,
            [s.model_dump() for s in payload.steps],
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@app.get("/api/v1/workflows/{workflow_id}")
async def get_workflow(workflow_id: str) -> dict:
    """工作流模板详情。"""
    try:
        return await workflow_manager.get(workflow_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.patch("/api/v1/workflows/{workflow_id}")
async def update_workflow(workflow_id: str, payload: WorkflowUpdate) -> dict:
    """更新模板（名称 / 说明 / 步骤 / 状态）。"""
    try:
        return await workflow_manager.update(
            workflow_id,
            name=payload.name,
            description=payload.description,
            steps=[s.model_dump() for s in payload.steps] if payload.steps else None,
            status=payload.status,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@app.delete("/api/v1/workflows/{workflow_id}")
async def delete_workflow(workflow_id: str) -> dict:
    """删除模板。"""
    try:
        return await workflow_manager.delete(workflow_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/workflows/{workflow_id}/run")
async def run_workflow(workflow_id: str) -> dict:
    """实例化：创建任务 + 步骤落库（PLANNED），随后可 approve 执行。"""
    try:
        return await workflow_manager.run(workflow_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/kb/import")
async def kb_import(payload: KBImportRequest) -> dict:
    """知识库导入：content 或本地文件路径 → 分块 + 嵌入 + 落库。"""
    try:
        if payload.content is not None:
            if not payload.title:
                raise ValueError("content 模式必须提供 title")
            return await kb_manager.import_text(payload.title, payload.content)
        if payload.path:
            return await kb_manager.import_file(payload.path, title=payload.title)
        raise ValueError("content 与 path 至少提供一个")
    except Exception as exc:
        raise _http_error(exc) from exc


@app.get("/api/v1/kb/docs")
async def kb_list_docs() -> list[dict]:
    """知识文档列表（含分块数）。"""
    return await kb_manager.list()


@app.get("/api/v1/kb/docs/{doc_id}")
async def kb_get_doc(doc_id: str) -> dict:
    """文档详情 + 分块明细。"""
    try:
        return {"doc": await kb_manager.get(doc_id), "chunks": await kb_manager.chunks(doc_id)}
    except Exception as exc:
        raise _http_error(exc) from exc


@app.delete("/api/v1/kb/docs/{doc_id}")
async def kb_delete_doc(doc_id: str) -> dict:
    """删除文档及其分块。"""
    try:
        return await kb_manager.delete(doc_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/kb/search")
async def kb_search(payload: KBSearchRequest) -> list[dict]:
    """知识库检索：keyword / vector / hybrid。"""
    try:
        return await kb_manager.search(payload.query, k=payload.k, mode=payload.mode)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/automations")
async def create_automation(payload: AutomationCreate) -> dict:
    """创建自动化任务（cron 到点 / once 一次性）。"""
    try:
        return await automation_manager.create(
            payload.name,
            payload.prompt,
            payload.schedule,
            trigger_type=payload.trigger_type,
            thread_mode=payload.thread_mode,
            max_duration_minutes=payload.max_duration_minutes,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@app.get("/api/v1/automations")
async def list_automations() -> list[dict]:
    """自动化任务列表。"""
    return await automation_manager.list()


@app.get("/api/v1/automations/scheduler/status")
async def automation_scheduler_status() -> dict:
    """调度器状态（必须声明在 /{id} 之前）。"""
    return {
        "enabled": settings.automation_scheduler_enabled,
        "running": automation_scheduler.running,
        "active_count": automation_scheduler.active_count,
        "tick_seconds": settings.automation_tick_seconds,
        "max_concurrent": settings.automation_max_concurrent,
    }


@app.get("/api/v1/automations/{automation_id}")
async def get_automation(automation_id: str) -> dict:
    """自动化任务详情。"""
    try:
        return await automation_manager.get(automation_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.patch("/api/v1/automations/{automation_id}")
async def update_automation(automation_id: str, payload: AutomationUpdate) -> dict:
    """修改自动化（名称 / Prompt / 调度 / 状态）。"""
    try:
        return await automation_manager.update(
            automation_id,
            name=payload.name,
            prompt=payload.prompt,
            schedule=payload.schedule,
            status=payload.status,
            thread_mode=payload.thread_mode,
            max_duration_minutes=payload.max_duration_minutes,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@app.delete("/api/v1/automations/{automation_id}")
async def delete_automation(automation_id: str) -> dict:
    """删除自动化及其执行历史。"""
    try:
        return await automation_manager.delete(automation_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/automations/{automation_id}/trigger")
async def trigger_automation(automation_id: str) -> dict:
    """手动触发一次（不改调度）。"""
    try:
        return await automation_manager.trigger(automation_id, manual=True)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.get("/api/v1/automations/{automation_id}/runs")
async def automation_runs(automation_id: str) -> list[dict]:
    """执行历史。"""
    try:
        return await automation_manager.runs(automation_id)
    except Exception as exc:
        raise _http_error(exc) from exc


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


# ---------- 应用中心 ----------


@app.get("/api/v1/apps")
async def list_apps() -> list[dict]:
    """应用列表。"""
    return await app_manager.list()


@app.post("/api/v1/apps")
async def create_app(payload: AppCreate) -> dict:
    """创建应用（草稿）。"""
    try:
        return await app_manager.create(
            payload.name,
            [s.model_dump() for s in payload.steps],
            description=payload.description,
            goal=payload.goal,
            params=[p.model_dump() for p in payload.params],
            execution_mode=payload.execution_mode,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@app.get("/api/v1/apps/{app_id}")
async def get_app(app_id: str) -> dict:
    """应用详情。"""
    try:
        return await app_manager.get(app_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.patch("/api/v1/apps/{app_id}")
async def update_app(app_id: str, payload: AppUpdate) -> dict:
    """更新应用（名称/描述/目标/步骤/参数/执行方式/状态）。"""
    try:
        return await app_manager.update(
            app_id,
            name=payload.name,
            description=payload.description,
            goal=payload.goal,
            steps=[s.model_dump() for s in payload.steps] if payload.steps else None,
            params=[p.model_dump() for p in payload.params] if payload.params is not None else None,
            execution_mode=payload.execution_mode,
            status=payload.status,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@app.delete("/api/v1/apps/{app_id}")
async def delete_app(app_id: str) -> dict:
    """删除应用（含运行历史级联）。"""
    try:
        return await app_manager.delete(app_id)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/apps/{app_id}/run")
async def run_app(app_id: str, payload: AppRunRequest) -> dict:
    """填参运行（须已发布）：实例化任务，走 approve → 执行闭环。"""
    try:
        return await app_manager.run(app_id, payload.params)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.get("/api/v1/apps/{app_id}/runs")
async def app_runs(app_id: str) -> list[dict]:
    """应用运行历史。"""
    try:
        return await app_manager.runs(app_id)
    except Exception as exc:
        raise _http_error(exc) from exc


# ---------- MCP ----------


@app.get("/api/v1/mcp/servers")
async def list_mcp_servers() -> list[dict]:
    """已配置的 MCP 服务器（含连接状态与工具数）。"""
    return await mcp_manager.list()


@app.put("/api/v1/mcp/servers")
async def upsert_mcp_server(payload: MCPServerUpsert) -> dict:
    """新增 / 覆盖 MCP 服务器配置（写库后热重载）。"""
    try:
        return await mcp_manager.upsert(
            payload.name,
            payload.type,
            payload.config,
            enabled=payload.enabled,
            description=payload.description,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@app.patch("/api/v1/mcp/servers/{name}/enabled")
async def set_mcp_enabled(name: str, payload: MCPEnableRequest) -> dict:
    """启用 / 禁用 MCP（禁用立即断开并注销工具）。"""
    try:
        return await mcp_manager.set_enabled(name, payload.enabled)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.delete("/api/v1/mcp/servers/{name}")
async def delete_mcp_server(name: str) -> dict:
    """删除 MCP 服务器。"""
    try:
        return await mcp_manager.delete(name)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.post("/api/v1/mcp/reload")
async def reload_mcp() -> dict:
    """热重载全部 enabled 服务器。"""
    failed = await mcp_manager.load_enabled()
    return {"reloaded": True, "failed": failed}


# ---------- 技能 ----------


@app.get("/api/v1/skills")
async def list_skills() -> list[dict]:
    """已注册技能列表。"""
    return await skill_manager.list()


@app.post("/api/v1/skills/scan")
async def scan_skills() -> list[dict]:
    """重新扫描技能目录（public + custom），upsert 注册。"""
    return await skill_manager.scan(
        settings.skills_public_dir, settings.skills_custom_dir
    )


@app.post("/api/v1/skills")
async def upsert_skill(payload: SkillUpsert) -> dict:
    """手动注册 / 更新技能。"""
    try:
        return await skill_manager.upsert(
            payload.name,
            payload.description,
            payload.instructions,
            source=payload.source,
            enabled=payload.enabled,
        )
    except Exception as exc:
        raise _http_error(exc) from exc


@app.patch("/api/v1/skills/{name}/enabled")
async def set_skill_enabled(name: str, payload: SkillEnableRequest) -> dict:
    """启用 / 禁用技能。"""
    try:
        return await skill_manager.set_enabled(name, payload.enabled)
    except Exception as exc:
        raise _http_error(exc) from exc


@app.delete("/api/v1/skills/{name}")
async def delete_skill(name: str) -> dict:
    """删除自定义技能（内置 public 技能不可删）。"""
    try:
        return await skill_manager.delete(name)
    except Exception as exc:
        raise _http_error(exc) from exc
