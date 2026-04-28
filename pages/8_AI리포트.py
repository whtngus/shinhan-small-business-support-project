"""화면 8: AI 리포트 생성 (Claude API)"""
import streamlit as st
import pandas as pd
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data_loader import (
    load_store_data, load_sales_data, load_floating_pop,
    load_kosis_survival, load_rental_trend,
)
from src.risk_engine import calc_risk_score, detect_early_warning
from utils.synthetic_data import generate_synthetic_store, calc_debt_resilience
from src.config import ANTHROPIC_API_KEY

st.set_page_config(page_title="AI 리포트", layout="wide")
st.title("🤖 AI 경영 처방 리포트")

상권_코드 = st.session_state.get("선택_상권_코드")
상권명 = st.session_state.get("선택_상권명", "-")
업종 = st.session_state.get("선택_업종", "")
분기 = st.session_state.get("선택_분기", "")

if not 상권_코드:
    st.warning("먼저 '상권/업종 선택' 화면에서 상권과 업종을 선택하세요.")
    st.stop()

st.subheader(f"{상권명} / {업종} / {분기}")
st.markdown("""
AI가 상권 데이터와 경영 위험 지표를 분석하여 맞춤형 경영 처방을 제공합니다.
""")


def build_context(상권_코드, 업종, 상권명):
    """AI 리포트 생성을 위한 컨텍스트 수집"""
    store_df = load_store_data()
    sales_df = load_sales_data()
    fp_df = load_floating_pop()
    kosis_df = load_kosis_survival()
    rental_df = load_rental_trend()

    def get_series(df, col):
        if df.empty or col not in df.columns:
            return pd.Series(dtype=float)
        mask = df["상권_코드"].astype(str) == str(상권_코드)
        if 업종 and "서비스_업종_코드_명" in df.columns:
            mask &= df["서비스_업종_코드_명"] == 업종
        return df[mask].sort_values("기준_년분기_코드")[col].dropna()

    sales_s = get_series(sales_df, "당월_매출_금액")
    store_s = get_series(store_df, "점포_수")
    closure_s = get_series(store_df, "폐업_률")
    fp_s = get_series(fp_df.rename(columns={}), "총_유동인구_수") if not fp_df.empty else pd.Series(dtype=float)
    if fp_s.empty and not fp_df.empty:
        fp_mask = fp_df["상권_코드"].astype(str) == str(상권_코드)
        fp_s = fp_df[fp_mask].sort_values("기준_년분기_코드")["총_유동인구_수"].dropna() if "총_유동인구_수" in fp_df.columns else pd.Series(dtype=float)

    avg_sales_s = sales_df[sales_df["상권_코드"].astype(str) == str(상권_코드)]["당월_매출_금액"].dropna() if not sales_df.empty and "당월_매출_금액" in sales_df.columns else pd.Series(dtype=float)

    risk = calc_risk_score(sales_s, store_s, closure_s, fp_s, 업종, kosis_df, rental_df)
    warnings = detect_early_warning(sales_s, avg_sales_s, store_s, fp_s)

    avg_monthly_sales = float(avg_sales_s.mean()) / 3 if not avg_sales_s.empty else 30_000_000
    synthetic = generate_synthetic_store(상권_코드, 상권명, 업종, avg_monthly_sales)
    debt_result = calc_debt_resilience(synthetic)

    return {
        "risk": risk,
        "warnings": warnings,
        "synthetic": synthetic,
        "debt": debt_result,
        "recent_sales": sales_s.tolist()[-4:] if len(sales_s) >= 4 else sales_s.tolist(),
        "recent_stores": store_s.tolist()[-4:] if len(store_s) >= 4 else store_s.tolist(),
        "recent_fp": fp_s.tolist()[-4:] if len(fp_s) >= 4 else fp_s.tolist(),
    }


def build_prompt(ctx, 상권명, 업종):
    risk = ctx["risk"]
    debt = ctx["debt"]
    syn = ctx["synthetic"]
    sales = ctx["recent_sales"]
    warnings = ctx["warnings"]

    sales_trend = "증가" if len(sales) >= 2 and sales[-1] > sales[-2] else "감소" if len(sales) >= 2 else "불명확"

    prompt = f"""당신은 소상공인 경영 전문 컨설턴트입니다. 아래 데이터를 분석하여 실용적인 경영 처방 리포트를 작성하세요.

## 분석 대상
- 상권: {상권명}
- 업종: {업종}

## 상권 데이터 요약
- 경영위험 점수: {risk['score']:.1f}/100 ({risk['grade']} 등급)
- 주요 위험 요인: {', '.join([f"{k}({v:.0f}점)" for k,v in risk['top_risks'][:3]])}
- 최근 분기 매출 추이: {sales_trend} ({[f"{int(s/10000):,}만원" for s in sales[-4:]]})
- 조기경보 신호: {warnings if warnings else ['없음']}

## 합성 점포 재무 현황 (PoC 목업)
- 월 매출: {syn['월_매출']:,}원
- 월 고정비: {syn['월_고정비']:,}원 (임대료 {syn['임대료']:,}원 포함)
- 이자부담률: {debt['이자부담률']}%
- 고정비부담률: {debt['고정비부담률']}%
- 현금보유 개월: {debt['현금보유개월']}개월
- 매출 10% 감소 시 생존 기간: {debt['매출10감소_생존개월']}개월
- 매출 20% 감소 시 생존 기간: {debt['매출20감소_생존개월']}개월

## 작성 요구사항
다음 구조로 간결하고 실용적인 리포트를 작성하세요:

### 1. 현재 상권 상태 요약 (3~5문장)
현재 상권의 전반적 상황을 객관적으로 요약

### 2. 주요 위험 요인 (3가지)
각 위험 요인에 대해 구체적 수치를 인용하며 설명

### 3. 단기 실행 전략 (이번 달~3개월)
바로 실행 가능한 구체적 액션 3~5가지

### 4. 중기 대응 방향 (3~6개월)
매출 구조 개선, 비용 절감, 고객 기반 확대 방향

### 5. 재무 안전망 점검
부채 구조와 현금흐름 기준 리스크 수준 및 주의사항

---
주의: 금융 상품 추천, 구체적인 투자 조언은 하지 마세요.
금융 상담이 필요한 경우 "신한은행 소상공인 지원 센터 상담을 권장합니다 (목업)"으로만 안내하세요.
"""
    return prompt


