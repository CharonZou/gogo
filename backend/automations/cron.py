"""5 字段 cron 匹配（标准 `分 时 日 月 星期`，无外部依赖）。

字段语法：`*` / `*/n` / `a-b` / `a-b/n` / `a,b,c` / 单值。
day-of-week：0-6（0=周日），7 也接受（=周日）。
"""

from __future__ import annotations

from datetime import datetime, timedelta

_FIELD_SPECS = (
    (0, 59),   # minute
    (0, 23),   # hour
    (1, 31),   # day of month
    (1, 12),   # month
    (0, 7),    # day of week（7=周日，匹配时归一为 0）
)


class CronError(ValueError):
    """cron 表达式非法。"""


def validate_cron(cron: str) -> None:
    """校验 5 字段 cron，非法抛 CronError。"""
    parts = cron.split()
    if len(parts) != 5:
        raise CronError(f"cron 必须为 5 字段（分 时 日 月 星期），得到 {len(parts)} 个：{cron!r}")
    for i, (field, (lo, hi)) in enumerate(zip(parts, _FIELD_SPECS)):
        _parse_field(field, lo, hi, name=i)


def match_cron(cron: str, dt: datetime) -> bool:
    """判断 dt 所在分钟是否命中 cron。"""
    try:
        parts = cron.split()
        minute, hour, dom, month, dow = (
            _parse_field(parts[0], 0, 59, "minute"),
            _parse_field(parts[1], 0, 23, "hour"),
            _parse_field(parts[2], 1, 31, "day"),
            _parse_field(parts[3], 1, 12, "month"),
            _parse_field(parts[4], 0, 7, "weekday"),
        )
    except (IndexError, CronError):
        return False
    # day-of-week：7 归一为 0（周日）；cron(0=周日) → python weekday(6=周日)
    dow = {d % 7 for d in dow}
    py_dow = {(d + 6) % 7 for d in dow}
    if dt.minute not in minute:
        return False
    if dt.hour not in hour:
        return False
    if dt.day not in dom:
        return False
    if dt.month not in month:
        return False
    return dt.weekday() in py_dow  # weekday(): 0=周一 … 6=周日


def next_match(cron: str, after: datetime, horizon_days: int = 7) -> datetime | None:
    """after 之后（不含 after）的下一个命中分钟；horizon 内无则 None。"""
    cursor = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    deadline = after + timedelta(days=horizon_days)
    while cursor <= deadline:
        if match_cron(cron, cursor):
            return cursor
        cursor += timedelta(minutes=1)
    return None


def _parse_field(field: str, lo: int, hi: int, name) -> set[int]:
    """解析单个 cron 字段为合法值集合。"""
    if field == "*":
        return set(range(lo, hi + 1))
    if "/" in field:
        base, step_s = field.split("/", 1)
        step = _to_int(step_s, name)
        if step <= 0:
            raise CronError(f"字段 {name} 步进必须为正数：{field!r}")
        if base == "*":
            base_lo, base_hi = lo, hi
        elif "-" in base:
            a, b = base.split("-", 1)
            base_lo, base_hi = _to_int(a, name), _to_int(b, name)
            if base_lo > base_hi:
                raise CronError(f"字段 {name} 范围倒置：{base!r}")
        else:
            v = _to_int(base, name)
            base_lo = base_hi = v
        out = set(range(base_lo, base_hi + 1, step))
        _check_range(out, lo, hi, name)
        return out
    if "," in field:
        out: set[int] = set()
        for part in field.split(","):
            out |= _parse_field(part, lo, hi, name)
        return out
    if "-" in field:
        a, b = field.split("-", 1)
        v_a, v_b = _to_int(a, name), _to_int(b, name)
        if v_a > v_b:
            raise CronError(f"字段 {name} 范围倒置：{field!r}")
        out = set(range(v_a, v_b + 1))
        _check_range(out, lo, hi, name)
        return out
    v = _to_int(field, name)
    out = {v}
    _check_range(out, lo, hi, name)
    return out


def _to_int(s: str, name) -> int:
    try:
        return int(s)
    except ValueError:
        raise CronError(f"字段 {name} 非法数值：{s!r}") from None


def _check_range(values: set[int], lo: int, hi: int, name) -> None:
    if any(v < lo or v > hi for v in values):
        raise CronError(f"字段 {name} 取值须在 {lo}-{hi} 之间：{sorted(values)}")
