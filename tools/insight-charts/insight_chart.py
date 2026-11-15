"""Draws an annotated 1-minute candle chart (an SVG inside an HTML page) for an insight explanation.

    python insight_chart.py <bars.json> <spec.json> <out.html>      -> prints "<width> <height>" of the page

bars.json is the app's GET /api/sim/scenarios/{id}/bars answer; frame N is bars[N-1].
The page is turned into a PNG with headless Chrome (--screenshot).
"""
import datetime as dt
import html
import json
import pathlib
import sys

UP, DOWN, FLAT, BG = "#e8121d", "#0a4fd6", "#333333", "#c3c3c3"  # the simulator chart's colours
MA_COLOR = {5: "#ff3b30", 10: "#1e5bff", 20: "#ff9500", 60: "#0a9b3c", 120: "#111111"}
W, L, R, TOP, PH, GAP, VH, AXIS = 1900, 30, 80, 96, 600, 14, 140, 50
FONT = "'Malgun Gothic', 'Segoe UI', sans-serif"

bars = json.loads(pathlib.Path(sys.argv[1]).read_bytes().decode("utf-8"))["bars"]
spec = json.loads(pathlib.Path(sys.argv[2]).read_bytes().decode("utf-8"))
VH = spec.get("volume_height", VH)
f0, f1 = spec["frames"]
seg = bars[f0 - 1:f1]
n = len(seg)
plot_w = W - L - R
cw = plot_w / n
pmin = spec.get("price_min", min(b[3] for b in seg))
pmax = spec.get("price_max", max(b[2] for b in seg))
vmax = max(b[5] for b in seg)
VTOP = TOP + PH + GAP
BOTTOM = VTOP + VH
notes = spec.get("notes", [])
H = BOTTOM + AXIS + 18 + 27 * len(notes) + 14

X = lambda f: L + (f - f0 + 0.5) * cw
Y = lambda p: TOP + PH * (pmax - min(max(p, pmin), pmax)) / (pmax - pmin)
bar = lambda f: bars[f - 1]
clock = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime("%H:%M")
out = []


def text_width(s, size):
    return sum(size if ord(ch) >= 0x2000 else size * 0.56 for ch in s)


def label(x, y, text, anchor="middle", size=15, color="#111", bg="#ffffff", bold=False):
    """A text box whose top is at y; x is its left edge, centre or right edge by anchor."""
    lines = text.split("\n")
    w = max(text_width(s, size) for s in lines) + 12
    h = len(lines) * (size + 5) + 6
    left = x if anchor == "start" else x - w if anchor == "end" else x - w / 2
    left = min(max(left, 2), W - w - 2)
    out.append(f'<rect x="{left:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h}" rx="3" fill="{bg}" fill-opacity="0.9" stroke="{color}" stroke-opacity="0.35"/>')
    for i, s in enumerate(lines):
        out.append(
            f'<text x="{left + 6:.1f}" y="{y + 3 + (i + 1) * (size + 5) - 5:.1f}" font-size="{size}" fill="{color}"'
            f'{" font-weight=\'bold\'" if bold else ""}>{html.escape(s)}</text>'
        )
    return h


out.append(f'<rect width="{W}" height="{H}" fill="#f4f4f4"/>')
out.append(f'<rect x="{L}" y="{TOP}" width="{plot_w}" height="{PH}" fill="{BG}"/>')
out.append(f'<rect x="{L}" y="{VTOP}" width="{plot_w}" height="{VH}" fill="{BG}"/>')

for band in spec.get("bands", []):
    y1, y2 = Y(band["hi"]), Y(band["lo"])
    out.append(f'<rect x="{L}" y="{y1:.1f}" width="{plot_w}" height="{y2 - y1:.1f}" fill="{band["color"]}" fill-opacity="0.3"/>')
    for edge in (band["hi"], band["lo"]):
        if pmin < edge < pmax:
            out.append(f'<line x1="{L}" x2="{L + plot_w}" y1="{Y(edge):.1f}" y2="{Y(edge):.1f}" stroke="{band["color"]}" stroke-width="1.5"/>')

