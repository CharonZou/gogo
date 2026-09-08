"""API 请求/响应模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    goal: str = Field(..., description="用户目标（自然语言）")
    source: str = Field(default="rpc", description="来源：rpc / im / cli / schedule")
