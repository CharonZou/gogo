"""Facade for locale-specific dynamic prompt fragments."""

from __future__ import annotations

from gogo.agents.lead_agent import prompt_dynamic_en as _en
from gogo.agents.lead_agent import prompt_dynamic_zh as _zh
from gogo.agents.lead_agent.prompt_language import resolve_prompt_language


def get_prompt_dynamic(lang: str | None = None):
    return _en if resolve_prompt_language(lang) == "en" else _zh
