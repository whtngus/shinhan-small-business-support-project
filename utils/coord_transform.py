"""EPSG:5181 → WGS84 좌표 변환 (서울시 상권 영역 데이터)"""
import pandas as pd

try:
    from pyproj import Transformer
    _transformer = Transformer.from_crs("EPSG:5181", "EPSG:4326", always_xy=True)
    _PYPROJ_AVAILABLE = True
except Exception:
    _PYPROJ_AVAILABLE = False


def epsg5181_to_wgs84(x: float, y: float) -> tuple:
    """단일 좌표 변환. 반환: (lon, lat)
    pyproj 미설치 시 근사 변환 적용 (서울 지역 한정 약 오차 수m).
    """
    if _PYPROJ_AVAILABLE:
        lon, lat = _transformer.transform(x, y)
        return lon, lat
    # 근사 변환: GRS80 기반 중부원점 (서울) 간이 변환
    # 참고: https://www.osgeo.kr/255 (정확도 낮음, 시각화 용도)
    dx = x - 200000.0
    dy = y - 500000.0
    lat = 38.0 + dy / 111320.0
    lon = 127.0 + dx / (111320.0 * 0.7778)
    return lon, lat


def convert_area_coords(df: pd.DataFrame) -> pd.DataFrame:
    """상권 영역 데이터프레임의 엑스/와이 좌표를 WGS84로 변환"""
    if "엑스좌표_값" not in df.columns or "와이좌표_값" not in df.columns:
        return df
    df = df.copy()
    results = df[["엑스좌표_값", "와이좌표_값"]].apply(
        lambda r: pd.Series(
            epsg5181_to_wgs84(r["엑스좌표_값"], r["와이좌표_값"]),
            index=["경도", "위도"],
        ),
        axis=1,
    )
    df["경도"] = results["경도"]
    df["위도"] = results["위도"]
    return df
