"""Chat session index (sidebar list): session_key ↔ thread_id in ``gogo_chat_sessions``."""

from __future__ import annotations

import json
import re
import time
from typing import Any

from gogo.persistence.db import db_connection_lock, get_db, run_db_with_retry
from gogo.persistence.session_context_fields import (
    context_from_flat_row,
    flat_fields_from_context,
    normalize_workspace_group_key,
    normalize_workspace_root_for_storage,
    residual_context_json,
    resolve_primary_model_name,
)
from gogo.persistence.timestamps import iso_z_to_ms, ms_to_iso_z, now_iso_z
from gogo.timeutil import utc_now_iso_z

MAIN_SESSION_KEY = "agent:main:main"

SESSION_STATUS_ACTIVE = "active"
SESSION_STATUS_PREWARMED = "prewarmed"

WORKSPACE_GROUP_UNBOUND = "__unbound__"
WORKSPACE_GROUP_VIRTUAL = "__virtual__"
WORKSPACE_GROUP_PROACTIVE = "__proactive__"

# Sidebar workspace_key: forward slashes, no trailing slash, lowercase.
_WORKSPACE_ROOT_SQL_NORM = "LOWER(RTRIM(REPLACE(TRIM(local_workspace_root), '\\', '/'), '/'))"

_NEW_DRAFT_SESSION_KEY_RE = re.compile(r"^agent:[^:]+:new-[a-z0-9]+$", re.IGNORECASE)

# Short-TTL cache for find_session_key_by_thread_id — this function is called by
# 7+ middlewares (15+ call sites) during a single model turn, all querying the same
# thread_id. A 5-second TTL eliminates 10-20+ redundant SQLite SELECTs per turn
# while staying fresh enough for session creation/switching.
_session_key_cache: dict[str, tuple[str | None, float]] = {}
_SESSION_KEY_CACHE_TTL = 5.0


def invalidate_session_key_cache(thread_id: str | None = None) -> None:
    """Clear the session_key lookup cache (call after session creation or thread binding changes)."""
    if thread_id:
        _session_key_cache.pop(str(thread_id).strip(), None)
    else:
        _session_key_cache.clear()


def is_new_draft_session_key(session_key: str | None) -> bool:
    return bool(_NEW_DRAFT_SESSION_KEY_RE.match(str(session_key or "").strip()))


_PLACEHOLDER_SESSION_TITLES = frozenset(
    {
        "新对话",
        "new conversation",
    }
)


def is_placeholder_session_title(title: str | None) -> bool:
    t = str(title or "").strip()
    if not t:
        return True
    return t.casefold() in {x.casefold() for x in _PLACEHOLDER_SESSION_TITLES}


# 侧栏会话标题展示上限（自动生成 / 落库统一按此截断）
SESSION_SIDEBAR_TITLE_MAX_CHARS = 30


def clip_session_sidebar_title(
    title: str | None,
    *,
    max_chars: int = SESSION_SIDEBAR_TITLE_MAX_CHARS,
) -> str:
    """Clip stored sidebar title to ``max_chars`` (Unicode code points)."""
    t = str(title or "").strip()
    if not t:
        return ""
    cap = max(1, int(max_chars))
    if len(t) <= cap:
        return t
    return t[:cap].rstrip()


def is_provisional_session_title(title: str | None) -> bool:
    """Truncated first-message hint (``…`` suffix) — not a final LLM title."""
    t = str(title or "").strip()
    if not t:
        return False
    return t.endswith("...")


def is_replaceable_session_title(title: str | None) -> bool:
    """Placeholder or provisional title may be overwritten by first message or LLM."""
    return is_placeholder_session_title(title) or is_provisional_session_title(title)


def provisional_session_title_from_user_text(
    user_msg: str,
    *,
    max_chars: int = SESSION_SIDEBAR_TITLE_MAX_CHARS,
) -> str:
    text = str(user_msg or "").strip()
    if not text:
        return ""
    cap = max(1, int(max_chars))
    if len(text) > cap:
        return text[:cap].rstrip() + "..."
    return text


def resolve_session_title_for_upsert(
    existing_title: str | None,
    incoming_title: str | None,
) -> str:
    """INSERT title column; empty string => ON CONFLICT keeps ``gogo_chat_sessions.title``."""
    if incoming_title is None:
        return ""
    inc = str(incoming_title).strip()
    ex = str(existing_title or "").strip()
    if not inc:
        return ""
    if not is_placeholder_session_title(inc):
        if is_provisional_session_title(inc):
            return inc
        return clip_session_sidebar_title(inc)
    if ex and not is_placeholder_session_title(ex):
        return ""
    return inc


_SESSION_SELECT_BASE = """
    session_key, thread_id, title, created_at, updated_at, message_count, context_json,
    local_workspace_root, use_virtual_paths, model_name, primary_model_name, session_mode,
    thinking_enabled, reasoning_effort, is_plan_mode, subagent_enabled, include_search,
    memory_enabled, use_claude_code_chat, collab_phase, collab_task_id, agent_id,
    session_status, tool_approval_policy,
    active_tools_json, pending_tools_json,
    run_status, current_run_id, current_turn_started_at, current_turn_ended_at,
    input_tokens, output_tokens, total_tokens,
    cache_read_tokens, cache_creation_tokens, cache_miss_tokens,
    is_pinned, pin_order, hidden_from_list
"""

_session_select_cache: str | None = None


def _session_select() -> str:
    """Include ownership columns when present (schema v134+)."""
    global _session_select_cache
    if _session_select_cache is not None:
        return _session_select_cache
    try:
        cols = {r[1] for r in get_db().execute("PRAGMA table_info(gogo_chat_sessions)").fetchall()}
        if "org_id" in cols and "scope_id" in cols and "created_by" in cols:
            _session_select_cache = (
                _SESSION_SELECT_BASE.rstrip() + ",\n    org_id, scope_id, created_by\n"
            )
        else:
            _session_select_cache = _SESSION_SELECT_BASE
    except Exception:
        _session_select_cache = _SESSION_SELECT_BASE
    return _session_select_cache


def invalidate_session_select_cache() -> None:
    global _session_select_cache
    _session_select_cache = None


# Legacy name: many call sites use f"{_SESSION_SELECT}". Keep as property-like
# by refreshing from _session_select() at module access time via a thin wrapper.
class _SessionSelectProxy:
    def __str__(self) -> str:
        return _session_select()

    def __format__(self, spec: str) -> str:
        return format(_session_select(), spec)


_SESSION_SELECT = _SessionSelectProxy()


def _parse_session_tool_names_json(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x).strip().lower() for x in raw if str(x or "").strip()]
    s = str(raw).strip()
    if not s:
        return []
    try:
        data = json.loads(s)
    except Exception:
        return []
    if isinstance(data, list):
        return [str(x).strip().lower() for x in data if str(x or "").strip()]
    return []


def _scenarios_from_session_mode(mode: str | None) -> list[str]:
    """Derive the active-scenario list from ``session_mode``.

    Inverse of ``derive_session_mode``: plan→['plan'], agent→['agent'], else→[].
    """
    m = str(mode or "").strip().lower()
    if m == "plan":
        return ["plan"]
    if m == "agent":
        return ["agent"]
    return []


def get_session_activated_scenarios(session_key: str) -> list[str]:
    """Active scenario keys for a chat session (empty => default chat).

    Derived from the persisted ``session_mode`` (the single source of truth
    after the v75 migration dropped ``activated_scenarios_json``).
    """
    return _scenarios_from_session_mode(get_session_mode(session_key))


def get_session_activated_scenarios_for_thread(thread_id: str) -> list[str]:
    sk = find_session_key_by_thread_id(thread_id)
    if not sk:
        return []
    return get_session_activated_scenarios(sk)


def get_session_mode(session_key: str) -> str:
    """Persisted UI mode for a chat session (auto / ask / agent / plan)."""
    sk = str(session_key or "").strip()
    if not sk or is_session_deleted(sk):
        return ""
    row = (
        get_db()
        .execute(
            "SELECT session_mode FROM gogo_chat_sessions WHERE session_key = ? AND is_deleted = 0",
            (sk,),
        )
        .fetchone()
    )
    if not row:
        return ""
    return str(row[0] or "").strip().lower()


def derive_session_mode(scenarios: list[str]) -> str:
    """Derive ``session_mode`` from activated scenario keys.

    Canonical mapping: plan→plan, agent→agent, empty/ask→auto.
    Legacy aliases (web/workspace/file/execute/…) are normalized first via
    :func:`normalize_scenario_key` so that e.g. ``["web"]`` maps to ``agent``.
    This is the **single source of truth** for scenario→mode derivation —
    all callers must use this function instead of inline logic.
    """
    from gogo.agents.lead_agent.intent_tool_profile import normalize_scenario_key

    norm = [
        normalize_scenario_key(s)
        for s in (scenarios or [])
        if str(s or "").strip()
    ]
    if "plan" in norm:
        return "plan"
    if "agent" in norm:
        return "agent"
    return "auto"


