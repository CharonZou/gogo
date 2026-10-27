"""Local product license: short EF3 activation codes with expiry."""

from __future__ import annotations

from gogo.license.entitlements import (
    LicenseStatus,
    get_license_status,
    is_premium_active,
    premium_denial_code,
)
from gogo.license.gate import require_premium
from gogo.license.machine import get_machine_id

__all__ = [
    "LicenseStatus",
    "get_license_status",
    "get_machine_id",
    "is_premium_active",
    "premium_denial_code",
    "require_premium",
]
