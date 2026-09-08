"""跨会话记忆与资产存储。

真实实现：SQLite（aiosqlite）存取；检索暂用 LIKE 关键词匹配，
向量检索（sqlite-vec）在 Phase 3 接入。
"""

from __future__ import annotations

from backend.core import db


class MemoryStore:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or db.get_db_path()
        self._ready = False

    async def _ensure(self) -> None:
        if not self._ready:
            await db.init_db(self.path)
            self._ready = True

    async def save_fact(self, key: str, value: str) -> None:
        await self._ensure()
        await db.save_fact(self.path, key, value)

    async def get_fact(self, key: str) -> str | None:
        await self._ensure()
        return await db.get_fact(self.path, key)

    async def search(self, query: str, *, top_k: int = 5) -> list[dict]:
        await self._ensure()
        return await db.search_facts(self.path, query, top_k=top_k)
