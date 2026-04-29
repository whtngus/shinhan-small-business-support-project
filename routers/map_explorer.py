"""지도 기반 상권 탐색 API — 로컬 소상공인 상가 CSV만 사용 (외부 실시간 API 없음)."""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from fastapi import APIRouter, Query

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data_loader import (
    load_area,
    load_floating_pop,
    load_sales_data,
    load_sosnogongdan_seoul,
    load_store_data,
)
from utils.coord_transform import convert_area_coords

# 프런트 MAP_EXPLORER_SERVICE_NAME 과 동일 매핑 (진단 단계 서비스 업종명)
MAP_SERVICE_BY_INDUSTRY: Dict[str, str] = {
    "all": "커피-음료",
    "food": "한식음식점",
    "cafe": "커피-음료",
    "beauty": "미용실",
    "academy": "외국어학원",
    "sports": "스포츠클럽",
    "retail": "편의점",
    "other": "일반의류",
}

router = APIRouter()

_C: dict = {}

# 탐색 패널 업종 프리셋 → CSV 텍스트 부분일치 (대/중/소 결합)
INDUSTRY_PRESETS: Dict[str, Callable[[str], bool]] = {}


def _norm_text(row: pd.Series) -> str:
    parts = []
    for k in ("상권업종대분류명", "상권업종중분류명", "상권업종소분류명"):
        if k in row.index and pd.notna(row[k]):
            parts.append(str(row[k]))
    return " ".join(parts)


def _build_presets():
    global INDUSTRY_PRESETS

    def mk_contains_any(tokens: Tuple[str, ...]):
        def fn(txt: str) -> bool:
            t = txt.lower()
            return any(tok.lower() in t for tok in tokens)

        return fn

    def mk_other(base_exclude: List[Callable[[str], bool]]):

        def fn(txt: str) -> bool:
            if not txt.strip():
                return False
            return not any(pred(txt) for pred in base_exclude)

        return fn

    food = mk_contains_any(
        ("한식", "중식", "일식", "분식", "치킨", "패스트", "호프", "주점", "음식", "요리", "횟집", "뷔페"),
    )
    cafe = mk_contains_any(("카페", "커피", "제과", "베이커리", "빵", "디저트"))
    beauty = mk_contains_any(("미용", "헤어", "네일", "피부", "메이크업"))
    academy = mk_contains_any(("학원", "교습", "교육", "입시", "외국어", "유치원", "보습"))
    sports = mk_contains_any(("헬스", "스포츠", "당구", "볼링", "노래방", "노래", "pc", "피시", "오락", "골프"))
    retail = mk_contains_any(("편의점", "슈퍼", "마트", "의류", "화장품", "안경", "서점", "문구"))

    exclude_for_other = [food, cafe, beauty, academy, sports, retail]

    INDUSTRY_PRESETS = {
        "": lambda _: True,
        "all": lambda _: True,
        "food": food,
        "cafe": cafe,
        "beauty": beauty,
        "academy": academy,
        "sports": sports,
        "retail": retail,
        "other": mk_other(exclude_for_other),
    }


_build_presets()


def _get(key: str, loader):
    if key not in _C:
        _C[key] = loader()
    return _C[key]


def _haversine_m(lat1: float, lon1: float, lat2: np.ndarray, lon2: np.ndarray) -> np.ndarray:
    R = 6371000.0
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = (
        np.sin(dlat / 2) ** 2
        + np.cos(np.radians(lat1)) * np.cos(np.radians(lat2)) * np.sin(dlon / 2) ** 2
    )
    return 2 * R * np.arcsin(np.minimum(1.0, np.sqrt(a)))


def _density_level(same_or_similar: int, radius_m: int) -> Tuple[str, str]:
    """경쟁 강도 레벨과 한 줄 코멘트."""
    r_km = max(radius_m / 1000.0, 0.05)
    area_km2 = math.pi * r_km * r_km
    dens = same_or_similar / area_km2 if area_km2 > 0 else 0.0
    if same_or_similar <= 3 or dens < 8:
        return "낮음", "반경 안 유사 업종 점포가 적어 신규 유입 여지가 있는 편입니다."
    if same_or_similar <= 12 or dens < 35:
        return "보통", "경쟁 밀도가 보통 수준입니다. 차별화 메뉴·가격대 점검이 유효합니다."
    return "높음", "반경 안 유사 업종 점포가 많아 경쟁 강도가 높은 편입니다. 재방문·시간대별 프로모션 전략을 검토하세요."


