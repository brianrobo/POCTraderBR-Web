from __future__ import annotations

import time
import uuid
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

ROOT_CATEGORY_ID = "__ROOT__"


def new_id() -> str:
    return str(uuid.uuid4())


def now() -> float:
    return time.time()


class Stroke(BaseModel):
    """A single chart annotation — either a freehand path or a text label.

    Both kinds share one list per image slot; `kind` tells them apart.
    Old stored data has no `kind` key, which defaults to "path" so it
    keeps loading unchanged.
    """

    kind: Literal["path", "text"] = "path"
    color: str = "#222222"
    width: float = 3.0
    points: List[Tuple[float, float]] = Field(default_factory=list)
    text: str = ""
    font_size: float = 20.0
    x: float = 0.0
    y: float = 0.0


class ImageSlot(BaseModel):
    path: str
    strokes: List[Stroke] = Field(default_factory=list)


IMAGE_SLOTS = ("a", "a2", "b", "b2")
LAYOUTS = ("2", "4")


class Page(BaseModel):
    id: str
    item_id: str
    note_html_a: str = ""
    note_html_b: str = ""
    updated_at: float = Field(default_factory=now)
    layout: str = "2"
    image_a: Optional[ImageSlot] = None
    image_a2: Optional[ImageSlot] = None
    image_b: Optional[ImageSlot] = None
    image_b2: Optional[ImageSlot] = None
    stock_name_a: str = ""
    stock_name_a2: str = ""
    stock_name_b: str = ""
    stock_name_b2: str = ""


class Item(BaseModel):
    id: str
    name: str
    category_id: str
    page_ids: List[str] = Field(default_factory=list)


MAX_CATEGORY_URLS = 10


class Category(BaseModel):
    id: str
    name: str
    parent_id: Optional[str] = None
    child_ids: List[str] = Field(default_factory=list)
    item_ids: List[str] = Field(default_factory=list)
    urls: List[str] = Field(default_factory=list)
