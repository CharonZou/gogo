"""智能体员工管理：雇佣 / 列表 / 修改 / 上下班 / 直接对话。

员工 = 配置化的 AI 同事：姓名 + 岗位 + SOUL 人设 + 模型 + 工具白名单 + 技能白名单 + 上班时间。
可选注入知识库检索（kb_manager 非空时，回答前先检索相关资料）。
"""

from __future__ import annotations

import asyncio
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
        skills_manager=None,
        supervisor=None,
    ) -> None:
        self.db_path = db_path or db.get_db_path()
        self.llm = llm or LLMClient()
        self.kb_manager = kb_manager
        self.skills_manager = skills_manager
        self.supervisor = supervisor

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
        skill_whitelist: list[str] | None = None,
        auto_work: bool = False,
    ) -> dict:
        """雇佣智能体员工（初始 off_duty）。auto_work=True 时到点值班自动上班。"""
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
            skill_whitelist or [],
            auto_work=auto_work,
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

    # ---------- 值班（P3.1） ----------

    async def duty_shift(self, agent_id: str) -> dict:
        """值班一轮：自动上班 → 自动接单（名下待办/已规划任务）→ 写工作汇报。

        汇报为纯事实记录（不调 LLM）：处理几件、各任务当前状态。
        """
        agent = await self.get(agent_id)
        if agent["status"] != "on_duty":
            await db.set_agent_status(self.db_path, agent_id, "on_duty")

        pending = await db.list_agent_tasks(
            self.db_path, agent_id, ["PENDING", "PLANNED"]
        )
        for task in pending:
            try:
                if self.supervisor is None:
                    break
                if task["status"] == "PENDING":
                    await self.supervisor.plan(task["id"])
                await self.supervisor.approve(task["id"])
                asyncio.create_task(self.supervisor.run(task["id"]))
            except Exception:  # noqa: S110 BLE001 - 单任务失败不影响本轮其余任务
                pass

        report = await self._write_report(agent, pending)
        return {
            "agent_id": agent_id,
            "name": agent["name"],
            "status": "on_duty",
            "picked": len(pending),
            "report_task_id": report["task_id"],
        }

    async def _write_report(self, agent: dict, tasks: list[dict]) -> dict:
        """生成工作汇报（kind=report）进任务中心，标记完成。"""
        from datetime import UTC, datetime

        ts = datetime.now(UTC).strftime("%Y-%m-%d %H:%M")
        if tasks:
            lines = "\n".join(
                f"- {t['goal'] or t.get('title') or t['id']}（状态：{t['status']}）"
                for t in tasks
            )
            body = f"值班轮次 {ts}：接单 {len(tasks)} 件，已授权执行：\n{lines}"
        else:
            body = f"值班轮次 {ts}：名下无待处理任务。"
        task_id = uuid.uuid4().hex[:12]
        await db.insert_task(
            self.db_path,
            task_id,
            body,
            "duty",
            kind="report",
            title="",
            assignee_id=agent["id"],
        )
        await db.complete_task(self.db_path, task_id)
        return {"task_id": task_id}

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

        capabilities = await self._capabilities(agent)
        if capabilities:
            system += "\n\n你当前可用的能力：\n" + capabilities

        reply = await self.llm.chat_text(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": message.strip()},
            ]
        )
        return {"agent_id": agent_id, "name": agent["name"], "reply": reply}

    async def _capabilities(self, agent: dict) -> str:
        """员工能力注入：工具白名单（含 MCP 工具）+ 技能说明。"""
        parts: list[str] = []
        whitelist = agent.get("tool_whitelist") or []
        if whitelist:
            parts.append(
                "工具（仅限以下白名单，未列出的工具不得使用）：\n"
                + "\n".join(f"- {name}" for name in whitelist)
            )
        if self.skills_manager is not None:
            skill_notes = await self.skills_manager.enabled_instructions(
                agent.get("skill_whitelist") or []
            )
            if skill_notes:
                parts.append("技能：\n" + "\n".join(f"- {note}" for note in skill_notes))
        return "\n\n".join(parts)

    async def _kb_hits(self, message: str, k: int | None = None) -> list[dict]:
        """知识库检索（失败不阻断对话）。"""
        try:
            return await self.kb_manager.search(
                message, k=k or get_settings().kb_search_top_k
            )
        except Exception:  # noqa: BLE001  # 检索失败降级为纯人设回答
            return []
