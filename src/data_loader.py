"""
데이터 로더 모듈
- 인코딩 자동 감지 (utf-8-sig → cp949 → euc-kr)
- 연도별 파일 glob 병합
- 컬럼명 표준화
- DuckDB 기반 대용량 CSV 쿼리
"""
from pathlib import Path
from functools import lru_cache
from typing import Dict, List, Optional
import pandas as pd
import numpy as np
import duckdb
import warnings
warnings.filterwarnings("ignore")

from src.config import DATA_PATHS

ENCODINGS = ["utf-8-sig", "cp949", "euc-kr", "utf-8"]


def read_csv_auto(path: Path, **kwargs) -> Optional[pd.DataFrame]:
    """인코딩 자동 감지 CSV 로더"""
    for enc in ENCODINGS:
        try:
            df = pd.read_csv(path, encoding=enc, low_memory=False, **kwargs)
            return df
        except (UnicodeDecodeError, Exception):
            continue
    print(f"[data_loader] CSV 읽기 실패: {path.name}")
    return None


def standardize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """컬럼명 표준화 - 연도별 파일 간 차이 처리"""
    rename_map = {
        "기준_년분기_코드": "기준_년분기_코드",
        "기준년분기코드": "기준_년분기_코드",
        "개업_율": "개업_율",
        "개업률": "개업_율",
        "폐업_률": "폐업_률",
        "폐업률": "폐업_률",
    }
    df.columns = [rename_map.get(c, c) for c in df.columns]
    return df


@lru_cache(maxsize=1)
def load_store_data() -> pd.DataFrame:
    """점포 데이터 (2019~2024년 연도별 파일 병합)"""
    store_dir = DATA_PATHS["store"]
    files = sorted(store_dir.glob("*.csv"))
    dfs = []
    for f in files:
        df = read_csv_auto(f)
        if df is not None:
            df = standardize_columns(df)
            dfs.append(df)
    if not dfs:
        return pd.DataFrame()
    result = pd.concat(dfs, ignore_index=True)
    result["기준_년분기_코드"] = result["기준_년분기_코드"].astype(str)
    return result


_PAIR_COLS = ("상권_코드", "서비스_업종_코드_명")


def _read_store_pair_columns(path: Path) -> Optional[pd.DataFrame]:
    """점포 CSV에서 상권·업종 열만 읽기 (업종 목록 API용, 전체 로드보다 훨씬 빠름)."""
    for enc in ENCODINGS:
        try:
            return pd.read_csv(path, encoding=enc, low_memory=False, usecols=list(_PAIR_COLS))
        except (ValueError, UnicodeDecodeError, KeyError):
            pass
        try:
            df = pd.read_csv(path, encoding=enc, low_memory=False)
        except Exception:
            continue
        if all(c in df.columns for c in _PAIR_COLS):
            return df[list(_PAIR_COLS)]
    return None


@lru_cache(maxsize=1)
def load_area_services_index() -> Dict[str, List[str]]:
    """상권 코드(str) → 해당 상권에 등장하는 서비스 업종명 정렬 목록.

    ``load_store_data()`` 전체 병합 없이 필요한 두 열만 읽어 구축한다.
    """
    store_dir = DATA_PATHS["store"]
    files = sorted(store_dir.glob("*.csv"))
    chunks = []
    for f in files:
        sub = _read_store_pair_columns(f)
        if sub is not None and not sub.empty:
            chunks.append(sub)
    if not chunks:
        return {}
    df = pd.concat(chunks, ignore_index=True)
    df = df.dropna(subset=["서비스_업종_코드_명"])
    df["상권_코드"] = df["상권_코드"].astype(str)
    df = df.drop_duplicates()
    g = df.groupby("상권_코드")["서비스_업종_코드_명"].agg(lambda s: sorted(s.unique().tolist()))
    return dict(g)


