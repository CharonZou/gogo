"""MCP 注册与生命周期管理（P2.3）。

mcp_servers 表为权威配置源；enabled 服务器在启动 / 配置变更时连接，
工具以 mcp__<server>__<tool> 注册进 ToolExecutor；禁用即断开并注销。
"""

from __future__ import annotations

import uuid

from backend.core import db
from backend.mcp.server import MCPConnectionError, MCPServerConnection
from backend.tools.executor import ToolExecutor, ToolSpec


class MCPManager:
    def __init__(self, db_path: str | None = None, executor: ToolExecutor | None = None):
        self.db_path = db_path or db.get_db_path()
        self.executor = executor or ToolExecutor()
        self._connections: dict[str, MCPServerConnection] = {}

    async def _ensure_db(self) -> None:
        await db.ensure_initialized(self.db_path)

    # ---------- 配置 CRUD ----------

    async def upsert(
        self,
        name: str,
        mcp_type: str,
        config: dict,
        *,
        enabled: bool = True,
        description: str = "",
    ) -> dict:
        if mcp_type not in ("stdio", "sse", "streamable-http"):
            raise ValueError(f"不支持的传输类型：{mcp_type}")
        await self._ensure_db()
        await db.upsert_mcp_server(
            self.db_path,
            uuid.uuid4().hex[:12],
            name.strip(),
            mcp_type,
            config,
            enabled=enabled,
            description=description or "",
        )
        await self.reset(name)
        return await self.get(name)

    async def set_enabled(self, name: str, enabled: bool) -> dict:
        await self._ensure_db()
        if await db.get_mcp_server(self.db_path, name) is None:
            raise KeyError(f"MCP 服务器不存在：{name}")
        await db.set_mcp_enabled(self.db_path, name, enabled)
        await self.reset(name)
        return await self.get(name)

    async def delete(self, name: str) -> dict:
        await self._ensure_db()
        if await db.get_mcp_server(self.db_path, name) is None:
            raise KeyError(f"MCP 服务器不存在：{name}")
        await self._disconnect(name)
        await db.delete_mcp_server(self.db_path, name)
        return {"deleted": name}

    async def get(self, name: str) -> dict:
        await self._ensure_db()
        srv = await db.get_mcp_server(self.db_path, name)
        if srv is None:
            raise KeyError(f"MCP 服务器不存在：{name}")
        conn = self._connections.get(name)
        srv["tool_count"] = len(conn.tools) if conn else 0
        return srv

    async def list(self) -> list[dict]:
        await self._ensure_db()
        out = []
        for srv in await db.list_mcp_servers(self.db_path):
            conn = self._connections.get(srv["name"])
            srv["tool_count"] = len(conn.tools) if conn else 0
            out.append(srv)
        return out

    # ---------- 连接 / 热重载 ----------

    async def load_enabled(self) -> list[dict]:
        """启动时连接全部 enabled 服务器（已连接则跳过），返回失败的服务器列表。"""
        await self._ensure_db()
        failed: list[dict] = []
        for srv in await db.list_mcp_servers(self.db_path):
            if not srv["enabled"]:
                continue
            if srv["name"] in self._connections:
                continue  # 已连接（热重载后）不重复连
            try:
                await self._connect(srv["name"])
            except MCPConnectionError as exc:
                failed.append({"name": srv["name"], "error": str(exc)})
        return failed

    async def reset(self, name: str) -> None:
        """配置变更后热重载：断开旧连接 → 按 enabled 重连（幂等）。

        连接失败不阻断配置保存（load_status 已记录 error）。
        """
        await self._disconnect(name)
        srv = await db.get_mcp_server(self.db_path, name)
        if srv is not None and srv["enabled"]:
            try:
                await self._connect(name)
            except MCPConnectionError:
                pass

    async def shutdown(self) -> None:
        """服务停止：断开全部活动连接。"""
        for name in list(self._connections):
            await self._disconnect(name)

    async def _connect(self, name: str) -> None:
        srv = await db.get_mcp_server(self.db_path, name)
        if srv is None:
            return
        conn = MCPServerConnection(
            name, srv["type"], srv["config"]
        )
        try:
            tools = await conn.connect()
        except MCPConnectionError as exc:
            await db.update_mcp_status(self.db_path, name, "error", str(exc))
            raise
        # 注册工具：mcp__<server>__<tool>
        for t in tools:
            tool_name = f"mcp__{name}__{t['name']}"
            self.executor.register(
                ToolSpec(
                    tool_name,
                    f"[MCP:{name}] {t['description'] or t['name']}",
                    _make_handler(conn, t["name"]),
                )
            )
        self._connections[name] = conn
        await db.update_mcp_status(self.db_path, name, "connected")

    async def _disconnect(self, name: str) -> None:
        conn = self._connections.pop(name, None)
        if conn is None:
            return
        for t in list(conn.tools):
            self.executor.unregister(f"mcp__{name}__{t['name']}")
        await conn.close()
        await db.update_mcp_status(self.db_path, name, "unloaded")


def _make_handler(conn: MCPServerConnection, tool: str):
    async def handler(**kwargs: object) -> object:
        return await conn.call(tool, **kwargs)

    return handler
