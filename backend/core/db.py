"""SQLite 数据层（aiosqlite）。

任务 / 子任务 / 记忆（facts）三张表，单机本地优先。
每个操作独立建连，适合本地单用户 RPC 场景。
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
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
  cancelled   INTEGER NOT NULL DEFAULT 0,
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
  skill_whitelist TEXT NOT NULL DEFAULT '[]',
  auto_work      INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'off_duty',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  steps_json  TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'draft',
  run_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_docs (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'upload',
  path        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'imported',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  meta_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  position    INTEGER NOT NULL,
  content     TEXT NOT NULL,
  embedding   TEXT NOT NULL DEFAULT '[]',
  token_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (doc_id) REFERENCES kb_docs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_id);

CREATE TABLE IF NOT EXISTS automations (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  prompt              TEXT NOT NULL,
  schedule            TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'active',
  trigger_type        TEXT NOT NULL DEFAULT 'cron',
  thread_mode         TEXT NOT NULL DEFAULT 'fresh',
  max_duration_minutes INTEGER NOT NULL DEFAULT 30,
  last_run_at         TEXT NOT NULL DEFAULT '',
  next_run_at         TEXT NOT NULL DEFAULT '',
  run_count           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id            TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  trigger_type  TEXT NOT NULL DEFAULT 'schedule',
  started_at    TEXT NOT NULL,
  finished_at   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'running',
  task_id       TEXT NOT NULL DEFAULT '',
  output        TEXT NOT NULL DEFAULT '',
  error         TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_auto ON automation_runs(automation_id);

CREATE TABLE IF NOT EXISTS apps (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  goal          TEXT NOT NULL DEFAULT '',
  steps_json    TEXT NOT NULL DEFAULT '[]',
  params_json   TEXT NOT NULL DEFAULT '[]',
  execution_mode TEXT NOT NULL DEFAULT 'auto',
  status        TEXT NOT NULL DEFAULT 'draft',
  run_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_runs (
  id            TEXT PRIMARY KEY,
  app_id        TEXT NOT NULL,
  params_json   TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'running',
  task_id       TEXT NOT NULL DEFAULT '',
  started_at    TEXT NOT NULL,
  finished_at   TEXT NOT NULL DEFAULT '',
  error         TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_app_runs_app ON app_runs(app_id);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  type         TEXT NOT NULL DEFAULT 'stdio',
  enabled      INTEGER NOT NULL DEFAULT 1,
  config_json  TEXT NOT NULL DEFAULT '{}',
  description  TEXT NOT NULL DEFAULT '',
  load_status  TEXT NOT NULL DEFAULT 'unloaded',
  last_error   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'custom',
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
"""

# agents 扩展列（旧库迁移用；新库直接建全）
AGENT_EXTRA_COLUMNS = {
    "skill_whitelist": "TEXT NOT NULL DEFAULT '[]'",
    "auto_work": "INTEGER NOT NULL DEFAULT 0",
}

# tasks 扩展列（旧库迁移用；新库直接建全）
TASK_EXTRA_COLUMNS = {
    "kind": "TEXT NOT NULL DEFAULT 'task'",
    "title": "TEXT",
    "due_at": "TEXT",
    "priority": "TEXT NOT NULL DEFAULT 'medium'",
    "assignee_id": "TEXT",
    "done_at": "TEXT",
    "cancelled": "INTEGER NOT NULL DEFAULT 0",
}


def get_db_path() -> str:
    return get_settings().sqlite_path


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _row_to_dict(row: aiosqlite.Row) -> dict:
    return {k: row[k] for k in row.keys()}  # noqa: SIM118 — sqlite3.Row 迭代产出值而非键


async def init_db(path: str | None = None) -> None:
    """初始化 schema（幂等）+ 旧库迁移。"""
    path = path or get_db_path()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(path) as db:
        await db.executescript(SCHEMA)
        await _migrate_tasks(db)
        await _migrate_agents(db)
        await db.commit()


async def _migrate_agents(db: aiosqlite.Connection) -> None:
    """为旧版 agents 表补齐新增列（幂等）。"""
    cur = await db.execute("PRAGMA table_info(agents)")
    rows = await cur.fetchall()
    existing = {r[1] for r in rows}
    for col, ddl in AGENT_EXTRA_COLUMNS.items():
        if col not in existing:
            await db.execute(f"ALTER TABLE agents ADD COLUMN {col} {ddl}")


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
    assignee_id: str | None = None,
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO tasks "
            "(id, goal, source, status, kind, title, due_at, priority, assignee_id, "
            " created_at, updated_at) "
            "VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)",
            (task_id, goal, source, kind, title, due_at, priority, assignee_id, now, now),
        )
        await db.commit()


