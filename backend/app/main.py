from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import content_backup
from .db import SessionLocal, ensure_schema
from .models import (
    BUY_CHECKLIST_SETTINGS_ID,
    REMIND_NOTE_ID,
    ROOT_CATEGORY_ID,
    ROOT_STUDY_PLAN_ID,
)
from .orm import BuyChecklistSettingsORM, CategoryORM, RemindNoteORM, StudyPlanNodeORM
from .paths import ASSETS_DIR, DATA_DIR, REMIND_VIDEO_DIR
from .routers import (
    assets,
    backup,
    buy_checklist,
    categories,
    chart_patterns,
    insights,
    items,
    one_min_notes,
    pages,
    remind,
    reference,
    sim,
    study_plan,
    todos,
)

ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"

DATA_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
REMIND_VIDEO_DIR.mkdir(parents=True, exist_ok=True)

ensure_schema()

with SessionLocal() as _session:
    if _session.get(CategoryORM, ROOT_CATEGORY_ID) is None:
        _session.add(CategoryORM(id=ROOT_CATEGORY_ID, name="Root", parent_id=None, position=0))
        _session.commit()
    if _session.get(StudyPlanNodeORM, ROOT_STUDY_PLAN_ID) is None:
        _session.add(StudyPlanNodeORM(id=ROOT_STUDY_PLAN_ID, name="학습 계획", parent_id=None, position=0))
        _session.commit()
    if _session.get(RemindNoteORM, REMIND_NOTE_ID) is None:
        _session.add(RemindNoteORM(id=REMIND_NOTE_ID, note_html=""))
        _session.commit()
    if _session.get(BuyChecklistSettingsORM, BUY_CHECKLIST_SETTINGS_ID) is None:
        _session.add(BuyChecklistSettingsORM(id=BUY_CHECKLIST_SETTINGS_ID, descriptions_json="{}"))
        _session.commit()

app = FastAPI(title="POCTraderBR Web")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(categories.router)
app.include_router(items.router)
app.include_router(pages.router)
app.include_router(assets.router)
app.include_router(todos.router)
app.include_router(reference.router)
app.include_router(study_plan.router)
app.include_router(remind.router)
app.include_router(one_min_notes.router)
app.include_router(buy_checklist.router)
app.include_router(sim.router)
app.include_router(insights.router)
app.include_router(chart_patterns.router)
app.include_router(backup.router)

# The content is kept only on this PC (not on GitHub), so the server itself
# keeps a daily copy of it on another drive.
content_backup.start_auto_backup()

app.mount("/uploads", StaticFiles(directory=str(ASSETS_DIR)), name="uploads")

# In production the frontend is built and served by this same process/port,
# so the LAN deployment is a single uvicorn process on one port.
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
