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

    # 自动化调度（对应 ROCHEFLOW_AUTOMATION_*）
    automation_scheduler_enabled: bool = True  # 总开关，0/false 关闭
    automation_tick_seconds: int = 30  # 扫描间隔
    automation_max_concurrent: int = 2  # 同时执行上限

    # 值班调度（P3.1，对应 ROCHEFLOW_DUTY_*）
    duty_scheduler_enabled: bool = True  # 员工自动上班总开关
    duty_tick_seconds: int = 30  # 扫描间隔

    # MCP（对应 ROCHEFLOW_MCP_*）
    mcp_enabled: bool = True  # 总开关
    mcp_connect_timeout: float = 15.0  # 连接/初始化超时（秒）
    mcp_request_timeout: float = 60.0  # 单次工具调用超时（秒）
    skills_public_dir: str = "skills/public"  # 内置技能目录（不存在则跳过）
    skills_custom_dir: str = "skills/custom"  # 自定义技能目录

    # 执行引擎
    max_concurrency: int = 2
    max_retries: int = 1


@lru_cache
def get_settings() -> Settings:
    return Settings()
