"""Wake a collab subtask for a peer thread round."""

from __future__ import annotations

import logging
from typing import Any, Literal

logger = logging.getLogger(__name__)

PeerReason = Literal["peer_question", "peer_reply"]


async def wake_collab_subtask_for_peer(
    *,
    main_task_id: str,
    to_subtask_id: str,
    thread_key: str,
    trigger_message_id: str,
    reason: str,
) -> dict[str, Any]:
    from gogo.collab.peer.scheduler import enqueue_peer_wake_if_busy
    from gogo.collab.peer.wake_context import set_peer_wake_context
    from gogo.collab.storage import find_subtask_by_ids, get_project_storage
    from gogo.collab.subtask_outcome import is_subtask_outcome_reported
    from gogo.tools.builtins.supervisor.execution import delegate_collab_subtask_peer_wake

    mid = str(main_task_id or "").strip()
    sid = str(to_subtask_id or "").strip()
    tk = str(thread_key or "").strip()
    if not mid or not sid or not tk:
        return {"ok": False, "error": "main_task_id, to_subtask_id, thread_key required"}

    storage = get_project_storage()
    st = find_subtask_by_ids(storage, mid, sid)
    if not st:
        return {"ok": False, "error": "subtask not found"}

    mode: str = "consultation" if is_subtask_outcome_reported(st) and str(st.get("status") or "").lower() == "completed" else "collaboration"

    if enqueue_peer_wake_if_busy(
        storage,
        main_task_id=mid,
        subtask_id=sid,
        item={
            "thread_key": tk,
            "trigger_message_id": trigger_message_id,
            "reason": reason,
        },
    ):
        return {"ok": True, "queued": True}

    set_peer_wake_context(
        mid,
        sid,
        thread_key=tk,
        trigger_message_id=trigger_message_id,
        mode=mode,  # type: ignore[arg-type]
    )
    try:
        return await delegate_collab_subtask_peer_wake(
            storage,
            main_task_id=mid,
            subtask_id=sid,
            thread_key=tk,
            mode=mode,
        )
    except Exception:
        logger.exception("peer wake delegate failed main=%s sub=%s", mid, sid)
        return {"ok": False, "error": "peer wake delegation failed"}
