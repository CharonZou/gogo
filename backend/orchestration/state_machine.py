"""任务状态机：Plan → Execute → Verify。

接口桩：状态与迁移先行定义，执行逻辑后续接入。
"""

from __future__ import annotations

from enum import Enum


class TaskState(str, Enum):
    PENDING = "PENDING"  # 已创建，待规划
    PLANNED = "PLANNED"  # 已生成计划 DAG
    APPROVED = "APPROVED"  # 用户授权后待执行
    RUNNING = "RUNNING"  # 执行中（可能含并行子任务）
    VERIFYING = "VERIFYING"  # 产出待验收
    DONE = "DONE"  # 验收通过
    FAILED = "FAILED"  # 失败（可重试）


VALID_TRANSITIONS: dict[TaskState, set[TaskState]] = {
    TaskState.PENDING: {TaskState.PLANNED, TaskState.FAILED},
    TaskState.PLANNED: {TaskState.APPROVED, TaskState.PENDING},
    TaskState.APPROVED: {TaskState.RUNNING},
    TaskState.RUNNING: {TaskState.VERIFYING, TaskState.FAILED},
    TaskState.VERIFYING: {TaskState.DONE, TaskState.RUNNING, TaskState.FAILED},
    TaskState.DONE: set(),
    TaskState.FAILED: {TaskState.PENDING, TaskState.RUNNING},
}


class StateMachine:
    """轻量任务状态机，非法迁移直接拒绝。"""

    def __init__(self, initial: TaskState = TaskState.PENDING) -> None:
        self._state = initial

    @property
    def state(self) -> TaskState:
        return self._state

    def transition(self, target: TaskState) -> TaskState:
        if target not in VALID_TRANSITIONS[self._state]:
            raise ValueError(
                f"非法迁移：{self._state.value} -> {target.value}"
            )
        self._state = target
        return self._state
