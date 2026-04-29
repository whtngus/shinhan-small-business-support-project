"""경쟁점 지도 API"""
from fastapi import APIRouter
import sys, numpy as np, pandas as pd
from pathlib import Path
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple
sys.path.insert(0, str(Path(__file__).parent.parent))
from src.data_loader import load_area, load_sosnogongdan_seoul
from utils.coord_transform import convert_area_coords

router = APIRouter()
_C: dict = {}

# 서울 공공 서비스 업종명 → 소상공인 데이터 분류명 키워드 매핑
SERVICE_SYNONYMS = {
    "커피-음료":    ["카페", "커피"],
    "제과점":       ["제과", "베이커리", "빵"],
    "한식음식점":   ["한식"],
    "양식음식점":   ["양식", "이탈리안", "스테이크", "파스타"],
    "일식음식점":   ["일식", "초밥", "라멘"],
    "중식음식점":   ["중식", "중국"],
    "분식전문점":   ["분식"],
    "치킨전문점":   ["치킨"],
    "패스트푸드점": ["햄버거", "버거", "패스트"],
    "호프-간이주점": ["호프", "주점", "맥주"],
    "편의점":       ["편의점"],
    "슈퍼마켓":     ["슈퍼", "마트"],
    "미용실":       ["미용실", "헤어"],
    "네일숍":       ["네일"],
    "피부관리실":   ["피부관리", "피부미용"],
    "부동산중개업": ["부동산"],
    "PC방":         ["PC방", "피시방"],
    "노래방":       ["노래"],
    "독서실":       ["독서실", "스터디"],
    "당구장":       ["당구"],
    "스포츠클럽":   ["스포츠", "헬스"],
    "여행사":       ["여행"],
    "사진관":       ["사진"],
    "동물병원":     ["동물"],
    "한의원":       ["한의원"],
    "치과의원":     ["치과"],
    "일반의류":     ["의류", "옷"],
    "화장품":       ["화장품"],
}


def _service_keywords(service_name: str):
    if not service_name:
        return []
    if service_name in SERVICE_SYNONYMS:
        return SERVICE_SYNONYMS[service_name]
    base = service_name.replace("음식점", "").replace("전문점", "").replace("-", " ").strip()
    return [w for w in base.split() if w] or [service_name[:2]]


def _service_mask(df: pd.DataFrame, service_name: str) -> pd.Series:
    if not service_name:
        return pd.Series(False, index=df.index)
    keywords = _service_keywords(service_name)
    if not keywords:
        return pd.Series(False, index=df.index)
    pattern = "|".join(keywords)
    sub_col = df.get("상권업종소분류명", pd.Series(dtype=str))
    mid_col = df.get("상권업종중분류명", pd.Series(dtype=str))
    return sub_col.fillna("").str.contains(pattern, case=False, na=False) | \
           mid_col.fillna("").str.contains(pattern, case=False, na=False)


def _get(key, loader):
    if key not in _C:
        _C[key] = loader()
    return _C[key]


def _haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = np.sin(dlat/2)**2 + np.cos(np.radians(lat1))*np.cos(np.radians(lat2))*np.sin(dlon/2)**2
    return 2 * R * np.arcsin(np.sqrt(a))


def _fmt_distance_ko_m(m: int) -> str:
    """해석 메시지용 거리 문자열."""
    m = int(m)
    if m >= 1000:
        km = m / 1000.0
        if abs(km - round(km)) < 1e-9:
            return f"{int(round(km))}km"
        s = f"{km:.1f}".rstrip("0").rstrip(".")
        return f"{s}km"
    return f"{m}m"


def _primary_band_same_peers_expand(
    sosno: pd.DataFrame,
    same_mask_all: pd.Series,
    radius: int,
) -> Tuple[int, Optional[Dict[str, Any]]]:
    """동일 업종이 기준 반경(기본 500m) 안에 5곳 이하면 반경을 단계적으로 넓힙니다."""
    initial_r = max(300, min(int(radius), 8000))
    same_dist = sosno.loc[same_mask_all, "_dist"]
    if same_dist.empty:
        return 1000, None

    n_ini = int((same_dist <= initial_r).sum())
    if n_ini > 5:
        return 1000, None

    peer_lims = [500, 750, 1000, 1500, 2000, 3000, 5000]
    eff_peer_r = initial_r
    for lim in peer_lims:
        if lim <= initial_r:
            continue
        n_at = int((same_dist <= lim).sum())
        eff_peer_r = lim
        if n_at > 5:
            break

    primary_band_m = max(1000, eff_peer_r)
    n_eff = int((same_dist <= primary_band_m).sum())
    re_out = {
        "applied": True,
        "initial_m": initial_r,
        "effective_m": primary_band_m,
        "same_count_initial": n_ini,
        "same_count_effective": n_eff,
        "message": (
            f"반경 {initial_r}m 이내 동일 업종 점포가 {n_ini}곳뿐이어서 참고 범위를 "
            f"{_fmt_distance_ko_m(primary_band_m)}까지 넓혔습니다."
        ),
    }
    return primary_band_m, re_out


