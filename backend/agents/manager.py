"""智能体员工管理：雇佣 / 列表 / 修改 / 上下班 / 直接对话。

员工 = 配置化的 AI 同事：姓名 + 岗位 + SOUL 人设 + 模型 + 工具白名单 + 上班时间。
可选注入知识库检索（kb_manager 非空时，回答前先检索相关资料）。
"""

from __future__ import annotations

import uuid

from backend.core import db
from backend.core.config import get_settings
from backend.llm.client import LLMClient


class AgentManager:
    def __init__(
        self,
        db_path: str | None = None,
        llm: LLMClient | None = None,
        kb_manager=None,
    ) -> None:
        self.db_path = db_path or db.get_db_path()
        self.llm = llm or LLMClient()
        self.kb_manager = kb_manager

    async def _ensure_db(self) -> None:
        await db.ensure_initialized(self.db_path)

    # ---------- 雇佣与档案 ----------

    async def hire(
        self,
        name: str,
        role: str = "",
        soul: str = "",
        model: str | None = None,
        tool_whitelist: list[str] | None = None,
        schedule_json: dict | None = None,
    ) -> dict:
        """雇佣智能体员工（初始 off_duty）。"""
        if not name or not name.strip():
            raise ValueError("员工姓名不能为空")
        await self._ensure_db()
        agent_id = uuid.uuid4().hex[:12]
        await db.insert_agent(
            self.db_path,
            agent_id,
            name.strip(),
            role,
            soul,
            model or get_settings().llm_model,
            tool_whitelist or [],
            schedule_json or {},
        )
        return await self.get(agent_id)

    async def list(self) -> list[dict]:
        await self._ensure_db()
        return await db.list_agents(self.db_path)

    async def get(self, agent_id: str) -> dict:
        await self._ensure_db()
        agent = await db.get_agent(self.db_path, agent_id)
        if agent is None:
            raise KeyError(f"智能体员工不存在：{agent_id}")
        return agent

    async def update(self, agent_id: str, **fields: object) -> dict:
        """修改员工配置（只更新传入字段）。"""
        await self.get(agent_id)
        await db.update_agent(self.db_path, agent_id, **fields)
        return await self.get(agent_id)

    async def set_status(self, agent_id: str, status: str) -> dict:
        """上班 / 下班。"""
        if status not in ("on_duty", "off_duty"):
            raise ValueError(f"非法状态：{status}")
        await self.get(agent_id)
        await db.set_agent_status(self.db_path, agent_id, status)
        return await self.get(agent_id)

    # ---------- 对话 ----------

    async def chat(self, agent_id: str, message: str) -> dict:
        """直接对话：员工基于人设回答；已注入知识库时先检索相关资料。"""
        if not message or not message.strip():
            raise ValueError("消息不能为空")
        agent = await self.get(agent_id)

        system = f"你是智能体员工「{agent['name']}」"
        if agent["role"]:
            system += f"（岗位：{agent['role']}）"
        if agent["soul"]:
            system += f"\n人设：{agent['soul']}"
        system += "\n请用中文简洁、友好地回应用户。"

        if self.kb_manager is not None:
            hits = await self._kb_hits(message)
            if hits:
                ctx = "\n\n".join(f"[{h['doc_title']}] {h['content']}" for h in hits)
                system += (
                    "\n\n以下是从知识库检索到的相关资料，回答时请优先基于这些材料，"
                    "并注明出处：\n" + ctx
                )

        reply = await self.llm.chat_text(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": message.strip()},
            ]
        )
        return {"agent_id": agent_id, "name": agent["name"], "reply": reply}

    async def _kb_hits(self, message: str, k: int | None = None) -> list[dict]:
        """知识库检索（失败不阻断对话）。"""
        try:
            return await self.kb_manager.search(
                message, k=k or get_settings().kb_search_top_k
            )
        except Exception:  # noqa: BLE001  # 检索失败降级为纯人设回答
            return []