for zone in spec.get("zones", []):
    x1, x2 = X(zone["from"]) - cw / 2, X(zone["to"]) + cw / 2
    out.append(f'<rect x="{x1:.1f}" y="{TOP}" width="{x2 - x1:.1f}" height="{BOTTOM - TOP}" fill="{zone["color"]}" fill-opacity="{zone.get("opacity", 0.25)}"/>')

step = spec["price_step"]
tick = round(pmin / step) * step
while tick <= pmax + 1e-9:
    if tick >= pmin - 1e-9:
        out.append(f'<line x1="{L}" x2="{L + plot_w}" y1="{Y(tick):.1f}" y2="{Y(tick):.1f}" stroke="#000" stroke-opacity="0.1"/>')
        out.append(f'<text x="{L + plot_w + 6}" y="{Y(tick) + 5:.1f}" font-size="14" fill="#222">{tick:.2f}</text>')
    tick += step

body = max(1.0, cw * 0.7)
for f in range(f0, f1 + 1):
    _, o, h, l, c, v = bar(f)
    color = UP if c > o else DOWN if c < o else FLAT
    x = X(f)
    out.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{Y(h):.1f}" y2="{Y(l):.1f}" stroke="{color}" stroke-width="1"/>')
    top, bottom = Y(max(o, c)), Y(min(o, c))
    out.append(f'<rect x="{x - body / 2:.1f}" y="{top:.1f}" width="{body:.1f}" height="{max(1.0, bottom - top):.1f}" fill="{color}"/>')
    vh = VH * v / vmax
    out.append(f'<rect x="{x - body / 2:.1f}" y="{BOTTOM - vh:.1f}" width="{body:.1f}" height="{vh:.1f}" fill="{color}"/>')
periods = spec.get("ma", [])  # simple moving averages of the closes, counted from the start of the file like the app
if periods:
    out.append(f'<clipPath id="plot"><rect x="{L}" y="{TOP}" width="{plot_w}" height="{PH}"/></clipPath>')
    y_of = lambda p: TOP + PH * (pmax - p) / (pmax - pmin)
    for period in periods:
        points = " ".join(
            f"{X(f):.1f},{y_of(sum(b[4] for b in bars[f - period:f]) / period):.1f}" for f in range(max(f0, period), f1 + 1)
        )
        out.append(f'<polyline points="{points}" fill="none" stroke="{MA_COLOR[period]}" stroke-width="1.6" clip-path="url(#plot)"/>')
    lx, ly = L + 8 + spec.get("ma_legend_dx", 0), TOP + 8
    out.append(f'<rect x="{lx}" y="{ly}" width="{52 + 44 * len(periods)}" height="26" rx="3" fill="#ffffff" fill-opacity="0.9"/>')
    out.append(f'<text x="{lx + 6}" y="{ly + 18}" font-size="14" fill="#111">이평선</text>')
    for i, period in enumerate(periods):
        out.append(f'<text x="{lx + 56 + 44 * i}" y="{ly + 18}" font-size="15" font-weight="bold" fill="{MA_COLOR[period]}">{period}</text>')
out.append(f'<text x="{L + plot_w + 6}" y="{VTOP + 14}" font-size="13" fill="#222">{vmax / 10000:,.0f}만 주</text>')
out.append(f'<text x="{L + 6}" y="{VTOP + 16}" font-size="13" fill="#222">거래량</text>')

for level in spec.get("levels", []):
    x1, x2, y = X(level["from"]) - cw / 2, X(level["to"]) + cw / 2, Y(level["price"])
    out.append(f'<line x1="{x1:.1f}" x2="{x2:.1f}" y1="{y:.1f}" y2="{y:.1f}" stroke="{level["color"]}" stroke-width="2" stroke-dasharray="7 5"/>')
    if level.get("text"):
        label(X(level.get("label_frame", level["to"])), y + level.get("dy", -30), level["text"], level.get("anchor", "end"), color=level["color"])

for line in spec.get("vlines", []):
    x = X(line["frame"]) + cw / 2
    out.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{TOP}" y2="{BOTTOM}" stroke="{line["color"]}" stroke-width="2"/>')
    label(x + 6, TOP + line.get("y", 8), line["text"], line.get("anchor", "start"), color=line["color"], bold=True)

