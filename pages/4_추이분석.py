"""화면 4: 매출/점포/인구 추이 차트"""
import streamlit as st
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data_loader import load_store_data, load_sales_data, load_floating_pop

st.set_page_config(page_title="추이 분석", layout="wide")
st.title("📈 매출/점포/인구 추이 분석")

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


def get_time_series(df, 상권_코드, 업종=None, 업종_col="서비스_업종_코드_명"):
    if df.empty:
        return pd.DataFrame()
    mask = df["상권_코드"].astype(str) == str(상권_코드)
    if 업종 and 업종_col in df.columns:
        mask &= df[업종_col] == 업종
    return df[mask].sort_values("기준_년분기_코드")


store_ts = get_time_series(store_df, 상권_코드, 업종)
sales_ts = get_time_series(sales_df, 상권_코드, 업종)
fp_ts = get_time_series(fp_df, 상권_코드)

tab1, tab2, tab3, tab4, tab5 = st.tabs(["매출 추이", "점포 추이", "개폐업 추이", "유동인구 추이", "시간대/요일 패턴"])

with tab1:
    if not sales_ts.empty and "당월_매출_금액" in sales_ts.columns:
        fig = px.line(
            sales_ts, x="기준_년분기_코드", y="당월_매출_금액",
            title="분기별 추정매출 추이",
            markers=True,
        )
        fig.update_layout(xaxis_title="분기", yaxis_title="매출액(원)")
        st.plotly_chart(fig, use_container_width=True)

        if "주중_매출_금액" in sales_ts.columns and "주말_매출_금액" in sales_ts.columns:
            fig2 = go.Figure()
            fig2.add_trace(go.Bar(name="주중", x=sales_ts["기준_년분기_코드"], y=sales_ts["주중_매출_금액"]))
            fig2.add_trace(go.Bar(name="주말", x=sales_ts["기준_년분기_코드"], y=sales_ts["주말_매출_금액"]))
            fig2.update_layout(barmode="group", title="주중/주말 매출 비교")
            st.plotly_chart(fig2, use_container_width=True)
    else:
        st.info("매출 추이 데이터가 없습니다.")

with tab2:
    if not store_ts.empty and "점포_수" in store_ts.columns:
        fig = px.line(store_ts, x="기준_년분기_코드", y="점포_수", title="분기별 점포 수 추이", markers=True)
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("점포 추이 데이터가 없습니다.")

with tab3:
    if not store_ts.empty:
        fig = go.Figure()
        if "개업_점포_수" in store_ts.columns:
            fig.add_trace(go.Bar(name="개업", x=store_ts["기준_년분기_코드"], y=store_ts["개업_점포_수"], marker_color="green"))
        if "폐업_점포_수" in store_ts.columns:
            fig.add_trace(go.Bar(name="폐업", x=store_ts["기준_년분기_코드"], y=store_ts["폐업_점포_수"], marker_color="red"))
        fig.update_layout(title="개업/폐업 점포 수 추이", barmode="group")
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("개폐업 추이 데이터가 없습니다.")

with tab4:
    if not fp_ts.empty and "총_유동인구_수" in fp_ts.columns:
        fig = px.line(fp_ts, x="기준_년분기_코드", y="총_유동인구_수", title="유동인구 추이", markers=True)
        st.plotly_chart(fig, use_container_width=True)

        # 성별 분포
        if "남성_유동인구_수" in fp_ts.columns and "여성_유동인구_수" in fp_ts.columns:
            latest = fp_ts.iloc[-1]
            fig2 = go.Figure(go.Pie(
                labels=["남성", "여성"],
                values=[latest["남성_유동인구_수"], latest["여성_유동인구_수"]],
            ))
            fig2.update_layout(title="최근 분기 성별 유동인구")
            st.plotly_chart(fig2, use_container_width=True)
    else:
        st.info("유동인구 추이 데이터가 없습니다.")

with tab5:
    if not sales_ts.empty:
        latest_sales = sales_ts.iloc[-1] if len(sales_ts) > 0 else None
        if latest_sales is not None:
            # 시간대별 매출
            time_cols = {
                "00~06시": "시간대_00~06_매출_금액",
                "06~11시": "시간대_06~11_매출_금액",
                "11~14시": "시간대_11~14_매출_금액",
                "14~17시": "시간대_14~17_매출_금액",
                "17~21시": "시간대_17~21_매출_금액",
                "21~24시": "시간대_21~24_매출_금액",
            }
            avail_time = {k: latest_sales[v] for k, v in time_cols.items() if v in latest_sales.index and not pd.isna(latest_sales[v])}
            if avail_time:
                fig = go.Figure(go.Bar(x=list(avail_time.keys()), y=list(avail_time.values())))
                fig.update_layout(title="시간대별 매출 패턴 (최근 분기)", xaxis_title="시간대", yaxis_title="매출액(원)")
                st.plotly_chart(fig, use_container_width=True)

            # 요일별 매출
            day_cols = {
                "월": "월요일_매출_금액", "화": "화요일_매출_금액", "수": "수요일_매출_금액",
                "목": "목요일_매출_금액", "금": "금요일_매출_금액", "토": "토요일_매출_금액", "일": "일요일_매출_금액",
            }
            avail_day = {k: latest_sales[v] for k, v in day_cols.items() if v in latest_sales.index and not pd.isna(latest_sales[v])}
            if avail_day:
                fig2 = go.Figure(go.Bar(x=list(avail_day.keys()), y=list(avail_day.values())))
                fig2.update_layout(title="요일별 매출 패턴 (최근 분기)", xaxis_title="요일", yaxis_title="매출액(원)")
                st.plotly_chart(fig2, use_container_width=True)
    else:
        st.info("시간대/요일 패턴 데이터가 없습니다.")

    if not fp_ts.empty:
        latest_fp = fp_ts.iloc[-1] if len(fp_ts) > 0 else None
        if latest_fp is not None:
            fp_time_cols = {
                "00~06시": "시간대_00_06_유동인구_수",
                "06~11시": "시간대_06_11_유동인구_수",
                "11~14시": "시간대_11_14_유동인구_수",
                "14~17시": "시간대_14_17_유동인구_수",
                "17~21시": "시간대_17_21_유동인구_수",
                "21~24시": "시간대_21_24_유동인구_수",
            }
            avail_fp = {k: latest_fp[v] for k, v in fp_time_cols.items() if v in latest_fp.index and not pd.isna(latest_fp[v])}
            if avail_fp:
                fig3 = go.Figure(go.Bar(x=list(avail_fp.keys()), y=list(avail_fp.values()), marker_color="orange"))
                fig3.update_layout(title="시간대별 유동인구 패턴 (최근 분기)")
                st.plotly_chart(fig3, use_container_width=True)
