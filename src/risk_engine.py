"""경영위험 · 창업 적합도 · 세부 진단 점수 산출 엔진"""
import sys
from pathlib import Path
import pandas as pd
import numpy as np
sys.path.insert(0, str(Path(__file__).parent.parent))
from src.config import RISK_WEIGHTS, get_risk_grade, get_fit_grade


# ─── 정규화 유틸 ──────────────────────────────────────────────────────────────

def _norm(val, lo=0.0, hi=100.0, invert=False) -> float:
    """0~100 정규화, invert=True 이면 높을수록 나쁜 지표"""
    if hi == lo:
        return 50.0
    v = (val - lo) / (hi - lo) * 100
    v = max(0.0, min(100.0, v))
    return round(100 - v if invert else v, 1)


def _pct_change(series: pd.Series, periods: int = 1) -> float:
    """최근 n분기 변화율 (%)"""
    if len(series) < periods + 1:
        return 0.0
    base = series.iloc[-(periods + 1)]
    curr = series.iloc[-1]
    return (curr - base) / base * 100 if base != 0 else 0.0


def _latest(series: pd.Series, default=0.0) -> float:
    return float(series.iloc[-1]) if not series.empty else default


# ─── 세부 진단 점수 (8개) ─────────────────────────────────────────────────────

def score_commercial_attraction(sales_s, fp_s, resident_s=None, worker_s=None,
                                  facilities_s=None) -> dict:
    """1. 상권 매력도 - 높을수록 좋음"""
    parts = {}
    # 매출 수준
    avg_sales = float(sales_s.mean()) if not sales_s.empty else 0
    parts["avg_sales"] = _norm(avg_sales, 10_000_000, 500_000_000)
    # 유동인구
    avg_fp = float(fp_s.mean()) if not fp_s.empty else 0
    parts["floating_pop"] = _norm(avg_fp, 500, 50_000)
    # 상주·직장 인구
    avg_res = float(resident_s.mean()) if resident_s is not None and not resident_s.empty else 5_000
    parts["resident_pop"] = _norm(avg_res, 1_000, 30_000)
    avg_wrk = float(worker_s.mean()) if worker_s is not None and not worker_s.empty else 5_000
    parts["worker_pop"] = _norm(avg_wrk, 500, 30_000)

    weights = {"avg_sales": 0.35, "floating_pop": 0.35, "resident_pop": 0.15, "worker_pop": 0.15}
    score = sum(parts[k] * weights[k] for k in parts)
    label, color = ("매우 양호", "#22c55e") if score >= 80 else \
                   ("양호", "#86efac") if score >= 60 else \
                   ("보통", "#f97316") if score >= 40 else ("신중 검토", "#ef4444")
    return {"score": round(score, 1), "label": label, "color": color,
            "detail": parts, "direction": "positive"}


def score_sales_growth(sales_s) -> dict:
    """2. 매출 성장성 - 높을수록 좋음"""
    if len(sales_s) < 4:
        score = 50.0
        reason = "데이터 부족"
    else:
        chg4 = _pct_change(sales_s, 4)   # 1년 변화
        chg1 = _pct_change(sales_s, 1)   # 최근 1분기
        # 1년 성장률: -30% → 0점, +30% → 100점
        s4 = _norm(chg4, -30, 30)
        s1 = _norm(chg1, -15, 15)
        score = round(s4 * 0.6 + s1 * 0.4, 1)
        reason = f"1년 변화 {chg4:+.1f}%, 최근 분기 {chg1:+.1f}%"

    label, color = ("매우 양호", "#22c55e") if score >= 80 else \
                   ("양호", "#86efac") if score >= 60 else \
                   ("보통", "#f97316") if score >= 40 else ("신중 검토", "#ef4444")
    return {"score": score, "label": label, "color": color,
            "reason": reason, "direction": "positive"}


