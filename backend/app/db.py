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
    ("pages", "stock_name_a2", "ALTER TABLE pages ADD COLUMN stock_name_a2 TEXT DEFAULT ''"),
    ("pages", "stock_name_b2", "ALTER TABLE pages ADD COLUMN stock_name_b2 TEXT DEFAULT ''"),
]


def ensure_schema() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        for table, column, ddl in _ADDITIVE_COLUMNS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if column not in existing:
                conn.execute(text(ddl))
        conn.commit()