if st.button("AI 리포트 생성", type="primary"):
    if not ANTHROPIC_API_KEY:
        st.error("ANTHROPIC_API_KEY가 설정되지 않았습니다. .env 파일에 키를 입력하세요.")
        st.code("ANTHROPIC_API_KEY=your_api_key_here", language="bash")
    else:
        with st.spinner("데이터 수집 및 AI 분석 중... (10~20초 소요)"):
            try:
                ctx = build_context(상권_코드, 업종, 상권명)
                prompt = build_prompt(ctx, 상권명, 업종)

                import anthropic
                client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

                with st.empty():
                    report_text = ""
                    with client.messages.stream(
                        model="claude-sonnet-4-6",
                        max_tokens=2048,
                        messages=[{"role": "user", "content": prompt}],
                    ) as stream:
                        for text in stream.text_stream:
                            report_text += text
                            st.markdown(report_text + "▋")

                st.session_state["ai_report"] = report_text
                st.session_state["ai_report_context"] = {
                    "score": ctx["risk"]["score"],
                    "grade": ctx["risk"]["grade"],
                }

            except Exception as e:
                st.error(f"AI 리포트 생성 실패: {e}")

# 저장된 리포트 표시
if "ai_report" in st.session_state:
    st.markdown("---")
    st.markdown("### 생성된 AI 리포트")
    ctx_meta = st.session_state.get("ai_report_context", {})
    col1, col2 = st.columns(2)
    col1.metric("경영위험 점수", f"{ctx_meta.get('score', '-')}")
    col2.metric("위험 등급", ctx_meta.get('grade', '-'))

    st.markdown(st.session_state["ai_report"])

    st.markdown("---")
    st.info("""
    **📌 금융 연계 안내 (목업)**

    - 신한은행 소상공인 경영 지원 대출 상담: 신한은행 지점 방문 또는 SOL 앱
    - 소상공인진흥공단 경영 개선 자금: 1357 (소상공인 지원센터)
    - 서울신용보증재단 보증부 대출: 1588-6565

    ※ 본 리포트는 공공데이터 기반 참고 자료이며, 실제 금융 결정은 전문가와 상담하세요.
    """)

# API 키 없을 때 목업 리포트 예시
if not ANTHROPIC_API_KEY:
    with st.expander("AI 리포트 예시 (API 키 없이 목업 확인)"):
        st.markdown(f"""
### 1. 현재 상권 상태 요약
{상권명} 상권의 {업종} 업종은 현재 관심 수준의 경영 위험 상태에 있습니다.
최근 분기 유동인구는 전분기 대비 소폭 감소했으나 상권변화지표는 HL(고원)을 유지하고 있어
급격한 침체보다는 성장 둔화 국면으로 해석됩니다.

### 2. 주요 위험 요인
1. **경쟁 점포 증가**: 최근 4분기간 동일 업종 점포 수가 약 8% 증가하여 단위 점포당 매출 압박이 심화되고 있습니다.
2. **주말 매출 비중 저하**: 주중 대비 주말 매출 비중이 상권 평균 대비 낮아 수익 다각화가 필요합니다.
3. **고정비 부담**: 임대료와 인건비 합산이 매출의 45%를 초과하여 손익분기점 여유가 작습니다.

### 3. 단기 실행 전략 (이번 달~3개월)
- 오후 2~5시 유동인구 대비 매출 전환율 향상: 타임 세일 또는 테이크아웃 할인 도입
- 주말 방문 유도 SNS 홍보 강화 (인스타그램 위치 태그 + 주말 특별 메뉴)
- 단골 고객 재방문율 제고를 위한 스탬프 카드 또는 멤버십 도입

### 4. 중기 대응 방향 (3~6개월)
- 배달 플랫폼 입점을 통한 평일 오후 매출 채널 다변화
- 프랜차이즈 경쟁 대응: 로컬 특색 메뉴 개발로 차별화
- 인건비 구조 재검토: 피크타임 집중 파트타임 활용

### 5. 재무 안전망 점검
현재 이자부담률이 매출의 6% 수준으로 관리 가능한 범위이나,
매출이 20% 이상 하락할 경우 현금 여유가 3개월 이내로 줄어들 수 있습니다.
최소 2~3개월치 운영 자금을 유동성 자산으로 확보하시기 바랍니다.

신한은행 소상공인 경영 지원 상담을 권장합니다 (목업).
        """)
