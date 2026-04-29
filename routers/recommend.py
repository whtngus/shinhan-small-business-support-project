"""사업 조건 AI 추천 API.

선택한 상권/업종에 대해, 우리가 보유한 공공 데이터에서 다음을 산출해
사용자가 모르는 항목의 default를 채워줍니다.
- 월 매출:       서울시 추정매출(해당 상권+업종) 분기 평균 ÷ 3
- 월 임대료:     자치구 임대료 인덱스 + 추정매출 비율 (없으면 합성)
- 월 인건비:     매출의 25% (일반 자영업 평균치)
- 대출잔액:      월 매출 × 6~10 (업종별)
- 금리/현금:    합성 점포 기준
- 원가율:        업종별 다름 (요식 0.40, 카페 0.32, 미용 0.30, 편의점 0.42)
"""
import sys
from pathlib import Path
from functools import lru_cache
from typing import Optional

import pandas as pd
from fastapi import APIRouter

sys.path.insert(0, str(Path(__file__).parent.parent))
from src.data_loader import (
    load_area, load_store_data, load_sales_data, load_rental_trend,
)
from utils.synthetic_data import generate_synthetic_store

router = APIRouter()
_C: dict = {}


def _get(key, loader):
    if key not in _C:
        _C[key] = loader()
    return _C[key]


# 업종별 원가율 / 인건비율 / 임대료비율 휴리스틱
COST_RATIO = {
    "한식음식점":   0.40, "양식음식점": 0.40, "일식음식점": 0.40, "중식음식점": 0.40,
    "분식전문점":   0.42, "패스트푸드점": 0.42, "치킨전문점": 0.42, "호프-간이주점": 0.40,
    "커피-음료":   0.32, "제과점": 0.38,
    "편의점":       0.78, "슈퍼마켓": 0.75,
    "미용실":       0.20, "네일숍": 0.20, "피부관리실": 0.22,
    "부동산중개업": 0.10, "세무사사무소": 0.15, "변리사사무소": 0.15,
}
DEFAULT_COST_RATIO = 0.40

LABOR_RATIO = {
    "편의점": 0.18, "슈퍼마켓": 0.18,
    "커피-음료": 0.28, "제과점": 0.27,
    "한식음식점": 0.27, "양식음식점": 0.27, "일식음식점": 0.27,
    "치킨전문점": 0.27, "호프-간이주점": 0.27,
    "미용실": 0.30, "네일숍": 0.30, "피부관리실": 0.30,
}
DEFAULT_LABOR_RATIO = 0.27

RENT_RATIO = {
    "편의점": 0.08, "슈퍼마켓": 0.07,
    "커피-음료": 0.13, "제과점": 0.12,
    "한식음식점": 0.10, "양식음식점": 0.10, "일식음식점": 0.10,
    "미용실": 0.14, "네일숍": 0.13, "피부관리실": 0.13,
}
DEFAULT_RENT_RATIO = 0.11

LOAN_MONTHS = 8           # 월 매출 × 8 ≒ 평균 대출잔액
INIT_INVEST_MONTHS = 4    # 월 매출 × 4 ≒ 초기 투자
CASH_MONTHS = 1.2         # 월 매출 × 1.2 ≒ 현금보유


def _per_store_quarter_sales(sales: pd.DataFrame, store: pd.DataFrame,
                              area_code: str, service_name: str,
                              area_codes: Optional[list] = None) -> Optional[float]:
    """(상권+업종+분기) 행 단위로 매출/점포수 = per-store quarterly. 그 다음 평균.

    area_codes를 주면 (자치구 단위) 폴백 모드로 동작.
    """
    if sales.empty or store.empty: return None
    if "당월_매출_금액" not in sales.columns or "점포_수" not in store.columns:
        return None
    keys = ["기준_년분기_코드", "상권_코드", "서비스_업종_코드_명"]
    if any(k not in sales.columns for k in keys) or any(k not in store.columns for k in keys):
        return None

    if area_codes is None:
        s = sales[sales["상권_코드"].astype(str) == str(area_code)]
        st = store[store["상권_코드"].astype(str) == str(area_code)]
    else:
        s = sales[sales["상권_코드"].astype(str).isin(area_codes)]
        st = store[store["상권_코드"].astype(str).isin(area_codes)]
    if service_name:
        s = s[s["서비스_업종_코드_명"] == service_name]
        st = st[st["서비스_업종_코드_명"] == service_name]
    if s.empty or st.empty:
        return None

    merged = s.merge(st[keys + ["점포_수"]], on=keys, how="inner")
    merged["per_store"] = pd.to_numeric(merged["당월_매출_금액"], errors="coerce") \
                         / pd.to_numeric(merged["점포_수"], errors="coerce")
    merged = merged.replace([float("inf"), -float("inf")], None).dropna(subset=["per_store"])
    if merged.empty:
        return None
    return float(merged["per_store"].median())  # robust to outliers


