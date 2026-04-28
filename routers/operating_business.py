"""운영 중 사업자 자동진단 (목업 API)."""
import copy
from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


MOCK_PROFILE: Dict[str, Any] = {
    "store_profile": {
        "store_id": "STORE_001",
        "business_no_masked": "123-**-67890",
        "store_name": "카페 고덕라운지",
        "industry": "카페",
        "sub_industry": "일반카페",
        "address": "서울 강동구 고덕동",
        "district": "고덕2동",
        "market_area": "고덕역 생활상권",
        "operation_months": 18,
    },
    "card_sales_profile": {
        "source": "shinhan_card_merchant",
        "monthly_card_sales": 18500000,
        "sales_last_3_months": [19200000, 18800000, 18500000],
        "sales_last_6_months": [20100000, 19800000, 19500000, 19200000, 18800000, 18500000],
        "approval_count": 3557,
        "average_ticket": 5200,
        "daily_average_approval_count": 119,
        "revisit_ratio": 32,
        "new_customer_ratio": 68,
        "mom_sales_pct": -3.8,
        "prev_month_card_sales": 19200000,
        "weekday_sales_ratio": 62,
        "weekend_sales_ratio": 38,
        "week_sales_ratio": {"mon": 13, "tue": 12, "wed": 14, "thu": 15, "fri": 16, "sat": 18, "sun": 12},
        "time_sales_ratio": {"morning": 12, "lunch": 31, "afternoon": 18, "evening": 30, "night": 9},
    },
    "card_spending_profile": {
        "source": "shinhan_business_card",
        "monthly_card_spending": 7200000,
        "corporate_card_spending": 2800000,
        "business_card_spending": 4400000,
        "spending_by_category": {
            "materials": 4100000,
            "delivery_platform": 700000,
            "marketing": 380000,
            "utility": 620000,
            "vehicle": 300000,
            "subscription": 260000,
            "etc": 840000,
        },
        "category_labels_ko": {
            "materials": "원재료·식자재",
            "delivery_platform": "배달·플랫폼",
            "marketing": "광고·마케팅",
            "utility": "공과금·통신",
            "vehicle": "주유·차량",
            "subscription": "렌탈·구독",
            "etc": "기타",
        },
        "mom_change_pct": {
            "materials": 12,
            "delivery_platform": 18,
            "marketing": 22,
            "utility": 5,
            "vehicle": -3,
            "subscription": 8,
            "etc": 4,
        },
        "prev_month_spending_by_category": {
            "materials": 3660000,
            "delivery_platform": 593000,
            "marketing": 311000,
            "utility": 590000,
            "vehicle": 309000,
            "subscription": 241000,
            "etc": 807000,
        },
        "total_spending_last_3_months": [7520000, 7360000, 7200000],
        "card_spending_ratio_vs_sales": round(7200000 / 18500000, 4),
        "materials_ratio_vs_sales": round(4100000 / 18500000, 4),
        "has_business_card": True,
        "has_corporate_card": False,
        "personal_business_mixed_risk": "medium",
        "top_increase_categories_3m": ["광고·마케팅", "배달·플랫폼", "원재료·식자재"],
    },
    "bank_account_profile": {
        "source": "shinhan_bank",
        "current_deposit_balance": 22790000,
        "average_balance_3m": 18400000,
        "monthly_inflow": 21400000,
        "monthly_outflow": 19700000,
        "lowest_balance_1m": 8200000,
        "scheduled_outflow_next_30d": 12300000,
        "savings_deposit_balance": 5000000,
        "tax_reserved_estimate": 2100000,
        "recurring_payments": [
            {"name": "임대료", "amount": 2800000, "day": 5},
            {"name": "카드대금", "amount": 4200000, "day": 10},
            {"name": "급여", "amount": 4200000, "day": 15},
            {"name": "대출 상환", "amount": 1350000, "day": 20},
            {"name": "공과금", "amount": 620000, "day": 25},
        ],
        "daily_balance_curve": [
            {"day": 1, "balance": 21800000},
            {"day": 3, "balance": 21200000},
            {"day": 5, "balance": 18400000},
            {"day": 7, "balance": 18100000},
            {"day": 10, "balance": 13900000},
            {"day": 12, "balance": 13650000},
            {"day": 15, "balance": 9450000},
            {"day": 17, "balance": 9100000},
            {"day": 20, "balance": 7750000},
            {"day": 22, "balance": 8400000},
            {"day": 25, "balance": 7780000},
            {"day": 28, "balance": 9100000},
            {"day": 30, "balance": 22790000},
        ],
        "monthly_in_out_6m": [
            {"label": "11월", "inflow": 20500000, "outflow": 18800000},
            {"label": "12월", "inflow": 20800000, "outflow": 19100000},
            {"label": "1월", "inflow": 21100000, "outflow": 19300000},
            {"label": "2월", "inflow": 21200000, "outflow": 19450000},
            {"label": "3월", "inflow": 21400000, "outflow": 19600000},
            {"label": "4월", "inflow": 21400000, "outflow": 19700000},
        ],
        "estimated_rent_monthly": 2800000,
        "estimated_payroll_monthly": 4200000,
        "large_inflow_notes": [{"date": "4일", "amount": 5200000, "memo": "주말 카드 매출 입금"}],
    },
    "loan_profile": {
        "source": "shinhan_bank_card",
        "total_loan_balance": 45000000,
        "loan_count": 2,
        "average_interest_rate": 8.7,
        "highest_interest_rate": 12.9,
        "monthly_repayment": 1350000,
        "high_interest_loan_exists": True,
        "maturity_within_3m": False,
        "refinance_candidate": True,
        "cardloan_or_cash_service": True,
        "loan_contracts": [
            {
                "id": "L1",
                "nickname": "사업자 운전자금",
                "product_group": "운전자금 대출",
                "principal_balance": 32000000,
                "annual_rate_pct": 7.9,
                "monthly_repayment": 980000,
                "maturity_date": "2027-08-15",
                "remaining_months": 28,
            },
            {
                "id": "L2",
                "nickname": "카드론(일부)",
                "product_group": "카드 금융",
                "principal_balance": 13000000,
                "annual_rate_pct": 12.9,
                "monthly_repayment": 370000,
                "maturity_date": "2026-11-30",
                "remaining_months": 9,
            },
        ],
    },
    "insurance_profile": {
        "source": "shinhan_life_ez",
        "monthly_premium": 86000,
        "coverage": {
            "fire": True,
            "liability": False,
            "property": False,
            "worker": False,
            "vehicle": False,
            "business_interruption": False,
        },
        "insurance_gap": ["liability", "property", "business_interruption"],
        "enrolled_product_groups": [
            {"insurer": "신한라이프", "label": "점포 화재 기본(가칭)", "monthly_premium": 86000, "note": "화재 위주"},
        ],
    },
    "external_market_profile": {
        "market_average_sales": 20100000,
        "top_20_sales": 24700000,
        "average_ticket": 5400,
        "average_daily_customers": 145,
        "competitor_count": 12,
        "new_openings_6m": 2,
        "closures_6m": 1,
        "market_growth_score": 63,
        "competition_score": 76,
        "floating_pop_index": 72,
        "resident_pop_index": 58,
        "worker_pop_index": 64,
        "market_share_proxy_pct": 4.2,
    },
    "user_confirmation_hints": [
        {"id": "q1", "question": "매월 280만 원 출금을 임대료로 분류해도 될까요?", "suggested_answer": "예"},
        {"id": "q2", "question": "매월 420만 원 출금을 급여(인건비)로 분류해도 될까요?", "suggested_answer": "예"},
        {"id": "q3", "question": "타 금융기관 운전자금 대출이 추가로 있나요?", "suggested_answer": "아니오(목업)"},
    ],
}