def _top_industries(df_in_radius: pd.DataFrame, top_n: int = 3) -> List[Dict[str, Any]]:
    if df_in_radius.empty:
        return []
    col = "상권업종중분류명" if "상권업종중분류명" in df_in_radius.columns else None
    if not col:
        col = "상권업종소분류명" if "상권업종소분류명" in df_in_radius.columns else None
    if not col:
        return []
    vc = df_in_radius[col].fillna("미분류").astype(str).value_counts().head(top_n)
    return [{"name": str(k), "count": int(v)} for k, v in vc.items()]


def _preset_fn(industry_key: str):
    k = (industry_key or "").strip().lower()
    if k in INDUSTRY_PRESETS:
        return INDUSTRY_PRESETS[k]
    return INDUSTRY_PRESETS["all"]


def _nearest_areas(lat: float, lon: float, top_k: int = 5) -> List[Dict[str, Any]]:
    df = _get("area", load_area)
    if df.empty or "엑스좌표_값" not in df.columns:
        return []
    try:
        df = convert_area_coords(df)
    except Exception:
        return []
    if "위도" not in df.columns or "경도" not in df.columns:
        return []
    sub = df.dropna(subset=["위도", "경도"]).copy()
    if sub.empty:
        return []
    lat_arr = pd.to_numeric(sub["위도"], errors="coerce").values
    lon_arr = pd.to_numeric(sub["경도"], errors="coerce").values
    dist_arr = _haversine_m(lat, lon, lat_arr, lon_arr)
    sub = sub.assign(_dist=dist_arr).sort_values("_dist").head(top_k)
    out = []
    for _, r in sub.iterrows():
        out.append(
            {
                "area_code": str(r.get("상권_코드", "")),
                "area_name": str(r.get("상권_코드_명", "")),
                "area_type": str(r.get("상권_구분_코드_명", "")),
                "district": str(r.get("자치구_코드_명", "")),
                "dong": str(r.get("행정동_코드_명", "")),
                "lat": float(r["위도"]) if pd.notna(r.get("위도")) else None,
                "lon": float(r["경도"]) if pd.notna(r.get("경도")) else None,
                "dist_m": round(float(r["_dist"]), 1),
            }
        )
    return out


def _latest_quarter_rows(store_df: pd.DataFrame, area_code: str) -> pd.DataFrame:
    if store_df.empty or "상권_코드" not in store_df.columns:
        return pd.DataFrame()
    m = store_df["상권_코드"].astype(str) == str(area_code)
    sub = store_df.loc[m].copy()
    if sub.empty:
        return pd.DataFrame()
    sub["기준_년분기_코드"] = sub["기준_년분기_코드"].astype(str)
    qmax = sub["기준_년분기_코드"].max()
    return sub[sub["기준_년분기_코드"] == qmax]


def _build_store_area_snapshot() -> Dict[str, Dict[str, Any]]:
    """상권별 최신 분기 집계 캐시: 점포수·서비스별 점포수·Top 업종."""
    store_df = _get("store", load_store_data)
    if store_df.empty or "상권_코드" not in store_df.columns or "점포_수" not in store_df.columns:
        return {}

    df = store_df.copy()
    df["상권_코드"] = df["상권_코드"].astype(str)
    if "기준_년분기_코드" in df.columns:
        df["기준_년분기_코드"] = df["기준_년분기_코드"].astype(str)
        qmax_by_area = df.groupby("상권_코드")["기준_년분기_코드"].transform("max")
        df = df[df["기준_년분기_코드"] == qmax_by_area]
    df["점포_수"] = pd.to_numeric(df["점포_수"], errors="coerce").fillna(0)

    svc_col = "서비스_업종_코드_명" if "서비스_업종_코드_명" in df.columns else None
    snapshot: Dict[str, Dict[str, Any]] = {}
    for ac, g in df.groupby("상권_코드"):
        total = int(g["점포_수"].sum())
        by_service: Dict[str, int] = {}
        top_services: List[Dict[str, Any]] = []
        if svc_col:
            svc_sum = g.groupby(svc_col)["점포_수"].sum().sort_values(ascending=False)
            by_service = {str(k): int(v) for k, v in svc_sum.items()}
            top_services = [{"name": str(k), "count": int(v)} for k, v in svc_sum.head(5).items()]
        snapshot[str(ac)] = {
            "total_stores": total,
            "by_service": by_service,
            "top_services": top_services,
        }
    return snapshot