def _avg_monthly_sales(sales: pd.DataFrame, store: pd.DataFrame,
                       area_code: str, service_name: str) -> Optional[float]:
    """점포당 월 매출 ≒ 점포당 분기매출 / 3."""
    qv = _per_store_quarter_sales(sales, store, area_code, service_name)
    if qv is None:
        return None
    return round(qv / 3, -3)


def _avg_district_sales(sales: pd.DataFrame, store: pd.DataFrame, area_df: pd.DataFrame,
                        district: str, service_name: str) -> Optional[float]:
    """자치구 + 업종 점포당 중위 매출 (월 단위)."""
    if area_df.empty or "자치구_코드_명" not in area_df.columns or "상권_코드" not in area_df.columns:
        return None
    codes = list(area_df.loc[area_df["자치구_코드_명"] == district, "상권_코드"].astype(str).unique())
    if not codes:
        return None
    qv = _per_store_quarter_sales(sales, store, "", service_name, area_codes=codes)
    if qv is None:
        return None
    return round(qv / 3, -3)


def _round_won(v: float, unit: int = 10000) -> int:
    """원 단위 → 만원 단위 정렬."""
    return int(round(v / unit) * unit)


@router.get("/finance-recommendation")
def finance_recommendation(area_code: str, service_name: str = ""):
    """선택된 상권+업종에 기반한 사업 조건 추천값."""
    sales   = _get("sales",  load_sales_data)
    store   = _get("store",  load_store_data)
    area_df = _get("area",   load_area)
    rental  = _get("rental", load_rental_trend)

    # 상권 메타 정보
    area_name, district = "", ""
    if not area_df.empty and "상권_코드" in area_df.columns:
        row = area_df[area_df["상권_코드"].astype(str) == str(area_code)]
        if not row.empty:
            area_name = str(row.iloc[0].get("상권_코드_명", ""))
            district  = str(row.iloc[0].get("자치구_코드_명", ""))

    # 1) 월 매출 추정 (소스 우선순위: 상권+업종 점포당 → 자치구+업종 점포당 → 합성)
    LOWER_BOUND = 3_000_000  # 점포당 월매출이 300만원 미만이면 신뢰도 낮음
    monthly = _avg_monthly_sales(sales, store, area_code, service_name)
    monthly_source = "상권+업종 점포당 추정매출 (서울시 추정매출 ÷ 점포수)"
    confidence = "high"
    if monthly is None or monthly < LOWER_BOUND:
        fallback = _avg_district_sales(sales, store, area_df, district, service_name)
        if fallback and fallback >= LOWER_BOUND:
            note_low = " (해당 상권 점포당 매출이 너무 낮아 자치구 평균으로 대체)" if monthly else ""
            monthly = fallback
            monthly_source = f"{district} {service_name} 자치구 평균 점포당 추정매출{note_low}"
            confidence = "medium"
        elif monthly is not None:
            # 상권 데이터는 있으나 너무 낮은 경우: 그대로 사용하되 신뢰도 표시
            confidence = "low"
            monthly_source += " (점포당 매출이 매우 낮음 → 데이터 품질 확인 필요)"
        else:
            synth = generate_synthetic_store(area_code, area_name, service_name, 30_000_000)
            monthly = float(synth["월_매출"])
            monthly_source = "합성 점포 데이터 (해당 데이터 없음 → 시뮬레이션)"
            confidence = "low"

    # 2) 업종 비율 휴리스틱
    cost_ratio  = COST_RATIO.get(service_name, DEFAULT_COST_RATIO)
    labor_ratio = LABOR_RATIO.get(service_name, DEFAULT_LABOR_RATIO)
    rent_ratio  = RENT_RATIO.get(service_name, DEFAULT_RENT_RATIO)

    # 3) 임대료: 월매출 × 비율 (자치구 임대료 인덱스가 있으면 살짝 보정)
    rent_adj = 1.0
    rental_source = "업종 평균 임대료비율 (휴리스틱)"
    try:
        if not rental.empty and "지역" in rental.columns and "임대료지수" in rental.columns:
            r_row = rental[rental["지역"].astype(str).str.contains(district, na=False)]
            if not r_row.empty:
                idx_val = float(pd.to_numeric(r_row["임대료지수"], errors="coerce").mean())
                if idx_val and idx_val > 0:
                    rent_adj = max(0.6, min(1.6, idx_val / 100))
                    rental_source = f"한국부동산원 임대료지수({idx_val:.1f}) 보정"
    except Exception:
        pass

    rent       = _round_won(monthly * rent_ratio * rent_adj, 100_000)
    labor_cost = _round_won(monthly * labor_ratio,           100_000)
    loan_balance = _round_won(monthly * LOAN_MONTHS,         1_000_000)
    cash_balance = _round_won(monthly * CASH_MONTHS,         1_000_000)
    initial_investment = _round_won(monthly * INIT_INVEST_MONTHS, 1_000_000)
    interest_rate = 5.5
    monthly_repayment = _round_won(loan_balance / 60 + loan_balance * interest_rate / 100 / 12, 10_000)
    own_capital = _round_won(max(cash_balance * 0.8, monthly * 0.8), 1_000_000)

    return {
        "area_code": area_code,
        "area_name": area_name,
        "district": district,
        "service_name": service_name,
        "confidence": confidence,
        "values": {
            "monthly_sales":      _round_won(monthly,    100_000),
            "rent":               rent,
            "labor_cost":         labor_cost,
            "loan_balance":       loan_balance,
            "interest_rate":      interest_rate,
            "monthly_repayment":  monthly_repayment,
            "cash_balance":       cash_balance,
            "own_capital":        own_capital,
            "initial_investment": initial_investment,
            "cost_ratio":         cost_ratio,
            "misc_monthly_cost":  _round_won(monthly * 0.02, 100_000),
            "misc_initial_cost":  _round_won(monthly * 0.1, 100_000),
        },
        "sources": {
            "monthly_sales":      monthly_source,
            "rent":               rental_source,
            "labor_cost":         f"매출의 {int(labor_ratio*100)}% (업종 평균 인건비비율)",
            "loan_balance":       f"월매출 × {LOAN_MONTHS} (자영업 평균 부채/매출 배수)",
            "cash_balance":       f"월매출 × {CASH_MONTHS} (자영업 평균 현금보유 개월수)",
            "own_capital":        "현금보유액의 80% + 준비자금 가정 (자기자본 추정)",
            "initial_investment": f"월매출 × {INIT_INVEST_MONTHS} (창업 평균 초기투자 배수)",
            "cost_ratio":         f"{service_name} 업종 평균 원가율" if service_name else "업종 평균 원가율",
            "misc_monthly_cost":  "월매출의 2% (기타 소모성 고정/준고정비 가정)",
            "misc_initial_cost":  "월매출의 10% (오픈 준비 기타비용 가정)",
            "interest_rate":      "신용대출 일반 시장 평균 (참고치)",
            "monthly_repayment":  "원리금 균등상환 60개월 가정 (보정 가능)",
        },
        "notes": [
            "이 값들은 공공데이터 + 업종 평균 휴리스틱으로 계산된 추천 default입니다.",
            "실제 점포 영업 시점에는 임대 계약, 원자재 단가, 인건비 구성 등으로 달라질 수 있습니다.",
            "분석을 진행한 뒤 결과 화면의 '자금·손익분기점' 탭에서 입력값/합성/파생 항목을 다시 확인할 수 있습니다.",
        ],
        "explanation": {
            "monthly_sales": {
                "formula": "선택 상권·업종 분기 추정매출 ÷ 3개월 ÷ 동일 업종 점포 수 (점포당 분기 매출을 월로 환산)",
                "basis": "서울시 상권 추정매출 + 점포 데이터",
                "caution": "개별 점포 실제 매출과 다를 수 있음",
            },
            "rent": {
                "formula": "예상 월매출 × 업종별 임대료 부담률 × 지역 보정계수",
                "basis": "업종 운영 템플릿 + 임대료 지표(가능 시 한국부동산원 지수 반영)",
                "caution": "실제 임대료는 면적, 층수, 계약조건에 따라 다름",
            },
            "labor_cost": {
                "formula": "예상 월매출 × 업종별 인건비 비율 (직원 수 가정을 매출 비율로 근사)",
                "basis": "업종 운영 템플릿(노동비중 휴리스틱)",
                "caution": "근무시간과 고용형태에 따라 달라짐",
            },
            "funding_check_gap": {
                "formula": "최소 권장 현금보유액(월 고정비 × 3개월) − 현재 현금보유액",
                "basis": "입력·자동채움 값으로부터 월 고정비 합성 후 산출",
                "caution": "대출 추천이 아니라 자금 점검 참고값",
            },
            "cash_runway_months": {
                "formula": "현금보유액 ÷ 월 고정비(임대·인건비·이자·기타 월비 합)",
                "basis": "입력값 또는 시뮬레이션 기본값 기반",
                "caution": "매출 변동이 크면 실제 버틸 수 있는 기간은 달라질 수 있음",
            },
        },
    }