STORE_OVERLAYS: Dict[str, Dict[str, Any]] = {
    "STORE_002": {
        "store_profile": {
            "business_no_masked": "456-**-11223",
            "store_name": "고덕 모닝커피",
            "sub_industry": "테이크아웃 카페",
            "address": "서울 강동구 상일동",
            "district": "상일1동",
            "market_area": "상일역 인근 생활상권",
            "operation_months": 26,
        },
        "card_sales_profile": {
            "monthly_card_sales": 16400000,
            "sales_last_3_months": [16200000, 16300000, 16400000],
            "sales_last_6_months": [15900000, 16000000, 16100000, 16200000, 16300000, 16400000],
            "approval_count": 2980,
            "average_ticket": 5100,
            "daily_average_approval_count": 99,
            "revisit_ratio": 38,
            "new_customer_ratio": 62,
            "mom_sales_pct": 0.6,
            "prev_month_card_sales": 16300000,
            "weekday_sales_ratio": 68,
            "weekend_sales_ratio": 32,
        },
        "card_spending_profile": {
            "monthly_card_spending": 6100000,
            "business_card_spending": 4100000,
            "corporate_card_spending": 2000000,
            "has_corporate_card": True,
            "total_spending_last_3_months": [5980000, 6050000, 6100000],
            "card_spending_ratio_vs_sales": round(6100000 / 16400000, 4),
            "materials_ratio_vs_sales": round(3500000 / 16400000, 4),
            "spending_by_category": {
                "materials": 3500000,
                "delivery_platform": 620000,
                "marketing": 340000,
                "utility": 580000,
                "vehicle": 280000,
                "subscription": 240000,
                "etc": 780000,
            },
            "mom_change_pct": {"materials": 4, "delivery_platform": 9, "marketing": 11, "utility": 3, "vehicle": 0, "subscription": 5, "etc": 2},
        },
        "bank_account_profile": {
            "current_deposit_balance": 15200000,
            "average_balance_3m": 14100000,
            "monthly_inflow": 17800000,
            "monthly_outflow": 17100000,
            "lowest_balance_1m": 6200000,
            "scheduled_outflow_next_30d": 10800000,
            "savings_deposit_balance": 3200000,
            "tax_reserved_estimate": 1800000,
        },
        "loan_profile": {
            "total_loan_balance": 28000000,
            "loan_count": 1,
            "average_interest_rate": 7.2,
            "highest_interest_rate": 7.2,
            "monthly_repayment": 920000,
            "high_interest_loan_exists": False,
            "cardloan_or_cash_service": False,
            "loan_contracts": [
                {
                    "id": "L1",
                    "nickname": "사업자 운전자금",
                    "product_group": "운전자금 대출",
                    "principal_balance": 28000000,
                    "annual_rate_pct": 7.2,
                    "monthly_repayment": 920000,
                    "maturity_date": "2028-01-10",
                    "remaining_months": 33,
                },
            ],
        },
        "external_market_profile": {
            "market_average_sales": 17800000,
            "top_20_sales": 22100000,
            "average_ticket": 5200,
            "average_daily_customers": 128,
            "competitor_count": 9,
            "competition_score": 68,
        },
    },
}


def _deep_merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in patch.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _profile_for_store(store_id: str) -> Dict[str, Any]:
    base = copy.deepcopy(MOCK_PROFILE)
    overlay = STORE_OVERLAYS.get(store_id)
    if overlay:
        return _deep_merge(base, overlay)
    return base


_BENCHMARK_NOTES: Dict[str, List[dict]] = {}
_ACTION_PLANS: Dict[str, List[dict]] = {}
_SAVED_REPORTS: Dict[str, List[dict]] = {}