async def get_task(path: str, task_id: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        row = await cur.fetchone()
    return _row_to_dict(row) if row else None


async def list_tasks(
    path: str,
    limit: int = 50,
    *,
    kind: str | None = None,
    status: str | None = None,
    assignee_id: str | None = None,
    source: str | None = None,
) -> list[dict]:
    """任务列表（支持按类型 / 状态 / 指派员工 / 来源过滤）。"""
    where: list[str] = []
    params: list[Any] = []
    for col, val in (
        ("kind", kind),
        ("status", status),
        ("assignee_id", assignee_id),
        ("source", source),
    ):
        if val is not None:
            where.append(f"{col} = ?")
            params.append(val)
    sql = "SELECT * FROM tasks"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(sql, params)
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]


async def delete_task(path: str, task_id: str) -> None:
    """删除任务及其子任务（级联，不可恢复）。"""
    async with aiosqlite.connect(path) as db:
        await db.execute("DELETE FROM subtasks WHERE task_id = ?", (task_id,))
        await db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        await db.commit()


async def set_task_cancelled(path: str, task_id: str, cancelled: bool = True) -> None:
    """取消标记：执行引擎每轮检查，cancelled 后不再推进并落 CANCELLED 终态。"""
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE tasks SET cancelled = ?, updated_at = ? WHERE id = ?",
            (1 if cancelled else 0, now, task_id),
        )
        await db.commit()


