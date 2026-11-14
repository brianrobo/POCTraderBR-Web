from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import VIRTUAL_SIM_NOTE_ID, VirtualSimNote
from ..orm import VirtualSimNoteORM

router = APIRouter(prefix="/api/virtual-sim", tags=["virtual-sim"])


class VirtualSimNoteUpdate(BaseModel):
    note_html: str


@router.get("/note", response_model=VirtualSimNote)
def get_virtual_sim_note(session: Session = Depends(get_session)) -> VirtualSimNote:
    row = session.get(VirtualSimNoteORM, VIRTUAL_SIM_NOTE_ID)
    if not row:
        raise HTTPException(404, "not found")
    return VirtualSimNote(id=row.id, note_html=row.note_html)


@router.patch("/note", response_model=VirtualSimNote)
def update_virtual_sim_note(
    payload: VirtualSimNoteUpdate, session: Session = Depends(get_session)
) -> VirtualSimNote:
    row = session.get(VirtualSimNoteORM, VIRTUAL_SIM_NOTE_ID)
    if not row:
        raise HTTPException(404, "not found")
    row.note_html = payload.note_html
    session.commit()
    session.refresh(row)
    return VirtualSimNote(id=row.id, note_html=row.note_html)
