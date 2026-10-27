"""GitHub OAuth authorization-code flow.

GitHub is not a standard OIDC provider (no discovery / id_token / userinfo
endpoint), so this is a thin, GitHub-specific flow that reuses the existing
in-process state store, principal provisioning and JWT minting.

Config via environment:
  gogo_GITHUB_CLIENT_ID      OAuth App client id (required to enable)
  gogo_GITHUB_CLIENT_SECRET  OAuth App client secret (required)
  gogo_GITHUB_REDIRECT_URI   callback URL registered in the OAuth App
                                  (default http://127.0.0.1:8012/api/webui/github/callback)
"""

from __future__ import annotations

import logging
import os
import urllib.parse
from typing import Any

import httpx

from gogo.webui.oidc import oidc_state_store

logger = logging.getLogger(__name__)

_GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize"
_GITHUB_TOKEN = "https://github.com/login/oauth/access_token"
_GITHUB_USER = "https://api.github.com/user"
_GITHUB_EMAIL = "https://api.github.com/user/emails"


def _client_id() -> str:
    return os.environ.get("gogo_GITHUB_CLIENT_ID", "").strip()


def _client_secret() -> str:
    return os.environ.get("gogo_GITHUB_CLIENT_SECRET", "").strip()


def _redirect_uri() -> str:
    return (
        os.environ.get("gogo_GITHUB_REDIRECT_URI", "").strip()
        or "http://127.0.0.1:8012/api/webui/github/callback"
    )


def is_github_enabled() -> bool:
    return bool(_client_id() and _client_secret())


def build_github_authorize_url(*, redirect: str, return_origin: str) -> str:
    if not is_github_enabled():
        raise ValueError("GitHub OAuth is not configured")
    # Reuse the OIDC state store: state -> {redirect, return_origin, exp}
    state, _verifier, _nonce = oidc_state_store.create(
        redirect=redirect,
        return_origin=return_origin,
    )
    params = {
        "client_id": _client_id(),
        "redirect_uri": _redirect_uri(),
        "scope": "read:user user:email",
        "state": state,
        "allow_signup": "true",
    }
    return f"{_GITHUB_AUTHORIZE}?{urllib.parse.urlencode(params)}"


async def exchange_github_code(
    *,
    code: str,
    state: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Exchange the code; return (state_meta, claims {sub, email, name})."""
    meta = oidc_state_store.consume(state)
    if not meta:
        raise ValueError("invalid or expired GitHub OAuth state")

    async with httpx.AsyncClient(timeout=20.0) as client:
        token_resp = await client.post(
            _GITHUB_TOKEN,
            data={
                "client_id": _client_id(),
                "client_secret": _client_secret(),
                "code": code,
                "redirect_uri": _redirect_uri(),
            },
            headers={"Accept": "application/json"},
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()
        access = str(tokens.get("access_token") or "")
        if not access:
            raise ValueError("GitHub token exchange returned no access_token")

        user_resp = await client.get(
            _GITHUB_USER,
            headers={
                "Authorization": f"Bearer {access}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        user_resp.raise_for_status()
        user = user_resp.json()
        gh_id = str(user.get("id") or "").strip()
        if not gh_id:
            raise ValueError("GitHub user response missing id")

        email = str(user.get("email") or "").strip().lower() or None
        if not email:
            # Fall back to the verified primary email list.
            try:
                em_resp = await client.get(
                    _GITHUB_EMAIL,
                    headers={
                        "Authorization": f"Bearer {access}",
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                )
                if em_resp.status_code == 200:
                    for e in em_resp.json():
                        if e.get("primary") and e.get("verified"):
                            email = str(e.get("email") or "").strip().lower() or None
                            break
            except Exception:
                logger.debug("github /user/emails lookup failed", exc_info=True)

        login = str(user.get("login") or "").strip() or gh_id
        name = str(user.get("name") or "").strip() or login
        avatar_url = str(user.get("avatar_url") or "").strip() or None

    claims = {
        "sub": f"github:{gh_id}",
        "email": email,
        "name": name,
        "login": login,
        "avatar_url": avatar_url,
    }
    return meta, claims