def score_competition(store_s, similar_s=None, competitor_count=0) -> dict:
    """3. 경쟁 강도 - 높을수록 주의"""
    parts = {}
    # 점포 수 증가율
    if len(store_s) >= 4:
        chg = _pct_change(store_s, 4)
        parts["store_growth"] = _norm(chg, -10, 30)   # 증가할수록 높음
    else:
        parts["store_growth"] = 50.0
    # 반경 경쟁점
    parts["radius_comp"] = _norm(competitor_count, 0, 60)
    # 유사 업종
    if similar_s is not None and not similar_s.empty:
        parts["similar_store"] = _norm(float(similar_s.iloc[-1]), 0, 50)
    else:
        parts["similar_store"] = 50.0

    score = round(parts["store_growth"] * 0.35 + parts["radius_comp"] * 0.40
                  + parts["similar_store"] * 0.25, 1)
    label, color = ("매우 높음", "#ef4444") if score >= 80 else \
                   ("높음", "#f97316") if score >= 60 else \
                   ("보통", "#facc15") if score >= 40 else ("낮음", "#22c55e")
    return {"score": score, "label": label, "color": color,
            "detail": parts, "direction": "negative",
            "reason": f"반경 500m 경쟁점 {competitor_count}개, 점포 증가율 {parts['store_growth']:.0f}점"}


def score_population_fit(fp_s, resident_s=None, worker_s=None) -> dict:
    """4. 유동인구 적합도 - 높을수록 좋음"""
    # 유동인구 수준 + 최근 트렌드
    fp_level = _norm(float(fp_s.mean()) if not fp_s.empty else 0, 500, 50_000)
    fp_trend = _norm(_pct_change(fp_s, 4) if len(fp_s) >= 5 else 0, -20, 20)
    score = round(fp_level * 0.6 + fp_trend * 0.4, 1)
    label, color = ("매우 양호", "#22c55e") if score >= 80 else \
                   ("양호", "#86efac") if score >= 60 else \
                   ("보통", "#f97316") if score >= 40 else ("신중 검토", "#ef4444")
    return {"score": score, "label": label, "color": color, "direction": "positive"}


def score_store_ecosystem(store_s, closure_s=None, change_s=None) -> dict:
    """5. 점포 생태계 안정성 - 높을수록 좋음"""
    parts = {}
    if closure_s is not None and not closure_s.empty:
        avg_closure = float(closure_s.mean())
        parts["closure"] = _norm(avg_closure, 0, 0.3, invert=True)
    else:
        parts["closure"] = 50.0
    if change_s is not None and not change_s.empty:
        parts["change"] = _norm(float(change_s.iloc[-1]), -2, 2)
    else:
        parts["change"] = 50.0

    score = round(parts["closure"] * 0.6 + parts["change"] * 0.4, 1)
    label, color = ("매우 양호", "#22c55e") if score >= 80 else \
                   ("양호", "#86efac") if score >= 60 else \
                   ("보통", "#f97316") if score >= 40 else ("신중 검토", "#ef4444")
    return {"score": score, "label": label, "color": color,
            "detail": parts, "direction": "positive"}


def score_industry_survival(kosis_df, service_name: str = "") -> dict:
    """6. 업종 생존성 - 높을수록 좋음"""
    rate = 50.0
    reason = "데이터 없음"
    if kosis_df is not None and not kosis_df.empty:
        cols = kosis_df.columns.tolist()
        val_col = next((c for c in cols if "생존율" in str(c) or "5년" in str(c)), None)
        if val_col:
            rows = kosis_df[kosis_df.apply(
                lambda r: any(str(service_name)[:2] in str(v) for v in r.values), axis=1
            )] if service_name else kosis_df
            if not rows.empty:
                v = pd.to_numeric(rows[val_col].iloc[0], errors="coerce")
                if not pd.isna(v):
                    rate = float(v)
                    reason = f"5년 생존율 {rate:.1f}%"
    score = _norm(rate, 10, 60)
    label, color = ("매우 양호", "#22c55e") if score >= 80 else \
                   ("양호", "#86efac") if score >= 60 else \
                   ("보통", "#f97316") if score >= 40 else ("신중 검토", "#ef4444")
    return {"score": round(score, 1), "label": label, "color": color,
            "reason": reason, "survival_rate": f"{rate:.1f}%", "direction": "positive"}


