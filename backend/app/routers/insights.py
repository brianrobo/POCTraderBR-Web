from __future__ import annotations

import json
from typing import Dict, List, Literal, Optional, Set

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import next_position
from ..db import get_session
from ..models import InsightEvidence, InsightMap, InsightNode, InsightQuiz, new_id, now
from ..orm import (
    InsightEvidenceORM,
    InsightNodeORM,
    SimBarAttemptORM,
    SimBarQuizORM,
    SimBarSetORM,
    SimScenarioORM,
)
from .sim import _grade

router = APIRouter(prefix="/api/insights", tags=["insights"])

Kind = Literal["", "buy", "avoid", "wait"]
Status = Literal["candidate", "confirmed", "dropped"]
Stance = Literal["support", "counter"]


class NodeCreate(BaseModel):
    name: str
    parent_id: Optional[str] = None  # left out: a top-level node


class NodeUpdate(BaseModel):
    name: Optional[str] = None
    # "" moves the node to the top level; None leaves it where it is.
    parent_id: Optional[str] = None
    kind: Optional[Kind] = None
    status: Optional[Status] = None
    description: Optional[str] = None


class NodeMove(BaseModel):
    direction: Literal["up", "down"]


class NodeMerge(BaseModel):
    into_id: str


class EvidenceCreate(BaseModel):
    node_id: str
    quiz_id: str
    stance: Stance = "support"
    comment: Optional[str] = None


class EvidenceUpdate(BaseModel):
    stance: Optional[Stance] = None
    comment: Optional[str] = None


def _node_to_api(row: InsightNodeORM) -> InsightNode:
    return InsightNode(
        id=row.id,
        name=row.name,
        parent_id=row.parent_id,
        position=row.position,
        kind=row.kind or "",  # type: ignore[arg-type]
        status=row.status or "candidate",  # type: ignore[arg-type]
        description=row.description,
        created_at=row.created_at,
    )


def _evidence_to_api(row: InsightEvidenceORM) -> InsightEvidence:
    return InsightEvidence(
        id=row.id,
        node_id=row.node_id,
        quiz_id=row.quiz_id,
        stance=row.stance or "support",  # type: ignore[arg-type]
        comment=row.comment,
        created_at=row.created_at,
    )


def _quizzes(session: Session) -> List[InsightQuiz]:
    scenarios = {s.id: s for s in session.query(SimScenarioORM).all()}
    rows = session.query(SimBarQuizORM).all()
    outcomes = {q.id: q.outcome or "" for q in rows}
    # quiz id -> [graded answers, correct ones]
    tallies: Dict[str, List[int]] = {}
    for attempt in session.query(SimBarAttemptORM).all():
        result = _grade(attempt.answer, outcomes.get(attempt.quiz_id, ""))
        if result:
            tally = tallies.setdefault(attempt.quiz_id, [0, 0])
            tally[0] += 1
            tally[1] += result == "correct"
    # scenario id -> bar time -> frame number
    frames: Dict[str, Dict[int, int]] = {}
    for scenario_id in {q.scenario_id for q in rows}:
        bar_set = session.get(SimBarSetORM, scenario_id)
        bars = json.loads(bar_set.bars_json) if bar_set else []
        frames[scenario_id] = {int(bar[0]): i + 1 for i, bar in enumerate(bars)}
    rows.sort(key=lambda q: (scenarios[q.scenario_id].position, q.bar_time))
    return [
        InsightQuiz(
            id=q.id,
            scenario_id=q.scenario_id,
            scenario_name=scenarios[q.scenario_id].name,
            start_time=q.start_time or q.bar_time,
            bar_time=q.bar_time,
            start_frame=frames[q.scenario_id].get(q.start_time or q.bar_time, 0),
            end_frame=frames[q.scenario_id].get(q.bar_time, 0),
            outcome=q.outcome or "",  # type: ignore[arg-type]
            note=q.note,
            graded_count=tallies.get(q.id, [0, 0])[0],
            correct_count=tallies.get(q.id, [0, 0])[1],
        )
        for q in rows
    ]


def _require_node(session: Session, node_id: str) -> InsightNodeORM:
    row = session.get(InsightNodeORM, node_id)
    if not row:
        raise HTTPException(404, "insight node not found")
    return row


def _require_evidence(session: Session, evidence_id: str) -> InsightEvidenceORM:
    row = session.get(InsightEvidenceORM, evidence_id)
    if not row:
        raise HTTPException(404, "evidence not found")
    return row


def _descendants(session: Session, node_id: str) -> Set[str]:
    children: Dict[Optional[str], List[str]] = {}
    for child_id, parent_id in session.query(InsightNodeORM.id, InsightNodeORM.parent_id):
        children.setdefault(parent_id, []).append(child_id)
    found: Set[str] = set()
    pending = [node_id]
    while pending:
        for child_id in children.get(pending.pop(), []):
            found.add(child_id)
            pending.append(child_id)
    return found


@router.get("", response_model=InsightMap)
def get_insight_map(session: Session = Depends(get_session)) -> InsightMap:
    nodes = session.query(InsightNodeORM).order_by(InsightNodeORM.position, InsightNodeORM.created_at).all()
    evidence = session.query(InsightEvidenceORM).order_by(InsightEvidenceORM.created_at).all()
    return InsightMap(
        nodes=[_node_to_api(n) for n in nodes],
        evidence=[_evidence_to_api(e) for e in evidence],
        quizzes=_quizzes(session),
    )


