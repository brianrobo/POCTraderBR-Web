from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import item_to_api, next_position
from ..db import get_session
from ..models import Item, new_id
from ..orm import CategoryORM, ItemORM, PageORM

router = APIRouter(prefix="/api/items", tags=["items"])


class ItemCreate(BaseModel):
    name: str
    category_id: str


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[str] = None


class ItemMove(BaseModel):
    direction: Literal["up", "down"]


@router.get("", response_model=List[Item])
def list_items(session: Session = Depends(get_session)) -> List[Item]:
    rows = session.query(ItemORM).all()
    return [item_to_api(session, r) for r in rows]


@router.post("", response_model=Item)
def create_item(payload: ItemCreate, session: Session = Depends(get_session)) -> Item:
    cat = session.get(CategoryORM, payload.category_id)
    if not cat:
        raise HTTPException(404, "category not found")
    row = ItemORM(
        id=new_id(),
        name=payload.name,
        category_id=payload.category_id,
        position=next_position(session, ItemORM, category_id=payload.category_id),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return item_to_api(session, row)


@router.patch("/{item_id}", response_model=Item)
def update_item(item_id: str, payload: ItemUpdate, session: Session = Depends(get_session)) -> Item:
    row = session.get(ItemORM, item_id)
    if not row:
        raise HTTPException(404, "not found")
    if payload.name is not None:
        row.name = payload.name
    if payload.category_id is not None and payload.category_id != row.category_id:
        cat = session.get(CategoryORM, payload.category_id)
        if not cat:
            raise HTTPException(404, "category not found")
        row.category_id = payload.category_id
        row.position = next_position(session, ItemORM, category_id=payload.category_id)
    session.commit()
    session.refresh(row)
    return item_to_api(session, row)


@router.post("/{item_id}/move")
def move_item(item_id: str, payload: ItemMove, session: Session = Depends(get_session)) -> dict:
    row = session.get(ItemORM, item_id)
    if not row:
        raise HTTPException(404, "not found")
    siblings = (
        session.query(ItemORM).filter_by(category_id=row.category_id).order_by(ItemORM.position).all()
    )
    idx = next(i for i, s in enumerate(siblings) if s.id == item_id)
    swap_idx = idx - 1 if payload.direction == "up" else idx + 1
    if 0 <= swap_idx < len(siblings):
        other = siblings[swap_idx]
        row.position, other.position = other.position, row.position
        session.commit()
    return {"ok": True}


@router.delete("/{item_id}")
def delete_item(item_id: str, session: Session = Depends(get_session)) -> dict:
    row = session.get(ItemORM, item_id)
    if not row:
        raise HTTPException(404, "not found")
    session.query(PageORM).filter_by(item_id=item_id).delete()
    session.delete(row)
    session.commit()
    return {"ok": True}
