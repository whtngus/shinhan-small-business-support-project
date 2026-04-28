"""소상공인 경영위험 조기경보 서비스 - 메인 앱"""
import streamlit as st

st.set_page_config(
    page_title="소상공인 경영위험 조기경보",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.sidebar.title("📊 소상공인 경영위험 조기경보")
st.sidebar.markdown("---")
st.sidebar.markdown("""
**서비스 소개**

서울시 상권 공공데이터를 기반으로
개별 점포의 경영위험을 진단하고
AI 처방 리포트를 제공합니다.

---
**차별점**
- 상권 분석 → **내 점포 위험도**
- 부채체력 진단 (부채/현금흐름)
- 위기 조기경보 감지
- AI 경영 처방 리포트
- 신한카드·은행 데이터 확장 가능
""")

st.title("소상공인 경영위험 조기경보 서비스")
st.markdown("""
> 서울시 상권분석서비스가 **"상권의 상태"**를 보여준다면,
> 본 서비스는 **"그 상권 안에서 내 점포가 얼마나 버틸 수 있는지"**를 계산합니다.
""")

col1, col2, col3, col4 = st.columns(4)
col1.metric("분석 가능 상권", "1,650개", "서울 전역")
col2.metric("업종 수", "약 150종", "서비스 업종")
col3.metric("데이터 기간", "2019~2024", "6년간 분기별")
col4.metric("데이터 출처", "7개 기관", "공공데이터")

st.markdown("---")
st.subheader("화면 안내")

pages = [
    ("📁", "데이터 현황", "pages/1_데이터현황.py", "로딩된 데이터 파일 목록, 행수, 기준연도 범위"),
    ("🔍", "상권/업종 선택", "pages/2_상권업종선택.py", "자치구→행정동→상권→업종 필터"),
    ("📊", "상권 경쟁력", "pages/3_상권경쟁력.py", "매출, 점포수, 유동인구, 상권변화지표 KPI"),
    ("📈", "추이 분석", "pages/4_추이분석.py", "분기별 추이, 시간대/요일 패턴 차트"),
    ("🗺️", "경쟁점 지도", "pages/5_경쟁점지도.py", "동일 업종 점포 지도, 반경별 점포수"),
    ("⚠️", "경영위험 점수", "pages/6_경영위험점수.py", "위험점수 0~100, 위험등급, 위험요인 Top5"),
    ("💰", "부채체력 시뮬레이션", "pages/7_부채체력.py", "이자부담률, 현금보유개월, 생존기간"),
    ("🤖", "AI 리포트", "pages/8_AI리포트.py", "현황요약, 위험요인, 실행전략 AI 처방"),
]

cols = st.columns(2)
for i, (icon, name, path, desc) in enumerate(pages):
    with cols[i % 2]:
        st.info(f"**{icon} {name}**\n\n{desc}")

st.markdown("---")
st.caption("데이터 출처: 서울시 상권분석서비스, 소상공인시장진흥공단, KOSIS 기업생멸통계, 국토교통부 실거래가, 한국부동산원 임대동향")
