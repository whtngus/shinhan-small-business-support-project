"""AI 종합 리포트 API (Gemini)"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Any
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from app.services.report_service import generate_report

router = APIRouter()


class ReportRequest(BaseModel):
    area_name: str = ""
    service_name: str = ""
    user_type: str = "창업 예정자"
    year_quarter: str = ""
    scores: dict = {}
    finance: dict = {}
    store_summary: dict = {}
    competitor_count_500m: int = 0
    warnings: list = []


@router.post("/report")
def create_report(req: ReportRequest):
    ctx = req.dict()
    ctx["risk_score"]  = ctx["scores"].get("final", {}).get("score", 50)
    ctx["risk_grade"]  = ctx["scores"].get("final", {}).get("label", "관심")
    ctx["fit_score"]   = ctx["scores"].get("final", {}).get("score", 50)
    ctx["fit_grade"]   = ctx["scores"].get("final", {}).get("label", "조건부 추천")
    survival = ctx["scores"].get("survival", {}).get("survival_rate", "-")
    ctx["survival_rate"] = survival
    result = generate_report(ctx)
    return {"source": result["source"], "content": result["content"]}
