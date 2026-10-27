"""行程卡地点/路线查询（移植自 openworkbuddy src/domains/geo/places.js）。

契约与前端 tripcard.js 完全一致：
  lookup()  -> { provider, items, notes, amapOff? }   每项 { ok:true,... } | { ok:false, failed:true, error } | { ok:false, tried:[...] }
  photos()  -> { items: [{ photo, src }] }
  legs()    -> { items, notes, amapOff? }             每项 { mode, src, datum, distance, duration, line } 或带 failed
  test()    -> { ok, provider, msg }
  usage()   -> { month, used:{search,route}, caps, stop }
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path

import httpx

from . import coords

logger = logging.getLogger(__name__)

UA = "GoGo (+https://github.com/CatCatUncle/openworkbuddy)"
BASES = {
    "amap": "https://restapi.amap.com",
    "nominatim": "https://nominatim.openstreetmap.org",
    "wikidata": "https://www.wikidata.org",
}
GAPS = {"amap": 350, "nominatim": 1100, "wikidata": 250}
SEARCH_CAP = 4500
ROUTE_CAP = 140000
OLD_DAILY_DEFAULT = 2000
TTL_HIT = 30 * 86400
TTL_MISS = 3 * 86400
TTL_ERR = 10 * 60
MAX_CACHE = 4000
MAX_ITEMS = 20
MAX_LEGS = 20
MAX_ROUTE_M = 150_000
WALK_M = 2000
WIKI_NEAR_M = 3000

KEY_DEAD = {"10001", "10003", "10009", "10044"}
CAP_HIT = {
    "search": "这个月的高德搜索次数到上限了，先改用 OpenStreetMap",
    "route": "这个月的高德路线次数到上限了，两站之间先画直线",
}
OSM_KIND = {
    "park": "公园", "garden": "花园", "museum": "博物馆", "gallery": "美术馆",
    "attraction": "景点", "viewpoint": "观景点", "zoo": "动物园", "aquarium": "水族馆",
    "theme_park": "乐园", "place_of_worship": "寺庙", "temple": "寺庙", "church": "教堂",
    "castle": "城堡", "monument": "纪念碑", "memorial": "纪念地", "ruins": "遗址",
    "restaurant": "餐厅", "cafe": "咖啡馆", "bar": "酒吧", "pub": "酒馆",
    "fast_food": "小吃", "food_court": "美食街", "marketplace": "市场", "mall": "商场",
    "hotel": "酒店", "hostel": "青旅", "beach": "海滩", "peak": "山峰",
    "water": "湖泊", "lake": "湖泊", "island": "岛屿", "pedestrian": "步行街",
    "university": "大学", "library": "图书馆", "theatre": "剧院", "stadium": "体育场",
    "station": "车站",
}


def _data_dir() -> Path:
    home = os.environ.get("gogo_HOME", "").strip()
    base = Path(home) if home else Path.home() / ".gogo"
    d = base / "data" / "runtime" / "geo"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _settings_file() -> Path:
    return _data_dir() / "settings.json"


def _cache_file() -> Path:
    return _data_dir() / "places.json"


# ---------------- 设置（地图节） ----------------

def get_map_settings() -> dict:
    try:
        raw = json.loads(_settings_file().read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def save_map_settings(upd: dict) -> dict:
    st = get_map_settings()
    st.update({k: v for k, v in upd.items() if v is not None})
    try:
        _settings_file().write_text(
            json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("geo: 设置写盘失败 %s", exc)
    return st


def _cap_of(v) -> float:
    if isinstance(v, bool):
        return float("nan")
    if isinstance(v, (int, float)):
        n = float(v)
    elif isinstance(v, str) and v.strip() != "":
        try:
            n = float(v)
        except ValueError:
            return float("nan")
    else:
        return float("nan")
    return n if (n >= 0 and n == int(n)) else float("nan")


def _s(v) -> str:
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, (int, float)):
        return str(v)
    return ""


def settings_of(config: dict | None) -> dict:
    m = (config or {}).get("map") or {}
    if not isinstance(m, dict):
        m = {}
    provider = m.get("provider") if m.get("provider") in ("auto", "amap", "osm") else "auto"
    daily = _cap_of(m.get("amap_daily_cap"))
    old = daily if daily != OLD_DAILY_DEFAULT else float("nan")

    def pick(v, default):
        n = _cap_of(v)
        if n == n:  # not NaN
            return int(n)
        return int(min(default, old * 31)) if old == old else default

    caps = {"search": pick(m.get("amap_search_cap"), SEARCH_CAP), "route": pick(m.get("amap_route_cap"), ROUTE_CAP)}
    key, key_from = "", ""
    if provider != "osm":
        if _s(m.get("amap_key")):
            key, key_from = _s(m["amap_key"]), "settings"
        else:
            for srv in (config or {}).get("mcp_servers") or []:
                k = _s((srv or {}).get("env", {}).get("AMAP_MAPS_API_KEY"))
                if k:
                    key, key_from = k, "connector"
                    break
    return {"provider": provider, "key": key, "from": key_from, "caps": caps}


# ---------------- 缓存 / 额度 / 停用 ----------------

class _Cache:
    loaded = False
    map: dict[str, dict] = {}
    month = ""
    used = {"search": 0, "route": 0}
    stop = None  # {"day": str, "msg": str}
    save_lock = asyncio.Lock()
    dirty = False


def _today() -> str:
    return time.strftime("%Y-%m-%d")


def _this_month() -> str:
    return time.strftime("%Y-%m")


def load_cache() -> None:
    if _Cache.loaded:
        return
    _Cache.loaded = True
    try:
        raw = json.loads(_cache_file().read_text(encoding="utf-8"))
    except Exception:
        return
    if not isinstance(raw, dict):
        return
    items = raw.get("items") or {}
    if isinstance(items, dict):
        for k, v in items.items():
            if isinstance(v, dict) and isinstance(v.get("t"), (int, float)):
                _Cache.map[k] = v
    if raw.get("month") == _this_month() and isinstance(raw.get("used"), dict):
        _Cache.month = raw["month"]
        _Cache.used = {
            "search": int(raw["used"].get("search") or 0),
            "route": int(raw["used"].get("route") or 0),
        }
    stop = raw.get("stop")
    if isinstance(stop, dict) and stop.get("day") == _today() and isinstance(stop.get("msg"), str):
        _Cache.stop = {"day": stop["day"], "msg": stop["msg"]}


async def flush_cache() -> None:
    load_cache()
    if not _Cache.dirty:
        return
    _Cache.dirty = False
    while len(_Cache.map) > MAX_CACHE:
        _Cache.map.pop(next(iter(_Cache.map)))
    try:
        payload = {
            "month": _Cache.month,
            "used": _Cache.used,
            "stop": _Cache.stop,
            "items": {k: v for k, v in _Cache.map.items()},
        }
        _cache_file().write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        logger.warning("geo: 地点缓存写盘失败 %s", exc)


async def _saver() -> None:
    async with _Cache.save_lock:
        await flush_cache()


def _cached(k: str):
    load_cache()
    v = _Cache.map.get(k)
    if not v:
        return None
    age = time.time() - v["t"]
    ttl = TTL_ERR if v.get("e") else (TTL_HIT if v.get("r") else TTL_MISS)
    if age > ttl:
        _Cache.map.pop(k, None)
        return None
    _Cache.map.pop(k, None)
    _Cache.map[k] = v  # LRU touch
    return v.get("r")


def _remember(k: str, r, err: bool = False) -> None:
    _Cache.map.pop(k, None)
    _Cache.map[k] = {"t": time.time(), "r": r, "e": err} if err else {"t": time.time(), "r": r}
    _Cache.dirty = True
    asyncio.get_event_loop().create_task(_saver())


def _was_err(k: str) -> bool:
    v = _Cache.map.get(k)
    return bool(v and v.get("e"))


def _spend_amap(kind: str, cap: float) -> bool:
    load_cache()
    m = _this_month()
    if _Cache.month != m:
        _Cache.month = m
        _Cache.used = {"search": 0, "route": 0}
    if _Cache.used[kind] >= int(cap):
        return False
    _Cache.used[kind] += 1
    _Cache.dirty = True
    asyncio.get_event_loop().create_task(_saver())
    return True


def _stop_msg() -> str:
    load_cache()
    if _Cache.stop and _Cache.stop["day"] != _today():
        _Cache.stop = None
        _Cache.dirty = True
        asyncio.get_event_loop().create_task(_saver())
    return _Cache.stop["msg"] if _Cache.stop else ""


def _reset_stop() -> None:
    load_cache()
    if not _Cache.stop:
        return
    _Cache.stop = None
    _Cache.dirty = True
    asyncio.get_event_loop().create_task(_saver())


def usage(config) -> dict:
    load_cache()
    st = settings_of(config)
    m = _this_month()
    used = dict(_Cache.used) if _Cache.month == m else {"search": 0, "route": 0}
    return {"month": m, "used": used, "caps": st["caps"], "stop": _stop_msg()}


# ---------------- 网络 / 限速 ----------------

_gate_next: dict[str, float] = {}
_gate_chain: dict[str, asyncio.Future] = {}


async def _gated(name: str, fn):
    loop = asyncio.get_event_loop()
    chain = _gate_chain.get(name)
    if chain and chain.done():
        chain = None
    prev = chain

    async def turn():
        wait = _gate_next.get(name, 0) - time.time()
        if wait > 0:
            await asyncio.sleep(wait)
        _gate_next[name] = time.time() + (GAPS.get(name) or 0) / 1000

    if prev is None:
        fut = loop.create_future()
        _gate_chain[name] = fut
    try:
        if prev is not None:
            await prev
        await turn()
    except BaseException:
        # 取消/异常也要把等我们的人放行，否则链条永久卡死
        if prev is None and fut is not None and not fut.done():
            fut.set_result(None)
        raise
    if prev is None:
        fut.set_result(None)
    return await fn()


_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(12.0),
            headers={"User-Agent": UA, "Accept": "application/json"},
            follow_redirects=True,
        )
    return _client


async def _get_json(url: str, *, name: str, timeout_ms: int = 8000) -> dict:
    try:
        r = await _http().get(url, timeout=timeout_ms / 1000)
    except httpx.TimeoutException:
        raise RuntimeError(f"{name} 连不上：{round(timeout_ms / 1000)} 秒没回")
    except httpx.HTTPError as exc:
        raise RuntimeError(f"{name} 连不上：{exc}")
    if r.status_code != 200:
        text = r.text.replace("\n", " ").strip()[:120]
        raise RuntimeError(f"{name} 回了 HTTP {r.status_code}{('：' + text) if text else ''}")
    try:
        return r.json()
    except Exception:
        raise RuntimeError(f"{name} 回的不是 JSON：{r.text.replace(chr(10), ' ').strip()[:120]}")


# ---------------- 高德 ----------------

class AmapSt:
    def __init__(self, key: str, caps: dict, probe: bool = False):
        self.key = key
        self.caps = caps
        self.probe = probe


_vet = {"key": "", "day": "", "wait": None}


def _vetted(st: AmapSt) -> bool:
    return _vet["key"] == st.key and _vet["day"] == _today()


async def _amap_get(url: str, st: AmapSt, kind: str) -> dict:
    release = None
    if not st.probe and not _vetted(st):
        if _vet["wait"] is not None:
            await _vet["wait"]
        else:
            fut = asyncio.get_event_loop().create_future()
            _vet["wait"] = fut
            release = lambda: (_vet.__setitem__("wait", None), fut.set_result(None))
    try:
        async def call():
            if not st.probe:
                stop = _stop_msg()
                if stop:
                    raise OffError(stop, off="stop")
                if not _spend_amap(kind, st.caps[kind]):
                    raise OffError(CAP_HIT[kind], off="cap")
            full = url + ("&" if "?" in url else "?") + f"key={st.key}"
            return await _get_json(full, name="高德")

        j = await _gated("amap", call)
        code = _s(j.get("infocode")) if str(j.get("status")) != "1" else ""
        if not st.probe and code not in KEY_DEAD:
            _vet["key"], _vet["day"] = st.key, _today()
        if str(j.get("status")) != "1":
            msg = f"高德：{_s(j.get('info')) or '没给原因'}{('（' + code + '）') if code else ''}"
            if code in KEY_DEAD and not st.probe:
                if not _stop_msg():
                    _Cache.stop = {"day": _today(), "msg": msg}
                    _Cache.dirty = True
                    asyncio.get_event_loop().create_task(_saver())
                    logger.warning("geo: 高德 Key 用不了，今天先不打高德 %s", msg)
                if _vet["key"] == st.key:
                    _vet["key"], _vet["day"] = "", ""
                raise OffError(msg, off="stop")
            raise RuntimeError(msg)
        return j
    finally:
        if release:
            release()


class OffError(RuntimeError):
    def __init__(self, msg: str, *, off: str):
        super().__init__(msg)
        self.off = off


def _parse_loc(loc: str):
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$", _s(loc))
    if not m:
        return None
    lng, lat = float(m.group(1)), float(m.group(2))
    return [lng, lat] if abs(lng) <= 180 and abs(lat) <= 90 else None


def _bare_city(c: str) -> str:
    return re.sub(r"(特别行政区|自治州|自治区|地区|盟|市|省|县|区)$", "", _s(c))


def _amap_biz(biz) -> dict:
    o = {}
    hours = _s(biz.get("opentime_week")) or _s(biz.get("opentime_today"))
    if hours:
        o["hours"] = hours[:120]
    if _s(biz.get("tel")):
        o["tel"] = _s(biz["tel"])[:60]
    cost = re.sub(r"\.0+$", "", _s(biz.get("cost")))
    if cost and cost != "0":
        o["cost"] = cost[:12]
    if _s(biz.get("tag")):
        o["tag"] = _s(biz["tag"])[:60]
    return o


async def _amap_place(st: AmapSt, name: str, city: str):
    u = f"{BASES['amap']}/v5/place/text?keywords={name[:80]}"
    if city:
        u += f"&region={city}&city_limit=true"
    u += "&show_fields=business,photos&page_size=3"
    j = await _amap_get(u, st, "search")
    pois = [p for p in (j.get("pois") or []) if isinstance(p, dict) and _parse_loc(p.get("location"))]
    want = _bare_city(city)

    def in_city(p):
        if not want:
            return True
        return any(
            _bare_city(x) and (_bare_city(x).find(want) >= 0 or want.find(_bare_city(x)) >= 0)
            for x in [p.get("cityname"), p.get("pname"), p.get("adname")]
        )

    filtered = [p for p in pois if in_city(p)]
    p = next((x for x in filtered if _s(x.get("name")) == name), filtered[0] if filtered else None)
    if not p:
        return None
    lng, lat = _parse_loc(p["location"])
    biz = p.get("business") if isinstance(p.get("business"), dict) else {}
    rating = None
    try:
        r = float(biz.get("rating"))
        rating = round(r * 10) / 10 if r > 0 else None
    except (TypeError, ValueError):
        rating = None
    photo = next((_s(x.get("url")) for x in (p.get("photos") or []) if isinstance(x, dict) and _s(x.get("url"))), "")
    types = [t for t in re.split(r"[;|]", _s(p.get("type"))) if t]
    return {
        "name": _s(p.get("name")) or name, "lng": lng, "lat": lat, "datum": "gcj02",
        "addr": " ".join([x for x in [_s(p.get("adname")), _s(p.get("address"))] if x])[:60],
        "kind": types[-1] if types else "",
        "rating": rating,
        "photo": photo, "photoSrc": "amap" if photo else "", "src": "amap",
        **_amap_biz(biz),
    }


# ---------------- Wikidata / OpenStreetMap ----------------

def _commons_thumb(file: str) -> str:
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{file.replace(' ', '_')}?width=320"


def _claim_value(claims, prop):
    c = claims and isinstance(claims.get(prop), list) and claims[prop] and claims[prop][0]
    if not c:
        return None
    ds = (c.get("mainsnak") or {}).get("datavalue")
    return ds.get("value") if ds else None


async def _wiki_photo(qid: str) -> str:
    if not re.match(r"^Q\d{1,12}$", qid):
        return ""
    u = f"{BASES['wikidata']}/w/api.php?action=wbgetclaims&entity={qid}&property=P18&format=json"
    j = await _gated("wikidata", lambda: _get_json(u, name="Wikidata", timeout_ms=6000))
    file = _s(_claim_value(j.get("claims"), "P18"))
    return _commons_thumb(file) if file else ""


async def _wiki_photo_by_name(name: str, at: dict) -> str:
    lng, lat = coords.convert(at["lng"], at["lat"], at["datum"], "wgs84")
    q = (
        f"{BASES['wikidata']}/w/api.php?action=wbsearchentities&search={name}"
        "&language=zh&uselang=zh&type=item&limit=5&format=json"
    )
    found = await _gated("wikidata", lambda: _get_json(q, name="Wikidata", timeout_ms=6000))
    ids = [
        _s(x.get("id"))
        for x in (found.get("search") or [])
        if isinstance(x, dict) and re.match(r"^Q\d{1,12}$", _s(x.get("id")))
    ]
    if not ids:
        return ""
    g = f"{BASES['wikidata']}/w/api.php?action=wbgetentities&ids={'|'.join(ids)}&props=claims&format=json"
    j = await _gated("wikidata", lambda: _get_json(g, name="Wikidata", timeout_ms=8000))
    for qid in ids:
        ent = (j.get("entities") or {}).get(qid) or {}
        claims = ent.get("claims")
        c = _claim_value(claims, "P625")
        if not c or not isinstance(c.get("longitude"), (int, float)) or not isinstance(c.get("latitude"), (int, float)):
            continue
        if coords.distance(lng, lat, float(c["longitude"]), float(c["latitude"])) > WIKI_NEAR_M:
            continue
        file = _s(_claim_value(claims, "P18"))
        return _commons_thumb(file) if file else ""
    return ""


async def _osm_place(name: str, city: str):
    q = f"{name}, {city}" if city and _bare_city(city) not in name else name
    u = (
        f"{BASES['nominatim']}/search?q={q}&format=jsonv2&limit=1"
        "&extratags=1&accept-language=zh-CN,zh,en"
    )
    arr = await _gated("nominatim", lambda: _get_json(u, name="OpenStreetMap", timeout_ms=10000))
    p = arr[0] if isinstance(arr, list) and arr else None
    if not p:
        return None
    try:
        lng, lat = float(p.get("lon")), float(p.get("lat"))
    except (TypeError, ValueError):
        return None
    if not (abs(lng) <= 180 and abs(lat) <= 90):
        return None
    tags = p.get("extratags") if isinstance(p.get("extratags"), dict) else {}
    img = _s(tags.get("image"))
    photo = img if re.match(r"^https://(upload|commons)\.wikimedia\.org/", img) else ""
    qid = _s(tags.get("wikidata")) if re.match(r"^Q\d{1,12}$", _s(tags.get("wikidata"))) else ""
    parts = [x for x in re.split(r",\s*", _s(p.get("display_name"))) if x]
    return {
        "name": _s(p.get("name")) or name, "lng": lng, "lat": lat, "datum": "wgs84",
        "addr": "，".join(parts[1:4])[:60],
        "kind": OSM_KIND.get(_s(p.get("type"))) or OSM_KIND.get(_s(p.get("category"))) or "",
        "rating": None, "photo": photo, "photoSrc": "wikimedia" if photo else "", "qid": qid, "src": "osm",
    }


# ---------------- 照片 ----------------

async def _photo_by_name(name: str, city: str, at: dict) -> str:
    k = f"w|{city}|{name}"
    hit = _cached(k)
    if hit is not None:
        return hit or ""
    try:
        photo = await _wiki_photo_by_name(name, at)
        _remember(k, photo)
        return photo
    except Exception as exc:  # noqa: BLE001
        logger.warning("geo: 按名字找 Wikidata 头图没成 %s", exc)
        _remember(k, "", True)
        return ""


async def _photo_for(name: str, city: str, qid: str, at: dict) -> str:
    if re.match(r"^Q\d{1,12}$", qid):
        k = f"q|{qid}"
        hit = _cached(k)
        if hit is None:
            try:
                hit = await _wiki_photo(qid)
                _remember(k, hit)
            except Exception as exc:  # noqa: BLE001
                logger.warning("geo: Wikidata 头图没拿到 %s", exc)
                _remember(k, "", True)
                return ""
        elif not hit and _was_err(k):
            return ""
        if hit:
            return hit
    return await _photo_by_name(name, city, at)


def _photo_cached(name: str, city: str, qid: str):
    if re.match(r"^Q\d{1,12}$", qid):
        k = f"q|{qid}"
        q = _cached(k)
        if q is not None:
            return q
        if _was_err(k):
            return ""
    return _cached(f"w|{city}|{name}")


def _with_photo(r: dict, name: str, city: str) -> dict:
    o = {"ok": True, **r}
    if o.get("photo"):
        if not o.get("photoSrc"):
            o["photoSrc"] = "amap" if r.get("src") == "amap" else "wikimedia"
        return o
    pc = _photo_cached(name, city, _s(r.get("qid")))
    if pc is None:
        o["photoPending"] = True
    elif pc:
        o["photo"] = pc
        o["photoSrc"] = "wikidata"
    return o


# ---------------- 对外：查地点 ----------------

async def lookup(config, items) -> dict:
    st = settings_of(config)
    notes: set[str] = set()
    off = ""
    lst = (items or [])[:MAX_ITEMS]

    async def one(it):
        nonlocal off
        name = _s(it.get("name"))[:80] if isinstance(it, dict) else ""
        city = _s(it.get("city"))[:20] if isinstance(it, dict) else ""
        if not name:
            return {"ok": False, "tried": []}
        tried: list[str] = []
        error = ""
        if st["key"]:
            k = f"a|{city}|{name}"
            r = _cached(k)
            if r is None:
                try:
                    r = await _amap_place(AmapSt(st["key"], st["caps"]), name, city)
                    _remember(k, r)
                    tried.append("amap")
                except Exception as exc:  # noqa: BLE001
                    r = None
                    if isinstance(exc, OffError):
                        if exc.off == "stop":
                            off = str(exc)
                        else:
                            notes.add(str(exc))
                    else:
                        error = str(exc)
                        notes.add(str(exc))
            else:
                tried.append("amap")
            if r:
                return _with_photo(r, name, city)
        k = f"o|{city}|{name}"
        r = _cached(k)
        if r is None:
            try:
                r = await _osm_place(name, city)
                _remember(k, r)
                tried.append("osm")
            except Exception as exc:  # noqa: BLE001
                r = None
                error = error or str(exc)
                notes.add(str(exc))
        else:
            tried.append("osm")
        if r:
            return _with_photo(r, name, city)
        return {"ok": False, "failed": True, "error": error} if error else {"ok": False, "tried": tried}

    out = await asyncio.gather(*[one(it) for it in lst])
    srcs = {x["src"] for x in out if x.get("ok") and x.get("src")}
    provider = "mixed" if len(srcs) > 1 else (next(iter(srcs)) if srcs else "")
    res = {"provider": provider, "items": out, "notes": list(notes)}
    if off:
        res["amapOff"] = off
    return res


async def photos(items) -> dict:
    lst = (items or [])[:MAX_ITEMS]

    async def one(it):
        name = _s(it.get("name"))[:80] if isinstance(it, dict) else ""
        city = _s(it.get("city"))[:20] if isinstance(it, dict) else ""
        at = _point_of(it)
        if not name or not at:
            return {"photo": "", "src": ""}
        photo = await _photo_for(name, city, _s(it.get("qid")), at)
        return {"photo": photo, "src": "wikidata" if photo else ""}

    return {"items": await asyncio.gather(*[one(it) for it in lst])}


def _thin(pts, max_=240):
    if len(pts) <= max_:
        return pts
    step = -(-len(pts) // max_)
    out = [p for i, p in enumerate(pts) if i % step == 0]
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out


def _point_of(p):
    def num(v):
        if isinstance(v, bool):
            return float("nan")
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str) and v.strip() != "":
            try:
                return float(v)
            except ValueError:
                return float("nan")
        return float("nan")

    if not p or not isinstance(p, dict):
        return None
    lng, lat = num(p.get("lng")), num(p.get("lat"))
    if lng != lng or lat != lat or abs(lng) > 180 or abs(lat) > 90:
        return None
    return {"lng": lng, "lat": lat, "datum": "gcj02" if p.get("datum") == "gcj02" else "wgs84"}


async def _amap_route(st: AmapSt, a, b, mode: str):
    u = (
        f"{BASES['amap']}/v5/direction/{mode}?origin={a[0]:.6f},{a[1]:.6f}"
        f"&destination={b[0]:.6f},{b[1]:.6f}&show_fields=cost,polyline"
    )
    j = await _amap_get(u, st, "route")
    paths = ((j.get("route") or {}).get("paths")) or []
    p = paths[0] if paths else None
    if not p:
        return None
    line: list[list[float]] = []
    for step in p.get("steps") or []:
        for pair in _s(step.get("polyline")).split(";"):
            xy = _parse_loc(pair)
            if xy:
                line.append(xy)
    dist = _s(p.get("distance"))
    cost = p.get("cost") or {}
    dur = _s(cost.get("duration"))
    try:
        distance_ = float(dist)
    except (TypeError, ValueError):
        distance_ = None
    try:
        duration_ = float(dur)
    except (TypeError, ValueError):
        duration_ = None
    return {
        "mode": mode, "src": "amap", "datum": "gcj02",
        "distance": distance_ if distance_ is not None and distance_ == distance_ else None,
        "duration": duration_ if duration_ is not None and duration_ > 0 else None,
        "line": [[round(x, 6) for x in pt] for pt in _thin(line if len(line) >= 2 else [a, b])],
    }


async def legs(config, pairs) -> dict:
    st = settings_of(config)
    notes: set[str] = set()
    off = ""
    lst = (pairs or [])[:MAX_LEGS]

    async def one(pr):
        nonlocal off
        if not pr or not isinstance(pr, dict):
            return None
        a, b = _point_of(pr.get("a")), _point_of(pr.get("b"))
        if not a or not b:
            return None
        pa = coords.convert(a["lng"], a["lat"], a["datum"], "wgs84")
        pb = coords.convert(b["lng"], b["lat"], b["datum"], "wgs84")
        straight = round(coords.distance(pa[0], pa[1], pb[0], pb[1]))
        line = {"mode": "line", "src": "line", "distance": straight, "duration": None, "datum": "wgs84", "line": [list(pa), list(pb)]}
        if not st["key"] or straight > MAX_ROUTE_M or straight < 30 or not coords.in_china(*pa) or not coords.in_china(*pb):
            return line
        ga = coords.convert(a["lng"], a["lat"], a["datum"], "gcj02")
        gb = coords.convert(b["lng"], b["lat"], b["datum"], "gcj02")
        mode = "walking" if straight < WALK_M else "driving"
        k = f"r|{mode}|{ga[0]:.5f},{ga[1]:.5f}|{gb[0]:.5f},{gb[1]:.5f}"
        r = _cached(k)
        if r is None:
            try:
                r = await _amap_route(AmapSt(st["key"], st["caps"]), ga, gb, mode)
                if r:
                    _remember(k, r)
            except Exception as exc:  # noqa: BLE001
                r = None
                if isinstance(exc, OffError):
                    if exc.off == "stop":
                        off = str(exc)
                    else:
                        notes.add(str(exc))
                else:
                    notes.add(str(exc))
                    return {**line, "failed": True, "error": str(exc)}
        return r or line

    out = await asyncio.gather(*[one(pr) for pr in lst])
    res = {"items": out, "notes": list(notes)}
    if off:
        res["amapOff"] = off
    return res


async def test(config, key=None) -> dict:
    st = settings_of(config)
    k = _s(key) or st["key"]
    if not k:
        r = await _osm_place("天安门", "北京")
        return {
            "ok": bool(r), "provider": "osm",
            "msg": "没填高德 Key，用 OpenStreetMap，连得上" if r else "OpenStreetMap 连上了，但没查到测试地点",
        }
    r = await _amap_place(AmapSt(k, st["caps"], probe=True), "天安门", "北京")
    if k == st["key"]:
        _reset_stop()
    return {
        "ok": bool(r), "provider": "amap",
        "msg": f"高德 Key 能用：查到「{r['name']}」{('，带照片' if r.get('photo') else '')}" if r else "高德 Key 能用，但没查到测试地点",
    }
