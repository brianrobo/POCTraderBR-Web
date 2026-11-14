from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import next_position
from ..db import get_session
from ..models import (
    SimAttempt,
    SimBarAttempt,
    SimBarData,
    SimBarQuiz,
    SimDrawing,
    SimFrame,
    SimPriceFileInfo,
    SimPriceSession,
    SimScenario,
    SimScenarioDetail,
    new_id,
    now,
)
from ..orm import SimAttemptORM, SimBarAttemptORM, SimBarQuizORM, SimBarSetORM, SimFrameORM, SimScenarioORM
from ..paths import ASSETS_DIR
from ..price_files import PriceFileError, parse_price_file, symbol_of

router = APIRouter(prefix="/api/sim", tags=["sim"])

SIM_ASSETS_DIR = ASSETS_DIR / "sim_frames"
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
MAX_DRAWINGS = 500

Track = Literal["30m", "1m"]


class ScenarioCreate(BaseModel):
    name: str


class ScenarioUpdate(BaseModel):
    name: Optional[str] = None


class FrameUpdate(BaseModel):
    label: Optional[str] = None
    # "" clears the sync point; None leaves it untouched.
    sync_frame_id: Optional[str] = None
    is_quiz: Optional[bool] = None
    quiz_outcome: Optional[Literal["", "profit", "loss"]] = None
    quiz_note: Optional[str] = None


class AttemptCreate(BaseModel):
    answer: Literal["buy", "skip"]


class BarSetUpdate(BaseModel):
    replay_from: Optional[int] = None


class BarQuizCreate(BaseModel):
    bar_time: int
    # Where the watched range starts; left out for a quiz about the one bar.
    start_time: Optional[int] = None


class BarQuizUpdate(BaseModel):
    start_time: Optional[int] = None
    bar_time: Optional[int] = None
    outcome: Optional[Literal["", "profit", "loss"]] = None
    note: Optional[str] = None


def _grade(answer: str, outcome: str) -> str:
    if not outcome:
        return ""
    right = "buy" if outcome == "profit" else "skip"
    return "correct" if answer == right else "wrong"


def _frame_to_api(row: SimFrameORM) -> SimFrame:
    return SimFrame(
        id=row.id,
        scenario_id=row.scenario_id,
        track=row.track,  # type: ignore[arg-type]
        position=row.position,
        image_url=f"/uploads/{row.image_path}",
        label=row.label,
        sync_frame_id=row.sync_frame_id,
        is_quiz=bool(row.is_quiz),
        quiz_outcome=row.quiz_outcome or "",  # type: ignore[arg-type]
        quiz_note=row.quiz_note,
    )


def _attempt_to_api(row: SimAttemptORM, outcome: str) -> SimAttempt:
    return SimAttempt(
        id=row.id,
        scenario_id=row.scenario_id,
        frame_id=row.frame_id,
        answer=row.answer,  # type: ignore[arg-type]
        result=_grade(row.answer, outcome),  # type: ignore[arg-type]
        created_at=row.created_at,
    )


def _detail(session: Session, row: SimScenarioORM) -> SimScenarioDetail:
    frames = (
        session.query(SimFrameORM)
        .filter_by(scenario_id=row.id)
        .order_by(SimFrameORM.track, SimFrameORM.position)
        .all()
    )
    attempts = (
        session.query(SimAttemptORM).filter_by(scenario_id=row.id).order_by(SimAttemptORM.created_at).all()
    )
    outcomes = {f.id: f.quiz_outcome or "" for f in frames}
    api_attempts = [_attempt_to_api(a, outcomes.get(a.frame_id, "")) for a in attempts]
    results = [a.result for a in api_attempts]
    quiz_count = sum(1 for f in frames if f.is_quiz)
    bar_count = 0
    # A 'bars' scenario keeps its quiz points and attempts in its own tables.
    bar_set = session.get(SimBarSetORM, row.id)
    if bar_set is not None:
        data = _bar_data(session, bar_set)
        results = [a.result for a in data.attempts]
        quiz_count = len(data.quizzes)
        # Practice begins where the earliest quiz range does, or at the replay start.
        practice_from = min((q.start_time for q in data.quizzes), default=data.replay_from)
        bar_count = sum(1 for bar in data.bars if bar[0] >= practice_from)
    return SimScenarioDetail(
        id=row.id,
        name=row.name,
        kind=row.kind or "frames",  # type: ignore[arg-type]
        position=row.position,
        created_at=row.created_at,
        frame_count_30m=sum(1 for f in frames if f.track == "30m"),
        frame_count_1m=sum(1 for f in frames if f.track == "1m"),
        bar_count=bar_count,
        quiz_count=quiz_count,
        graded_count=sum(1 for r in results if r),
        correct_count=sum(1 for r in results if r == "correct"),
        frames=[_frame_to_api(f) for f in frames],
        attempts=api_attempts,
    )