def _shinhan_group_product_recommendations() -> List[Dict[str, Any]]:
    """
    신한금융그룹 계열사 ↔ 본 진단 데이터 연계(목업).
    특정 상품명 대신 상품군·점검 경로 안내. 실제 조건은 각 계열사 심사·약관에 따름.
    """
    return [
        {
            "priority": 1,
            "axis": "리스크 보장",
            "subsidiary": "신한라이프",
            "subsidiary_kind": "life",
            "product_group": "영업배상·고객안전(배상) 보장 점검",
            "linked_diagnosis": "그룹 연계 보험 조회 결과·영업배상 미가입 / 카페 등 방문형 업종",
            "reason": "손님 안전사고·시설물 배상 리스크가 있는데 그룹 데이터상 배상 관련 보장이 비어 있습니다.",
            "caution": "실제 가입 가능 여부·보험료·보장 범위는 상품별 약관 및 심사 결과에 따라 달라질 수 있습니다.",
            "cta_action": "life_liability",
            "official_channel": "신한라이프 공식 채널 · 1577-6363",
        },
        {
            "priority": 2,
            "axis": "리스크 보장",
            "subsidiary": "신한EZ손해보험",
            "subsidiary_kind": "ez",
            "product_group": "화재·재산종합·영업 배상(손해) 특약 점검",
            "linked_diagnosis": "동일 진단에서 재산·시설·영업중단 보장 공백·화재만 부분 가입",
            "reason": "점포·집기 손해와 휴업 등은 손해보험 쪽 특약 설계가 필요한 경우가 많습니다.",
            "caution": "동일 건물·임차 조건에 따라 가입 가능 여부가 달라질 수 있습니다.",
            "cta_action": "ez_sme_risk",
            "official_channel": "신한EZ손해보험 공식 채널(그룹 계열 안내)",
        },
        {
            "priority": 3,
            "axis": "자금 조달",
            "subsidiary": "신한은행",
            "subsidiary_kind": "bank",
            "product_group": "사업자 대출·대환(금리·상환) 조건 점검",
            "linked_diagnosis": "신한 연계 대출 데이터·평균 금리·월 상환액·매출 대비 부담률",
            "reason": "그룹 내 대출 금리·상환이 현재 카드 매출 추이와 함께 보면 부담 구간에 들어갈 수 있습니다.",
            "caution": "실제 금리·한도·대환 가능 여부는 금융심사 및 기존 금융사 조건에 따라 달라질 수 있습니다.",
            "cta_action": "bank_refinance",
            "official_channel": "신한은행 영업점·디지털 기업뱅킹 · 1577-8000",
        },
        {
            "priority": 4,
            "axis": "자금 조달",
            "subsidiary": "신한은행",
            "subsidiary_kind": "bank",
            "product_group": "운전자금·정산 리스크 완충",
            "linked_diagnosis": "사업자 계좌 입출금·월중 최저 잔액·예정 지출 대비 현금 버퍼",
            "reason": "카드 매출 입금 전에 고정비가 몰리는 구간이 있어 운전자금·한도 성격 점검이 필요할 수 있습니다.",
            "caution": "대출 실행 여부와 조건은 심사 결과에 따릅니다.",
            "cta_action": "bank_working",
            "official_channel": "신한은행 기업 고객 채널",
        },
        {
            "priority": 5,
            "axis": "지출 관리",
            "subsidiary": "신한카드",
            "subsidiary_kind": "card",
            "product_group": "사업자·법인카드 경비 분리·업종별 지출 구조",
            "linked_diagnosis": "신한 사업자·법인카드 승인 데이터·카테고리별 지출·전월 대비 증가 항목",
            "reason": "매출 대비 원재료·광고비 비중이 커지고 있어 지출 분리와 한도·혜택 점검이 유리합니다.",
            "caution": "카드 혜택·한도는 상품별 조건에 따라 달라질 수 있습니다.",
            "cta_action": "card_business_card",
            "official_channel": "신한카드 가맹·법인 고객센터 · 1544-7000",
        },
        {
            "priority": 6,
            "axis": "매출 관리",
            "subsidiary": "신한카드",
            "subsidiary_kind": "card",
            "product_group": "가맹점 매출·정산·입금 일정 점검",
            "linked_diagnosis": "신한카드 가맹점 승인·매출 추이·시간대 비중",
            "reason": "동일 계열 카드 매출 데이터와 정산 주기를 맞춰 보면 현금 흐름 예측이 쉬워집니다.",
            "caution": "정산일·수수료는 가맹 계약 및 카드사 정책에 따릅니다.",
            "cta_action": "card_settlement",
            "official_channel": "신한카드 가맹점 서비스",
        },
        {
            "priority": 7,
            "axis": "성장·자산",
            "subsidiary": "신한투자증권",
            "subsidiary_kind": "invest",
            "product_group": "사업 성장 단계·여유자금 운용 방향 상담",
            "linked_diagnosis": "현금 사용 가능액·안전자금·매출 변동 시나리오",
            "reason": "운영 안전자금을 확보한 뒤 성장·운용 전략을 검토하는 단계에서 그룹 내 증권 채널과 연계해 볼 수 있습니다.",
            "caution": "투자 상품은 원금 손실 가능성이 있으며, 상품 설명서를 확인해야 합니다.",
            "cta_action": "inv_growth",
            "official_channel": "신한투자증권 · 1588-0365",
        },
    ]


def _shinhan_product_cards_for_operating() -> List[Dict[str, Any]]:
    """운영 사업자 API용: 구 필드명(group, company) 호환 + 신규 필드."""
    out: List[Dict[str, Any]] = []
    for row in _shinhan_group_product_recommendations():
        item = dict(row)
        item["group"] = row["product_group"]
        item["company"] = row["subsidiary"]
        out.append(item)
    return out


def _shinhan_product_cards_for_financial() -> List[Dict[str, Any]]:
    """금융 점검 API용 카드 레이아웃."""
    rows = []
    for row in _shinhan_group_product_recommendations():
        rows.append(
            {
                "priority": row["priority"],
                "area": row["axis"],
                "status": "점검 권장" if row["priority"] <= 4 else "연계 활용",
                "subsidiary": row["subsidiary"],
                "subsidiary_kind": row["subsidiary_kind"],
                "group": row["product_group"],
                "linked_diagnosis": row["linked_diagnosis"],
                "why": row["reason"],
                "note": row["caution"],
                "cta_action": row.get("cta_action"),
                "official_channel": row.get("official_channel", ""),
            }
        )
    return rows


class OperatingAnalyzeRequest(BaseModel):
    main_concern: str = "잘 모르겠음"
    external_loan_exists: str = "없음"
    external_insurance_exists: str = "없음"
    planned_large_expense: str = "없음"
    comparison_range: str = "500m"


class CashAdviceRequest(BaseModel):
    planned_use_amount: int = 0
    planned_use_purpose: str = "기타"


class LoanSimulationRequest(BaseModel):
    scenario: str = "금리 2%p 인하"


class BenchmarkNoteRequest(BaseModel):
    store_name: str = ""
    visit_time: str = ""
    best_menu: str = ""
    menu_price: int = 0
    memo: str = ""


class ActionPlanRequest(BaseModel):
    focus: str = "현금흐름 개선"


class ActionStatusPatch(BaseModel):
    status: str


class FinancialAnalyzeRequest(BaseModel):
    main_financial_concern: str = "잘 모르겠음"
    external_loan_exists: bool = False
    external_insurance_exists: bool = False
    planned_large_expense: str = "없음"
    planned_use_amount: int = 0
    planned_use_purpose: str = "기타"


class FinancialCashAdviceRequest(BaseModel):
    planned_use_amount: int = 0
    planned_use_purpose: str = "기타"


class FinancialStressRequest(BaseModel):
    scenario: str = "sales_down_20"


@router.get("/shinhan/business/connection-status")
def connection_status():
    return {
        "card_merchant_connected": True,
        "business_card_connected": True,
        "bank_account_connected": True,
        "loan_connected": True,
        "life_insurance_connected": True,
        "ez_insurance_connected": True,
    }


