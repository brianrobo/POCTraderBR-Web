from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .db import Base, SessionLocal, engine
from .models import ROOT_CATEGORY_ID
from .orm import CategoryORM
from .paths import ASSETS_DIR, DATA_DIR
from .routers import assets, categories, items, pages

ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"

DATA_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

Base.metadata.create_all(bind=engine)

with SessionLocal() as _session:
    if _session.get(CategoryORM, ROOT_CATEGORY_ID) is None:
        _session.add(CategoryORM(id=ROOT_CATEGORY_ID, name="Root", parent_id=None, position=0))
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

app.mount("/uploads", StaticFiles(directory=str(ASSETS_DIR)), name="uploads")

# In production the frontend is built and served by this same process/port,
# so the LAN deployment is a single uvicorn process on one port.
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
