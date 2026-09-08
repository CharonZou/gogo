"""MCP 服务器连接与调用（stdio / sse / streamable-http 三种传输）。

基于官方 mcp SDK：connect() 建立会话并拉取工具清单，
call() 转发工具调用。工具命名 mcp__<server>__<tool>（与 Codex 对齐）。
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamable_http_client

from backend.core.config import get_settings


class MCPConnectionError(RuntimeError):
    """连接 / 初始化 / 调用失败。"""


class MCPServerConnection:
    """单个 MCP 服务器的活动会话 + 工具注册表。"""

    def __init__(
        self,
        name: str,
        mcp_type: str,
        config: dict[str, Any],
        *,
        request_timeout: float | None = None,
    ) -> None:
        self.name = name
        self.mcp_type = mcp_type
        self.config = config
        settings = get_settings()
        self.request_timeout = request_timeout or settings.mcp_request_timeout
        self.tools: list[dict] = []
        self._session: ClientSession | None = None
        self._transport_ctx: Any = None
        self._http_client: httpx.AsyncClient | None = None

    # ---------- 生命周期 ----------

    async def connect(self) -> list[dict]:
        """建立会话并拉取工具清单，返回 [{name, description, inputSchema}]。"""
        try:
            await self._connect()
        except MCPConnectionError:
            raise
        except (Exception, asyncio.CancelledError) as exc:
            # mcp 客户端连接失败可能以内部 cancel-scope 取消（CancelledError）表现
            raise MCPConnectionError(f"连接失败：{exc}") from exc
        if self._session is None:
            raise MCPConnectionError(f"会话未建立：{self.name}")
        tools = await self._session.list_tools()
        self.tools = [
            {
                "name": t.name,
                "description": t.description or "",
                "inputSchema": t.inputSchema or {},
            }
            for t in tools.tools
        ]
        return self.tools

    async def _connect(self) -> None:
        # 先校验配置，避免进入传输 context 后才失败（anyio 清理噪音）
        if self.mcp_type == "stdio":
            command = self.config.get("command", "")
            if not command:
                raise MCPConnectionError("stdio 需要配置 command")
            transport_ctx = stdio_client(
                StdioServerParameters(
                    command=command,
                    args=list(self.config.get("args", [])),
                    env=dict(self.config.get("env") or {}),
                )
            )
        elif self.mcp_type == "streamable-http":
            url = self.config.get("url", "")
            if not url:
                raise MCPConnectionError("streamable-http 需要配置 url")
            headers = dict(self.config.get("headers") or {})
            if headers:
                self._http_client = httpx.AsyncClient(
                    headers=headers, timeout=self.request_timeout
                )
                await self._http_client.__aenter__()
            transport_ctx = streamable_http_client(
                url, http_client=self._http_client
            )
        elif self.mcp_type == "sse":
            url = self.config.get("url", "")
            if not url:
                raise MCPConnectionError("sse 需要配置 url")
            transport_ctx = sse_client(
                url,
                headers=dict(self.config.get("headers") or {}),
            )
        else:
            raise MCPConnectionError(f"不支持的传输类型：{self.mcp_type}")

        entered: list[Any] = []
        try:
            entered_vals = await transport_ctx.__aenter__()
            read, write = entered_vals[0], entered_vals[1]
            entered.append(transport_ctx)
            self._transport_ctx = transport_ctx
            self._session = ClientSession(read, write)
            await self._session.__aenter__()
            entered.append(self._session)
            await self._session.initialize()
        except BaseException:
            # 逆序回滚已进入的 context；anyio task group 在连接失败时
            # 的 cancel-scope 清理可能抛 RuntimeError（Windows/asyncio 已知），
            # 此时连接已失败，吞掉清理噪音保留原始异常。
            for ctx in reversed(entered):
                try:
                    await ctx.__aexit__(None, None, None)
                except (RuntimeError, BaseExceptionGroup, asyncio.CancelledError):
                    pass
            if self._http_client is not None:
                try:
                    await self._http_client.__aexit__(None, None, None)
                except Exception:  # noqa: S110 BLE001 - 清理噪音，连接已失败
                    pass
                self._http_client = None
            self._session = None
            self._transport_ctx = None
            raise

    async def call(self, tool_name: str, **kwargs: object) -> object:
        """调用工具。返回工具结果（content 文本拼接）。"""
        if self._session is None:
            raise MCPConnectionError(f"未连接：{self.name}")
        try:
            result = await self._session.call_tool(tool_name, kwargs or {})
        except Exception as exc:  # 调用失败统一包装
            raise MCPConnectionError(f"调用失败：{exc}") from exc
        if getattr(result, "isError", False):
            text = _content_text(result.content)
            raise MCPConnectionError(f"工具返回错误：{text or '未知错误'}")
        return {"result": _content_text(result.content)}

    async def close(self) -> None:
        if self._session is not None:
            try:
                await self._session.__aexit__(None, None, None)
            except (RuntimeError, BaseExceptionGroup, asyncio.CancelledError):
                pass
            self._session = None
        if self._transport_ctx is not None:
            try:
                await self._transport_ctx.__aexit__(None, None, None)
            except (RuntimeError, BaseExceptionGroup, asyncio.CancelledError):
                pass
            self._transport_ctx = None
        if self._http_client is not None:
            try:
                await self._http_client.__aexit__(None, None, None)
            except Exception:  # noqa: S110 BLE001 - 清理噪音
                pass
            self._http_client = None
        self.tools = []


def _content_text(content: list[Any] | None) -> str:
    """把 MCP 返回的 content 块拼成文本（text / image / resource 兜底）。"""
    if not content:
        return ""
    parts: list[str] = []
    for block in content:
        btype = getattr(block, "type", "text")
        if btype == "text":
            parts.append(getattr(block, "text", "") or "")
        elif btype == "image":
            parts.append("[图片]")
        elif btype == "resource":
            parts.append(f"[资源 {getattr(block, 'uri', '')}]")
    return "\n".join(p for p in parts if p)
