"""NoopSandboxProvider replaces deleted LocalSandbox."""

from __future__ import annotations

import pytest

from gogo.sandbox.exceptions import SandboxError
from gogo.sandbox.noop import NoopSandboxProvider
from gogo.sandbox.sandbox_provider import _resolve_provider_class
from gogo.sandbox.security import is_host_bash_allowed, uses_host_passthrough_provider


def test_noop_acquire_keeps_local_id():
    p = NoopSandboxProvider()
    assert p.acquire() == "local"
    sb = p.get("local")
    assert sb is not None
    assert sb.id == "local"


def test_noop_blocks_shell_and_files():
    p = NoopSandboxProvider()
    sb = p.get(p.acquire())
    with pytest.raises(SandboxError, match="removed"):
        sb.execute_command("echo hi")
    with pytest.raises(SandboxError):
        sb.read_file("/tmp/x")
    with pytest.raises(SandboxError):
        sb.write_file("/tmp/x", "x")


def test_legacy_local_provider_resolves_to_noop():
    cls = _resolve_provider_class("gogo.sandbox.local:LocalSandboxProvider")
    assert cls is NoopSandboxProvider


def test_noop_path_disallows_host_bash(monkeypatch):
    class _Cfg:
        class sandbox:
            use = "gogo.sandbox.noop:NoopSandboxProvider"

    monkeypatch.setattr(
        "gogo.sandbox.security.get_app_config",
        lambda: _Cfg(),
    )
    assert uses_host_passthrough_provider() is True
    assert is_host_bash_allowed() is False
