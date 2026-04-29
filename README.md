# 신한 자영업 경영지원 컨설팅 — 개발·기획용 README

이 문서는 **현재 저장소에 구현된 화면·버튼·흐름·API·데이터**를 코드 기준으로 정리한 문서입니다.  
화면 및 서비스 구체화 기획(PPT·기획서) 작성 시 “무엇이 이미 있는지”를 한곳에서 확인할 수 있도록 구성했습니다.

**주요 코드 위치**: `web_app.py`, `templates/index.html`, `static/js/app.js`, `static/js/map_explorer.js`, `static/js/operating_business.js`, `static/js/financial_check.js`, `static/js/shinhan_cta_registry.js`, `routers/*.py`, `src/risk_engine.py`, `src/data_loader.py`

---

## 1. 서비스 한 줄 정의

- 공공데이터 기반 **단계형 상권·재무 컨설팅** 웹 PoC.
- **창업/상권 분석**(위저드)과 **운영 매장 진단**, **금융 점검**(신한 목업 데이터 연동) 세 갈래가 한 앱에 통합되어 있습니다.
- **계정**: Google 로그인만 지원(GIS `id_token` → 서버 검증). 저장 프로필·조회 이력은 브라우저 `localStorage` + 서버 SQLite 동기화.

---

## 2. 기술 구조 (구현 기준)

| 구분 | 내용 |
|------|------|
| 백엔드 | FastAPI (`web_app.py`), 라우터 prefix `/api` |
| 프론트 | Jinja2 단일 페이지 `templates/index.html`, 단계 전환은 패널 `display` 토글 (`static/js/app.js`) |
| 차트 | Chart.js (CDN) |
| 상권 분석 지도 탭 | **Leaflet + OpenStreetMap** (`app.js`에서 CDN 로드, 경쟁점 API `/api/competitors`) |
| 상권 고급 검색 | 카카오 로컬 검색 API (`/api/external-search`), 결과 위치를 공공 상권과 매칭 |
| 계정 | Google Identity Services, `POST /api/account/google-login`, SQLite `data/account_store.db` |
| 환경 변수 | `.env` — 예: `GOOGLE_CLIENT_ID`, 카카오맵/검색용 키(서버가 `map-config` 등으로 프론트에 전달 가능) |

---

## 지도 기반 상권 탐색

- 홈에서 **「지도 기반으로 상권 보기」**(미리보기 카드 포함)로 **`panel-map-explorer`(지도 기반 탐색 전용 패널)** 에 들어갈 수 있습니다.
- **지도 클릭만으로는 분석·결과 화면으로 이동하지 않습니다.** 반경 원·마커·요약 대시보드만 갱신되며, **「창업 컨설팅 시작」「운영 진단」「상세 조건 입력」류 버튼**을 눌렀을 때만 기존 창업·운영·금융 진단 플로우로 연결됩니다.
- 주변 점포·경쟁 강도·업종 Top 5·상권 후보 비교는 **`GET /api/map-explorer/nearby-stores`** 가 로컬 상가 CSV 등으로 계산합니다. 외부 공공데이터 **실시간** OpenAPI 호출은 하지 않습니다.
- 장소 검색은 서버에 **`KAKAO_REST_API_KEY`** 가 있을 때 **`GET /api/external-search`** 로 보조합니다.
- **카카오맵**: `.env` 에 **`KAKAO_JAVA_SCRIPT_KEY`** (또는 호환 **`KAKAO_MAP_APP_KEY`**) 가 있고 `MAP_PROVIDER` 가 `auto` 또는 `kakao` 이면 브라우저에서 카카오맵 SDK를 시도합니다. 로드 실패 시 조용히 **Leaflet/OSM(Carto Voyager)** 로 전환합니다. `MAP_PROVIDER=leaflet` 이면 카카오맵을 쓰지 않습니다.
- 사업 조건 입력 화면(`panel-finance`) 상단에는 지도에서 넘어온 경우 **선택 상권·업종·반경·경쟁 강도 요약 배너**(`#finance-map-selection-banner`)가 표시될 수 있습니다.
- **결과 화면의 경쟁점 지도 탭**은 기존 Leaflet·`/api/competitors` 경로를 유지하며, 이번 탐색 패널과 코드 경로가 분리되어 있습니다.
- 운영 단계에서는 공공데이터 API 또는 내부 데이터 플랫폼과 연결해 동일 패턴으로 자동 갱신할 수 있습니다.

### 테스트 체크리스트

