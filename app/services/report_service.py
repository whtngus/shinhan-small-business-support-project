"""Gemini AI 리포트 서비스 - REST API 직접 호출 (Python 3.8 호환)"""
import json
import requests
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from src.config import GEMINI_API_KEY, GEMINI_MODEL, ENABLE_LLM_REPORT

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "{model}:generateContent?key={key}"
)


def call_gemini(prompt: str, max_tokens: int = 2000) -> str:
    if not GEMINI_API_KEY:
        return ""
    url = GEMINI_URL.format(model=GEMINI_MODEL, key=GEMINI_API_KEY)
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4},
    }
    try:
        r = requests.post(url, json=body, timeout=30)
        r.raise_for_status()
        data = r.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        return ""


def build_report_prompt(ctx: dict) -> str:
    area = ctx.get("area_name", "미지정")
    service = ctx.get("service_name", "미지정")
    risk_score = ctx.get("risk_score", 50)
    risk_grade = ctx.get("risk_grade", "관심")
    fit_score = ctx.get("fit_score", 50)
    fit_grade = ctx.get("fit_grade", "조건부 추천")
    user_type = ctx.get("user_type", "창업 예정자")
    store = ctx.get("store_summary", {})
    finance = ctx.get("finance", {})
    competitors = ctx.get("competitor_count_500m", 0)
    survival = ctx.get("survival_rate", "-")

    return f"""당신은 소상공인 창업·경영 전문 AI 컨설턴트입니다.
아래 공공데이터 분석 결과를 바탕으로 자영업자에게 실질적인 컨설팅 리포트를 작성하세요.

## 분석 대상
- 상권: {area}
- 업종: {service}
- 사용자 유형: {user_type}
- 분석 기준 분기: {ctx.get('year_quarter', '-')}

## 공공데이터 분석 결과
- 경영위험 점수: {risk_score:.0f}점 / 100 ({risk_grade} 등급)
- 창업 적합도: {fit_score:.0f}점 / 100 ({fit_grade})
- 반경 500m 경쟁점 수: {competitors}개
- 업종 생존율(5년): {survival}
- 점포 수: {store.get('store_count', '-')}개
- 폐업률: {store.get('closure_rate', '-')}
- 유동인구: {store.get('floating_pop', '-')}명/일

## 재무 시뮬레이션
- 보유 현금(운영·가용): {int(finance.get('cash_balance', 0) or 0):,}원
- 자기자본·본인 출자(참고): {int(finance.get('own_capital', 0) or finance.get('cash_balance', 0) or 0):,}원
- 예상 월매출: {int(finance.get('monthly_sales', 0) or 0):,}원
- 손익분기 매출: {int(finance.get('break_even', 0) or 0):,}원
- 이자부담률: {float(finance.get('interest_ratio', 0) or 0):.1f}%
- 월 고정비(임대·인건비·이자·기타): {int(finance.get('fixed_cost', 0) or 0):,}원
- 월 원리금 상환(대출): {int(finance.get('monthly_repayment', 0) or 0):,}원
- 초기 소요(추정): {int(finance.get('initial_investment', 0) or 0):,}원
- 조달·대출 검토(참고, 자기자본 대비 부족분): {int(finance.get('funding_gap_estimate', 0) or 0):,}원
- 현금버팀 개월수(추정, 매출 급감 시 참고): {float(finance.get('cash_months', 0) or 0):.1f}개월

## 작성 지침
1. 다음 9개 섹션으로 구성하세요. 각 섹션 제목은 ## 마크다운 헤딩으로 표시하세요.
2. 각 섹션은 3~5문장으로 구체적으로 작성하세요.
3. 재무 시뮬레이션의 **보유 현금**, **자기자본**, **현금버팀 개월수**, **손익분기 매출**은 반드시 해당 섹션 본문에 숫자를 넣어 언급하세요.
4. 금융상품을 확정 추천하지 말고 "상담 필요", "점검 필요", "검토 가능" 수준으로만 표현하세요.
5. 한국어로 자연스럽게 작성하세요.
6. 데이터 기반 근거를 반드시 포함하세요.

## 섹션 구성
### 현재 상권 요약
### 주요 기회 요인
### 주요 위험 요인
### 창업/운영 전략
### 본인·보유 자금 및 현금 버팀
### 금융 점검 필요성
### 보험 점검 필요성
### 카드 활용 전략
### 다음 실행 순서"""