def set_session_mode(
    session_key: str,
    mode: str,
    *,
    conn: Any = None,
) -> None:
    """Update ``session_mode`` on ``gogo_chat_sessions`` (single write entry point).

    Use this when only the mode needs updating (not the scenario list).
    For scenario + mode updates together, prefer ``set_session_activated_scenarios``.
    """
    sk = str(session_key or "").strip()
    if not sk or is_session_deleted(sk):
        return
    norm_mode = str(mode or "").strip().lower() or "auto"
    db = conn or get_db()
    db.execute(
        """
        UPDATE gogo_chat_sessions
        SET session_mode = ?
        WHERE session_key = ? AND is_deleted = 0
        """,
        (norm_mode, sk),
    )
    if conn is None:
        db.commit()


def set_session_activated_scenarios(
    session_key: str,
    scenarios: list[str],
    *,
    conn: Any = None,
) -> None:
    """Persist scenario activation on ``gogo_chat_sessions``.

    Delegates to ``set_session_mode`` (passing ``derive_session_mode``) — after
    the v75 migration ``activated_scenarios_json`` was dropped, so
    ``session_mode`` is the single source of truth.
    """
    set_session_mode(session_key, derive_session_mode(scenarios), conn=conn)


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _loads(raw: str | None) -> Any:
    if not raw:
        return None
    return json.loads(raw)


def _row_dict(row: Any) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def _session_row_to_api(d: dict[str, Any]) -> dict[str, Any]:
    """Sidebar / API row with flat workspace + model fields for display."""
    from gogo.persistence.permission_preset_store import (
        effective_preset,
        get_session_preset_raw,
    )
    from gogo.persistence.tool_approval_policy import (
        effective_policy,
        get_global_default_policy,
        normalize_policy,
    )

    sk = str(d.get("session_key") or "")
    ctx = context_from_flat_row(d)
    raw_policy = d.get("tool_approval_policy")
    session_policy = normalize_policy(str(raw_policy)) if raw_policy is not None and str(raw_policy).strip() else None
    try:
        effective_tool_policy = effective_policy(sk) if sk else get_global_default_policy()
    except Exception:
        effective_tool_policy = session_policy or get_global_default_policy()
    try:
        session_permission_preset = get_session_preset_raw(sk) if sk else None
        effective_permission_preset = effective_preset(sk) if sk else None
    except Exception:
        session_permission_preset = None
        effective_permission_preset = None
    from gogo.persistence.session_run_state import normalize_run_status

    stored_active = _parse_session_tool_names_json(d.get("active_tools_json"))
    stored_pending = _parse_session_tool_names_json(d.get("pending_tools_json"))
    active_tools = stored_active
    pending_tools = stored_pending
    # Prefer live agent∩mode derivation so UI/DB readers never trust a stale
    # main-mode snapshot after an in-session role switch.
    try:
        from gogo.persistence.session_tool_binding_repositories import _derive_tool_fields_for_mode

        mode = str(d.get("session_mode") or "ask").strip().lower() or "ask"
        derived = _derive_tool_fields_for_mode(sk, mode) if sk else {}
        if derived:
            # Do not use ``or`` — empty pending [] is valid for narrow allowlists.
            active_tools = list(derived.get("active_tools", stored_active))
            pending_tools = list(derived.get("pending_tools", stored_pending))
    except Exception:
        pass

    return {
        "sessionKey": sk,
        "key": sk,
        "threadId": str(d.get("thread_id") or "").strip() or None,
        "title": str(d.get("title") or "").strip(),
        "createdAt": iso_z_to_ms(d.get("created_at")),
        "updatedAt": iso_z_to_ms(d.get("updated_at")),
        "messageCount": int(d.get("message_count") or 0),
        "context": ctx,
        "localWorkspaceRoot": str(d.get("local_workspace_root") or "").strip() or None,
        "useVirtualPaths": bool(int(d.get("use_virtual_paths") or 0)),
        "modelName": str(d.get("model_name") or "").strip() or None,
        "primaryModelName": str(d.get("primary_model_name") or "").strip() or None,
        "sessionMode": str(d.get("session_mode") or "").strip() or None,
        "thinkingEnabled": bool(int(d.get("thinking_enabled") or 0)) if d.get("thinking_enabled") is not None else None,
        "reasoningEffort": str(d.get("reasoning_effort") or "").strip() or None,
        "isPlanMode": bool(int(d.get("is_plan_mode") or 0)) if d.get("is_plan_mode") is not None else None,
        "subagentEnabled": bool(int(d.get("subagent_enabled") or 0)) if d.get("subagent_enabled") is not None else None,
        "includeSearch": bool(int(d.get("include_search") or 0)) if d.get("include_search") is not None else None,
        "memoryEnabled": bool(int(d.get("memory_enabled") or 0)) if d.get("memory_enabled") is not None else None,
        "useClaudeCodeChat": bool(int(d.get("use_claude_code_chat") or 0)) if d.get("use_claude_code_chat") is not None else None,
        "collabPhase": str(d.get("collab_phase") or "").strip() or None,
        "collabTaskId": str(d.get("collab_task_id") or "").strip() or None,
        "agentId": str(d.get("agent_id") or "").strip() or None,
        "sessionStatus": str(d.get("session_status") or SESSION_STATUS_ACTIVE).strip() or SESSION_STATUS_ACTIVE,
        "activatedScenarios": _scenarios_from_session_mode(d.get("session_mode")),
        "activeTools": active_tools,
        "pendingTools": pending_tools,
        "toolApprovalPolicy": session_policy,
        "effectiveToolApprovalPolicy": effective_tool_policy,
        "permissionPreset": session_permission_preset,
        "effectivePermissionPreset": effective_permission_preset,
        "runStatus": normalize_run_status(str(d.get("run_status") or "")),
        "currentRunId": str(d.get("current_run_id") or "").strip() or None,
        "currentTurnStartedAt": str(d.get("current_turn_started_at") or "").strip() or None,
        "currentTurnEndedAt": str(d.get("current_turn_ended_at") or "").strip() or None,
        "inputTokens": int(d.get("input_tokens") or 0),
        "outputTokens": int(d.get("output_tokens") or 0),
        "totalTokens": int(d.get("total_tokens") or 0),
        "cacheReadTokens": int(d.get("cache_read_tokens") or 0),
        "cacheCreationTokens": int(d.get("cache_creation_tokens") or 0),
        "cacheMissTokens": int(d.get("cache_miss_tokens") or 0),
        "isPinned": bool(int(d.get("is_pinned") or 0)),
        "pinOrder": int(d.get("pin_order") or 0),
        "hiddenFromList": bool(int(d.get("hidden_from_list") or 0)),
        "orgId": str(d.get("org_id") or "").strip() or None,
        "scopeId": str(d.get("scope_id") or "").strip() or None,
        "createdBy": str(d.get("created_by") or "").strip() or None,
    }


def _session_row_to_map_entry(d: dict[str, Any]) -> dict[str, Any]:
    api = _session_row_to_api(d)
    return {
        "threadId": api["threadId"],
        "title": api["title"],
        "createdAt": api["createdAt"],
        "updatedAt": api["updatedAt"],
        "messageCount": api["messageCount"],
        "context": api["context"],
    }


def session_count(*, include_deleted: bool = False) -> int:
    if include_deleted:
        row = get_db().execute("SELECT COUNT(*) FROM gogo_chat_sessions").fetchone()
    else:
        row = get_db().execute("SELECT COUNT(*) FROM gogo_chat_sessions WHERE is_deleted = 0").fetchone()
    return int(row[0]) if row else 0


def is_session_deleted(session_key: str) -> bool:
    row = (
        get_db()
        .execute(
            "SELECT is_deleted FROM gogo_chat_sessions WHERE session_key = ?",
            (session_key.strip(),),
        )
        .fetchone()
    )
    if not row:
        return False
    val = row[0]
    return bool(val) if val is None else bool(int(val))


def load_session_map() -> dict[str, dict[str, Any]]:
    """Return map shape compatible with EvoPanel ``loadSessionMap()``."""
    rows = (
        get_db()
        .execute(
            f"""
        SELECT {_SESSION_SELECT}
        FROM gogo_chat_sessions
        WHERE is_deleted = 0
          AND COALESCE(session_status, '{SESSION_STATUS_ACTIVE}') != '{SESSION_STATUS_PREWARMED}'
          AND session_key NOT LIKE 'agent:executor:%'
        """
        )
        .fetchall()
    )
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        d = _row_dict(row)
        sk = str(d["session_key"])
        out[sk] = _session_row_to_map_entry(d)
    return out


