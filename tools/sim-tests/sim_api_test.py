"""End-to-end check of /api/sim and /api/insights against the running server. Cleans up after itself.

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
insights_before = ok("GET", "/api/insights")
scn = ok("POST", "/api/sim/scenarios", {"name": "__apitest 시나리오"})
sid = scn["id"]
try:
    assert scn["name"] == "__apitest 시나리오" and scn["frame_count_1m"] == 0
    assert scn["stock_name"] == ""

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
made = []  # insight nodes of this test


def node(name, parent_id=None):
    created = ok("POST", "/api/insights/nodes", {"name": name, "parent_id": parent_id})
    made.append(created["id"])
    return created


def under(parent_id):
    """Ids of this test's nodes right under a node (None: the top level), in order."""
    nodes = ok("GET", "/api/insights")["nodes"]
    return [n["id"] for n in nodes if n["parent_id"] == parent_id and n["id"] in made]


def links_of(node_id):
    """quiz id -> stance of the quizzes a node rests on."""
    return {e["quiz_id"]: e["stance"] for e in ok("GET", "/api/insights")["evidence"] if e["node_id"] == node_id}


try:
    assert (scn["kind"], scn["name"], scn["bar_count"], scn["quiz_count"]) == ("bars", "26.11.13 TEST", 10, 0), scn
    # the stock's name: empty until given, set and cleared on its own
    assert scn["stock_name"] == ""
    named = ok("PATCH", f"/api/sim/scenarios/{bid}", {"stock_name": " 테스트 홀딩스 "})
    assert (named["name"], named["stock_name"]) == ("26.11.13 TEST", "테스트 홀딩스"), named
    assert ok("PATCH", f"/api/sim/scenarios/{bid}", {"name": "26.11.13 TEST"})["stock_name"] == "테스트 홀딩스"
    assert ok("GET", f"/api/sim/scenarios/{bid}")["stock_name"] == "테스트 홀딩스"
    assert [s["stock_name"] for s in ok("GET", "/api/sim/scenarios") if s["id"] == bid] == ["테스트 홀딩스"]
    assert ok("PATCH", f"/api/sim/scenarios/{bid}", {"stock_name": ""})["stock_name"] == ""
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

    # --- insight map: the quizzes as the map lists them
    listed = {x["id"]: x for x in ok("GET", "/api/insights")["quizzes"]}
    view = listed[q["id"]]
    assert (view["scenario_id"], view["scenario_name"], view["start_frame"], view["end_frame"]) == (
        bid,
        "26.11.13 TEST",
        7,
        9,
    ), view
    assert (view["outcome"], view["note"], view["graded_count"], view["correct_count"]) == (
        "profit",
        "눌림 후 재돌파",
        2,
        1,
    ), view
    view = listed[early["id"]]
    assert (view["start_frame"], view["end_frame"], view["outcome"], view["graded_count"]) == (5, 5, "", 0), view

    # nodes
    nodes = "/api/insights/nodes"
    assert call("POST", nodes, {"name": "  "})[0] == 400
    assert call("POST", nodes, {"name": "x", "parent_id": "nope"})[0] == 404
    top = node("__apitest 눌림")
    assert (top["parent_id"], top["kind"], top["status"], top["description"]) == (None, "", "candidate", ""), top
    child = node("__apitest 재돌파", top["id"])
    other = node("__apitest 거래량")
    grand = node("__apitest 손자", child["id"])
    assert child["parent_id"] == top["id"] and other["position"] == top["position"] + 1
    assert under(None) == [top["id"], other["id"]] and under(top["id"]) == [child["id"]]

    patched = ok(
        "PATCH",
        f"{nodes}/{top['id']}",
        {"name": " __apitest 눌림목 ", "kind": "buy", "status": "confirmed", "description": "지지 확인 후"},
    )
    assert (patched["name"], patched["kind"], patched["status"], patched["description"], patched["parent_id"]) == (
        "__apitest 눌림목",
        "buy",
        "confirmed",
        "지지 확인 후",
        None,
    ), patched
    assert ok("PATCH", f"{nodes}/{top['id']}", {"status": "dropped"})["kind"] == "buy"  # the rest stays
    assert call("PATCH", f"{nodes}/{top['id']}", {"name": " "})[0] == 400
    assert call("PATCH", f"{nodes}/{top['id']}", {"kind": "sell"})[0] == 422
    assert call("PATCH", f"{nodes}/nope", {"name": "x"})[0] == 404

    # a node can go anywhere but under itself
    assert call("PATCH", f"{nodes}/{top['id']}", {"parent_id": top["id"]})[0] == 400
    assert call("PATCH", f"{nodes}/{top['id']}", {"parent_id": grand["id"]})[0] == 400
    assert call("PATCH", f"{nodes}/{other['id']}", {"parent_id": "nope"})[0] == 404
    assert ok("PATCH", f"{nodes}/{other['id']}", {"parent_id": top["id"]})["parent_id"] == top["id"]
    assert under(top["id"]) == [child["id"], other["id"]] and under(None) == [top["id"]]

    # order among siblings
    assert ok("POST", f"{nodes}/{other['id']}/move", {"direction": "up"}) == {"ok": True}
    assert under(top["id"]) == [other["id"], child["id"]]
    ok("POST", f"{nodes}/{other['id']}/move", {"direction": "up"})  # already first
    assert under(top["id"]) == [other["id"], child["id"]]
    ok("POST", f"{nodes}/{other['id']}/move", {"direction": "down"})
    assert under(top["id"]) == [child["id"], other["id"]]
    assert call("POST", f"{nodes}/{other['id']}/move", {"direction": "left"})[0] == 422
    # "" is the top level
    assert ok("PATCH", f"{nodes}/{other['id']}", {"parent_id": ""})["parent_id"] is None
    assert under(None) == [top["id"], other["id"]]

    # evidence: a quiz linked to a node as support or as a counter-example
    evidence = "/api/insights/evidence"
    assert call("POST", evidence, {"node_id": "nope", "quiz_id": q["id"]})[0] == 404
    assert call("POST", evidence, {"node_id": top["id"], "quiz_id": "nope"})[0] == 404
    link = ok("POST", evidence, {"node_id": child["id"], "quiz_id": q["id"]})
    assert (link["node_id"], link["quiz_id"], link["stance"], link["comment"]) == (child["id"], q["id"], "support", "")
    # linking the same quiz again changes the link there is
    again = ok("POST", evidence, {"node_id": child["id"], "quiz_id": q["id"], "stance": "counter", "comment": "돌파 실패"})
    assert (again["id"], again["stance"], again["comment"]) == (link["id"], "counter", "돌파 실패"), again
    again = ok("POST", evidence, {"node_id": child["id"], "quiz_id": q["id"]})
    assert (again["id"], again["stance"], again["comment"]) == (link["id"], "support", "돌파 실패"), again
    link = ok("PATCH", f"{evidence}/{link['id']}", {"stance": "counter"})
    assert (link["stance"], link["comment"]) == ("counter", "돌파 실패")
    assert ok("PATCH", f"{evidence}/{link['id']}", {"comment": ""})["stance"] == "counter"
    assert call("PATCH", f"{evidence}/{link['id']}", {"stance": "maybe"})[0] == 422
    assert call("PATCH", f"{evidence}/nope", {"comment": "x"})[0] == 404
    ok("POST", evidence, {"node_id": top["id"], "quiz_id": q["id"]})
    ok("POST", evidence, {"node_id": other["id"], "quiz_id": early["id"], "stance": "counter"})
    spare = ok("POST", evidence, {"node_id": grand["id"], "quiz_id": early["id"]})
    assert ok("DELETE", f"{evidence}/{spare['id']}") == {"ok": True}
    assert call("DELETE", f"{evidence}/{spare['id']}")[0] == 404
    assert links_of(child["id"]) == {q["id"]: "counter"} and links_of(grand["id"]) == {}

    # merging folds a node into another: quizzes, children and description move over
    assert call("POST", f"{nodes}/{child['id']}/merge", {"into_id": child["id"]})[0] == 400
    assert call("POST", f"{nodes}/{child['id']}/merge", {"into_id": grand["id"]})[0] == 400
    assert call("POST", f"{nodes}/{child['id']}/merge", {"into_id": "nope"})[0] == 404
    status, error = call("DELETE", f"{nodes}/{top['id']}")
    assert status == 400 and "children" in error["detail"], (status, error)
    merged = ok("POST", f"{nodes}/{child['id']}/merge", {"into_id": top["id"]})
    assert (merged["id"], merged["description"]) == (top["id"], "지지 확인 후"), merged
    assert under(top["id"]) == [grand["id"]] and child["id"] not in under(None)
    assert links_of(top["id"]) == {q["id"]: "support"}  # a quiz both rest on keeps the target's link
    made.remove(child["id"])
    ok("PATCH", f"{nodes}/{other['id']}", {"description": "거래량 동반"})
    merged = ok("POST", f"{nodes}/{other['id']}/merge", {"into_id": top["id"]})
    assert merged["description"] == "지지 확인 후\n\n거래량 동반", merged
    assert links_of(top["id"]) == {q["id"]: "support", early["id"]: "counter"}
    made.remove(other["id"])
    assert under(None) == [top["id"]]

    # a node goes with its links; the quizzes stay
    extra = node("__apitest 임시")
    ok("POST", evidence, {"node_id": extra["id"], "quiz_id": q["id"]})
    assert ok("DELETE", f"{nodes}/{extra['id']}") == {"ok": True}
    made.remove(extra["id"])
    assert call("DELETE", f"{nodes}/{extra['id']}")[0] == 404
    assert {e["node_id"] for e in ok("GET", "/api/insights")["evidence"] if e["quiz_id"] == q["id"]} == {top["id"]}

    # deleting a quiz point takes its attempts and its insight links with it (foreign_keys=ON)
    assert ok("DELETE", f"/api/sim/bar-quizzes/{q['id']}") == {"ok": True}
    data = ok("GET", f"/api/sim/scenarios/{bid}/bars")
    assert [x["id"] for x in data["quizzes"]] == [early["id"]] and len(data["attempts"]) == 1
    assert links_of(top["id"]) == {early["id"]: "counter"}

    # drawings: the whole list is replaced each time
    assert data["drawings"] == []
    shapes = [
        {"id": "a", "kind": "line", "x1": 1.5, "y1": 5.1, "x2": 6.25, "y2": 5.4, "at": 7},
        {"id": "b", "kind": "rect", "x1": 2, "y1": 5.0, "x2": 4, "y2": 5.5, "at": 9},
        {"id": "c", "kind": "ellipse", "x1": 12.5, "y1": 4.8, "x2": 3, "y2": 5.2, "at": 9},
        {"id": "h", "kind": "hline", "x1": 8.5, "y1": 5.25, "x2": 8.5, "y2": 5.25, "at": 9},
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

    # a quiz's insight ("My Insight"): the whole of it is replaced each time, by frame numbers
    assert data["quizzes"][0]["insight"] is None
    insight_url = f"/api/sim/bar-quizzes/{early['id']}/insight"
    insight = {
        "view_start": 1,
        "view_end": 16,
        "bands": [{"lo": 5.0, "hi": 5.5, "color": "#8a2be2", "text": "가격대", "start": 2, "label_frame": 9}],
        "zones": [{"start": 2, "end": 4, "color": "#ff8c00", "opacity": 0.22, "text": "구간", "text_price": 4.9}],
        "levels": [{"price": 5.2, "start": 5, "end": 16, "color": "#0b6b2e", "text": "자리", "label_frame": 0}],
        "vlines": [{"frame": 5, "color": "#111111", "text": "판단", "text_price": 0, "side": "left"}],
        "brackets": [{"frame": 8, "lo": 5.2, "hi": 5.5, "color": "#b00020", "text": "약 6%"}],
        "marks": [{"frame": 3, "text": "최고가", "side": "above", "len": 12, "dx": -8, "bold": True}],
        "notes": ["① 첫 설명 줄", "② 둘째 설명 줄"],
    }
    saved = ok("PUT", insight_url, insight)
    assert saved == {**early, "insight": insight}, saved
    assert ok("GET", f"/api/sim/scenarios/{bid}/bars")["quizzes"] == [saved]
    # what is left out takes its default
    assert ok("PUT", insight_url, {"marks": [{"frame": 16, "text": "끝"}]})["insight"] == {
        **{key: [] for key in insight},
        "view_start": 0,
        "view_end": 0,
        "marks": [{"frame": 16, "text": "끝", "side": "above", "len": 24, "dx": 0, "bold": False}],
    }
    # the quiz's other fields change without it
    moved = ok("PATCH", f"/api/sim/bar-quizzes/{early['id']}", {"note": "메모"})
    assert (moved["note"], len(moved["insight"]["marks"])) == ("메모", 1), moved
    ok("PUT", insight_url, insight)
    for wrong in (
        {"marks": [{"frame": 17, "text": "x"}]},  # no such frame
        {"marks": [{"frame": 0, "text": "x"}]},
        {"zones": [{"start": 4, "end": 2}]},  # ends before it starts
        {"view_start": 3, "view_end": 0},
        {"bands": [{"lo": 5.5, "hi": 5.0}]},
        {"bands": [{"lo": 5.0, "hi": 5.5, "label_frame": 17}]},
        {"brackets": [{"frame": 8, "lo": 5.5, "hi": 5.2}]},
    ):
        assert call("PUT", insight_url, wrong)[0] == 400, wrong
    assert call("PUT", insight_url, {"marks": [{"frame": 3, "text": "x", "side": "left"}]})[0] == 422
    assert call("PUT", insight_url, {"vlines": [{"color": "#111111"}]})[0] == 422
    assert call("PUT", "/api/sim/bar-quizzes/nope/insight", insight)[0] == 404
    assert ok("GET", f"/api/sim/scenarios/{bid}/bars")["quizzes"][0]["insight"] == insight  # rejected ones change nothing
    assert ok("DELETE", insight_url)["insight"] is None
    assert ok("GET", f"/api/sim/scenarios/{bid}/bars")["quizzes"][0]["insight"] is None
    assert call("DELETE", "/api/sim/bar-quizzes/nope/insight")[0] == 404
finally:
    # with a quiz point, an attempt and an insight link still attached
    ok("DELETE", f"/api/sim/scenarios/{bid}")
    left = ok("GET", "/api/insights")
    # the nodes of this test, the ones under others first
    rest = {n["id"]: n["parent_id"] for n in left["nodes"] if n["id"] in made}
    while rest:
        for node_id in [i for i in rest if i not in rest.values()]:
            ok("DELETE", f"/api/insights/nodes/{node_id}")
            del rest[node_id]

assert call("GET", f"/api/sim/scenarios/{bid}/bars")[0] == 404
# the scenario took its quizzes' links with it
assert not [e for e in left["evidence"] if e["node_id"] in made], left["evidence"]

# a picked session and a name
scn = ok(
    "POST",
    "/api/sim/scenarios/import",
    upload=("TEST_1분봉.cdt", cdt(PRICE_ROWS)),
    fields={"replay_from": times[0], "name": "__apitest 가격", "stock_name": " 테스트 홀딩스 "},
)
try:
    assert (scn["name"], scn["stock_name"], scn["bar_count"]) == ("__apitest 가격", "테스트 홀딩스", 16), scn
    assert ok("GET", f"/api/sim/scenarios/{scn['id']}/bars")["replay_from"] == times[0]
finally:
    ok("DELETE", f"/api/sim/scenarios/{scn['id']}")

assert ok("GET", "/api/sim/scenarios") == before
assert ok("GET", "/api/insights") == insights_before
print("all sim api tests passed")
