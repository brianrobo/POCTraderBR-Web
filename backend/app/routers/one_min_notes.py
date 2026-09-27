from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import next_position, one_min_note_to_api
from ..db import get_session
from ..models import OneMinNote, new_id, now
from ..orm import OneMinNoteORM

router = APIRouter(prefix="/api/one-min-notes", tags=["one-min-notes"])


class OneMinNoteCreate(BaseModel):
    column: Literal["pass", "fail"]
    text: str


class OneMinNoteUpdate(BaseModel):
    text: Optional[str] = None


@router.get("", response_model=List[OneMinNote])
def list_one_min_notes(session: Session = Depends(get_session)) -> List[OneMinNote]:
    rows = session.query(OneMinNoteORM).order_by(OneMinNoteORM.position).all()
    return [one_min_note_to_api(r) for r in rows]


@router.post("", response_model=OneMinNote)
def create_one_min_note(payload: OneMinNoteCreate, session: Session = Depends(get_session)) -> OneMinNote:
    row = OneMinNoteORM(
        id=new_id(),
        column=payload.column,
        text=payload.text,
        position=next_position(session, OneMinNoteORM, column=payload.column),
        created_at=now(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return one_min_note_to_api(row)


@router.patch("/{note_id}", response_model=OneMinNote)
def update_one_min_note(
    note_id: str, payload: OneMinNoteUpdate, session: Session = Depends(get_session)
) -> OneMinNote:
    row = session.get(OneMinNoteORM, note_id)
    if not row:
        raise HTTPException(404, "not found")
    if payload.text is not None:
        row.text = payload.text
    session.commit()
    session.refresh(row)
    return one_min_note_to_api(row)


@router.delete("/{note_id}")
def delete_one_min_note(note_id: str, session: Session = Depends(get_session)) -> dict:
    row = session.get(OneMinNoteORM, note_id)
    if not row:
        raise HTTPException(404, "not found")
    session.delete(row)
    session.commit()
    return {"ok": True}