def _stores_records_from_df(df: pd.DataFrame, extra: Optional[Dict[str, Any]] = None) -> List[dict]:
    """경쟁점 지도용 레코드 (거리 m, is_same 등)."""
    if df is None or df.empty:
        return []
    cols = [
        c
        for c in [
            "상가업소번호",
            "상호명",
            "상권업종소분류명",
            "상권업종중분류명",
            "도로명주소",
            "지번주소",
            "시군구명",
            "행정동명",
            "위도",
            "경도",
            "_dist",
            "is_same",
        ]
        if c in df.columns or c in {"_dist", "is_same"}
    ]
    out = df[cols].dropna(subset=["위도", "경도"]).to_dict(orient="records")
    for s in out:
        if "_dist" in s:
            s["dist"] = int(round(float(s.pop("_dist"))))
        s["is_same"] = bool(s.get("is_same", False))
        if extra:
            for k, v in extra.items():
                s[k] = v
    return out


@router.get("/competitors")
def get_competitors(area_code: str, service_name: str = "", radius: int = 500,
                    lat: Optional[float] = None, lon: Optional[float] = None):
    """선택 상권 중심(default) 또는 사용자가 지정한 (lat, lon) 기준으로 경쟁점 분포를 산출.

    lat/lon 이 주어지면 area_code 의 좌표를 무시하고 해당 위치를 중심으로 재계산합니다.
    """
    area_df = _get("area", load_area)
    sosno   = _get("sosno", load_sosnogongdan_seoul)

    # 1) 사용자 지정 좌표 → 우선
    center_lat, center_lon = 37.5665, 126.9780
    center_source = "default"
    if lat is not None and lon is not None and 33 < lat < 39 and 124 < lon < 132:
        center_lat, center_lon = float(lat), float(lon)
        center_source = "custom"
    elif not area_df.empty and "상권_코드" in area_df.columns:
        row = area_df[area_df["상권_코드"].astype(str) == str(area_code)]
        if not row.empty and "엑스좌표_값" in row.columns:
            try:
                converted = convert_area_coords(row)
                if "위도" in converted.columns and "경도" in converted.columns:
                    center_lat = float(converted["위도"].iloc[0])
                    center_lon = float(converted["경도"].iloc[0])
                    center_source = "area"
            except Exception:
                pass

    expansion: Dict[str, Any] = {
        "proxy_gu": None,
        "proxy_dong": None,
        "same_extended_level": None,
        "primary_band_m": 1000,
        "hints": [],
    }
    extended_same: List[dict] = []
    reference_nearby_other: List[dict] = []

    if sosno.empty:
        return {
            "center": [center_lat, center_lon],
            "center_source": center_source,
            "stores": [],
            "counts": {"300": 0, "500": 0, "1000": 0},
            "expansion": expansion,
            "extended_same": [],
            "reference_nearby_other": [],
            "radius_expansion": None,
        }

    # 거리 계산
    lats = sosno.get("위도", pd.Series(dtype=float)).values.astype(float)
    lons = sosno.get("경도", pd.Series(dtype=float)).values.astype(float)
    dists = _haversine(center_lat, center_lon, lats, lons)
    sosno = sosno.copy()
    sosno["_dist"] = dists

    same_mask_all = _service_mask(sosno, service_name) if service_name else pd.Series(False, index=sosno.index)

    # 분석 중심에서 가장 가까운 상가 1곳 기준 행정동·자치구 (동→구 확장 검색용)
    nearest_row = sosno.loc[sosno["_dist"].idxmin()]
    if "시군구명" in sosno.columns:
        v = nearest_row.get("시군구명")
        expansion["proxy_gu"] = str(v).strip() if pd.notna(v) else None
    if "행정동명" in sosno.columns:
        v = nearest_row.get("행정동명")
        expansion["proxy_dong"] = str(v).strip() if pd.notna(v) else None

    radius_expansion: Optional[Dict[str, Any]] = None
    primary_band_m = 1000
    if service_name:
        primary_band_m, radius_expansion = _primary_band_same_peers_expand(
            sosno, same_mask_all, radius,
        )
    in_primary = sosno[sosno["_dist"] <= primary_band_m].copy()
    if in_primary.empty:
        primary_band_m = 3000
        in_primary = sosno[sosno["_dist"] <= primary_band_m].copy()
        expansion["primary_band_m"] = primary_band_m
        expansion["hints"].append(
            "반경 1km 이내 상가 정보가 없어 목록은 3km까지 확장했습니다.",
        )
    else:
        expansion["primary_band_m"] = primary_band_m

    if not service_name:
        in_primary["is_same"] = False
    else:
        in_primary["is_same"] = same_mask_all.loc[in_primary.index]

    # 동일 업종은 모두, 그외는 거리 가까운 순으로 보충 (총 300개 캡)
    same = in_primary[in_primary["is_same"]].sort_values("_dist")
    other = in_primary[~in_primary["is_same"]].sort_values("_dist").head(max(0, 300 - len(same)))
    pick = pd.concat([same, other]).sort_values("_dist")

    stores = _stores_records_from_df(pick)

    counts = {
        "300": int((sosno["_dist"] <= 300).sum()),
        "500": int((sosno["_dist"] <= 500).sum()),
        "1000": int((sosno["_dist"] <= 1000).sum()),
    }
    if service_name:
        same_all = sosno[same_mask_all]
        counts["same_300"] = int((same_all["_dist"] <= 300).sum())
        counts["same_500"] = int((same_all["_dist"] <= 500).sum())
        counts["same_1000"] = int((same_all["_dist"] <= 1000).sum())
    else:
        counts.update({"same_300": 0, "same_500": 0, "same_1000": 0})

    # ── 반경 내 동일 업종 0건: 행정동 → 자치구 순으로 동일 업종 후보 ──
    if (
        service_name
        and counts.get("same_1000", 0) == 0
        and expansion.get("proxy_dong")
        and "행정동명" in sosno.columns
    ):
        dong_mask = (
            same_mask_all
            & (sosno["행정동명"].astype(str).str.strip() == expansion["proxy_dong"])
        )
        dong_df = sosno[dong_mask].sort_values("_dist").head(80)
        if not dong_df.empty:
            dong_df = dong_df.copy()
            dong_df["is_same"] = True
            expansion["same_extended_level"] = "dong"
            expansion["hints"].append(
                f"반경 1km 내 동일 업종이 없어 '{expansion['proxy_dong']}' 행정동 일대 동일 업종 점포를 참고했습니다.",
            )
            extended_same = _stores_records_from_df(dong_df, {"extended_scope": "dong"})
        elif expansion.get("proxy_gu") and "시군구명" in sosno.columns:
            gu_mask = (
                same_mask_all
                & (sosno["시군구명"].astype(str).str.strip() == expansion["proxy_gu"])
            )
            gu_df = sosno[gu_mask].sort_values("_dist").head(100)
            if not gu_df.empty:
                gu_df = gu_df.copy()
                gu_df["is_same"] = True
                expansion["same_extended_level"] = "gu"
                expansion["hints"].append(
                    f"인근 동일 업종이 없어 '{expansion['proxy_gu']}' 자치구 범위로 확장했습니다.",
                )
                extended_same = _stores_records_from_df(gu_df, {"extended_scope": "gu"})
    elif service_name and counts.get("same_1000", 0) == 0 and expansion.get("proxy_gu"):
        gu_mask = same_mask_all & (
            sosno["시군구명"].astype(str).str.strip() == expansion["proxy_gu"]
        )
        gu_df = sosno[gu_mask].sort_values("_dist").head(100)
        if not gu_df.empty:
            gu_df = gu_df.copy()
            gu_df["is_same"] = True
            expansion["same_extended_level"] = "gu"
            expansion["hints"].append(
                f"반경 1km 내 동일 업종이 없어 '{expansion['proxy_gu']}' 자치구 범위로 확장했습니다.",
            )
            extended_same = _stores_records_from_df(gu_df, {"extended_scope": "gu"})

    # ── 동일 업종 근처에 거의 없을 때: 가까운 다른 업종 점포 참고 ──
    if service_name and counts.get("same_500", 0) == 0:
        peer = sosno[~same_mask_all & (sosno["_dist"] <= 2000)].sort_values("_dist").head(14)
        if not peer.empty:
            peer = peer.copy()
            peer["is_same"] = False
            reference_nearby_other = _stores_records_from_df(
                peer, {"reference_peer": True},
            )
            expansion["hints"].append(
                "동일 업종은 가깝지 않지만, 반경 2km 내 다른 업종 점포를 참고용으로 모았습니다.",
            )

    return {
        "center": [center_lat, center_lon],
        "center_source": center_source,
        "stores": stores,
        "counts": counts,
        "expansion": expansion,
        "extended_same": extended_same,
        "reference_nearby_other": reference_nearby_other,
        "radius_expansion": radius_expansion,
    }
