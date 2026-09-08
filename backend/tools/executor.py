"""工具执行器（接口桩）。

注册式工具：统一注册 / 鉴权 / 审计。
TODO：内置 WebSearch / CodeRunner / Browser / Mail / Office 等工具。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    handler: Callable[..., object]


class ToolExecutor:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def list_tools(self) -> list[dict]:
        return [
            {"name": t.name, "description": t.description}
            for t in self._tools.values()
        ]

    def call(self, name: str, **kwargs: object) -> object:
        if name not in self._tools:
            raise KeyError(f"未知工具：{name}")
        return self._tools[name].handler(**kwargs)
