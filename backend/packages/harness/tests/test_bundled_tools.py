"""Tests for bundled CLI / ripgrep resolution."""

from __future__ import annotations

import os
import sys

from gogo.utils import bundled_tools as bt


def test_apply_gogo_cli_to_path_prepends_search_dirs(monkeypatch) -> None:
    monkeypatch.setenv("PATH", "C:\\existing")
    monkeypatch.setattr(bt, "gogo_cli_search_dirs", lambda: ["C:\\bundled\\gogo", "C:\\venv\\Scripts"])
    bt.apply_gogo_cli_to_path()
    parts = os.environ["PATH"].split(os.pathsep)
    assert parts[0] == "C:\\bundled\\gogo"
    assert parts[1] == "C:\\venv\\Scripts"
    assert "C:\\existing" in parts
    assert os.environ["gogo_CLI_DIR"] == "C:\\bundled\\gogo"


def test_gateway_cli_argv_includes_mode_cli() -> None:
    argv = bt.gateway_cli_argv(["agents", "list"])
    assert "agents" in argv
    assert "list" in argv
    if getattr(sys, "frozen", False):
        assert argv[1:4] == ["--mode", "cli", "agents"]
    else:
        assert argv[-2:] == ["agents", "list"]
        assert argv[0].endswith(("gogo.exe", "gogo", "python.exe")) or "gogo" in argv[1]
