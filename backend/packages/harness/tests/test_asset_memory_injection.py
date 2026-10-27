"""runtime-aligned Tier-0 memory injection (read_path + standing only)."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from gogo.agents.lead_agent.prompt import build_memory_injection_sections
from gogo.assets.guidance import build_entity_memory_injection
from gogo.assets.hub import ensure_entity_tree
from gogo.assets.memory_injection import resolve_memory_injection_mode
from gogo.assets.paths import EntityRef
from gogo.config.memory_config import MemoryConfig, set_memory_config


@pytest.fixture
def assets_home(monkeypatch: pytest.MonkeyPatch):
    with tempfile.TemporaryDirectory() as tmp:
        monkeypatch.setenv("gogo_HOME", tmp)
        set_memory_config(MemoryConfig(injection_mode="asset"))
        yield Path(tmp)
        set_memory_config(MemoryConfig())


def test_default_injection_mode_is_asset() -> None:
    set_memory_config(MemoryConfig())
    assert resolve_memory_injection_mode() == "asset"


def test_asset_tier0_read_path_without_catalog(assets_home: Path) -> None:
    ref = EntityRef("user", "user").normalized()
    ensure_entity_tree(ref)
    standing = assets_home / "assets" / "user" / "memory" / "standing.md"
    standing.write_text(
        "v1\n\n当前主线：prompt-audit\n",
        encoding="utf-8",
    )
    facts = assets_home / "assets" / "user" / "memory" / "facts"
    facts.mkdir(parents=True, exist_ok=True)
    (facts / "goal-done.md").write_text(
        "---\naccess_tier: archival\nevidence: {\"source\": \"goal_complete\"}\n---\n\n# Goal done\n",
        encoding="utf-8",
    )

    block = build_entity_memory_injection(ref)
    assert "MEMORY_SUMMARY BEGINS" in block
    assert "prompt-audit" in block
    assert "assets(action=search" in block
    assert "<catalog>" not in block
    assert "goal-done" not in block


def test_asset_skips_empty_standing(assets_home: Path) -> None:
    ref = EntityRef("user", "user").normalized()
    ensure_entity_tree(ref)
    assert build_entity_memory_injection(ref) == ""


def test_build_memory_injection_sections_asset_no_legacy_memory(assets_home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ref = EntityRef("user", "user").normalized()
    ensure_entity_tree(ref)
    (assets_home / "assets" / "user" / "memory" / "standing.md").write_text(
        "v1\n\n验证岗偏好结论先行\n",
        encoding="utf-8",
    )

    class _Cfg:
        enabled = True
        injection_enabled = True
        injection_mode = "asset"
        chat_compact_max_tokens = 800
        max_injection_tokens = 2000

    monkeypatch.setattr("gogo.config.memory_config.get_memory_config", lambda: _Cfg())

    block = build_memory_injection_sections(agent_name="main")
    assert "MEMORY_SUMMARY" in block
    assert "<memory>" not in block
    assert "User Context" not in block


def test_build_memory_injection_sections_legacy_includes_sqlite_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    set_memory_config(MemoryConfig(injection_mode="legacy"))

    class _Cfg:
        enabled = True
        injection_enabled = True
        injection_mode = "legacy"
        chat_compact_max_tokens = 800
        max_injection_tokens = 2000

    monkeypatch.setattr("gogo.config.memory_config.get_memory_config", lambda: _Cfg())
    monkeypatch.setattr(
        "gogo.agents.lead_agent.prompt._get_memory_context",
        lambda *a, **k: "<memory>\nUser Context:\n- Work: test\n</memory>\n",
    )
    monkeypatch.setattr(
        "gogo.assets.guidance.build_session_asset_memory_block",
        lambda **k: "",
    )

    block = build_memory_injection_sections(agent_name="main")
    assert "<memory>" in block
    set_memory_config(MemoryConfig())


def test_procedure_once_when_user_and_workspace(assets_home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from gogo.assets.paths import workspace_entity_ref
    from gogo.config.paths import reset_paths_cache

    reset_paths_cache()
    user = EntityRef("user", "user").normalized()
    ensure_entity_tree(user)
    (assets_home / "assets" / "user" / "memory" / "standing.md").write_text(
        "v1\n\n用户主线：dedupe-read-path\n",
        encoding="utf-8",
    )

    repo = assets_home / "proj"
    repo.mkdir()
    ws = workspace_entity_ref(str(repo))
    ensure_entity_tree(ws)
    (assets_home / "assets" / "workspaces" / ws.entity_id / "memory" / "standing.md").write_text(
        "v1\n\n工作区：gogo harness\n",
        encoding="utf-8",
    )

    class _Cfg:
        enabled = True
        injection_enabled = True
        injection_mode = "asset"
        chat_compact_max_tokens = 800
        max_injection_tokens = 2000

    monkeypatch.setattr("gogo.config.memory_config.get_memory_config", lambda: _Cfg())

    block = build_memory_injection_sections(
        agent_name="main",
        local_workspace_root=str(repo),
    )
    assert block.count("## Entity assets") == 1
    assert "Ask before deposit" in block
    assert "dedupe-read-path" in block
    assert "gogo harness" in block
    assert "<workspace_memory>" in block
    assert "### User —" in block
    assert "### Workspace —" in block
    # Workspace block must not re-paste the shared procedure
    ws_start = block.index("<workspace_memory>")
    assert "## Entity assets" not in block[ws_start:]
    assert "Ask before deposit" not in block[ws_start:]
