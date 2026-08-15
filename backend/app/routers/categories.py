from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import category_to_api, next_position
from ..db import get_session
from ..models import Category, MAX_CATEGORY_URLS, ROOT_CATEGORY_ID, new_id
from ..orm import CategoryORM, ItemORM

router = APIRouter(prefix="/api/categories", tags=["categories"])


class CategoryCreate(BaseModel):
    name: str
    parent_id: str = ROOT_CATEGORY_ID


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None
    urls: Optional[List[str]] = None


@router.get("", response_model=List[Category])
def list_categories(session: Session = Depends(get_session)) -> List[Category]:
    rows = session.query(CategoryORM).all()
    return [category_to_api(session, r) for r in rows]


@router.post("", response_model=Category)
def create_category(payload: CategoryCreate, session: Session = Depends(get_session)) -> Category:
    parent = session.get(CategoryORM, payload.parent_id)
    if not parent:
        raise HTTPException(404, "parent category not found")
    row = CategoryORM(
        id=new_id(),
        name=payload.name,
        parent_id=payload.parent_id,
        position=next_position(session, CategoryORM, parent_id=payload.parent_id),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return category_to_api(session, row)


@router.patch("/{category_id}", response_model=Category)
def update_category(category_id: str, payload: CategoryUpdate, session: Session = Depends(get_session)) -> Category:
    row = session.get(CategoryORM, category_id)
    if not row:
        raise HTTPException(404, "not found")
    if payload.name is not None:
        row.name = payload.name
    if payload.parent_id is not None and payload.parent_id != row.parent_id:
        new_parent = session.get(CategoryORM, payload.parent_id)
        if not new_parent:
            raise HTTPException(404, "parent category not found")
        row.parent_id = payload.parent_id
        row.position = next_position(session, CategoryORM, parent_id=payload.parent_id)
    if payload.urls is not None:
        if len(payload.urls) > MAX_CATEGORY_URLS:
            raise HTTPException(400, f"at most {MAX_CATEGORY_URLS} urls allowed")
        row.urls = json.dumps(payload.urls)
    session.commit()
    session.refresh(row)
    return category_to_api(session, row)


@router.delete("/{category_id}")
def delete_category(category_id: str, session: Session = Depends(get_session)) -> dict:
    if category_id == ROOT_CATEGORY_ID:
        raise HTTPException(400, "cannot delete root category")
    row = session.get(CategoryORM, category_id)
    if not row:
        raise HTTPException(404, "not found")
    has_children = session.query(CategoryORM).filter_by(parent_id=category_id).first() is not None
    has_items = session.query(ItemORM).filter_by(category_id=category_id).first() is not None
    if has_children or has_items:
        raise HTTPException(400, "category is not empty")
    session.delete(row)
    session.commit()
    return {"ok": True}
