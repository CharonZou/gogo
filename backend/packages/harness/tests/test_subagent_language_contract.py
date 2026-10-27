"""Subagent reply-language contract tests (bilingual rollout batch A2).

Covers ``with_reply_language_contract`` and its use in
``_resolve_subagent_system_prompt`` so builtin (Chinese-authored) subagent
prompts follow the UI locale instead of always answering in Chinese.
"""

from __future__ import annotations

from types import SimpleNamespace

from gogo.subagents.registry import _resolve_subagent_system_prompt, with_reply_language_contract


def test_contract_appended_en() -> None:
    out = with_reply_language_contract("You are a worker.", prompt_language="en")
    assert "<reply_language>" in out
    assert "Answer in **English**" in out
    assert out.startswith("You are a worker.")


def test_contract_appended_zh() -> None:
    out = with_reply_language_contract("你是子代理。", prompt_language="zh")
    assert "<reply_language>" in out
    assert "简体中文" in out


def test_contract_default_zh_when_language_unknown() -> None:
    out = with_reply_language_contract("你是子代理。")
    assert "简体中文" in out


def test_contract_idempotent() -> None:
    once = with_reply_language_contract("You are a worker.", prompt_language="en")
    twice = with_reply_language_contract(once, prompt_language="zh")
    # 已带契约的 prompt 不再追加，先写入的语言生效（与 task_tool 尾部追加的守卫一致）
    assert twice == once


def test_contract_empty_prompt_stays_empty() -> None:
    assert with_reply_language_contract("", prompt_language="en") == ""
    assert with_reply_language_contract("   ", prompt_language="en") == ""


def test_resolve_system_prompt_wraps_config_prompt() -> None:
    cfg = SimpleNamespace(
        system_prompt="You are a worker.",
        agent_code="w1",
        agent_type="subagent",
        description="d",
    )
    out = _resolve_subagent_system_prompt(cfg, prompt_language="en")
    assert "Answer in **English**" in out
