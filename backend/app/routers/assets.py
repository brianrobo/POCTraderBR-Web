from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..models import ImageSlot, Page, now
from ..storage import ASSETS_DIR, storage

router = APIRouter(prefix="/api/pages", tags=["assets"])

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}


@router.post("/{page_id}/image/{slot}", response_model=Page)
async def upload_image(page_id: str, slot: str, file: UploadFile = File(...)) -> Page:
    if slot not in ("a", "b"):
        raise HTTPException(400, "slot must be 'a' or 'b'")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"unsupported file type: {ext}")
    content = await file.read()

    def fn(db):
        page = db.pages.get(page_id)
        if not page:
            raise HTTPException(404, "page not found")
        item_dir = ASSETS_DIR / page.item_id
        item_dir.mkdir(parents=True, exist_ok=True)
        dest = item_dir / f"{page_id}_{slot}{ext}"
        dest.write_bytes(content)
        rel_path = f"{page.item_id}/{page_id}_{slot}{ext}"
        slot_obj = ImageSlot(path=rel_path, strokes=[])
        if slot == "a":
            page.image_a = slot_obj
        else:
            page.image_b = slot_obj
        page.updated_at = now()
        return page

    return await storage.mutate(fn)
