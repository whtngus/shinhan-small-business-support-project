# DEVELOPMENT PLAN

이 문서는 **현재 코드 구조를 기준으로 한 분석/개발 계획서**입니다.  
요청하신 대로 **코드 수정 없이** 현재 상태를 정리하고, 다음 개발 목표를 작업 항목으로 분해했습니다.

---

## 0) 프로젝트 구조 요약

이 프로젝트는 **FastAPI 백엔드 + Jinja2 단일 페이지 프론트엔드** 구조입니다.

- 엔트리/라우팅: `web_app.py`
- 단일 페이지 템플릿: `templates/index.html`
- 공통 프론트 로직: `static/js/app.js`
- 운영 매장 진단 플로우: `static/js/operating_business.js`
- 금융 점검 플로우: `static/js/financial_check.js`
- 신한 CTA 모달 레지스트리: `static/js/shinhan_cta_registry.js`
- API 라우터: `routers/*.py`
- 점수 계산 엔진: `src/risk_engine.py`
- 데이터 로더: `src/data_loader.py`

---

## 1) 현재 화면 패널 목록

기준 파일: `templates/index.html`

### 공통/메인
- `panel-home` : 홈
- `panel-user-type` : 사용자 유형 선택
- `panel-area` : 지역·상권·업종
- `panel-finance` : 사업 조건 입력
- `panel-loading` : 공통 분석 로딩
- `panel-result` : 공통 결과(상권 요약/추세/지도/자금/신한/리포트 탭)

### 운영 매장 진단 전용
- `panel-operating-connect`
- `panel-operating-store`
- `panel-operating-preview`
- `panel-operating-loading`
- `panel-operating-result`

### 금융 점검 전용
- `panel-financial-connect`
- `panel-financial-store`
- `panel-financial-preview`
- `panel-financial-loading`
- `panel-financial-result`

### 공통 상태 전환 함수
- `static/js/app.js`의 `goStep(step)` 에서 패널 노출 제어

---

## 2) 창업/상권 분석 흐름

### 사용자 흐름
1. 홈(`panel-home`) → `start-create`
2. 유형 선택(`panel-user-type`)에서 주로 `창업 예정자`
3. 지역·상권·업종(`panel-area`)
4. 사업 조건(`panel-finance`)  
   - AI 추천값 채우기  
   - 간편/상세/샘플 모드  
   - 건너뛰기 가능
5. 분석 로딩(`panel-loading`)
6. 결과(`panel-result`)

### 코드 진입점
- `static/js/app.js`
  - `initHomeButtons()`
  - `initUserTypeStep()`
  - `initAreaStep()`
  - `initFinanceStep()`
  - `runAnalysis()` / `runAnalysisSkip()`
  - `executeAnalysisPipeline()`
  - `analyzeNow()` → `POST /api/analysis`

### 주요 API
- `POST /api/analysis` (`routers/dashboard.py`의 `full_analysis`)
- `GET /api/finance-recommendation` (`routers/recommend.py`)
- `GET /api/districts`, `/api/areas`, `/api/services` (`routers/areas.py`)

---

## 3) 운영 매장 진단 흐름

### 사용자 흐름
1. 운영 진단 시작(홈 버튼 또는 계정 빠른 진입)
2. 동의(`panel-operating-connect`)
3. 사업장 선택(`panel-operating-store`)
4. 미리보기/추가입력(`panel-operating-preview`)
5. 로딩(`panel-operating-loading`)
6. 결과(`panel-operating-result`, 탭 10종)

### 코드 위치
- `static/js/operating_business.js`
  - 진입: `openStoreList()`, `selectStore()`
  - 미리보기: `renderPreview*` 계열
  - 분석 실행: `analyze()`
  - 결과: `renderTop()`, `renderTab(tab)`
  - 30일 플랜/리포트 저장 호출 포함

### 주요 API
- `/api/shinhan/business/stores`
- `/api/shinhan/business/{store_id}/integrated-profile`
- `/api/shinhan/business/{store_id}/operating/analyze`
- `/api/shinhan/business/{store_id}/action-plan`
- `/api/shinhan/business/{store_id}/report/save`
- (상세 하위 탭용 API 다수: cash-advice, loan-simulation, insurance-gap, benchmark-note 등)

---

## 4) 금융 점검 흐름

### 사용자 흐름
1. 금융 점검 시작(홈 버튼 또는 계정 빠른 진입)
2. 동의(`panel-financial-connect`)
3. 사업장 선택(`panel-financial-store`)
4. 미리보기/최소입력(`panel-financial-preview`)
5. 로딩(`panel-financial-loading`)
6. 결과(`panel-financial-result`, 탭 9종)

### 코드 위치
- `static/js/financial_check.js`
  - 진입: `openStoreList()`, `selectStore()`
  - 미리보기: `renderPreview()`
  - 분석 실행: `analyze()`
  - 결과 상단: `renderTop()`
  - 탭 렌더: `renderTab(tab)` (cash/cashflow/loan/card/insurance/stress/products/plan)

### 주요 API
- `/api/shinhan/business/financial-check/stores`
- `/api/shinhan/business/{store_id}/financial-profile`
- `/api/shinhan/business/{store_id}/financial-check/analyze`
- `/api/shinhan/business/{store_id}/financial-check/*` (cash-advice, cashflow-calendar, loan-simulation, card-spending, insurance-gap, stress-test, action-plan, report/save)

---

## 5) 결과 화면에서 데이터를 렌더링하는 함수 위치

기준 파일: `static/js/app.js`

### 공통 결과 오케스트레이션
- `renderResult(data)`  
  - 내부 호출:  
    - `renderResultSummary(data)`  
    - `renderScoreGrid(data)`  
    - `renderOverviewTab(data)`  
    - `renderFinanceTab(data)`  
    - `renderServicesTab(data)`

