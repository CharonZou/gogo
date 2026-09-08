"""SQLite 数据层（aiosqlite）。

任务 / 子任务 / 记忆（facts）三张表，单机本地优先。
每个操作独立建连，适合本地单用户 RPC 场景。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

from backend.core.config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  goal        TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'rpc',
  status      TEXT NOT NULL DEFAULT 'PENDING',
  plan_json   TEXT,
  kind        TEXT NOT NULL DEFAULT 'task',
  title       TEXT,
  due_at      TEXT,
  priority    TEXT NOT NULL DEFAULT 'medium',
  assignee_id TEXT,
  done_at     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subtasks (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  depends_on  TEXT NOT NULL DEFAULT '[]',
  tool        TEXT NOT NULL DEFAULT 'noop',
  tool_args   TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'PENDING',
  result      TEXT,
  error       TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT '',
  soul           TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  tool_whitelist TEXT NOT NULL DEFAULT '[]',
  schedule_json  TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'off_duty',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
"""

# tasks 扩展列（旧库迁移用；新库直接建全）
TASK_EXTRA_COLUMNS = {
    "kind": "TEXT NOT NULL DEFAULT 'task'",
    "title": "TEXT",
    "due_at": "TEXT",
    "priority": "TEXT NOT NULL DEFAULT 'medium'",
    "assignee_id": "TEXT",
    "done_at": "TEXT",
}


def get_db_path() -> str:
    return get_settings().sqlite_path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row_to_dict(row: aiosqlite.Row) -> dict:
    return {k: row[k] for k in row.keys()}


async def init_db(path: str | None = None) -> None:
    """初始化 schema（幂等）+ 旧库迁移。"""
    path = path or get_db_path()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(path) as db:
        await db.executescript(SCHEMA)
        await _migrate_tasks(db)
        await db.commit()


async def _migrate_tasks(db: aiosqlite.Connection) -> None:
    """为旧版 tasks 表补齐新增列（幂等）。"""
    cur = await db.execute("PRAGMA table_info(tasks)")
    rows = await cur.fetchall()
    existing = {r[1] for r in rows}
    for col, ddl in TASK_EXTRA_COLUMNS.items():
        if col not in existing:
            await db.execute(f"ALTER TABLE tasks ADD COLUMN {col} {ddl}")


_initialized_paths: set[str] = set()


async def ensure_initialized(path: str) -> None:
    """惰性初始化 schema（按路径全局缓存，幂等）。"""
    if path in _initialized_paths:
        return
    await init_db(path)
    _initialized_paths.add(path)


# ---------- tasks ----------

async def insert_task(
    path: str,
    task_id: str,
    goal: str,
    source: str,
    *,
    kind: str = "task",
    title: str | None = None,
    due_at: str | None = None,
    priority: str = "medium",
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO tasks "
            "(id, goal, source, status, kind, title, due_at, priority, created_at, updated_at) "
            "VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)",
            (task_id, goal, source, kind, title, due_at, priority, now, now),
        )
        await db.commit()


async def get_task(path: str, task_id: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        row = await cur.fetchone()
    return _row_to_dict(row) if row else None


async def list_tasks(path: str, limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", (limit,)
        )
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]


async def update_task_status(
    path: str, task_id: str, status: str, plan_json: str | None = None
) -> None:
    now = _now()
    if plan_json is not None:
        async with aiosqlite.connect(path) as db:
            await db.execute(
                "UPDATE tasks SET status = ?, plan_json = ?, updated_at = ? WHERE id = ?",
                (status, plan_json, now, task_id),
            )
            await db.commit()
        return
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?",
            (status, now, task_id),
        )
        await db.commit()


async def update_task(
    path: str,
    task_id: str,
    *,
    goal: str | None = None,
    title: str | None = None,
    due_at: str | None = None,
    priority: str | None = None,
) -> None:
    """更新任务可编辑字段（只更新传入的字段）。"""
    now = _now()
    sets = ["updated_at = ?"]
    values: list[Any] = [now]
    for col, val in (
        ("goal", goal),
        ("title", title),
        ("due_at", due_at),
        ("priority", priority),
    ):
        if val is not None:
            sets.append(f"{col} = ?")
            values.append(val)
    values.append(task_id)
    async with aiosqlite.connect(path) as db:
        await db.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", values)
        await db.commit()


async def assign_task(path: str, task_id: str, agent_id: str) -> None:
    """派给智能体员工。"""
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE id = ?",
            (agent_id, now, task_id),
        )
        await db.commit()


async def complete_task(path: str, task_id: str) -> None:
    """标记完成（DONE + done_at）。"""
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE tasks SET status = 'DONE', done_at = ?, updated_at = ? WHERE id = ?",
            (now, now, task_id),
        )
        await db.commit()