@lru_cache(maxsize=1)
def load_sales_data() -> pd.DataFrame:
    """추정매출 데이터 (2019~2024년 연도별 파일 병합)"""
    sales_dir = DATA_PATHS["sales"]
    files = sorted(sales_dir.glob("*.csv"))
    dfs = []
    for f in files:
        df = read_csv_auto(f)
        if df is not None:
            df = standardize_columns(df)
            # 핵심 컬럼만 유지 (메모리 절약)
            keep_cols = [
                "기준_년분기_코드", "상권_구분_코드", "상권_구분_코드_명",
                "상권_코드", "상권_코드_명", "서비스_업종_코드", "서비스_업종_코드_명",
                "당월_매출_금액", "당월_매출_건수",
                "주중_매출_금액", "주말_매출_금액",
                "시간대_00~06_매출_금액", "시간대_06~11_매출_금액",
                "시간대_11~14_매출_금액", "시간대_14~17_매출_금액",
                "시간대_17~21_매출_금액", "시간대_21~24_매출_금액",
                "월요일_매출_금액", "화요일_매출_금액", "수요일_매출_금액",
                "목요일_매출_금액", "금요일_매출_금액", "토요일_매출_금액", "일요일_매출_금액",
            ]
            available = [c for c in keep_cols if c in df.columns]
            dfs.append(df[available])
    if not dfs:
        return pd.DataFrame()
    result = pd.concat(dfs, ignore_index=True)
    result["기준_년분기_코드"] = result["기준_년분기_코드"].astype(str)
    return result


@lru_cache(maxsize=1)
def load_floating_pop() -> pd.DataFrame:
    """유동인구 데이터"""
    d = DATA_PATHS["floating_pop"]
    files = list(d.glob("*.csv"))
    if not files:
        return pd.DataFrame()
    df = read_csv_auto(files[0]); return df if df is not None else pd.DataFrame()


@lru_cache(maxsize=1)
def load_resident_pop() -> pd.DataFrame:
    """상주인구 데이터"""
    d = DATA_PATHS["resident_pop"]
    files = list(d.glob("*.csv"))
    if not files:
        return pd.DataFrame()
    df = read_csv_auto(files[0]); return df if df is not None else pd.DataFrame()


@lru_cache(maxsize=1)
def load_worker_pop() -> pd.DataFrame:
    """직장인구 데이터"""
    d = DATA_PATHS["worker_pop"]
    files = list(d.glob("*.csv"))
    if not files:
        return pd.DataFrame()
    df = read_csv_auto(files[0]); return df if df is not None else pd.DataFrame()


@lru_cache(maxsize=1)
def load_commercial_change() -> pd.DataFrame:
    """상권변화지표 데이터 (인코딩 수정 시도)"""
    d = DATA_PATHS["commercial_change"]
    files = list(d.glob("*.csv"))
    if not files:
        return pd.DataFrame()
    df = read_csv_auto(files[0])
    if df is None:
        return pd.DataFrame()
    # 컬럼명이 깨진 경우 표준 컬럼명으로 강제 지정
    expected_cols = [
        "기준_년분기_코드", "상권_구분_코드", "상권_구분_코드_명",
        "상권_코드", "상권_코드_명", "상권_변화_지표", "상권_변화_지표_명",
        "운영_영업_개월_평균", "폐업_영업_개월_평균",
        "전체_상권_영업_개월_평균", "전체_상권_폐업_영업_개월_평균",
    ]
    if len(df.columns) == len(expected_cols):
        # 첫 행이 헤더인지 확인
        if df.iloc[0, 0] != "기준_년분기_코드":
            df.columns = expected_cols
        else:
            df.columns = expected_cols
            df = df.iloc[1:].reset_index(drop=True)
    return df


@lru_cache(maxsize=1)
def load_area() -> pd.DataFrame:
    """상권 영역 데이터 (EPSG:5181 좌표 포함)"""
    d = DATA_PATHS["area"]
    files = list(d.glob("*.csv"))
    if not files:
        return pd.DataFrame()
    df = read_csv_auto(files[0]); return df if df is not None else pd.DataFrame()


@lru_cache(maxsize=1)
def load_facilities() -> pd.DataFrame:
    """집객시설 데이터"""
    d = DATA_PATHS["facilities"]
    files = list(d.glob("*.csv"))
    if not files:
        return pd.DataFrame()
    df = read_csv_auto(files[0]); return df if df is not None else pd.DataFrame()


@lru_cache(maxsize=1)
def load_income_consume() -> pd.DataFrame:
    """소득소비 데이터"""
    d = DATA_PATHS["income_consume"]
    files = list(d.glob("*.csv"))
    if not files:
        return pd.DataFrame()
    df = read_csv_auto(files[0]); return df if df is not None else pd.DataFrame()


@lru_cache(maxsize=1)
def load_kosis_survival() -> pd.DataFrame:
    """KOSIS 업종별 신생기업 생존율"""
    d = DATA_PATHS["kosis_survival"]
    files = sorted(d.glob("*.csv"))
    dfs = []
    for f in files:
        df = read_csv_auto(f)
        if df is not None:
            df["파일명"] = f.stem
            dfs.append(df)
    if not dfs:
        return pd.DataFrame()
    return pd.concat(dfs, ignore_index=True)