async def list_agent_tasks(path: str, agent_id: str, statuses: list[str]) -> list[dict]:
    """员工名下指定状态的任务（值班自动接单用）。"""
    placeholders = ", ".join("?" for _ in statuses)
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            f"SELECT * FROM tasks WHERE assignee_id = ? AND status IN ({placeholders}) "
            "ORDER BY created_at ASC",
            (agent_id, *statuses),
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
    try:
        d["skill_whitelist"] = json.loads(d.get("skill_whitelist") or "[]")
    except json.JSONDecodeError:
        d["skill_whitelist"] = []
    d["auto_work"] = bool(d.get("auto_work", 0))
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
    skill_whitelist: list[str] | None = None,
    auto_work: bool = False,
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO agents "
            "(id, name, role, soul, model, tool_whitelist, schedule_json, "
            " skill_whitelist, auto_work, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'off_duty', ?, ?)",
            (
                agent_id,
                name,
                role,
                soul,
                model,
                json.dumps(tool_whitelist, ensure_ascii=False),
                json.dumps(schedule_json, ensure_ascii=False),
                json.dumps(skill_whitelist or [], ensure_ascii=False),
                1 if auto_work else 0,
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
    skill_whitelist: list[str] | None = None,
    auto_work: bool | None = None,
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
        ("skill_whitelist", skill_whitelist),
        ("auto_work", None if auto_work is None else (1 if auto_work else 0)),
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


# ---------- workflows（工作流模板） ----------

def _workflow_to_dict(row: aiosqlite.Row) -> dict:
    d = _row_to_dict(row)
    try:
        d["steps"] = json.loads(d.pop("steps_json") or "[]")
    except json.JSONDecodeError:
        d["steps"] = []
    return d


async def insert_workflow(
    path: str,
    workflow_id: str,
    name: str,
    description: str,
    steps_json: str,
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO workflows "
            "(id, name, description, steps_json, status, run_count, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'draft', 0, ?, ?)",
            (workflow_id, name, description, steps_json, now, now),
        )
        await db.commit()


async def get_workflow(path: str, workflow_id: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM workflows WHERE id = ?", (workflow_id,)
        )
        row = await cur.fetchone()
    return _workflow_to_dict(row) if row else None


async def list_workflows(path: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM workflows ORDER BY created_at DESC")
        rows = await cur.fetchall()
    return [_workflow_to_dict(r) for r in rows]


async def update_workflow(
    path: str,
    workflow_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    steps_json: str | None = None,
    status: str | None = None,
) -> None:
    now = _now()
    sets = ["updated_at = ?"]
    values: list[Any] = [now]
    for col, val in (
        ("name", name),
        ("description", description),
        ("steps_json", steps_json),
        ("status", status),
    ):
        if val is not None:
            sets.append(f"{col} = ?")
            values.append(val)
    values.append(workflow_id)
    async with aiosqlite.connect(path) as db:
        await db.execute(
            f"UPDATE workflows SET {', '.join(sets)} WHERE id = ?", values
        )
        await db.commit()


async def delete_workflow(path: str, workflow_id: str) -> bool:
    async with aiosqlite.connect(path) as db:
        cur = await db.execute(
            "DELETE FROM workflows WHERE id = ?", (workflow_id,)
        )
        await db.commit()
    return cur.rowcount > 0


async def increment_workflow_run_count(path: str, workflow_id: str) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE workflows SET run_count = run_count + 1, updated_at = ? WHERE id = ?",
            (now, workflow_id),
        )
        await db.commit()


# ---------- 知识库（kb_docs / kb_chunks） ----------

async def insert_kb_doc(
    path: str,
    doc_id: str,
    title: str,
    *,
    source: str = "upload",
    rel_path: str = "",
    meta: dict | None = None,
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO kb_docs "
            "(id, title, source, path, status, chunk_count, meta_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'imported', 0, ?, ?, ?)",
            (
                doc_id,
                title,
                source,
                rel_path,
                json.dumps(meta or {}, ensure_ascii=False),
                now,
                now,
            ),
        )
        await db.commit()


async def get_kb_doc(path: str, doc_id: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM kb_docs WHERE id = ?", (doc_id,))
        row = await cur.fetchone()
    if row is None:
        return None
    d = _row_to_dict(row)
    try:
        d["meta"] = json.loads(d.pop("meta_json") or "{}")
    except json.JSONDecodeError:
        d["meta"] = {}
    return d


async def list_kb_docs(path: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM kb_docs ORDER BY created_at DESC"
        )
        rows = await cur.fetchall()
    out = []
    for r in rows:
        d = _row_to_dict(r)
        try:
            d["meta"] = json.loads(d.pop("meta_json") or "{}")
        except json.JSONDecodeError:
            d["meta"] = {}
        out.append(d)
    return out


async def delete_kb_doc(path: str, doc_id: str) -> bool:
    async with aiosqlite.connect(path) as db:
        await db.execute("DELETE FROM kb_chunks WHERE doc_id = ?", (doc_id,))
        cur = await db.execute("DELETE FROM kb_docs WHERE id = ?", (doc_id,))
        await db.commit()
    return cur.rowcount > 0


async def insert_kb_chunks(path: str, chunks: list[dict]) -> None:
    """批量落库分块：{id, doc_id, position, content, embedding, token_count}。"""
    async with aiosqlite.connect(path) as db:
        await db.executemany(
            "INSERT INTO kb_chunks "
            "(id, doc_id, position, content, embedding, token_count) "
            "VALUES (:id, :doc_id, :position, :content, :embedding, :token_count)",
            [
                {
                    "id": c["id"],
                    "doc_id": c["doc_id"],
                    "position": c["position"],
                    "content": c["content"],
                    "embedding": json.dumps(c.get("embedding", []), ensure_ascii=False),
                    "token_count": c.get("token_count", 0),
                }
                for c in chunks
            ],
        )
        await db.execute(
            "UPDATE kb_docs SET chunk_count = ?, updated_at = ? WHERE id = ?",
            (len(chunks), _now(), chunks[0]["doc_id"] if chunks else ""),
        )
        await db.commit()


async def list_kb_chunks_by_doc(path: str, doc_id: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id, doc_id, position, content, token_count "
            "FROM kb_chunks WHERE doc_id = ? ORDER BY position",
            (doc_id,),
        )
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]


async def list_all_kb_chunks(path: str) -> list[dict]:
    """全量分块（含 embedding，供向量检索在 Python 端算余弦）。"""
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT c.id AS chunk_id, c.doc_id, c.position, c.content, c.embedding, "
            "d.title AS doc_title, d.source AS doc_source "
            "FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id "
            "ORDER BY c.doc_id, c.position"
        )
        rows = await cur.fetchall()
    out = []
    for r in rows:
        d = _row_to_dict(r)
        try:
            d["embedding"] = json.loads(d["embedding"] or "[]")
        except json.JSONDecodeError:
            d["embedding"] = []
        out.append(d)
    return out