# ---------- agents（智能体员工） ----------

def _agent_to_dict(row: aiosqlite.Row) -> dict:
    d = _row_to_dict(row)
    try:
        d["tool_whitelist"] = json.loads(d.get("tool_whitelist") or "[]")
    except json.JSONDecodeError:
        d["tool_whitelist"] = []
    try:
        d["schedule_json"] = json.loads(d.get("schedule_json") or "{}")
    except json.JSONDecodeError:
        d["schedule_json"] = {}
    return d


async def insert_agent(
    path: str,
    agent_id: str,
    name: str,
    role: str,
    soul: str,
    model: str,
    tool_whitelist: list[str],
    schedule_json: dict,
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO agents "
            "(id, name, role, soul, model, tool_whitelist, schedule_json, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'off_duty', ?, ?)",
            (
                agent_id,
                name,
                role,
                soul,
                model,
                json.dumps(tool_whitelist, ensure_ascii=False),
                json.dumps(schedule_json, ensure_ascii=False),
                now,
                now,
            ),
        )
        await db.commit()


async def get_agent(path: str, agent_id: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        row = await cur.fetchone()
    return _agent_to_dict(row) if row else None


async def list_agents(path: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM agents ORDER BY created_at DESC")
        rows = await cur.fetchall()
    return [_agent_to_dict(r) for r in rows]


async def update_agent(
    path: str,
    agent_id: str,
    *,
    name: str | None = None,
    role: str | None = None,
    soul: str | None = None,
    model: str | None = None,
    tool_whitelist: list[str] | None = None,
    schedule_json: dict | None = None,
) -> None:
    now = _now()
    sets = ["updated_at = ?"]
    values: list[Any] = [now]
    for col, val in (
        ("name", name),
        ("role", role),
        ("soul", soul),
        ("model", model),
        ("tool_whitelist", tool_whitelist),
        ("schedule_json", schedule_json),
    ):
        if val is not None:
            sets.append(f"{col} = ?")
            if isinstance(val, (list, dict)):
                values.append(json.dumps(val, ensure_ascii=False))
            else:
                values.append(val)
    values.append(agent_id)
    async with aiosqlite.connect(path) as db:
        await db.execute(f"UPDATE agents SET {', '.join(sets)} WHERE id = ?", values)
        await db.commit()


async def set_agent_status(path: str, agent_id: str, status: str) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE agents SET status = ?, updated_at = ? WHERE id = ?",
            (status, now, agent_id),
        )
        await db.commit()


# ---------- subtasks ----------

async def insert_subtask(
    path: str,
    subtask_id: str,
    task_id: str,
    title: str,
    description: str,
    depends_on: list[str],
    tool: str,
    tool_args: dict[str, Any],
    position: int,
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO subtasks "
            "(id, task_id, title, description, depends_on, tool, tool_args, position, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                subtask_id,
                task_id,
                title,
                description,
                json.dumps(depends_on),
                tool,
                json.dumps(tool_args, ensure_ascii=False),
                position,
                now,
                now,
            ),
        )
        await db.commit()


async def list_subtasks(path: str, task_id: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM subtasks WHERE task_id = ? ORDER BY position", (task_id,)
        )
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]


async def delete_subtasks(path: str, task_id: str) -> None:
    """删除任务的全部子任务（重规划时使用）。"""
    async with aiosqlite.connect(path) as db:
        await db.execute("DELETE FROM subtasks WHERE task_id = ?", (task_id,))
        await db.commit()


async def update_subtask(
    path: str, subtask_id: str, *, status: str | None = None,
    result: str | None = None, error: str | None = None,
) -> None:
    now = _now()
    sets = ["updated_at = ?"]
    values: list[Any] = [now]
    if status is not None:
        sets.append("status = ?")
        values.append(status)
    if result is not None:
        sets.append("result = ?")
        values.append(result)
    if error is not None:
        sets.append("error = ?")
        values.append(error)
    values.append(subtask_id)
    async with aiosqlite.connect(path) as db:
        await db.execute(
            f"UPDATE subtasks SET {', '.join(sets)} WHERE id = ?", values
        )
        await db.commit()


# ---------- memory / facts ----------

async def save_fact(path: str, key: str, value: str) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT OR REPLACE INTO facts (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, now),
        )
        await db.commit()


async def get_fact(path: str, key: str) -> str | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT value FROM facts WHERE key = ?", (key,))
        row = await cur.fetchone()
    return row["value"] if row else None


async def search_facts(path: str, query: str, top_k: int = 5) -> list[dict]:
    like = f"%{query}%"
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT key, value, updated_at FROM facts "
            "WHERE key LIKE ? OR value LIKE ? ORDER BY updated_at DESC LIMIT ?",
            (like, like, top_k),
        )
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]
