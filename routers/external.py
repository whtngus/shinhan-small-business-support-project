"""외부 검색 (카카오 로컬 키워드 검색) - 상권 목록에 없는 키워드 보조 검색.

env: KAKAO_REST_API_KEY 미설정 시 helpful한 안내 응답.
체인점명/특수업종/실제 점포 정보를 가져와 사용자 검색 자유도를 높입니다.
"""
import os
import sys
from pathlib import Path
from typing import Optional
from datetime import date

import requests
from fastapi import APIRouter, HTTPException, Query
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent.parent))
from src.data_loader import load_area
from utils.coord_transform import convert_area_coords

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

router = APIRouter()

KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"

_C: dict = {}


def _get(key, loader):
    if key not in _C:
        _C[key] = loader()
    return _C[key]


def _kakao_headers() -> Optional[dict]:
    rest_key = os.getenv("KAKAO_REST_API_KEY", "").strip()
    if not rest_key:
        return None
    return {"Authorization": f"KakaoAK {rest_key}"}


def _kakao_keyword(q: str, size: int = 10,
                   x: Optional[float] = None, y: Optional[float] = None,
                   radius: Optional[int] = None):
    """카카오 로컬 키워드 검색.
    x = 경도(longitude), y = 위도(latitude). x/y/radius 모두 있으면 좌표 중심 검색.
    """
    headers = _kakao_headers()
    if headers is None:
        return None, "카카오 REST API 키가 설정되지 않았습니다 (.env: KAKAO_REST_API_KEY)"
    params = {"query": q, "size": min(max(size, 1), 15)}
    if x is not None and y is not None:
        params["x"] = x
        params["y"] = y
        if radius:
            params["radius"] = min(max(radius, 1), 20000)
    try:
        r = requests.get(KAKAO_KEYWORD_URL, headers=headers, params=params, timeout=4)
        r.raise_for_status()
        documents = r.json().get("documents", [])
        out = []
        for it in documents:
            out.append({
                "title":      it.get("place_name", ""),
                "category":   it.get("category_name", ""),
                "category_group": it.get("category_group_name", ""),
                "address":    it.get("road_address_name") or it.get("address_name", ""),
                "telephone":  it.get("phone", ""),
                "link":       it.get("place_url", ""),
                "lat":        float(it["y"]) if it.get("y") else None,
                "lon":        float(it["x"]) if it.get("x") else None,
                "distance":   int(it["distance"]) if it.get("distance") else None,
            })
        return out, None
    except requests.HTTPError as e:
        # 401/403 인증 실패 등 친절한 메시지
        msg = f"카카오 검색 실패: HTTP {e.response.status_code}"
        try:
            detail = e.response.json()
            msg += f" - {detail.get('message') or detail.get('msg') or ''}"
        except Exception:
            pass
        return None, msg
    except Exception as e:
        return None, f"카카오 검색 실패: {e}"


def _haversine(lat1, lon1, lat2, lon2):
    import math
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return 2 * R * math.asin(math.sqrt(a))


def _nearest_area(lat: float, lon: float, top_k: int = 3):
    """주어진 좌표에서 가장 가까운 우리 데이터의 상권 후보 top_k 반환."""
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
    sub["_dist"] = sub.apply(lambda r: _haversine(lat, lon, r["위도"], r["경도"]), axis=1)
    sub = sub.sort_values("_dist").head(top_k)
    cols = ["상권_코드", "상권_코드_명", "상권_구분_코드_명",
            "자치구_코드_명", "행정동_코드_명", "위도", "경도", "_dist"]
    cols = [c for c in cols if c in sub.columns]
    out = []
    for _, r in sub[cols].iterrows():
        out.append({
            "area_code": str(r.get("상권_코드", "")),
            "area_name": str(r.get("상권_코드_명", "")),
            "area_type": str(r.get("상권_구분_코드_명", "")),
            "district":  str(r.get("자치구_코드_명", "")),
            "dong":      str(r.get("행정동_코드_명", "")),
            "lat":       float(r.get("위도", 0)) if r.get("위도") else None,
            "lon":       float(r.get("경도", 0)) if r.get("경도") else None,
            "dist_m":    round(float(r["_dist"]), 0),
        })
    return out