@router.get("/shinhan/business/stores")
def business_stores():
    return {
        "stores": [
            {
                "store_id": "STORE_001",
                "store_name": "카페 고덕라운지",
                "business_no_masked": "123-**-67890",
                "industry": "카페",
                "address": "서울 강동구 고덕동",
                "market_area": "고덕역 생활상권",
                "monthly_card_sales": 18500000,
                "sales_trend": "decreasing",
                "sales_trend_pct": -3.8,
                "connected_sources": ["card", "bank", "loan", "insurance"],
                "has_loan": True,
                "has_insurance": True,
                "risk_flags": ["월중 최저 잔액 구간", "보험 보장 공백"],
            },
            {
                "store_id": "STORE_002",
                "store_name": "고덕 모닝커피",
                "business_no_masked": "456-**-11223",
                "industry": "카페",
                "address": "서울 강동구 상일동",
                "market_area": "상일역 생활상권",
                "monthly_card_sales": 16400000,
                "sales_trend": "flat",
                "sales_trend_pct": 0.6,
                "connected_sources": ["card", "bank"],
                "has_loan": True,
                "has_insurance": True,
                "risk_flags": ["보험 특약 범위 점검"],
            },
        ]
    }


@router.get("/shinhan/business/{store_id}/integrated-profile")
def integrated_profile(store_id: str):
    prof = _profile_for_store(store_id)
    prof["store_profile"]["store_id"] = store_id
    return prof


def _build_benchmark_pack(
    store_id: str, p: Dict[str, Any], comparison_range: str = "500m"
) -> Dict[str, Any]:
    """주변 매장 벤치마킹 탭용: 비교반경·상권·업종을 반영한 목업 안내."""
    sp = p.get("store_profile") or {}
    mk = p.get("external_market_profile") or {}
    industry = sp.get("industry") or "동일 업종"
    market_area = sp.get("market_area") or ""
    sub = sp.get("sub_industry") or ""
    comp_n = mk.get("competitor_count")
    comp_score = mk.get("competition_score")

    peer_line = (
        f"목업 통계상 반경 인근 동일 업종 매장은 약 {comp_n}곳"
        if comp_n is not None
        else "동일 업종 매장 밀도는 상권 통계 기준으로 확인"
    )
    if comp_score is not None:
        peer_line += f", 경쟁 강도 지수는 약 {comp_score}점(참고)입니다."

    visit_store_types = [
        f"반경 {comparison_range} 내 매출·리뷰 반응이 빠른 {industry}",
        (
            f"{market_area} 일대에서 오후·저녁 시간대 비중 패턴이 다른 매장"
            if market_area
            else "상권 내 시간대별 매출 비중이 우리 매장과 다른 매장"
        ),
        "포장·테이크아웃 동선과 가격·원가 표시가 명확한 근처 매장",
    ]
    if sub:
        visit_store_types.insert(1, f"{sub} 성격을 살린 소형 브랜드·직영 매장")

    checklist = [
        "대표 메뉴 가격·원가·마진(세트 구성 포함)",
        "오후(14~17시) 프로모션·디저트 번들 유무",
        "포장 할인·적립·재방문 쿠폰 조건",
        "배달앱 카테고리·대표 사진·리뷰 키워드",
        "피크 시간 대기·테이블 회전·결제 방식",
        "직원 수·포장 전담 동선·주문 처리 방식",
        peer_line,
    ]

    apply_ideas = [
        "오후 한정 세트 또는 음료+디저트 번들 2주 시범 운영",
        "포장 채널 전용 소액 할인 코드로 재방문률 측정(A/B)",
        "원재료 단가 변동 큰 메뉴의 판매 비중 조정·메뉴판 재배치",
    ]

    notes = (
        f"비교 반경은 분석 입력값 기준 {comparison_range}입니다. "
        f"{peer_line} "
        "현장 메모는 POST /benchmark-note 로 누적할 수 있습니다(목업)."
    )

    return {
        "visit_store_types": visit_store_types,
        "checklist": checklist,
        "apply_ideas": apply_ideas,
        "notes": notes,
        "comparison_range": comparison_range,
        "market_area_label": market_area or "선택 상권",
        "peer_summary": peer_line,
    }


