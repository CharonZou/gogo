from unittest.mock import MagicMock, patch

from gogo.collab.models import CollabPhase
from gogo.collab.thread_collab import advance_collab_phase_to_verifying_for_task


def test_advance_collab_phase_to_verifying():
    paths = MagicMock()
    task = {"thread_id": "thread-1"}
    state = MagicMock()
    state.collab_phase = CollabPhase.EXECUTING

    with (
        patch("gogo.collab.storage.find_main_task", return_value=(None, task)),
        patch("gogo.collab.thread_collab.load_thread_collab_state", return_value=state),
        patch("gogo.collab.thread_collab.merge_thread_collab_state", side_effect=lambda cur, upd: upd),
        patch("gogo.collab.thread_collab.save_thread_collab_state") as save,
    ):
        ok = advance_collab_phase_to_verifying_for_task(paths, "task-1")
        assert ok is True
        save.assert_called()
