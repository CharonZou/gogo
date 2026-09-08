"""工具白名单挂员工（P2.3）测试：执行时按 assignee 白名单过滤。"""

from __future__ import annotations

from backend.agents.manager import AgentManager
from backend.orchestration.supervisor import Supervisor
from backend.tools.executor import build_default_executor


async def fake_planner(goal: str) -> dict:
    return {
        "tasks": [
            {
                "id": "t1",
                "title": "执行命令",
                "depends_on": [],
                "tool": "bash",
                "tool_args": {"command": "echo hi"},
            },
            {
                "id": "t2",
                "title": "占位",
                "depends_on": ["t1"],
                "tool": "noop",
                "tool_args": {},
            },
        ]
    }


async def make_sv(tmp_path) -> tuple[Supervisor, AgentManager]:
    db_file = tmp_path / "wf.db"
    sv = Supervisor(
        db_path=str(db_file),
        planner=fake_planner,
        tools=build_default_executor(sandbox_root=str(tmp_path / "sb")),
        max_concurrency=2,
        max_retries=0,
        checkpoint_path=str(tmp_path / "ck.db"),
    )
    agents = AgentManager(db_path=str(db_file))
    return sv, agents


async def test_whitelist_blocks_disallowed_tool(tmp_path) -> None:
    sv, agents = await make_sv(tmp_path)
    agent = await agents.hire("受限员工", tool_whitelist=["noop"])
    created = await sv.create_task("受限任务")
    await sv.plan(created["task_id"])
    await sv.assign_task(created["task_id"], agent["id"])
    await sv.approve(created["task_id"])
    result = await sv.run(created["task_id"])

    assert result["status"] == "FAILED"
    st = await sv.status(created["task_id"])
    statuses = {s["id"].split("-")[-1]: s["status"] for s in st["subtasks"]}
    assert statuses == {"t1": "FAILED", "t2": "PENDING"}
    failed = next(s for s in st["subtasks"] if s["status"] == "FAILED")
    assert "白名单" in failed["error"]


async def test_whitelist_allows_matching_tool(tmp_path) -> None:
    sv, agents = await make_sv(tmp_path)
    agent = await agents.hire("全权员工", tool_whitelist=["bash", "noop"])
    created = await sv.create_task("正常任务")
    await sv.plan(created["task_id"])
    await sv.assign_task(created["task_id"], agent["id"])
    await sv.approve(created["task_id"])
    result = await sv.run(created["task_id"])

    assert result["status"] == "DONE"


async def test_empty_whitelist_means_no_restriction(tmp_path) -> None:
    sv, agents = await make_sv(tmp_path)
    agent = await agents.hire("无限制员工", tool_whitelist=[])
    created = await sv.create_task("无限制任务")
    await sv.plan(created["task_id"])
    await sv.assign_task(created["task_id"], agent["id"])
    await sv.approve(created["task_id"])
    result = await sv.run(created["task_id"])
    assert result["status"] == "DONE"


async def test_wildcard_mcp_whitelist(tmp_path) -> None:
    sv, agents = await make_sv(tmp_path)
    # 员工白名单只允许 mcp 通配 → bash 被拒
    agent = await agents.hire("MCP员工", tool_whitelist=["mcp__github__*"])
    created = await sv.create_task("mcp 任务")
    await sv.plan(created["task_id"])
    await sv.assign_task(created["task_id"], agent["id"])
    await sv.approve(created["task_id"])
    result = await sv.run(created["task_id"])
    assert result["status"] == "FAILED"

    from backend.orchestration.executor import _tool_allowed

    assert _tool_allowed("mcp__github__list_issues", ["mcp__github__*"])
    assert not _tool_allowed("bash", ["mcp__github__*"])


async def test_chat_injects_skill_and_tool_whitelist(tmp_path) -> None:
    """员工对话：技能说明按白名单注入（FakeLLM 替身验证 prompt 内容）。"""
    from backend.llm.client import LLMClient
    from backend.skills.manager import SkillManager

    class FakeLLM(LLMClient):
        def __init__(self) -> None:
            self.last_messages: list[dict] = []

        async def chat_text(self, messages: list[dict], **kwargs: object) -> str:
            self.last_messages = messages
            return "好的"

    skills = SkillManager(db_path=str(tmp_path / "s.db"))
    await skills.upsert("deep-research", "深度调研", "联网检索多来源对比")

    agents = AgentManager(
        db_path=str(tmp_path / "a.db"),
        llm=FakeLLM(),
        skills_manager=skills,
    )
    agent = await agents.hire(
        "研究员",
        tool_whitelist=["bash", "mcp__github__*"],
        skill_whitelist=["deep-research"],
    )
    await agents.chat(agent["id"], "帮我调研")

    system = agents.llm.last_messages[0]["content"]
    assert "bash" in system
    assert "mcp__github__*" in system
    assert "deep-research" in system
    assert "联网检索多来源对比" in system