def _operating_analysis_payload(
    main_concern: str = "잘 모르겠음",
    store_id: str = "STORE_001",
    comparison_range: str = "500m",
):
    p = _profile_for_store(store_id)
    sales = p["card_sales_profile"]["monthly_card_sales"]
    market_avg = p["external_market_profile"]["market_average_sales"]
    top20 = p["external_market_profile"]["top_20_sales"]
    top_gap = max(0, top20 - sales)
    position_ratio = round(sales / market_avg, 2) if market_avg else 0
    balance = p["bank_account_profile"]["current_deposit_balance"]
    tax_reserved = p["bank_account_profile"]["tax_reserved_estimate"]
    monthly_repay = p["loan_profile"]["monthly_repayment"]
    monthly_required = 2800000 + 4200000 + 620000 + monthly_repay + p["insurance_profile"]["monthly_premium"]
    safety_cash = 14500000
    available_cash = max(0, balance + sales - p["bank_account_profile"]["scheduled_outflow_next_30d"] - safety_cash - tax_reserved)
    av_won = int(available_cash)
    return {
        "score": 66 if store_id == "STORE_001" else 71,
        "grade": "주의" if store_id == "STORE_001" else "양호",
        "summary": (
            "매출은 상권 평균에 근접하지만 현금 일부는 반드시 남겨둬야 하며 대출 이자와 보험 공백을 먼저 점검해야 합니다."
            if store_id == "STORE_001"
            else "매출 추이는 완만히 회복 중이며 대출 부담은 상대적으로 낮습니다. 다만 보험 보장 공백과 카드 비용 비중은 계속 확인이 필요합니다."
        ),
        "strengths": (
            ["객단가는 상권 평균과 비슷한 편입니다.", "점심 시간대 매출 비중은 비교적 안정적입니다.", "신한 데이터로 매출 추세 분석이 가능합니다."]
            if store_id == "STORE_001"
            else ["최근 3개월 매출이 소폭 상승 추세입니다.", "대출 금리 부담이 상대적으로 낮은 편입니다.", "테이크아웃 비중 확대 여지가 있습니다."]
        ),
        "risk_points": (
            ["최근 3개월 카드 매출 감소", "월중 통장 최저 잔액 구간 존재", "영업배상 등 보장 공백", "원재료·광고비 지출 증가"]
            if store_id == "STORE_001"
            else ["보험 보장 범위가 업종 대비 좁을 수 있음", "법인·사업자 카드 병행으로 비용 추적 분리 필요"]
        ),
        "urgent_actions": [
            "오후 시간대 매출 회복",
            f"사용 가능 금액 {av_won // 10000}만 원 이내로 큰 지출 제한",
            "영업배상책임보험 보장 확인",
        ],
        "cash_advice": {
            "current_balance": balance,
            "minimum_safety_cash": safety_cash,
            "tax_reserved": tax_reserved,
            "available_cash": available_cash,
            "monthly_required_cash": monthly_required,
            "message": f"현재 예치금 중 약 {av_won // 10000}만 원까지만 사용하는 것이 안전합니다.",
        },
        "benchmark_pack": _build_benchmark_pack(store_id, p, comparison_range),
        "sales_insight": {
            "monthly_sales": sales,
            "market_average": market_avg,
            "top_20": top20,
            "position_ratio": position_ratio,
            "top_gap": top_gap,
            "main_reason": "방문 고객 수 감소",
            "message": "객단가는 유지되고 있지만 승인 건수가 줄고 있습니다.",
        },
        "spending_insight": {
            "monthly_card_spending": p["card_spending_profile"]["monthly_card_spending"],
            "spending_ratio_vs_sales": p["card_spending_profile"]["card_spending_ratio_vs_sales"],
            "materials_ratio_vs_sales": p["card_spending_profile"]["materials_ratio_vs_sales"],
            "highest_category": "원재료",
            "risk": "원재료비 증가",
            "message": "매출은 감소했지만 원재료비는 증가했습니다.",
            "diagnosis": (
                f"신한 사업자·법인카드 합산 월 지출은 약 {p['card_spending_profile']['monthly_card_spending'] // 10000}만 원이며, "
                f"월 카드 매출 대비 약 {round(p['card_spending_profile']['card_spending_ratio_vs_sales'] * 100, 1)}%입니다. "
                "원재료·식자재 비중이 가장 크고, 전월 대비 광고·배달 항목 증가폭을 함께 보시는 것이 좋습니다."
            ),
        },
        "cashflow_insight": {
            "monthly_inflow": p["bank_account_profile"]["monthly_inflow"],
            "monthly_outflow": p["bank_account_profile"]["monthly_outflow"],
            "net_cash_flow": p["bank_account_profile"]["monthly_inflow"] - p["bank_account_profile"]["monthly_outflow"],
            "lowest_balance": p["bank_account_profile"]["lowest_balance_1m"],
            "risk_days": ["10일", "15일", "20일"],
            "message": "10일~20일 사이 지출이 집중되어 월중 현금 부족 가능성이 있습니다.",
            "daily_balance_curve": p["bank_account_profile"].get("daily_balance_curve", []),
            "monthly_in_out_6m": p["bank_account_profile"].get("monthly_in_out_6m", []),
        },
        "loan_insight": {
            "total_loan_balance": p["loan_profile"]["total_loan_balance"],
            "average_interest_rate": p["loan_profile"]["average_interest_rate"],
            "highest_interest_rate": p["loan_profile"]["highest_interest_rate"],
            "monthly_repayment": p["loan_profile"]["monthly_repayment"],
            "interest_burden_ratio": round(
                (p["loan_profile"]["total_loan_balance"] * p["loan_profile"]["average_interest_rate"] / 100 / 12)
                / max(1, sales),
                4,
            ),
            "repayment_burden_ratio": round(p["loan_profile"]["monthly_repayment"] / sales, 3),
            "refinance_candidate": bool(p["loan_profile"].get("refinance_candidate", True)),
            "message": (
                f"월 상환액은 매출의 약 {round(100 * p['loan_profile']['monthly_repayment'] / max(1, sales), 1)}% 수준입니다. "
                f"평균 금리 {p['loan_profile']['average_interest_rate']}% 기준 이자 부담을 점검하고, 실제 가능 여부는 심사가 필요하지만 "
                "대환·조건 변경 가능성 확인을 권장합니다."
            ),
        },
        "insurance_insight": {
            "gaps": ["영업배상책임", "재산종합", "영업중단"],
            "message": "고객 방문형 매장이지만 배상책임 보장이 부족합니다.",
            "monthly_premium": p["insurance_profile"]["monthly_premium"],
            "coverage_rows": [
                {"key": "fire", "label": "화재", "ok": p["insurance_profile"]["coverage"]["fire"]},
                {"key": "liability", "label": "영업배상책임", "ok": p["insurance_profile"]["coverage"]["liability"]},
                {"key": "property", "label": "재산·시설", "ok": p["insurance_profile"]["coverage"]["property"]},
                {"key": "worker", "label": "근로자 관련", "ok": p["insurance_profile"]["coverage"]["worker"]},
                {"key": "vehicle", "label": "차량·배달", "ok": p["insurance_profile"]["coverage"]["vehicle"]},
                {"key": "business_interruption", "label": "영업중단", "ok": p["insurance_profile"]["coverage"]["business_interruption"]},
            ],
        },
        "recommended_product_groups": _shinhan_product_cards_for_operating(),
        "main_concern": main_concern,
    }


@router.post("/shinhan/business/{store_id}/operating/analyze")
def operating_analyze(store_id: str, req: OperatingAnalyzeRequest):
    out = _operating_analysis_payload(req.main_concern, store_id, req.comparison_range)
    out["store_id"] = store_id
    out["integrated_profile"] = integrated_profile(store_id)
    out["loan_scenarios"] = loan_simulation(store_id, LoanSimulationRequest())["scenarios"]
    return out


@router.post("/shinhan/business/{store_id}/cash-advice")
def cash_advice(store_id: str, req: CashAdviceRequest):
    base = _operating_analysis_payload(store_id=store_id, comparison_range="500m")
    available = base["cash_advice"]["available_cash"]
    decision = "추천" if req.planned_use_amount <= available else "비추천"
    alt = "200만~300만 원 규모의 소규모 개선부터 진행하는 것을 권장합니다."
    return {
        "store_id": store_id,
        "current_balance": base["cash_advice"]["current_balance"],
        "available_cash": available,
        "planned_use_amount": req.planned_use_amount,
        "decision": decision,
        "message": (
            f"현재 사용 가능 금액은 약 {available:,}원입니다. "
            f"{req.planned_use_purpose}에 {req.planned_use_amount:,}원을 사용하면 최소 운영 안전자금이 부족해질 수 있습니다."
        ) if decision == "비추천" else "현재 범위 내 지출입니다. 지출 후에도 안전자금이 유지되는지 주간 단위로 점검하세요.",
        "alternative": alt if decision == "비추천" else "",
    }