### 결과 탭 전환
- `initResultTabs()`  
  - `trend` 탭: `renderTrendTab()`  
  - `map` 탭: `renderMapTab()`  
  - `report` 탭: `renderReportTab()`

### 세부 렌더
- 상단 요약: `renderResultSummary()`
- 점수 카드: `renderScoreGrid()`
- 상권 요약 탭: `renderOverviewTab()`
- 자금·손익 탭: `renderFinanceTab()`, `drawFinanceCharts()`
- 신한 서비스 탭: `renderServicesTab()`
- AI 리포트 탭: `renderReportTab()`, `generateReport()`

---

## 6) 점수 계산 함수 위치

### 핵심 엔진
- `src/risk_engine.py`

### 세부 점수(8개)
- `score_commercial_attraction()`
- `score_sales_growth()`
- `score_competition()`
- `score_population_fit()`
- `score_store_ecosystem()`
- `score_industry_survival()`
- `score_rent_burden()`
- `score_debt_resilience()`

### 신한 연결 점수(4개)
- `score_shinhan_bank()`
- `score_shinhan_card()`
- `score_shinhan_life()`
- `score_shinhan_growth()`

### 최종 점수
- `calc_final_score(scores, user_type)`
- `calc_all_scores(...)` (전체 조합 진입점)
- 조기경보: `detect_early_warning(...)`

### API 연결
- `routers/dashboard.py`의 `full_analysis()`에서 `calc_all_scores()` 호출

---

## 7) 신한 서비스 연결 카드 렌더링 위치

### 공통 결과 탭(창업/상권 결과 안)
- 파일: `static/js/app.js`
- 렌더 함수:
  - `renderServicesTab(d)` : 탭 전체 렌더
  - `renderShinhanPanelCard(key, panel)` : 은행/카드/라이프/투자 카드
  - `renderBankProductRow()`
  - `renderCardLifeProductRow()`
  - `renderInvestProductRow()`

### 데이터 생성
- `utils/shinhan_service_mock.py`의 `build_shinhan_panels(...)`
- `routers/dashboard.py`의 `full_analysis()`에서 결과 JSON에 포함

### CTA 모달
- `static/js/shinhan_cta_registry.js` (버튼 액션별 안내·체크리스트)

---

## 8) AI 리포트 호출 위치

### 프론트
- 파일: `static/js/app.js`
- 함수:
  - `renderReportTab()` : 버튼 렌더 및 클릭 바인딩
  - `generateReport()` : `POST /api/report` 호출

### 백엔드
- 파일: `routers/report.py` (`/api/report`)
- 실제 생성 서비스: `app/services/report_service.py`

---

## 9) 앞으로 개발할 작업 목록 (목표 중심)

이번 목표: **기능 추가 자체보다, 고객 의사결정 정보의 명확성 강화**

아래는 요청하신 개선 방향을 실제 작업 단위로 나눈 계획입니다.

### Phase 1. 결과 상단 의사결정 요약 강화 (가장 우선)
1. 결과 상단에 **한 문장 결론** 추가  
   - 위치: `renderResultSummary()`  
   - 로직: 점수/경고/손익분기/현금보유개월 기반 규칙 문장
2. **핵심 숫자 3개 카드** 고정 노출  
   - 예: 손익분기 매출, 추정 필요 조달액, 현금 버팀 개월
3. **주의 요인 Top 3 / 기회 요인 Top 3** 블록 추가  
   - 근거 소스: `scores`, `warnings`, 추이 데이터

### Phase 2. 근거 투명성 강화
4. 각 점수별 **“왜 이 점수인가?” 근거 보기** 표준화  
   - 현재 툴팁(`buildScoreTooltipBody`)을 확장해 입력값·상권값·계산식 분리 표시
5. 사업 조건 추천값의 **산식/근거 패널** 추가  
   - 소스: `routers/recommend.py`의 `sources`, `notes`  
   - UX: 추천값 옆 “산식 보기” 드로어 또는 모달

### Phase 3. 실행 전환 강화
6. 공통 결과 탭에 **30일 실행 플랜** 추가  
   - 기존 운영/금융 플랜 패턴 재사용  
   - 창업/상권 분석용 플랜 API(신규) 또는 프론트 룰 기반 생성(1차)
7. **후보 상권 비교 기능** 추가  
   - 비교 대상 2~3개 상권 선택 → 핵심 지표/리스크/기회 비교 테이블

### Phase 4. 상담/사후관리 경험 강화
8. 신한 서비스 연결을 **상담 준비자료 중심**으로 개편  
   - 현재 “상품 후보” 중심 → “준비서류/확인포인트/질문체크리스트” 중심
9. **지속 관리 대시보드 목업** 추가  
   - 월별 KPI 추적(매출/지출/현금버퍼/경고)
10. **조기경보 알림 목업** 추가  
    - `detect_early_warning` 결과를 타임라인/알림센터 UI로 시각화

---

## 실행 우선순위 제안

- Sprint 1: Phase 1 + Phase 2 일부(요약/Top3/근거 노출)
- Sprint 2: Phase 2 잔여 + Phase 3(추천 산식/실행플랜/상권비교)
- Sprint 3: Phase 4(상담 준비자료/지속관리/조기경보 목업)

---

## 참고

- 현재 코드베이스는 이미  
  - 점수 산출 엔진,  
  - 점수 툴팁,  
  - 자금 시뮬레이션,  
  - 운영/금융 플랜,  
  - 신한 상담 후보 UI  
  를 갖추고 있어, 다음 단계는 **정보 구조 재배치 + 근거 표시 강화**가 핵심입니다.

