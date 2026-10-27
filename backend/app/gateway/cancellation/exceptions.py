"""Cancellation-related exceptions.

Re-exports from gogo.cancellation.exceptions for backward compatibility.
"""

from gogo.cancellation.exceptions import (
    CancellationError,
    CancellationTimeoutError,
    TaskAlreadyTerminatedError,
    TaskCancelledError,
)

__all__ = [
    "CancellationError",
    "TaskCancelledError",
    "TaskAlreadyTerminatedError",
    "CancellationTimeoutError",
]
