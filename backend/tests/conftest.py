"""Test configuration for the backend test suite.

Sets up sys.path and pre-mocks modules that would cause circular import
issues when unit-testing lightweight config/registry code in isolation.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock

# Make 'app' and 'gogo' importable from any working directory
_backend_root = Path(__file__).parent.parent
sys.path.insert(0, str(_backend_root))
# gogo package lives in packages/harness (editable install also exposes it)
sys.path.insert(0, str(_backend_root / "packages" / "harness"))

# Break the circular import chain that exists in production code:
#   gogo.subagents.__init__
#     -> .executor (SubagentExecutor, SubagentResult)
#       -> gogo.agents.thread_state
#         -> gogo.agents.__init__
#           -> lead_agent.agent
#             -> subagent_limit_middleware
#               -> gogo.subagents.executor  <-- circular!
#
# By injecting a mock for gogo.subagents.executor *before* any test module
# triggers the import, __init__.py's "from .executor import ..." succeeds
# immediately without running the real executor module.
_executor_mock = MagicMock()
_executor_mock.SubagentExecutor = MagicMock
_executor_mock.SubagentResult = MagicMock
_executor_mock.SubagentStatus = MagicMock
_executor_mock.MAX_CONCURRENT_SUBAGENTS = 5
_executor_mock.get_background_task_result = MagicMock()

sys.modules["gogo.subagents.executor"] = _executor_mock