for zone in spec.get("zones", []):
    if zone.get("text"):
        label(X(zone["from"]) - cw / 2 + zone.get("dx", 6), TOP + zone.get("y", 8), zone["text"], "start", color=zone.get("text_color", "#111"), bold=True)

for band in spec.get("bands", []):
    if band.get("text"):
        label(X(band["label_frame"]), (Y(band["hi"]) + Y(band["lo"])) / 2 + band.get("dy", -14), band["text"], "start", size=16, color=band.get("text_color", "#111"), bold=True)

for br in spec.get("brackets", []):
    x, y1, y2 = X(br["frame"]), Y(br["hi"]), Y(br["lo"])
    out.append(f'<path d="M{x - 7:.1f} {y1:.1f} H{x + 7:.1f} M{x:.1f} {y1:.1f} V{y2:.1f} M{x - 7:.1f} {y2:.1f} H{x + 7:.1f}" stroke="{br["color"]}" stroke-width="2.5" fill="none"/>')
    label(x + 12, (y1 + y2) / 2 + br.get("dy", -22), br["text"], "start", color=br["color"], bold=True)

if spec.get("range"):
    rg = spec["range"]
    x1, x2, y = X(rg["from"]) - cw / 2, X(rg["to"]) + cw / 2, TOP + PH - 14
    out.append(f'<path d="M{x1:.1f} {y - 8} V{y + 8} M{x1:.1f} {y} H{x2:.1f} M{x2:.1f} {y - 8} V{y + 8}" stroke="#0b6b2e" stroke-width="3" fill="none"/>')
    label((x1 + x2) / 2, y - 34, rg["text"], "middle", color="#0b6b2e", bold=True)

for mark in spec.get("marks", []):
    f = mark["frame"]
    above = mark.get("side", "above") == "above"
    x, length, dx = X(f), mark.get("len", 36), mark.get("dx", 0)
    lines = mark["text"].count("\n") + 1
    box_h = lines * 20 + 6
    y0 = Y(bar(f)[2]) - 4 if above else Y(bar(f)[3]) + 4
    y1 = y0 - length if above else y0 + length
    out.append(f'<line x1="{x:.1f}" y1="{y0:.1f}" x2="{x + dx:.1f}" y2="{y1:.1f}" stroke="#111" stroke-width="1.3"/>')
    out.append(f'<circle cx="{x:.1f}" cy="{y0:.1f}" r="2.5" fill="#111"/>')
    label(x + dx, y1 - box_h if above else y1, mark["text"], mark.get("anchor", "middle"), color=mark.get("color", "#111"), bold=mark.get("bold", False))

every = spec["tick"]
for f in range(f0, f1 + 1):
    if f % every == 0:
        x = X(f)
        out.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{BOTTOM}" y2="{BOTTOM + 6}" stroke="#222"/>')
        out.append(f'<text x="{x:.1f}" y="{BOTTOM + 22}" font-size="14" font-weight="bold" fill="#111" text-anchor="middle">{f}</text>')
        out.append(f'<text x="{x:.1f}" y="{BOTTOM + 40}" font-size="12" fill="#444" text-anchor="middle">{clock(bar(f)[0])}</text>')
out.append(f'<text x="{L + plot_w + 24}" y="{BOTTOM + 22}" font-size="13" font-weight="bold" fill="#111">프레임</text>')
out.append(f'<text x="{L + plot_w + 24}" y="{BOTTOM + 40}" font-size="12" fill="#444">시각(ET)</text>')

out.append(f'<text x="{L}" y="38" font-size="24" font-weight="bold" fill="#111">{html.escape(spec["title"])}</text>')
out.append(f'<text x="{L}" y="70" font-size="16" fill="#333">{html.escape(spec.get("subtitle", ""))}</text>')
for i, s in enumerate(notes):
    out.append(f'<text x="{L}" y="{BOTTOM + AXIS + 18 + 27 * i + 18}" font-size="17" fill="#111">{html.escape(s)}</text>')

page = (
    '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#f4f4f4}svg{display:block}</style>'
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="{FONT}">' + "".join(out) + "</svg>"
)
pathlib.Path(sys.argv[3]).write_bytes(page.encode("utf-8"))
print(W, H)
