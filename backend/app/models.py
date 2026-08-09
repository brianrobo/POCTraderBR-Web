from __future__ import annotations

import time
import uuid
from typing import Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

ROOT_CATEGORY_ID = "__ROOT__"


def new_id() -> str:
    return str(uuid.uuid4())


def now() -> float:
    return time.time()


class Stroke(BaseModel):
    color: str = "#222222"
    width: float = 3.0
    points: List[Tuple[float, float]] = Field(default_factory=list)


class ImageSlot(BaseModel):
    path: str
    strokes: List[Stroke] = Field(default_factory=list)


class Page(BaseModel):
    id: str
    item_id: str
    note_html: str = ""
    updated_at: float = Field(default_factory=now)
    image_a: Optional[ImageSlot] = None
    image_b: Optional[ImageSlot] = None


class Item(BaseModel):
    id: str
    name: str
    category_id: str
    page_ids: List[str] = Field(default_factory=list)


class Category(BaseModel):
    id: str
    name: str
    parent_id: Optional[str] = None
    child_ids: List[str] = Field(default_factory=list)
    item_ids: List[str] = Field(default_factory=list)


class DB(BaseModel):
    categories: Dict[str, Category] = Field(default_factory=dict)
    items: Dict[str, Item] = Field(default_factory=dict)
    pages: Dict[str, Page] = Field(default_factory=dict)

    @staticmethod
    def new() -> "DB":
        root = Category(id=ROOT_CATEGORY_ID, name="Root", parent_id=None)
        return DB(categories={ROOT_CATEGORY_ID: root})