def _area_service_totals(latest: pd.DataFrame, service_name: str) -> Tuple[int, int, List[Dict[str, Any]]]:
    """(전체 점포 합, 선택 서비스 점포 합, 업종 Top 이름 리스트)."""
    if latest.empty or "점포_수" not in latest.columns:
        return 0, 0, []
    latest = latest.copy()
    latest["점포_수"] = pd.to_numeric(latest["점포_수"], errors="coerce").fillna(0)
    total = int(latest["점포_수"].sum())
    same = total
    if service_name and "서비스_업종_코드_명" in latest.columns:
        sv = latest[latest["서비스_업종_코드_명"] == service_name]
        same = int(sv["점포_수"].sum()) if not sv.empty else 0
    tops: List[Dict[str, Any]] = []
    if "서비스_업종_코드_명" in latest.columns:
        g = latest.groupby("서비스_업종_코드_명")["점포_수"].sum().sort_values(ascending=False).head(5)
        tops = [{"name": str(k), "count": int(v)} for k, v in g.items()]
    return total, same, tops


def _floating_pop_hint(fp_df: pd.DataFrame, area_code: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"level": None, "note": "상세 컨설팅에서 확인 가능"}
    if fp_df.empty or "상권_코드" not in fp_df.columns:
        return out
    sub = fp_df[fp_df["상권_코드"].astype(str) == str(area_code)]
    if sub.empty:
        return out
    col = "총_유동인구_수" if "총_유동인구_수" in sub.columns else None
    if not col:
        return out
    sub2 = sub.copy()
    if "기준_년분기_코드" in sub2.columns:
        sub2["기준_년분기_코드"] = sub2["기준_년분기_코드"].astype(str)
        sub2 = sub2.sort_values("기준_년분기_코드")
    row = sub2.iloc[-1]
    val = pd.to_numeric(row[col], errors="coerce")
    if pd.isna(val):
        return out
    all_v = pd.to_numeric(fp_df[col], errors="coerce").dropna()
    med = float(all_v.median()) if len(all_v) else float(val)
    if med <= 0:
        med = float(val)
    ratio = float(val) / med if med > 0 else 1.0
    if ratio < 0.75:
        lvl = "낮음"
    elif ratio > 1.25:
        lvl = "높음"
    else:
        lvl = "보통"
    out["level"] = lvl
    out["note"] = None
    return out


def _sales_hint_row(sales_df: pd.DataFrame, area_code: str, service_name: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"monthly_manwon": None, "note": "상세 컨설팅에서 추정"}
    if sales_df.empty or not service_name:
        return out
    mask = (sales_df["상권_코드"].astype(str) == str(area_code)) & (
        sales_df["서비스_업종_코드_명"] == service_name
    )
    sub = sales_df.loc[mask]
    if sub.empty or "당월_매출_금액" not in sub.columns:
        return out
    sub = sub.copy()
    sub["당월_매출_금액"] = pd.to_numeric(sub["당월_매출_금액"], errors="coerce")
    sub = sub.dropna(subset=["당월_매출_금액"])
    if sub.empty:
        return out
    if "기준_년분기_코드" in sub.columns:
        sub["기준_년분기_코드"] = sub["기준_년분기_코드"].astype(str)
        sub = sub.sort_values("기준_년분기_코드")
    mean_q = float(sub["당월_매출_금액"].mean())
    monthly_won = mean_q / 3.0 if mean_q > 0 else None
    if monthly_won is None:
        return out
    # 원화 -> 만원 단위 변환
    out["monthly_manwon"] = round(monthly_won / 10_000.0, 1)
    out["note"] = "로컬 분기 매출 데이터 기반 참고 추정입니다."
    return out


def _badges_for_candidate(
    competition: str,
    dist_m: float,
    fp_level: Optional[str],
    total_area: int,
    same_svc: int,
) -> List[str]:
    badges: List[str] = []
    if competition == "높음":
        badges.append("경쟁 강도 높음")
    elif competition == "낮음":
        badges.append("창업 검토 가능")
    else:
        badges.append("점검 가능")
    if dist_m > 800:
        badges.append("저비용 진입 후보")
    if fp_level == "낮음":
        badges.append("유동인구 확인 필요")
    if total_area > 0 and same_svc > 25:
        badges.append("상세 분석 필요")
    return badges[:5]