1. 홈에서 지도 기반 보기 진입  
2. 지도 클릭  
3. **바로 결과 화면으로 이동하지 않는지** 확인  
4. 선택 마커와 반경 원(300m / 500m / 1km) 표시 확인  
5. 지도 아래 간단 대시보드 갱신 확인  
6. 주변 상권 후보 카드 표시 확인(카드 클릭 시 상권 중심으로 지도·요약 갱신, 전체 분석 화면 미이동)  
7. 업종 필터 변경 시 점포 마커와 통계 갱신 확인  
8. 「상세 컨설팅 시작」류 버튼 클릭  
9. 기존 조건 입력 화면으로 이동 및 상단 요약 배너 확인  
10. 분석 완료 후 결과 화면 **경쟁점 지도** 탭 정상 동작 확인  

---

## 3. 글로벌 UI (모든 화면 공통)

### 3.1 상단 헤더 (`header.app-header`)

| 요소 | 동작·설명 |
|------|-----------|
| 브랜드 영역 | 타이틀: 「자영업 경영지원 컨설팅」, 부제: 「공공데이터 기반 단계형 진단 · PoC」 |
| **홈** (`data-jump="home"`) | 단계를 `home`으로 전환 |
| **최근 분석 결과** (`data-jump="result"`) | 단계를 공통 결과 패널 `result`로 이동 (마지막 분석 결과가 있을 때 활용) |
| **로그인 · 내 계정** (`#btn-account-panel`) | 계정 팝오버 토글 |
| **v2 · 데모** | 버전 태그 |

### 3.2 계정 팝오버 (`#account-popover`)

| 영역 | 버튼·내용 |
|------|-----------|
| 제목 | 「Google 로그인」— 저장된 분석 조건·조회 이력 불러오기 안내 |
| GIS 버튼 영역 | `#google-login-button` (Google 공식 렌더 버튼) |
| **로그아웃** | 세션 로컬 삭제, GIS `disableAutoSelect` 시도 |
| 빠른 실행 | **운영 매장 진단 바로가기** (`#btn-quick-operating`), **금융 점검 바로가기** (`#btn-quick-financial`) — 로그인 필요 시 알림 |
| 상태 | `#account-status` — 미로그인 / 로그인 사용자명·저장 건수 |
| 저장 목록 | `#saved-profiles` — 「내 정보 저장」으로 쌓인 스냅샷 불러오기/삭제 |
| 이력 | `#account-history` — 분석 조회 이력, 대시보드 열기·즐겨찾기·삭제·메모 |

### 3.3 단계 표시줄 (`#stepper`)

위저드형 화면(`user-type` ~ `result` 계열)에서만 표시. 단계:  
**1 사용자 유형 → 2 지역·상권·업종 → 3 사업 조건 입력 → 4 분석 진행 → 5 결과 컨설팅**

(운영·금융 전용 패널은 별도 단계 인덱스로 매핑되어 동일 스텝 퍼에 표시.)

### 3.4 신한 CTA 모달 (`#shinhan-cta-modal`)

「신한 서비스 연결」 등에서 상품군별 공식 사이트·체크리스트·전화 등을 띄우는 공통 모달 (`shinhan_cta_registry.js`).

---

## 4. 화면(패널) 목록과 역할

앱은 **한 HTML 내 여러 `section.panel`** 을 `goStep(step)`으로 보였다 숨겼다 합니다.

| `panel-*` id | 화면명 | 요약 |
|--------------|--------|------|
| `panel-home` | 홈 | 히어로 CTA, 특징 카드, 샘플 리포트 영역, 면책 문구 |
| `panel-user-type` | 사용자 유형 선택 | 창업 예정자 / 운영 중인 사업자 / 금융 점검 카드 |
| `panel-area` | 지역·상권·업종 | 자치구·행정동·상권·업종 선택 + 카카오 고급 검색 |
| `panel-finance` | 사업 조건 입력 | 간편/상세/샘플 탭, AI 추천값, 미리보기 차트, 분석 시작 |
| `panel-loading` | 공통 분석 로딩 | 공공데이터·입력 조건 기반 분석 중 메시지 |
| `panel-result` | 창업·상권 분석 결과 | 종합 요약, 지표 카드, 탭 6종 |
| `panel-operating-connect` | 운영 진단 동의 | 신한 데이터 연결 체크박스·목업 진입 |
| `panel-operating-store` | 운영 사업장 선택 | 목업 매장 목록 |
| `panel-operating-preview` | 운영 미리보기·추가 입력 | 고민·비교 범위 등 |
| `panel-operating-loading` | 운영 분석 로딩 | 체크 리스트형 진행 문구 |
| `panel-operating-result` | 운영 진단 결과 | 탭 10종 |
| `panel-financial-connect` | 금융 점검 동의 | 동의 체크·목업 |
| `panel-financial-store` | 금융 사업장 선택 | 목업 목록 |
| `panel-financial-preview` | 금융 미리보기 | 추가 선택 항목 |
| `panel-financial-loading` | 금융 분석 로딩 | |
| `panel-financial-result` | 금융 점검 결과 | 탭 9종 |