@router.get("/shinhan/business/{store_id}/product-gap")
def product_gap(store_id: str):
    return {
        "store_id": store_id,
        "shinhan_group_headline": "신한금융그룹 계열 연계 커버리지",
        "shinhan_group_note": (
            "아래 영역은 신한은행·신한카드·신한라이프·신한EZ손해보험·신한투자증권 등 그룹 내 "
            "데이터·채널과 연동해 점검할 수 있는 축입니다. 특정 상품 판매가 아닌 부족 영역 진단용입니다."
        ),
        "coverage": [
            {
                "axis": "매출 관리",
                "status": "이용 중",
                "subsidiary": "신한카드",
                "touchpoint": "가맹점 매출·승인·시간대 데이터",
                "summary": "본 진단의 카드 매출·상권 비교와 동일 출처 체계",
            },
            {
                "axis": "지출 관리",
                "status": "일부 보완",
                "subsidiary": "신한카드",
                "touchpoint": "사업자·법인카드 이용·카테고리 지출",
                "summary": "비용 분리·증가 카테고리 분석과 직접 연계",
            },
            {
                "axis": "현금 관리",
                "status": "이용 중",
                "subsidiary": "신한은행",
                "touchpoint": "사업자 계좌 입출금·예정 지출",
                "summary": "현금흐름·사용 가능액 진단과 동일 계좌 데이터",
            },
            {
                "axis": "자금 조달",
                "status": "조건 점검 권장",
                "subsidiary": "신한은행",
                "touchpoint": "대출 잔액·금리·월 상환",
                "summary": "대환·운전자금 검토 시 동일 계열 대출 정보 활용",
            },
            {
                "axis": "리스크 보장",
                "status": "보장 공백",
                "subsidiary": "신한라이프·신한EZ손해보험",
                "touchpoint": "화재·배상·재산·영업중단 등",
                "summary": "그룹 연계 보험 조회 결과와 보장 공백 카드 연동",
            },
            {
                "axis": "성장·자산",
                "status": "선택 검토",
                "subsidiary": "신한투자증권",
                "touchpoint": "성장 단계·여유자금 방향",
                "summary": "안전자금 확보 후 단계적 검토 시 그룹 내 증권 채널 안내",
            },
        ],
        "recommended_items": _shinhan_product_cards_for_operating(),
    }


@router.get("/shinhan/business/{store_id}/insurance-gap")
def insurance_gap(store_id: str):
    cov = _profile_for_store(store_id)["insurance_profile"]["coverage"]
    keys = [
        ("fire", "화재"),
        ("liability", "영업배상책임"),
        ("property", "재산·시설"),
        ("worker", "근로자 관련"),
        ("vehicle", "차량·배달"),
        ("business_interruption", "영업중단"),
    ]
    coverage_rows = [
        {
            "key": k,
            "label": lab,
            "status": "가입" if cov.get(k) else "미가입",
            "score": 1 if cov.get(k) else 0,
        }
        for k, lab in keys
    ]
    return {
        "store_id": store_id,
        "monthly_premium": _profile_for_store(store_id)["insurance_profile"]["monthly_premium"],
        "coverage_rows": coverage_rows,
        "gaps": [
            {"name": "영업배상책임", "priority": "높음", "reason": "고객 방문형 매장 사고 대비 필요"},
            {"name": "재산종합", "priority": "중간", "reason": "시설물 손상·파손 시 복구비 대비"},
            {"name": "영업중단", "priority": "중간", "reason": "사고 발생 시 영업 중단 손실 완화"},
        ],
    }


@router.post("/shinhan/business/{store_id}/loan-simulation")
def loan_simulation(store_id: str, req: LoanSimulationRequest):
    base = _profile_for_store(store_id)["loan_profile"]
    avg_rate = float(base["average_interest_rate"])
    bal = float(base["total_loan_balance"])
    monthly_repay = int(base["monthly_repayment"])
    current_interest = int(round(bal * avg_rate / 100 / 12))
    i1 = int(round(bal * max(3.5, avg_rate - 1.0) / 100 / 12))
    i2 = int(round(bal * max(3.5, avg_rate - 2.0) / 100 / 12))
    bal_after = max(0.0, bal - 10000000)
    i_partial = int(round(bal_after * avg_rate / 100 / 12))
    scenarios = [
        {
            "name": "현재 조건 유지",
            "monthly_interest": current_interest,
            "monthly_repayment": monthly_repay,
            "loan_balance": int(bal),
        },
        {
            "name": "금리 1%p 인하(추정)",
            "monthly_interest": i1,
            "monthly_repayment": monthly_repay - (current_interest - i1),
            "loan_balance": int(bal),
        },
        {
            "name": "금리 2%p 인하(추정)",
            "monthly_interest": i2,
            "monthly_repayment": monthly_repay - (current_interest - i2),
            "loan_balance": int(bal),
        },
        {
            "name": "일부상환 1천만 원(추정)",
            "monthly_interest": i_partial,
            "monthly_repayment": max(monthly_repay - 95000, int(monthly_repay * 0.92)),
            "loan_balance": int(bal_after),
        },
    ]
    return {"store_id": store_id, "selected": req.scenario, "scenarios": scenarios}


@router.post("/shinhan/business/{store_id}/benchmark-note")
def benchmark_note(store_id: str, req: BenchmarkNoteRequest):
    _BENCHMARK_NOTES.setdefault(store_id, []).append(
        {"created_at": datetime.utcnow().isoformat(), **req.model_dump()}
    )
    return {"ok": True, "count": len(_BENCHMARK_NOTES[store_id])}


@router.post("/shinhan/business/{store_id}/action-plan")
def action_plan(store_id: str, req: ActionPlanRequest):
    plan = [
        {"id": "w1-1", "week": 1, "text": "원재료비 증가 항목 확인", "status": "예정"},
        {"id": "w2-1", "week": 2, "text": "오후 14~17시 세트 메뉴 테스트", "status": "예정"},
        {"id": "w3-1", "week": 3, "text": "카드 지출 카테고리 재분류", "status": "예정"},
        {"id": "w4-1", "week": 4, "text": "매출·원재료비율 변화 점검", "status": "예정"},
    ]
    _ACTION_PLANS[store_id] = plan
    return {"store_id": store_id, "focus": req.focus, "actions": plan}


@router.patch("/shinhan/business/{store_id}/action-plan/{action_id}")
def patch_action_plan(store_id: str, action_id: str, req: ActionStatusPatch):
    plan = _ACTION_PLANS.get(store_id, [])
    for item in plan:
        if item["id"] == action_id:
            item["status"] = req.status
            return {"ok": True, "action": item}
    return {"ok": False, "message": "action not found"}


@router.post("/shinhan/business/{store_id}/report/save")
def save_report(store_id: str):
    _SAVED_REPORTS.setdefault(store_id, []).append(
        {
            "saved_at": datetime.utcnow().isoformat(),
            "summary": _operating_analysis_payload(store_id=store_id, comparison_range="500m")["summary"],
        }
    )
    return {"ok": True, "saved_count": len(_SAVED_REPORTS[store_id])}


