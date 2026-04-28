"""상권·업종 검색 API"""
from fastapi import APIRouter, Query
from functools import lru_cache
import sys, pandas as pd
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from src.data_loader import load_area, load_area_services_index, load_store_data

router = APIRouter()

@lru_cache(maxsize=1)
def _area():
    return load_area()

@lru_cache(maxsize=1)
def _store():
    return load_store_data()


@router.get("/districts")
def get_districts():
    df = _area()
    if df.empty or "자치구_코드_명" not in df.columns:
        return []
    return sorted(df["자치구_코드_명"].dropna().unique().tolist())


@router.get("/dongs")
def get_dongs(district: str = ""):
    df = _area()
    if df.empty or "행정동_코드_명" not in df.columns:
        return []
    if district and "자치구_코드_명" in df.columns:
        df = df[df["자치구_코드_명"] == district]
    return sorted(df["행정동_코드_명"].dropna().unique().tolist())


@router.get("/areas")
def get_areas(district: str = "", dong: str = "", q: str = ""):
    df = _area()
    if df.empty:
        return []
    if district and "자치구_코드_명" in df.columns:
        df = df[df["자치구_코드_명"] == district]
    if dong and "행정동_코드_명" in df.columns:
        df = df[df["행정동_코드_명"] == dong]
    if q:
        mask = df["상권_코드_명"].str.contains(q, na=False)
        df = df[mask]
    cols = ["상권_코드", "상권_코드_명", "상권_구분_코드_명", "자치구_코드_명", "행정동_코드_명"]
    cols = [c for c in cols if c in df.columns]
    return df[cols].drop_duplicates("상권_코드").head(200).to_dict(orient="records")


@router.get("/services")
def get_services(area_code: str = ""):
    idx = load_area_services_index()
    if not idx:
        return []
    if area_code:
        return list(idx.get(str(area_code), []))
    merged = set()
    for names in idx.values():
        merged.update(names)
    return sorted(merged)


@router.get("/search")
def search(q: str = Query("", min_length=1)):
    """상권명·업종명 통합 검색 (자동완성용)"""
    df = _area()
    results = []
    if not df.empty and "상권_코드_명" in df.columns:
        matches = df[df["상권_코드_명"].str.contains(q, na=False)][
            ["상권_코드", "상권_코드_명", "자치구_코드_명"]].head(10)
        for _, r in matches.iterrows():
            results.append({
                "type": "area",
                "code": str(r.get("상권_코드", "")),
                "name": r.get("상권_코드_명", ""),
                "district": r.get("자치구_코드_명", ""),
            })
    sdf = _store()
    if not sdf.empty and "서비스_업종_코드_명" in sdf.columns:
        services = sdf[sdf["서비스_업종_코드_명"].str.contains(q, na=False)][
            "서비스_업종_코드_명"].dropna().unique()[:5]
        for s in services:
            results.append({"type": "service", "name": s})
    return results
