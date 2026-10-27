"""FastAPI dependency: require premium (tasks / apps / proactive) license."""

from __future__ import annotations

from gogo.license.gate import require_premium

__all__ = ["require_premium"]
