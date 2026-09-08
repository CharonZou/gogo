"""应用配置：环境变量驱动（.env / 系统环境）。"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "RocheFlow Agent Engine"
    host: str = "127.0.0.1"
    port: int = 8031
    cors_origins: str = "*"

    # 存储
    sqlite_path: str = "data/rocheflow.db"
    sandbox_root: str = "data/sandbox"

    # LLM 网关（OpenAI 兼容，默认 DeepSeek）
    llm_base_url: str = "https://api.deepseek.com"
    llm_api_key: str = ""
    llm_model: str = "deepseek-chat"

    # 知识库
    kb_embedder: str = "hash"  # hash=离线确定性嵌入 | llm=OpenAI 兼容 /embeddings
    llm_embed_model: str = ""
    kb_chunk_size: int = 800  # 分块目标字符数
    kb_chunk_overlap: int = 80  # 相邻块重叠字符数
    kb_search_top_k: int = 5  # 员工问答默认注入条数

    # 执行引擎
    max_concurrency: int = 2
    max_retries: int = 1


@lru_cache
def get_settings() -> Settings:
    return Settings()
