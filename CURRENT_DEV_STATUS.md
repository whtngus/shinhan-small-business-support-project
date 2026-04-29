# CURRENT_DEV_STATUS.md

코드베이스 기준 스냅샷(2026-04-29). **소상공인시장진흥공단 상가(상권) 정보 API 추가 연동 전** 구조 파악용 문서이다.

의존 패키지 선언: 루트 `requirements.txt`만 존재한다(`pyproject.toml` 없음). 루트에 `services/` 패키지 폴더는 없고, LLM 리포트는 `app/services/report_service.py`에 있다.

---

## 1. 프로젝트 실행 구조

| 항목 | 내용 |
|------|------|
| **진입점** | `web_app.py` |
| **FastAPI 앱 생성** | `web_app.py`의 `app = FastAPI(...)` |
| **라우터 등록** | `app.include_router(..., prefix="/api", ...)` — 각 `routers/*.py`의 `router`를 **`/api` 접두사**로 포함 (`areas`, `dashboard`, `map_api`, `report`, `recommend`, `external`, `operating_business`, `account`) |
| **정적 파일** | `app.mount("/static", StaticFiles(directory=BASE_DIR / "static"))` |
| **템플릿** | `Jinja2Templates(directory=BASE_DIR / "templates")` — 루트 `/`는 `templates/index.html` |
| **환경변수** | `web_app.py`에서 `load_dotenv(BASE_DIR / ".env")` 한 번 더 호출. `src/config.py`에서도 `load_dotenv()` (프로세스 cwd 기준). `.env.example`에 변수 목록 정리됨 |
| **실행 명령** | `python web_app.py` 시 `uvicorn.run("web_app:app", host="0.0.0.0", port=3288)` 또는<br>`uvicorn web_app:app --host 0.0.0.0 --port 3288` |
| **헬스** | `GET /health` → `{"status":"ok"}` |

**템플릿·정적 경로 요약**

- 템플릿: `templates/index.html`
- 정적: `static/js/`, `static/css/` (버전 쿼리스트링으로 캐시 무효화)

---

## 2. 백엔드 라우터 현황

모든 아래 경로는 **`/api` 접두사가 붙은 실제 URL**이다 (예: `GET /api/districts`).

### routers별 표

