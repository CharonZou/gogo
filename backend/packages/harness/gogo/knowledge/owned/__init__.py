"""gogo owned knowledge base (local-first RAG replacing Obsidian as primary path).

See ``internal design docs (not published in this repository)``.
"""

from gogo.knowledge.owned import service as service
from gogo.knowledge.owned.worker import ensure_owned_kb_worker_started

__all__ = ["service", "ensure_owned_kb_worker_started"]