def score_rent_burden(rental_df) -> dict:
    """7. 임대료·고정비 부담 - 높을수록 주의"""
    score = 50.0
    reason = "데이터 없음"
    if rental_df is not None and not rental_df.empty:
        cols = rental_df.columns.tolist()
        val_col = next((c for c in cols if "임대" in str(c) or "가격" in str(c) or "value" in str(c).lower()), None)
        if val_col:
            vals = pd.to_numeric(rental_df[val_col], errors="coerce").dropna()
            if not vals.empty:
                chg = float(vals.iloc[-1] - vals.iloc[0]) / float(vals.iloc[0]) * 100 if vals.iloc[0] != 0 else 0
                score = _norm(chg, -5, 20)
                reason = f"임대료 변동 {chg:+.1f}%"
    label, color = ("매우 높음", "#ef4444") if score >= 80 else \
                   ("높음", "#f97316") if score >= 60 else \
                   ("보통", "#facc15") if score >= 40 else ("낮음", "#22c55e")
    return {"score": round(score, 1), "label": label, "color": color,
            "reason": reason, "direction": "negative"}


def score_debt_resilience(finance: dict) -> dict:
    """8. 부채 체력 - 높을수록 좋음"""
    monthly_sales = finance.get("monthly_sales", 0) or 1
    fixed_cost = finance.get("fixed_cost", 0)
    interest = finance.get("monthly_interest", 0)
    cash = finance.get("cash_balance", 0)
    repayment = finance.get("monthly_repayment", 0)

    interest_ratio = min(interest / monthly_sales * 100, 100) if monthly_sales else 50
    fixed_ratio = min(fixed_cost / monthly_sales * 100, 100) if monthly_sales else 50
    # fixed_cost 에 이미 이자 포함(대시보드 정의). 월 원리금 상환액만 추가 분모로 반영.
    burn_rate = fixed_cost + repayment
    cash_months = cash / burn_rate if burn_rate > 0 else 12
    cash_months_10 = cash / (burn_rate + monthly_sales * 0.10) if (burn_rate + monthly_sales * 0.10) > 0 else 6
    cash_months_20 = cash / (burn_rate + monthly_sales * 0.20) if (burn_rate + monthly_sales * 0.20) > 0 else 3

    # 낮은 이자부담률, 낮은 고정비부담률, 높은 현금보유개월 → 점수 ↑
    s_interest = _norm(interest_ratio, 0, 30, invert=True)
    s_fixed = _norm(fixed_ratio, 0, 80, invert=True)
    s_cash = _norm(cash_months, 0, 12)
    score = round(s_interest * 0.30 + s_fixed * 0.30 + s_cash * 0.40, 1)

    label, color = ("매우 양호", "#22c55e") if score >= 80 else \
                   ("양호", "#86efac") if score >= 60 else \
                   ("보통", "#f97316") if score >= 40 else ("신중 검토", "#ef4444")
    return {
        "score": score, "label": label, "color": color, "direction": "positive",
        "interest_ratio": round(interest_ratio, 1),
        "fixed_ratio": round(fixed_ratio, 1),
        "cash_months": round(cash_months, 1),
        "cash_months_10pct": round(cash_months_10, 1),
        "cash_months_20pct": round(cash_months_20, 1),
    }


# ─── 신한 서비스 연결 점수 (4개) ─────────────────────────────────────────────

def score_shinhan_bank(debt: dict, finance: dict) -> dict:
    """신한은행 금융 점검 필요성 - 높을수록 상담 필요"""
    ir = debt.get("interest_ratio", 0)
    cm = debt.get("cash_months", 12)
    fr = debt.get("fixed_ratio", 0)

    s_ir = _norm(ir, 0, 30)
    s_cm = _norm(cm, 0, 12, invert=True)   # 적을수록 위험
    s_fr = _norm(fr, 0, 80)
    score = round(s_ir * 0.35 + s_cm * 0.40 + s_fr * 0.25, 1)

    if score >= 70:
        msg = "운영자금 또는 대환대출 상담을 검토해보세요."
        services = ["개인사업자 자금 상담", "운영자금 대출 상담", "대환대출 검토", "정책자금 안내", "현금흐름 점검"]
    elif score >= 50:
        msg = "자금 구조 점검이 필요한 수준입니다."
        services = ["현금흐름 점검", "정책자금 안내", "개인사업자 자금 상담"]
    else:
        msg = "현재 재무 상태는 비교적 안정적입니다."
        services = ["현금흐름 점검"]
    label = "높음" if score >= 70 else "보통" if score >= 50 else "낮음"
    color = "#ef4444" if score >= 70 else "#f97316" if score >= 50 else "#22c55e"
    return {"score": score, "label": label, "color": color,
            "message": msg, "services": services, "direction": "negative"}


