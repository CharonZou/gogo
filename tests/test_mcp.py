"""MCP 注册（P2.3）测试：配置 CRUD / 启停 / 工具命名 / 真实 stdio 调用。

mcp SDK 的 anyio task group 与 pytest-asyncio 循环作用域不兼容，
测试用 asyncio.run 独立事件循环执行（与生产 uvicorn 一致）。
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from backend.mcp.manager import MCPManager
from backend.tools.executor import ToolExecutor

ECHO_SERVER = str(Path(__file__).parent / "mcp_echo_server.py")


def _run(coro):
    return asyncio.run(coro)


def _manager(tmp_path) -> MCPManager:
    return MCPManager(
        db_path=str(tmp_path / "mcp.db"),
        executor=ToolExecutor(),
    )


def test_upsert_validates_type(tmp_path) -> None:
    async def body():
        mgr = _manager(tmp_path)
        try:
            try:
                await mgr.upsert("bad", "websocket", {})
                assert False, "应拒绝非法传输类型"
            except ValueError as exc:
                assert "传输类型" in str(exc)
        finally:
            await mgr.shutdown()

    _run(body())


def test_connect_stdio_and_call_tool(tmp_path) -> None:
    async def body():
        mgr = _manager(tmp_path)
        try:
            srv = await mgr.upsert(
                "echo",
                "stdio",
                {"command": sys.executable, "args": [ECHO_SERVER]},
                description="echo 测试",
            )
            assert srv["load_status"] == "connected"
            assert srv["tool_count"] == 2

            # 工具以 mcp__<server>__<tool> 注册
            assert mgr.executor.has("mcp__echo__echo")
            assert mgr.executor.has("mcp__echo__add")

            result = await mgr.executor.call("mcp__echo__echo", text="你好")
            assert result == {"result": "echo:你好"}
            result = await mgr.executor.call("mcp__echo__add", a=2, b=3)
            assert result == {"result": "5"}

            # 覆盖同名校准（upsert 幂等）
            srv2 = await mgr.upsert(
                "echo", "stdio", {"command": sys.executable, "args": [ECHO_SERVER]}
            )
            assert srv2["load_status"] == "connected"
        finally:
            await mgr.shutdown()

    _run(body())


def test_disable_disconnects_and_unregisters(tmp_path) -> None:
    async def body():
        mgr = _manager(tmp_path)
        try:
            await mgr.upsert(
                "echo", "stdio", {"command": sys.executable, "args": [ECHO_SERVER]}
            )
            assert mgr.executor.has("mcp__echo__echo")

            srv = await mgr.set_enabled("echo", False)
            assert srv["enabled"] == 0
            assert srv["load_status"] == "unloaded"
            assert not mgr.executor.has("mcp__echo__echo")

            # 重新启用 → 重连注册
            srv = await mgr.set_enabled("echo", True)
            assert srv["load_status"] == "connected"
            assert mgr.executor.has("mcp__echo__echo")
        finally:
            await mgr.shutdown()

    _run(body())


def test_connect_failure_records_error(tmp_path) -> None:
    async def body():
        mgr = _manager(tmp_path)
        try:
            # 配置校验失败（缺 url）→ error 记录且不注册工具。
            # （真实网络失败路径已单独验证：MCPServerConnection 把
            #   连接异常包装为 MCPConnectionError，manager 同样记录 error。）
            srv = await mgr.upsert(
                "broken",
                "streamable-http",
                {"url": ""},
            )
            assert srv["load_status"] == "error"
            assert srv["last_error"]
            assert not mgr.executor.has("mcp__broken__x")
        finally:
            await mgr.shutdown()

    _run(body())


def test_delete(tmp_path) -> None:
    async def body():
        mgr = _manager(tmp_path)
        try:
            await mgr.upsert(
                "echo", "stdio", {"command": sys.executable, "args": [ECHO_SERVER]}
            )
            await mgr.delete("echo")
            assert not mgr.executor.has("mcp__echo__echo")
            try:
                await mgr.get("echo")
                assert False, "应 404"
            except KeyError:
                pass
        finally:
            await mgr.shutdown()

    _run(body())


def test_list_and_load_enabled(tmp_path) -> None:
    async def body():
        mgr = _manager(tmp_path)
        try:
            await mgr.upsert(
                "echo", "stdio", {"command": sys.executable, "args": [ECHO_SERVER]}
            )
            await mgr.upsert(
                "off", "stdio", {"command": "x", "args": []}, enabled=False
            )
            failed = await mgr.load_enabled()
            assert failed == []  # off 未启用不连接；echo 已连接
            names = {s["name"] for s in await mgr.list()}
            assert names == {"echo", "off"}
        finally:
            await mgr.shutdown()

    _run(body())
