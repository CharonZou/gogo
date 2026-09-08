"""P1.2 智能体员工测试：雇佣 / 上下班 / 修改 / 对话（fake LLM，不烧余额）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.agents.manager import AgentManager
from backend.main import app


class FakeLLM:
    """替身 LLM：记录消息并返回固定回复。"""

    def __init__(self, reply: str = "好的，收到！") -> None:
        self.reply = reply
        self.last_messages: list[dict] | None = None

    async def chat_text(self, messages: list[dict], **kwargs) -> str:
        self.last_messages = messages
        return self.reply


@pytest.fixture
def mgr(tmp_path) -> AgentManager:
    return AgentManager(db_path=str(tmp_path / "a.db"), llm=FakeLLM())


# ---------- 雇佣 / 档案 ----------

async def test_hire_defaults(mgr: AgentManager) -> None:
    agent = await mgr.hire("小周")
    assert agent["name"] == "小周"
    assert agent["role"] == ""
    assert agent["status"] == "off_duty"
    assert agent["tool_whitelist"] == []
    assert agent["schedule_json"] == {}
    assert agent["model"]  # 缺省用全局配置


async def test_hire_full_fields(mgr: AgentManager) -> None:
    agent = await mgr.hire(
        "小周",
        role="周报专员",
        soul="细心负责",
        tool_whitelist=["bash", "read_file"],
        schedule_json={"on": "09:00", "off": "18:00"},
    )
    assert agent["tool_whitelist"] == ["bash", "read_file"]
    assert agent["schedule_json"]["on"] == "09:00"


async def test_hire_empty_name_rejected(mgr: AgentManager) -> None:
    with pytest.raises(ValueError, match="姓名"):
        await mgr.hire("   ")


async def test_get_missing_agent(mgr: AgentManager) -> None:
    with pytest.raises(KeyError, match="员工"):
        await mgr.get("nope")


async def test_update_agent(mgr: AgentManager) -> None:
    agent = await mgr.hire("小周")
    updated = await mgr.update(agent["id"], role="测试工程师", soul="严谨")
    assert updated["role"] == "测试工程师"
    assert updated["soul"] == "严谨"
    assert updated["name"] == "小周"  # 未改字段保持


# ---------- 上下班 ----------

async def test_status_switch(mgr: AgentManager) -> None:
    agent = await mgr.hire("小周")
    assert (await mgr.set_status(agent["id"], "on_duty"))["status"] == "on_duty"
    assert (await mgr.set_status(agent["id"], "off_duty"))["status"] == "off_duty"


async def test_status_rejects_unknown(mgr: AgentManager) -> None:
    agent = await mgr.hire("小周")
    with pytest.raises(ValueError, match="状态"):
        await mgr.set_status(agent["id"], "vacation")


# ---------- 对话 ----------

async def test_chat_uses_soul_persona(tmp_path) -> None:
    llm = FakeLLM(reply="已完成，请查收。")
    mgr = AgentManager(db_path=str(tmp_path / "a.db"), llm=llm)
    agent = await mgr.hire("小周", role="周报专员", soul="认真细致")
    out = await mgr.chat(agent["id"], "本周汇报")
    assert out["reply"] == "已完成，请查收。"
    system = llm.last_messages[0]["content"]
    assert "小周" in system
    assert "周报专员" in system
    assert "认真细致" in system


async def test_chat_empty_message_rejected(mgr: AgentManager) -> None:
    agent = await mgr.hire("小周")
    with pytest.raises(ValueError, match="消息"):
        await mgr.chat(agent["id"], "  ")


# ---------- API 层 ----------

def test_api_hire_activate_deactivate() -> None:
    with TestClient(app) as client:
        resp = client.post("/api/v1/agents", json={"name": "小周", "role": "周报专员"})
        assert resp.status_code == 200
        agent = resp.json()
        assert agent["status"] == "off_duty"

        on = client.post(f"/api/v1/agents/{agent['id']}/activate")
        assert on.status_code == 200
        assert on.json()["status"] == "on_duty"

        off = client.post(f"/api/v1/agents/{agent['id']}/deactivate")
        assert off.json()["status"] == "off_duty"


def test_api_agent_not_found() -> None:
    with TestClient(app) as client:
        resp = client.get("/api/v1/agents/does-not-exist")
        assert resp.status_code == 404


def test_api_agent_chat_requires_key() -> None:
    with TestClient(app) as client:
        created = client.post("/api/v1/agents", json={"name": "小周"})
        agent_id = created.json()["id"]
        resp = client.post(f"/api/v1/agents/{agent_id}/chat", json={"message": "你好"})
        assert resp.status_code == 503  # 测试环境未配置 LLM_API_KEY


def test_api_task_todo_patch_assign_complete() -> None:
    with TestClient(app) as client:
        created = client.post("/api/v1/tasks", json={"kind": "todo", "title": "买牛奶"})
        assert created.status_code == 200
        task_id = created.json()["task_id"]

        patched = client.patch(f"/api/v1/tasks/{task_id}", json={"priority": "high"})
        assert patched.status_code == 200
        assert patched.json()["priority"] == "high"

        agent = client.post("/api/v1/agents", json={"name": "小周"}).json()
        assigned = client.post(
            f"/api/v1/tasks/{task_id}/assign", json={"agent_id": agent["id"]}
        )
        assert assigned.status_code == 200
        assert assigned.json()["assignee_id"] == agent["id"]

        done = client.post(f"/api/v1/tasks/{task_id}/complete")
        assert done.status_code == 200
        assert done.json()["status"] == "DONE"
