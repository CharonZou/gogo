"""Subagent registry for managing available subagents."""

import logging
from dataclasses import replace

from gogo.claude_subagent_type import claude_subagent_lookup_keys, is_claude_code_subagent_type
from gogo.config.agents_config import list_custom_agents
from gogo.config.subagents_config import get_subagents_app_config
from gogo.sandbox.security import is_host_bash_allowed
from gogo.subagents.builtins import BUILTIN_SUBAGENTS
from gogo.subagents.config import SubagentConfig

logger = logging.getLogger(__name__)


def with_reply_language_contract(prompt: str, *, prompt_language: str | None = None) -> str:
    """Append the ``<reply_language>`` contract to a subagent system prompt.

    Builtin subagent prompts are written in Chinese; without an explicit contract an
    English interface would still get Chinese worker output. Reuses the lead-agent
    ``reply_language_footer`` (zh/en pair) so there is only one contract to maintain.
    Idempotent: a prompt that already carries the block is returned unchanged.
    """
    text = str(prompt or "").rstrip()
    if not text or "<reply_language>" in text:
        return text
    # Lazy import: agents.lead_agent.prompt is heavy; registry loads early.
    from gogo.agents.lead_agent.prompt import reply_language_footer

    footer = reply_language_footer(prompt_language)
    return f"{text}\n\n{footer}" if footer else text


def _timeout_for_subagent(app_config, primary_name: str, matched_key: str | None = None) -> int:
    """Resolve timeout, checking Claude family aliases for config.yaml overrides."""
    for key in dict.fromkeys([primary_name, matched_key, "claude-code", "claude-session", "claude"]):
        if not key:
            continue
        override = app_config.agents.get(key)
        if override is not None and override.timeout_seconds is not None:
            return override.timeout_seconds
    return app_config.timeout_seconds


def _resolve_subagent_system_prompt(agent_cfg, *, prompt_language: str | None = None) -> str:
    """Resolve a non-empty system prompt for a custom/subagent worker.

    Preference order (first non-empty wins):
    1. ``system_prompt`` on the agent config
    2. the agent's SOUL (``soul`` / SOUL.md / SQLite) — custom agents often keep
       their working instructions in SOUL only
    3. the agent's ``description`` — a last-resort guard so a worker is never
       dropped from the registry merely because its prompt fields are empty.

    Returns an empty string only when none of the sources carry any text.
    Non-empty results carry the reply-language contract for ``prompt_language``.
    """
    prompt = str(agent_cfg.system_prompt or "").strip()
    if prompt:
        return with_reply_language_contract(prompt, prompt_language=prompt_language)

    try:
        from gogo.config.agents_config import load_agent_soul

        soul = load_agent_soul(agent_cfg.agent_code)
        if soul and str(soul).strip():
            logger.warning(
                "Worker agent '%s' (type=%s) has empty system_prompt; falling back to SOUL",
                agent_cfg.agent_code,
                agent_cfg.agent_type,
            )
            return with_reply_language_contract(str(soul).strip(), prompt_language=prompt_language)
    except Exception:
        logger.debug(
            "Worker agent '%s': load_agent_soul fallback skipped",
            agent_cfg.agent_code,
            exc_info=True,
        )

    description = str(agent_cfg.description or "").strip()
    if description:
        logger.warning(
            "Worker agent '%s' (type=%s) has empty system_prompt and SOUL; falling back to description",
            agent_cfg.agent_code,
            agent_cfg.agent_type,
        )
        return with_reply_language_contract(description, prompt_language=prompt_language)

    logger.warning(
        "Worker agent '%s' (type=%s) has no system_prompt, SOUL or description",
        agent_cfg.agent_code,
        agent_cfg.agent_type,
    )
    return ""


def _agent_config_to_subagent_config(agent_cfg, *, prompt_language: str | None = None) -> SubagentConfig | None:
    """Convert AgentConfig to SubagentConfig for task / supervisor delegation.

    Includes ``agent_type=subagent`` and ``agent_type=custom``. A custom agent is
    considered schedulable as long as it carries any usable prompt text
    (system_prompt → SOUL → description). It is only skipped when every prompt
    source is empty, so a missing ``system_prompt`` no longer blocks delegation.
    """
    if agent_cfg.agent_type not in ("subagent", "custom"):
        return None

    system_prompt = _resolve_subagent_system_prompt(agent_cfg, prompt_language=prompt_language)
    if not system_prompt:
        return None

    return SubagentConfig(
        name=agent_cfg.agent_code,
        description=agent_cfg.description,
        system_prompt=system_prompt,
        tools=agent_cfg.tools,
        disallowed_tools=agent_cfg.disallowed_tools,
        model=agent_cfg.model or "inherit",
        max_turns=agent_cfg.max_turns,
        timeout_seconds=agent_cfg.timeout_seconds,
    )