| 파일 | Prefix | 주요 API | 입력 파라미터 | 응답 요약 | 사용 화면 | 비고 |
|------|--------|----------|---------------|-----------|-----------|------|
| `areas.py` | `/api` | `GET /districts` | — | 자치구 목록 | 홈 통계, 상권 단계 | |
| | | `GET /dongs` | `district` | 행정동 목록 | 상권 단계 | |
| | | `GET /areas` | `district`, `dong`, `q` | 상권 목록(최대 200) | 상권 선택 | |
| | | `GET /services` | `area_code` | 해당 상권 업종 목록(없으면 전체 병합) | 업종 선택 | `load_area_services_index()` |
| | | `GET /search` | `q` | 상권·업종 자동완성 | 검색 UI | |
| `dashboard.py` | `/api` | **`POST /analysis`** | JSON: `area_code`, `service_name`, `user_type`, 재무 필드 optional | 점수·경고·재무·추이·`shinhan_panels` 등 종합 | 창업 분석 결과 | 핵심 분석 |
| | | `GET /trends` | `area_code`, `service_name` | 매출·점포·개폐업·유동인구 추이 | (직접 호출 가능, 탭은 주로 `analysis` 내장 `trends`) | |
| | | `GET /status` | — | `DATA_PATHS`별 파일 존재 요약 | 진단·운영 도구 | |
| | | `GET /sample-cases` | — | 샘플 케이스 배열 | 홈 샘플 그리드 | |
| | | `GET /sample-case/{case_id}/area` | path `case_id` | 케이스+매칭 상권 | 샘플 실행 | |
| `map_api.py` | `/api` | **`GET /competitors`** | `area_code`, `service_name`, `radius`(기본 500), `lat`, `lon` optional | 중심좌표, 반경별 카운트, 점포 목록, 확장·참고 목록 | 결과 탭 «경쟁점 지도» | 로컬 CSV 기반 |
| `report.py` | `/api` | **`POST /report`** | JSON `ReportRequest`(점수·재무·경고 등) | `source`, `content`(마크다운) | AI 리포트 탭 | Gemini 또는 템플릿 |
| `recommend.py` | `/api` | **`GET /finance-recommendation`** | `area_code`, `service_name` | `values`, `sources`, `notes`, `explanation`, `confidence` | 사업 조건 패널 | 공공데이터+휴리스틱 |
| `external.py` | `/api` | `GET /external-search` | `q` | 카카오 로컬 결과, 상권 매칭, 에러 안내 | 상권 패널 고급 검색, 지도 검색 | `KAKAO_REST_API_KEY` |
| | | `GET /search-meaning` | — | 검색 도움말 JSON | UI 툴팁 | |
| | | `GET /kakao-sdk-check` | — | 서버에서 카카오 SDK URL 접근 가능 여부 | 디버그 | |
| | | `GET /shinhan-loan-rates` | — | 참고 금리·링크(목업 성격) | 자금 탭 등 | 고정 JSON |
| | | **`GET /map-config`** | — | `provider`, `kakao_js_app_key`, `configured`, `rest_configured` | (카카오 키 노출용 후보, 현재 지도 탭은 주로 Leaflet) | JS 키는 서버가 전달 |
| `account.py` | `/api` | `POST /account/login` | `account_id`, `provider`, `account_name` | 계정 생성/확인 | 계정 팝오버 | SQLite |
| | | `POST /account/google-login` | `id_token` | Google 검증 후 계정 | GIS 로그인 | `tokeninfo` + aud 검사 |
| | | `GET/PUT /account/saved-profiles` | Query `account_id` | 저장 프로필 배열 | 내 계정 | |
| | | `GET/PUT /account/history` | Query `account_id` | 분석 이력 | 내 계정 | |
| `operating_business.py` | `/api` | `GET /shinhan/business/connection-status`, `GET .../stores`, `GET .../{store_id}/integrated-profile`, `POST .../operating/analyze`, `POST .../cash-advice`, `GET .../product-gap`, `GET .../insurance-gap`, `POST .../loan-simulation`, `POST .../benchmark-note`, `POST .../action-plan`, `POST .../report/save`, `GET .../financial-check/stores`, `GET .../{id}/financial-profile`, `POST .../financial-check/analyze` 등 | 경로·바디별 상이 | 신한 목업 스토어·진단·금융 체크 | `operating_business.js`, `financial_check.js` | 대량 엔드포인트 |

### 요청하신 API 유형 매핑

| 유형 | 해당 여부 | 실제 endpoint (method) |
|------|-----------|-------------------------|
| 상권/업종 검색 | ✅ | `GET /api/search`, `GET /api/areas`, `GET /api/services`, `GET /api/external-search` |
| 분석 실행 | ✅ | **`POST /api/analysis`** |
| 지도/경쟁점 | ✅ | **`GET /api/competitors`** |
| 금융 추천값 | ✅ | **`GET /api/finance-recommendation`** |
| 신한 서비스 연결 | ✅ | 분석 응답 내 `shinhan_panels` + `GET /api/shinhan-loan-rates`; 운영/금융 플로우는 `/api/shinhan/business/...` 다수 |
| AI 리포트 | ✅ | **`POST /api/report`** |
| 운영 중 사업자 API | ✅ | `/api/shinhan/business/...` (목업 데이터 기반) |
| 금융 점검 API | ✅ | `/api/shinhan/business/.../financial-check/...` |
| 저장/히스토리 | ✅ | `PUT/GET /api/account/saved-profiles`, `.../history` |
| 로그인/인증 | ✅ | `POST /api/account/login`, `POST /api/account/google-login` |

---

## 3. 데이터 로딩 구조

**핵심 파일**: `src/data_loader.py`, 경로 정의 `src/config.py`의 `DATA_PATHS`.

**특징**

- **pandas**: CSV/XLSX 로드, 연도별 CSV `glob` 후 `concat`.
- **DuckDB**: `query_sales_by_area_industry()`에서 대용량 추정매출 `read_csv_auto` 패턴 쿼리.
- **인코딩**: `read_csv_auto`가 utf-8-sig → cp949 → euc-kr → utf-8 순 시도.
- **`@lru_cache(maxsize=1)`**: `load_store_data`, `load_sales_data`, `load_area`, 유동/상주/직장, KOSIS, 임대동향, 소상공인 상가 CSV 등 다수.
- **모듈별 `_C` dict**: `routers/map_api.py`, `recommend.py`, `dashboard.py` 등에서 동일 세션 내 DataFrame 재사용 (`lru_cache`와 병행).
- **좌표/상권**: 상권 영역은 EPSG:5181 컬럼 → `utils/coord_transform.py`의 `convert_area_coords` / `epsg5181_to_wgs84`.
- **소상공인 상가 데이터**: `load_sosnogongdan_seoul()` — `DATA_PATHS["sosnogongdan"]` 아래 **파일명에 `*서울*` 포함 CSV만** 첫 파일 로드 후 컬럼 필터. **HTTP 상가 API 호출 없음**.
- **폴백**: 데이터 없으면 빈 `DataFrame`; 추천 API는 매출 없을 때 자치구 평균 → 최종 합성 점포(`utils/synthetic_data`).

