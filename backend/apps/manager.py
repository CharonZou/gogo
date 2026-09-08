"""应用中心（P2.3）：把已跑通的流程固化为可填参复跑的应用。

apps 表存应用定义（名称 / 目标 / 步骤 DAG / 运行参数 / 三态），
run() 用运行参数渲染目标与步骤 tool_args，实例化为 task + subtasks（PLANNED），
之后走现有 approve → 执行闭环，运行记录写入 app_runs。
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping

from backend.core import db
from backend.orchestration.planner import parse_plan, plan_to_dict
from backend.workflows.instantiate import instantiate_steps, new_task_id

_initialized_paths: set[str] = set()


class AppManager:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or db.get_db_path()

    async def _ensure_db(self) -> None:
        if self.db_path in _initialized_paths:
            return
        await db.init_db(self.db_path)
        _initialized_paths.add(self.db_path)

    # ---------- CRUD ----------

    async def create(
        self,
        name: str,
        steps: list[dict],
        *,
        description: str = "",
        goal: str = "",
        params: list[dict] | None = None,
        execution_mode: str = "auto",
    ) -> dict:
        """创建应用（草稿）。步骤 DAG 复用 planner 校验。"""
        if not name or not name.strip():
            raise ValueError("应用名称不能为空")
        _validate_params(params or [])
        plan = parse_plan({"tasks": steps})
        steps_json = json.dumps(plan_to_dict(plan)["tasks"], ensure_ascii=False)
        await self._ensure_db()
        app_id = uuid.uuid4().hex[:12]
        await db.insert_app(
            self.db_path,
            app_id,
            name.strip(),
            description or "",
            goal or "",
            steps_json,
            json.dumps(params or [], ensure_ascii=False),
            execution_mode,
        )
        return await self.get(app_id)

    async def update(
        self,
        app_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        goal: str | None = None,
        steps: list[dict] | None = None,
        params: list[dict] | None = None,
        execution_mode: str | None = None,
        status: str | None = None,
    ) -> dict:
        """更新应用（只更新传入字段）。"""
        await self._ensure_db()
        if await db.get_app(self.db_path, app_id) is None:
            raise KeyError(f"应用不存在：{app_id}")
        if params is not None:
            _validate_params(params)
        steps_json = None
        if steps is not None:
            plan = parse_plan({"tasks": steps})
            steps_json = json.dumps(plan_to_dict(plan)["tasks"], ensure_ascii=False)
        params_json = None
        if params is not None:
            params_json = json.dumps(params, ensure_ascii=False)
        await db.update_app(
            self.db_path,
            app_id,
            name=name.strip() if name else None,
            description=description,
            goal=goal,
            steps_json=steps_json,
            params_json=params_json,
            execution_mode=execution_mode,
            status=status,
        )
        return await self.get(app_id)

    async def delete(self, app_id: str) -> dict:
        await self._ensure_db()
        if await db.get_app(self.db_path, app_id) is None:
            raise KeyError(f"应用不存在：{app_id}")
        await db.delete_app(self.db_path, app_id)
        return {"deleted": app_id}

    async def get(self, app_id: str) -> dict:
        await self._ensure_db()
        app = await db.get_app(self.db_path, app_id)
        if app is None:
            raise KeyError(f"应用不存在：{app_id}")
        return app

    async def list(self) -> list[dict]:
        await self._ensure_db()
        return await db.list_apps(self.db_path)

    # ---------- 运行 ----------

    async def run(self, app_id: str, params: dict | None = None) -> dict:
        """填参运行：渲染目标与步骤参数 → 实例化任务（PLANNED）。

        未发布应用不可运行（对齐规格：▶ 运行 / 填参运行要求已发布）。
        实例化后走现有闭环：POST /tasks/{id}/approve 授权执行。
        """
        await self._ensure_db()
        app = await db.get_app(self.db_path, app_id)
        if app is None:
            raise KeyError(f"应用不存在：{app_id}")
        if app["status"] != "published":
            raise ValueError(f"应用未发布，不能运行：{app_id}")

        params = params or {}
        _validate_run_params(app["params"], params)
        steps = _render_steps(app["steps"], params)
        if not steps:
            raise ValueError(f"应用步骤为空：{app_id}")

        goal = _render_goal(app["goal"] or f"【应用】{app['name']}", app["name"], params)
        task_id = await instantiate_steps(
            self.db_path,
            new_task_id(),
            steps,
            goal=goal,
            source="app",
            title=app["name"],
        )
        run_id = uuid.uuid4().hex[:12]
        await db.insert_app_run(self.db_path, run_id, app_id, params, task_id)
        await db.increment_app_run_count(self.db_path, app_id)
        return {
            "run_id": run_id,
            "task_id": task_id,
            "status": "PLANNED",
            "message": "已实例化，可 POST /api/v1/tasks/{id}/approve 授权执行",
        }

    async def runs(self, app_id: str) -> list[dict]:
        await self._ensure_db()
        if await db.get_app(self.db_path, app_id) is None:
            raise KeyError(f"应用不存在：{app_id}")
        return await db.list_app_runs(self.db_path, app_id)


def _validate_params(params: list[dict]) -> None:
    seen: set[str] = set()
    for p in params:
        name = p.get("name", "")
        if not name or not name.strip():
            raise ValueError("运行参数 name 不能为空")
        if name in seen:
            raise ValueError(f"运行参数重复：{name}")
        seen.add(name)


def _validate_run_params(params_def: list[dict], given: dict) -> None:
    given_names = set(given)
    unknown = given_names - {p["name"] for p in params_def}
    if unknown:
        raise ValueError(f"未知运行参数：{', '.join(sorted(unknown))}")
    missing = [
        p["name"] for p in params_def if p.get("required") and p["name"] not in given
    ]
    if missing:
        raise ValueError(f"缺少必填参数：{', '.join(sorted(missing))}")


def _render_goal(template: str, name: str, params: Mapping[str, object]) -> str:
    rendered = _render_value(template, params)
    if params:
        parts = "，".join(f"{k}={v}" for k, v in params.items())
        rendered = f"{rendered}\n运行参数：{parts}"
    return f"【应用】{name}\n目标：{rendered}"


def _render_steps(steps: list[dict], params: Mapping[str, object]) -> list[dict]:
    out = []
    for s in steps:
        step = dict(s)
        step["tool_args"] = _render_value(step.get("tool_args", {}), params)
        out.append(step)
    return out


def _render_value(value: object, params: Mapping[str, object]) -> object:
    if isinstance(value, str):
        rendered = value
        for k, v in params.items():
            rendered = rendered.replace("{" + k + "}", str(v))
        return rendered
    if isinstance(value, dict):
        return {k: _render_value(v, params) for k, v in value.items()}
    if isinstance(value, list):
        return [_render_value(v, params) for v in value]
    return value