def list_tombstone_keys(*, limit: int = 500) -> list[str]:
    rows = (
        get_db()
        .execute(
            """
        SELECT session_key FROM gogo_chat_sessions
        WHERE is_deleted = 1
        ORDER BY updated_at DESC
        LIMIT ?
        """,
            (max(1, int(limit)),),
        )
        .fetchall()
    )
    return [str(r[0]) for r in rows if r and r[0]]


def merge_session_map(session_map: dict[str, Any]) -> None:
    """Upsert sessions from client without removing DB-only rows.

    IMPORTANT: This is a metadata-only sync (thread_id, title, context, etc).
    It must NOT overwrite ``updated_at`` with the client's clock -- doing so
    batches all sessions to the same timestamp and destroys the real
    last-activity time shown in the sidebar.  Pass ``updated_at_ms=0`` so
    ``_upsert_session_row_impl`` preserves each row's existing ``updated_at``.
    """
    with db_connection_lock():
        conn = get_db()
        now = utc_now_iso_z()
        for sk, meta in (session_map or {}).items():
            if not isinstance(meta, dict):
                continue
            key = str(sk).strip()
            if not key or is_session_deleted(key):
                continue
            upsert_session_row(
                key,
                thread_id=str(meta.get("threadId") or meta.get("thread_id") or "").strip() or None,
                created_at_ms=int(meta.get("createdAt") or meta.get("created_at_ms") or 0),
                updated_at_ms=0,
                message_count=int(meta.get("messageCount") or meta.get("message_count") or 0),
                context=meta.get("context") if isinstance(meta.get("context"), dict) else {},
                conn=conn,
                now=now,
            )
        conn.commit()


def replace_session_map(session_map: dict[str, Any]) -> None:
    """Full replace of active sessions (explicit import only)."""
    with db_connection_lock():
        conn = get_db()
        conn.execute("DELETE FROM gogo_chat_sessions WHERE is_deleted = 0")
        for sk, meta in (session_map or {}).items():
            if not isinstance(meta, dict):
                continue
            key = str(sk).strip()
            if not key:
                continue
            upsert_session_row(
                key,
                thread_id=str(meta.get("threadId") or meta.get("thread_id") or "").strip() or None,
                created_at_ms=int(meta.get("createdAt") or meta.get("created_at_ms") or 0),
                updated_at_ms=int(meta.get("updatedAt") or meta.get("updated_at_ms") or 0),
                message_count=int(meta.get("messageCount") or meta.get("message_count") or 0),
                context=meta.get("context") if isinstance(meta.get("context"), dict) else {},
                conn=conn,
            )
        conn.commit()


def resolve_thread_bindings_for_session_keys(
    session_keys: list[str],
    *,
    max_keys: int = 32,
) -> list[tuple[str, str]]:
    """Return ``(session_key, thread_id)`` for known sidebar keys (no LangGraph scan)."""
    keys = [str(k).strip() for k in session_keys if str(k).strip()][: max(1, int(max_keys))]
    if not keys:
        return []
    placeholders = ",".join("?" * len(keys))
    rows = (
        get_db()
        .execute(
            f"""
        SELECT session_key, thread_id FROM gogo_chat_sessions
        WHERE is_deleted = 0
          AND session_key IN ({placeholders})
          AND thread_id IS NOT NULL AND TRIM(thread_id) != ''
        """,
            keys,
        )
        .fetchall()
    )
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        sk = str(row[0] or "").strip()
        tid = str(row[1] or "").strip()
        if not sk or not tid or sk in seen:
            continue
        seen.add(sk)
        out.append((sk, tid))
    return out


def repair_session_thread_binding(session_key: str, thread_id: str) -> bool:
    """Align ``gogo_chat_sessions.thread_id`` when transcript already uses ``thread_id``."""
    from gogo.collab.thread_ids import resolve_langgraph_lead_thread_id

    sk = str(session_key or "").strip()
    tid = resolve_langgraph_lead_thread_id(thread_id) or str(thread_id or "").strip()
    if not sk or not tid:
        return False

    def _do() -> bool:
        db = get_db()
        row = db.execute(
            "SELECT thread_id FROM gogo_chat_sessions WHERE session_key = ? AND is_deleted = 0",
            (sk,),
        ).fetchone()
        if not row:
            return False
        current = str(row[0] or "").strip()
        if current == tid:
            return True
        db.execute(
            "UPDATE gogo_chat_sessions SET thread_id = ? WHERE session_key = ? AND is_deleted = 0",
            (tid, sk),
        )
        db.commit()
        return True


    return run_db_with_retry(_do)


def resolve_titles_by_thread_ids(thread_ids: list[str]) -> dict[str, str]:
    """Resolve sidebar titles for LangGraph ``thread_id`` values (best-effort batch)."""
    ids: list[str] = []
    seen: set[str] = set()
    for raw in thread_ids:
        tid = str(raw or "").strip()
        if not tid or tid in seen:
            continue
        seen.add(tid)
        ids.append(tid)
    if not ids:
        return {}
    out: dict[str, str] = {}
    db = get_db()
    for i in range(0, len(ids), 50):
        chunk = ids[i : i + 50]
        placeholders = ",".join("?" * len(chunk))
        rows = db.execute(
            f"""
            SELECT thread_id, title, updated_at
            FROM gogo_chat_sessions
            WHERE is_deleted = 0 AND thread_id IN ({placeholders})
            ORDER BY updated_at DESC
            """,
            chunk,
        ).fetchall()
        for row in rows:
            tid = str(row[0] or "").strip()
            title = str(row[1] or "").strip()
            if not tid or tid in out:
                continue
            if not title or is_placeholder_session_title(title):
                continue
            out[tid] = title
    return out


def find_session_key_by_thread_id(thread_id: str) -> str | None:
    """Resolve sidebar ``session_key`` for a LangGraph ``thread_id`` (best-effort).

    Uses a 5-second TTL cache to avoid redundant SELECTs across the middleware chain
    (7+ middlewares call this per model turn). Call ``invalidate_session_key_cache``
    after creating a new session or changing thread binding.
    """
    tid = str(thread_id or "").strip()
    if not tid:
        return None
    now = time.monotonic()
    cached = _session_key_cache.get(tid)
    if cached is not None and now - cached[1] < _SESSION_KEY_CACHE_TTL:
        return cached[0]
    row = (
        get_db()
        .execute(
            """
        SELECT session_key FROM gogo_chat_sessions
        WHERE is_deleted = 0 AND thread_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
        """,
            (tid,),
        )
        .fetchone()
    )
    if row:
        key = str(row[0] or "").strip()
        if key:
            _session_key_cache[tid] = (key, now)
            return key
    # Transcript rows may carry the task-bound thread before the session row catches up.
    row = (
        get_db()
        .execute(
            """
        SELECT session_key FROM gogo_chat_messages
        WHERE thread_id = ?
        GROUP BY session_key
        ORDER BY MAX(seq) DESC
        LIMIT 1
        """,
            (tid,),
        )
        .fetchone()
    )
    if not row:
        from gogo.collab.thread_ids import lead_thread_from_executor_thread

        lead = lead_thread_from_executor_thread(tid)
        if lead and lead != tid:
            return find_session_key_by_thread_id(lead)
        return None
    key = str(row[0] or "").strip()
    if key:
        repair_session_thread_binding(key, tid)
    return key or None


def get_model_name_for_session_key(session_key: str) -> str | None:
    """Resolve persisted session ``model_name`` by sidebar session key."""
    sk = str(session_key or "").strip()
    if not sk:
        return None
    row = (
        get_db()
        .execute(
            """
        SELECT model_name FROM gogo_chat_sessions
        WHERE is_deleted = 0 AND session_key = ?
        LIMIT 1
        """,
            (sk,),
        )
        .fetchone()
    )
    if row:
        name = str(row[0] or "").strip()
        if name:
            return name
    return None


def get_model_name_for_thread(thread_id: str) -> str | None:
    """Resolve session model_name for a LangGraph thread_id (best-effort DB lookup).

    Used as a last-resort fallback when runtime.context and get_config() both
    fail to provide model_name (e.g. context not yet injected by LangGraph).
    """
    tid = str(thread_id or "").strip()
    if not tid:
        return None
    row = (
        get_db()
        .execute(
            """
        SELECT model_name FROM gogo_chat_sessions
        WHERE is_deleted = 0 AND thread_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
        """,
            (tid,),
        )
        .fetchone()
    )
    if row:
        name = str(row[0] or "").strip()
        if name:
            return name
    # Fallback: resolve via session_key from messages table
    sk = find_session_key_by_thread_id(tid)
    if sk and sk != tid:
        row = (
            get_db()
            .execute(
                """
            SELECT model_name FROM gogo_chat_sessions
            WHERE is_deleted = 0 AND session_key = ?
            LIMIT 1
            """,
                (sk,),
            )
            .fetchone()
        )
        if row:
            name = str(row[0] or "").strip()
            if name:
                return name
    return None


