from __future__ import annotations

from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import next_position, remind_video_to_api
from ..db import get_session
from ..models import REMIND_NOTE_ID, RemindFolder, RemindFolderVideo, RemindNote, RemindVideo, new_id, now
from ..orm import RemindNoteORM, RemindVideoORM
from ..paths import ASSETS_DIR, REMIND_VIDEO_DIR

router = APIRouter(prefix="/api/remind", tags=["remind"])

ALLOWED_VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v", ".ogg"}
REMIND_ASSETS_DIR = ASSETS_DIR / "remind"


class RemindNoteUpdate(BaseModel):
    note_html: str


class RemindVideoUpdate(BaseModel):
    title: str


@router.get("/note", response_model=RemindNote)
def get_remind_note(session: Session = Depends(get_session)) -> RemindNote:
    row = session.get(RemindNoteORM, REMIND_NOTE_ID)
    if not row:
        raise HTTPException(404, "not found")
    return RemindNote(id=row.id, note_html=row.note_html)


@router.patch("/note", response_model=RemindNote)
def update_remind_note(payload: RemindNoteUpdate, session: Session = Depends(get_session)) -> RemindNote:
    row = session.get(RemindNoteORM, REMIND_NOTE_ID)
    if not row:
        raise HTTPException(404, "not found")
    row.note_html = payload.note_html
    session.commit()
    session.refresh(row)
    return RemindNote(id=row.id, note_html=row.note_html)


@router.get("/folder", response_model=RemindFolder)
def list_remind_folder() -> RemindFolder:
    REMIND_VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    files = [
        p
        for p in REMIND_VIDEO_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in ALLOWED_VIDEO_EXT and not p.name.startswith(".")
    ]
    files.sort(key=lambda p: p.name.lower())
    return RemindFolder(
        folder=str(REMIND_VIDEO_DIR),
        videos=[
            RemindFolderVideo(
                name=p.name,
                path=f"{REMIND_VIDEO_DIR.name}/{p.name}",
                size=p.stat().st_size,
                modified=p.stat().st_mtime,
            )
            for p in files
        ],
    )


@router.get("/videos", response_model=List[RemindVideo])
def list_remind_videos(session: Session = Depends(get_session)) -> List[RemindVideo]:
    rows = session.query(RemindVideoORM).order_by(RemindVideoORM.position).all()
    return [remind_video_to_api(r) for r in rows]


@router.post("/videos", response_model=RemindVideo)
async def upload_remind_video(
    title: str = Form(...), file: UploadFile = File(...), session: Session = Depends(get_session)
) -> RemindVideo:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_VIDEO_EXT:
        raise HTTPException(400, f"unsupported file type: {ext}")
    content = await file.read()

    REMIND_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{new_id()}{ext}"
    dest = REMIND_ASSETS_DIR / filename
    dest.write_bytes(content)

    row = RemindVideoORM(
        id=new_id(),
        title=title,
        path=f"remind/{filename}",
        position=next_position(session, RemindVideoORM),
        created_at=now(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return remind_video_to_api(row)


@router.patch("/videos/{video_id}", response_model=RemindVideo)
def rename_remind_video(
    video_id: str, payload: RemindVideoUpdate, session: Session = Depends(get_session)
) -> RemindVideo:
    row = session.get(RemindVideoORM, video_id)
    if not row:
        raise HTTPException(404, "not found")
    row.title = payload.title
    session.commit()
    session.refresh(row)
    return remind_video_to_api(row)


@router.delete("/videos/{video_id}")
def delete_remind_video(video_id: str, session: Session = Depends(get_session)) -> dict:
    row = session.get(RemindVideoORM, video_id)
    if not row:
        raise HTTPException(404, "not found")
    (ASSETS_DIR / row.path).unlink(missing_ok=True)
    session.delete(row)
    session.commit()
    return {"ok": True}