async def search_kb_keyword(path: str, query: str, limit: int = 5) -> list[dict]:
    """全文 LIKE 检索：content 命中任一查询词即返回，按命中词数排序。"""
    terms = [t for t in _tokenize(query) if t]
    if not terms:
        return []
    placeholders = []
    params: list[Any] = []
    for term in terms:
        placeholders.append("c.content LIKE ?")
        params.append(f"%{term}%")
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT c.id AS chunk_id, c.doc_id, c.position, c.content, "
            "d.title AS doc_title, d.source AS doc_source "
            "FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id "
            f"WHERE {' OR '.join(placeholders)} "
            "ORDER BY c.doc_id, c.position LIMIT ?",
            (*params, limit),
        )
        rows = await cur.fetchall()
    out = []
    for r in rows:
        d = _row_to_dict(r)
        hits = sum(1 for t in terms if t in d["content"])
        d["score"] = hits / len(terms)
        out.append(d)
    return out


def _tokenize(text: str) -> list[str]:
    """查询词切分：中文按字符 bigram，英文/数字按词。"""
    import re

    tokens: list[str] = []
    for word in re.findall(r"[a-zA-Z0-9_]+", text):
        tokens.append(word.lower())
    cjk = re.findall(r"[\u4e00-\u9fff]", text)
    if len(cjk) >= 2:
        tokens.extend("".join(cjk[i : i + 2]) for i in range(len(cjk) - 1))
    elif len(cjk) == 1:
        tokens.append(cjk[0])
    return tokens


# ---------- 自动化（automations / automation_runs） ----------

async def insert_automation(
    path: str,
    automation_id: str,
    name: str,
    prompt: str,
    schedule: str,
    *,
    trigger_type: str = "cron",
    thread_mode: str = "fresh",
    max_duration_minutes: int = 30,
    next_run_at: str = "",
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO automations "
            "(id, name, prompt, schedule, status, trigger_type, thread_mode, "
            " max_duration_minutes, last_run_at, next_run_at, run_count, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'active', ?, ?, ?, '', ?, 0, ?, ?)",
            (
                automation_id,
                name,
                prompt,
                schedule,
                trigger_type,
                thread_mode,
                max_duration_minutes,
                next_run_at,
                now,
                now,
            ),
        )
        await db.commit()


async def get_automation(path: str, automation_id: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM automations WHERE id = ?", (automation_id,)
        )
        row = await cur.fetchone()
    return _row_to_dict(row) if row else None


async def list_automations(path: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM automations ORDER BY created_at DESC")
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]


async def update_automation(
    path: str,
    automation_id: str,
    *,
    name: str | None = None,
    prompt: str | None = None,
    schedule: str | None = None,
    status: str | None = None,
    trigger_type: str | None = None,
    thread_mode: str | None = None,
    max_duration_minutes: int | None = None,
) -> None:
    now = _now()
    sets = ["updated_at = ?"]
    values: list[Any] = [now]
    for col, val in (
        ("name", name),
        ("prompt", prompt),
        ("schedule", schedule),
        ("status", status),
        ("trigger_type", trigger_type),
        ("thread_mode", thread_mode),
        ("max_duration_minutes", max_duration_minutes),
    ):
        if val is not None:
            sets.append(f"{col} = ?")
            values.append(val)
    values.append(automation_id)
    async with aiosqlite.connect(path) as db:
        await db.execute(
            f"UPDATE automations SET {', '.join(sets)} WHERE id = ?", values
        )
        await db.commit()


async def delete_automation(path: str, automation_id: str) -> bool:
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "DELETE FROM automation_runs WHERE automation_id = ?", (automation_id,)
        )
        cur = await db.execute("DELETE FROM automations WHERE id = ?", (automation_id,))
        await db.commit()
    return cur.rowcount > 0


async def mark_automation_fired(
    path: str,
    automation_id: str,
    *,
    run_at: str,
    status: str | None = None,
    next_run_at: str | None = None,
) -> None:
    """触发后更新：last_run_at / run_count /（可选）状态与下次触发。"""
    sets = ["last_run_at = ?", "run_count = run_count + 1", "updated_at = ?"]
    values: list[Any] = [run_at, _now()]
    if status is not None:
        sets.append("status = ?")
        values.append(status)
    if next_run_at is not None:
        sets.append("next_run_at = ?")
        values.append(next_run_at)
    values.append(automation_id)
    async with aiosqlite.connect(path) as db:
        await db.execute(
            f"UPDATE automations SET {', '.join(sets)} WHERE id = ?", values
        )
        await db.commit()


