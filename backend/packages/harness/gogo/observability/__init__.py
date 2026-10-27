"""SQLite-backed observability (trace, tools, model requests, IM errors)."""

from gogo.observability.recorder import get_observability_recorder
from gogo.observability.tables import ObservabilityTable

__all__ = ["ObservabilityTable", "get_observability_recorder"]