@router.get("/external-search")
def external_search(q: str = Query("", min_length=1)):
    """검색어를 받아 카카오 로컬 검색 결과 + 가장 가까운 공공 데이터 상권 매칭을 반환."""
    if not q.strip():
        raise HTTPException(status_code=400, detail="검색어를 입력해주세요.")

    local, local_err = _kakao_keyword(q, size=10)
    api_enabled = _kakao_headers() is not None

    matched_areas = []
    if local:
        seen = set()
        for it in local:
            if it.get("lat") and it.get("lon"):
                near = _nearest_area(it["lat"], it["lon"], top_k=2)
                for a in near:
                    key = a["area_code"]
                    if key and key not in seen:
                        seen.add(key)
                        matched_areas.append(a)
            if len(matched_areas) >= 5:
                break

    return {
        "query": q,
        "provider": "kakao",
        "kakao_enabled": api_enabled,
        "local_places": local or [],
        "matched_areas": matched_areas[:5],
        "errors": {k: v for k, v in {"local": local_err}.items() if v},
        "help": {
            "what_is_search": (
                "본 페이지의 '상권 검색' 입력은 서울시 공공데이터의 상권명(예: '강남역', '홍대입구')으로 "
                "키워드 매칭됩니다. 체인점명·메뉴까지는 검색되지 않습니다."
            ),
            "external_help": (
                "카카오 로컬 검색으로 체인점명·실제 점포·상호를 찾고, "
                "해당 위치에서 가장 가까운 공공 데이터 상권으로 자동 매칭합니다."
            ) if api_enabled else (
                "외부 검색을 사용하려면 .env 파일에 KAKAO_REST_API_KEY 를 설정해주세요. "
                "현재는 우리 데이터의 상권명 키워드 매칭만 동작합니다."
            ),
        },
    }


@router.get("/search-meaning")
def search_meaning():
    """상권 검색 입력의 의미와 사용법을 설명하는 정적 응답 (UI 툴팁용)."""
    return {
        "title": "상권 검색은 어떤 식으로 동작하나요?",
        "lines": [
            "서울시 공공 상권명 데이터에 대한 키워드 매칭 검색입니다.",
            "예: '강남' → '강남역', '강남구청역', '강남대로' 등 강남이 포함된 상권 표시.",
            "체인점명(예: 스타벅스), 메뉴, 후기 등은 직접 검색되지 않습니다.",
            "원하는 위치가 목록에 없으면 아래 '목록에 없으신가요?' 버튼으로 카카오 검색을 활용하세요.",
        ],
    }


@router.get("/kakao-sdk-check")
def kakao_sdk_check():
    """서버(백엔드)에서 dapi.kakao.com 으로 sdk.js 요청이 되는지 확인.

    브라우저에서만 실패할 때(광고차단, VPN, 터널 URL 등) 원인 분리에 사용합니다.
    키 전체는 응답에 포함하지 않습니다.
    """
    js_key = (
        os.getenv("KAKAO_JAVA_SCRIPT_KEY", "").strip()
        or os.getenv("KAKAO_MAP_APP_KEY", "").strip()
    )
    if not js_key:
        return {
            "env_has_js_key": False,
            "server_http_status": None,
            "server_reachable": False,
            "hint": ".env 에 KAKAO_JAVA_SCRIPT_KEY 가 없습니다.",
        }
    url = "https://dapi.kakao.com/v2/maps/sdk.js"
    params = {"appkey": js_key, "libraries": "services", "autoload": "false"}
    try:
        r = requests.get(url, params=params, timeout=10)
        ct = (r.headers.get("content-type") or "").lower()
        body = r.text or ""
        looks_like_js = (
            "javascript" in ct or "ecmascript" in ct
            or body.strip().startswith("(function")
            or "kakao" in body[:200].lower()
        )
        ok = r.status_code == 200 and looks_like_js and len(body) > 500
        hint = None
        if r.status_code != 200:
            hint = f"HTTP {r.status_code}. 응답 앞부분: {(r.text or '')[:120].replace(chr(10), ' ')}"
        elif not ok:
            hint = f"200 이지만 SDK 본문으로 보이지 않습니다. content-type={r.headers.get('content-type')}, len={len(body)}"
    except Exception as e:
        return {
            "env_has_js_key": True,
            "key_len": len(js_key),
            "key_prefix": js_key[:4] + "…",
            "server_http_status": None,
            "server_reachable": False,
            "hint": f"서버에서 카카오로 요청 실패: {e}",
        }


