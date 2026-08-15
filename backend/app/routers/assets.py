from __future__ import annotations

import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..crud import SLOT_PATH_ATTR, SLOT_STROKES_ATTR, page_to_api
from ..db import get_session
from ..models import IMAGE_SLOTS, Page, now
from ..orm import PageORM
from ..paths import ASSETS_DIR

router = APIRouter(prefix="/api/pages", tags=["assets"])

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}


@router.post("/{page_id}/image/{slot}", response_model=Page)
async def upload_image(
    page_id: str, slot: str, file: UploadFile = File(...), session: Session = Depends(get_session)
) -> Page:
    if slot not in IMAGE_SLOTS:
        raise HTTPException(400, f"slot must be one of {IMAGE_SLOTS}")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"unsupported file type: {ext}")
    content = await file.read()

    row = session.get(PageORM, page_id)
    if not row:
        raise HTTPException(404, "page not found")

    path_attr = SLOT_PATH_ATTR[slot]
    old_path = getattr(row, path_attr)

    item_dir = ASSETS_DIR / row.item_id
    item_dir.mkdir(parents=True, exist_ok=True)
    # Unique filename per upload (not just per page+slot) so a replaced
    # image gets a new URL — otherwise browsers keep serving the old
    # cached bytes for the same path after a re-upload/re-paste.
    filename = f"{page_id}_{slot}_{int(time.time() * 1000)}{ext}"
    dest = item_dir / filename
    dest.write_bytes(content)
    rel_path = f"{row.item_id}/{filename}"

    setattr(row, path_attr, rel_path)
    setattr(row, SLOT_STROKES_ATTR[slot], "[]")
    row.updated_at = now()
    session.commit()
    session.refresh(row)

    if old_path:
        (ASSETS_DIR / old_path).unlink(missing_ok=True)

    return page_to_api(row)


@router.delete("/{page_id}/image/{slot}", response_model=Page)
def delete_image(page_id: str, slot: str, session: Session = Depends(get_session)) -> Page:
    if slot not in IMAGE_SLOTS:
        raise HTTPException(400, f"slot must be one of {IMAGE_SLOTS}")
    row = session.get(PageORM, page_id)
    if not row:
        raise HTTPException(404, "page not found")

    path_attr = SLOT_PATH_ATTR[slot]
    old_path = getattr(row, path_attr)
    setattr(row, path_attr, None)
    setattr(row, SLOT_STROKES_ATTR[slot], "[]")
    row.updated_at = now()
    session.commit()
    session.refresh(row)

    if old_path:
        (ASSETS_DIR / old_path).unlink(missing_ok=True)

    return page_to_api(row)
