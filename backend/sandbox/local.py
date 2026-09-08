"""本地沙箱：真实实现（asyncio subprocess）。

- 所有命令在独立工作目录内执行，带超时；
- 文件读写做路径包含校验，禁止越出沙箱根目录。
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from backend.sandbox.base import Sandbox


class SandboxPathError(ValueError):
    """文件路径越出沙箱根目录。"""


class LocalSandbox(Sandbox):
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _contained(self, path: str | Path) -> Path:
        resolved = (self.root / path).resolve()
        if not resolved.is_relative_to(self.root):
            raise SandboxPathError(f"路径越出沙箱：{path}")
        return resolved

    async def run(self, command: str, *, timeout: float | None = 30) -> str:
        """在沙箱工作目录执行 shell 命令，返回 stdout+stderr。"""
        if not command or not command.strip():
            return ""
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=str(self.root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError as exc:
            proc.kill()
            await proc.wait()
            raise TimeoutError(f"命令超时（>{timeout}s）：{command[:100]}") from exc
        text = (out + err).decode(errors="replace").strip()
        if proc.returncode != 0:
            raise RuntimeError(f"命令退出码 {proc.returncode}：{text[:500]}")
        return text

    async def write_file(self, path: str, content: str) -> str:
        target = self._contained(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"已写入 {path}"

    async def read_file(self, path: str) -> str:
        target = self._contained(path)
        return target.read_text(encoding="utf-8")
