"""沙箱抽象与实现（接口桩）。

同一套接口三种模式：LocalSandbox / DockerSandbox / K8sSandbox。
TODO：分别基于 subprocess / docker-py / k8s client 实现。
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class Sandbox(ABC):
    """沙箱接口：Agent 的代码 / 文件 / 命令执行环境。"""

    @abstractmethod
    async def run(self, command: str, *, timeout: float | None = None) -> str:
        """在沙箱内执行命令并返回输出。"""

    @abstractmethod
    async def write_file(self, path: str, content: str) -> None:
        """在沙箱内写入文件。"""


class LocalSandbox(Sandbox):
    """本地沙箱：命令直接在本机运行（单机可信场景）。"""

    async def run(self, command: str, *, timeout: float | None = None) -> str:
        raise NotImplementedError("本地沙箱待实现")

    async def write_file(self, path: str, content: str) -> None:
        raise NotImplementedError("本地沙箱待实现")


class DockerSandbox(Sandbox):
    """Docker 沙箱：隔离容器内执行（默认生产模式）。"""

    async def run(self, command: str, *, timeout: float | None = None) -> str:
        raise NotImplementedError("Docker 沙箱待实现")

    async def write_file(self, path: str, content: str) -> None:
        raise NotImplementedError("Docker 沙箱待实现")


class K8sSandbox(Sandbox):
    """K8s 沙箱：集群内执行（预留）。"""

    async def run(self, command: str, *, timeout: float | None = None) -> str:
        raise NotImplementedError("K8s 沙箱待实现")

    async def write_file(self, path: str, content: str) -> None:
        raise NotImplementedError("K8s 沙箱待实现")
