"""Unified SQLite observability (trace, tools, model payloads, lifecycle)."""

from pydantic import BaseModel, ConfigDict, Field

from gogo.config.data_paths import DEFAULT_OBS_DB_REL


class ObservabilityConfig(BaseModel):
    """Optional SQLite observability under ``data/observability/``.

    **Default ``enabled: false``** — user installs must not write the obs DB.
    Enable only for local / internal debugging (``config.yaml`` or
    ``gogo_OBSERVABILITY=1``).

    Table names are prefixed ``gogo_obs_`` (see ``gogo.observability.sqlite_store``).
    """

    model_config = ConfigDict(extra="ignore")

    enabled: bool = Field(
        default=False,
        description=(
            "When false (default), never open or write gogo_observability.db. "
            "Override with gogo_OBSERVABILITY=1/0."
        ),
    )
    file_mirror: bool = Field(
        default=False,
        description=(
            "When true, also append JSONL under ``logs/debug``. Default false: SQLite only "
            "(no dual-write). Override via gogo_DEBUG_FILE_MIRROR."
        ),
    )
    sqlite_path: str = Field(
        default=DEFAULT_OBS_DB_REL,
        description=(
            "SQLite database path under base_dir; empty uses "
            "``data/observability/gogo_observability.db``."
        ),
    )