def activate_session_if_prewarmed(session_key: str, *, conn: Any = None) -> None:
    sk = str(session_key or "").strip()
    if not sk:
        return
    db = conn or get_db()
    db.execute(
        f"""
        UPDATE gogo_chat_sessions
        SET session_status = '{SESSION_STATUS_ACTIVE}'
        WHERE session_key = ? AND session_status = '{SESSION_STATUS_PREWARMED}'
        """,
        (sk,),
    )
    if conn is None:
        db.commit()


def upsert_session_row(
    session_key: str,
    *,
    thread_id: str | None = None,
    created_at_ms: int | None = None,
    updated_at_ms: int | None = None,
    message_count: int | None = None,
    context: dict[str, Any] | None = None,
    title: str | None = None,
    session_status: str | None = None,
    activated_scenarios: list[str] | None = None,
    conn: Any = None,
    now: str | None = None,
    **flat_overrides: Any,
) -> None:
    if conn is not None:
        _upsert_session_row_impl(
            session_key,
            thread_id=thread_id,
            created_at_ms=created_at_ms,
            updated_at_ms=updated_at_ms,
            message_count=message_count,
            context=context,
            title=title,
            session_status=session_status,
            activated_scenarios=activated_scenarios,
            conn=conn,
            now=now,
            **flat_overrides,
        )
        return
    from gogo.persistence.db import run_db_transaction

    bootstrap_lwr: list[str] = []

    def _write(db: Any) -> None:
        _upsert_session_row_impl(
            session_key,
            thread_id=thread_id,
            created_at_ms=created_at_ms,
            updated_at_ms=updated_at_ms,
            message_count=message_count,
            context=context,
            title=title,
            session_status=session_status,
            activated_scenarios=activated_scenarios,
            conn=db,
            now=now,
            _defer_workspace_bootstrap=bootstrap_lwr,
            **flat_overrides,
        )

    run_db_transaction(_write)


def _upsert_session_row_impl(
    session_key: str,
    *,
    thread_id: str | None = None,
    created_at_ms: int | None = None,
    updated_at_ms: int | None = None,
    message_count: int | None = None,
    context: dict[str, Any] | None = None,
    title: str | None = None,
    session_status: str | None = None,
    activated_scenarios: list[str] | None = None,
    conn: Any = None,
    now: str | None = None,
    _defer_workspace_bootstrap: list[str] | None = None,
    **flat_overrides: Any,
) -> None:
    key = session_key.strip()
    if not key:
        return
    db = conn or get_db()
    ts = now or utc_now_iso_z()
    existing_row = db.execute(
        f"SELECT {_SESSION_SELECT} FROM gogo_chat_sessions WHERE session_key = ?",
        (key,),
    ).fetchone()
    existing = _row_dict(existing_row) if existing_row else None
    created_iso = ms_to_iso_z(created_at_ms) if created_at_ms else ""
    if existing and not created_iso:
        created_iso = str(existing.get("created_at") or "")
    if not created_iso:
        created_iso = ts
    # Activity time rules:
    # - explicit updated_at_ms > 0: take max(existing, incoming) by epoch ms
    # - metadata-only upsert (0/None) on existing row: never invent a new time
    #   (avoids restart/reconcile paths batching every session to the same stamp)
    # - insert: default to created_at
    prev_updated = str((existing or {}).get("updated_at") or "")
    explicit_updated = ms_to_iso_z(updated_at_ms) if updated_at_ms else ""
    if explicit_updated:
        if prev_updated and iso_z_to_ms(prev_updated) > iso_z_to_ms(explicit_updated):
            updated_iso = prev_updated
        else:
            updated_iso = explicit_updated
    elif prev_updated:
        updated_iso = prev_updated
    else:
        updated_iso = created_iso

    merged_ctx: dict[str, Any] = {}
    if existing:
        merged_ctx = context_from_flat_row(existing)
    clear_model_name = False
    if context is not None:
        merged_ctx = {**merged_ctx, **context}
        for k, v in list(context.items()):
            if v is None:
                merged_ctx.pop(k, None)
        # Explicit null/empty model_name in PATCH must clear the flat column (COALESCE would keep old).
        if "model_name" in context and not str(context.get("model_name") or "").strip():
            clear_model_name = True
            merged_ctx.pop("model_name", None)

    primary = resolve_primary_model_name()
    if key == MAIN_SESSION_KEY and primary:
        merged_ctx.setdefault("primary_model_name", primary)

    flat = flat_fields_from_context(merged_ctx, session_key=key, primary_model_name=primary)
    for fk, fv in flat_overrides.items():
        if fv is not None:
            flat[fk] = fv
    if clear_model_name:
        flat["model_name"] = None

    ctx_json = residual_context_json(merged_ctx)
    title_for_row = resolve_session_title_for_upsert(
        str(existing.get("title") or "") if existing else None,
        title,
    )
    status_for_row = str(session_status).strip() if session_status is not None else str((existing or {}).get("session_status") or SESSION_STATUS_ACTIVE).strip() or SESSION_STATUS_ACTIVE
    if activated_scenarios is not None:
        flat["session_mode"] = derive_session_mode(activated_scenarios)

    from gogo.persistence.tool_approval_policy import normalize_policy, policy_for_new_session

    update_policy = "tool_approval_policy" in flat_overrides
    if not existing:
        policy_val = policy_for_new_session(flat_overrides.get("tool_approval_policy"))
        # Align with create_new_session / EvoPanel「新建对话」→ Agent（非 Ask）
        if not str(flat.get("session_mode") or "").strip():
            flat["session_mode"] = "agent"
    elif update_policy:
        raw_p = flat_overrides.get("tool_approval_policy")
        policy_val = normalize_policy(str(raw_p)) if raw_p is not None and str(raw_p).strip() else None
    else:
        raw_existing = (existing or {}).get("tool_approval_policy")
        policy_val = normalize_policy(str(raw_existing)) if raw_existing is not None and str(raw_existing).strip() else None

    db.execute(
        """
        INSERT INTO gogo_chat_sessions (
            session_key, thread_id, title, created_at, updated_at,
            message_count, context_json, is_deleted,
            local_workspace_root, use_virtual_paths, model_name, primary_model_name,
            session_mode, thinking_enabled, reasoning_effort, is_plan_mode,
            subagent_enabled, include_search, memory_enabled, use_claude_code_chat,
            collab_phase, collab_task_id, agent_id, session_status,
            tool_approval_policy
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_key) DO UPDATE SET
            thread_id = COALESCE(excluded.thread_id, gogo_chat_sessions.thread_id),
            title = CASE
                WHEN excluded.title IS NOT NULL AND TRIM(excluded.title) != '' THEN excluded.title
                ELSE gogo_chat_sessions.title
            END,
            created_at = CASE
                WHEN gogo_chat_sessions.created_at IS NOT NULL AND TRIM(gogo_chat_sessions.created_at) != ''
                THEN gogo_chat_sessions.created_at
                ELSE excluded.created_at
            END,
            updated_at = CASE
                WHEN gogo_chat_sessions.updated_at > excluded.updated_at THEN gogo_chat_sessions.updated_at
                ELSE excluded.updated_at
            END,
            message_count = CASE
                WHEN excluded.message_count > 0 THEN excluded.message_count
                ELSE gogo_chat_sessions.message_count
            END,
            context_json = COALESCE(NULLIF(excluded.context_json, ''), gogo_chat_sessions.context_json),
            local_workspace_root = COALESCE(NULLIF(excluded.local_workspace_root, ''), gogo_chat_sessions.local_workspace_root),
            use_virtual_paths = COALESCE(excluded.use_virtual_paths, gogo_chat_sessions.use_virtual_paths),
            model_name = CASE
                WHEN ? = 1 THEN NULL
                ELSE COALESCE(NULLIF(excluded.model_name, ''), gogo_chat_sessions.model_name)
            END,
            primary_model_name = COALESCE(NULLIF(excluded.primary_model_name, ''), gogo_chat_sessions.primary_model_name),
            session_mode = COALESCE(NULLIF(excluded.session_mode, ''), gogo_chat_sessions.session_mode),
            thinking_enabled = COALESCE(excluded.thinking_enabled, gogo_chat_sessions.thinking_enabled),
            reasoning_effort = COALESCE(NULLIF(excluded.reasoning_effort, ''), gogo_chat_sessions.reasoning_effort),
            is_plan_mode = COALESCE(excluded.is_plan_mode, gogo_chat_sessions.is_plan_mode),
            subagent_enabled = COALESCE(excluded.subagent_enabled, gogo_chat_sessions.subagent_enabled),
            include_search = COALESCE(excluded.include_search, gogo_chat_sessions.include_search),
            memory_enabled = COALESCE(excluded.memory_enabled, gogo_chat_sessions.memory_enabled),
            use_claude_code_chat = COALESCE(excluded.use_claude_code_chat, gogo_chat_sessions.use_claude_code_chat),
            collab_phase = COALESCE(NULLIF(excluded.collab_phase, ''), gogo_chat_sessions.collab_phase),
            collab_task_id = COALESCE(NULLIF(excluded.collab_task_id, ''), gogo_chat_sessions.collab_task_id),
            agent_id = COALESCE(NULLIF(excluded.agent_id, ''), gogo_chat_sessions.agent_id),
            session_status = CASE
                WHEN excluded.session_status IS NOT NULL AND TRIM(excluded.session_status) != ''
                THEN excluded.session_status
                ELSE gogo_chat_sessions.session_status
            END,
            tool_approval_policy = CASE
                WHEN ? = 1 THEN excluded.tool_approval_policy
                ELSE gogo_chat_sessions.tool_approval_policy
            END,
            is_deleted = 0
        """,
        (
            key,
            thread_id,
            title_for_row,
            created_iso,
            updated_iso,
            int(message_count or 0),
            ctx_json,
            flat.get("local_workspace_root"),
            int(flat.get("use_virtual_paths") or 0),
            flat.get("model_name"),
            flat.get("primary_model_name"),
            flat.get("session_mode"),
            flat.get("thinking_enabled"),
            flat.get("reasoning_effort"),
            flat.get("is_plan_mode"),
            flat.get("subagent_enabled"),
            flat.get("include_search"),
            flat.get("memory_enabled"),
            flat.get("use_claude_code_chat"),
            flat.get("collab_phase"),
            flat.get("collab_task_id"),
            flat.get("agent_id"),
            status_for_row,
            policy_val,
            1 if clear_model_name else 0,
            1 if (not existing or update_policy) else 0,
        ),
    )

    if not existing:
        try:
            from gogo.session_tool_binding.service import seed_session_tool_bindings

            seed_session_tool_bindings(key, thread_id=str(thread_id or "").strip() or None)
        except Exception:
            pass


