"""跨会话记忆与资产存储（接口桩）。

TODO：aiosqlite 落库 + sqlite-vec 向量检索；资产类型（画像/记忆/经验/反思/专长）。
"""

from __future__ import annotations


class MemoryStore:
    """记忆与资产存储入口。"""

    def __init__(self, path: str) -> None:
        self.path = path

    async def save_fact(self, key: str, value: str) -> None:
        """保存一条结构化事实（用户画像 / 经验 / 反思等）。"""
        raise NotImplementedError("记忆落库待实现")

    async def search(self, query: str, *, top_k: int = 5) -> list[dict]:
        """向量检索相关记忆/资产。"""
        raise NotImplementedError("记忆检索待实现")
