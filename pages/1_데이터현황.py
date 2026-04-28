"""화면 1: 데이터 현황 대시보드"""
import streamlit as st
import pandas as pd
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data_loader import (
    get_data_summary, load_area, load_store_data,
    load_floating_pop, load_kosis_survival, load_commercial_change,
)

st.set_page_config(page_title="데이터 현황", layout="wide")
st.title("📁 데이터 현황 대시보드")
st.markdown("로딩된 CSV/Excel 파일 목록 및 기본 통계를 확인합니다.")

with st.spinner("데이터 현황 로딩 중..."):
    summary = get_data_summary()

DATA_NAMES = {
    "kosis_survival": "KOSIS 기업생멸통계",
    "real_estate_trade": "국토교통부 실거래가",
    "floating_pop": "서울시 유동인구",
    "commercial_change": "서울시 상권변화지표",
    "resident_pop": "서울시 상주인구",
    "income_consume": "서울시 소득소비",
    "area": "서울시 상권 영역",
    "store": "서울시 점포 현황",
    "worker_pop": "서울시 직장인구",
    "facilities": "서울시 집객시설",
    "sales": "서울시 추정매출",
    "sosnogongdan": "소상공인 상가정보",
    "rental_trend": "한국부동산원 임대동향",
}

# 파일 현황 테이블
rows = []
for key, info in summary.items():
    rows.append({
        "데이터명": DATA_NAMES.get(key, key),
        "파일 수": info.get("file_count", 0),
        "상태": "✅ 정상" if info.get("exists") else "❌ 없음",
    })
df_status = pd.DataFrame(rows)

col1, col2, col3 = st.columns(3)
col1.metric("총 데이터 소스", len(rows))
col2.metric("정상 로드 가능", sum(1 for r in rows if "✅" in r["상태"]))
col3.metric("총 파일 수", sum(r["파일 수"] for r in rows))

st.subheader("파일 현황")
st.dataframe(df_status, use_container_width=True, hide_index=True)

st.markdown("---")
st.subheader("주요 데이터 상세")

tabs = st.tabs(["상권 영역", "점포 현황", "유동인구", "상권변화지표", "생존율"])

with tabs[0]:
    with st.spinner("상권 영역 데이터 로딩..."):
        area_df = load_area()
    if not area_df.empty:
        st.metric("상권 수", f"{len(area_df):,}개")
        col1, col2 = st.columns(2)
        if "상권_구분_코드_명" in area_df.columns:
            col1.write("**상권 구분별 수**")
            col1.dataframe(area_df["상권_구분_코드_명"].value_counts().reset_index(), hide_index=True)
        if "자치구_코드_명" in area_df.columns:
            col2.write("**자치구별 상권 수 (상위 10)**")
            col2.dataframe(area_df["자치구_코드_명"].value_counts().head(10).reset_index(), hide_index=True)
        st.write("**샘플 데이터**")
        st.dataframe(area_df.head(5), use_container_width=True)
    else:
        st.warning("상권 영역 데이터를 로드할 수 없습니다.")

with tabs[1]:
    with st.spinner("점포 데이터 로딩... (대용량, 시간이 걸릴 수 있습니다)"):
        store_df = load_store_data()
    if not store_df.empty:
        st.metric("총 점포 데이터 행수", f"{len(store_df):,}행")
        if "기준_년분기_코드" in store_df.columns:
            분기목록 = sorted(store_df["기준_년분기_코드"].unique())
            col1, col2 = st.columns(2)
            col1.metric("기준 분기 범위", f"{분기목록[0]} ~ {분기목록[-1]}")
            col2.metric("분기 수", len(분기목록))
        if "서비스_업종_코드_명" in store_df.columns:
            업종수 = store_df["서비스_업종_코드_명"].nunique()
            st.metric("업종 수", f"{업종수}종")
        st.dataframe(store_df.head(5), use_container_width=True)
    else:
        st.warning("점포 데이터를 로드할 수 없습니다.")

with tabs[2]:
    with st.spinner("유동인구 데이터 로딩..."):
        fp_df = load_floating_pop()
    if not fp_df.empty:
        st.metric("유동인구 데이터 행수", f"{len(fp_df):,}행")
        if "기준_년분기_코드" in fp_df.columns:
            분기목록 = sorted(fp_df["기준_년분기_코드"].unique())
            st.metric("기준 분기 범위", f"{분기목록[0]} ~ {분기목록[-1]}")
        st.dataframe(fp_df.head(5), use_container_width=True)
    else:
        st.warning("유동인구 데이터를 로드할 수 없습니다.")

with tabs[3]:
    with st.spinner("상권변화지표 로딩..."):
        cc_df = load_commercial_change()
    if not cc_df.empty:
        st.metric("상권변화지표 데이터 행수", f"{len(cc_df):,}행")
        st.dataframe(cc_df.head(5), use_container_width=True)
        st.info("상권변화지표: HH(확장), HL(고원), LH(회복), LL(침체)")
    else:
        st.warning("상권변화지표 데이터를 로드할 수 없습니다.")

with tabs[4]:
    with st.spinner("KOSIS 생존율 데이터 로딩..."):
        kosis_df = load_kosis_survival()
    if not kosis_df.empty:
        st.metric("생존율 데이터 행수", f"{len(kosis_df):,}행")
        st.dataframe(kosis_df.head(10), use_container_width=True)
    else:
        st.warning("KOSIS 생존율 데이터를 로드할 수 없습니다.")
