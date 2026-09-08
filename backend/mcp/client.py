"""MCP 客户端封装（接口桩）。

基于官方 mcp Python SDK，支持 stdio / SSE / HTTP 三种传输。
TODO：session 生命周期、工具列表同步、OAuth、热更新。
"""

from __future__ import annotations

from enum import Enum


class MCPTransport(str, Enum):
    STDIO = "stdio"
    SSE = "sse"
    HTTP = "http"


class MCPClient:
    def __init__(
        self,
        name: str,
        transport: MCPTransport = MCPTransport.STDIO,
        endpoint: str | None = None,
    ) -> None:
        self.name = name
        self.transport = transport
        self.endpoint = endpoint

    async def connect(self) -> None:
        """建立 MCP 会话（桩）。"""
        raise NotImplementedError("MCP 连接待实现")

    async def list_tools(self) -> list[dict]:
        """列出远端工具（桩）。"""
        raise NotImplementedError("MCP 工具列表待实现")
