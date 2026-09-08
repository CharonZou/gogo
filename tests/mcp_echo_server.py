"""MCP echo 测试服务器（stdio 传输）：供 test_mcp.py 真实连接验证。

运行：python tests/mcp_echo_server.py
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("echo-server")


@mcp.tool()
def echo(text: str) -> str:
    """原样回显文本（前缀 echo:）。"""
    return f"echo:{text}"


@mcp.tool()
def add(a: int, b: int) -> int:
    """两个整数相加。"""
    return a + b


if __name__ == "__main__":
    mcp.run(transport="stdio")