def _bar_quiz_to_api(row: SimBarQuizORM) -> SimBarQuiz:
    return SimBarQuiz(
        id=row.id,
        scenario_id=row.scenario_id,
        start_time=row.start_time or row.bar_time,
        bar_time=row.bar_time,
        outcome=row.outcome or "",  # type: ignore[arg-type]
        note=row.note,
    )


def _bar_attempt_to_api(row: SimBarAttemptORM, outcome: str) -> SimBarAttempt:
    return SimBarAttempt(
        id=row.id,
        scenario_id=row.scenario_id,
        quiz_id=row.quiz_id,
        answer=row.answer,  # type: ignore[arg-type]
        result=_grade(row.answer, outcome),  # type: ignore[arg-type]
        created_at=row.created_at,
    )


def _bar_data(session: Session, row: SimBarSetORM) -> SimBarData:
    quizzes = (
        session.query(SimBarQuizORM).filter_by(scenario_id=row.scenario_id).order_by(SimBarQuizORM.bar_time).all()
    )
    attempts = (
        session.query(SimBarAttemptORM)
        .filter_by(scenario_id=row.scenario_id)
        .order_by(SimBarAttemptORM.created_at)
        .all()
    )
    outcomes = {q.id: q.outcome or "" for q in quizzes}
    return SimBarData(
        scenario_id=row.scenario_id,
        symbol=row.symbol,
        source_name=row.source_name,
        replay_from=row.replay_from,
        bars=json.loads(row.bars_json),
        quizzes=[_bar_quiz_to_api(q) for q in quizzes],
        attempts=[_bar_attempt_to_api(a, outcomes.get(a.quiz_id, "")) for a in attempts],
        drawings=json.loads(row.drawings_json or "[]"),
    )


def _session_day(bar_time: int) -> int:
    """Day number of the trading session a bar belongs to. US sessions open
    at 04:00, and overnight bars run past midnight on the previous session."""
    return (bar_time - 4 * 3600) // 86400


def _summary(session: Session, row: SimScenarioORM) -> SimScenario:
    return SimScenario(**_detail(session, row).model_dump(exclude={"frames", "attempts"}))


def _require_scenario(session: Session, scenario_id: str) -> SimScenarioORM:
    row = session.get(SimScenarioORM, scenario_id)
    if not row:
        raise HTTPException(404, "scenario not found")
    return row


def _require_frame(session: Session, frame_id: str) -> SimFrameORM:
    row = session.get(SimFrameORM, frame_id)
    if not row:
        raise HTTPException(404, "frame not found")
    return row


def _require_bar_set(session: Session, scenario_id: str) -> SimBarSetORM:
    row = session.get(SimBarSetORM, scenario_id)
    if not row:
        raise HTTPException(404, "scenario has no price data")
    return row


def _require_bar_quiz(session: Session, quiz_id: str) -> SimBarQuizORM:
    row = session.get(SimBarQuizORM, quiz_id)
    if not row:
        raise HTTPException(404, "quiz point not found")
    return row


def _check_quiz_range(session: Session, scenario_id: str, start_time: int, bar_time: int, quiz_id: str = "") -> None:
    """A quiz range runs from one bar to the same or a later one, and no two
    quizzes ask their question at the same bar."""
    times = {bar[0] for bar in json.loads(_require_bar_set(session, scenario_id).bars_json)}
    if start_time not in times or bar_time not in times:
        raise HTTPException(400, "quiz range must start and end on bars")
    if start_time > bar_time:
        raise HTTPException(400, "quiz range must not end before it starts")
    taken = session.query(SimBarQuizORM).filter_by(scenario_id=scenario_id, bar_time=bar_time).first()
    if taken is not None and taken.id != quiz_id:
        raise HTTPException(409, "another quiz already ends at this bar")


