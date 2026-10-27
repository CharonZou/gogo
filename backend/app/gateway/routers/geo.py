"""行程卡（聊天里的地图卡片）接口，移植自 openworkbuddy src/server/routes/geo.js。

  GET  /api/geo/config                     用哪家查地点、有没有 Key、底图坐标系与署名、这个月高德用量
  POST /api/geo/places   { items }         一批地点名 → 坐标、照片、评分
  POST /api/geo/photos   { items }         钉子钉上之后再补的照片（Wikidata）
  POST /api/geo/legs     { pairs }         相邻两站之间的路线 / 直线距离
  GET  /api/geo/tile/:src/:z/:x/:y         底图瓦片，本机记盘
  GET  /api/geo/img?u=                     地点照片，只代理名单里的图床
  GET  /api/geo/qr?u=                      「发到手机」的二维码（SVG），只编行程卡自己生成的导航链接
  POST /api/geo/test     { key? }          设置页「测一下」
  GET/PUT /api/geo/settings                地图设置（provider / amap_key / caps；写仅本地）

查地点、取瓦片谁都能用；配 Key、测 Key 归平台管理员/本机。
"""
from __future__ import annotations

import logging
import urllib.parse

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

from ..geo import places, tiles

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/geo", tags=["geo"])

# 「发到手机」只编行程卡自己生成的导航链接
QR_MAX = 2000
NAV_LINKS = {"uri.amap.com": "/navigation", "www.amap.com": "/dir", "www.google.com": "/maps/dir/"}


def _nav_link(u: str) -> str:
    def bad(m: str):
        return HTTPException(status_code=400, detail=m)

    if not isinstance(u, str) or not u:
        raise bad("没给链接")
    if len(u) > QR_MAX:
        raise bad("链接太长，编不进二维码")
    try:
        x = urllib.parse.urlparse(u)
    except Exception:  # noqa: BLE001
        raise bad("这不是一个链接")
    if x.scheme != "https" or x.username or x.password or (x.port and x.port not in (80, 443)):
        raise bad("只给行程卡里的导航链接生成二维码")
    if NAV_LINKS.get(x.hostname) != x.path:
        raise bad("只给行程卡里的导航链接生成二维码")
    return u


@router.get("/config")
async def geo_config():
    st = places.settings_of({"map": places.get_map_settings()})
    return {
        "provider": st["provider"],
        "amap": bool(st["key"]),
        "keyFrom": st["from"],
        "sources": tiles.sources(),
        "usage": places.usage({"map": places.get_map_settings()}),
    }


@router.post("/places")
async def geo_places(body: dict | None = None):
    body = body or {}
    return await places.lookup({"map": places.get_map_settings()}, body.get("items"))


@router.post("/photos")
async def geo_photos(body: dict | None = None):
    body = body or {}
    return await places.photos(body.get("items"))


@router.post("/legs")
async def geo_legs(body: dict | None = None):
    body = body or {}
    return await places.legs({"map": places.get_map_settings()}, body.get("pairs"))


@router.post("/test")
async def geo_test(body: dict | None = None):
    body = body or {}
    return await places.test({"map": places.get_map_settings()}, body.get("key"))


@router.get("/tile/{src}/{z}/{x}/{y}")
async def geo_tile(src: str, z: int, x: int, y: str):
    yy = y[:-4] if y.endswith(".png") else y
    try:
        r = await tiles.tile(src, z, x, int(yy))
    except tiles.BadRequest as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))
    return Response(content=r["buf"], media_type=r["type"], headers={"Cache-Control": "private, max-age=604800"})


@router.get("/img")
async def geo_img(u: str = Query(...)):
    try:
        r = await tiles.image(u)
    except tiles.BadRequest as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))
    return Response(content=r["buf"], media_type=r["type"], headers={"Cache-Control": "private, max-age=604800"})


@router.get("/qr")
async def geo_qr(u: str = Query(...)):
    link = _nav_link(u)
    try:
        import qrcode
    except ImportError:
        raise HTTPException(status_code=503, detail="缺少 qrcode 库：uv add qrcode")
    try:
        from qrcode.image.svg import SvgPathImage
        img = qrcode.make(link, image_factory=SvgPathImage, error_correction=qrcode.constants.ERROR_CORRECT_M)
        import io
        buf = io.BytesIO()
        img.save(buf)
        svg = buf.getvalue().decode("utf-8")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))
    return Response(
        content=svg,
        media_type="image/svg+xml; charset=utf-8",
        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/settings")
async def geo_get_settings(request: Request):
    if not _local(request):
        raise HTTPException(status_code=403, detail="仅本机可读写地图设置")
    st = places.get_map_settings()
    st = {k: v for k, v in st.items() if k in ("provider", "amap_key", "amap_search_cap", "amap_route_cap", "amap_daily_cap")}
    masked = dict(st)
    if masked.get("amap_key"):
        masked["amap_key"] = "••••••" + masked["amap_key"][-4:]
    return {"ok": True, "settings": masked, "hasKey": bool(st.get("amap_key"))}


@router.put("/settings")
async def geo_put_settings(request: Request, body: dict):
    if not _local(request):
        raise HTTPException(status_code=403, detail="仅本机可读写地图设置")
    allowed = ("provider", "amap_key", "amap_search_cap", "amap_route_cap", "amap_daily_cap")
    upd = {}
    for k in allowed:
        if k in body:
            v = body[k]
            if k in ("provider",):
                v = v if v in ("auto", "amap", "osm") else None
            if k in ("amap_search_cap", "amap_route_cap", "amap_daily_cap"):
                try:
                    n = float(v)
                    v = int(n) if (n >= 0 and n == int(n)) else None
                except (TypeError, ValueError):
                    v = None
            if k == "amap_key":
                v = str(v).strip() if isinstance(v, str) else None
            if v is not None:
                upd[k] = v
    st = places.save_map_settings(upd)
    places._reset_stop()  # noqa: SLF001 - 设置存过，今天的停用作废
    return {"ok": True, "settings": {k: v for k, v in st.items() if k in allowed}}


def _local(request: Request) -> bool:
    host = (request.client.host or "") if request.client else ""
    return host in ("127.0.0.1", "::1", "localhost")
