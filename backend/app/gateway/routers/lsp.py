"""LSP (Language Server Protocol) WebSocket router."""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import sys
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/lsp", tags=["lsp"])


# 语言服务器配置
LANGUAGE_SERVERS: dict[str, dict[str, Any]] = {
    "python": {
        "command": ["pyright-langserver", "--stdio"],
        "fileExtensions": [".py", ".pyw"],
    },
    "javascript": {
        "command": ["typescript-language-server", "--stdio"],
        "fileExtensions": [".js", ".jsx", ".ts", ".tsx", ".mjs"],
    },
    "json": {
        "command": ["vscode-json-language-server", "--stdio"],
        "fileExtensions": [".json"],
    },
}


class LSPConnection:
    """管理一个 LSP 语言服务器进程和对应的 WebSocket 连接。"""

    def __init__(self, websocket: WebSocket, language: str):
        self.websocket = websocket
        self.language = language
        self.process: subprocess.Popen | None = None
        self.reader_task: asyncio.Task | None = None

    async def start(self) -> None:
        """启动语言服务器进程。"""
        config = LANGUAGE_SERVERS.get(self.language)
        if not config:
            await self.websocket.close(code=1008, reason=f"Unsupported language: {self.language}")
            return

        try:
            self.process = subprocess.Popen(
                config["command"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
            logger.info("Started LSP server for %s: %s", self.language, config["command"])

            # 启动读取语言服务器输出的任务
            self.reader_task = asyncio.create_task(self._read_from_server())
        except FileNotFoundError as e:
            logger.error("LSP server not found for %s: %s", self.language, e)
            await self.websocket.close(code=1008, reason=f"LSP server not found: {e}")
            raise

    async def _read_from_server(self) -> None:
        """从语言服务器读取消息，转发给前端 WebSocket。"""
        if not self.process or not self.process.stdout:
            return

        try:
            while True:
                # 读取 LSP header (Content-Length: xxx\r\n\r\n)
                header_line = await asyncio.get_event_loop().run_in_executor(
                    None, self.process.stdout.readline
                )
                if not header_line:
                    break

                header_line = header_line.decode("utf-8").strip()
                if not header_line.startswith("Content-Length:"):
                    continue

                content_length = int(header_line.split(":")[1].strip())

                # 读取空行
                await asyncio.get_event_loop().run_in_executor(
                    None, self.process.stdout.readline
                )

                # 读取消息体
                body = await asyncio.get_event_loop().run_in_executor(
                    None, self.process.stdout.read, content_length
                )
                if not body:
                    break

                # 转发给前端
                await self.websocket.send_text(body.decode("utf-8"))
        except Exception as e:
            logger.error("Error reading from LSP server: %s", e)
        finally:
            await self.close()

    async def send_to_server(self, message: str) -> None:
        """从前端接收消息，转发给语言服务器。"""
        if not self.process or not self.process.stdin:
            return

        try:
            # 写入 LSP 消息格式
            data = message.encode("utf-8")
            header = f"Content-Length: {len(data)}\r\n\r\n".encode("utf-8")
            self.process.stdin.write(header + data)
            self.process.stdin.flush()
        except Exception as e:
            logger.error("Error sending to LSP server: %s", e)
            await self.close()

    async def close(self) -> None:
        """关闭连接和语言服务器进程。"""
        if self.reader_task:
            self.reader_task.cancel()
            try:
                await self.reader_task
            except asyncio.CancelledError:
                pass
            self.reader_task = None

        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
            except Exception:
                pass
            self.process = None

        try:
            await self.websocket.close()
        except Exception:
            pass


@router.websocket("/ws/{language}")
async def lsp_websocket(websocket: WebSocket, language: str):
    """LSP WebSocket 端点。"""
    await websocket.accept()

    connection = LSPConnection(websocket, language)
    try:
        await connection.start()
    except Exception as e:
        logger.error("Failed to start LSP connection: %s", e)
        return

    try:
        while True:
            message = await websocket.receive_text()
            await connection.send_to_server(message)
    except WebSocketDisconnect:
        logger.info("LSP WebSocket disconnected for %s", language)
    except Exception as e:
        logger.error("LSP WebSocket error: %s", e)
    finally:
        await connection.close()
