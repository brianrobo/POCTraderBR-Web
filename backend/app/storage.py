from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Callable, Optional, TypeVar

from .models import DB

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
ASSETS_DIR = ROOT_DIR / "assets"
DB_PATH = DATA_DIR / "notes_db.json"
BACKUP_DIR = DATA_DIR / "backups"
MAX_BACKUPS = 10

T = TypeVar("T")


class Storage:
    """JSON-file-backed store, serialized by a single in-process lock.

    MVP scale (a handful of LAN clients) doesn't need a real database;
    the lock is what keeps concurrent writes from corrupting the file.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._db: Optional[DB] = None

    def _load(self) -> DB:
        if DB_PATH.exists():
            raw = json.loads(DB_PATH.read_text(encoding="utf-8"))
            return DB.model_validate(raw)
        return DB.new()

    def _backup(self) -> None:
        if not DB_PATH.exists():
            return
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        stamp = int(time.time() * 1000)
        target = BACKUP_DIR / f"notes_db_backup_{stamp}.json"
        target.write_bytes(DB_PATH.read_bytes())
        backups = sorted(
            BACKUP_DIR.glob("notes_db_backup_*.json"), key=lambda p: p.stat().st_mtime
        )
        for old in backups[:-MAX_BACKUPS]:
            old.unlink(missing_ok=True)

    def _save(self, db: DB) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._backup()
        DB_PATH.write_text(db.model_dump_json(indent=2), encoding="utf-8")

    async def get(self) -> DB:
        async with self._lock:
            if self._db is None:
                self._db = self._load()
            return self._db.model_copy(deep=True)

    async def mutate(self, fn: Callable[[DB], T]) -> T:
        """Run fn(db) under the lock, persist, and return fn's result."""
        async with self._lock:
            if self._db is None:
                self._db = self._load()
            result = fn(self._db)
            self._save(self._db)
            return result


storage = Storage()