---

## 5. 화면별 버튼·입력 상세

### 5.1 홈 (`panel-home`)

**히어로 액션**

| 버튼 문구 | `data-action` | 동작 요약 |
|-----------|----------------|-----------|
| 창업 컨설팅 시작하기 | `start-create` | 사용자 유형 초기화 후 `user-type` 단계로 이동 |
| 운영 매장 진단하기 | `start-operate` | 로그인+모달 함수 있으면 매장 선택 모달, 아니면 상권 위저드 진입(`user-type`) |
| 금융 점검하기 | `start-financial` | `quickGoFinancial` — 로그인 후 금융 플로우 또는 알림 |
| 샘플 리포트 보기 | `open-samples` | `/api/sample-cases` 로 카드 그리드 표시, 케이스 선택 시 샘플 분석 실행 |

**히어로 통계**: 분석 가능 상권 수·업종 수(API 로드), 기준 기간·데이터 출처 문구 고정.

**하단 그리드**: 01~04 특징 카드(상권 진단, 창업·운영 적합도, 자금 시뮬, 신한 연결).

**면책**: PoC·합성 데이터·실제 심사 필요 안내.

---

### 5.2 사용자 유형 (`panel-user-type`)

| 카드 | `data-type` | 설명 카피 요지 |
|------|-------------|----------------|
| 창업 예정자 | `창업 예정자` | 입지·예상 매출·경쟁·자금 |
| 운영 중인 사업자 | `운영 중인 사업자` | 상권 대비·매출·고정비·카드·보험 |
| 금융 점검 | `금융 점검` | 계좌·카드·대출·보험 묶음 안내 |

**하단**: 이전(`home`), 다음(`#btn-next-1`, 유형 선택 후 활성화).

---

### 5.3 지역·상권·업종 (`panel-area`)

**폼**

- `sel-district` 자치구, `sel-dong` 행정동, `inp-area-q` 상권 검색, `sel-area` 상권, `sel-service` 업종.
- 검색 도움말 `?`, 칩 예시(강남 카페 등).

**고급 검색 카드**

- 「고급 검색 열기」 `btn-toggle-external` — 카카오 로컬 검색 영역 펼침.
- `inp-external-q` + 「검색」 `btn-external-search`.
- 좌: 카카오 점포 목록, 우: 매칭된 공공 상권 목록.

**하단**: 이전(`user-type`), 다음(`#btn-next-2` — 조건 충족 시).

---

### 5.4 사업 조건 입력 (`panel-finance`)

**상단 바**: 「AI 추천값 자동 채우기」 `#btn-recommend` — `/api/finance-recommendation` 등 활용.

**모드 탭**: 간편 입력 / 상세 입력 / 샘플 점포로 체험.

**입력 필드**(일부는 상세 모드만): 월 매출, 임대료, 인건비, 대출 잔액, 현금, 자기자본, 기타 비용, 금리·월 상환·초기 투자·원가율 등.

**미리보기 구역** `#finance-live-preview`: KPI, 두 개 차트(canvas `fin-live-chart-gap`, `fin-live-chart-monthly`), 신한 금리 박스 `#shinhan-rate-box`.

**하단**

| 버튼 | id | 동작 |
|------|-----|------|
| 이전 | `data-go="area"` | |
| 내 정보 저장 | `btn-save-profile` | 로그인 필요, 로컬+서버 저장 |
| 조건 입력 건너뛰기 | `btn-skip-finance` | 기본값으로 분석 진행 |
| 분석 시작 | `btn-analyze` | 로딩 후 `/api/analysis` 등 호출·결과 표시 |

---

### 5.5 공통 분석 로딩 (`panel-loading`)

진행 체크 문구: 추정매출, 점포, 유동인구, 집객시설, 상권변화, 생존율, 경쟁점, 임대료, 입력 조건 등.

---

### 5.6 창업·상권 결과 (`panel-result`)