def _financial_profile(store_id: str) -> Dict[str, Any]:
    p = _profile_for_store(store_id)
    mom = p["card_spending_profile"].get("mom_change_pct") or {}
    labels_ko = p["card_spending_profile"].get("category_labels_ko") or {}
    sorted_mom = sorted(mom.items(), key=lambda x: -abs(x[1]))[:3]
    increased_categories = [{"category": labels_ko.get(k, k), "increase_rate": int(v)} for k, v in sorted_mom]
    return {
        "store_profile": {
            "store_id": store_id,
            "store_name": p["store_profile"]["store_name"],
            "industry": p["store_profile"]["industry"],
            "address": p["store_profile"]["address"],
            "market_area": p["store_profile"]["market_area"],
        },
        "bank_account_profile": {
            "current_balance": p["bank_account_profile"]["current_deposit_balance"],
            "average_balance_3m": p["bank_account_profile"]["average_balance_3m"],
            "monthly_inflow": p["bank_account_profile"]["monthly_inflow"],
            "monthly_outflow": p["bank_account_profile"]["monthly_outflow"],
            "net_cash_flow": p["bank_account_profile"]["monthly_inflow"] - p["bank_account_profile"]["monthly_outflow"],
            "lowest_balance_1m": p["bank_account_profile"]["lowest_balance_1m"],
            "savings_balance": p["bank_account_profile"]["savings_deposit_balance"],
            "tax_reserved_estimate": p["bank_account_profile"]["tax_reserved_estimate"],
            "scheduled_outflow_next_30d": p["bank_account_profile"]["scheduled_outflow_next_30d"],
            "recurring_payments": p["bank_account_profile"]["recurring_payments"],
            "daily_balance_curve": p["bank_account_profile"].get("daily_balance_curve", []),
            "monthly_in_out_6m": p["bank_account_profile"].get("monthly_in_out_6m", []),
        },
        "card_profile": {
            "monthly_card_sales": p["card_sales_profile"]["monthly_card_sales"],
            "sales_last_3_months": p["card_sales_profile"]["sales_last_3_months"],
            "monthly_business_card_spending": p["card_spending_profile"]["monthly_card_spending"],
            "corporate_card_spending": p["card_spending_profile"]["corporate_card_spending"],
            "business_card_spending": p["card_spending_profile"]["business_card_spending"],
            "card_payment_due": 4200000,
            "payment_due_day": 10,
            "spending_by_category": p["card_spending_profile"]["spending_by_category"],
            "category_labels_ko": p["card_spending_profile"].get("category_labels_ko", {}),
            "mom_change_pct": p["card_spending_profile"].get("mom_change_pct", {}),
            "total_spending_last_3_months": p["card_spending_profile"].get("total_spending_last_3_months", []),
            "increased_categories": increased_categories,
            "mom_sales_pct": p["card_sales_profile"].get("mom_sales_pct"),
            "card_sales_last_3": p["card_sales_profile"].get("sales_last_3_months", []),
        },
        "loan_profile": p["loan_profile"],
        "insurance_profile": p["insurance_profile"],
    }


@router.get("/shinhan/business/financial-check/stores")
def financial_check_stores():
    stores = business_stores()["stores"]
    return {"stores": stores}


@router.get("/shinhan/business/{store_id}/financial-profile")
def financial_profile(store_id: str):
    return _financial_profile(store_id)


def _financial_analysis(store_id: str) -> Dict[str, Any]:
    fp = _financial_profile(store_id)
    bank = fp["bank_account_profile"]
    loan = fp["loan_profile"]
    card = fp["card_profile"]
    insurance = fp["insurance_profile"]
    current = int(bank["current_balance"])
    inflow = int(bank["monthly_inflow"])
    outflow_next = int(bank["scheduled_outflow_next_30d"])
    tax = int(bank["tax_reserved_estimate"])
    premium = int(insurance["monthly_premium"])
    safety_cash = 14500000
    available_cash = max(0, current + inflow - outflow_next - safety_cash - tax - premium)
    loan_repay = int(loan["monthly_repayment"])
    monthly_required = 2800000 + 4200000 + 4200000 + loan_repay + 620000 + premium + tax
    runway = round(current / monthly_required, 1) if monthly_required > 0 else 0.0
    repayment_ratio = round(loan["monthly_repayment"] / card["monthly_card_sales"], 3)
    av_m = available_cash // 10000
    summary = (
        f"통장 잔액만 보면 여유가 있어 보일 수 있어요. 다만 다음 달 나갈 돈과 꼭 남겨둘 안전자금까지 빼면, "
        f"당장 마음 놓고 쓸 수 있는 금액은 대략 {av_m:,}만 원 수준으로 보시는 게 안전합니다. "
        "대출 금리와 카드 지출 증가 항목은 한 번씩 같이 짚어보시길 권합니다."
    )
    product_recommendations = _shinhan_product_cards_for_financial()
    strengths_fc = [
        "사업자 통장 기준 순현금흐름이 마이너스가 아닙니다.",
        "신한 연계 데이터로 카드 매출·지출·대출·보험을 한 화면에서 볼 수 있습니다.",
    ]
    risks_fc = [
        "예정 지출·안전자금·세금 예비를 빼면 쓸 수 있는 금액은 제한적일 수 있습니다.",
        "보험 보장 공백과 카드 비용 증가 항목은 주기적으로 다시 확인하는 것이 좋습니다.",
    ]
    return {
        "financial_health_score": 58 if store_id == "STORE_001" else 62,
        "grade": "주의" if store_id == "STORE_001" else "양호",
        "summary": summary,
        "strengths": strengths_fc,
        "risk_points": risks_fc,
        "current_balance": current,
        "available_cash": available_cash,
        "minimum_safety_cash": safety_cash,
        "cash_runway_months": runway,
        "net_cash_flow": int(bank["net_cash_flow"]),
        "loan_balance": int(loan["total_loan_balance"]),
        "average_interest_rate": float(loan["average_interest_rate"]),
        "monthly_repayment": int(loan["monthly_repayment"]),
        "repayment_burden_ratio": repayment_ratio,
        "insurance_gaps": ["영업배상책임", "재산종합", "영업중단"],
        "urgent_actions": [
            "큰 지출은 620만 원 이내로 제한",
            "대환 가능성 확인",
            "카드 지출 증가 항목 점검",
            "보험 보장 공백 확인",
        ],
        "product_recommendations": product_recommendations,
        "financial_profile": fp,
    }


