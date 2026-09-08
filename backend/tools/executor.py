"""工具执行器：注册式异步工具，供执行引擎调用。"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from backend.core.config import get_settings
from backend.sandbox.local import LocalSandbox

Handler = Callable[..., Awaitable[object]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    handler: Handler


class ToolExecutor:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def has(self, name: str) -> bool:
        return name in self._tools

    def list_tools(self) -> list[dict]:
        return [
            {"name": t.name, "description": t.description}
            for t in self._tools.values()
        ]

    async def call(self, name: str, **kwargs: object) -> object:
        if name not in self._tools:
            raise KeyError(f"未知工具：{name}")
        return await self._tools[name].handler(**kwargs)


async def _noop() -> dict:
    """空操作占位工具。"""
    return {"result": "noop"}


def build_default_executor(sandbox_root: str | Path | None = None) -> ToolExecutor:
    """注册默认工具集：noop / bash / write_file / read_file。"""
    root = Path(sandbox_root or get_settings().sandbox_root)
    sandbox = LocalSandbox(root)

    executor = ToolExecutor()
    executor.register(ToolSpec("noop", "空操作（占位）", _noop))
    executor.register(
        ToolSpec(
            "bash",
            "在沙箱内执行 shell 命令（带超时）",
            lambda command, timeout=30: sandbox.run(str(command), timeout=timeout),
        )
    )
    executor.register(
        ToolSpec(
            "write_file",
            "在沙箱内写入文件（禁止越出沙箱）",
            lambda path, content: sandbox.write_file(str(path), str(content)),
        )
    )
    executor.register(
        ToolSpec(
            "read_file",
            "读取沙箱内文件（禁止越出沙箱）",
            lambda path: sandbox.read_file(str(path)),
        )
    )
    return executor
