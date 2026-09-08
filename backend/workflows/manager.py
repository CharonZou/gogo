"""工作流模板：把多步 DAG 固化为可填参复跑的工作流（P1.4）。

模板（workflows 表）存规范化 steps；/run 实例化为 task + subtasks（PLANNED），
复用 planner 校验与 subtasks 落库结构，之后走现有 approve → execute 闭环。
"""

from __future__ import annotations

import json
import uuid

from backend.core import db
from backend.orchestration.planner import parse_plan, plan_to_dict

_initialized_paths: set[str] = set()


class WorkflowManager:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or db.get_db_path()

    async def _ensure_db(self) -> None:
        """惰性初始化 schema（幂等，按路径缓存）。"""
        if self.db_path in _initialized_paths:
            return
        await db.init_db(self.db_path)
        _initialized_paths.add(self.db_path)

    # ---------- 模板 CRUD ----------

    async def create(
        self,
        name: str,
        description: str,
        steps: list[dict],
    ) -> dict:
        """创建模板：校验步骤 DAG → 规范化落库（draft）。"""
        if not name or not name.strip():
            raise ValueError("工作流名称不能为空")
        plan = _validate_steps(steps)
        await self._ensure_db()
        workflow_id = uuid.uuid4().hex[:12]
        steps_json = json.dumps(plan_to_dict(plan)["tasks"], ensure_ascii=False)
        await db.insert_workflow(
            self.db_path, workflow_id, name.strip(), description or "", steps_json
        )
        return await db.get_workflow(self.db_path, workflow_id)

    async def update(
        self,
        workflow_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        steps: list[dict] | None = None,
        status: str | None = None,
    ) -> dict:
        """更新模板（只更新传入字段，steps 变更会重新校验）。"""
        await self._ensure_db()
        if await db.get_workflow(self.db_path, workflow_id) is None:
            raise KeyError(f"工作流模板不存在：{workflow_id}")
        if status is not None and status not in ("draft", "active", "archived"):
            raise ValueError(f"非法状态：{status}")
        steps_json = None
        if steps is not None:
            plan = _validate_steps(steps)
            steps_json = json.dumps(plan_to_dict(plan)["tasks"], ensure_ascii=False)
        await db.update_workflow(
            self.db_path,
            workflow_id,
            name=name.strip() if name else None,
            description=description,
            steps_json=steps_json,
            status=status,
        )
        return await db.get_workflow(self.db_path, workflow_id)

    async def delete(self, workflow_id: str) -> dict:
        """删除模板。"""
        await self._ensure_db()
        wf = await db.get_workflow(self.db_path, workflow_id)
        if wf is None:
            raise KeyError(f"工作流模板不存在：{workflow_id}")
        await db.delete_workflow(self.db_path, workflow_id)
        return {"deleted": workflow_id}

    async def get(self, workflow_id: str) -> dict:
        await self._ensure_db()
        wf = await db.get_workflow(self.db_path, workflow_id)
        if wf is None:
            raise KeyError(f"工作流模板不存在：{workflow_id}")
        return wf

    async def list(self) -> list[dict]:
        await self._ensure_db()
        return await db.list_workflows(self.db_path)

    # ---------- 实例化 ----------

    async def run(self, workflow_id: str) -> dict:
        """把模板实例化为任务：创建 task + steps 落库为 subtasks（PLANNED）。

        之后走现有闭环：POST /tasks/{id}/approve → 后台执行。
        """
        await self._ensure_db()
        wf = await db.get_workflow(self.db_path, workflow_id)
        if wf is None:
            raise KeyError(f"工作流模板不存在：{workflow_id}")
        steps = wf["steps"]
        if not steps:
            raise ValueError(f"工作流模板为空：{workflow_id}")

        goal = f"【工作流】{wf['name']}"
        if wf["description"]:
            goal += f"：{wf['description']}"
        task_id = uuid.uuid4().hex[:12]
        await db.insert_task(
            self.db_path,
            task_id,
            goal,
            "workflow",
            kind="task",
            title=wf["name"],
        )
        # subtasks.id 为全局主键：用 {task_id}-{step_id} 复合 id 保证跨实例唯一，
        # depends_on 同步映射到复合 id，依赖解析与执行器一致。
        id_map = {s["id"]: f"{task_id}-{s['id']}" for s in steps}
        for position, sub in enumerate(steps):
            await db.insert_subtask(
                self.db_path,
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
            self.db_path,
            task_id,
            "PLANNED",
            plan_json=json.dumps({"tasks": steps}, ensure_ascii=False),
        )
        await db.increment_workflow_run_count(self.db_path, workflow_id)
        return {
            "task_id": task_id,
            "status": "PLANNED",
            "message": "已实例化，可 POST /api/v1/tasks/{id}/approve 授权执行",
        }


def _validate_steps(steps: list[dict]) -> list:
    """复用 planner 校验：id 唯一 / 依赖存在 / 无环，返回规范化 PlanTask 列表。"""
    if not isinstance(steps, list) or not steps:
        raise ValueError("步骤列表不能为空")
    return parse_plan({"tasks": steps})
