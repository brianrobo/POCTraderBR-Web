from __future__ import annotations

import json
import time
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import next_position
from ..db import get_session
from ..models import ChartPattern, new_id, now
from ..orm import ChartPatternORM
from ..paths import ASSETS_DIR

router = APIRouter(prefix="/api/chart-patterns", tags=["chart-patterns"])

PATTERN_ASSETS_DIR = ASSETS_DIR / "chart_patterns"
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}


class ChartPatternCreate(BaseModel):
    name: str
    pdf_group: str = ""


class ChartPatternUpdate(BaseModel):
    name: Optional[str] = None
    pdf_group: Optional[str] = None
    notes_html: Optional[str] = None


def _to_api(row: ChartPatternORM) -> ChartPattern:
    return ChartPattern(
        id=row.id,
        name=row.name,
        pdf_group=row.pdf_group,
        position=row.position,
        concept_image_url=f"/uploads/{row.concept_image_path}" if row.concept_image_path else None,
        example_image_urls=[f"/uploads/{p}" for p in json.loads(row.example_image_paths or "[]")],
        notes_html=row.notes_html,
        created_at=row.created_at,
    )


def _require(session: Session, pattern_id: str) -> ChartPatternORM:
    row = session.get(ChartPatternORM, pattern_id)
    if not row:
        raise HTTPException(404, "not found")
    return row


@router.get("", response_model=List[ChartPattern])
def list_chart_patterns(session: Session = Depends(get_session)) -> List[ChartPattern]:
    rows = session.query(ChartPatternORM).order_by(ChartPatternORM.position).all()
    return [_to_api(r) for r in rows]


@router.post("", response_model=ChartPattern)
def create_chart_pattern(payload: ChartPatternCreate, session: Session = Depends(get_session)) -> ChartPattern:
    row = ChartPatternORM(
        id=new_id(),
        name=payload.name,
        pdf_group=payload.pdf_group,
        position=next_position(session, ChartPatternORM),
        created_at=now(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _to_api(row)


@router.get("/{pattern_id}", response_model=ChartPattern)
def get_chart_pattern(pattern_id: str, session: Session = Depends(get_session)) -> ChartPattern:
    return _to_api(_require(session, pattern_id))


@router.patch("/{pattern_id}", response_model=ChartPattern)
def update_chart_pattern(
    pattern_id: str, payload: ChartPatternUpdate, session: Session = Depends(get_session)
) -> ChartPattern:
    row = _require(session, pattern_id)
    if payload.name is not None:
        row.name = payload.name
    if payload.pdf_group is not None:
        row.pdf_group = payload.pdf_group
    if payload.notes_html is not None:
        row.notes_html = payload.notes_html
    session.commit()
    session.refresh(row)
    return _to_api(row)


@router.delete("/{pattern_id}")
def delete_chart_pattern(pattern_id: str, session: Session = Depends(get_session)) -> dict:
    row = _require(session, pattern_id)
    if row.concept_image_path:
        (ASSETS_DIR / row.concept_image_path).unlink(missing_ok=True)
    for p in json.loads(row.example_image_paths or "[]"):
        (ASSETS_DIR / p).unlink(missing_ok=True)
    session.delete(row)
    session.commit()
    return {"ok": True}


def _save_upload(pattern_id: str, file: UploadFile, content: bytes) -> str:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(400, f"unsupported file type: {ext}")
    pattern_dir = PATTERN_ASSETS_DIR / pattern_id
    pattern_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{new_id()}_{int(time.time() * 1000)}{ext}"
    (pattern_dir / filename).write_bytes(content)
    return f"chart_patterns/{pattern_id}/{filename}"


@router.post("/{pattern_id}/concept-image", response_model=ChartPattern)
async def upload_concept_image(
    pattern_id: str, file: UploadFile = File(...), session: Session = Depends(get_session)
) -> ChartPattern:
    row = _require(session, pattern_id)
    content = await file.read()
    rel_path = _save_upload(pattern_id, file, content)
    old_path = row.concept_image_path
    row.concept_image_path = rel_path
    session.commit()
    session.refresh(row)
    if old_path:
        (ASSETS_DIR / old_path).unlink(missing_ok=True)
    return _to_api(row)


@router.delete("/{pattern_id}/concept-image", response_model=ChartPattern)
def delete_concept_image(pattern_id: str, session: Session = Depends(get_session)) -> ChartPattern:
    row = _require(session, pattern_id)
    old_path = row.concept_image_path
    row.concept_image_path = None
    session.commit()
    session.refresh(row)
    if old_path:
        (ASSETS_DIR / old_path).unlink(missing_ok=True)
    return _to_api(row)


@router.post("/{pattern_id}/examples", response_model=ChartPattern)
async def add_example_image(
    pattern_id: str, file: UploadFile = File(...), session: Session = Depends(get_session)
) -> ChartPattern:
    row = _require(session, pattern_id)
    content = await file.read()
    rel_path = _save_upload(pattern_id, file, content)
    paths = json.loads(row.example_image_paths or "[]")
    paths.append(rel_path)
    row.example_image_paths = json.dumps(paths)
    session.commit()
    session.refresh(row)
    return _to_api(row)


@router.delete("/{pattern_id}/examples/{index}", response_model=ChartPattern)
def delete_example_image(pattern_id: str, index: int, session: Session = Depends(get_session)) -> ChartPattern:
    row = _require(session, pattern_id)
    paths = json.loads(row.example_image_paths or "[]")
    if index < 0 or index >= len(paths):
        raise HTTPException(404, "example not found")
    removed = paths.pop(index)
    row.example_image_paths = json.dumps(paths)
    session.commit()
    session.refresh(row)
    (ASSETS_DIR / removed).unlink(missing_ok=True)
    return _to_api(row)
