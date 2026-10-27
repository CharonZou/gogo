"""CLI / admin approvals.request for 岗位工作项."""

from __future__ import annotations

import gc
import tempfile
from pathlib import Path

import pytest

from gogo.admin import approvals as approvals_admin
from gogo.admin.errors import ValidationError
from gogo.config.app_config import reset_app_config
from gogo.persistence.db import get_db, reset_db_for_tests
from gogo.proactive.models import (
    ApprovalStatus,
    ProactiveAutonomyLevel,
    ProactiveRole,
    ProactiveRoleConfig,
)
from gogo.proactive.repositories import ProactiveRepository
from gogo.proactive.work_items import create_role_work_item, load_work_item_task


@pytest.fixture
def sqlite_tmp(monkeypatch: pytest.MonkeyPatch):
    """Isolated app DB — never touch ~/.gogo live roles.

    Host shells often set ``gogo_DB_PATH`` to the desktop live DB; that
    overrides ``gogo_HOME``, so we must clear it and point at an explicit
    temp sqlite file.
    """
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        db_path = root / "data" / "app" / "gogo.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        monkeypatch.setenv("gogo_HOME", str(root))
        monkeypatch.setenv("gogo_DB_PATH", str(db_path))
        monkeypatch.delenv("gogo_DATA_DIR", raising=False)
        reset_app_config()
        reset_db_for_tests()
        get_db()
        yield root
        reset_db_for_tests()
        reset_app_config()
        gc.collect()


def test_approvals_request_creates_pending(sqlite_tmp):
    # Unique code — never overwrite live product-manager.
    code = "test-pm-approvals"
    role = ProactiveRole(
        agent_code=code,
        role_name="测试产品经理",
        department="产品",
        status="active",
        config=ProactiveRoleConfig(
            autonomy_level=ProactiveAutonomyLevel.APPROVAL_FOR_ALL,
            approval_channels=["desktop"],
            workspace_path=str(sqlite_tmp),
        ),
    )
    ProactiveRepository.save_role(role)

    created = create_role_work_item(
        role,
        {
            "title": "方案待批",
            "description": "organic plan draft",
            "action_type": "analysis",
            "risk_level": "medium",
            "rationale": "draft",
        },
        round_id="round:test",
        goal="起草方案",
        source="role",
        raised_by=code,
    )
    assert created
    tid = str(created.get("task_id") or "")
    assert tid

    async def _noop_push(*_a, **_k):
        return None

    from unittest.mock import patch

    with patch(
        "gogo.proactive.decision_gate.DecisionGate._push_to_channels",
        new=_noop_push,
    ):
        out = approvals_admin.request(tid, note="请批准方案后再拆下游")
    assert out.get("ok") is True
    assert out.get("task_id") == tid
    appr = out.get("approval") or {}
    assert appr.get("task_id") == tid
    assert appr.get("status") == ApprovalStatus.PENDING.value

    task = load_work_item_task(tid)
    assert task
    assert str(task.get("status") or "").lower() == "waiting_user"
    assert "请批准" in str(task.get("rationale") or "")

    listed = approvals_admin.list_approvals(status="pending")
    assert listed["count"] >= 1
    assert any(str(a.get("task_id") or "") == tid for a in listed["approvals"])

    again = approvals_admin.request(tid)
    assert again.get("already_pending") is True


def test_approvals_reject_requires_reason():
    try:
        approvals_admin.reject("Task_x", reason="")
        assert False, "expected ValidationError"
    except ValidationError as e:
        assert "原因" in str(e) or "reason" in str(e).lower()