@router.post("/nodes", response_model=InsightNode)
def create_node(payload: NodeCreate, session: Session = Depends(get_session)) -> InsightNode:
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "name must not be empty")
    parent_id = payload.parent_id or None
    if parent_id is not None:
        _require_node(session, parent_id)
    row = InsightNodeORM(
        id=new_id(),
        name=name,
        parent_id=parent_id,
        position=next_position(session, InsightNodeORM, parent_id=parent_id),
        created_at=now(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _node_to_api(row)


@router.patch("/nodes/{node_id}", response_model=InsightNode)
def update_node(node_id: str, payload: NodeUpdate, session: Session = Depends(get_session)) -> InsightNode:
    row = _require_node(session, node_id)
    if payload.name is not None:
        if not payload.name.strip():
            raise HTTPException(400, "name must not be empty")
        row.name = payload.name.strip()
    if payload.parent_id is not None and (payload.parent_id or None) != row.parent_id:
        parent_id = payload.parent_id or None
        if parent_id is not None:
            _require_node(session, parent_id)
            if parent_id == row.id or parent_id in _descendants(session, row.id):
                raise HTTPException(400, "cannot move a node under itself")
        row.position = next_position(session, InsightNodeORM, parent_id=parent_id)
        row.parent_id = parent_id
    if payload.kind is not None:
        row.kind = payload.kind
    if payload.status is not None:
        row.status = payload.status
    if payload.description is not None:
        row.description = payload.description
    session.commit()
    session.refresh(row)
    return _node_to_api(row)


@router.post("/nodes/{node_id}/move")
def move_node(node_id: str, payload: NodeMove, session: Session = Depends(get_session)) -> dict:
    row = _require_node(session, node_id)
    siblings = (
        session.query(InsightNodeORM)
        .filter_by(parent_id=row.parent_id)
        .order_by(InsightNodeORM.position, InsightNodeORM.created_at)
        .all()
    )
    idx = next(i for i, s in enumerate(siblings) if s.id == node_id)
    swap_idx = idx - 1 if payload.direction == "up" else idx + 1
    if 0 <= swap_idx < len(siblings):
        siblings[idx], siblings[swap_idx] = siblings[swap_idx], siblings[idx]
        for position, sibling in enumerate(siblings):
            sibling.position = position
        session.commit()
    return {"ok": True}


@router.post("/nodes/{node_id}/merge", response_model=InsightNode)
def merge_node(node_id: str, payload: NodeMerge, session: Session = Depends(get_session)) -> InsightNode:
    """Fold a node into another one that says the same thing: its quizzes,
    children and description move over, and the node itself goes."""
    row = _require_node(session, node_id)
    into = _require_node(session, payload.into_id)
    if into.id == row.id or into.id in _descendants(session, row.id):
        raise HTTPException(400, "cannot merge a node into itself or into a node under it")
    linked = {e.quiz_id for e in session.query(InsightEvidenceORM).filter_by(node_id=into.id)}
    for evidence in session.query(InsightEvidenceORM).filter_by(node_id=row.id).all():
        # A quiz both nodes rest on keeps the target's link.
        if evidence.quiz_id in linked:
            session.delete(evidence)
        else:
            evidence.node_id = into.id
    position = next_position(session, InsightNodeORM, parent_id=into.id)
    children = (
        session.query(InsightNodeORM).filter_by(parent_id=row.id).order_by(InsightNodeORM.position).all()
    )
    for offset, child in enumerate(children):
        child.parent_id = into.id
        child.position = position + offset
    into.description = "\n\n".join(text for text in (into.description.strip(), row.description.strip()) if text)
    # Before the node goes — foreign_keys=ON rejects deleting a row that is still referenced.
    session.flush()
    session.delete(row)
    session.commit()
    session.refresh(into)
    return _node_to_api(into)


@router.delete("/nodes/{node_id}")
def delete_node(node_id: str, session: Session = Depends(get_session)) -> dict:
    row = _require_node(session, node_id)
    if session.query(InsightNodeORM).filter_by(parent_id=node_id).first() is not None:
        raise HTTPException(400, "node has children; delete, move or merge them first")
    session.query(InsightEvidenceORM).filter_by(node_id=node_id).delete(synchronize_session=False)
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.post("/evidence", response_model=InsightEvidence)
def link_quiz(payload: EvidenceCreate, session: Session = Depends(get_session)) -> InsightEvidence:
    _require_node(session, payload.node_id)
    quiz = session.get(SimBarQuizORM, payload.quiz_id)
    if not quiz:
        raise HTTPException(404, "quiz not found")
    # Linking the same quiz again changes the link there is.
    row = session.query(InsightEvidenceORM).filter_by(node_id=payload.node_id, quiz_id=payload.quiz_id).first()
    if row is None:
        row = InsightEvidenceORM(
            id=new_id(),
            node_id=payload.node_id,
            scenario_id=quiz.scenario_id,
            quiz_id=payload.quiz_id,
            created_at=now(),
        )
        session.add(row)
    row.stance = payload.stance
    if payload.comment is not None:
        row.comment = payload.comment
    session.commit()
    session.refresh(row)
    return _evidence_to_api(row)


@router.patch("/evidence/{evidence_id}", response_model=InsightEvidence)
def update_evidence(
    evidence_id: str, payload: EvidenceUpdate, session: Session = Depends(get_session)
) -> InsightEvidence:
    row = _require_evidence(session, evidence_id)
    if payload.stance is not None:
        row.stance = payload.stance
    if payload.comment is not None:
        row.comment = payload.comment
    session.commit()
    session.refresh(row)
    return _evidence_to_api(row)


@router.delete("/evidence/{evidence_id}")
def delete_evidence(evidence_id: str, session: Session = Depends(get_session)) -> dict:
    session.delete(_require_evidence(session, evidence_id))
    session.commit()
    return {"ok": True}
