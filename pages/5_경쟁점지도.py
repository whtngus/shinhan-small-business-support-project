"""화면 5: 경쟁점 지도"""
import streamlit as st
import pandas as pd
import folium
from streamlit_folium import st_folium
import numpy as np
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data_loader import load_sosnogongdan_seoul, load_area
from utils.coord_transform import convert_area_coords

st.set_page_config(page_title="경쟁점 지도", layout="wide")
st.title("🗺️ 경쟁점 지도")

상권_코드 = st.session_state.get("선택_상권_코드")
상권명 = st.session_state.get("선택_상권명", "-")
업종 = st.session_state.get("선택_업종")

if not 상권_코드:
    st.warning("먼저 '상권/업종 선택' 화면에서 상권과 업종을 선택하세요.")
    st.stop()

st.subheader(f"{상권명} / {업종}")

with st.spinner("데이터 로딩 중..."):
    sosno_df = load_sosnogongdan_seoul()
    area_df = load_area()

# 상권 중심 좌표 구하기 (EPSG:5181 → WGS84)
center_lat, center_lon = 37.5665, 126.9780  # 기본: 서울 시청

if not area_df.empty and 상권_코드:
    area_row = area_df[area_df["상권_코드"].astype(str) == str(상권_코드)]
    if not area_row.empty and "엑스좌표_값" in area_row.columns:
        try:
            area_with_coords = convert_area_coords(area_row)
            if "위도" in area_with_coords.columns and "경도" in area_with_coords.columns:
                center_lat = float(area_with_coords["위도"].iloc[0])
                center_lon = float(area_with_coords["경도"].iloc[0])
        except Exception:
            pass

# 반경 필터
col1, col2 = st.columns([1, 3])
with col1:
    반경 = st.radio("표시 반경", [300, 500, 1000], format_func=lambda x: f"{x}m")
    업종_필터 = st.checkbox("동일 업종만 표시", value=True)

# 업종 카테고리 매핑 (소상공인 업종 ↔ 서울시 업종)
업종_키워드 = {
    "한식음식점": "한식",
    "커피-음료": "카페",
    "제과점": "제과",
    "편의점": "편의점",
    "분식전문점": "분식",
    "호프-간이주점": "주점",
}
검색_키워드 = 업종_키워드.get(업종, 업종.split("음식점")[0] if 업종 else "")


def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlambda = np.radians(lon2 - lon1)
    a = np.sin(dphi/2)**2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlambda/2)**2
    return 2 * R * np.arcsin(np.sqrt(a))


if not sosno_df.empty:
    sosno_df["거리_m"] = sosno_df.apply(
        lambda r: haversine_distance(center_lat, center_lon, r["위도"], r["경도"]),
        axis=1,
    )
    in_radius = sosno_df[sosno_df["거리_m"] <= 반경]

    if 업종_필터 and 검색_키워드:
        filtered = in_radius[
            in_radius["상권업종소분류명"].str.contains(검색_키워드, na=False) |
            in_radius["상권업종중분류명"].str.contains(검색_키워드, na=False)
        ]
    else:
        filtered = in_radius

    # 반경별 점포 수
    cnt_300 = len(sosno_df[sosno_df["거리_m"] <= 300])
    cnt_500 = len(sosno_df[sosno_df["거리_m"] <= 500])
    cnt_1000 = len(sosno_df[sosno_df["거리_m"] <= 1000])

    with col1:
        st.metric("반경 300m 점포", f"{cnt_300}개")
        st.metric("반경 500m 점포", f"{cnt_500}개")
        st.metric("반경 1km 점포", f"{cnt_1000}개")
        st.metric("현재 필터 점포", f"{len(filtered)}개")

    with col2:
        m = folium.Map(location=[center_lat, center_lon], zoom_start=16)

        # 상권 중심 마커
        folium.Marker(
            [center_lat, center_lon],
            tooltip=상권명,
            icon=folium.Icon(color="red", icon="star"),
        ).add_to(m)

        # 반경 원
        folium.Circle([center_lat, center_lon], radius=반경, color="blue", fill=False, weight=2).add_to(m)

        # 경쟁점 마커 (최대 200개)
        display = filtered.head(200)
        for _, row in display.iterrows():
            tooltip_text = f"{row.get('상호명', '')} ({row.get('상권업종소분류명', '')})"
            folium.CircleMarker(
                [row["위도"], row["경도"]],
                radius=5,
                color="orange",
                fill=True,
                fill_opacity=0.7,
                tooltip=tooltip_text,
            ).add_to(m)

        st_folium(m, width=700, height=500)

    # 업종별 밀집도
    if not in_radius.empty and "상권업종소분류명" in in_radius.columns:
        st.markdown("**업종별 밀집도 (반경 내)**")
        density = in_radius["상권업종소분류명"].value_counts().head(15).reset_index()
        density.columns = ["업종", "점포수"]
        st.dataframe(density, use_container_width=True, hide_index=True)
else:
    st.warning("소상공인 상가 데이터를 로드할 수 없습니다.")
    st.info("data/소상공인시장진흥공단_상가(상권)정보/ 폴더에 서울 파일이 있는지 확인하세요.")