**상단** `#result-summary`, **지표 카드** `#score-grid**.

**탭**

| 탭 | `data-tab` | 내용 성격 |
|----|------------|-----------|
| 상권 요약 | `overview` | |
| 매출·점포 추이 | `trend` | |
| 경쟁점 지도 | `map` | Leaflet 지도, 반경·타일 전환 등 |
| 자금·손익분기점 | `finance` | |
| 신한 서비스 연결 | `services` | 진단 점수·CTA |
| AI 리포트 | `report` | `/api/report` 연계 |

**하단**: 「조건 다시 입력」(`finance`), 「처음으로」(`home`).

---

### 5.7 운영 매장 진단 (연속 화면)

**동의** (`panel-operating-connect`): 신한카드·은행·보험 등 체크박스.

| 버튼 | id | 요약 |
|------|-----|------|
| 이전 | `user-type` | |
| 일부만 연결하기 | `op-btn-connect-partial` | JS에서 처리 |
| 목업 데이터로 체험하기 | `op-btn-connect-mock` | |
| 전체 동의하고 자동 진단 시작 | `op-btn-connect-all` | |

**사업장 선택** (`panel-operating-store`): `#op-store-list`, 이전만(`operating-connect`).

**미리보기** (`panel-operating-preview`): `#op-preview-wrap`, 추가 폼(고민·타금융 대출·보험·지출 계획·비교 상권 범위).

| 버튼 | id |
|------|-----|
| 이전 | `operating-store` |
| AI 경영진단 시작 | `op-btn-analyze` |

**로딩** (`panel-operating-loading`): 매출·상권·승인·지출·현금흐름·대출·보험·가용금액·실행 플랜 등 문구.

**결과** (`panel-operating-result`): `#op-result-top`, 탭 `#op-tab-content`.

탭 이름: 종합 요약, 매출/상권 비교, 카드 지출 분석, 은행 현금흐름, 대출/이자 점검, 보험 보장 점검, 사용 가능 금액, 추천 상품군, 주변 매장 벤치마킹, 30일 실행 플랜.

하단: 「홈으로」, 「리포트 저장」`op-btn-save-report`.

---

### 5.8 금융 점검 (연속 화면)

**동의** (`panel-financial-connect`)

| 버튼 | id |
|------|-----|
| 이전 | `user-type` |
| 일부만 연결하기 | `fc-btn-partial` |
| 목업 데이터로 체험하기 | `fc-btn-mock` |
| 전체 동의하고 금융 점검 시작 | `fc-btn-all` |

**사업장** (`panel-financial-store`): `#fc-store-list`.

**미리보기** (`panel-financial-preview`): `#fc-preview-wrap`, 고민·외부 대출/보험·지출·이번 달 사용 금액·목적 등.

| 버튼 | id |
|------|-----|
| 이전 | `financial-store` |
| AI 금융 점검 시작 | `fc-btn-analyze` |

**로딩** (`panel-financial-loading`): 계좌·지출·가용금액·현금 부족 일·대출·카드·보험·스트레스 테스트·개선 플랜 등.

**결과** (`panel-financial-result`): `#fc-result-top`, `#fc-tab-content`.

탭: 종합 요약, 사용 가능 금액, 현금흐름 캘린더, 대출/이자 점검, 카드 지출 점검, 보험 보장 점검, 매출 감소 스트레스 테스트, 추천 상품군, 금융 개선 실행 플랜.

하단: 「홈으로」, 「리포트 저장」`fc-btn-save-report`.

---

## 6. 사용자 시나리오별 흐름 (요약 다이어그램)

### A. 창업·상권 컨설팅 (공공데이터 위저드)

```
홈 → [창업 컨설팅 시작하기]
  → 사용자 유형 선택 → 지역·상권·업종 → 사업 조건(선택 입력/AI추천/건너뛰기)
  → 로딩 → 결과 대시보드(탭: 요약/추세/지도/재무/신한연결/리포트)
```

- 샘플: 홈 「샘플 리포트 보기」→ 카드 선택 → 결과로 바로 이동 가능.

### B. 운영 매장 진단 (신한 목업)

```
홈 [운영 매장 진단하기] 또는 계정 [운영 매장 진단 바로가기]
  → (로그인 시 모달로 매장 선택 가능)
  → 동의 → 사업장 선택 → 미리보기·추가입력 → 로딩 → 결과(다중 탭) → 저장 가능
```

- 로그인 없이 홈에서 「운영 매장 진단」만 누르면 상권 위저드로 빠지는 동작이 있음(`app.js`).

### C. 금융 점검 (신한 목업)

```
홈 [금융 점검하기] 또는 계정 [금융 점검 바로가기]
  → 로그인 필요 → 동의 → 사업장 → 미리보기 → 로딩 → 결과(다중 탭)
```

### D. 계정·데이터 동기화

```
Google 로그인 성공 → POST /api/account/google-login
  → 로컬 저장 → POST /api/account/login(동기화)
  → GET saved-profiles / history 로 서버 데이터 병합
```