def mark_session_deleted(session_key: str) -> None:
    key = session_key.strip()
    if not key or key == MAIN_SESSION_KEY:
        return

    def _do() -> None:
        now = utc_now_iso_z()
        from gogo.persistence import chat_message_repositories as msg_repo

        msg_repo.delete_messages_for_session(key)
        get_db().execute(
            """
            INSERT INTO gogo_chat_sessions (
                session_key, thread_id, title, created_at, updated_at,
                message_count, context_json, is_deleted
            ) VALUES (?, '', '', '', ?, 0, '{}', 1)
            ON CONFLICT(session_key) DO UPDATE SET
                is_deleted = 1,
                updated_at = excluded.updated_at,
                message_count = 0
            """,
            (key, now),
        )
        get_db().commit()


    run_db_with_retry(_do)


def delete_sessions_by_thread_id(thread_id: str) -> None:
    tid = thread_id.strip()
    if not tid:
        return

    def _do() -> None:
        get_db().execute("DELETE FROM gogo_chat_sessions WHERE thread_id = ?", (tid,))
        get_db().commit()


    run_db_with_retry(_do)


def get_session_row_for_ui(session_key: str) -> dict[str, Any] | None:
    sk = str(session_key or "").strip()
    if not sk or is_session_deleted(sk):
        return None
    row = (
        get_db()
        .execute(
            f"""
        SELECT {_SESSION_SELECT}
        FROM gogo_chat_sessions
        WHERE session_key = ? AND is_deleted = 0
        """,
            (sk,),
        )
        .fetchone()
    )
    if not row:
        return None
    d = _row_dict(row)
    primary = resolve_primary_model_name()
    if primary and not d.get("primary_model_name"):
        d["primary_model_name"] = primary
    api = _session_row_to_api(d)
    enriched = enrich_session_rows_collab_task_id([api])
    return enriched[0] if enriched else api


def get_session_context_for_run_config(session_key: str) -> dict[str, Any]:
    """Lightweight session context for LangGraph resume (no collab enrich / task lookup)."""
    from gogo.persistence.session_context_fields import context_from_flat_row

    sk = str(session_key or "").strip()
    if not sk or is_session_deleted(sk):
        return {}
    row = (
        get_db()
        .execute(
            f"""
        SELECT {_SESSION_SELECT}
        FROM gogo_chat_sessions
        WHERE session_key = ? AND is_deleted = 0
        """,
            (sk,),
        )
        .fetchone()
    )
    if not row:
        return {}
    return context_from_flat_row(_row_dict(row))


def _next_pin_order(conn: Any) -> int:
    row = conn.execute(
        """
        SELECT COALESCE(MAX(pin_order), -1) + 1
        FROM gogo_chat_sessions
        WHERE is_deleted = 0 AND COALESCE(is_pinned, 0) != 0
        """
    ).fetchone()
    return int(row[0]) if row else 0


def set_session_pinned(session_key: str, *, pinned: bool, conn: Any = None) -> bool:
    """Pin or unpin a session for the sidebar."""
    sk = str(session_key or "").strip()
    if not sk or is_session_deleted(sk):
        return False
    db = conn or get_db()
    ts = now_iso_z()
    if pinned:
        order = _next_pin_order(db)
        db.execute(
            """
            UPDATE gogo_chat_sessions
            SET is_pinned = 1, pin_order = ?, updated_at = ?
            WHERE session_key = ? AND is_deleted = 0
            """,
            (order, ts, sk),
        )
    else:
        db.execute(
            """
            UPDATE gogo_chat_sessions
            SET is_pinned = 0, pin_order = 0, updated_at = ?
            WHERE session_key = ? AND is_deleted = 0
            """,
            (ts, sk),
        )
    if conn is None:
        db.commit()
    return True


def set_session_hidden_from_list(session_key: str, *, hidden: bool, conn: Any = None) -> bool:
    """Hide/show a session in the main sidebar list (automation runs default hidden)."""
    sk = str(session_key or "").strip()
    if not sk or is_session_deleted(sk):
        return False
    db = conn or get_db()
    ts = now_iso_z()
    db.execute(
        """
        UPDATE gogo_chat_sessions
        SET hidden_from_list = ?, updated_at = ?
        WHERE session_key = ? AND is_deleted = 0
        """,
        (1 if hidden else 0, ts, sk),
    )
    if conn is None:
        db.commit()
    return True


def archive_session(session_key: str, *, archived_at: str | None = None) -> bool:
    """Move a session into the recycle bin: hidden from the list + archived_at stamp.

    The row keeps its original local_workspace_root (project binding), so a later
    restore brings the session back to exactly the workspace it was archived from.
    """
    sk = str(session_key or "").strip()
    if not sk or is_session_deleted(sk):
        return False
    ts = archived_at or utc_now_iso_z()
    with db_connection_lock():
        db = get_db()
        row = db.execute(
            "SELECT context_json FROM gogo_chat_sessions WHERE session_key = ? AND is_deleted = 0",
            (sk,),
        ).fetchone()
        ctx: dict[str, Any] = {}
        if row and row[0]:
            try:
                ctx = json.loads(row[0])
            except Exception:
                ctx = {}
        ctx["archived_at"] = ts
        db.execute(
            """
            UPDATE gogo_chat_sessions
            SET hidden_from_list = 1, updated_at = ?, context_json = ?
            WHERE session_key = ? AND is_deleted = 0
            """,
            (now_iso_z(), json.dumps(ctx, ensure_ascii=False), sk),
        )
        db.commit()
    return True


def restore_session(session_key: str) -> bool:
    """Restore an archived session back to its original workspace.

    Clears the archived_at stamp and un-hides the session so it reappears under
    its original project folder (local_workspace_root is never touched).
    """
    sk = str(session_key or "").strip()
    if not sk or is_session_deleted(sk):
        return False
    with db_connection_lock():
        db = get_db()
        row = db.execute(
            "SELECT context_json FROM gogo_chat_sessions WHERE session_key = ? AND is_deleted = 0",
            (sk,),
        ).fetchone()
        ctx: dict[str, Any] = {}
        if row and row[0]:
            try:
                ctx = json.loads(row[0])
            except Exception:
                ctx = {}
        ctx.pop("archived_at", None)
        db.execute(
            """
            UPDATE gogo_chat_sessions
            SET hidden_from_list = 0, updated_at = ?, context_json = ?
            WHERE session_key = ? AND is_deleted = 0
            """,
            (now_iso_z(), json.dumps(ctx, ensure_ascii=False), sk),
        )
        db.commit()
    return True