def _delete_frame_rows(session: Session, frames: List[SimFrameORM]) -> List[str]:
    """Delete frames (and the attempts pointing at them — foreign_keys=ON
    would reject the frame delete otherwise). Returns the image paths to
    unlink once the transaction has committed."""
    ids = [f.id for f in frames]
    if not ids:
        return []
    session.query(SimAttemptORM).filter(SimAttemptORM.frame_id.in_(ids)).delete(synchronize_session=False)
    session.query(SimFrameORM).filter(SimFrameORM.sync_frame_id.in_(ids)).update(
        {SimFrameORM.sync_frame_id: None}, synchronize_session=False
    )
    paths = [f.image_path for f in frames]
    session.query(SimFrameORM).filter(SimFrameORM.id.in_(ids)).delete(synchronize_session=False)
    return paths


@router.get("/scenarios", response_model=List[SimScenario])
def list_scenarios(session: Session = Depends(get_session)) -> List[SimScenario]:
    rows = session.query(SimScenarioORM).order_by(SimScenarioORM.position).all()
    return [_summary(session, r) for r in rows]


@router.post("/scenarios", response_model=SimScenario)
def create_scenario(payload: ScenarioCreate, session: Session = Depends(get_session)) -> SimScenario:
    row = SimScenarioORM(
        id=new_id(),
        name=payload.name,
        position=next_position(session, SimScenarioORM),
        created_at=now(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _summary(session, row)


@router.get("/scenarios/{scenario_id}", response_model=SimScenarioDetail)
def get_scenario(scenario_id: str, session: Session = Depends(get_session)) -> SimScenarioDetail:
    return _detail(session, _require_scenario(session, scenario_id))


@router.patch("/scenarios/{scenario_id}", response_model=SimScenario)
def update_scenario(
    scenario_id: str, payload: ScenarioUpdate, session: Session = Depends(get_session)
) -> SimScenario:
    row = _require_scenario(session, scenario_id)
    if payload.name is not None:
        row.name = payload.name
    session.commit()
    session.refresh(row)
    return _summary(session, row)


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str, session: Session = Depends(get_session)) -> dict:
    row = _require_scenario(session, scenario_id)
    _delete_frame_rows(session, session.query(SimFrameORM).filter_by(scenario_id=scenario_id).all())
    # Children first — foreign_keys=ON rejects deleting a row that is still referenced.
    for model in (SimBarAttemptORM, SimBarQuizORM, SimBarSetORM):
        session.query(model).filter_by(scenario_id=scenario_id).delete(synchronize_session=False)
    session.delete(row)
    session.commit()
    shutil.rmtree(SIM_ASSETS_DIR / scenario_id, ignore_errors=True)
    return {"ok": True}


@router.delete("/scenarios/{scenario_id}/frames", response_model=SimScenarioDetail)
def clear_frames(scenario_id: str, track: Track, session: Session = Depends(get_session)) -> SimScenarioDetail:
    row = _require_scenario(session, scenario_id)
    frames = session.query(SimFrameORM).filter_by(scenario_id=scenario_id, track=track).all()
    paths = _delete_frame_rows(session, frames)
    session.commit()
    for p in paths:
        (ASSETS_DIR / p).unlink(missing_ok=True)
    return _detail(session, row)


@router.post("/scenarios/{scenario_id}/frames", response_model=SimFrame)
async def add_frame(
    scenario_id: str,
    track: Track = "1m",
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> SimFrame:
    _require_scenario(session, scenario_id)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(400, f"unsupported file type: {ext}")
    content = await file.read()
    scenario_dir = SIM_ASSETS_DIR / scenario_id
    scenario_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{new_id()}_{int(time.time() * 1000)}{ext}"
    (scenario_dir / filename).write_bytes(content)
    row = SimFrameORM(
        id=new_id(),
        scenario_id=scenario_id,
        track=track,
        position=next_position(session, SimFrameORM, scenario_id=scenario_id, track=track),
        image_path=f"sim_frames/{scenario_id}/{filename}",
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _frame_to_api(row)


@router.patch("/frames/{frame_id}", response_model=SimFrame)
def update_frame(frame_id: str, payload: FrameUpdate, session: Session = Depends(get_session)) -> SimFrame:
    row = _require_frame(session, frame_id)
    if payload.label is not None:
        row.label = payload.label
    if payload.sync_frame_id is not None:
        if payload.sync_frame_id == "":
            row.sync_frame_id = None
        else:
            target = session.get(SimFrameORM, payload.sync_frame_id)
            if row.track != "30m" or not target or target.scenario_id != row.scenario_id or target.track != "1m":
                raise HTTPException(400, "sync point must be a 1m frame of the same scenario, set on a 30m frame")
            row.sync_frame_id = target.id
    if payload.is_quiz is not None:
        row.is_quiz = payload.is_quiz
    if payload.quiz_outcome is not None:
        row.quiz_outcome = payload.quiz_outcome
    if payload.quiz_note is not None:
        row.quiz_note = payload.quiz_note
    session.commit()
    session.refresh(row)
    return _frame_to_api(row)


@router.delete("/frames/{frame_id}", response_model=SimScenarioDetail)
def delete_frame(frame_id: str, session: Session = Depends(get_session)) -> SimScenarioDetail:
    row = _require_frame(session, frame_id)
    scenario = _require_scenario(session, row.scenario_id)
    # Keep 30m frames that were synced to this 1m frame in step: hand them to
    # the next 1m frame, which is where replay now arrives at that moment.
    successor = (
        session.query(SimFrameORM)
        .filter(
            SimFrameORM.scenario_id == row.scenario_id,
            SimFrameORM.track == row.track,
            SimFrameORM.position > row.position,
        )
        .order_by(SimFrameORM.position)
        .first()
    )
    if successor is not None:
        session.query(SimFrameORM).filter(SimFrameORM.sync_frame_id == row.id).update(
            {SimFrameORM.sync_frame_id: successor.id}, synchronize_session=False
        )
    paths = _delete_frame_rows(session, [row])
    session.commit()
    for p in paths:
        (ASSETS_DIR / p).unlink(missing_ok=True)
    return _detail(session, scenario)


@router.post("/frames/{frame_id}/attempts", response_model=SimAttempt)
def create_attempt(frame_id: str, payload: AttemptCreate, session: Session = Depends(get_session)) -> SimAttempt:
    frame = _require_frame(session, frame_id)
    if not frame.is_quiz:
        raise HTTPException(400, "frame is not a quiz point")
    row = SimAttemptORM(
        id=new_id(),
        scenario_id=frame.scenario_id,
        frame_id=frame_id,
        answer=payload.answer,
        created_at=now(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _attempt_to_api(row, frame.quiz_outcome or "")


async def _read_price_file(file: UploadFile) -> List[List[float]]:
    try:
        return parse_price_file(file.filename or "", await file.read())
    except PriceFileError as e:
        raise HTTPException(400, str(e)) from e


def _sessions(bars: List[List[float]]) -> List[SimPriceSession]:
    out: List[SimPriceSession] = []
    day = None
    for t, _open, high, low, _close, _volume in bars:
        if _session_day(int(t)) != day:
            day = _session_day(int(t))
            out.append(SimPriceSession(start=int(t), end=int(t), bar_count=0, high=high, low=low))
        cur = out[-1]
        cur.end = int(t)
        cur.bar_count += 1
        cur.high = max(cur.high, high)
        cur.low = min(cur.low, low)
    return out


@router.post("/price-files/inspect", response_model=SimPriceFileInfo)
async def inspect_price_file(file: UploadFile = File(...)) -> SimPriceFileInfo:
    """List the trading sessions of an exported 1-minute price file, so the
    day to replay can be picked before a scenario is made of it."""
    bars = await _read_price_file(file)
    filename = file.filename or ""
    return SimPriceFileInfo(
        symbol=symbol_of(filename), source_name=filename, bar_count=len(bars), sessions=_sessions(bars)
    )


@router.post("/scenarios/import", response_model=SimScenario)
async def import_scenario(
    file: UploadFile = File(...),
    replay_from: Optional[int] = Form(None),
    name: str = Form(""),
    session: Session = Depends(get_session),
) -> SimScenario:
    """Create a 'bars' scenario from an exported 1-minute price file. Replay
    starts at `replay_from` (a session start from the inspect call; by default
    the file's last session), and the bars before it stay on the chart as
    history."""
    bars = await _read_price_file(file)
    filename = file.filename or ""
    if replay_from is None:
        replay_from = _sessions(bars)[-1].start
    elif not any(bar[0] == replay_from for bar in bars):
        raise HTTPException(400, "replay must start at one of the bars")
    symbol = symbol_of(filename)
    row = SimScenarioORM(
        id=new_id(),
        name=name.strip()
        or f"{time.strftime('%y.%m.%d', time.gmtime(_session_day(replay_from) * 86400))} {symbol}".strip(),
        kind="bars",
        position=next_position(session, SimScenarioORM),
        created_at=now(),
    )
    session.add(row)
    session.flush()
    session.add(
        SimBarSetORM(
            scenario_id=row.id,
            symbol=symbol,
            source_name=filename,
            bars_json=json.dumps(bars, separators=(",", ":")),
            replay_from=replay_from,
        )
    )
    session.commit()
    session.refresh(row)
    return _summary(session, row)


@router.get("/scenarios/{scenario_id}/bars", response_model=SimBarData)
def get_bars(scenario_id: str, session: Session = Depends(get_session)) -> SimBarData:
    return _bar_data(session, _require_bar_set(session, scenario_id))


@router.patch("/scenarios/{scenario_id}/bars", response_model=SimBarData)
def update_bars(scenario_id: str, payload: BarSetUpdate, session: Session = Depends(get_session)) -> SimBarData:
    row = _require_bar_set(session, scenario_id)
    if payload.replay_from is not None:
        if not any(bar[0] == payload.replay_from for bar in json.loads(row.bars_json)):
            raise HTTPException(400, "replay must start at one of the bars")
        row.replay_from = payload.replay_from
    session.commit()
    session.refresh(row)
    return _bar_data(session, row)


@router.put("/scenarios/{scenario_id}/drawings", response_model=List[SimDrawing])
def set_drawings(
    scenario_id: str, payload: List[SimDrawing], session: Session = Depends(get_session)
) -> List[SimDrawing]:
    """Replace the shapes drawn on the scenario's 1-minute chart."""
    row = _require_bar_set(session, scenario_id)
    if len(payload) > MAX_DRAWINGS:
        raise HTTPException(400, f"at most {MAX_DRAWINGS} drawings")
    row.drawings_json = json.dumps([d.model_dump() for d in payload], separators=(",", ":"))
    session.commit()
    return payload


@router.post("/scenarios/{scenario_id}/bar-quizzes", response_model=SimBarQuiz)
def create_bar_quiz(scenario_id: str, payload: BarQuizCreate, session: Session = Depends(get_session)) -> SimBarQuiz:
    start_time = payload.bar_time if payload.start_time is None else payload.start_time
    # Asking twice for the same range gives the same quiz.
    row = session.query(SimBarQuizORM).filter_by(scenario_id=scenario_id, bar_time=payload.bar_time).first()
    if row is None or (row.start_time or row.bar_time) != start_time:
        _check_quiz_range(session, scenario_id, start_time, payload.bar_time)
        row = SimBarQuizORM(id=new_id(), scenario_id=scenario_id, start_time=start_time, bar_time=payload.bar_time)
        session.add(row)
        session.commit()
        session.refresh(row)
    return _bar_quiz_to_api(row)


@router.patch("/bar-quizzes/{quiz_id}", response_model=SimBarQuiz)
def update_bar_quiz(quiz_id: str, payload: BarQuizUpdate, session: Session = Depends(get_session)) -> SimBarQuiz:
    row = _require_bar_quiz(session, quiz_id)
    if payload.start_time is not None or payload.bar_time is not None:
        bar_time = row.bar_time if payload.bar_time is None else payload.bar_time
        start_time = (row.start_time or row.bar_time) if payload.start_time is None else payload.start_time
        _check_quiz_range(session, row.scenario_id, start_time, bar_time, quiz_id)
        row.start_time, row.bar_time = start_time, bar_time
    if payload.outcome is not None:
        row.outcome = payload.outcome
    if payload.note is not None:
        row.note = payload.note
    session.commit()
    session.refresh(row)
    return _bar_quiz_to_api(row)


@router.delete("/bar-quizzes/{quiz_id}")
def delete_bar_quiz(quiz_id: str, session: Session = Depends(get_session)) -> dict:
    row = _require_bar_quiz(session, quiz_id)
    session.query(SimBarAttemptORM).filter_by(quiz_id=quiz_id).delete(synchronize_session=False)
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.post("/bar-quizzes/{quiz_id}/attempts", response_model=SimBarAttempt)
def create_bar_attempt(
    quiz_id: str, payload: AttemptCreate, session: Session = Depends(get_session)
) -> SimBarAttempt:
    quiz = _require_bar_quiz(session, quiz_id)
    row = SimBarAttemptORM(
        id=new_id(),
        scenario_id=quiz.scenario_id,
        quiz_id=quiz_id,
        answer=payload.answer,
        created_at=now(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _bar_attempt_to_api(row, quiz.outcome or "")
