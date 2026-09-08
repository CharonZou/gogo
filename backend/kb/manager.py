"""知识库管理器：本地优先的文档资产——上传即索引，阅读 / 检索 / 问 AI 一体（P2.1）。

导入：文本 / 本地文件 → 分块（段落优先 + 重叠）→ 嵌入 → kb_docs / kb_chunks 落库。
检索：keyword（全文 LIKE）/ vector（余弦）/ hybrid（融合），供员工问答注入。
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from backend.core import db
from backend.core.config import get_settings
from backend.kb.embedder import Embedder, build_embedder

_TEXT_SUFFIXES = {".md", ".txt", ".text"}


class KBManager:
    def __init__(
        self,
        db_path: str | None = None,
        embedder: Embedder | None = None,
    ) -> None:
        self.db_path = db_path or db.get_db_path()
        self.embedder = embedder or build_embedder()
        self.settings = get_settings()
        self._initialized = False

    async def _ensure_db(self) -> None:
        if self._initialized:
            return
        await db.init_db(self.db_path)
        self._initialized = True

    # ---------- 导入 ----------

    async def import_text(
        self,
        title: str,
        content: str,
        *,
        source: str = "upload",
        rel_path: str = "",
    ) -> dict:
        """导入纯文本：分块 + 嵌入 + 落库，返回文档记录。"""
        if not title or not title.strip():
            raise ValueError("文档标题不能为空")
        if not content or not content.strip():
            raise ValueError("文档内容不能为空")
        await self._ensure_db()

        chunks_text = self._chunk_text(content)
        if not chunks_text:
            raise ValueError("文档内容为空，无法分块")
        embeddings = await self.embedder.embed(chunks_text)

        doc_id = uuid.uuid4().hex[:12]
        await db.insert_kb_doc(
            self.db_path,
            doc_id,
            title.strip(),
            source=source,
            rel_path=rel_path,
            meta={"embedder": self.embedder.name, "chunk_size": self.settings.kb_chunk_size},
        )
        await db.insert_kb_chunks(
            self.db_path,
            [
                {
                    "id": uuid.uuid4().hex[:12],
                    "doc_id": doc_id,
                    "position": i,
                    "content": t,
                    "embedding": embeddings[i],
                    "token_count": len(t),
                }
                for i, t in enumerate(chunks_text)
            ],
        )
        return await db.get_kb_doc(self.db_path, doc_id)

    async def import_file(self, path: str | Path, title: str | None = None) -> dict:
        """导入本地文本/Markdown 文件（PDF/Word 解析后续支持）。"""
        p = Path(path)
        if not p.is_file():
            raise FileNotFoundError(f"文件不存在：{p}")
        if p.suffix.lower() not in _TEXT_SUFFIXES:
            raise ValueError(f"暂支持 {'/'.join(sorted(_TEXT_SUFFIXES))}，暂不支持 {p.suffix}")
        content = p.read_text(encoding="utf-8", errors="replace")
        return await self.import_text(
            title or p.stem, content, source="upload", rel_path=p.name
        )

    # ---------- 文档 CRUD ----------

    async def list(self) -> list[dict]:
        await self._ensure_db()
        return await db.list_kb_docs(self.db_path)

    async def get(self, doc_id: str) -> dict:
        await self._ensure_db()
        doc = await db.get_kb_doc(self.db_path, doc_id)
        if doc is None:
            raise KeyError(f"知识文档不存在：{doc_id}")
        return doc

    async def delete(self, doc_id: str) -> dict:
        await self._ensure_db()
        if await db.get_kb_doc(self.db_path, doc_id) is None:
            raise KeyError(f"知识文档不存在：{doc_id}")
        await db.delete_kb_doc(self.db_path, doc_id)
        return {"deleted": doc_id}

    async def chunks(self, doc_id: str) -> list[dict]:
        """文档分块明细（阅读/概览用）。"""
        await self.get(doc_id)
        return await db.list_kb_chunks_by_doc(self.db_path, doc_id)

    # ---------- 检索 ----------

    async def search(
        self,
        query: str,
        *,
        k: int = 5,
        mode: str = "hybrid",
    ) -> list[dict]:
        """检索 top-k 分块：keyword（全文）/ vector（余弦）/ hybrid（融合）。"""
        query = (query or "").strip()
        if not query:
            return []
        if mode not in ("keyword", "vector", "hybrid"):
            raise ValueError(f"非法检索模式：{mode}")
        await self._ensure_db()

        results: dict[str, dict] = {}
        if mode in ("vector", "hybrid"):
            qv = (await self.embedder.embed([query]))[0]
            terms = db._tokenize(query)
            for ch in await db.list_all_kb_chunks(self.db_path):
                ev = ch["embedding"]
                if not ev:
                    continue
                score = _cosine(qv, ev)
                if mode == "hybrid" and terms:
                    hits = sum(1 for t in terms if t in ch["content"])
                    score = 0.7 * score + 0.3 * min(1.0, hits / len(terms))
                results[ch["chunk_id"]] = {**ch, "score": score}
        if mode in ("keyword", "hybrid"):
            for r in await db.search_kb_keyword(self.db_path, query, limit=max(k * 3, 10)):
                rid = r["chunk_id"]
                if rid in results:
                    results[rid]["score"] = max(results[rid]["score"], r["score"])
                else:
                    results[rid] = r

        ranked = sorted(results.values(), key=lambda x: -x["score"])[:k]
        for r in ranked:
            r.pop("embedding", None)
        return ranked

    # ---------- 分块 ----------

    def _chunk_text(self, content: str) -> list[str]:
        size = self.settings.kb_chunk_size
        overlap = self.settings.kb_chunk_overlap
        paras = [p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()]
        chunks: list[str] = []
        buf = ""
        for p in paras:
            if len(buf) + len(p) + 1 <= size:
                buf = f"{buf}\n{p}" if buf else p
                continue
            if buf:
                chunks.append(buf)
                buf = ""
            if len(p) <= size:
                buf = p
            else:
                step = max(size - overlap, 1)
                for i in range(0, len(p), step):
                    chunks.append(p[i : i + size])
        if buf:
            chunks.append(buf)
        return chunks


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)
