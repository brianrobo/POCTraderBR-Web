from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import next_position, page_to_api
from ..db import get_session
from ..models import Page, Stroke, new_id, now
from ..orm import ItemORM, PageORM

router = APIRouter(prefix="/api/pages", tags=["pages"])


class PageCreate(BaseModel):
    item_id: str


class PageUpdate(BaseModel):
    note_html: Optional[str] = None


class StrokesUpdate(BaseModel):
    strokes: List[Stroke]


@router.get("", response_model=List[Page])
def list_pages(item_id: Optional[str] = None, session: Session = Depends(get_session)) -> List[Page]:
    q = session.query(PageORM)
    if item_id:
        q = q.filter_by(item_id=item_id)
    return [page_to_api(r) for r in q.order_by(PageORM.position).all()]


@router.get("/{page_id}", response_model=Page)
def get_page(page_id: str, session: Session = Depends(get_session)) -> Page:
    row = session.get(PageORM, page_id)
    if not row:
        raise HTTPException(404, "not found")
    return page_to_api(row)


@router.post("", response_model=Page)
def create_page(payload: PageCreate, session: Session = Depends(get_session)) -> Page:
    item = session.get(ItemORM, payload.item_id)
    if not item:
        raise HTTPException(404, "item not found")
    row = PageORM(
        id=new_id(),
        item_id=payload.item_id,
        position=next_position(session, PageORM, item_id=payload.item_id),
        note_html="",
        updated_at=now(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return page_to_api(row)


@router.patch("/{page_id}", response_model=Page)
def update_page(page_id: str, payload: PageUpdate, session: Session = Depends(get_session)) -> Page:
    row = session.get(PageORM, page_id)
    if not row:
        raise HTTPException(404, "not found")
    if payload.note_html is not None:
        row.note_html = payload.note_html
    row.updated_at = now()
    session.commit()
    session.refresh(row)
    return page_to_api(row)


@router.delete("/{page_id}")
def delete_page(page_id: str, session: Session = Depends(get_session)) -> dict:
    row = session.get(PageORM, page_id)
    if not row:
        raise HTTPException(404, "not found")
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.put("/{page_id}/strokes/{slot}", response_model=Page)
def update_strokes(
    page_id: str, slot: str, payload: StrokesUpdate, session: Session = Depends(get_session)
) -> Page:
    if slot not in ("a", "b"):
        raise HTTPException(400, "slot must be 'a' or 'b'")
    row = session.get(PageORM, page_id)
    if not row:
        raise HTTPException(404, "not found")
    path = row.image_a_path if slot == "a" else row.image_b_path
    if not path:
        raise HTTPException(400, "no image uploaded for this slot")
    strokes_json = json.dumps([s.model_dump() for s in payload.strokes])
    if slot == "a":
        row.image_a_strokes = strokes_json
    else:
        row.image_b_strokes = strokes_json
    row.updated_at = now()
    session.commit()
    session.refresh(row)
    return page_to_api(row)
