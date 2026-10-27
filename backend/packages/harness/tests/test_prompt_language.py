"""System prompt language selection (default Chinese)."""

from __future__ import annotations

from gogo.agents.lead_agent.prompt import apply_prompt_template
from gogo.agents.lead_agent.prompt_language import resolve_prompt_language


def test_resolve_prompt_language_defaults_to_zh() -> None:
    assert resolve_prompt_language(None) == "zh"
    assert resolve_prompt_language("") == "zh"


def test_resolve_prompt_language_zh_aliases() -> None:
    assert resolve_prompt_language("zh") == "zh"
    assert resolve_prompt_language("zh-CN") == "zh"


def test_apply_prompt_template_default_is_chinese() -> None:
    text = apply_prompt_template(intent_hint="chat", available_skills=set())
    assert "你是" in text
    assert "gogo" in text
    assert "超级助手" not in text
    assert "Evo Assistant" not in text
    assert "<im_primary_identity>" not in text


def test_apply_prompt_template_zh() -> None:
    text = apply_prompt_template(intent_hint="chat", available_skills=set(), prompt_language="zh")
    assert "你是" in text
    # Reply-language contract is the tail block; context priority must stay above it.
    assert text.strip().endswith("</reply_language>")
    assert "</context_priority>" in text
    assert text.find("</context_priority>") < text.find("</reply_language>")
    assert "工作空间" in text
    assert "以用户为准" in text
    assert "gogo助手" in text
    assert "<im_primary_identity>" not in text
    soul_start = text.find("<soul>")
    if soul_start >= 0:
        soul_body = text[soul_start : text.find("</soul>", soul_start)]
        assert "**Identity**" not in soul_body
        assert "任务编排伙伴" not in soul_body


def test_apply_prompt_template_context_priority_at_end_en() -> None:
    text = apply_prompt_template(intent_hint="chat", available_skills=set(), prompt_language="en")
    assert text.strip().endswith("</reply_language>")
    assert "Answer in **English**" in text
    assert "</context_priority>" in text
    assert "latest user message" in text


def test_apply_prompt_template_includes_thinking_policy_when_enabled() -> None:
    text = apply_prompt_template(
        intent_hint="chat",
        available_skills=set(),
        prompt_language="zh",
        thinking_enabled=True,
    )
    assert "<thinking_policy>" in text
    assert "简短即可" in text
    assert "只用一个换行符" in text

    off = apply_prompt_template(
        intent_hint="chat",
        available_skills=set(),
        prompt_language="zh",
        thinking_enabled=False,
    )
    assert "<thinking_policy>" not in off


def test_apply_prompt_template_excludes_subagent_system_by_default() -> None:
    text = apply_prompt_template(
        intent_hint="chat",
        available_skills=set(),
        subagent_enabled=True,
    )
    assert "<subagent_system>" not in text


def test_apply_prompt_template_includes_subagent_system_when_opted_in() -> None:
    text = apply_prompt_template(
        intent_hint="chat",
        available_skills=set(),
        include_subagent_system_prompt=True,
    )
    assert "<subagent_system>" in text