def list_trash_sessions(**acl_kwargs: Any) -> list[dict[str, Any]]:
    """List archived (recycle-bin) sessions: hidden, non-deleted, still recoverable.

    Accepts the same ``acl_sql`` / ``acl_params`` kwargs as ``list_sessions_for_ui``
    so multi-tenant isolation also applies to the recycle bin.
    """
    sql = (
        f"SELECT {_SESSION_SELECT} FROM gogo_chat_sessions "
        "WHERE is_deleted = 0 AND hidden_from_list = 1"
    )
    params: list[Any] = []
    acl_sql = acl_kwargs.get("acl_sql")
    if acl_sql:
        sql += f" AND ({acl_sql})"
        params.extend(acl_kwargs.get("acl_params") or [])
    sql += " ORDER BY updated_at DESC"
    try:
        rows = get_db().execute(sql, params).fetchall()
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        api = _session_row_to_api(_row_dict(row))
        sk = str(api.get("sessionKey") or "").strip()
        archived_at: Any = None
        if sk:
            try:
                raw = get_db().execute(
                    "SELECT context_json FROM gogo_chat_sessions WHERE session_key = ?",
                    (sk,),
                ).fetchone()
                if raw and raw[0]:
                    archived_at = json.loads(raw[0]).get("archived_at")
            except Exception:
                archived_at = None
        api["archivedAt"] = archived_at
        out.append(api)
    return out


def reorder_pinned_sessions(ordered_keys: list[str], *, conn: Any = None) -> None:
    """Persist drag order for pinned sessions (keys not pinned are ignored)."""
    keys = [str(k or "").strip() for k in ordered_keys if str(k or "").strip()]
    if not keys:
        return

    def _write(db: Any) -> None:
        ts = now_iso_z()
        for idx, sk in enumerate(keys):
            db.execute(
                """
                UPDATE gogo_chat_sessions
                SET is_pinned = 1, pin_order = ?, updated_at = ?
                WHERE session_key = ? AND is_deleted = 0
                """,
                (idx, ts, sk),
            )

    if conn is not None:
        _write(conn)
        return
    with db_connection_lock():
        db = get_db()
        _write(db)
        db.commit()


def update_session_title(session_key: str, title: str, *, conn: Any = None) -> bool:
    """Set sidebar title (non-placeholder only)."""
    sk = str(session_key or "").strip()
    t = clip_session_sidebar_title(title)
    if not sk or not t or is_session_deleted(sk):
        return False
    if conn is not None:
        conn.execute(
            """
            UPDATE gogo_chat_sessions
            SET title = ?, updated_at = ?
            WHERE session_key = ? AND is_deleted = 0
            """,
            (t, now_iso_z(), sk),
        )
        return True

    def _do() -> None:
        db = get_db()
        db.execute(
            """
            UPDATE gogo_chat_sessions
            SET title = ?, updated_at = ?
            WHERE session_key = ? AND is_deleted = 0
            """,
            (t, now_iso_z(), sk),
        )
        db.commit()


    run_db_with_retry(_do)
    return True