def score_shinhan_card(sales_s, competitor_count=0) -> dict:
    """신한카드 매출관리 활용도 - 높을수록 활용 필요"""
    s_comp = _norm(competitor_count, 0, 60)    # 경쟁점 많을수록
    s_var = 50.0
    if len(sales_s) >= 4:
        std = float(sales_s.std())
        mean = float(sales_s.mean())
        cv = std / mean * 100 if mean else 0
        s_var = _norm(cv, 0, 50)               # 변동성 클수록
    score = round(s_comp * 0.5 + s_var * 0.5, 1)
    if score >= 70:
        msg = "가맹점 매출관리 리포트와 프로모션 전략이 필요합니다."
        services = ["가맹점 매출관리 리포트", "재방문 고객 쿠폰 전략", "카드 프로모션", "사업자 카드 혜택", "정산관리 서비스"]
    elif score >= 50:
        msg = "카드 매출관리와 프로모션 활용을 검토해보세요."
        services = ["가맹점 매출관리 리포트", "사업자 카드 혜택", "정산관리 서비스"]
    else:
        msg = "현재 수준에서 기본 카드 서비스를 활용할 수 있습니다."
        services = ["사업자 카드 혜택", "정산관리 서비스"]
    label = "높음" if score >= 70 else "보통" if score >= 50 else "낮음"
    color = "#ef4444" if score >= 70 else "#f97316" if score >= 50 else "#22c55e"
    return {"score": score, "label": label, "color": color,
            "message": msg, "services": services, "direction": "negative"}


def score_shinhan_life(service_name: str = "") -> dict:
    """신한라이프 보험 점검 필요성"""
    HIGH_RISK = ["음식점", "카페", "제과", "치킨", "호프", "주점", "미용", "세탁"]
    base = 55 if any(k in service_name for k in HIGH_RISK) else 40
    score = float(base)
    if score >= 60:
        msg = "업종 특성상 화재·배상책임 보험 점검이 권장됩니다."
        services = ["사업장 화재보험 상담", "배상책임보험 점검", "휴업손실 보장 검토", "직원·고객 사고 리스크 점검"]
    else:
        msg = "기본 보험 보장 범위를 점검해보세요."
        services = ["사업장 화재보험 상담", "배상책임보험 점검"]
    label = "높음" if score >= 60 else "보통"
    color = "#f97316" if score >= 60 else "#facc15"
    return {"score": round(score, 1), "label": label, "color": color,
            "message": msg, "services": services, "direction": "negative"}


def score_shinhan_growth(attraction: dict, growth: dict, debt: dict) -> dict:
    """신한투자증권 성장지원 가능성"""
    s_att = attraction.get("score", 50)
    s_grw = growth.get("score", 50)
    s_dbt = debt.get("score", 50)
    score = round(s_att * 0.35 + s_grw * 0.35 + s_dbt * 0.30, 1)
    if score >= 70:
        msg = "매출 안정성과 상권 성장성이 양호해 확장 검토가 가능합니다."
        services = ["법인 전환 상담", "성장지원 검토", "B2B 제휴 연결", "프랜차이즈 확장 검토", "자산관리"]
    elif score >= 50:
        msg = "현 상태 안정화 후 성장지원 상담을 검토할 수 있습니다."
        services = ["성장지원 검토", "법인 전환 상담"]
    else:
        msg = "현재 단계에서는 안정적 운영에 집중하는 것이 중요합니다."
        services = ["성장지원 검토"]
    label, color = ("높음", "#22c55e") if score >= 70 else \
                   ("보통", "#3b82f6") if score >= 50 else ("신중", "#9ca3af")
    return {"score": score, "label": label, "color": color,
            "message": msg, "services": services, "direction": "positive"}


# ─── 최종 종합 점수 ───────────────────────────────────────────────────────────

