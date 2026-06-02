"""상권 대시보드 · 추이 · 전체 분석 API"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import sys, pandas as pd, numpy as np
from pathlib import Path
from functools import lru_cache
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data_loader import (
    load_area, load_store_data, load_sales_data, load_floating_pop,
    load_kosis_survival, load_rental_trend,
    load_resident_pop, load_worker_pop, load_commercial_change,
)
from src.risk_engine import calc_all_scores, detect_early_warning
from utils.synthetic_data import generate_synthetic_store, calc_debt_resilience
from utils.shinhan_service_mock import build_shinhan_panels

router = APIRouter()

# ── 캐시 ──────────────────────────────────────────────────────────────────────
_C: dict = {}

def _get(key, loader):
    if key not in _C:
        _C[key] = loader()
    return _C[key]


# ── 공통 Series 추출 ──────────────────────────────────────────────────────────
def _series(df: pd.DataFrame, col: str, area_code: str,
            service_name: str = "", add_service: bool = True) -> pd.Series:
    """반환 Series의 index는 '기준_년분기_코드' (예: '20241'). 값은 col 값.
    동일 분기에 여러 행이 있을 경우 합산 (서비스 미지정 시) 또는 평균 처리."""
    if df.empty or col not in df.columns or "상권_코드" not in df.columns:
        return pd.Series(dtype=float)
    mask = df["상권_코드"].astype(str) == str(area_code)
    if add_service and service_name and "서비스_업종_코드_명" in df.columns:
        mask &= df["서비스_업종_코드_명"] == service_name
    sub = df.loc[mask, [c for c in ["기준_년분기_코드", col] if c in df.columns]].copy()
    if sub.empty or col not in sub.columns:
        return pd.Series(dtype=float)
    sub[col] = pd.to_numeric(sub[col], errors="coerce")
    sub = sub.dropna(subset=[col])
    if "기준_년분기_코드" in sub.columns:
        sub["기준_년분기_코드"] = sub["기준_년분기_코드"].astype(str)
        agg = "mean" if col in {"폐업_률"} else "sum"
        s = sub.groupby("기준_년분기_코드")[col].agg(agg).sort_index()
        return s
    return sub[col].dropna()


# ── 모델 ──────────────────────────────────────────────────────────────────────
class AnalysisRequest(BaseModel):
    area_code: str
    service_name: str = ""
    user_type: str = "창업 예정자"
    # 사업 조건 (선택)
    monthly_sales: Optional[float] = None
    rent: Optional[float] = None
    labor_cost: Optional[float] = None
    loan_balance: Optional[float] = None
    interest_rate: Optional[float] = None
    monthly_repayment: Optional[float] = None
    cash_balance: Optional[float] = None
    own_capital: Optional[float] = None
    initial_investment: Optional[float] = None
    cost_ratio: Optional[float] = None
    misc_monthly_cost: Optional[float] = None
    misc_initial_cost: Optional[float] = None


@router.post("/analysis")
def full_analysis(req: AnalysisRequest):
    store  = _get("store", load_store_data)
    sales  = _get("sales", load_sales_data)
    fp     = _get("fp",    load_floating_pop)
    kosis  = _get("kosis", load_kosis_survival)
    rental = _get("rental", load_rental_trend)
    res_p  = _get("resident", load_resident_pop)
    wrk_p  = _get("worker",   load_worker_pop)
    chg    = _get("change",   load_commercial_change)
    area_df= _get("area",     load_area)

    ac = req.area_code
    svc = req.service_name

    # area_name 조회
    area_name = ""
    if not area_df.empty and "상권_코드" in area_df.columns:
        row = area_df[area_df["상권_코드"].astype(str) == str(ac)]
        if not row.empty:
            area_name = str(row.iloc[0].get("상권_코드_명", ""))

    sales_s   = _series(sales, "당월_매출_금액", ac, svc)
    store_s   = _series(store, "점포_수", ac, svc)
    similar_s = _series(store, "유사_업종_점포_수", ac, svc)
    closure_s = _series(store, "폐업_률", ac, svc)
    open_s    = _series(store, "개업_점포_수", ac, svc)
    close_s   = _series(store, "폐업_점포_수", ac, svc)
    franchise_s= _series(store, "프랜차이즈_점포_수", ac, svc)
    fp_s      = _series(fp, "총_유동인구_수", ac, "", add_service=False)
    res_s     = _series(res_p, "총_상주인구_수", ac, "", add_service=False) if not res_p.empty else pd.Series(dtype=float)
    wrk_s     = _series(wrk_p, "총_직장인구_수", ac, "", add_service=False) if not wrk_p.empty else pd.Series(dtype=float)

    # 상권변화지표
    chg_s = pd.Series(dtype=float)
    if not chg.empty and "상권_코드" in chg.columns:
        chg_row = chg[chg["상권_코드"].astype(str) == str(ac)]
        val_col = next((c for c in chg.columns if "지표" in c or "index" in c.lower()), None)
        if val_col and not chg_row.empty:
            chg_s = chg_row[val_col].dropna()

    # 합성 재무 (사용자 입력 우선)
    avg_monthly = float(sales_s.mean()) / 3 if not sales_s.empty else 30_000_000
    synth = generate_synthetic_store(ac, area_name, svc, avg_monthly)
    finance = {
        "monthly_sales":     req.monthly_sales    or synth["월_매출"],
        "rent":              req.rent             or synth["월_임대료"],
        "labor_cost":        req.labor_cost       or synth["월_인건비"],
        "loan_balance":      req.loan_balance     or synth["대출잔액"],
        "interest_rate":     req.interest_rate    or synth["금리"],
        "monthly_repayment": req.monthly_repayment or synth["월_상환액"],
        "cash_balance":      req.cash_balance     or synth["현금보유액"],
        "cost_ratio":        req.cost_ratio       or 0.35,
        "misc_monthly_cost": req.misc_monthly_cost or 0,
        "misc_initial_cost": req.misc_initial_cost or 0,
    }
    if req.own_capital is not None:
        finance["own_capital"] = req.own_capital
    else:
        finance["own_capital"] = finance["cash_balance"]
    finance["monthly_interest"] = finance["loan_balance"] * finance["interest_rate"] / 100 / 12
    finance["fixed_cost"] = (
        finance["rent"] + finance["labor_cost"] + finance["monthly_interest"] + finance["misc_monthly_cost"]
    )
    finance["variable_cost"] = finance["monthly_sales"] * finance["cost_ratio"]
    finance["net_profit"] = finance["monthly_sales"] - finance["fixed_cost"] - finance["variable_cost"]
    fixed_ratio_denom = finance["monthly_sales"] if finance["monthly_sales"] else 1
    finance["interest_ratio"] = round(finance["monthly_interest"] / fixed_ratio_denom * 100, 1)
    finance["break_even"] = round(
        finance["fixed_cost"] / (1 - finance["cost_ratio"]) if (1 - finance["cost_ratio"]) > 0 else 0, 0
    )

    # ─ 초기 소요·조달 참고 (PoC 추정: 시설·가맹·부지 등을 합산한 대리 지표) ─
    def _round_won(x: float, unit: float = 1_000_000) -> int:
        if x <= 0:
            return 0
        return int(round(x / unit) * unit)

    _init_months = 4  # recommend.INIT_INVEST_MONTHS 와 동일 휴리스틱
    _init_total = (
        int(req.initial_investment) if req.initial_investment is not None
        else _round_won(finance["monthly_sales"] * _init_months)
    )
    _init_total += int(round(float(finance["misc_initial_cost"])))
    finance["initial_investment"] = _init_total
    _u = 1_000_000
    _fr = int(round(_init_total * 0.22 / _u) * _u)
    _fc = int(round(_init_total * 0.58 / _u) * _u)
    finance["breakdown_franchise_proxy"] = _fr
    finance["breakdown_facility_proxy"] = _fc
    finance["breakdown_deposit_working_proxy"] = max(0, _init_total - _fr - _fc)
    _own_cash = float(finance["own_capital"])
    finance["funding_gap_estimate"] = max(0, int(round(_init_total - _own_cash)))
    finance["loan_needed_estimate"] = finance["funding_gap_estimate"]
    finance["loan_monthly_interest_estimate"] = (
        finance["loan_needed_estimate"] * finance["interest_rate"] / 100 / 12
    )
    finance["recommended_working_capital"] = _round_won(float(finance["fixed_cost"]) * 3)

    # 경쟁점 수 (기본값)
    competitor_count = int(store_s.iloc[-1]) if not store_s.empty else 10

    # 전체 점수 계산
    scores = calc_all_scores(
        sales_s=sales_s, store_s=store_s, closure_s=closure_s, fp_s=fp_s,
        resident_s=res_s, worker_s=wrk_s, change_s=chg_s, similar_s=similar_s,
        kosis_df=kosis, rental_df=rental,
        finance=finance, service_name=svc, user_type=req.user_type,
        competitor_count=competitor_count,
    )

    # 조기경보
    avg_s = _series(sales, "당월_매출_금액", ac, "", add_service=False)
    # 창업 예정자: 상권 공공데이터 기반 '분기 매출 감소·상권 대비 매출'는 실제 창업자 실적이 아니므로
    # AI 평균 자동채우기 여부와 관계없이 조기경보에서 제외(운영 중 사업자만 표시).
    _is_startup_user = str(req.user_type).strip() == "창업 예정자"
    warnings = detect_early_warning(
        sales_s,
        avg_s,
        store_s,
        fp_s,
        user_type=req.user_type,
        allow_sales_vs_area_warning=not _is_startup_user,
        allow_quarter_sales_warning=not _is_startup_user,
    )

    # 상권 대비 매출 비율 (신한카드 목업·해석용)
    sales_vs_area_ratio = None
    if not sales_s.empty and not avg_s.empty and float(avg_s.iloc[-1] or 0) > 0:
        sales_vs_area_ratio = float(sales_s.iloc[-1]) / float(avg_s.iloc[-1])
        sales_vs_area_ratio = max(0.3, min(1.4, sales_vs_area_ratio))

    # 추이 데이터 (최근 8분기) - index는 '기준_년분기_코드' 문자열
    def _trend(s, n=8):
        if s.empty:
            return []
        s2 = s.tail(n)
        return [{"분기": str(q), "값": round(float(v), 0)} for q, v in s2.items()]

    # 최근 값
    def _last(s, default=None):
        return float(s.iloc[-1]) if not s.empty else default

    # 폐업률 표시: 데이터가 이미 % 단위 (e.g. 9.0 → 9.0%) ・ 비정상값 캡
    def _fmt_closure(s) -> str:
        if s.empty:
            return "-"
        v = float(s.iloc[-1])
        v = max(0.0, min(v, 100.0))
        return f"{v:.1f}%"

    return {
        "area_code": ac,
        "area_name": area_name,
        "service_name": svc,
        "user_type": req.user_type,
        "scores": {k: v for k, v in scores.items()},
        "warnings": warnings,
        "finance": {
            **finance,
            "cash_months": scores["debt"].get("cash_months", 0),
            "cash_months_10pct": scores["debt"].get("cash_months_10pct", 0),
            "cash_months_20pct": scores["debt"].get("cash_months_20pct", 0),
        },
        "store_summary": {
            "store_count":     _last(store_s),
            "open_count":      _last(open_s),
            "close_count":     _last(close_s),
            "franchise_count": _last(franchise_s),
            "closure_rate":    _fmt_closure(closure_s),
            "floating_pop":    _last(fp_s),
            "resident_pop":    _last(res_s),
            "worker_pop":      _last(wrk_s),
        },
        "trends": {
            "sales":   _trend(sales_s),
            "stores":  _trend(store_s),
            "open":    _trend(open_s),
            "close":   _trend(close_s),
            "fp":      _trend(fp_s),
        },
        "synthetic": synth,
        "has_data":  not sales_s.empty or not store_s.empty,
        "shinhan_panels": build_shinhan_panels(
            {k: v for k, v in scores.items() if k != "final"},
            {
                **finance,
                "cash_months": scores["debt"].get("cash_months", 0),
                "cash_months_10pct": scores["debt"].get("cash_months_10pct", 0),
                "cash_months_20pct": scores["debt"].get("cash_months_20pct", 0),
            },
            req.user_type,
            svc,
            sales_vs_area_ratio=sales_vs_area_ratio,
            competitor_count=competitor_count,
        ),
    }


@router.get("/trends")
def get_trends(area_code: str, service_name: str = ""):
    sales = _get("sales", load_sales_data)
    store = _get("store", load_store_data)
    fp    = _get("fp",    load_floating_pop)

    def _trend(df, col, add_svc=True):
        s = _series(df, col, area_code, service_name if add_svc else "", add_service=add_svc)
        if s.empty:
            return []
        return [{"분기": str(q), "값": round(float(v), 0)} for q, v in s.items()]

    return {
        "sales":   _trend(sales, "당월_매출_금액"),
        "stores":  _trend(store, "점포_수"),
        "open":    _trend(store, "개업_점포_수"),
        "close":   _trend(store, "폐업_점포_수"),
        "fp":      _trend(fp,    "총_유동인구_수", add_svc=False),
    }


@router.get("/status")
def data_status():
    from src.config import DATA_PATHS
    result = {}
    for key, path in DATA_PATHS.items():
        p = Path(path)
        files = list(p.glob("*.csv")) + list(p.glob("*.xlsx")) if p.exists() else []
        result[key] = {"ok": len(files) > 0, "files": len(files), "path": str(p)}
    return result


# ── 샘플 점포 데모 ─────────────────────────────────────────────────────────────
SAMPLE_CASES = [
    {
        "id": "case_office_cafe",
        "title": "오피스 상권 카페 창업 검토",
        "description": "직장인 점심·테이크아웃 수요가 높은 오피스 상권에서 카페 창업을 검토합니다.",
        "user_type": "창업 예정자",
        "service_name": "커피-음료",
        "district_keyword": "강남구",
        "monthly_sales": 42_000_000,
        "rent": 5_000_000,
        "labor_cost": 12_000_000,
        "loan_balance": 80_000_000,
        "interest_rate": 5.5,
        "monthly_repayment": 800_000,
        "cash_balance": 30_000_000,
        "initial_investment": 120_000_000,
        "cost_ratio": 0.35,
    },
    {
        "id": "case_residential_korean",
        "title": "주거 상권 한식음식점 운영 진단",
        "description": "주거지 인근에서 운영 중인 한식음식점의 매출 안정성과 부채 체력을 진단합니다.",
        "user_type": "운영 중인 사업자",
        "service_name": "한식음식점",
        "district_keyword": "마포구",
        "monthly_sales": 35_000_000,
        "rent": 3_500_000,
        "labor_cost": 9_000_000,
        "loan_balance": 60_000_000,
        "interest_rate": 5.8,
        "monthly_repayment": 1_100_000,
        "cash_balance": 8_000_000,
        "cost_ratio": 0.40,
    },
    {
        "id": "case_youth_chicken",
        "title": "청년 상권 치킨전문점 확장 검토",
        "description": "유동인구 높은 청년 상권에서 2호점 확장 가능성을 검토합니다.",
        "user_type": "기존 매장 확장 검토",
        "service_name": "치킨전문점",
        "district_keyword": "마포구",
        "monthly_sales": 55_000_000,
        "rent": 4_200_000,
        "labor_cost": 14_000_000,
        "loan_balance": 30_000_000,
        "interest_rate": 4.9,
        "monthly_repayment": 600_000,
        "cash_balance": 50_000_000,
        "cost_ratio": 0.38,
    },
    {
        "id": "case_finance_check",
        "title": "운영 사업자 금융 점검",
        "description": "현재 부채 부담과 현금 흐름을 점검하고 대환·운영자금 상담 필요성을 확인합니다.",
        "user_type": "금융/보험/비용 구조 점검",
        "service_name": "편의점",
        "district_keyword": "관악구",
        "monthly_sales": 28_000_000,
        "rent": 3_000_000,
        "labor_cost": 7_500_000,
        "loan_balance": 90_000_000,
        "interest_rate": 6.5,
        "monthly_repayment": 1_300_000,
        "cash_balance": 5_000_000,
        "cost_ratio": 0.45,
    },
]


@router.get("/sample-cases")
def sample_cases():
    """샘플 점포 케이스 목록 (홈 화면 '샘플 리포트 보기' 진입점)"""
    return SAMPLE_CASES


@router.get("/sample-case/{case_id}/area")
def resolve_sample_area(case_id: str):
    """샘플 케이스에 매칭되는 실제 상권 코드 1건을 골라 반환"""
    case = next((c for c in SAMPLE_CASES if c["id"] == case_id), None)
    if case is None:
        return {"error": "case_not_found"}

    area_df = _get("area", load_area)
    store_df = _get("store", load_store_data)
    keyword = case.get("district_keyword", "")
    service = case.get("service_name", "")

    if area_df.empty:
        return {"error": "area_data_missing", "case": case}

    df = area_df
    if keyword and "자치구_코드_명" in df.columns:
        cand = df[df["자치구_코드_명"] == keyword]
        if not cand.empty:
            df = cand

    # 점포 데이터에 해당 상권+업종이 실제 있는 1건을 우선 선택
    picked = None
    if not store_df.empty and "서비스_업종_코드_명" in store_df.columns:
        joined = store_df[store_df["서비스_업종_코드_명"] == service]
        if not joined.empty and "상권_코드" in joined.columns:
            valid_codes = set(joined["상권_코드"].astype(str).unique())
            candidates = df[df["상권_코드"].astype(str).isin(valid_codes)]
            if not candidates.empty:
                row = candidates.iloc[0]
                picked = {
                    "area_code": str(row.get("상권_코드", "")),
                    "area_name": str(row.get("상권_코드_명", "")),
                    "district": str(row.get("자치구_코드_명", "")),
                    "dong":     str(row.get("행정동_코드_명", "")),
                }

    if picked is None and not df.empty:
        row = df.iloc[0]
        picked = {
            "area_code": str(row.get("상권_코드", "")),
            "area_name": str(row.get("상권_코드_명", "")),
            "district": str(row.get("자치구_코드_명", "")),
            "dong":     str(row.get("행정동_코드_명", "")),
        }

    return {"case": case, "area": picked}
