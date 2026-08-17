from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud import code_info_to_api, formula_info_to_api
from ..db import get_session
from ..models import CodeInfo, FORMULA_CATEGORIES, FormulaInfo, new_id, now
from ..orm import CodeInfoORM, FormulaInfoORM

router = APIRouter(tags=["reference"])


# ---- Code info (숫자 코드 -> 의미) -----------------------------------------


class CodeInfoCreate(BaseModel):
    code: str
    description: str = ""


class CodeInfoUpdate(BaseModel):
    code: Optional[str] = None
    description: Optional[str] = None


@router.get("/api/code-infos", response_model=List[CodeInfo])
def list_code_infos(session: Session = Depends(get_session)) -> List[CodeInfo]:
    rows = session.query(CodeInfoORM).order_by(CodeInfoORM.created_at).all()
    return [code_info_to_api(r) for r in rows]


@router.post("/api/code-infos", response_model=CodeInfo)
def create_code_info(payload: CodeInfoCreate, session: Session = Depends(get_session)) -> CodeInfo:
    row = CodeInfoORM(id=new_id(), code=payload.code, description=payload.description, created_at=now())
    session.add(row)
    session.commit()
    session.refresh(row)
    return code_info_to_api(row)


@router.patch("/api/code-infos/{item_id}", response_model=CodeInfo)
def update_code_info(item_id: str, payload: CodeInfoUpdate, session: Session = Depends(get_session)) -> CodeInfo:
    row = session.get(CodeInfoORM, item_id)
    if not row:
        raise HTTPException(404, "not found")
    if payload.code is not None:
        row.code = payload.code
    if payload.description is not None:
        row.description = payload.description
    session.commit()
    session.refresh(row)
    return code_info_to_api(row)


@router.delete("/api/code-infos/{item_id}")
def delete_code_info(item_id: str, session: Session = Depends(get_session)) -> dict:
    row = session.get(CodeInfoORM, item_id)
    if not row:
        raise HTTPException(404, "not found")
    session.delete(row)
    session.commit()
    return {"ok": True}


# ---- Formula info (매매 수식/지표) ------------------------------------------


class FormulaInfoCreate(BaseModel):
    category: str
    name: str
    content: str = ""


class FormulaInfoUpdate(BaseModel):
    category: Optional[str] = None
    name: Optional[str] = None
    content: Optional[str] = None


def _validate_category(category: str) -> None:
    if category not in FORMULA_CATEGORIES:
        raise HTTPException(400, f"category must be one of {FORMULA_CATEGORIES}")


@router.get("/api/formula-infos", response_model=List[FormulaInfo])
def list_formula_infos(session: Session = Depends(get_session)) -> List[FormulaInfo]:
    rows = session.query(FormulaInfoORM).order_by(FormulaInfoORM.created_at).all()
    return [formula_info_to_api(r) for r in rows]


@router.post("/api/formula-infos", response_model=FormulaInfo)
def create_formula_info(payload: FormulaInfoCreate, session: Session = Depends(get_session)) -> FormulaInfo:
    _validate_category(payload.category)
    row = FormulaInfoORM(
        id=new_id(), category=payload.category, name=payload.name, content=payload.content, created_at=now()
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return formula_info_to_api(row)


@router.patch("/api/formula-infos/{item_id}", response_model=FormulaInfo)
def update_formula_info(
    item_id: str, payload: FormulaInfoUpdate, session: Session = Depends(get_session)
) -> FormulaInfo:
    row = session.get(FormulaInfoORM, item_id)
    if not row:
        raise HTTPException(404, "not found")
    if payload.category is not None:
        _validate_category(payload.category)
        row.category = payload.category
    if payload.name is not None:
        row.name = payload.name
    if payload.content is not None:
        row.content = payload.content
    session.commit()
    session.refresh(row)
    return formula_info_to_api(row)


@router.delete("/api/formula-infos/{item_id}")
def delete_formula_info(item_id: str, session: Session = Depends(get_session)) -> dict:
    row = session.get(FormulaInfoORM, item_id)
    if not row:
        raise HTTPException(404, "not found")
    session.delete(row)
    session.commit()
    return {"ok": True}
