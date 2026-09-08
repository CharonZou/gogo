"""知识库嵌入器：可插拔（离线哈希默认，LLM 兼容端点可选）。

- HashingEmbedder：确定性字符 n-gram 哈希向量（无外部依赖、离线、可测试）。
- LLMEmbedder：OpenAI 兼容 /embeddings（如豆包 / 硅基流动），未配置时回退哈希。
检索与入库必须使用同一嵌入器（向量空间一致）。
"""

from __future__ import annotations

import hashlib
import re
from typing import Protocol

import httpx

from backend.core.config import get_settings


class Embedder(Protocol):
    name: str
    dim: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashingEmbedder:
    """确定性哈希嵌入：字符 3-gram → 桶累加 → L2 归一化。

    同词/同句文本共享 n-gram，余弦相似度可复现；仅作本地语义近似，
    效果弱于语义模型，但零依赖、零成本、测试确定。
    """

    name = "hash"

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim
        self._buckets = dim  # 用 (idx % buckets) 映射到 dim 维，保留分布

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(t) for t in texts]

    def _embed_one(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        grams = self._grams(text)
        for gram in grams:
            h = hashlib.blake2b(gram.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(h, "big")
            vec[idx % self.dim] += 1.0
        norm = sum(v * v for v in vec) ** 0.5
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec

    @staticmethod
    def _grams(text: str) -> list[str]:
        t = text.lower()
        grams: list[str] = []
        # 英文/数字词
        grams.extend(re.findall(r"[a-z0-9_]+", t))
        # 连续字符 bigram（短查询如「退款」也能得到非零向量）
        chars = re.sub(r"\s+", "", t)
        if len(chars) >= 2:
            grams.extend(chars[i : i + 2] for i in range(len(chars) - 1))
        # 连续字符 trigram（覆盖中文长文本）
        if len(chars) >= 3:
            grams.extend(chars[i : i + 3] for i in range(len(chars) - 2))
        return grams


class LLMEmbedder:
    """OpenAI 兼容 /embeddings（llm_base_url 同源端点）。"""

    name = "llm"

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.llm_base_url).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.llm_api_key
        self.model = model or settings.llm_embed_model or "text-embedding-3-small"
        self.dim = 0  # 服务端决定

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not self.configured:
            raise RuntimeError("LLM 嵌入器未配置 LLM_API_KEY")
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{self.base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "input": texts},
            )
            resp.raise_for_status()
            data = resp.json()
        items = sorted(data["data"], key=lambda x: x["index"])
        return [item["embedding"] for item in items]


def build_embedder(settings=None) -> Embedder:
    """按配置构建嵌入器：llm（已配 key）→ LLM；否则离线哈希。"""
    settings = settings or get_settings()
    if settings.kb_embedder == "llm":
        return LLMEmbedder()
    return HashingEmbedder()
