from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException

from .. import content_backup

router = APIRouter(prefix="/api/backup", tags=["backup"])


@router.get("/status")
def backup_status() -> dict[str, Any]:
    return content_backup.status()


@router.post("/run")
def run_backup() -> dict[str, Any]:
    try:
        content_backup.run_backup("manual")
    except (content_backup.BackupError, OSError, sqlite3.Error) as exc:
        raise HTTPException(status_code=500, detail=f"백업 실패: {exc}") from exc
    return content_backup.status()
