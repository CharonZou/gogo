"""OpenAI 兼容 LLM 客户端（httpx 直连，不引入 SDK 依赖）。

默认 DeepSeek（deepseek-chat），可换任意 OpenAI 兼容端点。
"""

from __future__ import annotations

import json

import httpx

from backend.core.config import get_settings


class LLMNotConfiguredError(RuntimeError):
    """未配置 LLM API Key 时抛出。"""


class LLMClient:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.llm_base_url).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.llm_api_key
        self.model = model or settings.llm_model

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def chat_json(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.2,
        max_tokens: int = 4096,
    ) -> dict:
        """请求 JSON 输出并解析为 dict。"""
        if not self.configured:
            raise LLMNotConfiguredError(
                "未配置 LLM_API_KEY，请在 .env 中设置（默认 DeepSeek）"
            )
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        content = data["choices"][0]["message"]["content"]
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"模型未返回合法 JSON：{content[:200]}") from exc