### 데이터 종류 표

| 데이터 종류 | 로딩 함수 | 원본 경로/패턴 | 주요 컬럼(예) | 사용 목적 | 캐시 여부 |
|-------------|-----------|----------------|---------------|-----------|-----------|
| 점포 | `load_store_data` | `DATA_PATHS["store"]/*.csv` 병합 | 상권_코드, 서비스_업종_코드_명, 점포_수, 폐업_률 등 | 분석·추이·업종 목록 | `lru_cache` |
| 추정매출 | `load_sales_data` | `.../추정매출/*.csv` | 당월_매출_금액, 기준_년분기_코드 | 분석·추천 | `lru_cache` |
| 상권 영역 | `load_area` | `.../영역_상권/*.csv` | 상권_코드, 엑스/와이좌표, 자치구·행정동 | 중심좌표·검색 | `lru_cache` |
| 유동·상주·직장 등 | 각 `load_*` | `DATA_PATHS` 해당 폴더 첫 CSV 등 | 총_유동인구_수 등 | 점수·추이 | `lru_cache` |
| 소상공인 상가(로컬) | `load_sosnogongdan_seoul` | `.../소상공인시장진흥공단_상가(상권)정보/*서울*` | 상호명, 업종분류, 위도·경도 등 | **`/api/competitors`** | `lru_cache` |
| KOSIS 생존 | `load_kosis_survival` | 다중 CSV 병합 | — | 생존율 점수 | `lru_cache` |
| 임대동향 | `load_rental_trend` | CSV 우선, 없으면 xlsx 시트 | 지역, 임대료지수 | 추천 임대 보정 | `lru_cache` |
| 데이터 요약 | `get_data_summary` | 각 `DATA_PATHS` 존재·파일 수 | — | 점검 스크립트 | `lru_cache` |

**로컬 `data/` 구조(예시)**: `README`/실제 디렉터리 기준으로 테마별 하위 폴더 + `account_store.db`. 각 폴더에 공공데이터 CSV/XLSX 배치.

---

## 4. 지도/경쟁점 기능 현황

### 요약

| 항목 | 구현 내용 |
|------|-----------|
| **지도 라이브러리** | **Leaflet 1.9.4** (CDN `unpkg.com`). 타일: **CARTO / OSM** 계열 (`basemaps.cartocdn.com`). **카카오 Maps JavaScript SDK는 결과 지도 탭에서 로드하지 않음** (`templates/index.html` 주석 참고). |
| **지도 초기화** | `renderMapTab()` → `ensureLeaflet()` → `drawLeafletMap(data, {initial})` |
| **패널 DOM** | 결과 패널 `#panel-result` 내 `#tab-map`, 지도 컨테이너 `#competitor-map`, 검색 `#map-place-q`, 요약 `#competitor-summary`, 리스트 `#competitor-list` |
| **마커** | `L.circleMarker`로 경쟁점, 중심은 커스텀 `divIcon` 마커 |
| **반경 원** | `L.circle` 300m(파랑)·500m(초록)·1km(빨강), `focusRadius()`로 강조 |
| **반경 UI** | `.dist-btn` 300 / 500 / 1000 지원 |
| **경쟁점 출처** | 서버 **`GET /api/competitors`** → `load_sosnogongdan_seoul()` 로컬 CSV (**실시간 공공 API 아님**) |
| **Haversine** | 백엔드 `routers/map_api.py`의 `_haversine` (numpy). `routers/external.py`에도 별도 `_haversine`(math). |
| **검색** | 지도 탭 내 **`/api/external-search`** (카카오 키 없으면 안내 메시지). 선택 시 `State.customCenter` 갱신 후 `/api/competitors` 재호출 |
| **한계** | 서울 로컬 상가 파일 전제; Leaflet CDN 차단 시 지도 비활성; 카카오 JS 키·`/api/map-config`는 **별 용도(향후/기타)**로 남고 지도 타일은 OSM 계열 |

