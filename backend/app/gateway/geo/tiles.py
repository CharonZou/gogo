"""行程卡底图瓦片与地点照片代理（移植自 openworkbuddy src/domains/geo/tiles.js）。

页面只跟本机服务端要图；服务端代取、记盘、限并发，并对图床做白名单校验。
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import time
from pathlib import Path

import httpx

from .places import _data_dir, _http, UA

logger = logging.getLogger(__name__)

CAP_BYTES = 200 * 1024 * 1024
TILE_MAX_BYTES = 1024 * 1024
IMG_MAX_BYTES = 4 * 1024 * 1024

SOURCES = {
    "osm": {
        "url": lambda z, x, y: f"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "datum": "wgs84", "maxZoom": 19, "conc": 2, "attr": "© OpenStreetMap 贡献者",
    },
    "amap": {
        "url": lambda z, x, y: (
            f"https://webrd0{1 + ((x + y) % 4)}.is.autonavi.com/appmaptile"
            f"?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
        ),
        "datum": "gcj02", "maxZoom": 18, "conc": 6, "attr": "© 高德地图",
    },
}

_IMG_HOSTS = [r"(^|\.)amap\.com$", r"(^|\.)autonavi\.com$", r"(^|\.)wikimedia\.org$"]
_TILE_BASE = ""

_slots: dict[str, dict] = {}
_inflight: dict[str, asyncio.Future] = {}
_used = -1
_pruning = False
_lock = asyncio.Lock()


def _base_dir() -> Path:
    return _data_dir()


async def _limited(name: str, max_n: int, fn):
    sl = _slots.setdefault(name, {"n": 0, "q": []})
    if sl["n"] >= max_n:
        fut = asyncio.get_event_loop().create_future()
        sl["q"].append(fut)
        await fut
    sl["n"] += 1
    try:
        return await fn()
    finally:
        sl["n"] -= 1
        if sl["q"]:
            sl["q"].pop(0).set_result(None)


def _once(key: str, fn):
    fut = _inflight.get(key)
    if fut is None:
        fut = asyncio.ensure_future(fn())
        _inflight[key] = fut
        fut.add_done_callback(lambda _f: _inflight.pop(key, None))
    return fut


async def _walk(root: Path, out: list | None = None) -> list:
    if out is None:
        out = []
    try:
        ents = list(root.iterdir())
    except FileNotFoundError:
        return out
    for e in ents:
        if e.is_dir():
            await _walk(e, out)
        else:
            try:
                st = e.stat()
                out.append({"f": e, "size": st.st_size, "t": st.st_mtime})
            except OSError:
                pass
    return out


async def _account(add: int) -> None:
    global _used, _pruning
    if _used < 0:
        _used = sum(x["size"] for x in await _walk(_base_dir()))
    else:
        _used += add
    if _used <= CAP_BYTES or _pruning:
        return
    _pruning = True
    try:
        all_ = [x for x in await _walk(_base_dir()) if x["f"].name != "places.json" and x["f"].name != "settings.json"]
        all_.sort(key=lambda x: x["t"])
        total = sum(x["size"] for x in all_)
        for x in all_:
            if total <= CAP_BYTES * 0.8:
                break
            try:
                x["f"].unlink()
                total -= x["size"]
            except OSError:
                pass
        _used = total
    finally:
        _pruning = False


async def _read_hit(f: Path):
    try:
        buf = f.read_bytes()
        now = time.time()
        os.utime(f, (now, now))
        return buf
    except OSError:
        return None


async def _write_file(f: Path, buf: bytes) -> None:
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_name(f.name + f".{os.getpid()}.{hashlib.md5(buf[:64]).hexdigest()[:8]}.tmp")
        tmp.write_bytes(buf)
        tmp.rename(f)
        await _account(len(buf))
    except Exception as exc:  # noqa: BLE001
        logger.warning("geo: 地图缓存写盘失败 %s", exc)


async def _fetch_bytes(url: str, *, redirect: str = "follow", headers: dict | None = None):
    try:
        r = await _http().get(url, headers=headers or {}, follow_redirects=(redirect == "follow"), timeout=12.0)
    except httpx.HTTPError as exc:
        host = ""
        try:
            from urllib.parse import urlparse
            host = urlparse(url).hostname or ""
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError(f"{host} 连不上：{exc}")
    return r


async def _body_of(r: httpx.Response, max_bytes: int) -> bytes:
    try:
        length = int(r.headers.get("content-length") or 0)
    except ValueError:
        length = 0
    if length > max_bytes:
        raise RuntimeError(f"图太大了（{round(length / 1024)}KB）")
    buf = r.content
    if len(buf) > max_bytes:
        raise RuntimeError(f"图太大了（{round(len(buf) / 1024)}KB）")
    return buf


def _sniff(b: bytes) -> str:
    if len(b) > 8 and b[:4] == b"\x89PNG":
        return "image/png"
    if len(b) > 3 and b[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(b) > 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    if len(b) > 6 and b[:4] == b"GIF8":
        return "image/gif"
    return ""


async def tile(src: str, z, x, y) -> dict:
    S = SOURCES.get(src)
    if not S:
        raise BadRequest("没有这种底图")
    if not all(isinstance(v, int) for v in (z, x, y)) or z < 0 or z > S["maxZoom"] or x < 0 or y < 0 or x >= 2**z or y >= 2**z:
        raise BadRequest("瓦片编号不对")
    f = _base_dir() / "tiles" / src / str(z) / str(x) / f"{y}.png"
    hit = await _read_hit(f)
    if hit:
        return {"buf": hit, "type": _sniff(hit) or "image/png"}

    async def fetch():
        url = f"{_TILE_BASE}/{src}/{z}/{x}/{y}" if _TILE_BASE else S["url"](z, x, y)
        r = await _fetch_bytes(url)
        if r.status_code != 200:
            raise BadRequest(f"底图服务回了 HTTP {r.status_code}", status=502)
        buf = await _body_of(r, TILE_MAX_BYTES)
        t = _sniff(buf)
        if not t:
            raise BadRequest("底图服务回的不是图片", status=502)
        await _write_file(f, buf)
        return {"buf": buf, "type": t}

    return await _once(str(f), lambda: _limited(src, S["conc"], fetch))


def _allowed(u: str) -> bool:
    from urllib.parse import urlparse
    try:
        x = urlparse(u)
    except Exception:  # noqa: BLE001
        return False
    if x.scheme not in ("https", "http"):
        return False
    if x.username or x.password:
        return False
    if x.port and not _TILE_BASE:
        return False
    host = (x.hostname or "").lower()
    return any(re.search(pat, host) for pat in _IMG_HOSTS)


async def image(u: str) -> dict:
    if not _allowed(u):
        raise BadRequest("这个图片地址不在可代理的名单里")
    key = hashlib.sha1(u.encode("utf-8")).hexdigest()
    f = _base_dir() / "img" / key[:2] / key
    hit = await _read_hit(f)
    if hit:
        return {"buf": hit, "type": _sniff(hit) or "application/octet-stream"}

    async def fetch():
        from urllib.parse import urljoin
        url = u
        for _ in range(5):
            r = await _fetch_bytes(url, redirect="manual", headers={"Accept": "image/*"})
            if 300 <= r.status_code < 400:
                loc = r.headers.get("location") or ""
                if not loc:
                    raise BadRequest("图片跳到了名单外的地址", status=502)
                next_url = urljoin(url, loc)
                if not _allowed(next_url):
                    raise BadRequest("图片跳到了名单外的地址", status=502)
                url = next_url
                continue
            if r.status_code != 200:
                raise BadRequest(f"图床回了 HTTP {r.status_code}", status=502)
            buf = await _body_of(r, IMG_MAX_BYTES)
            t = _sniff(buf)
            if not t:
                raise BadRequest("图床回的不是图片", status=502)
            await _write_file(f, buf)
            return {"buf": buf, "type": t}
        raise BadRequest("图片跳转太多次", status=502)

    return await _once(str(f), lambda: _limited("img", 4, fetch))


def sources() -> dict:
    return {k: {"datum": v["datum"], "maxZoom": v["maxZoom"], "attr": v["attr"]} for k, v in SOURCES.items()}


class BadRequest(RuntimeError):
    def __init__(self, msg: str, status: int = 400):
        super().__init__(msg)
        self.status = status
