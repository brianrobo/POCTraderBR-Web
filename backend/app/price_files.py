"""Reads the 1-minute price files the 영웅문 HTS exports from a chart
(.cdt, or the same rows as .xls), for the data-driven simulator scenarios.

Both formats carry the same rows — time, open, high, low, close, volume,
amount, open interest — and the HTS leaves the last two at 0 for US stocks.
"""
from __future__ import annotations

import re
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List

# [time, open, high, low, close, volume]. `time` is the bar's exchange
# wall-clock time read as if it were UTC, in epoch seconds — charts then show
# the exchange's own clock without any time-zone handling.
Bar = List[float]

_XLS_STAMP = re.compile(r"(\d{4})/(\d{2})/(\d{2})-(\d{2}):(\d{2}):(\d{2})")


class PriceFileError(ValueError):
    pass


def _epoch(year: int, month: int, day: int, hour: int, minute: int, second: int) -> int:
    # Overnight-session bars are stamped past midnight on the session's date
    # (e.g. 25:01), so the clock part is added rather than passed to datetime.
    base = datetime(year, month, day, tzinfo=timezone.utc)
    return int((base + timedelta(hours=hour, minutes=minute, seconds=second)).timestamp())


def _parse_cdt(raw: bytes) -> List[Bar]:
    """8-byte header (version, bar count), then per bar eight doubles:
    yyyymmddhhmmss, open, high, low, close, volume, amount, open interest."""
    if len(raw) < 8:
        raise PriceFileError("파일이 비어 있습니다")
    count = struct.unpack_from("<i", raw, 4)[0]
    if count <= 0 or len(raw) < 8 + count * 64:
        raise PriceFileError("cdt 파일의 봉 개수와 크기가 맞지 않습니다")
    bars: List[Bar] = []
    for i in range(count):
        stamp, o, h, l, c, v = struct.unpack_from("<6d", raw, 8 + i * 64)
        s = f"{int(stamp):014d}"
        t = _epoch(int(s[:4]), int(s[4:6]), int(s[6:8]), int(s[8:10]), int(s[10:12]), int(s[12:14]))
        bars.append([t, o, h, l, c, v])
    return bars


def _parse_xls(raw: bytes) -> List[Bar]:
    """The HTS writes an old-style Excel sheet: a flat run of
    [id u16][length u16][data] records, of which only the text cells (0x0004)
    and number cells (0x0003) matter. Each cell is row u16, col u16, three
    attribute bytes, then a length-prefixed CP949 string or a double."""
    cells: dict[tuple[int, int], object] = {}
    pos = 0
    while pos + 4 <= len(raw):
        rid, length = struct.unpack_from("<HH", raw, pos)
        body = raw[pos + 4 : pos + 4 + length]
        if rid == 0x0004 and len(body) >= 8:
            row, col = struct.unpack_from("<HH", body, 0)
            cells[(row, col)] = body[8 : 8 + body[7]].decode("cp949", errors="replace")
        elif rid == 0x0003 and len(body) >= 15:
            row, col = struct.unpack_from("<HH", body, 0)
            cells[(row, col)] = struct.unpack_from("<d", body, 7)[0]
        pos += 4 + length
    bars: List[Bar] = []
    for row in sorted({r for r, _ in cells}):
        stamp = cells.get((row, 0))
        match = _XLS_STAMP.fullmatch(stamp.strip()) if isinstance(stamp, str) else None
        values = [cells.get((row, col)) for col in range(1, 6)]
        if not match or not all(isinstance(v, float) for v in values):
            continue  # the header row
        bars.append([_epoch(*(int(g) for g in match.groups())), *values])  # type: ignore[list-item]
    return bars


def parse_price_file(filename: str, raw: bytes) -> List[Bar]:
    """1-minute bars of an exported .cdt / .xls file, oldest first."""
    ext = Path(filename).suffix.lower()
    if ext == ".cdt":
        bars = _parse_cdt(raw)
    elif ext == ".xls":
        bars = _parse_xls(raw)
    else:
        raise PriceFileError(f"지원하지 않는 파일 형식입니다: {ext or filename}")
    bars = sorted({bar[0]: bar for bar in bars}.values(), key=lambda bar: bar[0])
    if len(bars) < 2:
        raise PriceFileError("가격 데이터를 찾지 못했습니다")
    # 30m bars are rebuilt from these, so anything coarser than 1 minute can't be used.
    if min(b[0] - a[0] for a, b in zip(bars, bars[1:])) != 60:
        raise PriceFileError("1분봉 파일이 아닙니다 (봉 간격이 1분이 아님)")
    return bars


def symbol_of(filename: str) -> str:
    """'FCUV_1분봉.xls' → 'FCUV'."""
    return Path(filename).stem.split("_")[0].strip()
