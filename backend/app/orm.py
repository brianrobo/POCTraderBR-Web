from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class CategoryORM(Base):
    __tablename__ = "categories"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[Optional[str]] = mapped_column(ForeignKey("categories.id"), nullable=True)
    position: Mapped[int] = mapped_column(default=0)


class ItemORM(Base):
    __tablename__ = "items"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"))
    position: Mapped[int] = mapped_column(default=0)


class PageORM(Base):
    __tablename__ = "pages"

    id: Mapped[str] = mapped_column(primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"))
    position: Mapped[int] = mapped_column(default=0)
    note_html: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[float] = mapped_column(default=0.0)
    image_a_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_a_strokes: Mapped[str] = mapped_column(Text, default="[]")
    image_b_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_b_strokes: Mapped[str] = mapped_column(Text, default="[]")
