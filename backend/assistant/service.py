"""小秘书小R：自然语言 → 意图路由 → 调模块 API 创建内容。

当前支持意图：create_todo（记待办）、hire_agent（雇佣智能体员工）。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from backend.agents.manager import AgentManager
from backend.llm.client import LLMClient
from backend.orchestration.supervisor import Supervisor

Classifier = Callable[[str], Awaitable[dict]]

CLASSIFIER_SYSTEM = """你是 RocheFlow 小秘书「小R」的意图解析器。用户用大白话提出需求，你判断意图并抽取参数。

只支持以下意图：
1. create_todo：用户想记一条待办 / 提醒 / 待办事项（如「帮我记一条待办：买牛奶」「提醒我明天交周报」）。
   params：title（必填，待办内容）、due_at（可选，ISO 日期，如 2026-09-10）、priority（可选：low/medium/high）。
2. hire_agent：用户想雇佣 / 招聘 / 养一个智能体员工（如「雇佣一个智能体员工小周，负责周报」）。
   params：name（必填，员工名字）、role（可选，岗位）、soul（可选，人设）。
3. unknown：以上都不属于。

只输出 JSON：{"intent": "...", "params": {...}, "reason": "一句话说明"}"""


class AssistantService:
    def __init__(
        self,
        supervisor: Supervisor,
        agent_manager: AgentManager,
        llm: LLMClient | None = None,
        classifier: Classifier | None = None,
    ) -> None:
        self.supervisor = supervisor
        self.agent_manager = agent_manager
        self.llm = llm or LLMClient()
        self.classifier = classifier or _default_classifier(self.llm)

    async def handle(self, message: str) -> dict:
        """处理一条自然语言指令，返回回执（含创建结果与页面位置）。"""
        if not message or not message.strip():
            raise ValueError("消息不能为空")
        parsed = await self.classifier(message.strip())
        intent = parsed.get("intent")
        params = parsed.get("params")
        if not isinstance(params, dict):
            params = {}

        if intent == "unknown":
            return {
                "message": "暂时我只能帮你记待办或雇佣员工。试试说「帮我记一条待办：买牛奶」或「雇佣一个智能体员工小周，负责周报」。",
                "created": None,
            }

        handler = _HANDLERS.get(intent)
        if handler is None:
            raise ValueError(f"暂不支持该意图：{intent}")
        return await handler(self, params)

    # ---------- 意图处理 ----------

    async def _handle_create_todo(self, params: dict) -> dict:
        title = params.get("title")
        if not title:
            raise ValueError("没听清待办内容，请再说一次，例如「帮我记一条待办：买牛奶」")
        due_at = params.get("due_at") or None
        priority = params.get("priority") or "medium"
        created = await self.supervisor.create_task(
            kind="todo", title=title, due_at=due_at, priority=priority
        )
        return {
            "message": f"已帮你记好待办：{title}",
            "created": {
                "module": "task",
                "id": created["task_id"],
                "page": f"/tasks/{created['task_id']}",
            },
            "data": created,
        }

    async def _handle_hire_agent(self, params: dict) -> dict:
        name = params.get("name")
        if not name:
            raise ValueError("没听清员工名字，例如「雇佣一个智能体员工小周，负责周报」")
        role = params.get("role") or ""
        soul = params.get("soul") or ""
        agent = await self.agent_manager.hire(name, role=role, soul=soul)
        return {
            "message": f"已雇佣智能体员工「{name}」，可在智能体页面查看（默认下班状态，可先激活）",
            "created": {
                "module": "agent",
                "id": agent["id"],
                "page": f"/agents/{agent['id']}",
            },
            "data": agent,
        }


_HANDLERS: dict[str, Callable[[AssistantService, dict], Awaitable[dict]]] = {
    "create_todo": AssistantService._handle_create_todo,
    "hire_agent": AssistantService._handle_hire_agent,
}


def _default_classifier(llm: LLMClient) -> Classifier:
    """默认分类器：LLM 网关（JSON 输出，闭包）。"""

    async def _classify(message: str) -> dict:
        raw = await llm.chat_json(
            [
                {"role": "system", "content": CLASSIFIER_SYSTEM},
                {"role": "user", "content": message},
            ],
            temperature=0.1,
            max_tokens=512,
        )
        intent = raw.get("intent")
        if intent not in (*_HANDLERS.keys(), "unknown"):
            raise ValueError(f"小秘书无法识别意图：{intent}")
        params = raw.get("params") or {}
        if not isinstance(params, dict):
            raise TypeError("小秘书返回的参数格式不正确")
        return {"intent": intent, "params": params, "reason": raw.get("reason", "")}

    return _classify