### 파일별 표

| 파일 | 함수/변수 | 역할 | API 호출 여부 | 비고 |
|------|-----------|------|---------------|------|
| `static/js/app.js` | `renderMapTab`, `drawLeafletMap`, `applyCompetitorDraw` | 지도·마커·원 | ✅ `/api/competitors`, 검색 시 `/api/external-search` | |
| `static/js/app.js` | `preloadMapDuringAnalysis`, `fetchCompetitorsPayload` | 로딩 중 선조회 캐시 | ✅ 동일 | `State.mapPreData` |
| `static/js/app.js` | `destroyMapView` | 탭 전환 시 지도 제거 | — | 중복 초기화 완화 시도 |
| `routers/map_api.py` | `get_competitors` | 경쟁점 산출 | — | 로컬 DF |

---

## 5. 프론트엔드 화면 흐름

**패널 전환**: `goStep(step)` — `panel-{step}` 표시, 스텝퍼 인덱스 갱신.

**패널 id 목록**: `panel-home`, `panel-user-type`, `panel-area`, `panel-finance`, `panel-loading`, `panel-result`, `panel-operating-*`, `panel-financial-*` (각 connect/store/preview/loading/result).

**결과 탭 id**: `tab-overview`, `tab-trend`, `tab-map`, `tab-finance`, `tab-services`, `tab-action-plan`, `tab-report` — 전환 `switchResultTab(target)`, 초기 바인딩 `initResultTabs()`.

| 화면/패널 | HTML id | 렌더링 JS 함수 | 관련 API | 현재 기능 | 추가 개발 포인트 |
|-----------|---------|-----------------|----------|-----------|-------------------|
| 홈 | `panel-home` | `initHomeButtons`, `loadHomeStats` | `GET /districts`, `/services` | 통계·샘플 진입 | |
| 유형 | `panel-user-type` | 카드 선택 핸들러 | — | 유형별 분기 | |
| 상권·업종 | `panel-area` | `loadDistricts`, `onAreaChange`, 외부 검색 | `/districts`, `/dongs`, `/areas`, `/services`, `/external-search` | 드롭다운+고급 검색 | |
| 사업 조건 | `panel-finance` | `initFinanceStep`, `applyRecommendation` | **`GET /finance-recommendation`**, 이후 **`POST /analysis`** | 자동 채우기·미리보기 | |
| 로딩 | `panel-loading` | 분석 파이프라인 | **`POST /analysis`** | | |
| 결과 | `panel-result` | `renderResult`, 탭별 렌더러 | 선조회 `/competitors`, 리포트 `/report` 등 | 7탭 | |
| 운영/금융 전용 | `panel-operating-*`, `panel-financial-*` | `operating_business.js`, `financial_check.js` | `/api/shinhan/business/...` | 별도 플로우 | |

---

## 6. 결과 화면 렌더링 구조

**위치**: `static/js/app.js`.

| 함수 | 위치(대략) | 입력 | DOM/동작 |
|------|------------|------|----------|
| `renderResult(data)` | ~1935행 | 분석 JSON | `renderResultSummary`, `renderScoreGrid`, `renderOverviewTab`, `renderFinanceTab`, `renderServicesTab`; 리포트·추세·액션플랜·지도 탭 내용 비우기; `destroyMapView()`; 탭 active를 overview로 |
| `renderResultSummary(d)` | ~2365행 | 동일 | `#result-summary` |
| `renderScoreGrid(d)` | ~2908행 | 동일 | 점수 카드 그리드 |
| `renderOverviewTab(d)` | ~2965행 | 동일 | 개요 탭 |
| `renderTrendTab()` | ~3033행 async | `State.result.trends`, 필요 시 `ensureRadiusExpansionForTrend` | `#tab-trend`, Chart.js |
| `renderMapTab()` | ~3180행 async | `State.result`, `State.area_code` 등 | `#tab-map`, Leaflet |
| `renderFinanceTab(d)` | ~3809행 | 동일 | `#tab-finance`, 차트 |
| `renderServicesTab(d)` | ~4084행 | `d.shinhan_panels` | `#tab-services` |
| `renderReportTab()` | ~4147행 async | — | `#tab-report`, 버튼으로 `generateReport` |
| `initResultTabs()` | ~1909행 | — | 탭 클릭 → `switchResultTab`; 액션플랜 CTA는 탭 이동 |

