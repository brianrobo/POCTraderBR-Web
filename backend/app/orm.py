from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class CategoryORM(Base):
    __tablename__ = "categories"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[Optional[str]] = mapped_column(ForeignKey("categories.id"), nullable=True)
    position: Mapped[int] = mapped_column(default=0)
    urls: Mapped[str] = mapped_column(Text, default="[]")
    note_html: Mapped[str] = mapped_column(Text, default="")


class ItemORM(Base):
    __tablename__ = "items"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"))
    position: Mapped[int] = mapped_column(default=0)
    description: Mapped[str] = mapped_column(Text, default="")


class PageORM(Base):
    __tablename__ = "pages"

    id: Mapped[str] = mapped_column(primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"))
    position: Mapped[int] = mapped_column(default=0)
    note_html_a: Mapped[str] = mapped_column(Text, default="")
    note_html_b: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[float] = mapped_column(default=0.0)
    layout: Mapped[str] = mapped_column(Text, default="2")
    image_a_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_a_strokes: Mapped[str] = mapped_column(Text, default="[]")
    image_a2_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_a2_strokes: Mapped[str] = mapped_column(Text, default="[]")
    image_b_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_b_strokes: Mapped[str] = mapped_column(Text, default="[]")
    image_b2_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_b2_strokes: Mapped[str] = mapped_column(Text, default="[]")
    stock_name_a: Mapped[str] = mapped_column(Text, default="")
    stock_name_a2: Mapped[str] = mapped_column(Text, default="")
    stock_name_b: Mapped[str] = mapped_column(Text, default="")
    stock_name_b2: Mapped[str] = mapped_column(Text, default="")


class TodoORM(Base):
    __tablename__ = "todos"
    __table_args__ = (Index("ix_todos_date", "date"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    date: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    done: Mapped[bool] = mapped_column(default=False)
    position: Mapped[int] = mapped_column(default=0)
