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
    sqlite_path: str = "data/rocheflow.db"


@lru_cache
def get_settings() -> Settings:
    return Settings()
