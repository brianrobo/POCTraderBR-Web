"""End-to-end check of /api/sim against the running server. Cleans up after itself.

    backend/.venv/Scripts/python.exe -X utf8 tools/sim-tests/sim_api_test.py <path of assets>
"""
import calendar
import json
import struct
import sys
import urllib.error
import urllib.request
import uuid
import zlib
from pathlib import Path

BASE = "http://localhost:8000"
ASSETS = Path(sys.argv[1])


def png(shade: int) -> bytes:
    w, h = 8, 8
    raw = b"".join(b"\x00" + bytes([shade, shade, shade]) * w for _ in range(h))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def call(method: str, path: str, body=None, upload=None, fields=None):
    headers = {}
    data = None
    if upload is not None:
        name, content = upload
        boundary = uuid.uuid4().hex
        data = b"".join(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
            for key, value in (fields or {}).items()
        )
        data += (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def ok(method, path, body=None, upload=None, fields=None):
    status, data = call(method, path, body, upload, fields)
    assert status == 200, (method, path, status, data)
    return data


# --- exported price files, as the HTS writes them
# (date, hour, minute, open, high, low, close, volume); 24:10 is an overnight bar of the 11/12 session
PRICE_ROWS = (
    [((2026, 11, 12), 9, 30 + i, 5.0 + i, 5.5 + i, 4.5 + i, 5.2 + i, 100.0 * (i + 1)) for i in range(5)]
    + [((2026, 11, 12), 24, 10, 9.0, 9.4, 8.8, 9.1, 50.0)]
    + [((2026, 11, 13), 4, m, 9.0, 9.9 + m, 8.0, 9.5, 10.0) for m in (0, 1, 2, 5, 6, 7, 8, 9, 30, 31)]
)


def epoch(date, hour, minute) -> int:
    return calendar.timegm((*date, 0, 0, 0)) + hour * 3600 + minute * 60


def cdt(rows) -> bytes:
    out = struct.pack("<ii", 1, len(rows))
    for (y, m, d), hh, mm, o, h, l, c, v in rows:
        stamp = float(f"{y:04d}{m:02d}{d:02d}{hh:02d}{mm:02d}00")
        out += struct.pack("<8d", stamp, o, h, l, c, v, 0.0, 0.0)
    return out


def xls(rows) -> bytes:
    def record(rid: int, body: bytes) -> bytes:
        return struct.pack("<HH", rid, len(body)) + body

    def text(row: int, col: int, value: str) -> bytes:
        raw = value.encode("cp949")
        return record(0x0004, struct.pack("<HH", row, col) + b"\x00\x00\x00" + bytes([len(raw)]) + raw)

    def number(row: int, col: int, value: float) -> bytes:
        return record(0x0003, struct.pack("<HH", row, col) + b"\x00\x00\x00" + struct.pack("<d", value))

    out = record(0x0809, struct.pack("<HH", 2, 0x10))
    for col, title in enumerate(["일자 / 시간", "시가", "고가", "저가", "종가", "거래량", "거래대금", "미결제약정"]):
        out += text(0, col, title)
    for i, ((y, m, d), hh, mm, *values) in enumerate(rows, start=1):
        out += text(i, 0, f"{y:04d}/{m:02d}/{d:02d}-{hh:02d}:{mm:02d}:00")
        for col, value in enumerate([*values, 0.0, 0.0], start=1):
            out += number(i, col, value)
    return out + record(0x000A, b"")


before = ok("GET", "/api/sim/scenarios")
scn = ok("POST", "/api/sim/scenarios", {"name": "__apitest 시나리오"})
sid = scn["id"]
try:
    assert scn["name"] == "__apitest 시나리오" and scn["frame_count_1m"] == 0

    m30 = [ok("POST", f"/api/sim/scenarios/{sid}/frames?track=30m", upload=(f"a{i}.png", png(i))) for i in range(3)]
    m1 = [ok("POST", f"/api/sim/scenarios/{sid}/frames?track=1m", upload=(f"b{i}.png", png(100 + i))) for i in range(6)]
    assert [f["position"] for f in m30] == [0, 1, 2] and [f["position"] for f in m1] == [0, 1, 2, 3, 4, 5]
    assert all(f["track"] == "30m" for f in m30) and all(f["track"] == "1m" for f in m1)

    # the stored image is served back byte-for-byte
    with urllib.request.urlopen(BASE + m1[2]["image_url"]) as res:
        assert res.read() == png(102)

    status, _ = call("POST", f"/api/sim/scenarios/{sid}/frames?track=1m", upload=("x.gif", b"GIF89a"))
    assert status == 400, status
    status, _ = call("POST", f"/api/sim/scenarios/{sid}/frames?track=5m", upload=("x.png", png(1)))
    assert status == 422, status

    detail = ok("GET", f"/api/sim/scenarios/{sid}")
    assert detail["frame_count_30m"] == 3 and detail["frame_count_1m"] == 6
    assert [f["id"] for f in detail["frames"] if f["track"] == "1m"] == [f["id"] for f in m1]

    # sync + label
    f = ok("PATCH", f"/api/sim/frames/{m30[1]['id']}", {"sync_frame_id": m1[2]["id"], "label": "17:30"})
    assert f["sync_frame_id"] == m1[2]["id"] and f["label"] == "17:30"
    assert call("PATCH", f"/api/sim/frames/{m30[1]['id']}", {"sync_frame_id": m30[0]["id"]})[0] == 400  # target not 1m
    assert call("PATCH", f"/api/sim/frames/{m1[0]['id']}", {"sync_frame_id": m1[2]["id"]})[0] == 400  # not a 30m frame
    assert call("PATCH", f"/api/sim/frames/{m30[1]['id']}", {"sync_frame_id": "nope"})[0] == 400
    # a label-only patch leaves the sync point alone
    f = ok("PATCH", f"/api/sim/frames/{m30[1]['id']}", {"label": "17:30:00"})
    assert f["sync_frame_id"] == m1[2]["id"]
    f = ok("PATCH", f"/api/sim/frames/{m30[2]['id']}", {"sync_frame_id": m1[5]["id"]})
    f = ok("PATCH", f"/api/sim/frames/{m30[2]['id']}", {"sync_frame_id": ""})
    assert f["sync_frame_id"] is None

    # quiz + attempts
    assert call("POST", f"/api/sim/frames/{m1[3]['id']}/attempts", {"answer": "buy"})[0] == 400  # not a quiz point
    ok("PATCH", f"/api/sim/frames/{m1[3]['id']}", {"is_quiz": True})
    a = ok("POST", f"/api/sim/frames/{m1[3]['id']}/attempts", {"answer": "buy"})
    assert a["result"] == ""  # ungraded until an outcome is set
    ok("PATCH", f"/api/sim/frames/{m1[3]['id']}", {"quiz_outcome": "loss", "quiz_note": "고점 처리 안 됨"})
    a = ok("POST", f"/api/sim/frames/{m1[3]['id']}/attempts", {"answer": "skip"})
    assert a["result"] == "correct"
    assert call("POST", f"/api/sim/frames/{m1[3]['id']}/attempts", {"answer": "hold"})[0] == 422
    detail = ok("GET", f"/api/sim/scenarios/{sid}")
    # grading is derived: the earlier 'buy' now counts as wrong
    assert [x["result"] for x in detail["attempts"]] == ["wrong", "correct"], detail["attempts"]
    assert (detail["quiz_count"], detail["graded_count"], detail["correct_count"]) == (1, 2, 1)
    summary = next(s for s in ok("GET", "/api/sim/scenarios") if s["id"] == sid)
    assert (summary["quiz_count"], summary["graded_count"], summary["correct_count"]) == (1, 2, 1)
    assert "frames" not in summary

    # deleting the 1m frame a 30m frame is synced to hands the sync to the next 1m frame
    detail = ok("DELETE", f"/api/sim/frames/{m1[2]['id']}")
    by_id = {f["id"]: f for f in detail["frames"]}
    assert m1[2]["id"] not in by_id and by_id[m30[1]["id"]]["sync_frame_id"] == m1[3]["id"]
    assert not (ASSETS / m1[2]["image_url"].removeprefix("/uploads/")).exists()

    # deleting a quiz frame takes its attempts with it (foreign_keys=ON)
    detail = ok("DELETE", f"/api/sim/frames/{m1[3]['id']}")
    assert detail["attempts"] == [] and detail["quiz_count"] == 0
    by_id = {f["id"]: f for f in detail["frames"]}
    assert by_id[m30[1]["id"]]["sync_frame_id"] == m1[4]["id"]

    # deleting the last 1m frame while synced to it clears the sync
    ok("PATCH", f"/api/sim/frames/{m30[2]['id']}", {"sync_frame_id": m1[5]["id"]})
    detail = ok("DELETE", f"/api/sim/frames/{m1[5]['id']}")
    assert {f["id"]: f for f in detail["frames"]}[m30[2]["id"]]["sync_frame_id"] is None

    # new frames append after the highest remaining position
    extra = ok("POST", f"/api/sim/scenarios/{sid}/frames?track=1m", upload=("c.png", png(200)))
    assert extra["position"] == 5, extra

    # clearing the 1m track drops the sync points that referred to it
    detail = ok("DELETE", f"/api/sim/scenarios/{sid}/frames?track=1m")
    assert detail["frame_count_1m"] == 0 and detail["frame_count_30m"] == 3
    assert all(f["sync_frame_id"] is None for f in detail["frames"])

    assert call("GET", "/api/sim/scenarios/nope")[0] == 404
    assert call("PATCH", "/api/sim/frames/nope", {"label": "x"})[0] == 404
    scenario_dir = ASSETS / "sim_frames" / sid
    assert len(list(scenario_dir.iterdir())) == 3, list(scenario_dir.iterdir())
finally:
    ok("DELETE", f"/api/sim/scenarios/{sid}")

assert not (ASSETS / "sim_frames" / sid).exists()
assert ok("GET", "/api/sim/scenarios") == before

# --- price-data ('bars') scenarios
times = [epoch(date, hh, mm) for date, hh, mm, *_ in PRICE_ROWS]
day13 = epoch((2026, 11, 13), 4, 0)

info = ok("POST", "/api/sim/price-files/inspect", upload=("TEST_1분봉.cdt", cdt(PRICE_ROWS)))
assert info == ok("POST", "/api/sim/price-files/inspect", upload=("TEST_1분봉.xls", xls(PRICE_ROWS))) | {
    "source_name": "TEST_1분봉.cdt"
}
assert (info["symbol"], info["bar_count"]) == ("TEST", 16), info
# the 24:10 bar (00:10 on 11/13 by the clock) stays in the 11/12 session
assert info["sessions"] == [
    {"start": times[0], "end": epoch((2026, 11, 13), 0, 10), "bar_count": 6, "high": 9.5, "low": 4.5},
    {"start": day13, "end": epoch((2026, 11, 13), 4, 31), "bar_count": 10, "high": 40.9, "low": 8.0},
], info["sessions"]

assert call("POST", "/api/sim/price-files/inspect", upload=("x.csv", b"1,2,3"))[0] == 400
assert call("POST", "/api/sim/price-files/inspect", upload=("x.cdt", b"\x01\x00"))[0] == 400
# 30-minute bars can't be replayed minute by minute
coarse = [((2026, 11, 13), 9 + i // 2, 30 * (i % 2), 1.0, 2.0, 0.5, 1.5, 10.0) for i in range(4)]
status, error = call("POST", "/api/sim/price-files/inspect", upload=("x.cdt", cdt(coarse)))
assert status == 400 and "1분봉" in error["detail"], (status, error)
assert call("POST", "/api/sim/scenarios/import", upload=("x.cdt", cdt(coarse)))[0] == 400
status, _ = call("POST", "/api/sim/scenarios/import", upload=("TEST_1분봉.cdt", cdt(PRICE_ROWS)), fields={"replay_from": 5})
assert status == 400, status
assert ok("GET", "/api/sim/scenarios") == before  # failed imports leave nothing behind

# default: replay the file's last session, named after it
scn = ok("POST", "/api/sim/scenarios/import", upload=("TEST_1분봉.xls", xls(PRICE_ROWS)))
bid = scn["id"]
try:
    assert (scn["kind"], scn["name"], scn["bar_count"], scn["quiz_count"]) == ("bars", "26.11.13 TEST", 10, 0), scn
    data = ok("GET", f"/api/sim/scenarios/{bid}/bars")
    assert (data["symbol"], data["source_name"], data["replay_from"]) == ("TEST", "TEST_1분봉.xls", day13)
    assert [bar[0] for bar in data["bars"]] == times and data["bars"][0][1:] == [5.0, 5.5, 4.5, 5.2, 100.0]
    assert data["quizzes"] == [] and data["attempts"] == []
    detail = ok("GET", f"/api/sim/scenarios/{bid}")
    assert detail["kind"] == "bars" and detail["frames"] == []
    assert call("GET", f"/api/sim/scenarios/{sid}/bars")[0] == 404

    # replay start
    assert call("PATCH", f"/api/sim/scenarios/{bid}/bars", {"replay_from": times[0] + 1})[0] == 400
    data = ok("PATCH", f"/api/sim/scenarios/{bid}/bars", {"replay_from": times[2]})
    assert data["replay_from"] == times[2]
    assert next(s for s in ok("GET", "/api/sim/scenarios") if s["id"] == bid)["bar_count"] == 14

    # a quiz is a range of bars, from one bar to the same or a later one;
    # asking twice for the same range gives the same quiz
    quizzes = f"/api/sim/scenarios/{bid}/bar-quizzes"
    assert call("POST", quizzes, {"bar_time": times[3] + 30})[0] == 400
    assert call("POST", quizzes, {"start_time": times[6] + 30, "bar_time": times[8]})[0] == 400
    assert call("POST", quizzes, {"start_time": times[9], "bar_time": times[8]})[0] == 400
    assert call("POST", f"/api/sim/scenarios/{sid}/bar-quizzes", {"bar_time": times[8]})[0] == 404
    q = ok("POST", quizzes, {"start_time": times[6], "bar_time": times[8]})
    assert q == ok("POST", quizzes, {"start_time": times[6], "bar_time": times[8]})
    assert (q["start_time"], q["bar_time"], q["outcome"], q["note"]) == (times[6], times[8], "", "")
    assert call("POST", quizzes, {"bar_time": times[8]})[0] == 409  # one quiz per closing bar
    # without a start it is a quiz about the one bar
    early = ok("POST", quizzes, {"bar_time": times[4]})
    assert (early["start_time"], early["bar_time"]) == (times[4], times[4])
    assert early == ok("POST", quizzes, {"start_time": times[4], "bar_time": times[4]})
    # practice now begins where the earliest quiz range does
    assert next(s for s in ok("GET", "/api/sim/scenarios") if s["id"] == bid)["bar_count"] == 12

    # moving a range
    assert call("PATCH", f"/api/sim/bar-quizzes/{q['id']}", {"start_time": times[9]})[0] == 400
    assert call("PATCH", f"/api/sim/bar-quizzes/{q['id']}", {"bar_time": times[5]})[0] == 400
    assert call("PATCH", f"/api/sim/bar-quizzes/{q['id']}", {"bar_time": times[8] + 1})[0] == 400
    assert call("PATCH", f"/api/sim/bar-quizzes/{q['id']}", {"start_time": times[3], "bar_time": times[4]})[0] == 409
    moved = ok("PATCH", f"/api/sim/bar-quizzes/{q['id']}", {"start_time": times[5]})
    assert (moved["start_time"], moved["bar_time"]) == (times[5], times[8])
    moved = ok("PATCH", f"/api/sim/bar-quizzes/{q['id']}", {"start_time": times[9], "bar_time": times[9]})
    assert (moved["start_time"], moved["bar_time"]) == (times[9], times[9])
    q = ok("PATCH", f"/api/sim/bar-quizzes/{q['id']}", {"start_time": times[6], "bar_time": times[8]})
    assert ok("GET", f"/api/sim/scenarios/{bid}/bars")["quizzes"] == [early, q]

    a = ok("POST", f"/api/sim/bar-quizzes/{q['id']}/attempts", {"answer": "buy"})
    assert a["result"] == ""  # ungraded until an outcome is set
    q = ok("PATCH", f"/api/sim/bar-quizzes/{q['id']}", {"outcome": "profit", "note": "눌림 후 재돌파"})
    assert (q["outcome"], q["note"], q["start_time"], q["bar_time"]) == ("profit", "눌림 후 재돌파", times[6], times[8])
    assert ok("PATCH", f"/api/sim/bar-quizzes/{q['id']}", {"outcome": "profit"})["note"] == "눌림 후 재돌파"
    a = ok("POST", f"/api/sim/bar-quizzes/{q['id']}/attempts", {"answer": "skip"})
    assert a["result"] == "wrong"
    ok("POST", f"/api/sim/bar-quizzes/{early['id']}/attempts", {"answer": "skip"})
    assert call("POST", f"/api/sim/bar-quizzes/{q['id']}/attempts", {"answer": "hold"})[0] == 422
    assert call("POST", "/api/sim/bar-quizzes/nope/attempts", {"answer": "buy"})[0] == 404
    assert call("PATCH", f"/api/sim/bar-quizzes/{q['id']}", {"outcome": "maybe"})[0] == 422

    data = ok("GET", f"/api/sim/scenarios/{bid}/bars")
    assert [x["bar_time"] for x in data["quizzes"]] == [times[4], times[8]]  # in time order
    # grading is derived: the earlier 'buy' now counts as correct
    assert [x["result"] for x in data["attempts"]] == ["correct", "wrong", ""], data["attempts"]
    summary = next(s for s in ok("GET", "/api/sim/scenarios") if s["id"] == bid)
    assert (summary["quiz_count"], summary["graded_count"], summary["correct_count"]) == (2, 2, 1), summary

    # deleting a quiz point takes its attempts with it (foreign_keys=ON)
    assert ok("DELETE", f"/api/sim/bar-quizzes/{q['id']}") == {"ok": True}
    data = ok("GET", f"/api/sim/scenarios/{bid}/bars")
    assert [x["id"] for x in data["quizzes"]] == [early["id"]] and len(data["attempts"]) == 1

    # drawings: the whole list is replaced each time
    assert data["drawings"] == []
    shapes = [
        {"id": "a", "kind": "line", "x1": 1.5, "y1": 5.1, "x2": 6.25, "y2": 5.4, "at": 7},
        {"id": "b", "kind": "rect", "x1": 2, "y1": 5.0, "x2": 4, "y2": 5.5, "at": 9},
        {"id": "c", "kind": "ellipse", "x1": 12.5, "y1": 4.8, "x2": 3, "y2": 5.2, "at": 9},
    ]
    assert ok("PUT", f"/api/sim/scenarios/{bid}/drawings", shapes) == shapes
    assert ok("GET", f"/api/sim/scenarios/{bid}/bars")["drawings"] == shapes
    assert ok("PUT", f"/api/sim/scenarios/{bid}/drawings", shapes[1:2]) == shapes[1:2]
    assert ok("GET", f"/api/sim/scenarios/{bid}/bars")["drawings"] == shapes[1:2]
    assert call("PUT", f"/api/sim/scenarios/{bid}/drawings", [{**shapes[0], "kind": "arrow"}])[0] == 422
    assert call("PUT", f"/api/sim/scenarios/{bid}/drawings", [{"id": "d", "kind": "line"}])[0] == 422
    assert call("PUT", f"/api/sim/scenarios/{bid}/drawings", [{**shapes[0], "id": str(i)} for i in range(501)])[0] == 400
    assert call("PUT", f"/api/sim/scenarios/{sid}/drawings", shapes)[0] == 404  # not a price-data scenario
    assert ok("GET", f"/api/sim/scenarios/{bid}/bars")["drawings"] == shapes[1:2]  # rejected lists change nothing
finally:
    # with a quiz point and an attempt still attached
    ok("DELETE", f"/api/sim/scenarios/{bid}")

assert call("GET", f"/api/sim/scenarios/{bid}/bars")[0] == 404

# a picked session and a name
scn = ok(
    "POST",
    "/api/sim/scenarios/import",
    upload=("TEST_1분봉.cdt", cdt(PRICE_ROWS)),
    fields={"replay_from": times[0], "name": "__apitest 가격"},
)
try:
    assert (scn["name"], scn["bar_count"]) == ("__apitest 가격", 16), scn
    assert ok("GET", f"/api/sim/scenarios/{scn['id']}/bars")["replay_from"] == times[0]
finally:
    ok("DELETE", f"/api/sim/scenarios/{scn['id']}")

assert ok("GET", "/api/sim/scenarios") == before
print("all sim api tests passed")
