"""WGS-84 / GCJ-02 坐标换算（移植自 openworkbuddy src/util/geo-coords.js）。

同一份口径在 evopanel/src/lib/tripcard.js（浏览器侧）也存在；改这里必须同步改那边。
"""
from __future__ import annotations

import math

A = 6378245.0
EE = 0.00669342162296594323

# [西经界, 北纬界, 东经界, 南纬界]
IN = [
    [79.4462, 49.2204, 96.33, 42.8899],
    [109.6872, 54.1415, 135.0002, 39.3742],
    [73.1246, 42.8899, 124.143255, 29.5297],
    [82.9684, 29.5297, 97.0352, 26.7186],
    [97.0253, 29.5297, 124.367395, 20.4127],
    [107.975793, 20.4127, 111.744104, 17.871542],
]
OUT = [
    [119.921265, 25.398623, 122.497559, 21.785006],
    [101.8652, 22.284, 106.665, 20.0988],
    [106.4525, 21.5422, 108.051, 20.4878],
    [109.0323, 55.8175, 119.127, 50.3257],
    [127.4568, 55.8175, 137.0227, 49.5574],
    [131.2662, 44.8922, 137.0227, 42.5692],
]


def _hit(rects, lng, lat) -> bool:
    for w, n, e, s in rects:
        if w <= lng <= e and s <= lat <= n:
            return True
    return False


def in_china(lng: float, lat: float) -> bool:
    return _hit(IN, lng, lat) and not _hit(OUT, lng, lat)


def _t_lat(x: float, y: float) -> float:
    r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    r += ((20 * math.sin(6 * x * math.pi) + 20 * math.sin(2 * x * math.pi)) * 2) / 3
    r += ((20 * math.sin(y * math.pi) + 40 * math.sin((y / 3) * math.pi)) * 2) / 3
    r += ((160 * math.sin((y / 12) * math.pi) + 320 * math.sin((y * math.pi) / 30)) * 2) / 3
    return r


def _t_lng(x: float, y: float) -> float:
    r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    r += ((20 * math.sin(6 * x * math.pi) + 20 * math.sin(2 * x * math.pi)) * 2) / 3
    r += ((20 * math.sin(x * math.pi) + 40 * math.sin((x / 3) * math.pi)) * 2) / 3
    r += ((150 * math.sin((x / 12) * math.pi) + 300 * math.sin((x / 30) * math.pi)) * 2) / 3
    return r


def wgs_to_gcj(lng: float, lat: float) -> tuple[float, float]:
    if not in_china(lng, lat):
        return lng, lat
    d_lat = _t_lat(lng - 105, lat - 35)
    d_lng = _t_lng(lng - 105, lat - 35)
    rad = (lat / 180) * math.pi
    magic = math.sin(rad)
    magic = 1 - EE * magic * magic
    sq = math.sqrt(magic)
    d_lat = (d_lat * 180) / (((A * (1 - EE)) / (magic * sq)) * math.pi)
    d_lng = (d_lng * 180) / ((A / sq) * math.cos(rad) * math.pi)
    return lng + d_lng, lat + d_lat


def gcj_to_wgs(lng: float, lat: float) -> tuple[float, float]:
    if not in_china(lng, lat):
        return lng, lat
    x, y = lng, lat
    for _ in range(5):
        gx, gy = wgs_to_gcj(x, y)
        x -= gx - lng
        y -= gy - lat
    return x, y


def convert(lng: float, lat: float, frm: str, to: str) -> tuple[float, float]:
    if frm == to:
        return lng, lat
    if frm == "wgs84" and to == "gcj02":
        return wgs_to_gcj(lng, lat)
    if frm == "gcj02" and to == "wgs84":
        return gcj_to_wgs(lng, lat)
    return lng, lat


def distance(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    r = 6371008.8
    rad = math.pi / 180
    d_lat = (lat2 - lat1) * rad
    d_lng = (lng2 - lng1) * rad
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lng / 2) ** 2
    )
    return 2 * r * math.asin(min(1, math.sqrt(h)))