def calc_final_score(scores: dict, user_type: str = "창업 예정자") -> dict:
    """사용자 유형별 가중합으로 최종 점수 산출"""
    att = scores["attraction"]["score"]
    grw = scores["growth"]["score"]
    comp_inv = 100 - scores["competition"]["score"]   # 역점수
    pop = scores["population"]["score"]
    eco = scores["ecosystem"]["score"]
    sur = scores["survival"]["score"]
    rent_inv = 100 - scores["rent"]["score"]           # 역점수
    dbt = scores["debt"]["score"]

    if user_type == "창업 예정자":
        score = (att * 0.20 + grw * 0.15 + comp_inv * 0.20
                 + pop * 0.15 + sur * 0.15 + rent_inv * 0.15)
        label_name = "창업 적합도"
    elif user_type == "운영 중인 사업자":
        score = (grw * 0.20 + eco * 0.15 + comp_inv * 0.15
                 + pop * 0.10 + dbt * 0.25 + rent_inv * 0.15)
        label_name = "운영 안정도"
    elif user_type == "기존 매장 확장 검토":
        score = (att * 0.20 + grw * 0.20 + comp_inv * 0.15
                 + sur * 0.15 + dbt * 0.15 + scores["shinhan_growth"]["score"] * 0.15)
        label_name = "확장 적합도"
    else:  # 금융/보험/비용 구조 점검
        score = (dbt * 0.40 + grw * 0.20 + rent_inv * 0.20
                 + sur * 0.10 + eco * 0.10)
        label_name = "재무 체력 점수"

    score = round(score, 1)
    label, color = get_fit_grade(score)
    return {"score": score, "label": label, "color": color, "name": label_name}


# ─── 전체 점수 계산 진입점 ────────────────────────────────────────────────────

def calc_all_scores(
    sales_s: pd.Series,
    store_s: pd.Series,
    closure_s: pd.Series,
    fp_s: pd.Series,
    resident_s: pd.Series,
    worker_s: pd.Series,
    change_s: pd.Series,
    similar_s: pd.Series,
    kosis_df,
    rental_df,
    finance: dict,
    service_name: str = "",
    user_type: str = "창업 예정자",
    competitor_count: int = 0,
) -> dict:
    att   = score_commercial_attraction(sales_s, fp_s, resident_s, worker_s)
    grw   = score_sales_growth(sales_s)
    comp  = score_competition(store_s, similar_s, competitor_count)
    pop   = score_population_fit(fp_s, resident_s, worker_s)
    eco   = score_store_ecosystem(store_s, closure_s, change_s)
    sur   = score_industry_survival(kosis_df, service_name)
    rent  = score_rent_burden(rental_df)
    dbt   = score_debt_resilience(finance)

    sb    = score_shinhan_bank(dbt, finance)
    sc    = score_shinhan_card(sales_s, competitor_count)
    sl    = score_shinhan_life(service_name)
    sg    = score_shinhan_growth(att, grw, dbt)

    scores = {
        "attraction": att, "growth": grw, "competition": comp,
        "population": pop, "ecosystem": eco, "survival": sur,
        "rent": rent, "debt": dbt,
        "shinhan_bank": sb, "shinhan_card": sc,
        "shinhan_life": sl, "shinhan_growth": sg,
    }
    final = calc_final_score(scores, user_type)
    scores["final"] = final
    return scores


# ─── 조기경보 ─────────────────────────────────────────────────────────────────

def detect_early_warning(
    sales_s: pd.Series,
    avg_sales_s: pd.Series,
    store_s: pd.Series,
    floating_s: pd.Series,
) -> "list[str]":
    warnings = []
    if len(sales_s) >= 2:
        chg = _pct_change(sales_s)
        if chg < -10:
            warnings.append(f"최근 1분기 매출 {chg:.1f}% 감소")
    if len(sales_s) >= 2 and not avg_sales_s.empty:
        ratio = float(sales_s.iloc[-1]) / float(avg_sales_s.iloc[-1]) * 100 if avg_sales_s.iloc[-1] != 0 else 100
        if ratio < 70:
            warnings.append(f"상권 평균 대비 매출 {100-ratio:.0f}% 낮음")
    if len(store_s) >= 4:
        chg = _pct_change(store_s, 4)
        if chg > 20:
            warnings.append(f"동일 업종 점포 1년간 {chg:.0f}% 급증")
    if len(floating_s) >= 2:
        chg = _pct_change(floating_s)
        if chg < -10:
            warnings.append(f"유동인구 {chg:.1f}% 감소 추세")
    return warnings
