"""Session execution facade — stop / idle commands + read model (symmetric with evopanel session-execution)."""

from gogo.session_execution.commands import mark_session_idle, stop_session_execution
from gogo.session_execution.lifecycle import (
    adopt_session_run_id,
    end_session_turn,
    force_end_session_turn,
    schedule_end_session_turn,
    start_session_turn,
)
from gogo.session_execution.queries import build_session_execution_state, derive_executing
from gogo.session_execution.types import SessionStopResult

__all__ = [
    "SessionStopResult",
    "adopt_session_run_id",
    "build_session_execution_state",
    "derive_executing",
    "end_session_turn",
    "force_end_session_turn",
    "mark_session_idle",
    "schedule_end_session_turn",
    "start_session_turn",
    "stop_session_execution",
]
