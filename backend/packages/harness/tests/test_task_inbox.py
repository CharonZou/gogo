"""Inbox lifecycle: open for duty pickup; state machine allows assign/complete."""

from __future__ import annotations

from gogo.proactive.work_items import _OPEN_TASK_STATUSES
from gogo.tools.builtins.supervisor_tool import (
    _ALLOWED_TASK_STATES,
    _can_transition_task_state,
)


def test_inbox_is_open_status_for_duty_pickup():
    assert "inbox" in _OPEN_TASK_STATUSES
    assert "pending" in _OPEN_TASK_STATUSES


def test_inbox_state_transitions_allowed():
    assert "inbox" in _ALLOWED_TASK_STATES
    assert _can_transition_task_state("inbox", "pending")
    assert _can_transition_task_state("inbox", "completed")
    assert _can_transition_task_state("inbox", "cancelled")
    assert not _can_transition_task_state("inbox", "executing")


def test_pending_can_cancel_without_fake_progress():
    """Mis-dispatched pending tasks must be cancellable directly (admin + collab SSOT)."""
    from gogo.admin.tasks import _can_transition
    from gogo.collab.models import TaskStatus
    from gogo.collab.state_transitions import can_transition

    assert _can_transition("pending", "cancelled")
    assert _can_transition_task_state("pending", "cancelled")
    assert can_transition(TaskStatus.PENDING, TaskStatus.CANCELLED)
    assert can_transition(TaskStatus.PENDING, TaskStatus.EXECUTING)
