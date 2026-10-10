from __future__ import annotations

from typing import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .paths import DATA_DIR, SQLITE_PATH


class Base(DeclarativeBase):
    pass


DATA_DIR.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{SQLITE_PATH}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


# Columns added after the initial schema. create_all() only creates tables
# that don't exist yet — it won't add new columns to an existing one — so
# any new column needs a one-time additive ALTER TABLE here to avoid losing
# real data already on disk.
_ADDITIVE_COLUMNS: list[tuple[str, str, str]] = [
    ("pages", "stock_name_a", "ALTER TABLE pages ADD COLUMN stock_name_a TEXT DEFAULT ''"),
    ("pages", "stock_name_b", "ALTER TABLE pages ADD COLUMN stock_name_b TEXT DEFAULT ''"),
    ("categories", "urls", "ALTER TABLE categories ADD COLUMN urls TEXT DEFAULT '[]'"),
    ("pages", "layout", "ALTER TABLE pages ADD COLUMN layout TEXT DEFAULT '2'"),
    ("pages", "image_a2_path", "ALTER TABLE pages ADD COLUMN image_a2_path TEXT"),
    ("pages", "image_a2_strokes", "ALTER TABLE pages ADD COLUMN image_a2_strokes TEXT DEFAULT '[]'"),
    ("pages", "image_b2_path", "ALTER TABLE pages ADD COLUMN image_b2_path TEXT"),
    ("pages", "image_b2_strokes", "ALTER TABLE pages ADD COLUMN image_b2_strokes TEXT DEFAULT '[]'"),
    ("pages", "clip_path", "ALTER TABLE pages ADD COLUMN clip_path TEXT"),
    ("pages", "do_not_buy", "ALTER TABLE pages ADD COLUMN do_not_buy BOOLEAN DEFAULT 0"),
    ("pages", "stock_name_a2", "ALTER TABLE pages ADD COLUMN stock_name_a2 TEXT DEFAULT ''"),
    ("pages", "stock_name_b2", "ALTER TABLE pages ADD COLUMN stock_name_b2 TEXT DEFAULT ''"),
    ("pages", "note_html_b", "ALTER TABLE pages ADD COLUMN note_html_b TEXT DEFAULT ''"),
    ("categories", "note_html", "ALTER TABLE categories ADD COLUMN note_html TEXT DEFAULT ''"),
    ("items", "description", "ALTER TABLE items ADD COLUMN description TEXT DEFAULT ''"),
    ("pages", "kind", "ALTER TABLE pages ADD COLUMN kind TEXT DEFAULT 'chart'"),
    ("pages", "result", "ALTER TABLE pages ADD COLUMN result TEXT DEFAULT ''"),
    ("pages", "ma_spacing", "ALTER TABLE pages ADD COLUMN ma_spacing TEXT DEFAULT ''"),
    ("pages", "accumulation_checked", "ALTER TABLE pages ADD COLUMN accumulation_checked BOOLEAN DEFAULT 0"),
    ("pages", "leading_span2_checked", "ALTER TABLE pages ADD COLUMN leading_span2_checked BOOLEAN DEFAULT 0"),
    ("pages", "period_symmetry", "ALTER TABLE pages ADD COLUMN period_symmetry TEXT DEFAULT ''"),
    ("pages", "leading_span2", "ALTER TABLE pages ADD COLUMN leading_span2 TEXT DEFAULT ''"),
]

# The single shared note_html column became per-column note_html_a/note_html_b.
# Rename rather than add-and-drop so the existing note text isn't lost — it
# becomes column A's note, and B starts blank.
_RENAMED_COLUMNS: list[tuple[str, str, str]] = [
    ("pages", "note_html", "note_html_a"),
]


def ensure_schema() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        for table, old, new in _RENAMED_COLUMNS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if old in existing and new not in existing:
                conn.execute(text(f"ALTER TABLE {table} RENAME COLUMN {old} TO {new}"))
        added_leading_span2 = False
        for table, column, ddl in _ADDITIVE_COLUMNS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column not in existing:
                conn.execute(text(ddl))
                if table == "pages" and column == "leading_span2":
                    added_leading_span2 = True
        # The old boolean "선행2 소화" checkbox became a tri-state
        # ''/digested/undigested field — carry forward any already-checked
        # rows as "digested" rather than silently losing that judgment.
        if added_leading_span2:
            conn.execute(
                text("UPDATE pages SET leading_span2 = 'digested' WHERE leading_span2_checked = 1")
            )
        conn.commit()