async def insert_automation_run(
    path: str,
    run_id: str,
    automation_id: str,
    *,
    trigger_type: str = "schedule",
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO automation_runs "
            "(id, automation_id, trigger_type, started_at, status) "
            "VALUES (?, ?, ?, ?, 'running')",
            (run_id, automation_id, trigger_type, now),
        )
        await db.commit()


async def finish_automation_run(
    path: str,
    run_id: str,
    *,
    status: str,
    task_id: str = "",
    output: str = "",
    error: str = "",
) -> None:
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE automation_runs SET finished_at = ?, status = ?, "
            "task_id = ?, output = ?, error = ? WHERE id = ?",
            (_now(), status, task_id, output, error, run_id),
        )
        await db.commit()


async def list_automation_runs(path: str, automation_id: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM automation_runs WHERE automation_id = ? "
            "ORDER BY started_at DESC",
            (automation_id,),
        )
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_automation_run(path: str, run_id: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM automation_runs WHERE id = ?", (run_id,)
        )
        row = await cur.fetchone()
    return _row_to_dict(row) if row else None

# ---------- 应用中心（apps / app_runs） ----------

def _app_to_dict(row: aiosqlite.Row) -> dict:
    d = _row_to_dict(row)
    for key, col in (("steps", "steps_json"), ("params", "params_json")):
        try:
            d[key] = json.loads(d.pop(col) or "[]")
        except json.JSONDecodeError:
            d[key] = []
    return d


def _app_run_to_dict(row: aiosqlite.Row) -> dict:
    d = _row_to_dict(row)
    try:
        d["params"] = json.loads(d.pop("params_json") or "{}")
    except json.JSONDecodeError:
        d["params"] = {}
    return d


async def insert_app(
    path: str,
    app_id: str,
    name: str,
    description: str,
    goal: str,
    steps_json: str,
    params_json: str,
    execution_mode: str,
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO apps "
            "(id, name, description, goal, steps_json, params_json, execution_mode, "
            " status, run_count, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?)",
            (app_id, name, description, goal, steps_json, params_json, execution_mode, now, now),
        )
        await db.commit()


async def get_app(path: str, app_id: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM apps WHERE id = ?", (app_id,))
        row = await cur.fetchone()
    return _app_to_dict(row) if row else None


async def list_apps(path: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM apps ORDER BY created_at DESC")
        rows = await cur.fetchall()
    return [_app_to_dict(r) for r in rows]


async def update_app(
    path: str,
    app_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    goal: str | None = None,
    steps_json: str | None = None,
    params_json: str | None = None,
    execution_mode: str | None = None,
    status: str | None = None,
) -> None:
    now = _now()
    sets = ["updated_at = ?"]
    values: list[Any] = [now]
    for col, val in (
        ("name", name),
        ("description", description),
        ("goal", goal),
        ("steps_json", steps_json),
        ("params_json", params_json),
        ("execution_mode", execution_mode),
        ("status", status),
    ):
        if val is not None:
            sets.append(f"{col} = ?")
            values.append(val)
    values.append(app_id)
    async with aiosqlite.connect(path) as db:
        await db.execute(f"UPDATE apps SET {', '.join(sets)} WHERE id = ?", values)
        await db.commit()


async def delete_app(path: str, app_id: str) -> bool:
    async with aiosqlite.connect(path) as db:
        cur = await db.execute("DELETE FROM apps WHERE id = ?", (app_id,))
        await db.commit()
    return cur.rowcount > 0


async def increment_app_run_count(path: str, app_id: str) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE apps SET run_count = run_count + 1, updated_at = ? WHERE id = ?",
            (now, app_id),
        )
        await db.commit()


async def insert_app_run(
    path: str, run_id: str, app_id: str, params: dict, task_id: str = ""
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO app_runs "
            "(id, app_id, params_json, status, task_id, started_at, finished_at, error) "
            "VALUES (?, ?, ?, 'running', ?, ?, '', '')",
            (run_id, app_id, json.dumps(params, ensure_ascii=False), task_id, now),
        )
        await db.commit()


async def finish_app_run(
    path: str, run_id: str, *, status: str, task_id: str = "", error: str = ""
) -> None:
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE app_runs SET finished_at = ?, status = ?, task_id = ?, error = ? "
            "WHERE id = ?",
            (_now(), status, task_id, error, run_id),
        )
        await db.commit()