`switchResultTab`에서 탭별 지연 로드: `trend`→`renderTrendTab`, `finance`→`drawFinanceCharts`, `map`→`renderMapTab`, `report`→`renderReportTab`, `action-plan`→`renderActionPlanTab`.

---

## 7. 금융 추천값 자동 채우기 기능 현황

| 항목 | 내용 |
|------|------|
| **버튼** | `#btn-recommend` (라벨: 시뮬레이션 기본값 자동 채우기) |
| **설명 영역** | `#recommend-desc` (`applyRecommendation`가 innerHTML 갱신). `#finance-recommendation-explain`은 템플릿에 있으나 클릭 핸들러는 `recommend-desc` 사용 |
| **핸들러** | `applyRecommendation()` |
| **API** | **`GET /api/finance-recommendation?area_code=&service_name=`** |
| **응답 필드** | `values`(각 입력값), `sources`, `notes`, `explanation`, `confidence` 등 (`routers/recommend.py`) |
| **채워지는 입력** | `fin-{키}` id 요소 — `monthly_sales`, `rent`, `labor_cost`, `loan_balance`, `interest_rate`, `monthly_repayment`, `cash_balance`, `own_capital`, `initial_investment`, `cost_ratio`, `misc_*` 등 |
| **재계산** | 입력 필드는 `initFinanceLivePreview`에서 `input`/`change` 시 **`refreshFinanceLivePreview()`** 호출. 분석 실행 전까지 미리보기 갱신 |

**한계**: 서버 추천은 공공 매출·휴리스틱·합성에 의존; 실제 점포와 차이 큼. 사용자가 수정하면 미리보기만 바뀌고 서버 재추천은 버튼 재클릭까지 없음.

---

## 8. 신한 서비스 연결 기능 현황

| 항목 | 내용 |
|------|------|
| **데이터 생성** | **`POST /api/analysis`** 응답 내부에서 `utils/shinhan_service_mock.build_shinhan_panels(...)` |
| **`shinhan_cta_registry.js`** | ✅ 존재 — `window.SHINHAN_CTA_REGISTRY`, 모달 오픈·외부 링크·전화 |
| **`renderServicesTab`** | `shinhan_panels.bank/card/life/investment` 없으면 안내 문구만 |
| **카드 표시** | `renderShinhanPanelCard` — `score`, `level`, `summary`, `products[]`, `diagnosis`, 면책 `disclaimer` |
| **목업 상품군** | `products` 행에 예상 금액·체크 항목 등 표시(코드상 목업) |
| **모달** | `#shinhan-cta-modal` — `shinhan_cta_registry.js`가 `document` 위임으로 `.spr-cta[data-cta-action]` 처리 |
| **CTA** | 데모용 링크·전화; **외부 금융으로 사용자 데이터 자동 전송하는 API는 없음** |
| **금리 박스** | `loadShinhanLoanRates()` → **`GET /api/shinhan-loan-rates`** (참고값 고정 응답에 가까움) |

---

## 9. 설정 및 환경변수 현황

`.env.example`과 `src/config.py` 기준. 실제 비밀값은 코멘트하지 않는다.