def _radius_breakdown(sosno_full: pd.DataFrame, industry: str) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    preset = _preset_fn(industry if industry else "all")
    need_filter = bool(industry and industry.lower() not in ("", "all"))
    work = sosno_full
    if need_filter and "__norm_txt" not in work.columns:
        work = work.copy()
        work["__norm_txt"] = work.apply(lambda row: _norm_text(row), axis=1)
    for rad in (300, 500, 1000):
        sub = work[work["_dist_m"] <= float(rad)]
        tot = int(len(sub))
        if need_filter:
            mask = sub["__norm_txt"].map(lambda t: preset(t))
            same = int(mask.sum())
            dens_input = same
        else:
            same = tot
            dens_input = tot
        dens_label, _ = _density_level(dens_input, rad)
        out[str(rad)] = {
            "total_stores": tot,
            "same_or_similar_stores": same,
            "density_level": dens_label,
        }
    return out


def _competition_label_area(same_svc: int, total_area: int) -> str:
    if same_svc <= 5:
        return "낮음"
    if same_svc <= 18:
        return "보통"
    return "높음"


def _build_area_candidates(
    lat: float,
    lon: float,
    radius_m: int,
    industry_key: str,
) -> List[Dict[str, Any]]:
    cands = _nearest_areas(lat, lon, top_k=5)
    if not cands:
        return []
    area_snapshot = _get("store_area_snapshot", _build_store_area_snapshot)
    fp_df = _get("fp", load_floating_pop)
    ik = (industry_key or "all").strip().lower()
    svc = MAP_SERVICE_BY_INDUSTRY.get(ik, MAP_SERVICE_BY_INDUSTRY["all"])

    enriched: List[Dict[str, Any]] = []
    for c in cands:
        ac = c.get("area_code") or ""
        snap = area_snapshot.get(str(ac), {})
        total_area = int(snap.get("total_stores", 0))
        by_service = snap.get("by_service", {})
        same_svc = int(by_service.get(svc, 0)) if ik != "all" else total_area
        top_svc = snap.get("top_services", [])
        comp_same = same_svc if ik != "all" else min(total_area, max(3, total_area // 10))
        comp = _competition_label_area(comp_same, total_area)
        fp_row = _floating_pop_hint(fp_df, ac)
        badges = _badges_for_candidate(comp, float(c.get("dist_m") or 0), fp_row.get("level"), total_area, same_svc)

        top_names = [x["name"] for x in top_svc[:3]]
        enriched.append(
            {
                **c,
                "radius_query_m": radius_m,
                "total_stores_in_area": total_area,
                "same_service_stores_in_area": same_svc if ik != "all" else total_area,
                "top_services_in_area": top_svc,
                "major_industries_display": top_names,
                "expected_competition": comp,
                "floating_pop": fp_row,
                "badges": badges,
                "score_note": "참고 요약",
            }
        )
    return enriched


def _hints_bundle(
    industry_key: str,
    dens_label: str,
    nearest_area_row: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    sales_df = _get("sales", load_sales_data)
    fp_df = _get("fp", load_floating_pop)
    ik = (industry_key or "all").strip().lower()
    svc = MAP_SERVICE_BY_INDUSTRY.get(ik, MAP_SERVICE_BY_INDUSTRY["all"])

    ac = ""
    if nearest_area_row and nearest_area_row.get("area_code"):
        ac = str(nearest_area_row["area_code"])

    floating = (
        _floating_pop_hint(fp_df, ac)
        if ac
        else {"level": None, "note": "상세 컨설팅에서 확인 가능"}
    )
    sales_h = _sales_hint_row(sales_df, ac, svc) if ac else {"monthly_manwon": None, "note": "상세 컨설팅에서 추정"}

    opp: List[str] = []
    risk: List[str] = []
    if dens_label == "낮음":
        opp.append("선택 반경 기준으로 유사 업종 밀도는 상대적으로 낮은 편입니다.")
    if floating.get("level") == "높음":
        opp.append("유동인구는 로컬 데이터 기준으로 다소 양호하게 나타난 구간입니다.")
    elif floating.get("level") == "낮음":
        risk.append("유동인구는 로컬 데이터 기준으로 다소 낮게 나타날 수 있어 집객 요인을 함께 점검하는 것이 좋습니다.")
    if dens_label == "높음":
        risk.append("유사 업종 점포가 많아 경쟁 부담을 검토할 수 있습니다.")
    risk.append("임대료·고정비 부담은 상세 컨설팅 입력에서 함께 확인할 수 있습니다.")

    return {
        "floating_pop": floating,
        "sales_estimate": sales_h,
        "opportunity_lines": opp[:4],
        "risk_lines": risk[:4],
    }


def _recommended_next_step(dens_label: str) -> str:
    if dens_label == "높음":
        return "차별화·운영 시간대·재방문 전략을 상세 컨설팅에서 구체화해 보세요."
    if dens_label == "낮음":
        return "입지·수요 검증과 초기 마케팅 계획을 상세 컨설팅에서 정리해 보세요."
    return "매출·비용 가정을 상세 컨설팅에서 조정하고 시나리오를 비교해 보세요."


@router.get("/nearest-area")
def nearest_area(lat: float = Query(...), lon: float = Query(...)):
    """선택 좌표에서 가까운 상권(영역 데이터 기준) 후보."""
    if not (33 < lat < 39 and 124 < lon < 132):
        return {"candidates": [], "warnings": ["좌표가 유효 범위를 벗어났습니다."]}
    cand = _nearest_areas(lat, lon, top_k=5)
    return {"candidates": cand, "warnings": []}


@router.get("/nearby-stores")
def nearby_stores(
    lat: float = Query(...),
    lon: float = Query(...),
    radius: int = Query(500, ge=50, le=5000),
    industry: str = Query("all"),
    limit: int = Query(120, ge=1, le=300),
):
    """좌표 반경 내 로컬 상가 레코드 — 거리순."""
    warnings: List[str] = []
    if not (33 < lat < 39 and 124 < lon < 132):
        return {
            "source": "local_sbiz_csv",
            "source_label": "소상공인시장진흥공단 상가(상권)정보 로컬 CSV",
            "is_live_api": False,
            "center": {"lat": lat, "lon": lon},
            "query": {"radius": radius, "industry": industry},
            "summary": {
                "total_stores": 0,
                "same_or_similar_stores": 0,
                "density_level": "낮음",
                "density_comment": "좌표가 서울 분석 범위를 벗어났습니다.",
            },
            "top_industries": [],
            "nearest_store": None,
            "stores": [],
            "warnings": warnings + ["유효하지 않은 좌표입니다."],
            "radius_breakdown": {},
            "area_candidates": [],
            "context_hints": {},
            "recommended_next_step": "",
        }

    sosno = _get("sosno", load_sosnogongdan_seoul)
    if sosno.empty:
        warnings.append("소상공인 상가 로컬 데이터가 없습니다. data 폴더 CSV를 확인하세요.")
        return {
            "source": "local_sbiz_csv",
            "source_label": "소상공인시장진흥공단 상가(상권)정보 로컬 CSV",
            "is_live_api": False,
            "center": {"lat": lat, "lon": lon},
            "query": {"radius": radius, "industry": industry},
            "summary": {
                "total_stores": 0,
                "same_or_similar_stores": 0,
                "density_level": "낮음",
                "density_comment": "표시할 데이터가 없습니다.",
            },
            "top_industries": [],
            "nearest_store": None,
            "stores": [],
            "warnings": warnings,
            "radius_breakdown": {},
            "area_candidates": [],
            "context_hints": {},
            "recommended_next_step": "",
        }

    raw_len = len(sosno)
    sosno = sosno.dropna(subset=["위도", "경도"]).copy()
    dropped_coords = raw_len - len(sosno)
    if dropped_coords:
        warnings.append(f"좌표 없는 레코드 {dropped_coords}건은 제외했습니다.")

    lats = pd.to_numeric(sosno["위도"], errors="coerce").values
    lons = pd.to_numeric(sosno["경도"], errors="coerce").values
    dist = _haversine_m(lat, lon, lats, lons)
    sosno["_dist_m"] = dist

    # 반경 버튼(300/500/1km) 통계는 최대 1km 범위 샘플만으로 계산해 응답 지연을 줄입니다.
    near_1k = sosno[sosno["_dist_m"] <= 1000.0]
    radius_breakdown = _radius_breakdown(near_1k, industry)

    in_rad = sosno[sosno["_dist_m"] <= float(radius)].copy()
    total_stores = int(len(in_rad))

    preset = _preset_fn(industry if industry else "all")

    txt_series = in_rad.apply(lambda row: _norm_text(row), axis=1)
    if industry and industry.lower() not in ("", "all"):
        mask = txt_series.map(lambda t: preset(t))
        same_df = in_rad[mask].copy()
        same_or_similar = int(len(same_df))
        if same_or_similar == 0:
            warnings.append("선택한 업종 조건에 해당하는 점포가 반경 안에 없습니다.")
    else:
        same_df = in_rad.copy()
        same_or_similar = total_stores

    dens_label, dens_comment = _density_level(same_or_similar if industry not in ("", "all") else total_stores, radius)
    if industry and industry.lower() not in ("", "all"):
        summary_comment = dens_comment
        if same_or_similar >= 10:
            summary_comment = (
                f"반경 {radius}m 내 동일·유사 업종 점포가 상대적으로 많습니다. "
                "신규 고객 확보보다 재방문·시간대별 프로모션 전략을 검토해 보세요."
            )
        elif same_or_similar <= 2:
            summary_comment = (
                f"반경 {radius}m 내 유사 업종이 많지 않습니다. "
                "신규 수요 발굴과 입소문 마케팅에 무게를 둘 수 있습니다."
            )
    else:
        summary_comment = f"반경 {radius}m 내 등록된 점포 수 기준으로 상권 밀도를 참고할 수 있습니다."

    top_industries = _top_industries(in_rad if not in_rad.empty else sosno.iloc[:0], top_n=5)

    sort_df = same_df.sort_values("_dist_m") if len(same_df) else same_df
    nearest_row = sort_df.iloc[0] if len(sort_df) else None

    nearest_store = None
    if nearest_row is not None:
        sr = nearest_row
        d = float(sr["_dist_m"])
        nearest_store = {
            "store_name": str(sr.get("상호명", "") or ""),
            "distance_m": round(d, 1),
            "industry_small": str(sr.get("상권업종소분류명", "") or ""),
        }

    rows_out: List[Dict[str, Any]] = []
    limit_eff = min(limit, 300)
    take_df = (
        sort_df.head(limit_eff)
        if len(sort_df)
        else in_rad.sort_values("_dist_m").head(min(limit_eff, max(0, total_stores)))
    )

    for _, sr in take_df.iterrows():
        d = float(sr["_dist_m"])
        dm = int(round(d))
        rows_out.append(
            {
                "store_id": str(sr.get("상가업소번호", "") or ""),
                "store_name": str(sr.get("상호명", "") or ""),
                "industry_large": str(sr.get("상권업종대분류명", "") or ""),
                "industry_middle": str(sr.get("상권업종중분류명", "") or ""),
                "industry_small": str(sr.get("상권업종소분류명", "") or ""),
                "industry_name": _norm_text(sr).strip() or "-",
                "address": str(sr.get("지번주소", "") or ""),
                "road_address": str(sr.get("도로명주소", "") or ""),
                "lat": float(sr["위도"]),
                "lon": float(sr["경도"]),
                "distance_m": round(d, 1),
                "distance_label": f"{dm}m",
                "source": "local_sbiz_csv",
            }
        )

    area_candidates = _build_area_candidates(lat, lon, radius, industry)
    nearest_primary = _nearest_areas(lat, lon, top_k=1)
    hints = _hints_bundle(industry, dens_label, nearest_primary[0] if nearest_primary else None)
    rec_step = _recommended_next_step(dens_label)

    return {
        "source": "local_sbiz_csv",
        "source_label": "소상공인시장진흥공단 상가(상권)정보 로컬 CSV",
        "is_live_api": False,
        "center": {"lat": lat, "lon": lon},
        "query": {"radius": radius, "industry": industry},
        "summary": {
            "total_stores": total_stores,
            "same_or_similar_stores": same_or_similar if industry and industry.lower() not in ("", "all") else total_stores,
            "density_level": dens_label,
            "density_comment": summary_comment,
        },
        "top_industries": top_industries,
        "nearest_store": nearest_store,
        "stores": rows_out,
        "warnings": warnings,
        "meta": {"raw_row_count": raw_len, "excluded_no_coords": dropped_coords, "returned_count": len(rows_out)},
        "radius_breakdown": radius_breakdown,
        "area_candidates": area_candidates,
        "context_hints": hints,
        "recommended_next_step": rec_step,
    }