async def list_app_runs(path: str, app_id: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM app_runs WHERE app_id = ? ORDER BY started_at DESC",
            (app_id,),
        )
        rows = await cur.fetchall()
    return [_app_run_to_dict(r) for r in rows]


async def get_app_run(path: str, run_id: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM app_runs WHERE id = ?", (run_id,))
        row = await cur.fetchone()
    return _app_run_to_dict(row) if row else None


# ---------- MCP 服务器（mcp_servers） ----------

def _mcp_to_dict(row: aiosqlite.Row) -> dict:
    d = _row_to_dict(row)
    try:
        d["config"] = json.loads(d.pop("config_json") or "{}")
    except json.JSONDecodeError:
        d["config"] = {}
    return d


async def upsert_mcp_server(
    path: str,
    server_id: str,
    name: str,
    mcp_type: str,
    config: dict,
    *,
    enabled: bool = True,
    description: str = "",
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO mcp_servers "
            "(id, name, type, enabled, config_json, description, load_status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 'unloaded', ?, ?) "
            "ON CONFLICT(name) DO UPDATE SET "
            "type = excluded.type, enabled = excluded.enabled, "
            "config_json = excluded.config_json, description = excluded.description, "
            "load_status = 'unloaded', updated_at = excluded.updated_at",
            (
                server_id,
                name,
                mcp_type,
                1 if enabled else 0,
                json.dumps(config, ensure_ascii=False),
                description,
                now,
                now,
            ),
        )
        await db.commit()


async def get_mcp_server(path: str, name: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM mcp_servers WHERE name = ?", (name,)
        )
        row = await cur.fetchone()
    return _mcp_to_dict(row) if row else None


async def list_mcp_servers(path: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM mcp_servers ORDER BY created_at DESC")
        rows = await cur.fetchall()
    return [_mcp_to_dict(r) for r in rows]


async def set_mcp_enabled(path: str, name: str, enabled: bool) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE mcp_servers SET enabled = ?, load_status = 'unloaded', "
            "last_error = '', updated_at = ? WHERE name = ?",
            (1 if enabled else 0, now, name),
        )
        await db.commit()


async def update_mcp_status(path: str, name: str, status: str, error: str = "") -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE mcp_servers SET load_status = ?, last_error = ?, updated_at = ? "
            "WHERE name = ?",
            (status, error, now, name),
        )
        await db.commit()


async def delete_mcp_server(path: str, name: str) -> bool:
    async with aiosqlite.connect(path) as db:
        cur = await db.execute("DELETE FROM mcp_servers WHERE name = ?", (name,))
        await db.commit()
    return cur.rowcount > 0


# ---------- 技能（skills） ----------

async def upsert_skill(
    path: str,
    skill_id: str,
    name: str,
    description: str,
    instructions: str,
    *,
    source: str = "custom",
    enabled: bool = True,
) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "INSERT INTO skills "
            "(id, name, description, instructions, source, enabled, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(name) DO UPDATE SET "
            "description = excluded.description, instructions = excluded.instructions, "
            "source = excluded.source, updated_at = excluded.updated_at",
            (
                skill_id,
                name,
                description,
                instructions,
                source,
                1 if enabled else 0,
                now,
                now,
            ),
        )
        await db.commit()


async def get_skill(path: str, name: str) -> dict | None:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM skills WHERE name = ?", (name,))
        row = await cur.fetchone()
    return _row_to_dict(row) if row else None


async def list_skills(path: str) -> list[dict]:
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM skills ORDER BY name")
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]


async def set_skill_enabled(path: str, name: str, enabled: bool) -> None:
    now = _now()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            "UPDATE skills SET enabled = ?, updated_at = ? WHERE name = ?",
            (1 if enabled else 0, now, name),
        )
        await db.commit()


async def delete_skill(path: str, name: str) -> bool:
    async with aiosqlite.connect(path) as db:
        cur = await db.execute("DELETE FROM skills WHERE name = ?", (name,))
        await db.commit()
    return cur.rowcount > 0
