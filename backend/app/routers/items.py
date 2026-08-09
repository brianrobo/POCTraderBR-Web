from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..models import Item, new_id
from ..storage import storage

router = APIRouter(prefix="/api/items", tags=["items"])


class ItemCreate(BaseModel):
    name: str
    category_id: str


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[str] = None


@router.get("", response_model=List[Item])
async def list_items() -> List[Item]:
    db = await storage.get()
    return list(db.items.values())


@router.post("", response_model=Item)
async def create_item(payload: ItemCreate) -> Item:
    def fn(db):
        if payload.category_id not in db.categories:
            raise HTTPException(404, "category not found")
        item = Item(id=new_id(), name=payload.name, category_id=payload.category_id)
        db.items[item.id] = item
        db.categories[payload.category_id].item_ids.append(item.id)
        return item

    return await storage.mutate(fn)


@router.patch("/{item_id}", response_model=Item)
async def update_item(item_id: str, payload: ItemUpdate) -> Item:
    def fn(db):
        item = db.items.get(item_id)
        if not item:
            raise HTTPException(404, "not found")
        if payload.name is not None:
            item.name = payload.name
        if payload.category_id is not None and payload.category_id != item.category_id:
            if payload.category_id not in db.categories:
                raise HTTPException(404, "category not found")
            old_cat = db.categories.get(item.category_id)
            if old_cat and item.id in old_cat.item_ids:
                old_cat.item_ids.remove(item.id)
            item.category_id = payload.category_id
            db.categories[payload.category_id].item_ids.append(item.id)
        return item

    return await storage.mutate(fn)


@router.delete("/{item_id}")
async def delete_item(item_id: str) -> dict:
    def fn(db):
        item = db.items.get(item_id)
        if not item:
            raise HTTPException(404, "not found")
        cat = db.categories.get(item.category_id)
        if cat and item_id in cat.item_ids:
            cat.item_ids.remove(item_id)
        for page_id in list(item.page_ids):
            db.pages.pop(page_id, None)
        del db.items[item_id]
        return {"ok": True}

    return await storage.mutate(fn)