def enrich_session_rows_collab_task_id(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Set ``collabTaskId`` for sidebar sessions.

    Priority: current thread ``bound_task_id`` → session column ``collab_task_id`` →
    session-scoped task lookup (any historical thread for the session).
    """
    thread_ids = list(
        dict.fromkeys(
            str(row.get("threadId") or "").strip()
            for row in rows
            if str(row.get("threadId") or "").strip()
        )
    )
    if not thread_ids:
        return rows

    conn = get_db()
    placeholders = ",".join("?" * len(thread_ids))
    bound_map: dict[str, str] = {}
    for row in conn.execute(
        f"""
        SELECT thread_id, bound_task_id FROM gogo_thread_collab
        WHERE thread_id IN ({placeholders})
          AND bound_task_id IS NOT NULL AND TRIM(bound_task_id) != ''
        """,
        thread_ids,
    ).fetchall():
        d = _row_dict(row)
        th = str(d.get("thread_id") or "").strip()
        bt = str(d.get("bound_task_id") or "").strip()
        if th and bt:
            bound_map[th] = bt

    out = [dict(r) for r in rows]
    for i, row in enumerate(out):
        thread_id = str(row.get("threadId") or "").strip()
        session_task_id = str(row.get("collabTaskId") or "").strip()
        task_id = bound_map.get(thread_id) or session_task_id or ""
        if not task_id:
            sk = str(row.get("sessionKey") or row.get("key") or "").strip()
            if sk:
                try:
                    from gogo.persistence import task_repositories as task_repo

                    found = task_repo.find_root_task_by_session_key(sk)
                    task_id = str((found or {}).get("id") or "").strip()
                except Exception:
                    task_id = ""
        out[i]["collabTaskId"] = task_id or None
        if task_id:
            ctx = out[i].get("context")
            if isinstance(ctx, dict):
                ctx = dict(ctx)
                ctx["collab_task_id"] = task_id
                out[i]["context"] = ctx
        elif isinstance(out[i].get("context"), dict):
            ctx = dict(out[i]["context"])
            ctx.pop("collab_task_id", None)
            out[i]["context"] = ctx
    return out


_SESSION_ACTIVE_WHERE = f"""
    is_deleted = 0
      AND COALESCE(session_status, '{SESSION_STATUS_ACTIVE}') != '{SESSION_STATUS_PREWARMED}'
      AND session_key NOT LIKE 'agent:executor:%'
      AND COALESCE(hidden_from_list, 0) = 0
"""


def _workspace_filter_sql(workspace_key: str | None) -> tuple[str, list[Any]]:
    key = str(workspace_key or "").strip()
    if not key:
        return "", []
    if key == WORKSPACE_GROUP_PROACTIVE:
        return " AND session_key LIKE 'proactive:%'", []
    if key == WORKSPACE_GROUP_VIRTUAL:
        return (
            " AND COALESCE(use_virtual_paths, 0) = 1"
            " AND session_key NOT LIKE 'proactive:%'",
            [],
        )
    if key == WORKSPACE_GROUP_UNBOUND:
        return (
            " AND COALESCE(use_virtual_paths, 0) = 0"
            " AND COALESCE(TRIM(local_workspace_root), '') = ''"
            " AND session_key NOT LIKE 'proactive:%'",
            [],
        )
    return (
        " AND COALESCE(use_virtual_paths, 0) = 0"
        " AND session_key NOT LIKE 'proactive:%'"
        f" AND {_WORKSPACE_ROOT_SQL_NORM} = ?",
        [normalize_workspace_group_key(key)],
    )


def summarize_sessions_by_workspace_for_ui() -> list[dict[str, Any]]:
    """侧栏工作目录分组：各目录下会话总数（非分页局部计数）。"""
    rows = (
        get_db()
        .execute(
            f"""
        SELECT
          CASE
            WHEN session_key LIKE 'proactive:%' THEN '{WORKSPACE_GROUP_PROACTIVE}'
            WHEN COALESCE(use_virtual_paths, 0) = 1 THEN '{WORKSPACE_GROUP_VIRTUAL}'
            WHEN COALESCE(TRIM(local_workspace_root), '') = '' THEN '{WORKSPACE_GROUP_UNBOUND}'
            ELSE {_WORKSPACE_ROOT_SQL_NORM}
          END AS workspace_key,
          MAX(TRIM(local_workspace_root)) AS local_workspace_root,
          MAX(COALESCE(use_virtual_paths, 0)) AS use_virtual_paths,
          COUNT(*) AS session_count,
          MAX(updated_at) AS max_updated_at
        FROM gogo_chat_sessions
        WHERE {_SESSION_ACTIVE_WHERE}
        GROUP BY workspace_key
        ORDER BY max_updated_at DESC
        """
        )
        .fetchall()
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        d = _row_dict(row)
        wk = str(d.get("workspace_key") or "").strip()
        if not wk:
            continue
        root = str(d.get("local_workspace_root") or "").strip() or None
        out.append(
            {
                "workspaceKey": wk,
                "localWorkspaceRoot": root,
                "useVirtualPaths": bool(int(d.get("use_virtual_paths") or 0)),
                "sessionCount": int(d.get("session_count") or 0),
                "maxUpdatedAt": iso_z_to_ms(d.get("max_updated_at")),
            }
        )
    return out


def merge_workspace_group_summaries_for_ui(
    summaries: list[dict[str, Any]],
    registered_paths: list[str] | None = None,
) -> list[dict[str, Any]]:
    """合并 DB 汇总与全局已注册工作空间（允许 0 会话的空目录）。"""
    by_key: dict[str, dict[str, Any]] = {}
    for item in summaries:
        wk = str(item.get("workspaceKey") or "").strip()
        if wk:
            by_key[wk] = dict(item)

    for raw in registered_paths or []:
        path = normalize_workspace_root_for_storage(raw)
        if not path:
            continue
        wk = normalize_workspace_group_key(path)
        if wk in by_key:
            continue
        by_key[wk] = {
            "workspaceKey": wk,
            "localWorkspaceRoot": path,
            "useVirtualPaths": False,
            "sessionCount": 0,
            "maxUpdatedAt": 0,
        }

    if WORKSPACE_GROUP_UNBOUND not in by_key:
        by_key[WORKSPACE_GROUP_UNBOUND] = {
            "workspaceKey": WORKSPACE_GROUP_UNBOUND,
            "localWorkspaceRoot": None,
            "useVirtualPaths": False,
            "sessionCount": 0,
            "maxUpdatedAt": 0,
        }

    order_index: dict[str, int] = {}
    for i, raw in enumerate(registered_paths or []):
        path = normalize_workspace_root_for_storage(raw)
        if not path:
            continue
        order_index[normalize_workspace_group_key(path)] = i

    def _workspace_group_sort_key(g: dict[str, Any]) -> tuple[int, int, str]:
        wk = str(g.get("workspaceKey") or "")
        if wk == WORKSPACE_GROUP_PROACTIVE:
            return (0, 0, "")
        if wk == WORKSPACE_GROUP_VIRTUAL:
            return (2, 1, "")
        if wk == WORKSPACE_GROUP_UNBOUND:
            return (2, 2, "")
        idx = order_index.get(wk, 50_000)
        path = str(g.get("localWorkspaceRoot") or wk).lower()
        return (1, idx, path)

    _SPECIAL_WORKSPACE_KEYS = (
        WORKSPACE_GROUP_UNBOUND,
        WORKSPACE_GROUP_VIRTUAL,
        WORKSPACE_GROUP_PROACTIVE,
    )
    bound = [g for k, g in by_key.items() if k not in _SPECIAL_WORKSPACE_KEYS]
    bound.sort(key=_workspace_group_sort_key)
    virtual = by_key.get(WORKSPACE_GROUP_VIRTUAL)
    unbound = by_key.get(WORKSPACE_GROUP_UNBOUND)
    proactive = by_key.get(WORKSPACE_GROUP_PROACTIVE)
    out: list[dict[str, Any]] = []
    if proactive:
        out.append(proactive)
    out.extend(bound)
    if virtual:
        out.append(virtual)
    if unbound:
        out.append(unbound)
    return out


def list_sessions_for_ui(
    *,
    limit: int = 20,
    offset: int = 0,
    workspace_key: str | None = None,
    acl_sql: str = "",
    acl_params: tuple[Any, ...] = (),
) -> list[dict[str, Any]]:
    """Rows for ``GET /api/chat/sessions`` (sole session-list source)."""
    lim = max(1, int(limit))
    off = max(0, int(offset))
    extra_sql, extra_params = _workspace_filter_sql(workspace_key)
    rows = (
        get_db()
        .execute(
            f"""
        SELECT {_SESSION_SELECT}
        FROM gogo_chat_sessions
        WHERE {_SESSION_ACTIVE_WHERE}{extra_sql}{acl_sql}
        ORDER BY COALESCE(is_pinned, 0) DESC, COALESCE(pin_order, 0) ASC, created_at DESC
        LIMIT ? OFFSET ?
        """,
            (*extra_params, *acl_params, lim, off),
        )
        .fetchall()
    )
    out: list[dict[str, Any]] = []
    primary = resolve_primary_model_name()
    for row in rows:
        d = _row_dict(row)
        if not d.get("primary_model_name") and primary:
            d = dict(d)
            d["primary_model_name"] = primary
        out.append(_session_row_to_api(d))
    if primary:
        for row in out:
            if not row.get("primaryModelName"):
                row["primaryModelName"] = primary
    return enrich_session_rows_collab_task_id(out)


def search_sessions_for_ui(
    query: str,
    *,
    limit: int = 50,
    acl_sql: str = "",
    acl_params: tuple[Any, ...] = (),
) -> list[dict[str, Any]]:
    """Search sessions by title for sidebar search.

    Unlike ``list_sessions_for_ui`` (paginated), this scans all non-deleted
    sessions matching ``gogo_chat_sessions.title``, so the sidebar search
    box can find sessions that haven't been paged into the client yet.
    """
    q = str(query or "").strip()
    if not q:
        return []
    lim = max(1, min(int(limit), 200))
    # Escape LIKE wildcards so user input is treated literally.
    like_q = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{like_q}%"
    db = get_db()

    rows = db.execute(
        f"""
        SELECT {_SESSION_SELECT}
        FROM gogo_chat_sessions
        WHERE is_deleted = 0
          AND COALESCE(session_status, '{SESSION_STATUS_ACTIVE}') != '{SESSION_STATUS_PREWARMED}'
          AND session_key NOT LIKE 'agent:executor:%'
          AND COALESCE(hidden_from_list, 0) = 0
          AND title LIKE ? ESCAPE '\\'
          {acl_sql}
        ORDER BY COALESCE(is_pinned, 0) DESC, COALESCE(pin_order, 0) ASC, created_at DESC
        LIMIT ?
        """,
        (pattern, *acl_params, lim),
    ).fetchall()

    out: list[dict[str, Any]] = []
    primary = resolve_primary_model_name()
    for row in rows:
        d = _row_dict(row)
        if not d.get("primary_model_name") and primary:
            d = dict(d)
            d["primary_model_name"] = primary
        out.append(_session_row_to_api(d))
    if primary:
        for row in out:
            if not row.get("primaryModelName"):
                row["primaryModelName"] = primary
    return enrich_session_rows_collab_task_id(out)


def import_tombstones(keys: list[str]) -> None:
    for key in keys:
        k = str(key or "").strip()
        if k:
            mark_session_deleted(k)


# ---------------------------------------------------------------------------
# Workspace project metadata (豆包式「项目」显示名 / 编辑项目标题)
# ---------------------------------------------------------------------------

_WORKSPACE_PROJECTS_DDL = """
CREATE TABLE IF NOT EXISTS gogo_workspace_projects (
    workspace_key TEXT PRIMARY KEY,
    title TEXT,
    created_at INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT 0
)
"""


def _ensure_workspace_projects_table(db: Any) -> None:
    try:
        db.execute(_WORKSPACE_PROJECTS_DDL)
    except Exception:
        pass


def get_workspace_projects_meta() -> dict[str, dict[str, Any]]:
    """Project display-name metadata: normalized workspace_key -> {title}.

    ``title`` is the user-renamed folder label (None/'' = use directory basename).
    """
    db = get_db()
    _ensure_workspace_projects_table(db)
    try:
        rows = db.execute(
            "SELECT workspace_key, title FROM gogo_workspace_projects WHERE COALESCE(TRIM(title), '') != ''"
        ).fetchall()
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        key = str(r[0] or "").strip()
        if key:
            out[key] = {"title": str(r[1] or "").strip() or None}
    return out


def set_workspace_project_title(workspace_key: str, title: str, *, conn: Any = None) -> bool:
    """Rename a project (folder) display title; empty title clears the override."""
    key = str(workspace_key or "").strip()
    t = str(title or "").strip()
    if not key:
        return False
    db = conn or get_db()
    _ensure_workspace_projects_table(db)
    ts = now_iso_z()
    db.execute(
        """
        INSERT INTO gogo_workspace_projects (workspace_key, title, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_key) DO UPDATE SET title = ?, updated_at = ?
        """,
        (key, t, ts, ts, t, ts),
    )
    if conn is None:
        db.commit()
    return True


def remove_workspace_project_meta(workspace_key: str, *, conn: Any = None) -> None:
    """Drop project metadata when the workspace is removed from the sidebar."""
    key = str(workspace_key or "").strip()
    if not key:
        return
    db = conn or get_db()
    _ensure_workspace_projects_table(db)
    try:
        db.execute("DELETE FROM gogo_workspace_projects WHERE workspace_key = ?", (key,))
    except Exception:
        return
    if conn is None:
        db.commit()


# ---------------------------------------------------------------------------
# Fork title deduplication (分叉标题：同源连续编号)
# ---------------------------------------------------------------------------

def count_fork_children(parent_session_key: str) -> int:
    """Count visible fork children whose context.forked_from_session_key == parent.

    Only non-deleted, non-hidden sessions are counted so sidebar numbering stays
    contiguous: ``{parent}（1）``, ``{parent}（2）``… (archived/recycled forks are
    excluded — they are no longer part of the visible session list).
    """
    key = str(parent_session_key or "").strip()
    if not key:
        return 0
    try:
        row = get_db().execute(
            "SELECT COUNT(*) FROM gogo_chat_sessions "
            "WHERE json_extract(context_json, '$.forked_from_session_key') = ? "
            "AND is_deleted = 0 AND hidden_from_list = 0",
            (key,),
        ).fetchone()
        return int(row[0]) if row else 0
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Cross-project session migration (跨项目拖拽：移动归属 + 上下文重绑定 + 审计)
# ---------------------------------------------------------------------------

_WORKSPACE_MIGRATIONS_DDL = """
CREATE TABLE IF NOT EXISTS session_workspace_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key TEXT NOT NULL,
    source_workspace_key TEXT,
    target_workspace_key TEXT NOT NULL,
    source_workspace_root TEXT,
    target_workspace_root TEXT,
    rebind_context INTEGER DEFAULT 1,
    snapshot_kept INTEGER DEFAULT 0,
    idempotency_key TEXT,
    status TEXT DEFAULT 'completed',
    created_at TEXT,
    detail_json TEXT
)
"""


def _ensure_workspace_migrations_table(db: Any) -> None:
    try:
        db.execute(_WORKSPACE_MIGRATIONS_DDL)
    except Exception:
        pass


def get_session_workspace_root(session_key: str, *, db: Any = None) -> str | None:
    """Return the current normalized local_workspace_root for a session."""
    sk = str(session_key or "").strip()
    if not sk:
        return None
    conn = db or get_db()
    row = conn.execute(
        "SELECT local_workspace_root FROM gogo_chat_sessions WHERE session_key = ?",
        (sk,),
    ).fetchone()
    if not row:
        return None
    return normalize_workspace_root_for_storage(row[0])


def mark_session_workspace_rebind_pending(
    session_key: str, *, pending: bool = True, conn: Any = None
) -> str | None:
    """Flag context so the next model turn reassembles the project context.

    Returns the session's current workspace root (or None when missing).
    """
    sk = str(session_key or "").strip()
    if not sk:
        return None

    def _impl(db: Any) -> str | None:
        row = db.execute(
            "SELECT local_workspace_root, context_json, is_deleted FROM gogo_chat_sessions "
            "WHERE session_key = ?",
            (sk,),
        ).fetchone()
        if not row:
            raise LookupError(f"session not found: {sk}")
        if int(row[2] or 0) == 1:
            raise LookupError(f"session is deleted: {sk}")
        root = normalize_workspace_root_for_storage(row[0])
        ctx: dict[str, Any] = {}
        if row[1]:
            try:
                ctx = json.loads(row[1])
            except Exception:
                ctx = {}
        if pending:
            ctx["workspace_rebind_pending"] = True
        else:
            ctx.pop("workspace_rebind_pending", None)
        db.execute(
            "UPDATE gogo_chat_sessions SET context_json = ?, updated_at = ? WHERE session_key = ?",
            (json.dumps(ctx, ensure_ascii=False), now_iso_z(), sk),
        )
        return root

    if conn is not None:
        return _impl(conn)
    with db_connection_lock():
        db = get_db()
        try:
            result = _impl(db)
            db.commit()
        except Exception:
            db.rollback()
            raise
        return result


def record_workspace_migration(
    *,
    session_key: str,
    source_root: str | None,
    target_root: str,
    rebind_context: bool = True,
    snapshot_kept: bool = False,
    idempotency_key: str | None = None,
    status: str = "completed",
    detail: dict[str, Any] | None = None,
    conn: Any = None,
) -> int:
    """Append a migration audit row; returns its row id."""
    db = conn or get_db()
    _ensure_workspace_migrations_table(db)
    source_key = normalize_workspace_group_key(source_root) if source_root else None
    target_key = normalize_workspace_group_key(target_root)
    cur = db.execute(
        """
        INSERT INTO session_workspace_migrations (
            session_key, source_workspace_key, target_workspace_key,
            source_workspace_root, target_workspace_root, rebind_context,
            snapshot_kept, idempotency_key, status, created_at, detail_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(session_key),
            source_key,
            target_key,
            source_root,
            target_root,
            1 if rebind_context else 0,
            1 if snapshot_kept else 0,
            idempotency_key,
            status,
            utc_now_iso_z(),
            json.dumps(detail or {}, ensure_ascii=False),
        ),
    )
    return int(getattr(cur, "lastrowid", 0) or 0)


