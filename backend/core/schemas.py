"""API 请求/响应模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    goal: str | None = Field(default=None, description="用户目标（task/report 必填）")
    source: str = Field(default="rpc", description="来源：rpc / im / cli / schedule")
    kind: str = Field(default="task", pattern="^(todo|task|report)$", description="任务类型")
    title: str | None = Field(default=None, description="待办标题（kind=todo 必填）")
    due_at: str | None = Field(default=None, description="截止时间（ISO 字符串）")
    priority: str = Field(default="medium", pattern="^(low|medium|high)$", description="优先级")


class TaskUpdate(BaseModel):
    goal: str | None = None
    title: str | None = None
    due_at: str | None = None
    priority: str | None = Field(default=None, pattern="^(low|medium|high)$")


class AssignRequest(BaseModel):
    agent_id: str = Field(..., description="智能体员工 id")


class AgentCreate(BaseModel):
    name: str = Field(..., description="员工姓名")
    role: str = Field(default="", description="岗位（如：周报专员）")
    soul: str = Field(default="", description="SOUL 人设（prompt 种子）")
    model: str | None = Field(default=None, description="模型，缺省用全局配置")
    tool_whitelist: list[str] = Field(default_factory=list, description="工具白名单")
    schedule_json: dict = Field(default_factory=dict, description="上班时间配置")


class AgentUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    soul: str | None = None
    model: str | None = None
    tool_whitelist: list[str] | None = None
    schedule_json: dict | None = None


class ChatRequest(BaseModel):
    message: str = Field(..., description="发给员工的消息")


class AssistantMessage(BaseModel):
    message: str = Field(..., description="自然语言指令，如「帮我记一条待办」")


class WorkflowStep(BaseModel):
    id: str = Field(..., description="步骤唯一标识（模板内全局唯一）")
    title: str = Field(..., description="步骤标题")
    description: str = Field(default="", description="步骤说明、产出物")
    depends_on: list[str] = Field(default_factory=list, description="依赖的步骤 id（须已存在，不得成环）")
    acceptance: str = Field(default="", description="验收标准")
    tool: str = Field(default="noop", description="执行工具（默认 noop 直接成功）")
    tool_args: dict = Field(default_factory=dict, description="工具参数")


class WorkflowCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="工作流名称")
    description: str = Field(default="", description="工作流说明")
    steps: list[WorkflowStep] = Field(..., min_length=1, description="步骤列表（DAG）")


class WorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    steps: list[WorkflowStep] | None = Field(default=None, min_length=1)
    status: str | None = Field(default=None, pattern="^(draft|active|archived)$")


class KBImportRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200, description="文档标题（content 模式必填；path 模式缺省取文件名）")
    content: str | None = Field(default=None, description="文档纯文本内容（与 path 二选一）")
    path: str | None = Field(default=None, description="本地 .md/.txt 文件路径（与 content 二选一）")


class KBSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, description="检索词 / 问题")
    k: int = Field(default=5, ge=1, le=50, description="返回分块数")
    mode: str = Field(default="hybrid", pattern="^(keyword|vector|hybrid)$")