def build_template_report(ctx: dict) -> str:
    area = ctx.get("area_name", "선택 상권")
    service = ctx.get("service_name", "선택 업종")
    risk_score = ctx.get("risk_score", 50)
    risk_grade = ctx.get("risk_grade", "관심")
    fit_grade = ctx.get("fit_grade", "조건부 추천")
    competitors = ctx.get("competitor_count_500m", 0)
    finance = ctx.get("finance", {})
    monthly = finance.get("monthly_sales", 0)
    be = finance.get("break_even", 0)
    cash_m = finance.get("cash_months", 0)
    cash_bal = int(finance.get("cash_balance", 0) or 0)
    own_cap = int(finance.get("own_capital", 0) or cash_bal)
    init_inv = int(finance.get("initial_investment", 0) or 0)
    gap_est = int(finance.get("funding_gap_estimate", 0) or 0)
    fc = int(finance.get("fixed_cost", 0) or 0)
    mrep = int(finance.get("monthly_repayment", 0) or 0)
    burn_hint = fc + mrep

    surplus = "상회" if monthly >= be else "하회"
    cash_warn = "운영자금 점검이 필요합니다." if cash_m < 6 else "비교적 안정적입니다."

    return f"""### 현재 상권 요약
{area} 상권의 {service} 업종을 분석했습니다. 경영위험 점수는 **{risk_score:.0f}점({risk_grade} 등급)**으로 평가됩니다. 창업 적합도는 **{fit_grade}** 수준입니다. 공공데이터 기반 분석이므로 현장 조사와 병행하시기 바랍니다.

### 주요 기회 요인
선택 상권은 서울시 공공데이터에 기반한 유동인구와 매출 잠재력이 확인된 상권입니다. 업종 수요가 유지되는 상권 특성상 적절한 차별화 전략 수립 시 안정적인 운영이 가능합니다. 상권 내 소비력 지표를 활용한 타깃 고객 설정이 중요합니다.

### 주요 위험 요인
반경 500m 내 동일 업종 경쟁점이 **{competitors}개**로 확인되어 경쟁 강도를 면밀히 검토해야 합니다. 고정비(임대료·인건비) 부담이 손익분기점 달성의 주요 변수입니다. 경기 변동에 따른 소비 감소 가능성도 고려해야 합니다.

### 창업/운영 전략
예상 월매출이 손익분기점을 **{surplus}**하는 구조입니다. 초기 6개월 운영자금 확보 후 진입하는 것이 안전합니다. 경쟁점 대비 차별화(메뉴 특화, 운영 시간대, 객단가 전략)가 핵심입니다. 시간대·요일별 매출 패턴을 분석하여 피크타임 운영 최적화를 권장합니다.

### 본인·보유 자금 (추정·참고)
보유 현금(운영·가용)은 **{cash_bal:,}원**, 자기자본·본인 출자 등은 **{own_cap:,}원**으로 분석에 반영되었습니다. 초기 소요(추정)는 **{init_inv:,}원**이며, 자기자본 대비 부족분 참고 조달액은 **{gap_est:,}원** 수준입니다. 현금 버팀 개월수 **{cash_m:.1f}개월**은 보유 현금을 기준으로 월 고정비·이자·원리금 상환 등 추정 월 현금 소모(약 **{burn_hint:,}원/월**)를 반영한 참고값입니다.

### 금융 점검 필요성
현금보유 기준으로 약 **{cash_m:.1f}개월** 운영 가능하다는 추정이며 {cash_warn} 초기 투자금과 운영자금 계획을 사전에 검토하고, 필요 시 개인사업자 자금 상담을 받아보실 수 있습니다. 정책자금 활용 가능성도 점검해볼 것을 권장합니다. (대출 가능 여부와 금리는 실제 심사를 통해 확인해야 합니다.)

### 보험 점검 필요성
방문형 매장의 경우 화재보험 및 배상책임보험은 필수 점검 항목입니다. 직원 고용 시 산재보험과 고용보험 의무 가입 여부를 확인해야 합니다. 휴업 리스크를 대비한 보장 범위 점검도 권장합니다.

### 카드 활용 전략
경쟁점이 많은 상권에서는 신규 고객 확보보다 재방문율 관리가 중요합니다. 카드 가맹점 매출관리 서비스를 통해 시간대별·요일별 매출 패턴을 파악하고 프로모션 효율을 높일 수 있습니다. 객단가 상승을 위한 세트메뉴·멤버십 전략도 검토하세요.

### 다음 실행 순서
1. 현장 방문 - 경쟁점 현황과 유동인구 패턴을 직접 확인하세요.
2. 자금 계획 - 초기 투자금, 6개월 운영자금, 예비자금 구조를 수립하세요.
3. 보험 점검 - 화재·배상책임 보험 가입 여부를 확인하세요.
4. 필요 시 전문가 상담 - 세무사, 창업 컨설턴트와 사업계획서를 검토하세요.
5. 가맹점 등록 - 카드 매출관리 서비스 가입을 준비하세요."""


def generate_report(ctx: dict) -> dict:
    if not ENABLE_LLM_REPORT or not GEMINI_API_KEY:
        return {"source": "template", "content": build_template_report(ctx)}

    prompt = build_report_prompt(ctx)
    text = call_gemini(prompt)
    if text:
        return {"source": "gemini", "content": text}
    return {"source": "template", "content": build_template_report(ctx)}