@router.get("/shinhan-loan-rates")
def shinhan_loan_rates():
    """자영업자용 대출 금리 참고값 + 공식 이동 링크.

    실제 적용 금리는 신용도/담보/보증/정책자금 대상 여부/우대 조건에 따라 달라집니다.
    """
    today = date.today().isoformat()
    return {
        "provider": "shinhan-reference",
        "updated_at": today,
        "disclaimer": (
            "아래 금리는 서비스 화면 안내용 참고 구간입니다. "
            "실제 적용 금리·한도는 신한은행 심사 및 상품 조건에 따라 달라집니다."
        ),
        "rates": [
            {
                "product": "SOHO 신용대출(참고)",
                "rate_min": 4.9,
                "rate_max": 7.9,
                "conditions": "개인사업자 신용·매출·업종·거래실적에 따라 차등",
                "apply_url": "https://bank.shinhan.com/index.jsp",
            },
            {
                "product": "정책자금·보증 연계(참고)",
                "rate_min": 3.5,
                "rate_max": 6.2,
                "conditions": "보증기관/정책자금 요건 충족 시",
                "apply_url": "https://www.smefinance.go.kr/main.do",
            },
            {
                "product": "시설·운전자금 담보대출(참고)",
                "rate_min": 4.2,
                "rate_max": 6.8,
                "conditions": "담보유형·LTV·상환방식에 따라 변동",
                "apply_url": "https://bank.shinhan.com/index.jsp",
            },
        ],
        "links": [
            {"label": "신한은행 기업/개인사업자 금융", "url": "https://bank.shinhan.com/index.jsp"},
            {"label": "소상공인 정책자금 통합포털", "url": "https://www.smefinance.go.kr/main.do"},
        ],
    }


@router.get("/map-config")
def map_config():
    """프런트엔드가 카카오 SDK를 동적으로 로드할 때 사용할 키 + 활성화 여부 반환.

    브라우저용은 카카오 콘솔의 **JavaScript 키** → 환경변수 KAKAO_JAVA_SCRIPT_KEY.
    (구버전 호환: KAKAO_MAP_APP_KEY 도 동일 용도로 fallback)
    REST API 키는 서버에서만 사용하며 노출되지 않습니다.
    """
    provider = os.getenv("MAP_PROVIDER", "auto").strip().lower() or "auto"
    js_key = (
        os.getenv("KAKAO_JAVA_SCRIPT_KEY", "").strip()
        or os.getenv("KAKAO_MAP_APP_KEY", "").strip()
    )
    rest_configured = bool(os.getenv("KAKAO_REST_API_KEY", "").strip())
    return {
        "provider": provider,
        "kakao_js_app_key": js_key,
        "configured": bool(js_key),
        "rest_configured": rest_configured,
        "help": (
            "지도와 장소 검색을 사용하려면 카카오 디벨로퍼스에서 앱을 등록하고 "
            ".env 의 KAKAO_JAVA_SCRIPT_KEY (JavaScript 키) 와 KAKAO_REST_API_KEY (REST API 키) 를 채워주세요. "
            "JavaScript 키는 플랫폼 Web 에 접속 URL(예: http://localhost:3288)을 등록해야 합니다."
        ),
    }
