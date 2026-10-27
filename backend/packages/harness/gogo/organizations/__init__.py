"""Organization Pack (资源包) — install / list / uninstall.

See `internal design docs (not published in this repository)` and resource-marketplace.md.
"""

from __future__ import annotations

from gogo.organizations.export import export_organization
from gogo.organizations.installer import (
    install_organization,
    preflight_organization,
    uninstall_organization,
)
from gogo.organizations.manifest import load_pack_from_source, load_pack_manifest
from gogo.organizations.registry import (
    get_org_instance,
    list_org_instances,
)

__all__ = [
    "export_organization",
    "get_org_instance",
    "install_organization",
    "list_org_instances",
    "load_pack_from_source",
    "load_pack_manifest",
    "preflight_organization",
    "uninstall_organization",
]
