"""신한 자영업 경영지원 컨설팅 - FastAPI 메인 앱

v2 스펙 기준: 단계형 컨설팅 웹서비스 (챗봇 X)
- 홈 → 사용자 유형 → 지역/상권/업종 → 사업 조건 → 분석 → 결과 대시보드
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
import uvicorn

from routers import areas, dashboard, map_api, map_explorer, report, recommend, external, operating_business, account

BASE_DIR = Path(__file__).parent
load_dotenv(BASE_DIR / ".env")


def _kakao_js_key() -> str:
    return (
        os.getenv("KAKAO_JAVA_SCRIPT_KEY", "").strip()
        or os.getenv("KAKAO_MAP_APP_KEY", "").strip()
    )


def _google_client_id() -> str:
    return os.getenv("GOOGLE_CLIENT_ID", "").strip()


app = FastAPI(
    title="신한 자영업 경영지원 컨설팅",
    description="공공데이터 기반 상권 분석 + 창업/운영/금융/보험/카드/성장지원 단계형 컨설팅",
    version="2.0.0",
)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

app.include_router(areas.router,     prefix="/api",      tags=["areas"])
app.include_router(dashboard.router, prefix="/api",      tags=["dashboard"])
app.include_router(map_api.router,   prefix="/api",      tags=["map"])
app.include_router(map_explorer.router, prefix="/api/map-explorer", tags=["map-explorer"])
app.include_router(report.router,    prefix="/api",      tags=["report"])
app.include_router(recommend.router, prefix="/api",      tags=["recommend"])
app.include_router(external.router,  prefix="/api",      tags=["external"])
app.include_router(operating_business.router, prefix="/api", tags=["operating-business"])
app.include_router(account.router, prefix="/api", tags=["account"])


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    # 카카오맵은 HTML에서 sdk.js를 먼저 로드하는 방식이 동적 삽입보다 안정적입니다.
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "kakao_js_key": _kakao_js_key(),
            "google_client_id": _google_client_id(),
        },
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("web_app:app", host="0.0.0.0", port=3288, reload=False)