@lru_cache(maxsize=1)
def load_rental_trend() -> pd.DataFrame:
    """한국부동산원 임대가격지수 CSV (오피스)"""
    d = DATA_PATHS["rental_trend"]
    csv_files = list(d.glob("*.csv"))
    if csv_files:
        df = read_csv_auto(csv_files[0])
        if df is not None:
            return df
    # xlsx 폴백: 임대가격지수 시트만 추출
    xlsx_files = list(d.glob("*.xlsx"))
    if xlsx_files:
        try:
            df = pd.read_excel(xlsx_files[0], sheet_name="11", header=None, engine="openpyxl")
            return df
        except Exception:
            pass
    return pd.DataFrame()


def load_rental_trend_xlsx_all_sheets() -> dict:
    """한국부동산원 xlsx 전체 시트 로드"""
    d = DATA_PATHS["rental_trend"]
    xlsx_files = list(d.glob("*.xlsx"))
    if not xlsx_files:
        return {}
    try:
        return pd.read_excel(xlsx_files[0], sheet_name=None, engine="openpyxl")
    except Exception as e:
        return {}


@lru_cache(maxsize=1)
def load_sosnogongdan_seoul() -> pd.DataFrame:
    """소상공인 상가정보 - 서울 파일만 로드 (위경도 포함)"""
    d = DATA_PATHS["sosnogongdan"]
    seoul_files = list(d.glob("*서울*"))
    if not seoul_files:
        return pd.DataFrame()
    df = read_csv_auto(seoul_files[0])
    if df is None:
        return pd.DataFrame()
    # 필요 컬럼만 유지
    keep = [
        "상가업소번호", "상호명", "상권업종대분류명", "상권업종중분류명", "상권업종소분류명",
        "시군구명", "행정동명", "도로명주소", "경도", "위도",
    ]
    available = [c for c in keep if c in df.columns]
    return df[available].dropna(subset=["경도", "위도"])


def query_sales_by_area_industry(
    상권_코드: str,
    서비스_업종_코드: str,
    conn: Optional[duckdb.DuckDBPyConnection] = None,
) -> pd.DataFrame:
    """DuckDB로 특정 상권+업종 매출 데이터 쿼리 (대용량 파일용)"""
    sales_dir = DATA_PATHS["sales"]
    pattern = str(sales_dir / "*.csv")
    if conn is None:
        conn = duckdb.connect()
    query = f"""
    SELECT *
    FROM read_csv_auto('{pattern}', ignore_errors=true)
    WHERE 상권_코드 = '{상권_코드}'
      AND 서비스_업종_코드 = '{서비스_업종_코드}'
    ORDER BY 기준_년분기_코드
    """
    try:
        return conn.execute(query).df()
    except Exception:
        return pd.DataFrame()


@lru_cache(maxsize=1)
def get_data_summary() -> dict:
    """데이터 현황 요약 (화면1용)"""
    summary = {}
    for key, path in DATA_PATHS.items():
        if not path.exists():
            summary[key] = {"exists": False}
            continue
        files = list(path.glob("*.csv")) + list(path.glob("*.xlsx"))
        summary[key] = {
            "exists": True,
            "file_count": len(files),
            "files": [f.name for f in files],
        }
    return summary


def get_area_list(area_df: pd.DataFrame) -> pd.DataFrame:
    """상권 목록 반환 (자치구/행정동/상권구분/상권명 포함)"""
    cols = ["상권_구분_코드", "상권_구분_코드_명", "상권_코드", "상권_코드_명",
            "자치구_코드_명", "행정동_코드_명"]
    available = [c for c in cols if c in area_df.columns]
    return area_df[available].drop_duplicates()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="데이터 로드 확인")
    args = parser.parse_args()

    if args.check:
        print("=== 데이터 로드 확인 ===")
        summary = get_data_summary()
        for key, info in summary.items():
            status = "OK" if info.get("exists") else "MISSING"
            count = info.get("file_count", 0)
            print(f"[{status}] {key}: {count}개 파일")

        print("\n상권 영역 데이터 샘플:")
        area = load_area()
        print(area.head(3).to_string())

        print("\n상권변화지표 샘플:")
        cc = load_commercial_change()
        print(cc.head(3).to_string())