def get_subagent_config(name: str, *, prompt_language: str | None = None) -> SubagentConfig | None:
    """Get a subagent configuration by name, with config.yaml overrides applied.

    Args:
        name: The name of the subagent.
        prompt_language: UI locale for the run ("zh" / "en"); the resolved system
            prompt carries the matching reply-language contract.

    Returns:
        SubagentConfig if found (with any config.yaml overrides applied), None otherwise.
    """
    keys = claude_subagent_lookup_keys(name)
    # 1) Filesystem agents: custom + subagent (see list_custom_agents), keyed by agent_code
    for agent_cfg in list_custom_agents():
        if agent_cfg.agent_code not in keys:
            continue
        subagent_cfg = _agent_config_to_subagent_config(agent_cfg, prompt_language=prompt_language)
        if not subagent_cfg:
            return None

        # Apply timeout override from config.yaml
        app_config = get_subagents_app_config()
        effective_timeout = _timeout_for_subagent(app_config, name, agent_cfg.agent_code)
        if effective_timeout != subagent_cfg.timeout_seconds:
            logger.debug(
                "Subagent '%s': timeout overridden by config.yaml (%ss -> %ss)",
                name,
                subagent_cfg.timeout_seconds,
                effective_timeout,
            )
            subagent_cfg = replace(subagent_cfg, timeout_seconds=effective_timeout)
        return subagent_cfg

    # 2) Fallback to built-in subagents (so registry works even without filesystem configs)
    for builtin_key, cfg in BUILTIN_SUBAGENTS.items():
        if builtin_key not in keys and cfg.name not in keys:
            continue
        app_config = get_subagents_app_config()
        effective_timeout = _timeout_for_subagent(app_config, name, builtin_key)
        # Always copy: BUILTIN_SUBAGENTS entries are shared, never mutate in place.
        cfg = replace(
            cfg,
            system_prompt=with_reply_language_contract(cfg.system_prompt, prompt_language=prompt_language),
            timeout_seconds=effective_timeout,
        )
        return cfg

    return None


def list_subagents() -> list[SubagentConfig]:
    """List all available subagent configurations (with config.yaml overrides applied).

    Returns:
        List of all registered SubagentConfig instances.
    """
    by_name: dict[str, SubagentConfig] = {}

    # 1) filesystem: custom + subagent with system_prompt
    for agent_cfg in list_custom_agents():
        subagent_cfg = _agent_config_to_subagent_config(agent_cfg)
        if subagent_cfg:
            by_name[subagent_cfg.name] = subagent_cfg

    # 2) built-ins (only when not overridden)
    for name, cfg in BUILTIN_SUBAGENTS.items():
        by_name.setdefault(name, cfg)

    # 3) apply timeout overrides
    app_config = get_subagents_app_config()
    out: list[SubagentConfig] = []
    for name, cfg in by_name.items():
        effective_timeout = app_config.get_timeout_for(name)
        if effective_timeout != cfg.timeout_seconds:
            cfg = replace(cfg, timeout_seconds=effective_timeout)
        out.append(cfg)

    return out


def get_subagent_names() -> list[str]:
    """Get all available subagent names.

    Returns:
        List of subagent names.
    """
    return [cfg.name for cfg in list_subagents()]


def get_available_subagent_names() -> list[str]:
    """Get subagent names that should be exposed to the active runtime.

    Returns:
        List of subagent names visible to the current sandbox configuration.
    """
    names = get_subagent_names()
    try:
        host_bash_allowed = is_host_bash_allowed()
    except Exception:
        logger.debug("Could not determine host bash availability; keeping bash visibility")
        host_bash_allowed = True

    if not host_bash_allowed:
        names = [name for name in names if name != "bash"]

    # Lead routing: do not expose Claude Code as a pickable subagent_type.
    # Explicit main-chat Claude Code preset still works via session agent_name.
    names = [name for name in names if not is_claude_code_subagent_type(name)]
    return names