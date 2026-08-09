from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..models import Page, Stroke, new_id, now
from ..storage import storage

router = APIRouter(prefix="/api/pages", tags=["pages"])


class PageCreate(BaseModel):
    item_id: str


class PageUpdate(BaseModel):
    note_html: Optional[str] = None


class StrokesUpdate(BaseModel):
    strokes: List[Stroke]


@router.get("", response_model=List[Page])
async def list_pages(item_id: Optional[str] = None) -> List[Page]:
    db = await storage.get()
    pages = list(db.pages.values())
    if item_id:
        pages = [p for p in pages if p.item_id == item_id]
    return pages


@router.get("/{page_id}", response_model=Page)
async def get_page(page_id: str) -> Page:
    db = await storage.get()
    page = db.pages.get(page_id)
    if not page:
        raise HTTPException(404, "not found")
    return page


@router.post("", response_model=Page)
async def create_page(payload: PageCreate) -> Page:
    def fn(db):
        item = db.items.get(payload.item_id)
        if not item:
            raise HTTPException(404, "item not found")
        page = Page(id=new_id(), item_id=payload.item_id)
        db.pages[page.id] = page
        item.page_ids.append(page.id)
        return page

    return await storage.mutate(fn)


@router.patch("/{page_id}", response_model=Page)
async def update_page(page_id: str, payload: PageUpdate) -> Page:
    def fn(db):
        page = db.pages.get(page_id)
        if not page:
            raise HTTPException(404, "not found")
        if payload.note_html is not None:
            page.note_html = payload.note_html
        page.updated_at = now()
        return page

    return await storage.mutate(fn)


@router.delete("/{page_id}")
async def delete_page(page_id: str) -> dict:
    def fn(db):
        page = db.pages.get(page_id)
        if not page:
            raise HTTPException(404, "not found")
        item = db.items.get(page.item_id)
        if item and page_id in item.page_ids:
            item.page_ids.remove(page_id)
        del db.pages[page_id]
        return {"ok": True}

    return await storage.mutate(fn)


@router.put("/{page_id}/strokes/{slot}", response_model=Page)
async def update_strokes(page_id: str, slot: str, payload: StrokesUpdate) -> Page:
    if slot not in ("a", "b"):
        raise HTTPException(400, "slot must be 'a' or 'b'")

    def fn(db):
        page = db.pages.get(page_id)
        if not page:
            raise HTTPException(404, "not found")
        image_slot = page.image_a if slot == "a" else page.image_b
        if not image_slot:
            raise HTTPException(400, "no image uploaded for this slot")
        image_slot.strokes = payload.strokes
        page.updated_at = now()
        return page

    return await storage.mutate(fn)
