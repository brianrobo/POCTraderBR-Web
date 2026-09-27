from __future__ import annotations

import json
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import SLOT_PATH_ATTR, SLOT_STROKES_ATTR, next_position, page_to_api
from ..db import get_session
from ..models import IMAGE_SLOTS, LAYOUTS, ROOT_CATEGORY_ID, InsightEntry, Page, Stroke, new_id, now
from ..orm import CategoryORM, ItemORM, PageORM

router = APIRouter(prefix="/api/pages", tags=["pages"])


class PageCreate(BaseModel):
    item_id: str
    kind: Literal["chart", "insight"] = "chart"


class PageUpdate(BaseModel):
    result: Optional[Literal["", "pass", "fail"]] = None
    ma_spacing: Optional[Literal["", "converge", "diverge"]] = None
    period_symmetry: Optional[Literal["", "after", "before"]] = None
    accumulation_checked: Optional[bool] = None
    leading_span2: Optional[Literal["", "digested", "undigested"]] = None
    note_html_a: Optional[str] = None
    note_html_b: Optional[str] = None
    layout: Optional[str] = None
    stock_name_a: Optional[str] = None
    stock_name_a2: Optional[str] = None
    stock_name_b: Optional[str] = None
    stock_name_b2: Optional[str] = None


class StrokesUpdate(BaseModel):
    strokes: List[Stroke]


@router.get("", response_model=List[Page])
def list_pages(item_id: Optional[str] = None, session: Session = Depends(get_session)) -> List[Page]:
    q = session.query(PageORM)
    if item_id:
        q = q.filter_by(item_id=item_id)
    return [page_to_api(r) for r in q.order_by(PageORM.position).all()]


def _category_path(session: Session, category_id: Optional[str]) -> str:
    names: List[str] = []
    current_id = category_id
    seen: set[str] = set()
    while current_id and current_id not in seen and current_id != ROOT_CATEGORY_ID:
        seen.add(current_id)
        cat = session.get(CategoryORM, current_id)
        if not cat:
            break
        names.append(cat.name)
        current_id = cat.parent_id
    return " > ".join(reversed(names))


@router.get("/insights", response_model=List[InsightEntry])
def list_insights(session: Session = Depends(get_session)) -> List[InsightEntry]:
    rows = (
        session.query(PageORM)
        .filter_by(kind="insight")
        .order_by(PageORM.updated_at.desc())
        .all()
    )
    entries: List[InsightEntry] = []
    for row in rows:
        item = session.get(ItemORM, row.item_id)
        if not item:
            continue
        page = page_to_api(row)
        entries.append(
            InsightEntry(
                page_id=row.id,
                item_id=item.id,
                item_name=item.name,
                category_id=item.category_id,
                category_path=_category_path(session, item.category_id),
                content_html=row.note_html_a,
                updated_at=row.updated_at,
                image_a=page.image_a,
                image_b=page.image_b,
                result=page.result,
                ma_spacing=page.ma_spacing,
                period_symmetry=page.period_symmetry,
                accumulation_checked=page.accumulation_checked,
                leading_span2=page.leading_span2,
            )
        )
    return entries


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
        kind=payload.kind,
        position=next_position(session, PageORM, item_id=payload.item_id),
        note_html_a="",
        note_html_b="",
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
    if payload.result is not None:
        row.result = payload.result
    if payload.ma_spacing is not None:
        row.ma_spacing = payload.ma_spacing
    if payload.period_symmetry is not None:
        row.period_symmetry = payload.period_symmetry
    if payload.accumulation_checked is not None:
        row.accumulation_checked = payload.accumulation_checked
    if payload.leading_span2 is not None:
        row.leading_span2 = payload.leading_span2
    if payload.note_html_a is not None:
        row.note_html_a = payload.note_html_a
    if payload.note_html_b is not None:
        row.note_html_b = payload.note_html_b
    if payload.layout is not None and payload.layout != row.layout:
        if payload.layout not in LAYOUTS:
            raise HTTPException(400, f"layout must be one of {LAYOUTS}")
        if payload.layout == "2" and (row.image_a2_path or row.image_b2_path):
            raise HTTPException(
                400, "하단 이미지(A2/B2)를 먼저 삭제해야 2단 레이아웃으로 전환할 수 있습니다"
            )
        row.layout = payload.layout
    if payload.stock_name_a is not None:
        row.stock_name_a = payload.stock_name_a
    if payload.stock_name_a2 is not None:
        row.stock_name_a2 = payload.stock_name_a2
    if payload.stock_name_b is not None:
        row.stock_name_b = payload.stock_name_b
    if payload.stock_name_b2 is not None:
        row.stock_name_b2 = payload.stock_name_b2
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
    if slot not in IMAGE_SLOTS:
        raise HTTPException(400, f"slot must be one of {IMAGE_SLOTS}")
    row = session.get(PageORM, page_id)
    if not row:
        raise HTTPException(404, "not found")
    path_attr = SLOT_PATH_ATTR[slot]
    if not getattr(row, path_attr):
        raise HTTPException(400, "no image uploaded for this slot")
    strokes_json = json.dumps([s.model_dump() for s in payload.strokes])
    setattr(row, SLOT_STROKES_ATTR[slot], strokes_json)
    row.updated_at = now()
    session.commit()
    session.refresh(row)
    return page_to_api(row)
