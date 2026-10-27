"""Principal update + password reset tests."""

from __future__ import annotations

import gc
import tempfile
from pathlib import Path

import pytest

from gogo.authz import principals as principals_mod
from gogo.persistence.db import get_db, reset_db_for_tests
from gogo.persistence.schema import ensure_app_schema

_gogo_ROOT = Path(__file__).resolve().parents[4]


@pytest.fixture
def identity_db(monkeypatch: pytest.MonkeyPatch):
    with tempfile.TemporaryDirectory() as tmp:
        monkeypatch.setenv("gogo_HOME", tmp)
        monkeypatch.setenv("gogo_CONFIG_PATH", str(_gogo_ROOT / "config.yaml"))
        monkeypatch.setenv("gogo_ACL_MODE", "shadow")
        reset_db_for_tests()
        ensure_app_schema(get_db())
        yield
        reset_db_for_tests()
        gc.collect()


def test_update_principal_display_and_email(identity_db) -> None:
    created = principals_mod.create_principal(
        display_name="Alice",
        username="alice",
        password="password123",
        primary_email="alice@example.com",
    )
    pid = str(created["principal_id"])
    updated = principals_mod.update_principal(
        pid,
        display_name="Alice Wang",
        primary_email="alice.wang@example.com",
        update_primary_email=True,
    )
    assert updated["display_name"] == "Alice Wang"
    assert updated["primary_email"] == "alice.wang@example.com"


def test_reset_principal_password(identity_db) -> None:
    created = principals_mod.create_principal(
        display_name="Bob",
        username="bob",
        password="oldpassword1",
    )
    pid = str(created["principal_id"])
    new_pw = principals_mod.reset_principal_password(pid, new_password="newpassword9")
    assert new_pw == "newpassword9"
    from gogo.webui.auth import verify_user_credentials

    assert verify_user_credentials("bob", "newpassword9") is not None
    assert verify_user_credentials("bob", "oldpassword1") is None
