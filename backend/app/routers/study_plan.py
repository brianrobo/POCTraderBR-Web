from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import next_position, study_plan_node_to_api
from ..db import get_session
from ..models import ROOT_STUDY_PLAN_ID, StudyPlanNode, new_id
from ..orm import StudyPlanNodeORM

router = APIRouter(prefix="/api/study-plan-nodes", tags=["study-plan"])


class StudyPlanNodeCreate(BaseModel):
    name: str
    parent_id: str = ROOT_STUDY_PLAN_ID


class StudyPlanNodeUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    result_html: Optional[str] = None


class StudyPlanNodeMove(BaseModel):
    direction: Literal["up", "down"]


@router.get("", response_model=List[StudyPlanNode])
def list_study_plan_nodes(session: Session = Depends(get_session)) -> List[StudyPlanNode]:
    rows = session.query(StudyPlanNodeORM).all()
    return [study_plan_node_to_api(session, r) for r in rows]


@router.post("", response_model=StudyPlanNode)
def create_study_plan_node(payload: StudyPlanNodeCreate, session: Session = Depends(get_session)) -> StudyPlanNode:
    parent = session.get(StudyPlanNodeORM, payload.parent_id)
    if not parent:
        raise HTTPException(404, "parent node not found")
    row = StudyPlanNodeORM(
        id=new_id(),
        name=payload.name,
        parent_id=payload.parent_id,
        position=next_position(session, StudyPlanNodeORM, parent_id=payload.parent_id),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return study_plan_node_to_api(session, row)


@router.patch("/{node_id}", response_model=StudyPlanNode)
def update_study_plan_node(
    node_id: str, payload: StudyPlanNodeUpdate, session: Session = Depends(get_session)
) -> StudyPlanNode:
    row = session.get(StudyPlanNodeORM, node_id)
    if not row:
        raise HTTPException(404, "not found")
    if payload.name is not None:
        row.name = payload.name
    if payload.parent_id is not None and payload.parent_id != row.parent_id:
        new_parent = session.get(StudyPlanNodeORM, payload.parent_id)
        if not new_parent:
            raise HTTPException(404, "parent node not found")
        row.parent_id = payload.parent_id
        row.position = next_position(session, StudyPlanNodeORM, parent_id=payload.parent_id)
    if payload.start_date is not None:
        row.start_date = payload.start_date or None
    if payload.end_date is not None:
        row.end_date = payload.end_date or None
    if payload.result_html is not None:
        row.result_html = payload.result_html
    session.commit()
    session.refresh(row)
    return study_plan_node_to_api(session, row)


@router.post("/{node_id}/move")
def move_study_plan_node(
    node_id: str, payload: StudyPlanNodeMove, session: Session = Depends(get_session)
) -> dict:
    row = session.get(StudyPlanNodeORM, node_id)
    if not row:
        raise HTTPException(404, "not found")
    siblings = (
        session.query(StudyPlanNodeORM)
        .filter_by(parent_id=row.parent_id)
        .order_by(StudyPlanNodeORM.position)
        .all()
    )
    idx = next(i for i, s in enumerate(siblings) if s.id == node_id)
    swap_idx = idx - 1 if payload.direction == "up" else idx + 1
    if 0 <= swap_idx < len(siblings):
        other = siblings[swap_idx]
        row.position, other.position = other.position, row.position
        session.commit()
    return {"ok": True}


@router.delete("/{node_id}")
def delete_study_plan_node(node_id: str, session: Session = Depends(get_session)) -> dict:
    if node_id == ROOT_STUDY_PLAN_ID:
        raise HTTPException(400, "cannot delete root node")
    row = session.get(StudyPlanNodeORM, node_id)
    if not row:
        raise HTTPException(404, "not found")
    has_children = session.query(StudyPlanNodeORM).filter_by(parent_id=node_id).first() is not None
    if has_children:
        raise HTTPException(400, "node has children; delete or move them first")
    session.delete(row)
    session.commit()
    return {"ok": True}
