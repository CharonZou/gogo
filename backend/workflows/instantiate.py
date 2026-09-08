"""步骤 DAG 实例化公共逻辑（工作流模板 / 应用共用）。

把规范化 steps 落库为任务的 subtasks（PLANNED），后续走现有 approve → 执行闭环。
subtasks.id 为全局主键：统一映射为 {task_id}-{id}，depends_on 同步映射。
"""

from __future__ import annotations

import json
import uuid

from backend.core import db


async def instantiate_steps(
    path: str,
    task_id: str,
    steps: list[dict],
    *,
    goal: str,
    source: str = "workflow",
    title: str | None = None,
    kind: str = "task",
) -> str:
    """创建任务并把步骤实例化为 subtasks（PLANNED），返回 task_id。"""
    await db.insert_task(
        path,
        task_id,
        goal,
        source,
        kind=kind,
        title=title,
    )
    id_map = {s["id"]: f"{task_id}-{s['id']}" for s in steps}
    for position, sub in enumerate(steps):
        await db.insert_subtask(
            path,
            id_map[sub["id"]],
            task_id,
            sub["title"],
            sub.get("description", ""),
            [id_map[d] for d in sub.get("depends_on", [])],
            sub.get("tool", "noop"),
            sub.get("tool_args", {}),
            position,
        )
    await db.update_task_status(
        path,
        task_id,
        "PLANNED",
        plan_json=json.dumps({"tasks": steps}, ensure_ascii=False),
    )
    return task_id


def new_task_id() -> str:
    return uuid.uuid4().hex[:12]