- 「내 정보 저장」: 현재 상권·재무 스냅샷 저장.
- 분석 완료 시 조회 이력 자동 적재(상한 있음).

---

## 7. 백엔드 API 요약 (프리픽스 `/api`)

기획서용으로 자주 쓰이는 엔드포인트만 추렸습니다.

| 영역 | 메서드·경로 | 용도 |
|------|-------------|------|
| 상권 | `GET /districts`, `/dongs`, `/areas`, `/services`, `/search` | 셀렉트·검색 |
| 분석 | `POST /analysis` | 메인 컨설팅 분석 |
| 트렌드·상태 | `GET /trends`, `/status` | 차트·보조 |
| 리포트 | `POST /report` | AI 리포트 탭 |
| 추천 재무 | `GET /finance-recommendation` | 사업 조건 추천값 |
| 샘플 | `GET /sample-cases`, `GET /sample-case/{id}/area` | 홈 샘플 |
| 외부 검색 | `GET /external-search`, `/search-meaning`, `/map-config`, `/shinhan-loan-rates` 등 | 카카오 검색·설정 |
| 지도 | `GET /competitors` | 경쟁점(위경도 등) |
| 운영 | `GET /shinhan/business/stores`, `.../integrated-profile`, `POST .../operating/analyze`, `.../action-plan`, `.../report/save` 등 | 운영 진단 |
| 금융 | `GET .../financial-check/stores`, `POST .../financial-check/analyze`, 스트레스·플랜·저장 등 | 금융 점검 |
| 계정 | `POST /account/google-login`, `POST /account/login`, `GET/PUT saved-profiles`, `GET/PUT history` | 로그인·동기화 |

상세 파라미터·응답 형태는 각 `routers/*.py` 참고.

---

## 8. 데이터·지표·운영 방식 (발표용 요약)

### 8.1 데이터 소스

- 서울시 상권분석서비스, 소상공인 상가정보(경쟁점), KOSIS 생존율, 한국부동산원 임대 등 공공·외부 데이터.
- 운영/금융: `operating_business.py`의 **목업 프로필**(데모).

### 8.2 적재·갱신

- CSV 등 파일 기반, 캐시·인코딩 자동 감지 등은 `data_loader` 등에 구현.
- **자동 스케줄 배치는 없음** — PoC 단계에서 데이터 교체 후 서버 재시작 형태로 이해하면 됨.

### 8.3 지표 체계 (요지)

- 세부 점수 8개 영역: 상권 매력도, 매출 성장성, 경쟁 강도, 유동인구 적합도, 점포 생태계, 업종 생존성, 임대·고정비 부담, 부채 체력 등 (`risk_engine.py`).
- 신한 연계 진단 4요소: 은행·카드·보험·성장지원 등 **점검 필요성** 중심(확정 상품 추천 아님).
- 사용자 유형별 최종 점수 라벨: 창업 적합도 / 운영 안정도 / 확장 적합도 / 재무 체력 등.
- 조기경보: 분기 매출·상권 대비 매출·점포 증가율·유동인구 등 조건 (`risk_engine`/`dashboard` 로직).

### 8.4 운영·금융 목업 규칙 (코드 반영)

- 경쟁점 반경 확장·참고군: `map_api.py` 규칙.
- 실행 플랜·이전 대비 diff: 운영 탭에서 API·프론트 조합.
- 사용 가능 금액: 운영 vs 금융 점검에서 차감 항목 구분(보험료 등).

---

## 9. PPT·기획서에 바로 쓸 문장 예시

- “단일 화면에서 **상권 공공데이터 컨설팅**, **운영 매장 진단**, **금융 점검** 세 흐름을 제공합니다.”
- “계정은 **Google 로그인**만 연동했고, 저장 분석 조건과 조회 이력을 **로컬·서버 이중 저장**합니다.”
- “경쟁점 지도는 **Leaflet·OSM**, 상권 이름 검색 보조는 **카카오 로컬 API**를 사용합니다.”
- “금융·운영 데이터는 **목업 기반 PoC**이며, 실제 심사·상품 가입은 상담을 전제로 안내합니다.”

---

## 10. 로컬 실행

```bash
# 의존성 설치 후
python web_app.py
# 기본 포트 3288 — 브라우저에서 http://localhost:3288
```

`.env`에 `GOOGLE_CLIENT_ID` 및 카카오·기타 키가 있어야 해당 기능이 동작합니다. 상세 변수명은 `.env.example` 참고.

---

*문서 버전: 저장소 구현 기준 통합본. 화면 문구는 `templates/index.html`과 동일하게 맞추었습니다.*
