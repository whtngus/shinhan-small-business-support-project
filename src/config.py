"""설정 로더 - .env 기반, 코드 하드코딩 금지"""
from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv()

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
DUCKDB_PATH = Path(os.getenv("DUCKDB_PATH", str(DATA_DIR / "app.duckdb")))

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
ENABLE_LLM_REPORT = os.getenv("ENABLE_LLM_REPORT", "true").lower() == "true"
ENABLE_RAG = os.getenv("ENABLE_RAG", "false").lower() == "true"

DEFAULT_REGION = os.getenv("DEFAULT_REGION", "서울")
DEFAULT_YEAR_QUARTER = os.getenv("DEFAULT_YEAR_QUARTER", "20244")

RISK_WEIGHTS = {
    "sales_decline":       float(os.getenv("RISK_SCORE_WEIGHT_SALES",       "0.25")),
    "store_competition":   float(os.getenv("RISK_SCORE_WEIGHT_COMPETITION",  "0.20")),
    "closure_increase":    float(os.getenv("RISK_SCORE_WEIGHT_CLOSURE",      "0.15")),
    "floating_pop_decline":float(os.getenv("RISK_SCORE_WEIGHT_POPULATION",   "0.15")),
    "industry_survival":   float(os.getenv("RISK_SCORE_WEIGHT_SURVIVAL",     "0.15")),
    "rent_increase":       float(os.getenv("RISK_SCORE_WEIGHT_RENT",         "0.10")),
}

RISK_GRADES = [
    (80, 101, "위험",       "#ef4444"),
    (60,  80, "주의",       "#f97316"),
    (40,  60, "관심",       "#3b82f6"),
    ( 0,  40, "안정",       "#22c55e"),
]

FIT_GRADES = [
    (80, 101, "추천",       "#22c55e"),
    (60,  80, "조건부 추천", "#3b82f6"),
    (40,  60, "신중 검토",  "#f97316"),
    ( 0,  40, "비추천",     "#ef4444"),
]

DATA_PATHS = {
    "kosis_survival":    DATA_DIR / "KOSIS_기업생멸행정통계",
    "real_estate_trade": DATA_DIR / "국토교통부_상업업무용_실거래가",
    "floating_pop":      DATA_DIR / "서울시 상권분석서비스(길단위인구-상권)",
    "commercial_change": DATA_DIR / "서울시 상권분석서비스(상권변화지표-상권)",
    "resident_pop":      DATA_DIR / "서울시_상권분석서비스_상주인구_상권",
    "income_consume":    DATA_DIR / "서울시_상권분석서비스_소득소비",
    "area":              DATA_DIR / "서울시_상권분석서비스_영역_상권",
    "store":             DATA_DIR / "서울시_상권분석서비스_점포_상권",
    "worker_pop":        DATA_DIR / "서울시_상권분석서비스_직장인구_상권",
    "facilities":        DATA_DIR / "서울시_상권분석서비스_집객시설_상권",
    "sales":             DATA_DIR / "서울시_상권분석서비스_추정매출",
    "sosnogongdan":      DATA_DIR / "소상공인시장진흥공단_상가(상권)정보",
    "rental_trend":      DATA_DIR / "한국부동산원_상업용부동산_임대동향",
}


def get_risk_grade(score: float) -> tuple:
    for lo, hi, label, color in RISK_GRADES:
        if lo <= score < hi:
            return label, color
    return "위험", "#ef4444"


def get_fit_grade(score: float) -> tuple:
    for lo, hi, label, color in FIT_GRADES:
        if lo <= score < hi:
            return label, color
    return "비추천", "#ef4444"
