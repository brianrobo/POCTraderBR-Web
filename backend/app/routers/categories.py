from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..models import Category, ROOT_CATEGORY_ID, new_id
from ..storage import storage

router = APIRouter(prefix="/api/categories", tags=["categories"])


class CategoryCreate(BaseModel):
    name: str
    parent_id: str = ROOT_CATEGORY_ID


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None


@router.get("", response_model=List[Category])
async def list_categories() -> List[Category]:
    db = await storage.get()
    return list(db.categories.values())


@router.post("", response_model=Category)
async def create_category(payload: CategoryCreate) -> Category:
    def fn(db):
        if payload.parent_id not in db.categories:
            raise HTTPException(404, "parent category not found")
        cat = Category(id=new_id(), name=payload.name, parent_id=payload.parent_id)
        db.categories[cat.id] = cat
        db.categories[payload.parent_id].child_ids.append(cat.id)
        return cat

    return await storage.mutate(fn)


@router.patch("/{category_id}", response_model=Category)
async def update_category(category_id: str, payload: CategoryUpdate) -> Category:
    def fn(db):
        cat = db.categories.get(category_id)
        if not cat:
            raise HTTPException(404, "not found")
        if payload.name is not None:
            cat.name = payload.name
        if payload.parent_id is not None and payload.parent_id != cat.parent_id:
            if payload.parent_id not in db.categories:
                raise HTTPException(404, "parent category not found")
            if cat.parent_id and cat.id in db.categories[cat.parent_id].child_ids:
                db.categories[cat.parent_id].child_ids.remove(cat.id)
            cat.parent_id = payload.parent_id
            db.categories[payload.parent_id].child_ids.append(cat.id)
        return cat

    return await storage.mutate(fn)


@router.delete("/{category_id}")
async def delete_category(category_id: str) -> dict:
    if category_id == ROOT_CATEGORY_ID:
        raise HTTPException(400, "cannot delete root category")

    def fn(db):
        cat = db.categories.get(category_id)
        if not cat:
            raise HTTPException(404, "not found")
        if cat.child_ids or cat.item_ids:
            raise HTTPException(400, "category is not empty")
        if cat.parent_id and cat.id in db.categories[cat.parent_id].child_ids:
            db.categories[cat.parent_id].child_ids.remove(cat.id)
        del db.categories[category_id]
        return {"ok": True}

    return await storage.mutate(fn)
