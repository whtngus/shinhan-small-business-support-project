"""화면 3: 상권 경쟁력 대시보드 KPI"""
import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data_loader import (
    load_store_data, load_sales_data, load_floating_pop,
    load_resident_pop, load_worker_pop, load_commercial_change, load_facilities,
)

st.set_page_config(page_title="상권 경쟁력", layout="wide")
st.title("📊 상권 경쟁력 대시보드")

상권_코드 = st.session_state.get("선택_상권_코드")
상권명 = st.session_state.get("선택_상권명", "-")
업종 = st.session_state.get("선택_업종")
분기 = st.session_state.get("선택_분기")

if not 상권_코드:
    st.warning("먼저 '상권/업종 선택' 화면에서 상권과 업종을 선택하세요.")
    st.stop()

st.subheader(f"{상권명} / {업종} / {분기}")

with st.spinner("데이터 로딩 중..."):
    store_df = load_store_data()
    sales_df = load_sales_data()
    fp_df = load_floating_pop()
    rp_df = load_resident_pop()
    wp_df = load_worker_pop()
    cc_df = load_commercial_change()
    fac_df = load_facilities()


def filter_by_area_quarter(df, 상권_코드, 분기):
    if df.empty:
        return pd.DataFrame()
    mask = df["상권_코드"].astype(str) == str(상권_코드)
    if 분기 and "기준_년분기_코드" in df.columns:
        mask &= df["기준_년분기_코드"].astype(str) == str(분기)
    return df[mask]


store_row = filter_by_area_quarter(store_df, 상권_코드, 분기)
if 업종 and "서비스_업종_코드_명" in store_row.columns:
    store_row = store_row[store_row["서비스_업종_코드_명"] == 업종]

sales_row = filter_by_area_quarter(sales_df, 상권_코드, 분기)
if 업종 and "서비스_업종_코드_명" in sales_row.columns:
    sales_row = sales_row[sales_row["서비스_업종_코드_명"] == 업종]

fp_row = filter_by_area_quarter(fp_df, 상권_코드, 분기)
rp_row = filter_by_area_quarter(rp_df, 상권_코드, 분기)
wp_row = filter_by_area_quarter(wp_df, 상권_코드, 분기)
cc_row = filter_by_area_quarter(cc_df, 상권_코드, 분기)
fac_row = filter_by_area_quarter(fac_df, 상권_코드, 분기)


def safe_val(df, col, fmt=None):
    if df.empty or col not in df.columns:
        return "-"
    v = df[col].iloc[0]
    if pd.isna(v):
        return "-"
    if fmt == "money":
        return f"{int(v):,}원"
    if fmt == "count":
        return f"{int(v):,}건"
    if fmt == "pct":
        return f"{float(v):.1f}%"
    return str(v)


st.markdown("### 핵심 지표")
cols = st.columns(5)
cols[0].metric("분기 추정매출", safe_val(sales_row, "당월_매출_금액", "money"))
cols[1].metric("분기 매출건수", safe_val(sales_row, "당월_매출_건수", "count"))
cols[2].metric("점포 수", safe_val(store_row, "점포_수"))
cols[3].metric("개업 점포", safe_val(store_row, "개업_점포_수"))
cols[4].metric("폐업 점포", safe_val(store_row, "폐업_점포_수"))

cols2 = st.columns(5)
cols2[0].metric("프랜차이즈 점포", safe_val(store_row, "프랜차이즈_점포_수"))
cols2[1].metric("유동인구", safe_val(fp_row, "총_유동인구_수", "count"))
cols2[2].metric("상주인구", safe_val(rp_row, "총_상주인구_수", "count"))
cols2[3].metric("직장인구", safe_val(wp_row, "총_직장_인구_수", "count"))
cols2[4].metric("집객시설", safe_val(fac_row, "집객시설_수"))

st.markdown("---")
st.markdown("### 상권변화지표")
if not cc_row.empty:
    변화지표 = safe_val(cc_row, "상권_변화_지표")
    변화지표명 = safe_val(cc_row, "상권_변화_지표_명") if "상권_변화_지표_명" in cc_row.columns else "-"
    grade_colors = {"HH": "green", "HL": "orange", "LH": "blue", "LL": "red"}
    grade_desc = {
        "HH": "확장 (매출·유동인구 모두 증가)",
        "HL": "고원 (매출 높지만 성장세 둔화)",
        "LH": "회복 (침체 후 개선 조짐)",
        "LL": "침체 (매출·유동인구 모두 감소)",
    }
    color = grade_colors.get(str(변화지표), "gray")
    desc = grade_desc.get(str(변화지표), "")
    st.markdown(f"**{변화지표}** ({변화지표명}) - {desc}")

    col1, col2 = st.columns(2)
    col1.metric("운영 영업 개월 평균", safe_val(cc_row, "운영_영업_개월_평균"))
    col2.metric("폐업 영업 개월 평균", safe_val(cc_row, "폐업_영업_개월_평균"))
else:
    st.info("상권변화지표 데이터가 없습니다.")

st.markdown("---")
st.markdown("### 집객시설 상세")
if not fac_row.empty:
    fac_cols = [
        "관공서_수", "은행_수", "종합병원_수", "일반_병원_수", "약국_수",
        "초등학교_수", "중학교_수", "고등학교_수", "대학교_수",
        "백화점_수", "슈퍼마켓_수", "극장_수", "숙박_시설_수",
        "지하철_역_수", "버스_정거장_수",
    ]
    available = {c: fac_row[c].iloc[0] for c in fac_cols if c in fac_row.columns and not pd.isna(fac_row[c].iloc[0])}
    if available:
        fac_display = pd.DataFrame(available.items(), columns=["시설", "수"])
        fac_display["시설"] = fac_display["시설"].str.replace("_수", "")
        fig = go.Figure(go.Bar(x=fac_display["시설"], y=fac_display["수"]))
        fig.update_layout(title="집객시설 현황", height=300)
        st.plotly_chart(fig, use_container_width=True)
