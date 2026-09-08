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
  id         TEXT PRIMARY KEY,
  goal       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'rpc',
  status     TEXT NOT NULL DEFAULT 'PENDING',
  plan_json  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
"""


def get_db_path() -> str:
    return get_settings().sqlite_path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row_to_dict(row: aiosqlite.Row) -> dict:
    return {k: row[k] for k in row.keys()}


async def init_db(path: str | None = None) -> None:
    """初始化 schema（幂等）。"""
    path = path or get_db_path()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(path) as db:
        await db.executescript(SCHEMA)
        await db.commit()


# ---------- tasks ----------

async def insert_task(path: str, task_id: str, goal: str, source: str) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO tasks (id, goal, source, status, created_at, updated_at) "
            "VALUES (?, ?, ?, 'PENDING', ?, ?)",
            (task_id, goal, source, now, now),
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