| 환경변수 | .env.example 존재 | 사용 위치 | 용도 | 추가 필요 여부 |
|----------|---------------------|-----------|------|----------------|
| `GEMINI_API_KEY` | ✅ | `src/config.py`, `app/services/report_service.py` | Gemini REST | 키 없으면 템플릿 리포트 |
| `GEMINI_MODEL` | ✅ | `report_service` | 모델명 | 선택 |
| `ENABLE_LLM_REPORT` / `ENABLE_RAG` | ✅ | `src/config.py` | 기능 플래그 | |
| `DATA_DIR` / `DUCKDB_PATH` | ✅ | `src/config.py` | 데이터·DuckDB 경로 | |
| `DEFAULT_REGION` 등 | ✅ | `src/config.py` | 기본 분석 파라미터 | |
| `FRONTEND_API_BASE_URL` | ✅ | (프론트 베이스 URL 안내용) | 문서/연동 참고 | |
| `MAP_PROVIDER` | ✅ | `external.map_config` | 문자열 반환 | |
| `KAKAO_JAVA_SCRIPT_KEY` / `KAKAO_MAP_APP_KEY`(호환) | ✅ | `web_app.py`, `external.py` | 브라우저 SDK용 키 전달 가능성 | 지도 탭은 Leaflet이라 **미사용에 가까움** |
| `KAKAO_REST_API_KEY` | ✅ | `external.py` | 로컬 키워드 검색 | |
| `GOOGLE_CLIENT_ID` | ✅ | `web_app.py`, `account.google_login` | GIS 로그인 | |
| **`NAVER_MAP_CLIENT_ID`** | ❌ | — | — | **추가 필요**(사용 계획 시) |
| **`PUBLIC_DATA_SERVICE_KEY`** | ❌ | — | — | **추가 필요**(공공포털 API 연동 시) |
| **`SBDC_API_BASE_URL`** 등 소상공인 API | ❌ | — | — | **추가 필요** |
| **`API_CACHE_TTL_HOURS`** | ❌ | — | — | **추가 필요** |
| **`API_DAILY_CALL_LIMIT`** | ❌ | — | — | **추가 필요** |
| **`API_TIMEOUT_SECONDS`** | ❌ (전역 상수만: 카카오 4초, Gemini 30초 등) | — | — | 통합 설정으로는 **추가 필요** |

---

## 10. 외부 API 연동 현황

| API | 연동 여부 | 키 관리 | 호출 위치 | 캐시 여부 | 비고 |
|-----|-----------|---------|-----------|-----------|------|
| **Gemini** | ✅ (선택) | `GEMINI_API_KEY` 환경변수 | `app/services/report_service.call_gemini` | ❌ 호출별 | 실패 시 빈 문자열 → 템플릿 |
| **Kakao Local** | ✅ (선택) | `KAKAO_REST_API_KEY` | `routers/external.py` | ❌ | timeout 4초 |
| **Kakao Maps JS** | 설정만 (`/api/map-config`) | JS 키 `.env` | `external.map_config` | — | **결과 지도는 Leaflet** |
| **Naver Map** | ❌ | — | — | — | |
| **Google Login** | ✅ | `GOOGLE_CLIENT_ID` | `account.google_login` → tokeninfo | — | |
| **공공데이터 포털 실시간 API** | ❌ | — | — | — | 파일 다운로드 전제 |
| **소상공인365** | ❌ | 링크만 UI | — | — | |
| **소상공인진흥공단 상가 OpenAPI** | ❌ | — | — | — | **로컬 CSV만 사용** |

---

## 11. 캐시/호출량 제한 구조

**있음**

- Python **`functools.lru_cache`** (`data_loader`, `areas`의 `_area` 등).
- 라우터별 **모듈 전역 `_C` dict**로 DataFrame 캐시.
- 프론트 **`State.mapPreData`** 등 경쟁점 선조회 재사용.

**없음/미흡**

- 외부 API용 **TTL 캐시**, **일일 호출 카운터**, **통합 rate limit** 레이어.
- 재시도 로직은 카카오/Gemini에 일관되게 적용되지 않음(예외 시 빈 결과·에러 메시지 위주).

**제안**: 새 공공 API 연동 시 — 키별 **디스크 또는 SQLite 캐시**, 키는 `(endpoint, normalized_params)`, **TTL**, **일일 카운터**(파일 또는 DB), 타임아웃·재시도 공통 래퍼.

---

## 12. 소상공인시장진흥공단 상가 API 연동 적합성 평가

1. **라우터**: `routers/map_api.py`에 경쟁점 관련 엔드포인트를 확장하거나 `routers/sbiz_store.py` 신설 후 `web_app.py`에 `include_router` — **관심사 분리 시 신규 파일**이 유지보수에 유리.
2. **클라이언트**: 루트 `services/` 대신 **`src/sbiz_client.py` 또는 `services/sbiz_api.py` 패키지 신설** 후 환경변수에서 base URL·키 로드 — 현재 관례와 맞음.
3. **UI 버튼**: `renderMapTab()`이 만드는 **`map-toolbar` 또는 `competitor-side` 상단**(반경 필터 옆)에 «최신 경쟁점 조회» 배치 시 흐름이 자연스럽다.
4. **병합**: 서버에서 로컬 DF와 API 응답을 **통합 레코드 스키마**(상호, 좌표, 업종, 거리, `source: local|api`)로 만든 뒤 중복 키(상가번호 등) 제거.
5. **스키마**: 프론트는 이미 `stores[]` + `위도`/`경도`/`상호명`/업종 필드를 기대 — **`map_api` 응답에 필드를 추가**하고 클라이언트는 알 수 없는 필드는 무시 가능.
6. **캐시**: **`src`** 쪽 작은 모듈 + 파일/SQLite 또는 TTL dict — 라우터는 얇게 유지.
7. **호출량**: **미들웨어 또는 클라이언트 래퍼 단일 진입점**에서 카운터·차단.
8. **Fallback**: API 실패 시 **`load_sosnogongdan_seoul()` 결과만 반환**하고 `expansion.hints`에 안내 메시지.

