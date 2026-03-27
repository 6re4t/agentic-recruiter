from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..db import get_session
from ..models import AuditLog

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
def list_audit(limit: int = 200, session: Session = Depends(get_session)):
    stmt = select(AuditLog).order_by(AuditLog.ts.desc()).limit(limit)
    return session.exec(stmt).all()