"""P1.3 小秘书意图路由测试：记待办 / 雇员工 / unknown / 参数缺失。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.agents.manager import AgentManager
from backend.assistant.service import AssistantService
from backend.main import app
from backend.main import assistant as app_assistant
from backend.orchestration.supervisor import Supervisor


def make_classifier(**parsed) -> AssistantService:
    async def fake(message: str) -> dict:
        return parsed

    return fake


@pytest.fixture
def svc(tmp_path) -> AssistantService:
    db_path = str(tmp_path / "asst.db")
    return AssistantService(
        Supervisor(db_path=db_path),
        AgentManager(db_path=db_path),
        classifier=make_classifier(),
    )


async def test_create_todo_flow(svc: AssistantService) -> None:
    svc.classifier = make_classifier(
        intent="create_todo",
        params={"title": "买牛奶", "due_at": "2026-09-10", "priority": "high"},
    )
    out = await svc.handle("帮我记一条待办：买牛奶")
    assert out["message"] == "已帮你记好待办：买牛奶"
    assert out["created"]["module"] == "task"
    task = await svc.supervisor.status(out["created"]["id"])
    assert task["kind"] == "todo"
    assert task["title"] == "买牛奶"
    assert task["priority"] == "high"
    assert task["due_at"] == "2026-09-10"


async def test_hire_agent_flow(svc: AssistantService) -> None:
    svc.classifier = make_classifier(
        intent="hire_agent", params={"name": "小周", "role": "周报专员"}
    )
    out = await svc.handle("雇佣一个智能体员工小周，负责周报")
    assert out["created"]["module"] == "agent"
    agent = await svc.agent_manager.get(out["created"]["id"])
    assert agent["name"] == "小周"
    assert agent["role"] == "周报专员"
    assert agent["status"] == "off_duty"


async def test_unknown_intent_fallback(svc: AssistantService) -> None:
    svc.classifier = make_classifier(intent="unknown", params={})
    out = await svc.handle("讲个笑话")
    assert out["created"] is None
    assert "待办" in out["message"]


async def test_missing_title_raises(svc: AssistantService) -> None:
    svc.classifier = make_classifier(intent="create_todo", params={})
    with pytest.raises(ValueError, match="待办内容"):
        await svc.handle("记个待办")


async def test_missing_name_raises(svc: AssistantService) -> None:
    svc.classifier = make_classifier(intent="hire_agent", params={})
    with pytest.raises(ValueError, match="员工名字"):
        await svc.handle("雇个员工")


async def test_bad_intent_raises(svc: AssistantService) -> None:
    svc.classifier = make_classifier(intent="fly_to_moon", params={})
    with pytest.raises(ValueError, match="意图"):
        await svc.handle("带我去月球")


async def test_empty_message_raises(svc: AssistantService) -> None:
    with pytest.raises(ValueError, match="消息"):
        await svc.handle("  ")


# ---------- API 层 ----------

def test_api_assistant_requires_key() -> None:
    with TestClient(app) as client:
        resp = client.post("/api/v1/assistant/message", json={"message": "帮我记一条待办"})
        assert resp.status_code == 503  # 测试环境未配置 LLM_API_KEY


def test_api_assistant_create_todo_with_fake_classifier() -> None:
    async def fake(message: str) -> dict:
        return {"intent": "create_todo", "params": {"title": "交水电费"}}

    original = app_assistant.classifier
    app_assistant.classifier = fake
    try:
        with TestClient(app) as client:
            resp = client.post("/api/v1/assistant/message", json={"message": "帮我记一条待办：交水电费"})
            assert resp.status_code == 200
            body = resp.json()
            assert body["created"]["module"] == "task"
            assert body["message"] == "已帮你记好待办：交水电费"
    finally:
        app_assistant.classifier = original
