from __future__ import annotations

import json
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import BUY_CHECKLIST_SETTINGS_ID, BuyCheckLogEntry, BuyChecklistSettings, new_id, now
from ..orm import BuyCheckLogORM, BuyChecklistSettingsORM

router = APIRouter(prefix="/api/buy-checklist", tags=["buy-checklist"])


class SettingsUpdate(BaseModel):
    descriptions: dict[str, str]


class LogCreate(BaseModel):
    verdict: Literal["blocked", "review"]
    answers: dict[str, Optional[Literal["yes", "no"]]]
    symbol: Optional[str] = None
    note: Optional[str] = None


def _settings_to_api(row: BuyChecklistSettingsORM) -> BuyChecklistSettings:
    return BuyChecklistSettings(id=row.id, descriptions=json.loads(row.descriptions_json or "{}"))


def _log_to_api(row: BuyCheckLogORM) -> BuyCheckLogEntry:
    return BuyCheckLogEntry(
        id=row.id,
        created_at=row.created_at,
        verdict=row.verdict,  # type: ignore[arg-type]
        answers=json.loads(row.answers_json or "{}"),
        symbol=row.symbol,
        note=row.note,
    )


@router.get("/settings", response_model=BuyChecklistSettings)
def get_settings(session: Session = Depends(get_session)) -> BuyChecklistSettings:
    row = session.get(BuyChecklistSettingsORM, BUY_CHECKLIST_SETTINGS_ID)
    if not row:
        raise HTTPException(404, "not found")
    return _settings_to_api(row)


@router.put("/settings", response_model=BuyChecklistSettings)
def update_settings(payload: SettingsUpdate, session: Session = Depends(get_session)) -> BuyChecklistSettings:
    row = session.get(BuyChecklistSettingsORM, BUY_CHECKLIST_SETTINGS_ID)
    if not row:
        raise HTTPException(404, "not found")
    row.descriptions_json = json.dumps(payload.descriptions, ensure_ascii=False)
    session.commit()
    session.refresh(row)
    return _settings_to_api(row)


@router.get("/log", response_model=List[BuyCheckLogEntry])
def list_log(limit: int = 200, session: Session = Depends(get_session)) -> List[BuyCheckLogEntry]:
    rows = session.query(BuyCheckLogORM).order_by(BuyCheckLogORM.created_at.desc()).limit(limit).all()
    return [_log_to_api(r) for r in rows]


@router.post("/log", response_model=BuyCheckLogEntry)
def create_log(payload: LogCreate, session: Session = Depends(get_session)) -> BuyCheckLogEntry:
    row = BuyCheckLogORM(
        id=new_id(),
        created_at=now(),
        verdict=payload.verdict,
        answers_json=json.dumps(payload.answers, ensure_ascii=False),
        symbol=payload.symbol,
        note=payload.note,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _log_to_api(row)
