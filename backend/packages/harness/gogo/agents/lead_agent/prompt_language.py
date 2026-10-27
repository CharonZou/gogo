"""Lead-agent system prompt language selection (zh / en)."""

from __future__ import annotations

import os
from typing import Literal

PromptLanguage = Literal["zh", "en"]

DEFAULT_PROMPT_LANGUAGE: PromptLanguage = "zh"


def resolve_prompt_language(value: str | None = None) -> PromptLanguage:
    """Resolve prompt language: explicit arg > ``gogo_PROMPT_LANGUAGE`` env > default (zh)."""
    raw = str(value or os.getenv("gogo_PROMPT_LANGUAGE") or DEFAULT_PROMPT_LANGUAGE).strip().lower()
    if raw in {"zh", "zh-cn", "zh_cn", "chinese", "cn"}:
        return "zh"
    return "en"


def resolve_entry_prompt_language(thread_id: str | None = None) -> PromptLanguage:
    """Resolve prompt language for runs started outside the panel (IM / automation / proactive).

    The EvoPanel ws-client injects ``context.prompt_language`` every turn; non-panel entry
    points have no such carrier, so the locale is backfilled here — priority: session row
    for ``thread_id`` (last used language sticks to the conversation) → instance default
    ``panel_settings.locale`` → ``gogo_PROMPT_LANGUAGE`` env → default (zh).
    """
    tid = str(thread_id or "").strip()
    if tid:
        try:
            from gogo.agents.memory.prompt import prompt_language_for_thread

            stored = str(prompt_language_for_thread(tid) or "").strip()
        except Exception:
            stored = ""
        if stored:
            return resolve_prompt_language(stored)
    try:
        from gogo.persistence.panel_settings import get_panel_settings

        locale = str(get_panel_settings().get("locale") or "").strip()
    except Exception:
        locale = ""
    return resolve_prompt_language(locale or None)