@router.post("/shinhan/business/{store_id}/financial-check/analyze")
def financial_check_analyze(store_id: str, req: FinancialAnalyzeRequest):
    result = _financial_analysis(store_id)
    result["main_financial_concern"] = req.main_financial_concern
    result["planned_large_expense"] = req.planned_large_expense
    result["planned_use_amount"] = req.planned_use_amount
    result["planned_use_purpose"] = req.planned_use_purpose
    return result


@router.post("/shinhan/business/{store_id}/financial-check/cash-advice")
def financial_check_cash_advice(store_id: str, req: FinancialCashAdviceRequest):
    base = _financial_analysis(store_id)
    available = int(base["available_cash"])
    decision = "비추천" if req.planned_use_amount > available else "추천"
    return {
        "current_balance": base["current_balance"],
        "available_cash": available,
        "planned_use_amount": req.planned_use_amount,
        "decision": decision,
        "message": (
            f"현재 사용 가능 금액은 약 {available:,}원입니다. 인테리어에 {req.planned_use_amount:,}원을 사용하면 최소 운영 안전자금이 부족해질 수 있습니다."
            if decision == "비추천"
            else "사용 가능 금액 범위 내 지출입니다. 지출 후에도 안전자금이 유지되는지 확인하세요."
        ),
        "alternative": "200만~300만 원 규모의 소규모 개선부터 진행하는 것을 권장합니다." if decision == "비추천" else "",
    }


@router.get("/shinhan/business/{store_id}/financial-check/cashflow-calendar")
def financial_check_cashflow_calendar(store_id: str):
    fp = _financial_profile(store_id)
    bank = fp["bank_account_profile"]
    return {
        "store_id": store_id,
        "monthly_inflow": bank["monthly_inflow"],
        "monthly_outflow": bank["monthly_outflow"],
        "risk_days": ["10일", "15일", "20일"],
        "recurring_payments": bank["recurring_payments"],
        "daily_balance_curve": bank.get("daily_balance_curve", []),
        "monthly_in_out_6m": bank.get("monthly_in_out_6m", []),
        "owner_message": "순현금흐름은 플러스지만, 카드대금·급여·대출 납입이 한꺼번에 몰리는 구간이 있어요. 그때 잔액이 가장 낮아질 수 있습니다.",
        "message": "10일~20일 사이 카드대금·급여·대출 상환이 집중됩니다.",
    }


@router.post("/shinhan/business/{store_id}/financial-check/loan-simulation")
def financial_check_loan_simulation(store_id: str, req: LoanSimulationRequest):
    return loan_simulation(store_id, req)


@router.get("/shinhan/business/{store_id}/financial-check/card-spending")
def financial_check_card_spending(store_id: str):
    card = _financial_profile(store_id)["card_profile"]
    ratio = round(card["monthly_business_card_spending"] / max(1, card["monthly_card_sales"]), 3)
    labels = card.get("category_labels_ko") or {}
    mom = card.get("mom_change_pct") or {}
    return {
        "store_id": store_id,
        "monthly_card_sales": card["monthly_card_sales"],
        "monthly_business_card_spending": card["monthly_business_card_spending"],
        "corporate_card_spending": card.get("corporate_card_spending"),
        "business_card_spending": card.get("business_card_spending"),
        "card_payment_due": card["card_payment_due"],
        "spending_by_category": card["spending_by_category"],
        "category_labels_ko": labels,
        "mom_change_pct": mom,
        "total_spending_last_3_months": card.get("total_spending_last_3_months", []),
        "increased_categories": card["increased_categories"],
        "spending_ratio": ratio,
        "diagnosis": "매출 변동이 있어도 원재료·광고 쪽 지출은 함께 따라가는지 한 번에 보셔야 해요. 비중이 큰 항목부터 주 단위로 줄일 수 있는지 살펴보세요.",
        "message": "매출은 감소했지만 원재료비와 광고비 지출은 증가했습니다.",
    }


@router.get("/shinhan/business/{store_id}/financial-check/insurance-gap")
def financial_check_insurance_gap(store_id: str):
    return insurance_gap(store_id)


@router.post("/shinhan/business/{store_id}/financial-check/stress-test")
def financial_check_stress_test(store_id: str, req: FinancialStressRequest):
    fp = _financial_profile(store_id)
    base_sales = int(fp["card_profile"]["monthly_card_sales"])
    buf = int(fp["bank_account_profile"]["current_balance"])
    s10, s20, s30 = int(round(base_sales * 0.9)), int(round(base_sales * 0.8)), int(round(base_sales * 0.7))
    cf10 = -max(650000, int(base_sales * 0.048))
    cf20 = -max(1900000, int(base_sales * 0.152))
    cf30 = -max(3200000, int(base_sales * 0.255))
    m10 = min(8.0, max(2.8, round(buf / 4_100_000, 1)))
    m20 = min(6.5, max(2.0, round(buf / 5_200_000, 1)))
    m30 = min(5.0, max(1.4, round(buf / 6_500_000, 1)))
    scenarios = {
        "sales_down_10": ("매출 10% 감소", s10, cf10, m10, "주의"),
        "sales_down_20": ("매출 20% 감소", s20, cf20, m20, "위험"),
        "sales_down_30": ("매출 30% 감소", s30, cf30, m30, "고위험"),
    }
    name, sales, cf, months, risk = scenarios.get(req.scenario, scenarios["sales_down_20"])
    all_rows = [
        {"id": "sales_down_10", "label": "매출 -10%", "expected_sales": s10, "expected_cash_flow": cf10, "months": m10, "risk": "주의"},
        {"id": "sales_down_20", "label": "매출 -20%", "expected_sales": s20, "expected_cash_flow": cf20, "months": m20, "risk": "위험"},
        {"id": "sales_down_30", "label": "매출 -30%", "expected_sales": s30, "expected_cash_flow": cf30, "months": m30, "risk": "고위험"},
    ]
    return {
        "scenario": name,
        "expected_sales": sales,
        "expected_cash_flow": cf,
        "cash_runway_months": months,
        "risk_grade": risk,
        "message": f"{name} 시 월 현금흐름이 {cf:,}원으로 변하며, 약 {months}개월 후 현금 부족 가능성이 있습니다.",
        "owner_message": "매출이 줄면 고정비는 그대로라 통장이 빨리 얇아질 수 있어요. 아래 비교는 참고용 시나리오입니다.",
        "scenarios_compare": all_rows,
    }


@router.post("/shinhan/business/{store_id}/financial-check/action-plan")
def financial_check_action_plan(store_id: str, req: ActionPlanRequest):
    return action_plan(store_id, req)


@router.post("/shinhan/business/{store_id}/financial-check/report/save")
def financial_check_report_save(store_id: str):
    return save_report(store_id)
