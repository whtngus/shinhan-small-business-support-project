"""화면 7: 부채체력 목업 시뮬레이션"""
import streamlit as st
import plotly.graph_objects as go
import pandas as pd
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data_loader import load_sales_data
from utils.synthetic_data import generate_synthetic_store, calc_debt_resilience

st.set_page_config(page_title="부채체력 시뮬레이션", layout="wide")
st.title("💰 부채체력 목업 시뮬레이션")

상권_코드 = st.session_state.get("선택_상권_코드")
상권명 = st.session_state.get("선택_상권명", "-")
업종 = st.session_state.get("선택_업종", "")

st.markdown("""
> **PoC 안내**: 실제 개인사업자 데이터 없이 상권 평균 매출 기반 합성 데이터를 사용합니다.
> 향후 신한카드/신한은행 실데이터 연계 시 이 화면을 그대로 활용할 수 있습니다.
""")

# 상권 평균 매출 조회 (합성 데이터 기준점)
avg_monthly_sales = 30_000_000  # 기본값 3천만원

if 상권_코드:
    with st.spinner("상권 평균 매출 조회 중..."):
        sales_df = load_sales_data()
        if not sales_df.empty:
            mask = sales_df["상권_코드"].astype(str) == str(상권_코드)
            if 업종 and "서비스_업종_코드_명" in sales_df.columns:
                mask &= sales_df["서비스_업종_코드_명"] == 업종
            sub = sales_df[mask]
            if not sub.empty and "당월_매출_금액" in sub.columns:
                # 분기 매출 → 월 평균 (분기/3)
                avg_monthly_sales = float(sub["당월_매출_금액"].mean()) / 3

tab1, tab2 = st.tabs(["직접 입력", "합성 데이터 자동 생성"])

with tab1:
    st.markdown("### 내 점포 정보 입력")
    col1, col2 = st.columns(2)
    with col1:
        월매출 = st.number_input("월 매출 (원)", value=int(avg_monthly_sales), step=1_000_000, format="%d")
        임대료 = st.number_input("월 임대료 (원)", value=int(avg_monthly_sales * 0.15), step=100_000, format="%d")
        인건비 = st.number_input("월 인건비 (원)", value=int(avg_monthly_sales * 0.30), step=100_000, format="%d")
        기타고정비 = st.number_input("기타 월 고정비 (원)", value=int(avg_monthly_sales * 0.10), step=100_000, format="%d")
    with col2:
        대출잔액 = st.number_input("대출 잔액 (원)", value=int(avg_monthly_sales * 12), step=1_000_000, format="%d")
        금리 = st.slider("연 금리 (%)", min_value=2.0, max_value=15.0, value=5.5, step=0.1) / 100
        현금보유 = st.number_input("현금 보유액 (원)", value=int(avg_monthly_sales * 1.5), step=500_000, format="%d")
        변동비 = st.number_input("월 변동비 (원)", value=int(avg_monthly_sales * 0.25), step=100_000, format="%d")

    store_input = {
        "월_매출": 월매출,
        "임대료": 임대료,
        "인건비": 인건비,
        "기타_고정비": 기타고정비,
        "월_고정비": 임대료 + 인건비 + 기타고정비,
        "변동비": 변동비,
        "대출잔액": 대출잔액,
        "금리": 금리,
        "월_이자": int(대출잔액 * (금리 / 12)),
        "현금보유액": 현금보유,
    }

    result = calc_debt_resilience(store_input)

    st.markdown("---")
    st.markdown("### 진단 결과")

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("이자부담률", f"{result['이자부담률']}%", help="월 이자 / 월 매출")
    c2.metric("고정비부담률", f"{result['고정비부담률']}%", help="월 고정비 / 월 매출")
    c3.metric("월 순현금흐름", f"{result['순현금흐름']:,}원")
    months = result['현금보유개월']
    c4.metric("현금보유 개월", f"{months}개월" if months < 999 else "여유 있음")

    st.markdown("### 매출 하락 시 생존 시뮬레이션")
    col_a, col_b = st.columns(2)
    col_a.metric(
        "매출 10% 감소 시 버틸 수 있는 기간",
        f"{result['매출10감소_생존개월']}개월" if result['매출10감소_생존개월'] < 36 else "36개월 이상",
        delta=None,
    )
    col_b.metric(
        "매출 20% 감소 시 버틸 수 있는 기간",
        f"{result['매출20감소_생존개월']}개월" if result['매출20감소_생존개월'] < 36 else "36개월 이상",
        delta=None,
    )

    # 금리 상승 시뮬레이션
    st.markdown("### 금리 상승 민감도")
    금리_시나리오 = [금리, 금리 + 0.01, 금리 + 0.02, 금리 + 0.03]
    이자_시나리오 = [int(대출잔액 * r / 12) for r in 금리_시나리오]
    fig_rate = go.Figure(go.Bar(
        x=[f"{r*100:.1f}%" for r in 금리_시나리오],
        y=이자_시나리오,
        text=[f"{v:,}원" for v in 이자_시나리오],
        textposition="auto",
    ))
    fig_rate.update_layout(title="금리 상승에 따른 월 이자 변화", xaxis_title="금리", yaxis_title="월 이자(원)", height=300)
    st.plotly_chart(fig_rate, use_container_width=True)

    # 비용 구조 파이차트
    st.markdown("### 비용 구조")
    비용항목 = {"임대료": 임대료, "인건비": 인건비, "기타고정비": 기타고정비, "변동비": 변동비, "이자": store_input["월_이자"]}
    fig_pie = go.Figure(go.Pie(labels=list(비용항목.keys()), values=list(비용항목.values())))
    fig_pie.update_layout(title="월 비용 구조", height=350)
    st.plotly_chart(fig_pie, use_container_width=True)

with tab2:
    st.markdown("### 합성 데이터 자동 생성 (PoC 시연용)")
    seed = st.number_input("시드 번호 (바꾸면 다른 점포 생성)", value=42, min_value=1, max_value=9999)

    if st.button("합성 점포 데이터 생성", type="primary"):
        synthetic = generate_synthetic_store(
            상권_코드=상권_코드 or "0",
            상권명=상권명,
            서비스_업종명=업종 or "음식점",
            상권_평균_매출=avg_monthly_sales,
            seed=int(seed),
        )
        result_s = calc_debt_resilience(synthetic)
        st.session_state["synthetic_store"] = synthetic
        st.session_state["synthetic_result"] = result_s

    if "synthetic_store" in st.session_state:
        s = st.session_state["synthetic_store"]
        r = st.session_state["synthetic_result"]
        st.markdown("**합성 점포 재무 현황**")
        st.dataframe(pd.DataFrame({
            "항목": ["월 매출", "월 고정비", "월 이자", "현금보유액", "대출잔액"],
            "금액": [f"{s['월_매출']:,}원", f"{s['월_고정비']:,}원", f"{s['월_이자']:,}원", f"{s['현금보유액']:,}원", f"{s['대출잔액']:,}원"],
        }), hide_index=True)

        c1, c2, c3 = st.columns(3)
        c1.metric("이자부담률", f"{r['이자부담률']}%")
        c2.metric("고정비부담률", f"{r['고정비부담률']}%")
        c3.metric("현금보유 개월", f"{r['현금보유개월']}개월" if r['현금보유개월'] < 999 else "여유")

        st.info("💡 이 합성 데이터는 향후 신한카드 실매출 데이터 및 신한은행 대출/예금 데이터로 대체됩니다.")
