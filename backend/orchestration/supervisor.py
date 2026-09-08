"""Supervisor：澄清意图 → 拆子任务 DAG → 授权 → 验收（接口桩）。

当前仅提供任务创建；规划与执行逻辑后续接入。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from backend.orchestration.state_machine import StateMachine


@dataclass
class Task:
    task_id: str
    goal: str
    source: str
    machine: StateMachine = field(default_factory=StateMachine)


class Supervisor:
    """编排入口。"""

    def __init__(self) -> None:
        self._tasks: dict[str, Task] = {}

    def create_task_stub(self, payload: dict) -> str:
        """创建任务（桩）：生成 ID 并登记，状态 PENDING。"""
        task_id = uuid.uuid4().hex[:12]
        task = Task(
            task_id=task_id,
            goal=str(payload.get("goal", "")),
            source=str(payload.get("source", "rpc")),
        )
        self._tasks[task_id] = task
        return task_id

    def get_task(self, task_id: str) -> Task | None:
        return self._tasks.get(task_id)
