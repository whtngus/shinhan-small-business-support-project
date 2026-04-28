"""화면 6: 경영위험 점수"""
import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data_loader import (
    load_store_data, load_sales_data, load_floating_pop,
    load_kosis_survival, load_rental_trend,
)
from src.risk_engine import calc_risk_score, detect_early_warning

st.set_page_config(page_title="경영위험 점수", layout="wide")
st.title("⚠️ 경영위험 점수")

상권_코드 = st.session_state.get("선택_상권_코드")
상권명 = st.session_state.get("선택_상권명", "-")
업종 = st.session_state.get("선택_업종")

if not 상권_코드:
    st.warning("먼저 '상권/업종 선택' 화면에서 상권과 업종을 선택하세요.")
    st.stop()

st.subheader(f"{상권명} / {업종}")

with st.spinner("데이터 로딩 중..."):
    store_df = load_store_data()
    sales_df = load_sales_data()
    fp_df = load_floating_pop()
    kosis_df = load_kosis_survival()
    rental_df = load_rental_trend()


def get_series(df, 상권_코드, 업종=None, col="당월_매출_금액"):
    if df.empty or col not in df.columns:
        return pd.Series(dtype=float)
    mask = df["상권_코드"].astype(str) == str(상권_코드)
    if 업종 and "서비스_업종_코드_명" in df.columns:
        mask &= df["서비스_업종_코드_명"] == 업종
    sub = df[mask].sort_values("기준_년분기_코드")
    return sub[col].dropna()


sales_s = get_series(sales_df, 상권_코드, 업종, "당월_매출_금액")
store_s = get_series(store_df, 상권_코드, 업종, "점포_수")
closure_s = get_series(store_df, 상권_코드, 업종, "폐업_률")
fp_s = get_series(fp_df, 상권_코드, col="총_유동인구_수")

# 상권 전체 평균 매출 (업종 구분 없이)
avg_sales_s = get_series(sales_df, 상권_코드, col="당월_매출_금액")

risk = calc_risk_score(sales_s, store_s, closure_s, fp_s, 업종 or "", kosis_df, rental_df)

# 게이지 차트
fig_gauge = go.Figure(go.Indicator(
    mode="gauge+number+delta",
    value=risk["score"],
    title={"text": "경영위험 점수"},
    gauge={
        "axis": {"range": [0, 100]},
        "bar": {"color": risk["color"]},
        "steps": [
            {"range": [0, 40], "color": "lightgreen"},
            {"range": [40, 60], "color": "lightyellow"},
            {"range": [60, 80], "color": "lightsalmon"},
            {"range": [80, 100], "color": "lightcoral"},
        ],
        "threshold": {"line": {"color": "red", "width": 4}, "thickness": 0.75, "value": risk["score"]},
    },
))
fig_gauge.update_layout(height=350)

col1, col2 = st.columns([1, 2])

with col1:
    grade_emoji = {"안정": "🟢", "관심": "🔵", "주의": "🟠", "위험": "🔴"}
    emoji = grade_emoji.get(risk["grade"], "⚪")
    st.markdown(f"## {emoji} {risk['grade']} 등급")
    st.markdown(f"### 위험점수: **{risk['score']:.1f}** / 100")
    st.markdown("""
    | 점수 | 등급 |
    |------|------|
    | 0~39 | 🟢 안정 |
    | 40~59 | 🔵 관심 |
    | 60~79 | 🟠 주의 |
    | 80~100 | 🔴 위험 |
    """)

with col2:
    st.plotly_chart(fig_gauge, use_container_width=True)

st.markdown("---")

col3, col4 = st.columns(2)

with col3:
    st.markdown("### 위험 요인별 점수")
    factor_names = {
        "sales_decline": "매출 감소",
        "store_competition": "경쟁 점포 증가",
        "closure_increase": "폐업률 상승",
        "floating_pop_decline": "유동인구 감소",
        "industry_survival": "업종 생존율",
        "rent_increase": "임대료 상승",
    }
    comp_df = pd.DataFrame([
        {"위험요인": factor_names.get(k, k), "점수": round(v, 1)}
        for k, v in risk["components"].items()
    ]).sort_values("점수", ascending=True)

    fig_bar = go.Figure(go.Bar(
        x=comp_df["점수"],
        y=comp_df["위험요인"],
        orientation="h",
        marker_color=["red" if s >= 70 else "orange" if s >= 50 else "green" for s in comp_df["점수"]],
    ))
    fig_bar.update_layout(title="위험요인별 점수 (높을수록 위험)", height=300)
    st.plotly_chart(fig_bar, use_container_width=True)

with col4:
    st.markdown("### 위험 요인 Top 5")
    for i, (factor, score) in enumerate(risk["top_risks"], 1):
        color = "red" if score >= 70 else "orange" if score >= 50 else "green"
        st.markdown(f"**{i}. {factor}** — `{score:.1f}점`")

# 조기경보
st.markdown("---")
st.markdown("### 위기 조기경보")
warnings = detect_early_warning(sales_s, avg_sales_s, store_s, fp_s)
if warnings:
    for w in warnings:
        st.warning(f"⚠️ {w}")
else:
    st.success("현재 이상 징후가 감지되지 않았습니다.")

# 산식 설명
with st.expander("위험점수 산식 보기"):
    st.markdown("""
    ```
    위험점수 =
      0.25 × 매출감소위험
    + 0.20 × 점포경쟁위험
    + 0.15 × 폐업증가위험
    + 0.15 × 유동인구감소위험
    + 0.15 × 업종생존율위험 (KOSIS 5년 생존율 역수)
    + 0.10 × 임대료상승위험 (한국부동산원 임대가격지수)
    ```
    각 요소는 0~100으로 정규화 후 가중 합산됩니다.
    """)
