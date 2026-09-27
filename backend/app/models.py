from __future__ import annotations

import time
import uuid
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

ROOT_CATEGORY_ID = "__ROOT__"
ROOT_STUDY_PLAN_ID = "__STUDY_ROOT__"
REMIND_NOTE_ID = "__REMIND__"


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


PAGE_KINDS = ("chart", "insight")


class Page(BaseModel):
    id: str
    item_id: str
    kind: Literal["chart", "insight"] = "chart"
    result: Literal["", "pass", "fail"] = ""
    ma_spacing: Literal["", "converge", "diverge"] = ""
    period_symmetry: Literal["", "after", "before"] = ""
    accumulation_checked: bool = False
    leading_span2: Literal["", "digested", "undigested"] = ""
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


class InsightEntry(BaseModel):
    """A read-only rollup row for the cross-item "인사이트 모아보기" feed."""

    page_id: str
    item_id: str
    item_name: str
    category_id: str
    category_path: str
    content_html: str
    updated_at: float
    image_a: Optional[ImageSlot] = None
    image_b: Optional[ImageSlot] = None
    result: Literal["", "pass", "fail"] = ""
    ma_spacing: Literal["", "converge", "diverge"] = ""
    period_symmetry: Literal["", "after", "before"] = ""
    accumulation_checked: bool = False
    leading_span2: Literal["", "digested", "undigested"] = ""


class Item(BaseModel):
    id: str
    name: str
    category_id: str
    page_ids: List[str] = Field(default_factory=list)
    description: str = ""


MAX_CATEGORY_URLS = 10


class Category(BaseModel):
    id: str
    name: str
    parent_id: Optional[str] = None
    child_ids: List[str] = Field(default_factory=list)
    item_ids: List[str] = Field(default_factory=list)
    urls: List[str] = Field(default_factory=list)
    note_html: str = ""


class Todo(BaseModel):
    id: str
    date: str  # "YYYY-MM-DD"
    text: str
    done: bool = False


class CodeInfo(BaseModel):
    id: str
    code: str
    description: str = ""
    created_at: float = Field(default_factory=now)


FORMULA_CATEGORIES = ("기술적지표", "신호검색", "강세약세")


class FormulaInfo(BaseModel):
    id: str
    category: str
    name: str
    content: str = ""
    created_at: float = Field(default_factory=now)


class RemindNote(BaseModel):
    """Single global note reviewed before trading — no list, just one block."""

    id: str
    note_html: str = ""


class RemindVideo(BaseModel):
    id: str
    title: str
    path: str
    created_at: float = Field(default_factory=now)


class RemindFolderVideo(BaseModel):
    """A video file found in the on-disk drop folder (not a DB row)."""

    name: str
    path: str
    size: int
    modified: float


class RemindFolder(BaseModel):
    folder: str
    videos: List[RemindFolderVideo] = Field(default_factory=list)


class OneMinNote(BaseModel):
    """A freeform 'My Insight' memo attached to either the PASS or FAIL
    column of the 1분봉 비교 page — an append-only running list, not tied to
    any single chart."""

    id: str
    column: Literal["pass", "fail"]
    text: str
    position: int = 0
    created_at: float = Field(default_factory=now)


class StudyPlanNode(BaseModel):
    """A single node in the study-plan tree. Unlike Category/Item, one node
    is both a container (can have children) and a content leaf (dates +
    result notes) at the same time — there's no separate "item" tier."""

    id: str
    name: str
    parent_id: Optional[str] = None
    child_ids: List[str] = Field(default_factory=list)
    start_date: Optional[str] = None  # "YYYY-MM-DD"
    end_date: Optional[str] = None  # "YYYY-MM-DD"
    result_html: str = ""
