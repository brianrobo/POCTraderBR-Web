from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import next_position, todo_to_api
from ..db import get_session
from ..models import Todo, new_id
from ..orm import TodoORM

router = APIRouter(prefix="/api/todos", tags=["todos"])


class TodoCreate(BaseModel):
    date: str
    text: str


class TodoUpdate(BaseModel):
    text: Optional[str] = None
    done: Optional[bool] = None


@router.get("", response_model=List[Todo])
def list_todos(date: str, session: Session = Depends(get_session)) -> List[Todo]:
    rows = session.query(TodoORM).filter_by(date=date).order_by(TodoORM.position).all()
    return [todo_to_api(r) for r in rows]


@router.post("", response_model=Todo)
def create_todo(payload: TodoCreate, session: Session = Depends(get_session)) -> Todo:
    row = TodoORM(
        id=new_id(),
        date=payload.date,
        text=payload.text,
        done=False,
        position=next_position(session, TodoORM, date=payload.date),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return todo_to_api(row)


@router.patch("/{todo_id}", response_model=Todo)
def update_todo(todo_id: str, payload: TodoUpdate, session: Session = Depends(get_session)) -> Todo:
    row = session.get(TodoORM, todo_id)
    if not row:
        raise HTTPException(404, "not found")
    if payload.text is not None:
        row.text = payload.text
    if payload.done is not None:
        row.done = payload.done
    session.commit()
    session.refresh(row)
    return todo_to_api(row)


@router.delete("/{todo_id}")
def delete_todo(todo_id: str, session: Session = Depends(get_session)) -> dict:
    row = session.get(TodoORM, todo_id)
    if not row:
        raise HTTPException(404, "not found")
    session.delete(row)
    session.commit()
    return {"ok": True}
