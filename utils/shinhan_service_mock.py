"""신한 서비스 연결 탭용 목업 상세 패널 (분석 결과 + 룰 기반 문구).

실제 상품 추천이 아닌 상담·점검 후보 시뮬레이션용.
"""
from __future__ import annotations

from typing import Any, Optional


def _i(x: Any, default: int = 0) -> int:
    try:
        return int(round(float(x)))
    except (TypeError, ValueError):
        return default


def _f(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def build_shinhan_panels(
    scores: dict,
    finance: dict,
    user_type: str,
    service_name: str,
    *,
    sales_vs_area_ratio: Optional[float] = None,
    competitor_count: int = 10,
) -> dict:
    """4개 그룹사 패널 JSON. 키: bank, card, life, investment"""
    ms = _f(finance.get("monthly_sales"), 10_000_000)
    be = _f(finance.get("break_even"), ms * 0.9)
    gap = _i(finance.get("funding_gap_estimate"), 0)
    init_tot = _i(finance.get("initial_investment"), _i(ms * 4))
    own = _i(finance.get("cash_balance"), _i(ms * 1.2))
    cm = _f(finance.get("cash_months"), 6)
    fc = _f(finance.get("fixed_cost"), ms * 0.35)
    loan_bal = _f(finance.get("loan_balance"), ms * 8)
    monthly_rep = _f(finance.get("monthly_repayment"), 800_000)
    ir_pct = _f(finance.get("interest_ratio"), 5)
    rec_wc = _i(finance.get("recommended_working_capital"), _i(fc * 3))

    fixed_ratio = round(fc / ms * 100, 1) if ms > 0 else 0.0

    sb = scores.get("shinhan_bank") or {}
    sc_ = scores.get("shinhan_card") or {}
    sl = scores.get("shinhan_life") or {}
    sg = scores.get("shinhan_growth") or {}
    att = scores.get("attraction") or {}
    grw = scores.get("growth") or {}
    comp = scores.get("competition") or {}
    dbt = scores.get("debt") or {}

    # --- 신한은행 ---
    startup_mock = gap if gap > 0 else max(_i(ms * 0.15), 10_000_000)
    op_low = max(5_000_000, min(rec_wc, _i(cm * fc / 3)))
    op_high = max(op_low + 3_000_000, min(30_000_000, rec_wc + _i(ms * 0.1)))

    need_bank = "높음" if sb.get("score", 0) >= 70 else ("보통" if sb.get("score", 0) >= 50 else "낮음")
    bank_products: list[dict[str, Any]] = [
        {
            "product_group": "개인사업자 창업자금 상담",
            "purpose": "시설비, 보증금, 인테리어비, 초기 운영자금 점검",
            "estimated_amount_range": "1,000만 원 ~ 5,000만 원",
            "mock_estimated_amount": startup_mock,
            "need_level": "보통" if gap > 0 else "낮음",
            "reason": (
                f"총 초기 소요자금 약 {_i(init_tot/10_000)}만 원 대비 보유 현금 약 {_i(own/10_000)}만 원으로 "
                f"약 {_i(startup_mock/10_000)}만 원 규모의 자금 공백이 추정됩니다."
                if gap > 0
                else "초기 소요 대비 보유 현금이 비교적 균형에 가깝지만, 창업자금 상담으로 계획을 점검할 수 있습니다."
            ),
            "cta": "창업자금 상담 준비자료 보기",
            "cta_action": "bank_startup",
            "caution": "실제 대출 한도와 금리는 신용도, 담보, 보증, 사업계획, 매출 전망 등에 따라 달라집니다.",
        },
        {
            "product_group": "개인사업자 운영자금 상담",
            "purpose": "임대료, 인건비, 재료비, 고정비 등 단기 운영자금 점검",
            "estimated_amount_range": "500만 원 ~ 3,000만 원",
            "mock_estimated_amount_low": op_low,
            "mock_estimated_amount_high": op_high,
            "need_level": "보통" if cm < 6 else "낮음",
            "reason": (
                f"현금보유기간이 약 {cm:.1f}개월로 추정되어, 매출 급감 시 운영자금 여력이 빠르게 줄어들 수 있습니다."
                if cm < 6
                else "현금 버퍼가 일정 수준 있으나, 운영자금 구조 점검은 권장됩니다."
            ),
            "cta": "운영자금 점검하기",
            "cta_action": "bank_working",
            "caution": "본 금액은 최소 3개월 고정비 확보 기준의 시뮬레이션입니다.",
        },
        {
            "product_group": "정책자금·보증 연계 상담",
            "purpose": "소상공인 정책자금 및 보증기관 연계 가능성 검토",
            "estimated_amount_range": "상담 후 확인",
            "mock_estimated_amount": None,
            "need_level": "보통",
            "reason": (
                "창업 예정자 또는 초기 개인사업자는 정책자금·보증상품 검토 가능성이 있어 상담 전 확인이 필요합니다."
                if "창업" in user_type or "예정" in user_type
                else "운영 중인 사업자도 정책자금·보증 연계 가능 여부를 상담으로 확인할 수 있습니다."
            ),
            "cta": "정책자금 체크리스트 보기",
            "cta_action": "bank_policy",
            "caution": "정책자금은 업종, 지역, 사업기간, 신용상태, 예산 소진 여부에 따라 신청 가능 여부가 달라질 수 있습니다.",
        },
        {
            "product_group": "기존 대출 대환 검토",
            "purpose": "기존 고금리 대출의 상환 부담 점검",
            "estimated_amount_range": "기존 대출잔액 범위 내 검토",
            "mock_estimated_amount": _i(loan_bal) if loan_bal > ms * 3 else None,
            "need_level": "보통" if ir_pct >= 5 or loan_bal > ms * 6 else "낮음",
            "reason": (
                f"기존 대출잔액 약 {_i(loan_bal/10_000)}만 원, 이자부담률 약 {ir_pct:.1f}%로 대환 검토 여지가 있습니다."
                if loan_bal > 0
                else "현재 시뮬레이션상 대출 잔액이 크지 않아 대환 우선순위는 낮을 수 있습니다."
            ),
            "cta": "대환 가능성 점검하기",
            "cta_action": "bank_refinance",
            "caution": "대환 가능 여부는 기존 대출 조건, 신용도, 상환 이력, 담보·보증 여부에 따라 달라집니다.",
        },
    ]

    bank_panel = {
        "group": "shinhan_bank",
        "brand": "신한은행",
        "role": "초기 창업자금, 운영자금, 대환 필요성, 정책자금 가능성, 현금흐름 안정성을 점검합니다.",
        "title": "자금 조달·현금흐름 점검",
        "score": round(_f(sb.get("score"), 56), 1),
        "level": sb.get("label") or need_bank,
        "summary": sb.get("message") or "자금 구조 점검이 필요한 수준입니다.",
        "diagnosis": {
            "estimated_startup_cost": init_tot,
            "own_cash": own,
            "funding_gap": gap,
            "monthly_sales": _i(ms),
            "break_even_sales": _i(be),
            "cash_runway_months": round(cm, 1),
            "fixed_cost_ratio": fixed_ratio,
            "loan_balance": _i(loan_bal),
            "monthly_repayment": _i(monthly_rep),
            "interest_ratio_pct": round(ir_pct, 1),
        },
        "products": bank_products,
        "disclaimer": (
            "실제 대출 한도와 금리는 신용도, 담보, 보증, 사업계획, 매출 전망, 심사 결과에 따라 달라집니다."
        ),
    }

    # --- 신한카드 ---
    ratio = sales_vs_area_ratio if sales_vs_area_ratio is not None else 0.92
    ratio = max(0.5, min(1.15, ratio))
    card_sales = _i(ms * ratio)
    txn = max(80, _i(ms / 15_000))
    ticket = _i(card_sales / txn) if txn else 12_000
    weak_time = "14~17시"
    peak_time = "18~21시"
    repeat_pct = max(15.0, min(48.0, 42.0 - comp.get("score", 45) * 0.15))

    card_products = [
        {
            "product_group": "가맹점 매출관리 리포트",
            "purpose": "월별 매출, 거래건수, 객단가, 시간대별 매출 흐름 점검",
            "need_level": "보통",
            "reason": (
                "예상 매출은 손익분기점을 상회하지만, 상권 평균 대비 매출이 낮은 편이므로 매출 추이 관리가 필요합니다."
                if ratio < 0.92
                else "매출 구조 점검과 시간대별 약점 보완을 검토할 수 있습니다."
            ),
            "provided_info": ["월매출", "거래건수", "객단가", "요일별 매출", "시간대별 매출"],
            "cta": "매출관리 리포트 예시 보기",
            "cta_action": "card_sales_report",
        },
        {
            "product_group": "가맹점 정산관리 서비스",
            "purpose": "카드 매출 정산, 입금 예정액, 정산 주기 확인",
            "need_level": "보통",
            "reason": "초기 창업자는 매출 발생 시점과 실제 현금 유입 시점의 차이를 관리해야 합니다.",
            "provided_info": ["정산 예정액", "입금 일정", "카드사별 매출 집계"],
            "cta": "정산관리 기능 보기",
            "cta_action": "card_settlement",
        },
        {
            "product_group": "카드 프로모션·쿠폰 전략",
            "purpose": "특정 시간대 또는 요일 매출 보완",
            "need_level": "보통",
            "reason": "경쟁점이 증가하는 상권에서는 신규 고객 유입과 재방문 고객 관리가 중요합니다.",
            "provided_info": ["재방문 쿠폰", "평일 낮 시간대 프로모션", "객단가 상승 전략"],
            "cta": "프로모션 아이디어 보기",
            "cta_action": "card_promo",
        },
        {
            "product_group": "사업자 카드 혜택 점검",
            "purpose": "재료비, 통신비, 공과금, 주유비, 비품 구매 등 사업비 지출 관리",
            "need_level": "보통",
            "reason": "고정비와 운영비 지출이 큰 업종은 사업자 카드 사용 내역을 통해 비용 관리가 가능합니다.",
            "cta": "사업자 카드 활용 항목 보기",
            "cta_action": "card_business_card",
        },
    ]

    card_panel = {
        "group": "shinhan_card",
        "brand": "신한카드",
        "role": "가맹점 매출 흐름, 거래건수, 객단가, 시간대별 약점, 재방문 전략, 정산관리 필요성을 점검합니다.",
        "title": "가맹점 매출관리·프로모션",
        "score": round(_f(sc_.get("score"), 53), 1),
        "level": sc_.get("label") or "보통",
        "summary": sc_.get("message") or "카드 매출관리와 프로모션 활용을 검토해볼 수 있습니다.",
        "diagnosis": {
            "monthly_card_sales": card_sales,
            "monthly_transaction_count": txn,
            "average_ticket_size": ticket,
            "sales_vs_area_average_ratio": round(ratio, 2),
            "weak_time": weak_time,
            "peak_time": peak_time,
            "repeat_customer_ratio": round(repeat_pct, 1),
            "competitor_count_500m": competitor_count,
        },
        "products": card_products,
        "disclaimer": (
            "본 내용은 가맹점 매출관리 활용 예시이며, 실제 카드 서비스 제공 여부와 혜택은 상품 및 계약 조건에 따라 달라질 수 있습니다."
        ),
    }

    # --- 신한라이프 ---
    risk_kw = ["음식", "카페", "제과", "치킨", "호프", "주점", "미용", "당구", "세탁", "숙박"]
    visitor = any(k in (service_name or "") for k in risk_kw)
    fire = min(95, 40 + (20 if visitor else 0) + _i(sl.get("score", 50) * 0.15))
    liab = min(95, fire + 8)
    cust = min(95, liab + 4)
    biz_int = min(90, 45 + _i((100 - dbt.get("score", 50)) * 0.3))

    life_products = [
        {
            "product_group": "사업장 화재 리스크 점검",
            "purpose": "사업장 화재, 시설 피해, 영업 중단 리스크 확인",
            "need_level": "보통",
            "reason": "실내 방문형 업종은 화재와 시설물 피해 발생 시 영업 중단 가능성이 있습니다." if visitor else "사업장 시설 점검과 화재 리스크를 확인할 수 있습니다.",
            "check_items": ["사업장 화재", "시설 피해", "집기·비품 손실"],
            "cta": "화재 리스크 체크리스트 보기",
            "cta_action": "life_fire",
        },
        {
            "product_group": "배상책임 리스크 점검",
            "purpose": "고객 사고, 시설물 이용 중 사고, 제3자 피해 가능성 점검",
            "need_level": "보통",
            "reason": "고객이 시설을 직접 이용하는 업종은 고객 안전사고와 시설물 배상책임을 점검할 필요가 있습니다." if visitor else "업종 특성에 따른 배상책임 여부를 점검할 수 있습니다.",
            "check_items": ["고객 상해", "시설물 배상책임", "제3자 피해"],
            "cta": "배상책임 점검하기",
            "cta_action": "life_liability",
        },
        {
            "product_group": "휴업손실 리스크 점검",
            "purpose": "영업 중단 시 고정비 부담과 손실 가능성 점검",
            "need_level": "낮음~보통",
            "reason": "고정비가 있는 매장은 일시 휴업 시 임대료와 인건비 부담이 지속될 수 있습니다.",
            "check_items": ["휴업 기간", "월 고정비", "현금보유개월 수"],
            "cta": "휴업손실 영향 보기",
            "cta_action": "life_interruption",
        },
        {
            "product_group": "업종별 기본 보장 체크리스트",
            "purpose": "업종 특성에 맞는 필수 리스크 항목 점검",
            "need_level": "보통",
            "reason": "업종별로 필요한 보장 영역이 다르므로 창업 전 체크리스트 확인이 필요합니다.",
            "check_items": [f"{service_name or '선택 업종'}: 화재, 배상책임, 고객 안전, 휴업손실"],
            "cta": "업종별 보험 체크리스트 보기",
            "cta_action": "life_checklist",
        },
    ]

    life_panel = {
        "group": "shinhan_life",
        "brand": "신한라이프",
        "role": "업종별 화재, 배상책임, 고객 사고, 휴업손실, 시설물 리스크를 점검합니다.",
        "title": "사업장 리스크 점검",
        "score": round(_f(sl.get("score"), 40), 1),
        "level": sl.get("label") or "보통",
        "summary": sl.get("message") or "기본 보험 보장 범위를 점검해볼 수 있습니다.",
        "diagnosis": {
            "business_type": service_name or "-",
            "visitor_based_business": visitor,
            "fire_risk_score": round(fire, 1),
            "liability_risk_score": round(liab, 1),
            "customer_accident_risk_score": round(cust, 1),
            "business_interruption_risk_score": round(biz_int, 1),
            "insurance_gap_score": round(_f(sl.get("score"), 40), 1),
        },
        "products": life_products,
        "disclaimer": (
            "본 내용은 보험 가입 권유가 아니라 업종별 리스크 점검 예시입니다. "
            "실제 가입 가능 여부와 보장 내용은 상담 및 심사 결과에 따라 달라질 수 있습니다."
        ),
    }

    # --- 신한투자증권 ---
    inv_products = [
        {
            "product_group": "사업 성장 단계 진단",
            "purpose": "현재 점포가 안정화 단계인지, 확장 검토 단계인지 점검",
            "need_level": "보통",
            "reason": (
                "현재는 창업 초기 단계로 즉시 확장보다는 매출 안정화와 현금흐름 개선이 우선입니다."
                if "창업" in user_type or "예정" in user_type
                else "매출 안정성과 부채 부담을 종합해 성장 단계를 점검합니다."
            ),
            "check_items": ["매출 안정성", "부채 부담", "수익성", "상권 성장성"],
            "cta": "성장 단계 확인하기",
            "cta_action": "inv_growth",
        },
        {
            "product_group": "법인 전환 검토",
            "purpose": "개인사업자에서 법인사업자로 전환할 필요성이 있는지 점검",
            "need_level": "낮음~보통",
            "reason": "다점포 운영, 직원 증가, 매출 규모 확대 시 법인 전환 검토가 필요할 수 있습니다.",
            "check_items": ["매출 규모", "점포 수", "고용 규모", "세무·재무 관리 필요성"],
            "cta": "법인 전환 체크리스트 보기",
            "cta_action": "inv_corporate",
        },
        {
            "product_group": "사업자 자산관리 상담",
            "purpose": "사업 여유자금, 비상자금, 장기 자금계획 관리",
            "need_level": "낮음~보통",
            "reason": "현금흐름이 안정화된 이후 여유자금 운용과 비상자금 관리를 검토할 수 있습니다.",
            "check_items": ["현금보유액", "월 순이익", "부채 부담", "비상자금 규모"],
            "cta": "자산관리 점검하기",
            "cta_action": "inv_asset",
        },
        {
            "product_group": "B2B 제휴·확장 지원",
            "purpose": "사업 확장, 제휴, 프랜차이즈화 가능성 검토",
            "need_level": "보통",
            "reason": "상권 성장성과 매출 안정성이 확보되면 사업 확장 또는 제휴 기회를 검토할 수 있습니다.",
            "check_items": ["매출 성장성", "상권 매력도", "업종 생존성", "부채 체력"],
            "cta": "확장 가능성 체크하기",
            "cta_action": "inv_b2b",
        },
    ]

    investment_panel = {
        "group": "shinhan_investment",
        "brand": "신한투자증권",
        "role": "사업 안정화 이후 확장, 법인 전환, 자산관리, 여유자금 운용, B2B 제휴 가능성을 점검합니다.",
        "title": "성장·확장 컨설팅",
        "score": round(_f(sg.get("score"), 55), 1),
        "level": sg.get("label") or "보통",
        "summary": sg.get("message") or "현 상태 안정화 후 성장지원 상담을 검토할 수 있습니다.",
        "diagnosis": {
            "monthly_sales_stability_score": round(_f(dbt.get("score"), 55), 1),
            "growth_market_score": round(_f(grw.get("score"), 60), 1),
            "debt_burden_score": round(100 - _f(dbt.get("score"), 55), 1),
            "profitability_score": round(min(95, 50 + _f(finance.get("net_profit"), 0) / max(ms, 1) * 20), 1),
            "expansion_fit_score": round(_f(sg.get("score"), 48), 1),
            "corporate_conversion_fit_score": round(max(25, 60 - fixed_ratio), 1),
            "asset_management_need_score": round(max(35, 80 - cm * 5), 1),
            "growth_support_score": round(_f(sg.get("score"), 55), 1),
            "attraction_score": round(_f(att.get("score"), 55), 1),
        },
        "products": inv_products,
        "disclaimer": (
            "본 내용은 투자상품 추천이 아니라 사업 성장 단계와 자산관리 필요성에 대한 목업 상담 예시입니다. "
            "실제 상담 결과는 고객 상황과 내부 기준에 따라 달라질 수 있습니다."
        ),
    }

    return {
        "bank": bank_panel,
        "card": card_panel,
        "life": life_panel,
        "investment": investment_panel,
    }
