"""规划器：把用户目标拆解为子任务 DAG。

真实实现：LLM 生成计划 JSON → 校验（id 唯一 / 依赖存在 / 无环）→ 落库。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from backend.llm.client import LLMClient, LLMNotConfiguredError
from backend.orchestration.dag import (
    add_dependency,
    add_task,
    build_empty_dag,
    is_acyclic,
)

PLAN_PROMPT = """你是任务规划器。把用户的目标拆解为一个可执行、可验收的子任务 DAG。

规则：
1. 输出严格 JSON，不要输出其他文字，格式：
{"tasks": [{"id": "t1", "title": "简短标题", "description": "这一步做什么、产出什么", "depends_on": ["t0"], "acceptance": "验收标准"}]}
2. id 全局唯一；depends_on 只能引用已存在的 id；不得成环。
3. 任务数 3-6 个；第一个任务无依赖（depends_on 为空数组）。
4. 最后一个任务产出最终交付物。
5. 只做拆解，不要包含任何 shell 命令或工具调用细节。"""


@dataclass
class PlanTask:
    id: str
    title: str
    description: str
    depends_on: list[str] = field(default_factory=list)
    acceptance: str = ""
    tool: str = "noop"
    tool_args: dict[str, Any] = field(default_factory=dict)


async def plan_with_llm(llm: LLMClient, goal: str) -> dict:
    """默认规划器：调用 LLM 生成计划 JSON。"""
    messages = [
        {"role": "system", "content": PLAN_PROMPT},
        {"role": "user", "content": f"用户目标：{goal}"},
    ]
    return await llm.chat_json(messages)


def parse_plan(payload: dict) -> list[PlanTask]:
    """校验并解析 LLM 返回的计划 JSON。

    校验：tasks 存在且非空、id 唯一、依赖存在、无环。
    """
    raw_tasks = payload.get("tasks")
    if not isinstance(raw_tasks, list) or not raw_tasks:
        raise ValueError("计划缺少 tasks 数组")

    ids = [str(t.get("id", "")).strip() for t in raw_tasks]
    if any(not i for i in ids):
        raise ValueError("子任务 id 不能为空")
    if len(ids) != len(set(ids)):
        raise ValueError("子任务 id 重复")

    graph = build_empty_dag()
    for t, task_id in zip(raw_tasks, ids):
        add_task(graph, task_id, title=str(t.get("title", task_id)))

    plans: list[PlanTask] = []
    for t, task_id in zip(raw_tasks, ids):
        deps = t.get("depends_on") or []
        if not isinstance(deps, list):
            raise ValueError(f"子任务 {task_id} 的 depends_on 必须是数组")
        deps = [str(d) for d in deps]
        for dep in deps:
            if dep not in graph.nodes:
                raise ValueError(f"子任务 {task_id} 依赖不存在的任务 {dep}")
            add_dependency(graph, dep, task_id)

        tool = str(t.get("tool", "noop") or "noop")
        tool_args = t.get("tool_args") or {}
        if not isinstance(tool_args, dict):
            raise ValueError(f"子任务 {task_id} 的 tool_args 必须是对象")
        plans.append(
            PlanTask(
                id=task_id,
                title=str(t.get("title", task_id)),
                description=str(t.get("description", "")),
                depends_on=deps,
                acceptance=str(t.get("acceptance", "")),
                tool=tool,
                tool_args=tool_args,
            )
        )

    if not is_acyclic(graph):
        raise ValueError("计划存在环（依赖成环）")
    return plans


def plan_to_dict(plan: list[PlanTask]) -> dict:
    return {
        "tasks": [
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "depends_on": t.depends_on,
                "acceptance": t.acceptance,
                "tool": t.tool,
                "tool_args": t.tool_args,
            }
            for t in plan
        ]
    }


def plan_to_json(plan: list[PlanTask]) -> str:
    return json.dumps(plan_to_dict(plan), ensure_ascii=False)


def is_llm_misconfigured(exc: Exception) -> bool:
    return isinstance(exc, (LLMNotConfiguredError,))
