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