---

## 13. 추가 개발 전 확인해야 할 위험 요소

- **`_haversine` 중복 정의** (`map_api` vs `external`) — 유지보수 시 불일치 위험.
- **지도 이중 초기화**: `destroyMapView` + 탭 재진입 시 `renderMapTab` 전체 재구성 — Leaflet 인스턴스 누수 가능성은 코멘트대로 try/catch로 완화했으나 CDN 실패 시 분기 많음.
- **fetch 에러**: `fetchJson` 공통 처리 수준에 따라 사용자 메시지가 제각각일 수 있음.
- **한글 인코딩**: `read_csv_auto`가 있으나 이상 파일은 여전히 깨질 수 있음.
- **좌표계**: 상권 중심은 EPSG:5181 변환; API가 다른 좌표계면 변환 필요.
- **페이지네이션**: 상가 API 도입 시 목록·대량 응답 설계 필요(현재 로컬 데이터는 상한 500 등 코드 내 제한).
- **API 키**: JS 키는 `/map-config`로 노출 가능 — **프론트에 줄 필요 최소화** 원칙 유지.
- **호출량**: 공공 API 도입 시 현재는 **제한 장치 없음**.

---

## 14. 소상공인 API 추가 개발을 위한 권장 작업 순서 (10단계)

1. `.env.example`에 **`PUBLIC_DATA_SERVICE_KEY` 또는 SBIZ 전용 키·BASE_URL** 초안 추가.
2. **`src/sbiz_client.py`**(이름 가칭)에서 인증·timeout·에러 매핑 구현.
3. **`routers/map_api.py`**에 `GET /competitors` 병합 로직 또는 **`GET /competitors/live`** 추가.
4. **캐시 유틸**(TTL + 일일 카운터) 추가.
5. **Haversine·거리 필터**를 `utils/geo.py` 등으로 공통화.
6. **`renderMapTab`**: 툴바에 «최신 경쟁점 조회» 버튼 및 로딩 상태.
7. 버튼 클릭 시 신규 API → 응답으로 **`applyCompetitorDraw` 재사용 가능한 형태**로 전달.
8. 입지 카드 `buildMapInsightCardHtml`는 필요 시 API 메타만 추가.
9. 실패 시 **`load_sosnogongdan_seoul`만** 사용하는 폴백 + 사용자 안내.
10. **`README.md`** 및 환경변수 설명 갱신.

---

## 15. 최종 요약

### 현재 구현 상태 한 줄 요약

FastAPI **`/api`** 하에 공공 CSV 기반 상권 분석·경쟁점(로컬 소상공인 상가)·금융 추천·Gemini 선택 리포트·카카오 선택 검색·신한 목업 패널이 연결된 **단일 페이지 Jinja2 PoC**이다.

### 소상공인 API 연동 난이도

**보통** — 경쟁점 파이프라인(`map_api` + `renderMapTab`)과 데이터 폴더가 이미 있으나, **실시간 API·쿼터·캐시·좌표/업종 매핑**을 새로 설계해야 한다.

### 가장 먼저 수정해야 할 파일 Top 5

1. `web_app.py` — 새 라우터 등록  
2. `routers/map_api.py` — 경쟁점 소스 병합 지점  
3. `src/config.py` / `.env.example` — 키·URL  
4. `static/js/app.js` — 지도 탭 버튼·호출  
5. 신규 **`src/sbiz_client.py`** (또는 동등 서비스 모듈)

### API 연동 시 반드시 지켜야 할 원칙

- API Key 하드코딩 금지  
- 기본 분석은 로컬 데이터 유지  
- 외부 API는 최신 경쟁점 보강용  
- 동일 조건 캐시  
- 호출량 일일 제한  
- 실패 시 로컬 fallback  
- 금융상품 확정 추천 표현 금지  
