"""화면 2: 상권/업종 선택 (cascade 필터)"""
import streamlit as st
import pandas as pd
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data_loader import load_area, load_store_data

st.set_page_config(page_title="상권/업종 선택", layout="wide")
st.title("🔍 상권/업종 선택")

@st.cache_data(show_spinner=False)
def get_area_store_meta():
    area = load_area()
    store = load_store_data()
    return area, store

with st.spinner("데이터 로딩 중..."):
    area_df, store_df = get_area_store_meta()

if area_df.empty:
    st.error("상권 영역 데이터를 로드할 수 없습니다.")
    st.stop()

st.markdown("자치구 → 행정동 → 상권 → 업종 순서로 선택하세요.")

# cascade 필터
col1, col2 = st.columns(2)

with col1:
    자치구_목록 = ["전체"] + sorted(area_df["자치구_코드_명"].dropna().unique().tolist()) if "자치구_코드_명" in area_df.columns else ["전체"]
    선택_자치구 = st.selectbox("자치구", 자치구_목록)

    if 선택_자치구 == "전체":
        filtered_area = area_df
    else:
        filtered_area = area_df[area_df["자치구_코드_명"] == 선택_자치구]

    행정동_목록 = ["전체"] + sorted(filtered_area["행정동_코드_명"].dropna().unique().tolist()) if "행정동_코드_명" in filtered_area.columns else ["전체"]
    선택_행정동 = st.selectbox("행정동", 행정동_목록)

    if 선택_행정동 != "전체" and "행정동_코드_명" in filtered_area.columns:
        filtered_area = filtered_area[filtered_area["행정동_코드_명"] == 선택_행정동]

with col2:
    상권구분_목록 = ["전체"] + sorted(filtered_area["상권_구분_코드_명"].dropna().unique().tolist()) if "상권_구분_코드_명" in filtered_area.columns else ["전체"]
    선택_상권구분 = st.selectbox("상권 구분", 상권구분_목록)

    if 선택_상권구분 != "전체" and "상권_구분_코드_명" in filtered_area.columns:
        filtered_area = filtered_area[filtered_area["상권_구분_코드_명"] == 선택_상권구분]

    상권명_목록 = sorted(filtered_area["상권_코드_명"].dropna().unique().tolist()) if "상권_코드_명" in filtered_area.columns else []
    선택_상권명 = st.selectbox("상권명", 상권명_목록 if 상권명_목록 else ["(상권 없음)"])

# 상권 코드 찾기
선택_상권_행 = filtered_area[filtered_area["상권_코드_명"] == 선택_상권명] if 선택_상권명 != "(상권 없음)" else pd.DataFrame()
선택_상권_코드 = str(선택_상권_행["상권_코드"].iloc[0]) if not 선택_상권_행.empty and "상권_코드" in 선택_상권_행.columns else None

# 업종 선택 (해당 상권의 업종 목록)
업종_선택 = None
if not store_df.empty and 선택_상권_코드:
    store_filtered = store_df[store_df["상권_코드"].astype(str) == 선택_상권_코드]
    업종_목록 = sorted(store_filtered["서비스_업종_코드_명"].dropna().unique().tolist()) if "서비스_업종_코드_명" in store_filtered.columns else []
    if 업종_목록:
        업종_선택 = st.selectbox("서비스 업종", 업종_목록)
    else:
        st.info("해당 상권의 업종 데이터가 없습니다.")

# 기준 연도/분기
st.markdown("---")
col3, col4 = st.columns(2)
with col3:
    분기_목록 = sorted(store_df["기준_년분기_코드"].astype(str).unique().tolist()) if not store_df.empty and "기준_년분기_코드" in store_df.columns else []
    if 분기_목록:
        선택_분기 = st.selectbox("기준 분기", 분기_목록[::-1])  # 최신순
    else:
        선택_분기 = None

# 세션 저장
if st.button("선택 완료 → 분석 시작", type="primary"):
    st.session_state["선택_자치구"] = 선택_자치구
    st.session_state["선택_행정동"] = 선택_행정동
    st.session_state["선택_상권명"] = 선택_상권명
    st.session_state["선택_상권_코드"] = 선택_상권_코드
    st.session_state["선택_업종"] = 업종_선택
    st.session_state["선택_분기"] = 선택_분기
    st.success(f"선택 완료: {선택_상권명} / {업종_선택} / {선택_분기}")
    st.info("왼쪽 메뉴에서 '상권 경쟁력' 또는 '추이 분석' 화면으로 이동하세요.")

# 현재 선택 상태 표시
st.markdown("---")
st.subheader("현재 선택")
현재 = {
    "자치구": st.session_state.get("선택_자치구", "-"),
    "행정동": st.session_state.get("선택_행정동", "-"),
    "상권명": st.session_state.get("선택_상권명", "-"),
    "업종": st.session_state.get("선택_업종", "-"),
    "기준 분기": st.session_state.get("선택_분기", "-"),
}
st.table(pd.DataFrame(현재.items(), columns=["항목", "선택값"]))

if 선택_상권_행 is not None and not 선택_상권_행.empty:
    st.markdown("**선택 상권 정보**")
    st.dataframe(선택_상권_행, use_container_width=True, hide_index=True)
