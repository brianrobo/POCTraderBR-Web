from __future__ import annotations

import json
from typing import Optional, Type

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Category, ImageSlot, Item, Page, Stroke, Todo
from .orm import CategoryORM, ItemORM, PageORM, TodoORM


def category_to_api(session: Session, row: CategoryORM) -> Category:
    child_ids = list(
        session.execute(
            select(CategoryORM.id).where(CategoryORM.parent_id == row.id).order_by(CategoryORM.position)
        ).scalars()
    )
    item_ids = list(
        session.execute(
            select(ItemORM.id).where(ItemORM.category_id == row.id).order_by(ItemORM.position)
        ).scalars()
    )
    return Category(
        id=row.id,
        name=row.name,
        parent_id=row.parent_id,
        child_ids=child_ids,
        item_ids=item_ids,
        urls=json.loads(row.urls),
        note_html=row.note_html,
    )


def item_to_api(session: Session, row: ItemORM) -> Item:
    page_ids = list(
        session.execute(select(PageORM.id).where(PageORM.item_id == row.id).order_by(PageORM.position)).scalars()
    )
    return Item(
        id=row.id, name=row.name, category_id=row.category_id, page_ids=page_ids, description=row.description
    )


# Per-slot ORM column names, keyed by the slot id used in the API
# ('a' / 'a2' / 'b' / 'b2' — top/bottom of the A and B chart columns).
SLOT_PATH_ATTR = {"a": "image_a_path", "a2": "image_a2_path", "b": "image_b_path", "b2": "image_b2_path"}
SLOT_STROKES_ATTR = {
    "a": "image_a_strokes",
    "a2": "image_a2_strokes",
    "b": "image_b_strokes",
    "b2": "image_b2_strokes",
}
SLOT_STOCK_NAME_ATTR = {
    "a": "stock_name_a",
    "a2": "stock_name_a2",
    "b": "stock_name_b",
    "b2": "stock_name_b2",
}


def _slot_from_row(path: Optional[str], strokes_json: str) -> Optional[ImageSlot]:
    if not path:
        return None
    strokes = [Stroke(**s) for s in json.loads(strokes_json)]
    return ImageSlot(path=path, strokes=strokes)


def page_to_api(row: PageORM) -> Page:
    return Page(
        id=row.id,
        item_id=row.item_id,
        note_html_a=row.note_html_a,
        note_html_b=row.note_html_b,
        updated_at=row.updated_at,
        layout=row.layout,
        image_a=_slot_from_row(row.image_a_path, row.image_a_strokes),
        image_a2=_slot_from_row(row.image_a2_path, row.image_a2_strokes),
        image_b=_slot_from_row(row.image_b_path, row.image_b_strokes),
        image_b2=_slot_from_row(row.image_b2_path, row.image_b2_strokes),
        stock_name_a=row.stock_name_a,
        stock_name_a2=row.stock_name_a2,
        stock_name_b=row.stock_name_b,
        stock_name_b2=row.stock_name_b2,
    )


def todo_to_api(row: TodoORM) -> Todo:
    return Todo(id=row.id, date=row.date, text=row.text, done=row.done)


def next_position(session: Session, model: Type, **filters: str) -> int:
    stmt = select(func.coalesce(func.max(model.position), -1)).filter_by(**filters)
    return session.execute(stmt).scalar_one() + 1