def move_session_workspace(
    session_key: str,
    target_workspace_root: str,
    *,
    rebind_context: bool = True,
    keep_snapshot: bool = False,
    idempotency_key: str | None = None,
    conn: Any = None,
) -> dict[str, Any]:
    """Move a session's ownership from project A to project B (not a copy).

    Atomic unit of work: rebind ``local_workspace_root`` (flat column + a mirrored
    value inside context_json) and append an audit row. The project-scoped memory
    and knowledge vault resolve off the new root on the next turn, so no memory is
    physically moved — the session simply rebinds to B's content namespace.

    Idempotent: if the session is already bound to the target, returns
    ``moved=False`` without writing another migration row.
    """
    sk = str(session_key or "").strip()
    target = normalize_workspace_root_for_storage(target_workspace_root)
    if not sk:
        raise ValueError("session_key is required")
    if not target:
        raise ValueError("target_workspace_root is required")

    def _impl(db: Any) -> dict[str, Any]:
        _ensure_workspace_migrations_table(db)
        row = db.execute(
            "SELECT local_workspace_root, context_json, is_deleted, hidden_from_list "
            "FROM gogo_chat_sessions WHERE session_key = ?",
            (sk,),
        ).fetchone()
        if not row:
            raise LookupError(f"session not found: {sk}")
        if int(row[2] or 0) == 1:
            raise LookupError(f"session is deleted: {sk}")
        source = normalize_workspace_root_for_storage(row[0])
        if normalize_workspace_group_key(source) == normalize_workspace_group_key(target):
            return {
                "moved": False,
                "reason": "already_at_target",
                "sessionKey": sk,
                "sourceWorkspaceRoot": source,
                "targetWorkspaceRoot": target,
            }
        ctx: dict[str, Any] = {}
        if row[1]:
            try:
                ctx = json.loads(row[1])
            except Exception:
                ctx = {}
        ctx["local_workspace_root"] = target
        ctx.pop("workspace_rebind_pending", None)
        db.execute(
            """
            UPDATE gogo_chat_sessions
            SET local_workspace_root = ?, context_json = ?, updated_at = ?
            WHERE session_key = ?
            """,
            (target, json.dumps(ctx, ensure_ascii=False), now_iso_z(), sk),
        )
        migration_id = record_workspace_migration(
            session_key=sk,
            source_root=source,
            target_root=target,
            rebind_context=rebind_context,
            snapshot_kept=keep_snapshot,
            idempotency_key=idempotency_key,
            detail={"previouslyHidden": int(row[3] or 0)},
            conn=db,
        )
        return {
            "moved": True,
            "migrationId": migration_id,
            "sessionKey": sk,
            "sourceWorkspaceRoot": source,
            "targetWorkspaceRoot": target,
            "rebindContext": bool(rebind_context),
            "snapshotKept": bool(keep_snapshot),
        }

    if conn is not None:
        return _impl(conn)
    with db_connection_lock():
        db = get_db()
        try:
            result = _impl(db)
            db.commit()
        except Exception:
            db.rollback()
            raise
        return result


def list_workspace_migrations(
    session_key: str | None = None, *, limit: int = 50
) -> list[dict[str, Any]]:
    """List migration audit rows (optionally for one session), newest first."""
    db = get_db()
    _ensure_workspace_migrations_table(db)
    try:
        if session_key:
            rows = db.execute(
                "SELECT id, session_key, source_workspace_key, target_workspace_key, "
                "source_workspace_root, target_workspace_root, rebind_context, "
                "snapshot_kept, idempotency_key, status, created_at, detail_json "
                "FROM session_workspace_migrations WHERE session_key = ? "
                "ORDER BY id DESC LIMIT ?",
                (str(session_key), int(limit)),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT id, session_key, source_workspace_key, target_workspace_key, "
                "source_workspace_root, target_workspace_root, rebind_context, "
                "snapshot_kept, idempotency_key, status, created_at, detail_json "
                "FROM session_workspace_migrations ORDER BY id DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
    except Exception:
        return []
    cols = [
        "id", "sessionKey", "sourceWorkspaceKey", "targetWorkspaceKey",
        "sourceWorkspaceRoot", "targetWorkspaceRoot", "rebindContext",
        "snapshotKept", "idempotencyKey", "status", "createdAt", "detail",
    ]
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(zip(cols, r))
        d["rebindContext"] = bool(d.get("rebindContext"))
        d["snapshotKept"] = bool(d.get("snapshotKept"))
        try:
            d["detail"] = json.loads(d.get("detail") or "{}")
        except Exception:
            d["detail"] = {}
        out.append(d)
    return out
