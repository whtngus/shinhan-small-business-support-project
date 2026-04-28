/* ─────────────────────────────────────────────────────────────────────────
   신한 자영업 경영지원 컨설팅 - 단계형 프론트엔드
   v2 스펙: 챗봇 X, 단계형(wizard) + 결과 탭 대시보드
   ───────────────────────────────────────────────────────────────────────── */
'use strict';

// ── 글로벌 상태 ─────────────────────────────────────────────────────────────
const State = {
  step: 'home',                       // home | user-type | area | finance | loading | result
  user_type: '',
  district: '',
  dong: '',
  area_code: '',
  area_name: '',
  service_name: '',
  finance_mode: 'simple',             // simple | detail | sample
  finance: {},                        // 사용자 입력 사업 조건
  result: null,                       // POST /api/analysis 결과
  charts: {},
  map: null,                          // L.Map (Leaflet)
  mapEngine: null,                    // 'leaflet' (경쟁점 지도 전용)
  mapMarkers: [],                     // 경쟁점 마커 배열
  centerOverlay: null,                // 중심점 커스텀 오버레이
  circles: {},                        // 반경 원 인스턴스
  leafletTileLayers: null,            // { voyager, light, dark } Leaflet 타일
  competitors: [],                    // 마지막으로 받아온 경쟁점 raw
  activeRadius: 300,
  customCenter: null,                 // 장소 검색으로 옮긴 중심점 [lat, lon] (없으면 null)
  finance_skipped: false,             // 사업 조건 단계 건너뛰기 여부
  mapPreKey: null,
  mapPrePromise: null,
  mapPreData: null,
  competitorExpansion: null,
  radiusExpansion: null,
  loanRates: null,
};

// ── 초기 진입 ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initHomeButtons();
  initUserTypeStep();
  initAreaStep();
  initFinanceStep();
  initResultTabs();
  initHeaderNav();
  loadHomeStats();
  goStep('home');
});

// ── 단계 전환 ───────────────────────────────────────────────────────────────
function goStep(step) {
  State.step = step;
  ['home', 'user-type', 'area', 'finance', 'loading', 'result',
   'operating-connect', 'operating-store', 'operating-preview', 'operating-loading', 'operating-result',
   'financial-connect', 'financial-store', 'financial-preview', 'financial-loading', 'financial-result'].forEach(s => {
    const el = document.getElementById('panel-' + s);
    if (el) el.style.display = (s === step) ? '' : 'none';
  });

  const stepper = document.getElementById('stepper');
  const stepIdx = {
    'user-type': 1, 'area': 2, 'finance': 3, 'loading': 4, 'result': 5,
    'operating-connect': 2, 'operating-store': 3, 'operating-preview': 4, 'operating-loading': 4, 'operating-result': 5,
    'financial-connect': 2, 'financial-store': 3, 'financial-preview': 4, 'financial-loading': 4, 'financial-result': 5,
  }[step] || 0;
  stepper.style.display = (step === 'home') ? 'none' : 'flex';
  stepper.querySelectorAll('.step').forEach(el => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n === stepIdx);
    el.classList.toggle('done',   n <  stepIdx);
  });

  if (step === 'area') loadDistricts();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── 홈 화면 ─────────────────────────────────────────────────────────────────
function initHomeButtons() {
  document.querySelector('[data-action="start-create"]').addEventListener('click', goToConsultingEntry);
  document.querySelector('[data-action="start-operate"]').addEventListener('click', goToConsultingEntry);
  document.querySelector('[data-action="open-samples"]').addEventListener('click', loadSamples);
}

/** 창업/운영 두 버튼 동일: 유형 선택 화면으로만 이동 (자동 선택 없음) */
function goToConsultingEntry() {
  State.user_type = '';
  selectUserTypeCard(null);
  goStep('user-type');
}

async function loadHomeStats() {
  try {
    const districts = await fetchJson('/api/districts');
    const services  = await fetchJson('/api/services');
    document.getElementById('stat-areas').textContent =
      districts.length ? `${districts.length}개 자치구` : '—';
    document.getElementById('stat-services').textContent =
      services.length ? `${services.length}종` : '—';
  } catch (e) {
    console.warn('홈 통계 로드 실패', e);
  }
}

async function loadSamples() {
  const grid = document.getElementById('sample-grid');
  const sec  = document.getElementById('sample-section');
  if (!grid || !sec) return;
  sec.style.display = '';
  grid.innerHTML = '<div class="sample-loading">샘플 케이스 불러오는 중…</div>';
  try {
    const cases = await fetchJson('/api/sample-cases');
    grid.innerHTML = cases.map(c => `
      <div class="sample-card" data-case="${c.id}">
        <div class="sample-tag">${c.user_type}</div>
        <div class="sample-title">${c.title}</div>
        <div class="sample-desc">${c.description}</div>
        <div class="sample-meta">
          <span>업종: <b>${c.service_name}</b></span>
          <span>지역: <b>${c.district_keyword}</b></span>
        </div>
        <button class="btn btn-primary btn-sm">이 케이스로 분석 보기</button>
      </div>`).join('');
    grid.querySelectorAll('.sample-card').forEach(card => {
      card.addEventListener('click', () => runSampleCase(card.dataset.case));
    });
    sec.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    grid.innerHTML = '<div class="sample-loading">샘플 데이터를 불러오지 못했습니다.</div>';
  }
}

async function runSampleCase(caseId) {
  State.finance_skipped = false;
  goStep('loading');
  try {
    const resolved = await fetchJson(`/api/sample-case/${caseId}/area`);
    if (resolved.error || !resolved.area) {
      alert('샘플 데이터에 매칭되는 상권을 찾지 못했습니다.');
      goStep('home');
      return;
    }
    State.user_type     = resolved.case.user_type;
    State.district      = resolved.area.district || '';
    State.dong          = resolved.area.dong     || '';
    State.area_code     = resolved.area.area_code;
    State.area_name     = resolved.area.area_name;
    State.service_name  = resolved.case.service_name;
    State.finance_mode  = 'sample';
    State.finance = pickFinance(resolved.case);

    preloadMapDuringAnalysis();
    const result = await analyzeNow(State);
    State.result = result;
    renderResult(result);
    goStep('result');
  } catch (e) {
    console.error(e);
    alert('샘플 분석 중 오류가 발생했습니다.');
    goStep('home');
  }
}

function pickFinance(src) {
  const keys = ['monthly_sales','rent','labor_cost','loan_balance','interest_rate',
                'monthly_repayment','cash_balance','initial_investment','cost_ratio'];
  const out = {};
  keys.forEach(k => { if (src[k] !== undefined && src[k] !== null && src[k] !== '') out[k] = Number(src[k]); });
  return out;
}

// ── 1. 사용자 유형 ─────────────────────────────────────────────────────────
function initUserTypeStep() {
  document.querySelectorAll('#usertype-grid .usertype-card').forEach(card => {
    card.addEventListener('click', () => {
      State.user_type = card.dataset.type;
      selectUserTypeCard(State.user_type);
    });
  });
  document.getElementById('btn-next-1').addEventListener('click', () => {
    if (!State.user_type) return;
    if (State.user_type === '운영 중인 사업자') {
      goStep('operating-connect');
    } else if (State.user_type === '금융 점검' || State.user_type === '금융/보험/비용 구조 점검') {
      goStep('financial-connect');
    } else {
      goStep('area');
      loadDistricts();
    }
  });
  document.querySelector('#panel-user-type [data-go="home"]').addEventListener('click', () => goStep('home'));
}

function selectUserTypeCard(type) {
  document.querySelectorAll('#usertype-grid .usertype-card').forEach(c => {
    c.classList.toggle('selected', !!type && c.dataset.type === type);
  });
  document.getElementById('btn-next-1').disabled = !type;
}

// ── 2. 지역·상권·업종 ──────────────────────────────────────────────────────
function initAreaStep() {
  document.getElementById('sel-district').addEventListener('change', onDistrictChange);
  document.getElementById('sel-dong').addEventListener('change', onDongChange);
  document.getElementById('sel-area').addEventListener('change', onAreaChange);
  document.getElementById('sel-service').addEventListener('change', onServiceChange);
  document.getElementById('inp-area-q').addEventListener('input', debounce(loadAreaList, 300));

  document.querySelectorAll('#panel-area .chip').forEach(c => {
    c.addEventListener('click', () => {
      document.getElementById('inp-area-q').value = c.dataset.search;
      loadAreaList();
    });
  });

  // 검색 의미 도움말 토글
  const helpIcon = document.querySelector('#panel-area .help-icon[data-help="search-meaning"]');
  if (helpIcon) helpIcon.addEventListener('click', toggleSearchHelp);

  // 외부(카카오) 검색
  const btnToggle = document.getElementById('btn-toggle-external');
  if (btnToggle) btnToggle.addEventListener('click', () => {
    const body = document.getElementById('external-body');
    const open = body.hasAttribute('hidden');
    if (open) { body.removeAttribute('hidden'); btnToggle.textContent = '고급 검색 닫기'; }
    else      { body.setAttribute('hidden', '');  btnToggle.textContent = '고급 검색 열기'; }
  });
  const btnExt = document.getElementById('btn-external-search');
  if (btnExt) btnExt.addEventListener('click', runExternalSearch);
  const inpExt = document.getElementById('inp-external-q');
  if (inpExt) inpExt.addEventListener('keydown', e => { if (e.key === 'Enter') runExternalSearch(); });

  document.getElementById('btn-next-2').addEventListener('click', () => {
    if (!State.area_code || !State.service_name) return;
    goStep('finance');
    applyFinanceMode(State.finance_mode);
  });
  document.querySelector('#panel-area [data-go="user-type"]').addEventListener('click', () => goStep('user-type'));
}

async function toggleSearchHelp() {
  const tip = document.getElementById('search-help-tooltip');
  if (!tip) return;
  if (!tip.hasAttribute('hidden')) { tip.setAttribute('hidden', ''); return; }
  try {
    const r = await fetchJson('/api/search-meaning');
    tip.innerHTML = `
      <div class="help-title">${r.title}</div>
      <ul>${r.lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
  } catch (e) {
    tip.innerHTML = '<div class="help-title">상권 검색은 키워드 매칭 검색입니다.</div>';
  }
  tip.removeAttribute('hidden');
}

async function runExternalSearch() {
  const q = (document.getElementById('inp-external-q').value || '').trim();
  if (!q) return;
  const status = document.getElementById('external-status');
  const placesEl  = document.getElementById('external-places');
  const matchedEl = document.getElementById('external-matched');
  status.innerHTML = '<span class="muted">카카오 검색 중…</span>';
  placesEl.innerHTML = ''; matchedEl.innerHTML = '';

  let res;
  try {
    res = await fetchJson('/api/external-search?q=' + encodeURIComponent(q));
  } catch (e) {
    status.innerHTML = '<span class="error">외부 검색 실패. 카카오 REST API 키와 네트워크를 확인해주세요.</span>';
    return;
  }

  status.innerHTML = res.kakao_enabled
    ? '<span class="ok">카카오 검색 결과를 가져왔습니다.</span>'
    : `<span class="warn">${res.help.external_help}</span>`;

  placesEl.innerHTML = (res.local_places || []).map(p => `
    <a class="ext-card link" href="${p.link}" target="_blank" rel="noopener noreferrer">
      <div class="ext-title">${p.title || '-'}</div>
      <div class="ext-meta">${p.category || p.category_group || ''}</div>
      <div class="ext-meta muted">${p.address || ''}${p.telephone ? ' · ' + p.telephone : ''}</div>
    </a>`).join('') || '<div class="muted">결과 없음</div>';

  if ((res.matched_areas || []).length === 0) {
    matchedEl.innerHTML = '<div class="muted">매칭되는 공공 데이터 상권을 찾지 못했습니다.<br>좌측 결과의 위치 정보를 활용해 자치구를 직접 선택해주세요.</div>';
  } else {
    matchedEl.innerHTML = res.matched_areas.map(a => `
      <div class="ext-card matched" data-area="${a.area_code}" data-name="${a.area_name}" data-district="${a.district}" data-dong="${a.dong}">
        <div class="ext-title">${a.area_name}</div>
        <div class="ext-meta">${a.area_type} · ${a.district} ${a.dong}</div>
        <div class="ext-meta muted">검색 위치에서 약 ${a.dist_m}m</div>
        <button class="btn btn-secondary btn-xs">이 상권 선택</button>
      </div>`).join('');
    matchedEl.querySelectorAll('.ext-card.matched').forEach(card => {
      card.addEventListener('click', () => applyMatchedArea(card.dataset));
    });
  }
}

async function applyMatchedArea(d) {
  if (!d.area) return;
  // 자치구 → 행정동 → 상권 → (사용자가 업종 선택) 순서로 자동 채움
  const distSel = document.getElementById('sel-district');
  if (d.district) {
    if (![...distSel.options].some(o => o.value === d.district)) {
      const o = document.createElement('option'); o.value = d.district; o.textContent = d.district;
      distSel.appendChild(o);
    }
    distSel.value = d.district;
    await onDistrictChange();
  }
  const dongSel = document.getElementById('sel-dong');
  if (d.dong && [...dongSel.options].some(o => o.value === d.dong)) {
    dongSel.value = d.dong;
    await onDongChange();
  }
  const areaSel = document.getElementById('sel-area');
  // 옵션이 없을 수 있어 직접 추가
  if (![...areaSel.options].some(o => o.value === d.area)) {
    const o = document.createElement('option');
    o.value = d.area; o.textContent = `${d.name} (외부 검색 매칭)`;
    o.dataset.name = d.name;
    areaSel.appendChild(o);
  }
  areaSel.value = d.area;
  await onAreaChange();
  document.querySelector('#panel-area .external-search-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadDistricts(force = false) {
  const sel = document.getElementById('sel-district');
  if (!force && sel.options.length > 1) return;
  resetSelect('sel-district', '자치구 불러오는 중…');
  sel.disabled = true;
  try {
    const list = await fetchJson('/api/districts');
    resetSelect('sel-district', list.length ? '자치구 선택' : '자치구 데이터 없음');
    list.forEach(d => {
      const o = document.createElement('option'); o.value = d; o.textContent = d;
      sel.appendChild(o);
    });
    console.log('[shinhan] 자치구 로드:', list.length, '개');
  } catch (e) {
    console.error('자치구 로드 실패', e);
    resetSelect('sel-district', '자치구 로드 실패 (재시도)');
  } finally {
    sel.disabled = false;
  }
}

async function onDistrictChange() {
  State.district = document.getElementById('sel-district').value;
  State.dong = ''; State.area_code = ''; State.area_name = ''; State.service_name = '';
  resetSelect('sel-dong',    '행정동 선택 (선택사항)');
  resetSelect('sel-area',    '상권 선택');
  resetSelect('sel-service', '업종 선택');

  if (!State.district) { validateAreaStep(); return; }

  const dongSel = document.getElementById('sel-dong');
  dongSel.disabled = true;
  resetSelect('sel-dong', '행정동 불러오는 중…');
  try {
    const dongs = await fetchJson(`/api/dongs?district=${encodeURIComponent(State.district)}`);
    resetSelect('sel-dong', '전체 행정동');
    dongs.forEach(d => {
      const o = document.createElement('option'); o.value = d; o.textContent = d;
      dongSel.appendChild(o);
    });
    console.log('[shinhan] 행정동 로드:', dongs.length, '개');
  } catch (e) {
    console.error('행정동 로드 실패', e);
    resetSelect('sel-dong', '행정동 로드 실패');
  } finally {
    dongSel.disabled = false;
  }

  await loadAreaList();
  validateAreaStep();
}

async function onDongChange() {
  State.dong = document.getElementById('sel-dong').value;
  await loadAreaList();
}

async function loadAreaList() {
  const sel = document.getElementById('sel-area');
  resetSelect('sel-area', '상권 불러오는 중…');
  resetSelect('sel-service', '업종 선택');
  sel.disabled = true;

  const q = document.getElementById('inp-area-q').value.trim();
  if (!State.district && !q) {
    resetSelect('sel-area', '자치구 또는 검색어를 먼저 입력하세요');
    sel.disabled = false;
    return;
  }

  const params = new URLSearchParams();
  if (State.district) params.set('district', State.district);
  if (State.dong)     params.set('dong', State.dong);
  if (q)              params.set('q', q);

  try {
    const list = await fetchJson('/api/areas?' + params.toString());
    resetSelect('sel-area', list.length ? `상권 선택 (총 ${list.length}곳)` : '상권 데이터 없음');
    list.forEach(a => {
      const o = document.createElement('option');
      o.value = a['상권_코드'];
      o.textContent = `${a['상권_코드_명']} (${a['상권_구분_코드_명'] || ''})`;
      o.dataset.name = a['상권_코드_명'];
      sel.appendChild(o);
    });
    console.log('[shinhan] 상권 로드:', list.length, '개', { district: State.district, dong: State.dong, q });
  } catch (e) {
    console.error('상권 로드 실패', e);
    resetSelect('sel-area', '상권 로드 실패');
  } finally {
    sel.disabled = false;
  }
  validateAreaStep();
}

async function onAreaChange() {
  const sel = document.getElementById('sel-area');
  State.area_code = sel.value;
  State.area_name = sel.options[sel.selectedIndex]?.dataset.name || '';
  State.service_name = '';

  const ssel = document.getElementById('sel-service');
  resetSelect('sel-service', '업종 선택');

  if (!State.area_code) { validateAreaStep(); return; }

  ssel.disabled = true;
  resetSelect('sel-service', '업종 불러오는 중…');
  try {
    const list = await fetchJson('/api/services?area_code=' + encodeURIComponent(State.area_code));
    resetSelect('sel-service', list.length ? '업종 선택' : '업종 데이터 없음');
    list.forEach(s => {
      const o = document.createElement('option'); o.value = s; o.textContent = s;
      ssel.appendChild(o);
    });
    console.log('[shinhan] 업종 로드:', list.length, '개', { area_code: State.area_code });
  } catch (e) {
    console.error('업종 로드 실패', e);
    resetSelect('sel-service', '업종 로드 실패');
  } finally {
    ssel.disabled = false;
  }
  validateAreaStep();
}

function onServiceChange() {
  State.service_name = document.getElementById('sel-service').value;
  validateAreaStep();
}

function validateAreaStep() {
  const ok = State.area_code && State.service_name;
  document.getElementById('btn-next-2').disabled = !ok;
}

// ── 3. 사업 조건 입력 ──────────────────────────────────────────────────────
function initFinanceStep() {
  document.querySelectorAll('#panel-finance .mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#panel-finance .mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      State.finance_mode = tab.dataset.mode;
      applyFinanceMode(State.finance_mode);
    });
  });

  document.querySelector('#panel-finance [data-go="area"]').addEventListener('click', () => goStep('area'));
  document.getElementById('btn-analyze').addEventListener('click', runAnalysis);
  const btnSkip = document.getElementById('btn-skip-finance');
  if (btnSkip) btnSkip.addEventListener('click', runAnalysisSkip);

  const btnRec = document.getElementById('btn-recommend');
  if (btnRec) btnRec.addEventListener('click', applyRecommendation);
  initFinanceLivePreview();
}

async function applyRecommendation() {
  const btn = document.getElementById('btn-recommend');
  const desc = document.getElementById('recommend-desc');
  if (!State.area_code) { alert('상권을 먼저 선택해주세요.'); return; }
  btn.disabled = true; const oldText = btn.textContent; btn.textContent = '추천값 계산 중…';
  try {
    const params = new URLSearchParams({
      area_code: State.area_code,
      service_name: State.service_name || '',
    });
    const r = await fetchJson('/api/finance-recommendation?' + params);
    State.recommendation = r;

    // 상세 입력으로 전환 (모든 필드 보이게)
    State.finance_mode = 'detail';
    document.querySelectorAll('#panel-finance .mode-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.mode === 'detail'));
    applyFinanceMode('detail');

    // 입력값 채우기
    const v = r.values || {};
    Object.entries(v).forEach(([k, val]) => {
      const el = document.getElementById('fin-' + k);
      if (el && val !== undefined && val !== null && val !== '') el.value = val;
    });
    refreshFinanceLivePreview();

    // 각 입력 옆에 추천 hint 표시
    Object.entries(v).forEach(([k, val]) => {
      const el = document.getElementById('fin-' + k);
      if (!el) return;
      const wrap = el.closest('.form-item');
      if (!wrap) return;
      let hint = wrap.querySelector('.recommend-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'recommend-hint';
        wrap.appendChild(hint);
      }
      const src = (r.sources || {})[k] || '';
      const formatted = (k === 'cost_ratio')
        ? `${val}` :  (k === 'interest_rate' ? `${val}%` : fmtMoney(val));
      hint.innerHTML = `<span class="rec-tag">추천값</span> ${formatted}<br><span class="rec-src">${src}</span>`;
    });

    const conf = { high: '높음', medium: '보통', low: '낮음 (합성 데이터 기반)' }[r.confidence] || r.confidence;
    desc.innerHTML = `
      <b>${r.area_name || State.area_code} · ${r.service_name || '-'}</b> 기준 추천값을 자동 채웠습니다.
      신뢰도: <b>${conf}</b>. 상세 데이터 출처는 각 항목 아래 hint를 참고하세요.
      필요 시 직접 수정 후 <b>분석 시작</b>을 누르세요.`;
  } catch (e) {
    console.error(e);
    alert('추천값 계산에 실패했습니다.');
  } finally {
    btn.disabled = false; btn.textContent = oldText;
  }
}

function applyFinanceMode(mode) {
  document.querySelectorAll('#panel-finance .detail-only').forEach(el => {
    el.hidden = (mode !== 'detail');
  });
  if (mode === 'sample') {
    fillFinanceSample();
  } else {
    clearFinanceForm();
  }
  document.getElementById('btn-analyze').textContent =
    (mode === 'sample') ? '샘플 점포로 분석 시작' : '분석 시작';
}

function clearFinanceForm() {
  ['monthly_sales','rent','labor_cost','loan_balance','cash_balance','own_capital',
   'interest_rate','monthly_repayment','initial_investment','cost_ratio','misc_monthly_cost','misc_initial_cost']
   .forEach(k => { const el = document.getElementById('fin-' + k); if (el) el.value = ''; });
  refreshFinanceLivePreview();
}

function fillFinanceSample() {
  const sample = {
    monthly_sales: 35000000, rent: 4000000, labor_cost: 10000000,
    loan_balance: 60000000,  cash_balance: 15000000,
    interest_rate: 5.5, monthly_repayment: 800000,
    initial_investment: 100000000, cost_ratio: 0.35,
    own_capital: 20000000, misc_monthly_cost: 500000, misc_initial_cost: 3000000,
  };
  Object.entries(sample).forEach(([k, v]) => {
    const el = document.getElementById('fin-' + k); if (el) el.value = v;
  });
  refreshFinanceLivePreview();
}

function readFinance() {
  const out = {};
  ['monthly_sales','rent','labor_cost','loan_balance','cash_balance','own_capital',
   'interest_rate','monthly_repayment','initial_investment','cost_ratio','misc_monthly_cost','misc_initial_cost']
   .forEach(k => {
     const v = document.getElementById('fin-' + k)?.value;
     if (v !== undefined && v !== '' && v !== null) out[k] = Number(v);
   });
  return out;
}

function initFinanceLivePreview() {
  const keys = [
    'monthly_sales', 'rent', 'labor_cost', 'loan_balance', 'cash_balance', 'own_capital',
    'interest_rate', 'monthly_repayment', 'initial_investment', 'cost_ratio',
    'misc_monthly_cost', 'misc_initial_cost',
  ];
  keys.forEach(k => {
    const el = document.getElementById('fin-' + k);
    if (!el) return;
    el.addEventListener('input', refreshFinanceLivePreview);
    el.addEventListener('change', refreshFinanceLivePreview);
  });
  refreshFinanceLivePreview();
  loadShinhanLoanRates().catch(() => {});
}

function buildFinancePreviewModel(input) {
  const ms = Number(input.monthly_sales || 0);
  const rent = Number(input.rent || 0);
  const labor = Number(input.labor_cost || 0);
  const loanB = Number(input.loan_balance || 0);
  const ir = Number(input.interest_rate || 5.5);
  const mrep = Number(input.monthly_repayment || 0);
  const cash = Number(input.cash_balance || 0);
  const own = Number(input.own_capital || cash || 0);
  const init = Number(input.initial_investment || (ms > 0 ? Math.round(ms * 4) : 0));
  const costRatio = Math.max(0, Math.min(0.95, Number(input.cost_ratio || 0.35)));
  const miscMonthly = Number(input.misc_monthly_cost || 0);
  const miscInitial = Number(input.misc_initial_cost || 0);
  const monthlyInterest = loanB * ir / 100 / 12;
  const fixed = rent + labor + monthlyInterest + miscMonthly;
  const variable = ms * costRatio;
  const breakEven = (1 - costRatio) > 0 ? Math.round(fixed / (1 - costRatio)) : 0;
  const initialInvestment = Math.max(0, init + miscInitial);
  const needed = Math.max(0, initialInvestment - own);
  const neededInterest = needed * ir / 100 / 12;
  return {
    monthly_sales: ms,
    rent,
    labor_cost: labor,
    loan_balance: loanB,
    interest_rate: ir,
    monthly_repayment: mrep,
    cash_balance: cash,
    own_capital: own,
    initial_investment: initialInvestment,
    cost_ratio: costRatio,
    misc_monthly_cost: miscMonthly,
    monthly_interest: monthlyInterest,
    fixed_cost: fixed,
    variable_cost: variable,
    break_even: breakEven,
    funding_gap_estimate: needed,
    loan_needed_estimate: needed,
    loan_monthly_interest_estimate: neededInterest,
    recommended_working_capital: Math.round(fixed * 3),
  };
}

/**
 * 결과 컨설팅 화면용 재무 묶음.
 * 분석 전 단계에서 입력한 값(State.finance)과 API 합성값을 합친 뒤,
 * `buildFinancePreviewModel`과 같은 식으로 손익분기·차트 데이터를 맞춘다(미리보기와 일관).
 */
function financeForResultView(d) {
  const api = d?.finance || {};
  if (State.finance_skipped) return api;

  const inp = State.finance || {};
  const keys = [
    'monthly_sales', 'rent', 'labor_cost', 'loan_balance', 'cash_balance', 'own_capital',
    'interest_rate', 'monthly_repayment', 'initial_investment', 'cost_ratio',
    'misc_monthly_cost', 'misc_initial_cost',
  ];
  const hasAnyInput = keys.some(k => inp[k] !== undefined && inp[k] !== null && inp[k] !== '');
  if (!hasAnyInput) return api;

  const base = {};
  keys.forEach(k => {
    if (inp[k] !== undefined && inp[k] !== null && inp[k] !== '') base[k] = Number(inp[k]);
    else if (api[k] != null && api[k] !== '') base[k] = Number(api[k]);
  });

  const model = buildFinancePreviewModel(base);
  return {
    ...api,
    ...model,
    net_profit: model.monthly_sales - model.fixed_cost - model.variable_cost,
    interest_ratio: model.monthly_sales
      ? Math.round((model.monthly_interest / model.monthly_sales) * 1000) / 10
      : 0,
    cash_months: api.cash_months,
    cash_months_10pct: api.cash_months_10pct,
    cash_months_20pct: api.cash_months_20pct,
    breakdown_franchise_proxy: api.breakdown_franchise_proxy,
    breakdown_facility_proxy: api.breakdown_facility_proxy,
    breakdown_deposit_working_proxy: api.breakdown_deposit_working_proxy,
  };
}

function refreshFinanceLivePreview() {
  const kpi = document.getElementById('finance-live-kpis');
  const cvGap = document.getElementById('fin-live-chart-gap');
  const cvMonthly = document.getElementById('fin-live-chart-monthly');
  if (!kpi || !cvGap || !cvMonthly || typeof Chart === 'undefined') return;
  const model = buildFinancePreviewModel(readFinance());
  kpi.innerHTML = `
    <div class="kpi"><div class="kpi-label">필요 대출(추정)</div><div class="kpi-value">${fmtMoney(model.loan_needed_estimate)}</div></div>
    <div class="kpi"><div class="kpi-label">필요 대출 월 이자(추정)</div><div class="kpi-value">${fmtMoney(model.loan_monthly_interest_estimate)}</div></div>
    <div class="kpi"><div class="kpi-label">손익분기 매출(추정)</div><div class="kpi-value">${fmtMoney(model.break_even)}</div></div>
  `;
  State.charts['fin-live-chart-gap']?.destroy?.();
  State.charts['fin-live-chart-monthly']?.destroy?.();
  State.charts['fin-live-chart-gap'] = new Chart(cvGap, {
    type: 'doughnut',
    data: {
      labels: ['자기자본', '필요 대출(추정)'],
      datasets: [{
        data: [Math.max(model.own_capital, 1), Math.max(model.loan_needed_estimate, 1)],
        backgroundColor: ['#1d4ed8', '#ef4444'],
        borderWidth: 0,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
  });
  State.charts['fin-live-chart-monthly'] = new Chart(cvMonthly, {
    type: 'bar',
    data: {
      labels: ['월 이자', '월 상환액', '임대+인건비+기타', '손익분기 매출'],
      datasets: [{
        data: [
          model.loan_monthly_interest_estimate,
          model.monthly_repayment,
          model.rent + model.labor_cost + model.misc_monthly_cost,
          model.break_even,
        ],
        backgroundColor: ['#dc2626', '#f97316', '#6366f1', '#14b8a6'],
        borderRadius: 6,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });
}

async function loadShinhanLoanRates() {
  if (State.loanRates) {
    renderShinhanLoanRatesBox(State.loanRates);
    return State.loanRates;
  }
  const data = await fetchJson('/api/shinhan-loan-rates');
  State.loanRates = data;
  renderShinhanLoanRatesBox(data);
  return data;
}

function renderShinhanLoanRatesBox(data, targetId = 'shinhan-rate-box') {
  const box = document.getElementById(targetId);
  if (!box) return;
  const rates = data?.rates || [];
  const links = data?.links || [];
  box.innerHTML = `
    <div class="rate-head">
      <strong>신한은행 대출 금리 참고</strong>
      <span class="rate-date">기준일: ${escapeHtml(data?.updated_at || '-')}</span>
    </div>
    <div class="rate-list">
      ${rates.map(r => `
        <div class="rate-row">
          <div class="rate-name">${escapeHtml(r.product || '')}</div>
          <div class="rate-val">연 ${Number(r.rate_min).toFixed(1)}% ~ ${Number(r.rate_max).toFixed(1)}%</div>
          <div class="rate-cond">${escapeHtml(r.conditions || '')}</div>
        </div>
      `).join('')}
    </div>
    <div class="rate-links">
      ${links.map(l => `<a class="btn btn-ghost btn-sm" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a>`).join('')}
      <a class="btn btn-primary btn-sm" href="https://bank.shinhan.com/index.jsp" target="_blank" rel="noopener noreferrer">신한은행 대출하러가기</a>
    </div>
    <div class="rate-note">${escapeHtml(data?.disclaimer || '')}</div>
  `;
}

// ── 4. 분석 진행 ────────────────────────────────────────────────────────────
async function runAnalysis() {
  if (!State.area_code) { alert('상권을 선택해주세요.'); return; }
  State.finance_skipped = false;
  State.finance = readFinance();
  await executeAnalysisPipeline();
}

/** 사업 조건 없이 상권·합성 데이터만으로 분석 */
async function runAnalysisSkip() {
  if (!State.area_code) { alert('상권을 선택해주세요.'); return; }
  State.finance_skipped = true;
  State.finance = {};
  await executeAnalysisPipeline();
}

async function executeAnalysisPipeline() {
  goStep('loading');
  preloadMapDuringAnalysis();
  const animPromise = animateLoadingChecks();
  try {
    const [data] = await Promise.all([analyzeNow(State), animPromise]);
    State.result = data;
    markAllChecksDone();
    await sleep(250);
    renderResult(data);
    goStep('result');
  } catch (e) {
    console.error(e);
    alert('분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    goStep('finance');
  }
}

function animateLoadingChecks() {
  const items = document.querySelectorAll('#loading-checks li');
  items.forEach(it => it.classList.remove('done'));
  const stepMs = 280;
  return new Promise(resolve => {
    items.forEach((it, i) => setTimeout(() => it.classList.add('done'), stepMs * (i + 1)));
    setTimeout(resolve, stepMs * (items.length + 1));
  });
}

function markAllChecksDone() {
  document.querySelectorAll('#loading-checks li').forEach(it => it.classList.add('done'));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function analyzeNow(s) {
  const body = {
    area_code:    s.area_code,
    service_name: s.service_name,
    user_type:    s.user_type || '창업 예정자',
    ...(s.finance || {}),
  };
  return fetchJson('/api/analysis', { method: 'POST', body: JSON.stringify(body) });
}

// ── 5. 결과 렌더링 ─────────────────────────────────────────────────────────
function initResultTabs() {
  document.querySelectorAll('#panel-result .tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('#panel-result .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const target = t.dataset.tab;
      ['overview','trend','map','finance','services','report'].forEach(name => {
        const el = document.getElementById('tab-' + name);
        if (el) el.style.display = (name === target) ? '' : 'none';
        if (name === target) el.classList.add('active'); else el?.classList.remove('active');
      });
      if (target === 'trend')   renderTrendTab();
      if (target === 'finance' && State.result) drawFinanceCharts(State.result);
      if (target === 'map')     renderMapTab();
      if (target === 'report')  renderReportTab();
    });
  });

  document.querySelectorAll('#panel-result [data-go]').forEach(b => {
    b.addEventListener('click', () => {
      const target = b.dataset.go;
      goStep(target === 'home' ? 'home' : target);
    });
  });
}

function renderResult(data) {
  window.__SHINHAN_RESULT_CONTEXT__ = {
    area_name: data?.area_name || '',
    service_name: data?.service_name || '',
  };
  renderResultSummary(data);
  renderScoreGrid(data);
  renderOverviewTab(data);
  renderFinanceTab(data);
  renderServicesTab(data);
  document.getElementById('tab-report').innerHTML = '';
  document.getElementById('tab-trend').innerHTML  = '';
  destroyMapView();
  document.getElementById('tab-map').innerHTML    = '';
  // 결과 패널 탭만 초기화 (전역 .tab 은 운영/금융 등 다른 패널 탭과 섞이면 안 됨)
  document.querySelectorAll('#panel-result .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === 'overview');
  });
  ['overview','trend','map','finance','services','report'].forEach(n => {
    const el = document.getElementById('tab-' + n);
    if (!el) return;
    el.style.display = (n === 'overview') ? '' : 'none';
    el.classList.toggle('active', n === 'overview');
  });
}

function renderResultSummary(d) {
  const final = d?.scores?.final || {};
  const finance = financeForResultView(d);
  const wrap = document.getElementById('result-summary');

  const breakEven = Number(finance.break_even || 0);
  const monthly   = Number(finance.monthly_sales || 0);
  const beStatus = monthly >= breakEven ? '손익분기 상회' : '손익분기 미달';

  const cashBal = Number(finance.cash_balance ?? 0);
  const ownCap = Number(
    finance.own_capital != null && finance.own_capital !== ''
      ? finance.own_capital
      : cashBal,
  );

  const cashMo = finance.cash_months;
  const cashMoNum = typeof cashMo === 'number' ? cashMo : parseFloat(cashMo);
  const fc = Number(finance.fixed_cost || 0);
  const mrep = Number(finance.monthly_repayment || 0);
  const burnHint =
    fc + mrep > 0
      ? `보유 현금 <b>${fmtMoney(cashBal)}</b>을(를) 기준으로, 월 고정비·이자·원리금 상환 등 추정 월 현금 소모(약 <b>${fmtMoney(fc + mrep)}</b>)로 나눈 참고 개월수입니다.`
      : `보유 현금 <b>${fmtMoney(cashBal)}</b> 기준입니다.`;

  const runwayTxt = Number.isFinite(cashMoNum) && cashMoNum < 999
    ? `약 <b>${cashMoNum.toFixed(1)}개월</b> — 매출 급감·적자 상황을 버틸 수 있는 수준(추정). ${burnHint}`
    : `현금 버팀(추정)은 비교적 여유가 있는 편으로 계산되었습니다. (${burnHint})`;

  const initTot = Number(finance.initial_investment || 0);
  const gap = Number(finance.funding_gap_estimate ?? Math.max(0, initTot - ownCap));
  const gapTxt = gap > 0
    ? `시설·부지·가맹 등을 포함한 <b>초기 소요(추정)</b> 대비 <b>자기자본(본인 출자 등)</b>이 부족하면, 참고용으로 추가 조달·대출 검토 금액은 약 <b>${fmtMoney(gap)}</b> 수준입니다.`
    : `<b>자기자본(본인 출자 등)</b>이 초기 소요(추정)와 비교해 여유가 있거나 균형에 가깝습니다.`;

  const ocInp = State.finance && State.finance.own_capital;
  const hasOwnInput = ocInp !== undefined && ocInp !== null && String(ocInp).trim() !== '';
  const ownCapNote =
    !hasOwnInput && cashBal === ownCap
      ? ' <span class="muted">(자기자본 미입력 시 보유 현금과 동일하게 반영)</span>'
      : '';

  wrap.innerHTML = `
    <div class="summary-head">
      <div>
        <div class="summary-eyebrow">${d.user_type || ''} · ${d.area_name || '-'} · ${d.service_name || '-'}</div>
        <h2 class="summary-title">${final.name || '종합 점수'} <span class="grade-badge" style="background:${final.color || '#3b82f6'}">${final.label || ''}</span></h2>
        <div class="summary-meta">손익분기 <b>${fmtMoney(breakEven)}</b> · 예상 월매출 <b>${fmtMoney(monthly)}</b> · ${beStatus}</div>
      </div>
      <div class="summary-score">
        <div class="big-score">${(final.score ?? 0).toFixed?.(0) || final.score || 0}</div>
        <div class="big-score-unit">/ 100</div>
      </div>
    </div>
    <div class="summary-finance-highlight">
      <div class="sfh-label">자금·매출 핵심 (추정 · 참고)</div>
      <ul class="sfh-list">
        <li><strong>본인·보유 자금:</strong> 보유 현금(운영·가용) <b>${fmtMoney(cashBal)}</b> · 자기자본·본인 출자액 <b>${fmtMoney(ownCap)}</b>${ownCapNote}</li>
        <li><strong>본인 자금으로 버티는 기간:</strong> ${runwayTxt}</li>
        <li><strong>월 손익분기 매출:</strong> 적자 없이 버티려면 월 약 <b>${fmtMoney(breakEven)}</b> 이상이 필요한 구조(원가율·고정비 가정)입니다.</li>
        <li><strong>초기 소요 vs 자기자본:</strong> 총 초기 소요(추정) <b>${fmtMoney(initTot)}</b> · 자기자본(본인 출자 등) <b>${fmtMoney(ownCap)}</b> · 보유 현금 <b>${fmtMoney(cashBal)}</b> · ${gapTxt}</li>
      </ul>
      <p class="sfh-note">실제 대출 한도·금리·가맹비는 브랜드·계약 조건에 따라 크게 달라지므로 상담으로 확인해야 합니다.</p>
    </div>
    ${(d.warnings || []).length ? `
      <div class="warnings">
        ${d.warnings.map(w => `<div class="warning-item">⚠ ${w}</div>`).join('')}
      </div>` : ''}
  `;
}

/** 12개 세부 지표 설명 (src/risk_engine.py 로직과 동일 기준) */
const SCORE_TOOLTIP_HELP = {
  attraction: {
    calc:
      '상권 추정매출(평균)·유동인구(평균)·상주인구·직장인구를 각각 설정 구간 안에서 0~100점으로 환산한 뒤, 가중치 35%·35%·15%·15%로 가중합합니다.',
    interp:
      '점수가 높을수록 유동·매출 규모 등 “상권 활력”이 큰 편입니다. 보통 <b>80점 이상</b> 매우 양호, <b>60 이상</b> 양호, <b>40 미만</b>은 신중 검토 구간으로 표시합니다.',
    dir: 'positive',
  },
  growth: {
    calc:
      '매출 추이 분기 데이터가 4분기 이상일 때만 산출합니다. 최근 4분기 대비 1년 매출 변화율을 60%, 최근 1분기 변화율을 40% 반영합니다. 데이터가 부족하면 중간값 50점입니다.',
    interp:
      '<b>80점 이상</b> 매우 양호, <b>60 이상</b> 양호입니다. 장기적으로 매출 하락 추세면 점수가 낮아집니다.',
    dir: 'positive',
  },
  competition: {
    calc:
      '점포 수 4분기 증가율(35%), 반경 내 경쟁점 개수(40%), 유사 업종 점포 수(25%)를 반영합니다. 같은 상권에서 경쟁이 치열할수록 점수가 올라갑니다.',
    interp:
      '<b class="risk-word">위험형 지표</b>입니다. 점수가 <b>높을수록</b> 경쟁이 심한 편입니다. <b>40점 미만</b>이면 “낮음”으로 상대적으로 여유가 있다고 볼 수 있습니다.',
    dir: 'negative',
  },
  population: {
    calc:
      '유동인구 평균 수준(60%)과 최근 4분기 유동인구 변화 추세(40%)를 결합합니다.',
    interp:
      '<b>80점 이상</b> 매우 양호, <b>60 이상</b> 양호입니다. 유동이 많고 증가 추세면 유리합니다.',
    dir: 'positive',
  },
  ecosystem: {
    calc:
      '업종 폐업률(낮을수록 좋음, 60%)와 상권변화지표(40%)를 사용합니다. 폐업률이 높으면 점수가 깎입니다.',
    interp:
      '<b>80점 이상</b>이면 점포 생태계가 비교적 안정적인 편으로 해석합니다.',
    dir: 'positive',
  },
  survival: {
    calc:
      '통계청 KOSIS 등에서 가져온 업종 관련 <b>5년 생존율</b>(가능할 때)을 구간 정규화하여 점수화합니다.',
    interp:
      '동일 업종에서의 장기 생존 가능성 참고 지표입니다. 데이터가 없으면 중간값에 가깝게 나올 수 있습니다.',
    dir: 'positive',
  },
  rent: {
    calc:
      '임대료 관련 시계열이 있으면, 기간 대비 임대료 변동률을 기준으로 정규화합니다.',
    interp:
      '<b class="risk-word">위험형 지표</b>입니다. 점수가 <b>높을수록</b> 임대료 부담·상승 압력이 큰 편입니다. <b>40점 미만</b>이면 부담이 상대적으로 낮은 편입니다.',
    dir: 'negative',
  },
  debt: {
    calc:
      '월 이자부담률(역가중 30%), 월 고정비 대비 매출 비율(역 30%), 현금으로 고정비+이자를 몇 개월 버틸 수 있는지(40%)를 결합합니다.',
    interp:
      '<b>80점 이상</b>이면 부채·현금 흐름 체력이 비교적 양호한 편입니다. <b>40 미만</b>이면 자금 구조 점검이 권장됩니다.',
    dir: 'positive',
  },
  shinhan_bank: {
    calc:
      '부채 체력 진단에서 나온 이자부담률·현금보유개월·고정비부담률을 바탕으로, 금융 상담이 필요해 보이는 정도를 0~100으로 표현합니다.',
    interp:
      '<b class="risk-word">상담 필요형</b>입니다. 점수가 <b>높을수록</b> 은행 자금·대환 상담을 검토할 만한 상황으로 해석합니다. <b>70 이상</b>이면 “높음”입니다.',
    dir: 'negative',
  },
  shinhan_card: {
    calc:
      '반경 내 경쟁점 수와 매출 시계열 변동성(변동계수)을 반영합니다. 경쟁이 치열하고 매출 변동이 크면 카드 매출관리·프로모션 필요도가 올라갑니다.',
    interp:
      '<b class="risk-word">활용 필요형</b>입니다. 점수가 <b>높을수록</b> 카드 가맹·매출관리 도입을 검토할 만합니다. <b>70 이상</b> “높음”.',
    dir: 'negative',
  },
  shinhan_life: {
    calc:
      '업종명에 음식·카페·미용 등 방문형·화재·배상 리스크가 높은 키워드가 있으면 기본 점수를 높여 “보장 점검” 필요도를 표시합니다.',
    interp:
      '점수가 높을수록 사업장 보험·배상 등 <b>보장 점검</b>을 권하는 수준입니다. 실제 가입 여부는 별도 상담이 필요합니다.',
    dir: 'negative',
  },
  shinhan_growth: {
    calc:
      '상권 매력도(35%)·매출 성장성(35%)·부채 체력(30%)을 가중합하여 성장·확장 단계 상담을 검토할 만한지 표시합니다.',
    interp:
      '<b>70점 이상</b>이면 성장지원·확장 검토 여지가 있는 편으로 해석합니다. 종합 재무가 안정돼야 의미가 있습니다.',
    dir: 'positive',
  },
};

function escapeHtml(str) {
  if (str == null || str === '') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildScoreTooltipBody(k, sc) {
  const base = SCORE_TOOLTIP_HELP[k];
  if (!base) return '';
  const parts = [];
  parts.push(`<div class="st-block"><div class="st-label">산출 방법</div><p class="st-text">${base.calc}</p></div>`);
  parts.push(`<div class="st-block"><div class="st-label">점수 보는 법</div><p class="st-text">${base.interp}</p></div>`);

  const dyn = [];
  if (sc.reason && String(sc.reason).trim()) {
    dyn.push(`<div class="st-dyn"><span class="st-dyn-label">이번 분석 관측</span> ${escapeHtml(sc.reason)}</div>`);
  }
  if (sc.message && String(sc.message).trim()) {
    dyn.push(`<div class="st-dyn"><span class="st-dyn-label">해석 메시지</span> ${escapeHtml(sc.message)}</div>`);
  }
  if (k === 'debt' && sc.interest_ratio != null) {
    dyn.push(
      `<div class="st-dyn"><span class="st-dyn-label">수치 스냅샷</span> 이자부담률 ${escapeHtml(String(sc.interest_ratio))}% · 고정비부담률 ${escapeHtml(String(sc.fixed_ratio))}% · 현금보유개월 약 ${escapeHtml(String(sc.cash_months))}개월</div>`,
    );
  }
  if (sc.survival_rate) {
    dyn.push(`<div class="st-dyn"><span class="st-dyn-label">참고</span> 생존율 근거: ${escapeHtml(String(sc.survival_rate))}</div>`);
  }
  if (Array.isArray(sc.services) && sc.services.length) {
    dyn.push(
      `<div class="st-dyn"><span class="st-dyn-label">연계 검토</span> ${sc.services.map(escapeHtml).join(' · ')}</div>`,
    );
  }
  if (dyn.length) parts.push(`<div class="st-block st-dyn-wrap">${dyn.join('')}</div>`);
  parts.push('<p class="st-foot">PoC 룰 기반 추정이며, 실제 심사·상담과 다를 수 있습니다.</p>');
  return parts.join('');
}

function renderScoreGrid(d) {
  const grid = document.getElementById('score-grid');
  const s = d?.scores || {};
  const items = [
    ['attraction',     '상권 매력도'],
    ['growth',         '매출 성장성'],
    ['competition',    '경쟁 강도'],
    ['population',     '유동인구 적합도'],
    ['ecosystem',      '점포 생태계'],
    ['survival',       '업종 생존성'],
    ['rent',           '임대료 부담'],
    ['debt',           '부채 체력'],
    ['shinhan_bank',   '금융 점검 필요성'],
    ['shinhan_card',   '카드 활용도'],
    ['shinhan_life',   '보험 점검 필요성'],
    ['shinhan_growth', '성장지원 가능성'],
  ];
  grid.innerHTML = items.map(([k, name]) => {
    const sc = s[k];
    if (!sc) return '';
    const direction = sc.direction === 'negative' ? 'risk' : 'fit';
    const score = (sc.score || 0).toFixed?.(0) || sc.score;
    const ttId = `score-tt-${k}`;
    const tipBody = buildScoreTooltipBody(k, sc);
    return `
      <div class="score-card-wrap">
        <div class="score-card ${direction}">
          <div class="score-head">
            <div class="score-name">${name}</div>
            <button type="button" class="score-info-btn" aria-label="${escapeHtml(name)} 지표 상세 설명" aria-describedby="${ttId}">i</button>
          </div>
          <div class="score-bar"><div class="score-fill" style="width:${sc.score}%;background:${sc.color || '#3b82f6'}"></div></div>
          <div class="score-meta">
            <span class="score-value">${score}</span>
            <span class="score-label" style="color:${sc.color || '#374151'}">${sc.label || '-'}</span>
          </div>
        </div>
        <div class="score-tooltip" id="${ttId}" role="tooltip">
          <div class="score-tooltip-title">${name}</div>
          <div class="score-tooltip-body">${tipBody}</div>
        </div>
      </div>`;
  }).join('');
}

// ── Tab: 상권 요약 ──────────────────────────────────────────────────────────
function renderOverviewTab(d) {
  const ss = d?.store_summary || {};
  const wrap = document.getElementById('tab-overview');
  wrap.innerHTML = `
    <h3 class="tab-title">상권 종합 진단</h3>
    <p class="tab-desc">선택 상권의 점포·인구·운영 지표 요약입니다.</p>
    <div class="kpi-grid">
      ${kpi('점포 수',          fmtInt(ss.store_count))}
      ${kpi('개업 점포',        fmtInt(ss.open_count))}
      ${kpi('폐업 점포',        fmtInt(ss.close_count))}
      ${kpi('프랜차이즈',       fmtInt(ss.franchise_count))}
      ${kpi('폐업률',           ss.closure_rate ?? '-')}
      ${kpi('유동인구',          fmtInt(ss.floating_pop))}
      ${kpi('상주인구',          fmtInt(ss.resident_pop))}
      ${kpi('직장인구',          fmtInt(ss.worker_pop))}
    </div>

    <div class="info-box">
      <div class="info-title">데이터 기반 해석</div>
      <div class="info-body">${overviewNarrative(d)}</div>
    </div>
  `;
}

function overviewNarrative(d) {
  const att = d?.scores?.attraction;
  const comp = d?.scores?.competition;
  const grw = d?.scores?.growth;
  if (!att) return '데이터가 충분하지 않습니다.';
  return `해당 상권의 매력도는 <b>${att.score}점(${att.label})</b>이며, 매출 성장성은 <b>${grw?.score ?? '-'}점(${grw?.label || '-'})</b>입니다. 경쟁 강도는 <b>${comp?.score ?? '-'}점(${comp?.label || '-'})</b>로, ${comp?.score >= 60 ? '동일 업종 점포가 많고 경쟁이 강한 편이므로 차별화 전략이 필요합니다.' : '아직 진입 여지가 있는 편입니다.'}`;
}

// ── Tab: 매출·점포 추이 ───────────────────────────────────────────────────
async function ensureRadiusExpansionForTrend() {
  if (State.radiusExpansion && State.radiusExpansion.message) return;
  if (!State.area_code || !State.service_name) return;
  try {
    if (State.mapPrePromise) {
      const pdata = await State.mapPrePromise;
      if (pdata && pdata.radius_expansion) State.radiusExpansion = pdata.radius_expansion;
    }
  } catch (_) { /* preload 실패 시 아래에서 단독 요청 */ }
  if (State.radiusExpansion && State.radiusExpansion.message) return;
  try {
    const params = new URLSearchParams({
      area_code: State.area_code,
      service_name: State.service_name || '',
    });
    if (State.customCenter) {
      params.append('lat', State.customCenter[0]);
      params.append('lon', State.customCenter[1]);
    }
    const pdata = await fetchJson('/api/competitors?' + params);
    if (pdata && pdata.radius_expansion) State.radiusExpansion = pdata.radius_expansion;
  } catch (_) {}
}

async function renderTrendTab() {
  const d = State.result;
  if (!d) return;
  await ensureRadiusExpansionForTrend();
  const t = d.trends || {};
  const rx = State.radiusExpansion;
  const radiusNotice =
    rx && rx.message
      ? `<div class="info-box trend-radius-notice" role="status"><div class="info-body">${escapeHtml(
          rx.message,
        )}</div></div>`
      : '';
  const wrap = document.getElementById('tab-trend');
  wrap.innerHTML = `
    <h3 class="tab-title">매출·점포 추이</h3>
    <p class="tab-desc">최근 8분기 추정매출, 점포 수, 개·폐업, 유동인구 변화입니다.</p>
    ${radiusNotice}
    <div class="chart-grid">
      <div class="chart-wrap"><div class="chart-title">분기별 추정매출</div><canvas id="ch-sales"  height="160"></canvas></div>
      <div class="chart-wrap"><div class="chart-title">점포 수 변화</div>      <canvas id="ch-store"  height="160"></canvas></div>
      <div class="chart-wrap"><div class="chart-title">개업 / 폐업 점포</div>  <canvas id="ch-open"   height="160"></canvas></div>
      <div class="chart-wrap"><div class="chart-title">유동인구</div>          <canvas id="ch-fp"     height="160"></canvas></div>
    </div>
    <div class="info-box">
      <div class="info-title">해석</div>
      <div class="info-body">${trendNarrative(t)}</div>
    </div>
  `;
  destroyCharts();
  setTimeout(() => {
    drawLineChart('ch-sales', t.sales,  '추정매출', '#1a56db');
    drawLineChart('ch-store', t.stores, '점포 수',  '#16a34a');
    drawDualBar  ('ch-open',  t.open, t.close, '개업', '폐업', '#3b82f6', '#ef4444');
    drawLineChart('ch-fp',    t.fp,    '유동인구', '#9333ea');
  }, 50);
}

function trendNarrative(t) {
  const sales = t.sales || [];
  if (sales.length < 2) return '추이 데이터가 부족합니다.';
  const last = sales[sales.length - 1].값;
  const prev = sales[sales.length - 2].값;
  const chg = prev ? ((last - prev) / prev * 100) : 0;
  const dir = chg >= 0 ? '증가' : '감소';
  return `최근 분기 매출은 직전 분기 대비 <b>${chg.toFixed(1)}%</b> ${dir}했습니다.
  점포 수와 함께 추적하여 시장 확장과 경쟁 심화가 동시에 일어나는지 확인이 필요합니다.`;
}

// ── 지도 공통: 인스턴스 정리 (탭 전환·재분석 시) ───────────────────────────
function destroyMapView() {
  try {
    if (State.mapEngine === 'leaflet' && State.map && typeof State.map.remove === 'function') {
      State.map.remove();
    }
  } catch (e) { /* noop */ }
  State.map = null;
  State.mapEngine = null;
  State.mapMarkers = [];
  State.circles = {};
  State.centerOverlay = null;
  State.leafletTileLayers = null;
}

let _leafletLoadPromise = null;
function ensureLeaflet() {
  if (window.L) return Promise.resolve();
  if (!_leafletLoadPromise) {
    _leafletLoadPromise = (async () => {
      if (!document.querySelector('link[data-leaflet-css="1"]')) {
        await new Promise((resolve, reject) => {
          const l = document.createElement('link');
          l.rel = 'stylesheet';
          l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
          l.setAttribute('data-leaflet-css', '1');
          l.onload = () => resolve();
          l.onerror = () => reject(new Error('Leaflet CSS 로드 실패'));
          document.head.appendChild(l);
        });
      }
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Leaflet JS 로드 실패'));
        document.head.appendChild(s);
      });
    })();
  }
  return _leafletLoadPromise;
}

// ── Tab: 경쟁점 지도 (OpenStreetMap · Leaflet 전용 — 카카오 지도 SDK 미사용) ─
async function renderMapTab() {
  destroyMapView();
  const wrap = document.getElementById('tab-map');
  wrap.innerHTML = `
    <h3 class="tab-title">경쟁점 지도</h3>
    <p class="tab-desc">OpenStreetMap 기반 지도(Leaflet)로 동일·유사 업종 점포를 표시합니다. 검색으로 다른 위치를 고르면 그 좌표 기준으로 경쟁점이 다시 계산됩니다.</p>
    <div class="map-toolbar">
      <div class="map-legend">
        <span class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span>300m</span>
        <span class="legend-item"><span class="legend-dot" style="background:#16a34a"></span>500m</span>
        <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>1km</span>
        <span class="legend-item"><span class="legend-pin" style="background:#1a56db"></span>동일 업종</span>
        <span class="legend-item"><span class="legend-pin" style="background:#94a3b8"></span>기타 업종</span>
      </div>
      <div class="map-style-toggle" id="map-style-toggle">
        <button class="map-style-btn active" data-style="ROADMAP" data-leaflet-style="voyager">기본</button>
        <button class="map-style-btn" data-style="HYBRID" data-leaflet-style="light">라이트</button>
        <button class="map-style-btn" data-style="SKYVIEW" data-leaflet-style="dark">다크</button>
      </div>
    </div>
    <div class="map-grid">
      <div class="map-container">
        <div id="competitor-map" style="height:540px"></div>
        <div class="map-search">
          <input type="text" id="map-place-q" placeholder="장소 검색 (예: 강남역 스타벅스) · 서버 키 설정 시 카카오 로컬 검색">
          <button class="btn btn-primary btn-sm" id="map-place-go">검색</button>
          <button class="btn btn-ghost btn-xs" id="map-place-reset" title="원래 상권 중심으로 돌아가기">초기화</button>
          <div class="map-search-results" id="map-place-results"></div>
        </div>
      </div>
      <div class="competitor-side" id="competitor-side">
        <div class="side-head">
          <div class="side-title">반경별 경쟁점 리스트</div>
          <div class="side-filter">
            <button class="dist-btn active" data-r="300">300m</button>
            <button class="dist-btn" data-r="500">500m</button>
            <button class="dist-btn" data-r="1000">1km</button>
            <label class="same-only"><input type="checkbox" id="chk-same-only" checked> 동일업종만</label>
          </div>
        </div>
        <div class="side-list" id="competitor-list">로딩 중…</div>
        <div class="side-interp" id="competitor-interp"></div>
      </div>
    </div>
    <div class="competitor-summary" id="competitor-summary">로딩 중…</div>
  `;

  const [leafRes, dataRes] = await Promise.allSettled([
    ensureLeaflet(),
    fetchCompetitorsPayload(),
  ]);

  if (leafRes.status === 'rejected') {
    const err = leafRes.reason;
    showMapDisabled(err && err.message ? err.message : String(err));
    if (dataRes.status === 'fulfilled') {
      const data = dataRes.value;
      State.competitors = (data.stores || []).map((s, i) => ({ ...s, _idx: i }));
      if (data.radius_expansion) State.radiusExpansion = data.radius_expansion;
      State.competitorExpansion = {
        expansion: data.expansion || null,
        extended_same: data.extended_same || [],
        reference_nearby_other: data.reference_nearby_other || [],
      };
      renderCompetitorSummary(data);
      renderCompetitorList();
      renderCompetitorInterpretation(data);
    } else {
      document.getElementById('competitor-summary').innerHTML =
        '<div class="info-box"><div class="info-body">경쟁점 데이터를 불러오지 못했습니다.</div></div>';
      document.getElementById('competitor-list').innerHTML =
        '<div class="muted">데이터를 불러오지 못했습니다.</div>';
    }
    return;
  }

  if (dataRes.status === 'rejected') {
    document.getElementById('competitor-summary').innerHTML =
      '<div class="info-box"><div class="info-body">경쟁점 데이터를 불러오지 못했습니다.</div></div>';
    document.getElementById('competitor-list').innerHTML =
      '<div class="muted">데이터를 불러오지 못했습니다.</div>';
    return;
  }

  State.mapEngine = 'leaflet';
  applyCompetitorDraw(dataRes.value, { initial: true });

  document.querySelectorAll('.dist-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.dist-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      State.activeRadius = Number(b.dataset.r);
      focusRadius(State.activeRadius);
      renderCompetitorList();
    });
  });
  document.getElementById('chk-same-only').addEventListener('change', renderCompetitorList);

  document.querySelectorAll('.map-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchLeafletTiles(btn.dataset.leafletStyle || 'voyager', btn);
    });
  });

  document.getElementById('map-place-go').addEventListener('click', mapPlaceSearch);
  document.getElementById('map-place-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); mapPlaceSearch(); }
  });
  document.getElementById('map-place-reset').addEventListener('click', resetMapCenterToArea);
}

function showMapDisabled(msg) {
  const safe = escapeHtml(msg || '');
  const el = document.getElementById('competitor-map');
  if (el) {
    el.innerHTML = `
      <div class="map-disabled">
        <div class="map-disabled-title">지도를 표시할 수 없습니다</div>
        <div class="map-disabled-body">${safe}</div>
        <div class="map-disabled-hint">
          <strong>확인 순서</strong><br>
          1) 네트워크에서 Leaflet CDN(<code>unpkg.com/leaflet</code>)이 차단되지 않았는지, 광고 차단을 잠시 끄고 새로고침해 보세요.<br>
          2) 회사망·방화벽에서 외부 스크립트/CDN 접속이 막혀 있을 수 있습니다.<br>
          <div id="map-diagnostic-slot" class="map-diagnostic-slot"></div>
        </div>
      </div>`;
  }
  const list = document.getElementById('competitor-list');
  if (list) list.innerHTML = '<div class="muted">지도를 사용할 수 없어 경쟁점 표시를 건너뜁니다.</div>';
  const sum = document.getElementById('competitor-summary');
  if (sum) sum.innerHTML = '<div class="info-box"><div class="info-body">Leaflet(OpenStreetMap) 라이브러리를 불러오지 못해 지도를 표시할 수 없습니다.</div></div>';
}

/** 현재 상권·업종·검색중심 기준 경쟁점 API 키 (선조회 캐시 일치용) */
function competitorRequestKey() {
  const cc = State.customCenter;
  const latlon = cc ? `${Number(cc[0]).toFixed(6)},${Number(cc[1]).toFixed(6)}` : '';
  return `${State.area_code}|${State.service_name || ''}|${latlon}`;
}

/**
 * 분석 로딩 패널이 떠 있는 동안 Leaflet·경쟁점 API를 미리 불러 옵니다.
 */
function preloadMapDuringAnalysis() {
  if (!State.area_code) return;
  const reqKey = competitorRequestKey();
  State.mapPreKey = reqKey;
  State.mapPreData = null;
  State.mapPrePromise = null;
  State.radiusExpansion = null;

  ensureLeaflet().catch(() => {});

  State.mapPrePromise = (async () => {
    const params = new URLSearchParams({
      area_code: State.area_code,
      service_name: State.service_name || '',
    });
    if (State.customCenter) {
      params.append('lat', State.customCenter[0]);
      params.append('lon', State.customCenter[1]);
    }
    const data = await fetchJson('/api/competitors?' + params);
    if (competitorRequestKey() === reqKey && State.mapPreKey === reqKey) {
      State.mapPreData = data;
      if (data && data.radius_expansion) State.radiusExpansion = data.radius_expansion;
    }
    return data;
  })().catch(e => {
    console.warn('[map preload] 경쟁점 선조회 실패:', e);
    return null;
  });
}

async function fetchCompetitorsPayload() {
  const reqKey = competitorRequestKey();
  const params = new URLSearchParams({
    area_code: State.area_code,
    service_name: State.service_name || '',
  });
  if (State.customCenter) {
    params.append('lat', State.customCenter[0]);
    params.append('lon', State.customCenter[1]);
  }

  let data;
  if (State.mapPreKey === reqKey && State.mapPreData) {
    data = State.mapPreData;
    State.mapPreData = null;
    State.mapPrePromise = null;
    State.mapPreKey = null;
  } else if (State.mapPreKey === reqKey && State.mapPrePromise) {
    data = await State.mapPrePromise;
    if (competitorRequestKey() !== reqKey) data = null;
    State.mapPreData = null;
    State.mapPrePromise = null;
    State.mapPreKey = null;
  }
  if (!data) {
    data = await fetchJson('/api/competitors?' + params);
  }
  return data;
}

function applyCompetitorDraw(data, { initial = false } = {}) {
  if (!data) return;
  State.competitors = (data.stores || []).map((s, i) => ({ ...s, _idx: i }));
  if (data.radius_expansion) State.radiusExpansion = data.radius_expansion;
  State.competitorExpansion = {
    expansion: data.expansion || null,
    extended_same: data.extended_same || [],
    reference_nearby_other: data.reference_nearby_other || [],
  };
  drawLeafletMap(data, { initial });
  renderCompetitorSummary(data);
  renderCompetitorList();
  renderCompetitorInterpretation(data);
}

async function loadCompetitorsAndDraw({ initial = false } = {}) {
  let data;
  try {
    data = await fetchCompetitorsPayload();
  } catch (e) {
    document.getElementById('competitor-summary').innerHTML =
      '<div class="info-box"><div class="info-body">경쟁점 데이터를 불러오지 못했습니다.</div></div>';
    document.getElementById('competitor-list').innerHTML =
      '<div class="muted">데이터를 불러오지 못했습니다.</div>';
    return;
  }
  applyCompetitorDraw(data, { initial });
}

function buildLeafletTileLayers(map) {
  const L = window.L;
  return {
    voyager: L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; CARTO &copy; OpenStreetMap' },
    ),
    light: L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; CARTO &copy; OpenStreetMap' },
    ),
    dark: L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; CARTO &copy; OpenStreetMap' },
    ),
  };
}

function switchLeafletTiles(name, btn) {
  if (!State.map || !State.leafletTileLayers) return;
  const layers = State.leafletTileLayers;
  Object.values(layers).forEach(l => { try { State.map.removeLayer(l); } catch (e) { /* */ } });
  const next = layers[name] || layers.voyager;
  next.addTo(State.map);
  document.querySelectorAll('.map-style-btn').forEach(b => b.classList.toggle('active', b === btn));
}

function drawLeafletMap(data, { initial }) {
  const L = window.L;
  const [lat, lon] = data.center || [37.5665, 126.9780];
  const center = [lat, lon];
  const el = document.getElementById('competitor-map');
  if (!el) return;

  if (State.map && State.mapEngine === 'leaflet') {
    try { State.map.remove(); } catch (e) { /* */ }
    State.map = null;
  }

  State.map = L.map(el, { zoomControl: true, preferCanvas: true }).setView(center, 16);
  State.mapEngine = 'leaflet';
  State.leafletTileLayers = buildLeafletTileLayers(State.map);
  State.leafletTileLayers.voyager.addTo(State.map);

  State.circles = {};
  State.circles[1000] = L.circle(center, {
    radius: 1000, color: '#ef4444', weight: 1.2, fillColor: '#ef4444', fillOpacity: 0.04, dashArray: '6 6',
  }).addTo(State.map);
  State.circles[500] = L.circle(center, {
    radius: 500, color: '#16a34a', weight: 1.2, fillColor: '#16a34a', fillOpacity: 0.06, dashArray: '6 6',
  }).addTo(State.map);
  State.circles[300] = L.circle(center, {
    radius: 300, color: '#3b82f6', weight: 1.5, fillColor: '#3b82f6', fillOpacity: 0.10,
  }).addTo(State.map);

  const centerLabel = (data.center_source === 'custom')
    ? '검색 위치'
    : (State.area_name || '선택 상권');
  const pin = L.divIcon({
    className: 'leaflet-center-pin-wrap',
    html: `<div class="kakao-center-pin"><div class="center-pin-pulse"></div><div class="center-pin-dot"></div><div class="kakao-center-label">${centerLabel}</div></div>`,
    iconSize: [140, 56], iconAnchor: [70, 28],
  });
  L.marker(center, { icon: pin, zIndexOffset: 1000 }).addTo(State.map);

  State.mapMarkers = [];
  State.competitors.forEach((s, i) => {
    if (s['위도'] == null || s['경도'] == null) return;
    const same = !!s.is_same;
    const color = same ? '#1a56db' : '#94a3b8';
    const marker = L.circleMarker([s['위도'], s['경도']], {
      radius: same ? 7 : 5,
      color, fillColor: color, fillOpacity: same ? 0.85 : 0.45, weight: same ? 2 : 1,
    }).bindPopup(`<div class="map-popup">${buildStorePopupHTML(s)}</div>`, { maxWidth: 260 });
    marker.addTo(State.map);
    State.mapMarkers.push({ marker, store: s, iw: null, position: marker.getLatLng() });
  });

  if (initial) State.map.setView(center, 16);
  focusRadius(State.activeRadius || 300);

  if (State.map && typeof State.map.invalidateSize === 'function') {
    requestAnimationFrame(() => {
      try {
        State.map.invalidateSize({ animate: false });
      } catch (e) { /* noop */ }
    });
  }
}

function openStoreInfo(idx) {
  const m = State.mapMarkers[idx];
  if (!m || !State.map) return;
  if (m.marker) {
    m.marker.openPopup();
    State.map.flyTo(m.marker.getLatLng(), 17, { animate: true, duration: 0.45 });
  }
}

function buildStorePopupHTML(s) {
  const same = !!s.is_same;
  const cat = s['상권업종소분류명'] || s['상권업종중분류명'] || '업종 정보 없음';
  const addr = s['도로명주소'] || s['지번주소'] || '';
  return `
    <b>${s['상호명'] || '-'}</b>
    <div class="muted">${cat}</div>
    ${addr ? `<div class="muted">${addr}</div>` : ''}
    <div class="muted">거리: ${s.dist ?? 0}m ${same ? '<span class="pop-tag">동일 업종</span>' : ''}</div>`;
}

function renderCompetitorSummary(data) {
  const c = data.counts || {};
  const hints = (data.expansion && data.expansion.hints) || [];
  const hintHtml =
    hints.length > 0
      ? `<div class="info-box comp-expansion-hints" style="margin-top:12px">
          <div class="info-title">범위 확장·참고 안내</div>
          <div class="info-body">${hints.map(h => `<div class="comp-hint-line">${escapeHtml(h)}</div>`).join('')}</div>
        </div>`
      : '';
  const sumEl = document.getElementById('competitor-summary');
  sumEl.innerHTML = `
    <div class="comp-grid">
      ${compChipBtn('300m 이내 전체',  c['300']  ?? '-', '#3b82f6', 300, false)}
      ${compChipBtn('500m 이내 전체',  c['500']  ?? '-', '#16a34a', 500, false)}
      ${compChipBtn('1km 이내 전체',   c['1000'] ?? '-', '#ef4444', 1000, false)}
      ${compChipBtn('300m 동일업종',   c.same_300  ?? '-', '#1a56db', 300, true)}
      ${compChipBtn('500m 동일업종',   c.same_500  ?? '-', '#1a56db', 500, true)}
      ${compChipBtn('1km 동일업종',    c.same_1000 ?? '-', '#1a56db', 1000, true)}
    </div>
    ${hintHtml}
    <div class="info-box" style="margin-top:14px">
      <div class="info-title">사용 팁</div>
      <div class="info-body">반경 카드를 클릭하면 줌·원 강조가 바뀌고 리스트가 필터링됩니다. 지도 위 검색은 서버의 장소 검색 API를 사용하며, <code>.env</code>에 <code>KAKAO_REST_API_KEY</code>가 있으면 키워드 결과가 풍부해집니다.</div>
    </div>`;
  document.querySelectorAll('.comp-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = Number(btn.dataset.r);
      const same = btn.dataset.same === 'true';
      State.activeRadius = r;
      document.querySelectorAll('.dist-btn').forEach(b =>
        b.classList.toggle('active', Number(b.dataset.r) === r));
      const chk = document.getElementById('chk-same-only');
      if (chk) chk.checked = same;
      focusRadius(r);
      renderCompetitorList();
    });
  });
}

function renderCompetitorInterpretation(data) {
  const c = data.counts || {};
  const same300 = c.same_300 ?? 0;
  const same500 = c.same_500 ?? 0;
  const all500  = c['500']    ?? 0;
  const ratio = all500 > 0 ? Math.round(same500 / all500 * 100) : 0;
  const nExt = (data.extended_same || []).length;
  const nRef = (data.reference_nearby_other || []).length;

  let level, text;
  if (same300 >= 10) {
    level = 'high';
    text = `반경 300m 이내 동일 업종 점포가 <b>${same300}곳</b>으로 매우 밀집된 시장입니다. 신규 고객 확보보다 <b>재방문율 강화</b>와 <b>시간대별 매출 분산</b>이 핵심입니다.`;
  } else if (same300 >= 4) {
    level = 'mid';
    text = `반경 300m 이내 동일 업종 ${same300}곳, 500m ${same500}곳입니다. 경쟁 강도는 <b>중간</b> 수준이며 <b>차별화 메뉴/가격대</b>로 충분히 대응 가능합니다.`;
  } else if (same300 === 0 && (nExt > 0 || nRef > 0)) {
    level = 'low';
    const parts = [];
    if (nExt) parts.push(`행정동·구 단위로 유사 동일 업종 <b>${nExt}건</b>을 참고로 모았습니다`);
    if (nRef) parts.push(`반경 2km 내 다른 업종 점포 <b>${nRef}건</b> 거리 참고`);
    text = `좁은 반경에서는 동일 업종이 거의 없습니다. ${parts.join(', ')}. 우측 목록에서 상호를 누르면 지도가 해당 위치로 이동합니다.`;
  } else {
    level = 'low';
    text = `반경 300m 이내 동일 업종이 ${same300}곳으로 비교적 한산합니다. <b>신규 수요 발굴</b>과 <b>홍보·체험 마케팅</b>에 무게를 두는 전략이 유효합니다.`;
  }
  const interp = document.getElementById('competitor-interp');
  if (!interp) return;
  interp.innerHTML = `
    <div class="interp-card interp-${level}">
      <div class="interp-head">경쟁 강도 해석</div>
      <div class="interp-body">${text}</div>
      <div class="interp-meta">동일업종 비중(500m): <b>${ratio}%</b></div>
    </div>`;
}

function compChipBtn(label, value, color, radius, sameOnly) {
  return `
    <button class="comp-chip comp-chip-btn" data-r="${radius}" data-same="${sameOnly}">
      <div class="comp-chip-label">${label}</div>
      <div class="comp-chip-value" style="color:${color}">${value}<span>곳</span></div>
    </button>`;
}

function panMapToStoreLatLng(lat, lon) {
  if (!State.map || lat == null || lon == null) return;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
  State.map.setView([la, lo], 17, { animate: true });
}

function focusRadius(r) {
  if (!State.map || !State.circles) return;
  Object.entries(State.circles).forEach(([k, c]) => {
    const active = Number(k) === r;
    c.setStyle({
      weight: active ? 3 : 1.2,
      fillOpacity: active ? 0.18 : 0.04,
      dashArray: active ? null : '6 6',
    });
  });
  const z = r <= 300 ? 17 : r <= 500 ? 16 : 15;
  State.map.setZoom(z);
}

function renderCompetitorList() {
  const listEl = document.getElementById('competitor-list');
  if (!listEl) return;
  const r = State.activeRadius || 300;
  const sameOnly = document.getElementById('chk-same-only')?.checked;
  const arr = (State.competitors || [])
    .filter(s => (s.dist ?? 9999) <= r)
    .filter(s => !sameOnly || s.is_same)
    .slice(0, 80);

  const cx = State.competitorExpansion || {};
  const extSame = cx.extended_same || [];
  const refOther = cx.reference_nearby_other || [];

  const rowHtml = (s, opts = {}) => {
    const mappedIdx = opts.mappedIdx;
    const badge = opts.badge || '';
    const extraClass = opts.extraClass || '';
    const lat = s['위도'];
    const lon = s['경도'];
    const flyOnly = opts.flyOnly === true;
    const idxAttr =
      mappedIdx !== undefined && mappedIdx !== null && !flyOnly ? `data-mapped-idx="${mappedIdx}"` : '';
    return `
    <div class="comp-row ${s.is_same ? 'same' : ''} ${extraClass}"
      ${idxAttr}
      data-lat="${lat != null ? lat : ''}" data-lon="${lon != null ? lon : ''}">
      <div class="comp-row-head">
        <div class="comp-row-name">${escapeHtml(s['상호명'] || '-')}</div>
        <div class="comp-row-dist-wrap">
          ${badge ? `<span class="comp-scope-badge">${badge}</span>` : ''}
          <div class="comp-row-dist">${s.dist ?? 0}m</div>
        </div>
      </div>
      <div class="comp-row-cat">${escapeHtml(s['상권업종소분류명'] || s['상권업종중분류명'] || '-')}${
        s.is_same ? ' · <span class="pop-tag">동일</span>' : ''
      }</div>
    </div>`;
  };

  let html = '';

  if (arr.length > 0) {
    html = arr.map(s => rowHtml(s, { mappedIdx: s._idx })).join('');
  } else if (sameOnly && extSame.length > 0) {
    html = `
      <div class="info-box comp-expand-intro">
        <div class="info-title">동일 업종 · 행정동→구 확장</div>
        <div class="info-body">
          선택 반경 안에는 동일 업종이 없습니다. 분석 중심과 가까운 행정동·자치구 범위에서 같은 업종 점포를 불러왔습니다. 행을 누르면 지도가 해당 위치로 이동합니다.
        </div>
      </div>`;
    html += extSame
      .map(s => {
        const scope = s.extended_scope === 'gu' ? '구' : '동';
        return rowHtml(s, { flyOnly: true, extraClass: 'comp-row-extended', badge: scope });
      })
      .join('');
  } else if (sameOnly && refOther.length > 0) {
    html = `
      <div class="info-box comp-expand-intro">
        <div class="info-title">근처 다른 업종 참고</div>
        <div class="info-body">
          동일 업종은 주변에 거의 없습니다. 반경 2km 안의 다른 업종 점포 거리를 참고하세요.
        </div>
      </div>`;
    html += refOther
      .map(s => rowHtml(s, { flyOnly: true, extraClass: 'comp-row-ref', badge: '참고' }))
      .join('');
  } else if (!sameOnly && arr.length === 0 && (State.competitors || []).length === 0 && refOther.length > 0) {
    html = `
      <div class="info-box comp-expand-intro"><div class="info-body">이 위치 근처 상가 데이터가 적습니다. 아래는 참고용 인근 점포입니다.</div></div>`;
    html += refOther.map(s => rowHtml(s, { flyOnly: true, extraClass: 'comp-row-ref', badge: '참고' })).join('');
  } else {
    html = `<div class="muted">반경 ${r}m 이내 ${sameOnly ? '동일 업종 ' : ''}경쟁점이 없습니다.</div>`;
    if (sameOnly && extSame.length === 0 && refOther.length > 0) {
      html += `
        <div class="muted comp-fallback-note" style="margin-top:10px">동일 업종만 보기 해제 시 기타 업종이 표시되거나, 아래 참고 목록을 확인하세요.</div>
        <div class="comp-ref-block-title">반경 2km · 다른 업종 참고</div>`;
      html += refOther
        .map(s => rowHtml(s, { flyOnly: true, extraClass: 'comp-row-ref', badge: '참고' }))
        .join('');
    }
  }

  listEl.innerHTML = html;
  listEl.querySelectorAll('.comp-row').forEach(row => {
    row.addEventListener('click', () => {
      if (row.dataset.mappedIdx !== undefined && row.dataset.mappedIdx !== '') {
        openStoreInfo(Number(row.dataset.mappedIdx));
        return;
      }
      panMapToStoreLatLng(row.dataset.lat, row.dataset.lon);
    });
  });
}

// ── 지도 위 장소 검색 (서버 /api/external-search → 카카오 로컬 REST 또는 안내) ─
async function mapPlaceSearch() {
  const inp = document.getElementById('map-place-q');
  const resBox = document.getElementById('map-place-results');
  const q = (inp && inp.value ? inp.value : '').trim();
  if (!q) {
    if (resBox) resBox.innerHTML = '';
    return;
  }
  resBox.innerHTML = '<div class="muted">검색 중…</div>';
  try {
    const res = await fetchJson('/api/external-search?q=' + encodeURIComponent(q));
    const places = res.local_places || [];
    const errHint = res.errors && res.errors.local ? String(res.errors.local) : '';
    if (!places.length) {
      const fallback =
        errHint ||
        '검색 결과가 없습니다. 서버에 KAKAO_REST_API_KEY가 설정되어 있으면 장소 검색이 활성화됩니다.';
      resBox.innerHTML = `<div class="muted">${escapeHtml(fallback)}</div>`;
      return;
    }
    resBox.innerHTML = places.slice(0, 8).map((p, i) => `
      <div class="ks-row" data-idx="${i}">
        <div class="ks-name">${escapeHtml(p.title || '')}</div>
        <div class="ks-meta">${escapeHtml(p.category_group || p.category || '')}</div>
        <div class="ks-meta muted">${escapeHtml(p.address || '')}</div>
      </div>`).join('');
    resBox.querySelectorAll('.ks-row').forEach(row => {
      row.addEventListener('click', async () => {
        const i = Number(row.dataset.idx);
        const p = places[i];
        if (p.lat == null || p.lon == null) return;
        await moveCenterToPlace(Number(p.lat), Number(p.lon), p.title || '');
        resBox.innerHTML = '';
        inp.value = p.title || '';
      });
    });
  } catch (e) {
    resBox.innerHTML = `<div class="muted">${escapeHtml(e.message || String(e))}</div>`;
  }
}

async function moveCenterToPlace(lat, lon, label) {
  State.customCenter = [lat, lon];
  if (State.map) {
    State.map.setView([lat, lon], State.map.getZoom(), { animate: true });
  }
  await loadCompetitorsAndDraw({ initial: false });
}

async function resetMapCenterToArea() {
  State.customCenter = null;
  const q = document.getElementById('map-place-q');
  if (q) q.value = '';
  const res = document.getElementById('map-place-results');
  if (res) res.innerHTML = '';
  await loadCompetitorsAndDraw({ initial: false });
}

// ── Tab: 자금·손익분기점 ──────────────────────────────────────────────────
function renderFinanceTab(d) {
  destroyFinanceCharts();
  const f = financeForResultView(d);
  const loanB = Number(f.loan_balance || 0);
  const userInput = State.finance || {};
  const tag = (key) => (userInput[key] !== undefined && userInput[key] !== null && userInput[key] !== '')
    ? '<span class="src-tag src-user">입력값</span>'
    : '<span class="src-tag src-mock">합성/가정</span>';

  const wrap = document.getElementById('tab-finance');
  const isMockHeavy = !['monthly_sales','rent','labor_cost','loan_balance','interest_rate','cash_balance']
    .some(k => userInput[k] !== undefined && userInput[k] !== '');

  wrap.innerHTML = `
    <h3 class="tab-title">자금·손익분기점 시뮬레이션</h3>
    <p class="tab-desc">
      입력하신 사업 조건과 ${isMockHeavy ? '<b>합성(목업) 점포 데이터</b>' : '일부 합성 가정'}을 결합해 산출한 시뮬레이션 결과입니다.
      각 KPI 우측의 태그는 데이터 출처를 의미합니다.
    </p>

    ${isMockHeavy ? `
      <div class="mock-banner">
        ⚠ 사용자 입력 사업 조건이 거의 없어, 본 화면의 수치는 대부분 PoC용 <b>합성 점포 데이터</b>로 채워졌습니다.
        ${State.finance_skipped ? '<b>사업 조건 입력을 건너뛴</b> 경우입니다. ' : ''}
        실제 컨설팅 시에는 <b>분석 시작</b> 단계에서 매출·임대료·인건비·대출 등을 입력해 주세요.
      </div>` : ''}

    <div class="finance-charts-section">
      <h4 class="finance-charts-heading">그래프로 보는 자금·손익</h4>
      <p class="finance-charts-lead">
        예상 매출과 손익분기 매출을 비교하고, 보유 현금 대비 조달 참고액·월별 비용·대출 관련 현금 유출을 한눈에 볼 수 있습니다.
      </p>
      <div class="finance-charts-grid">
        <div class="fin-chart-card">
          <div class="fin-chart-h">① 매출 · 손익분기 · 권장 운영자금(3개월)</div>
          <p class="fin-chart-desc">월매출이 손익분기 이상인지, 고정비 약 3개월분(권장 운영자금) 규모와 함께 확인합니다.</p>
          <div class="fin-chart-canvas"><canvas id="fin-chart-be"></canvas></div>
        </div>
        <div class="fin-chart-card">
          <div class="fin-chart-h">② 보유 현금 vs 추가 조달(추정)</div>
          <p class="fin-chart-desc">초기 소요(추정) 대비 보유 현금과 부족분(참고) 비율입니다. 실제 대출 한도와 다를 수 있습니다.</p>
          <div class="fin-chart-canvas"><canvas id="fin-chart-gap"></canvas></div>
        </div>
        <div class="fin-chart-card">
          <div class="fin-chart-h">③ 월 비용 구조(임대·인건비·이자·변동비)</div>
          <p class="fin-chart-desc">매출 대비 비용 비중을 파악해 손익분기와 운영 여력을 해석합니다.</p>
          <div class="fin-chart-canvas"><canvas id="fin-chart-cost"></canvas></div>
        </div>
        <div class="fin-chart-card">
          <div class="fin-chart-h">④ 월 현금 유출 · 대출</div>
          <p class="fin-chart-desc">이자·원리금 상환·임대·인건비 등 월 단위 부담을 동일 스케일로 비교합니다.
            ${loanB > 0 ? `<span class="fin-loan-note">대출 잔액(참고): <b>${fmtMoney(loanB)}</b></span>` : ''}
          </p>
          <div class="fin-chart-canvas"><canvas id="fin-chart-loan"></canvas></div>
        </div>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiTag('월 매출',          fmtMoney(f.monthly_sales),     tag('monthly_sales'))}
      ${kpiTag('월 임대료',        fmtMoney(f.rent),              tag('rent'))}
      ${kpiTag('월 인건비',        fmtMoney(f.labor_cost),        tag('labor_cost'))}
      ${kpiTag('월 이자',          fmtMoney(f.monthly_interest),  '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('월 고정비',        fmtMoney(f.fixed_cost),        '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('월 변동비',        fmtMoney(f.variable_cost),     '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('순이익(추정)',     fmtMoney(f.net_profit),        '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('손익분기 매출',    fmtMoney(f.break_even),        '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('초기 소요(추정)', fmtMoney(f.initial_investment), '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('자기자본',         fmtMoney(f.own_capital ?? f.cash_balance), tag('own_capital'))}
      ${kpiTag('추정 부족분(조달)', fmtMoney(f.funding_gap_estimate), '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('필요 대출(추정)',  fmtMoney(f.loan_needed_estimate ?? f.funding_gap_estimate), '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('필요 대출 월 이자', fmtMoney(f.loan_monthly_interest_estimate || 0), '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('가맹·브랜드(추정)', fmtMoney(f.breakdown_franchise_proxy), '<span class="src-tag src-mock">구성비</span>')}
      ${kpiTag('시설·인테리어(추정)', fmtMoney(f.breakdown_facility_proxy), '<span class="src-tag src-mock">구성비</span>')}
      ${kpiTag('보증금·운전(추정)', fmtMoney(f.breakdown_deposit_working_proxy), '<span class="src-tag src-mock">구성비</span>')}
      ${kpiTag('기타 월비용',       fmtMoney(f.misc_monthly_cost || 0), tag('misc_monthly_cost'))}
      ${kpiTag('권장 운영자금(3개월)', fmtMoney(f.recommended_working_capital), '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('이자부담률',       `${f.interest_ratio ?? 0}%`,   '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('현금보유개월',     `${f.cash_months ?? '-'}개월`, '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('-10% 매출 시 생존',`${f.cash_months_10pct ?? '-'}개월`, '<span class="src-tag src-derived">파생</span>')}
      ${kpiTag('-20% 매출 시 생존',`${f.cash_months_20pct ?? '-'}개월`, '<span class="src-tag src-derived">파생</span>')}
    </div>
    <div class="shinhan-rate-box" id="shinhan-rate-box-result">신한은행 금리 정보를 불러오는 중…</div>

    <div class="info-box">
      <div class="info-title">해석</div>
      <div class="info-body">${financeNarrative(f)}</div>
    </div>
    <div class="caution-box">
      <b>데이터 출처 안내</b><br>
      ・<b>입력값</b> = 분석 시작 단계에서 사용자가 직접 입력한 값<br>
      ・<b>합성/가정</b> = 입력이 없을 때 채워지는 PoC용 합성 점포 데이터<br>
      ・<b>파생</b> = 위 두 값으로부터 계산된 결과 (손익분기, 이자부담률 등)<br>
      대출 가능 여부와 금리는 실제 심사·상담을 통해 확인해야 합니다.
    </div>
  `;
  loadShinhanLoanRates().then((rates) => renderShinhanLoanRatesBox(rates, 'shinhan-rate-box-result')).catch(() => {
    const bx = document.getElementById('shinhan-rate-box-result');
    if (bx) bx.textContent = '신한은행 금리 정보를 불러오지 못했습니다.';
  });
  requestAnimationFrame(() => drawFinanceCharts(d));
}

function kpiTag(label, value, tagHtml) {
  return `<div class="kpi"><div class="kpi-label">${label} ${tagHtml || ''}</div><div class="kpi-value">${value ?? '-'}</div></div>`;
}

function financeNarrative(f) {
  const m = Number(f.monthly_sales || 0);
  const be = Number(f.break_even || 0);
  const cm = Number(f.cash_months || 0);
  const gap = Number(f.funding_gap_estimate || 0);
  const own = Number((f.own_capital ?? f.cash_balance) || 0);
  const needLoan = Number((f.loan_needed_estimate ?? gap) || 0);
  const loanInt = Number(f.loan_monthly_interest_estimate || 0);
  const surplus = m >= be ? '예상 매출이 손익분기점을 상회합니다.' : '예상 매출이 손익분기점을 하회합니다.';
  let msg = surplus;
  if (cm < 3) msg += ' 현금보유개월 수가 매우 짧아 운영자금 점검이 시급합니다.';
  else if (cm < 6) msg += ' 매출 변동 시 현금 여유가 빠르게 줄어들 수 있어 자금 구조 점검이 필요합니다.';
  else msg += ' 일정 수준의 현금 여유는 확보된 상태입니다.';
  if (gap > 0) {
    msg += ` 자기자본 ${fmtMoney(own)} 기준으로 필요 대출(추정)은 약 ${fmtMoney(needLoan)}이며, 현재 금리 가정에서는 월 이자 약 ${fmtMoney(loanInt)} 수준입니다.`;
  }
  return msg;
}

// ── Tab: 신한 서비스 연결 ─────────────────────────────────────────────────
const SHINHAN_PANEL_STYLE = {
  bank: '#1a56db',
  card: '#0ea5e9',
  life: '#f97316',
  investment: '#16a34a',
};

function renderBankProductRow(pr, idx) {
  const amtRange = escapeHtml(pr.estimated_amount_range || '');
  let mockAmt = '';
  if (pr.mock_estimated_amount != null && pr.mock_estimated_amount !== '') {
    mockAmt = `<div class="spr-mock"><span class="spr-k">현재 추정 필요·참고 금액</span> ${fmtMoney(Number(pr.mock_estimated_amount))}</div>`;
  }
  if (pr.mock_estimated_amount_low != null && pr.mock_estimated_amount_high != null) {
    mockAmt = `<div class="spr-mock"><span class="spr-k">추정 범위</span> ${fmtMoney(Number(pr.mock_estimated_amount_low))} ~ ${fmtMoney(Number(pr.mock_estimated_amount_high))}</div>`;
  }
  const caution = pr.caution ? `<div class="spr-caution">${escapeHtml(pr.caution)}</div>` : '';
  return `
    <div class="spr-item">
      <div class="spr-num">${idx}</div>
      <div class="spr-body">
        <div class="spr-pg">${escapeHtml(pr.product_group || '')}</div>
        <div class="spr-purpose">${escapeHtml(pr.purpose || '')}</div>
        <div class="spr-row"><span class="spr-k">예상 상담 금액</span> ${amtRange}</div>
        ${mockAmt}
        <div class="spr-row"><span class="spr-k">상담 필요도</span> <span class="spr-badge">${escapeHtml(pr.need_level || '')}</span></div>
        <div class="spr-reason">${escapeHtml(pr.reason || '')}</div>
        ${pr.cta ? `<button type="button" class="btn btn-ghost btn-sm spr-cta" data-cta-action="${escapeHtml(pr.cta_action || 'generic_fallback')}">${escapeHtml(pr.cta)}</button>` : ''}
        ${caution}
      </div>
    </div>`;
}

function renderCardLifeProductRow(pr, idx) {
  const extra = pr.provided_info
    ? `<div class="spr-tags">${pr.provided_info.map(t => `<span class="spr-tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  const chk = pr.check_items
    ? `<div class="spr-checks"><span class="spr-k">점검·제공</span> ${pr.check_items.map(escapeHtml).join(' · ')}</div>`
    : '';
  return `
    <div class="spr-item">
      <div class="spr-num">${idx}</div>
      <div class="spr-body">
        <div class="spr-pg">${escapeHtml(pr.product_group || '')}</div>
        <div class="spr-purpose">${escapeHtml(pr.purpose || '')}</div>
        <div class="spr-row"><span class="spr-k">필요도</span> <span class="spr-badge">${escapeHtml(pr.need_level || '')}</span></div>
        <div class="spr-reason">${escapeHtml(pr.reason || '')}</div>
        ${extra}
        ${chk}
        ${pr.cta ? `<button type="button" class="btn btn-ghost btn-sm spr-cta" data-cta-action="${escapeHtml(pr.cta_action || 'generic_fallback')}">${escapeHtml(pr.cta)}</button>` : ''}
      </div>
    </div>`;
}

function renderInvestProductRow(pr, idx) {
  const chk = pr.check_items
    ? `<div class="spr-checks">${pr.check_items.map(c => `<span class="spr-mini">${escapeHtml(c)}</span>`).join('')}</div>`
    : '';
  return `
    <div class="spr-item">
      <div class="spr-num">${idx}</div>
      <div class="spr-body">
        <div class="spr-pg">${escapeHtml(pr.product_group || '')}</div>
        <div class="spr-purpose">${escapeHtml(pr.purpose || '')}</div>
        <div class="spr-row"><span class="spr-k">예상 활용도</span> <span class="spr-badge">${escapeHtml(pr.need_level || '')}</span></div>
        <div class="spr-reason">${escapeHtml(pr.reason || '')}</div>
        ${chk}
        ${pr.cta ? `<button type="button" class="btn btn-ghost btn-sm spr-cta" data-cta-action="${escapeHtml(pr.cta_action || 'generic_fallback')}">${escapeHtml(pr.cta)}</button>` : ''}
      </div>
    </div>`;
}

function renderShinhanPanelCard(key, panel) {
  if (!panel) return '';
  const color = SHINHAN_PANEL_STYLE[key] || '#64748b';
  const brand = escapeHtml(panel.brand || '');
  const title = escapeHtml(panel.title || '');
  const role = escapeHtml(panel.role || '');
  const score = panel.score != null ? Number(panel.score).toFixed(0) : '—';
  const level = escapeHtml(panel.level || '');
  const summary = escapeHtml(panel.summary || '');
  const disclaimer = escapeHtml(panel.disclaimer || '');
  const products = panel.products || [];

  let body = '';
  if (key === 'bank') {
    body = products.map((p, i) => renderBankProductRow(p, i + 1)).join('');
  } else if (key === 'card' || key === 'life') {
    body = products.map((p, i) => renderCardLifeProductRow(p, i + 1)).join('');
  } else {
    body = products.map((p, i) => renderInvestProductRow(p, i + 1)).join('');
  }

  const diagLines = [];
  const dx = panel.diagnosis || {};
  if (key === 'bank') {
    if (dx.estimated_startup_cost != null) diagLines.push(`초기 소요(추정): ${fmtMoney(dx.estimated_startup_cost)}`);
    if (dx.own_cash != null) diagLines.push(`보유 현금: ${fmtMoney(dx.own_cash)}`);
    if (dx.funding_gap != null) diagLines.push(`자금 공백(추정): ${fmtMoney(dx.funding_gap)}`);
    if (dx.monthly_sales != null) diagLines.push(`월매출(시뮬): ${fmtMoney(dx.monthly_sales)}`);
    if (dx.break_even_sales != null) diagLines.push(`손익분기 매출: ${fmtMoney(dx.break_even_sales)}`);
    if (dx.cash_runway_months != null) diagLines.push(`현금 버팀(추정): 약 ${dx.cash_runway_months}개월`);
    if (dx.fixed_cost_ratio != null) diagLines.push(`고정비 부담(추정): 약 ${dx.fixed_cost_ratio}%`);
    if (dx.loan_balance != null && dx.loan_balance > 0) diagLines.push(`대출 잔액(입력·합성): ${fmtMoney(dx.loan_balance)}`);
  } else if (key === 'card') {
    if (dx.monthly_card_sales != null) diagLines.push(`추정 카드 매출 규모: ${fmtMoney(dx.monthly_card_sales)}`);
    if (dx.sales_vs_area_average_ratio != null) diagLines.push(`상권 평균 대비 매출 비율: ${(dx.sales_vs_area_average_ratio * 100).toFixed(0)}%`);
    if (dx.weak_time) {
      diagLines.push(
        `약한 시간대: ${escapeHtml(String(dx.weak_time))} / 피크: ${escapeHtml(String(dx.peak_time || ''))}`,
      );
    }
    if (dx.repeat_customer_ratio != null) diagLines.push(`재방문 비중(목업): ${dx.repeat_customer_ratio}%`);
  } else if (key === 'life') {
    if (dx.business_type) diagLines.push(`업종: ${escapeHtml(dx.business_type)}`);
    diagLines.push(`방문형 업종: ${dx.visitor_based_business ? '예' : '아니오'}`);
    if (dx.fire_risk_score != null) diagLines.push(`화재 리스크 점수(목업): ${dx.fire_risk_score}`);
    if (dx.liability_risk_score != null) diagLines.push(`배상 리스크(목업): ${dx.liability_risk_score}`);
  } else {
    if (dx.growth_support_score != null) diagLines.push(`성장지원 점수 참고: ${dx.growth_support_score}`);
    if (dx.corporate_conversion_fit_score != null) diagLines.push(`법인 전환 검토 참고: ${dx.corporate_conversion_fit_score}`);
  }

  const diagHtml = diagLines.length
    ? `<div class="sp-diag"><div class="sp-diag-t">진단 스냅샷</div><ul>${diagLines.map(l => `<li>${l}</li>`).join('')}</ul></div>`
    : '';

  return `
    <div class="shinhan-panel" style="--sp-accent:${color}">
      <div class="sp-brand">${brand}</div>
      <div class="sp-role">${role}</div>
      <div class="sp-head">
        <h4 class="sp-title">${title}</h4>
        <div class="sp-score-pill">${level} · ${score}점</div>
      </div>
      <p class="sp-summary">${summary}</p>
      ${diagHtml}
      <div class="sp-products">${body}</div>
      <p class="sp-disc">${disclaimer}</p>
    </div>`;
}

function renderServicesTab(d) {
  const wrap = document.getElementById('tab-services');
  const pan = d?.shinhan_panels;

  if (!pan || !pan.bank) {
    wrap.innerHTML = `
      <h3 class="tab-title">신한 서비스 연결</h3>
      <p class="tab-desc">분석 API에 신한 패널 데이터가 없습니다. 서버를 최신 코드로 재시작한 뒤 다시 분석해 주세요.</p>`;
    return;
  }

  wrap.innerHTML = `
    <h3 class="tab-title">신한 서비스 연결</h3>
    <p class="tab-desc">
      진단 결과에 따라 우선 검토할 신한금융그룹 상담 후보입니다.
      <b>확정 추천이 아닌</b> 상담·점검 단계이며, 실제 상품 조건은 각 사 상담 및 심사 결과에 따릅니다.
    </p>
    <div class="shinhan-global-note">
      아래 내용은 입력값과 공공데이터 기반 시뮬레이션 결과를 바탕으로 한 <b>상담 후보</b>입니다.
      실제 상품 가입 가능 여부, 대출 한도, 금리, 보험료, 투자·성장지원 가능 여부는 신한금융그룹 각 사의 심사 및 상담 결과에 따라 달라질 수 있습니다.
    </div>

    <div class="shinhan-role-strip">
      <div><strong>신한은행</strong> — 자금·현금흐름·대출 상환 체력</div>
      <div><strong>신한카드</strong> — 매출·고객·결제·프로모션</div>
      <div><strong>신한라이프</strong> — 사업장 리스크·보장 공백</div>
      <div><strong>신한투자증권</strong> — 성장·확장·법인화·자산관리</div>
    </div>

    <div class="shinhan-grid-2x2">
      <div class="shinhan-col">
        ${renderShinhanPanelCard('bank', pan.bank)}
        ${renderShinhanPanelCard('card', pan.card)}
      </div>
      <div class="shinhan-col">
        ${renderShinhanPanelCard('life', pan.life)}
        ${renderShinhanPanelCard('investment', pan.investment)}
      </div>
    </div>

    <div class="caution-box">
      금융·보험·투자 상품을 자동 매칭·확정 추천하지 않습니다. PoC 목업 상담 후보이며, 버튼은 데모용입니다.
    </div>
  `;
}

// ── Tab: AI 리포트 ────────────────────────────────────────────────────────
async function renderReportTab() {
  const d = State.result;
  if (!d) return;
  const wrap = document.getElementById('tab-report');
  wrap.innerHTML = `
    <h3 class="tab-title">AI 종합 컨설팅 리포트</h3>
    <p class="tab-desc">분석 결과를 바탕으로 자연어 리포트를 생성합니다. (Gemini API 미설정 시 템플릿 리포트 제공)</p>
    <button class="btn btn-primary" id="btn-gen-report">AI 종합 컨설팅 리포트 생성</button>
    <div class="report-body" id="report-body" style="margin-top:18px"></div>
  `;
  document.getElementById('btn-gen-report').addEventListener('click', generateReport);
}

async function generateReport() {
  const btn = document.getElementById('btn-gen-report');
  const body = document.getElementById('report-body');
  const d = State.result;
  if (!d) return;
  btn.disabled = true; btn.textContent = '리포트 생성 중…';
  body.innerHTML = '<div class="report-loading">AI 리포트를 생성하고 있습니다…</div>';

  try {
    const reqBody = {
      area_name: d.area_name, service_name: d.service_name,
      user_type: d.user_type,
      scores:    d.scores || {},
      finance:   financeForResultView(d),
      store_summary: d.store_summary || {},
      competitor_count_500m: 0,
      warnings: d.warnings || [],
    };
    const res = await fetchJson('/api/report', { method: 'POST', body: JSON.stringify(reqBody) });
    body.innerHTML = `
      <div class="report-source">소스: ${res.source === 'gemini' ? 'Gemini AI' : '템플릿 리포트'}</div>
      <div class="report-content md">${renderMarkdown(res.content)}</div>
    `;
  } catch (e) {
    body.innerHTML = '<div class="report-error">리포트 생성에 실패했습니다.</div>';
  } finally {
    btn.disabled = false; btn.textContent = 'AI 종합 컨설팅 리포트 생성';
  }
}

// ── 헤더 네비게이션 ─────────────────────────────────────────────────────────
function initHeaderNav() {
  document.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const target = a.dataset.jump;
      if (target === 'home') goStep('home');
      if (target === 'result' && State.result) goStep('result');
    });
  });
}

// ── 차트 ────────────────────────────────────────────────────────────────────
function destroyCharts() {
  Object.keys(State.charts).forEach(k => {
    if (!k.startsWith('ch-')) return;
    State.charts[k]?.destroy?.();
    delete State.charts[k];
  });
}

function destroyFinanceCharts() {
  Object.keys(State.charts).forEach(k => {
    if (!k.startsWith('fin-')) return;
    State.charts[k]?.destroy?.();
    delete State.charts[k];
  });
}

/** 자금 탭: 매출·조달·비용 구조 차트 (Chart.js) */
function drawFinanceCharts(d) {
  if (typeof Chart === 'undefined' || !d) return;
  destroyFinanceCharts();
  const f = financeForResultView(d);
  const ms = Number(f.monthly_sales || 0);
  const be = Number(f.break_even || 0);
  const own = Number((f.own_capital ?? f.cash_balance) || 0);
  const gap = Number(f.funding_gap_estimate || 0);
  const initTot = Number(f.initial_investment || 0);
  const rec = Number(f.recommended_working_capital || 0);
  const rent = Number(f.rent || 0);
  const labor = Number(f.labor_cost || 0);
  const misc = Number(f.misc_monthly_cost || 0);
  const mint = Number(f.monthly_interest || 0);
  const varc = Number(f.variable_cost || 0);
  const loanB = Number(f.loan_balance || 0);
  const mrep = Number(f.monthly_repayment || 0);

  const cvBe = document.getElementById('fin-chart-be');
  if (cvBe && ms >= 0) {
    State.charts['fin-chart-be'] = new Chart(cvBe, {
      type: 'bar',
      data: {
        labels: ['예상 월매출', '손익분기 매출', '권장 운영자금(3개월)'],
        datasets: [{
          label: '금액(원)',
          data: [ms, be, rec],
          backgroundColor: ['#2563ebcc', '#f97316cc', '#22c55ecc'],
          borderRadius: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.raw;
                return v >= 1e8 ? `${(v / 1e8).toFixed(1)}억원` : `${Math.round(v / 1e4)}만원`;
              },
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback(v) {
                if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`;
                return `${Math.round(v / 1e4)}만`;
              },
            },
            grid: { color: '#f3f4f6' },
          },
          x: { grid: { display: false } },
        },
      },
    });
  }

  const cvGap = document.getElementById('fin-chart-gap');
  if (cvGap) {
    const g2 = gap > 0 ? gap : Math.max(0, initTot - own);
    const labels = gap > 0 || g2 > 0 ? ['자기자본', '추가 조달 참고(추정)'] : ['자기자본', '초기 소요 대비'];
    const data = gap > 0 || g2 > 0 ? [own, g2] : [own, Math.max(initTot - own, 0)];
    const colors = gap > 0 || g2 > 0 ? ['#3b82f6', '#ef4444'] : ['#22c55e', '#94a3b8'];
    State.charts['fin-chart-gap'] = new Chart(cvGap, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: data.map(v => Math.max(v, 1)),
          backgroundColor: colors,
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.raw;
                return `${ctx.label}: ${v >= 1e8 ? (v / 1e8).toFixed(1) + '억원' : `${Math.round(v / 1e4)}만원`}`;
              },
            },
          },
        },
      },
    });
  }

  const cvCost = document.getElementById('fin-chart-cost');
  if (cvCost && (rent + labor + mint + varc) > 0) {
    State.charts['fin-chart-cost'] = new Chart(cvCost, {
      type: 'pie',
      data: {
        labels: ['임대료', '인건비', '기타월비용', '이자', '변동비(원가)'],
        datasets: [{
          data: [rent, labor, misc, mint, varc].map(v => Math.max(v, 1)),
          backgroundColor: ['#6366f1', '#8b5cf6', '#334155', '#f59e0b', '#14b8a6'],
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label(ctx) {
                const v = ctx.raw;
                return `${ctx.label}: ${Math.round(v / 1e4)}만원`;
              },
            },
          },
        },
      },
    });
  }

  const cvLoan = document.getElementById('fin-chart-loan');
  if (cvLoan && (loanB > 0 || mint > 0 || mrep > 0 || rent > 0 || labor > 0 || misc > 0)) {
    State.charts['fin-chart-loan'] = new Chart(cvLoan, {
      type: 'bar',
      data: {
        labels: ['월 이자', '월 상환(원리금)', '월 임대', '월 인건비', '기타 월비용'],
        datasets: [{
          label: '월 단위(원)',
          data: [mint, mrep, rent, labor, misc],
          backgroundColor: ['#dc2626', '#ea580c', '#6366f1', '#8b5cf6', '#334155'],
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                return `${ctx.label}: ${Math.round(Number(ctx.raw) / 1e4)}만원`;
              },
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback(v) {
                return `${Math.round(Number(v) / 1e4)}만`;
              },
            },
            grid: { color: '#f3f4f6' },
          },
          x: { grid: { display: false } },
        },
      },
    });
  }
}

function drawLineChart(canvasId, data, label, color) {
  const cv = document.getElementById(canvasId);
  if (!cv || !data || data.length < 2) return;
  const labels = data.map(d => fmtQuarter(d['분기']));
  const values = data.map(d => d['값']);
  State.charts[canvasId] = new Chart(cv, {
    type: 'line',
    data: { labels, datasets: [{
      label, data: values,
      borderColor: color, backgroundColor: color + '22',
      borderWidth: 2, pointRadius: 3, tension: 0.3, fill: true,
    }]},
    options: chartOptions(),
  });
}

function drawDualBar(canvasId, data1, data2, label1, label2, color1, color2) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const labels = (data1 || data2 || []).map(d => fmtQuarter(d['분기']));
  const v1 = (data1 || []).map(d => d['값']);
  const v2 = (data2 || []).map(d => d['값']);
  State.charts[canvasId] = new Chart(cv, {
    type: 'bar',
    data: { labels, datasets: [
      { label: label1, data: v1, backgroundColor: color1 + 'cc' },
      { label: label2, data: v2, backgroundColor: color2 + 'cc' },
    ]},
    options: chartOptions(),
  });
}

function chartOptions() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top', labels: { font: { size: 11 } } },
      tooltip: { callbacks: { title: items => items.length ? items[0].label : '' } },
    },
    scales: {
      y: { ticks: { font: { size: 10 }, callback: v => fmtNum(v) }, grid: { color: '#f3f4f6' } },
      x: {
        ticks: {
          font: { size: 11 }, autoSkip: false, maxRotation: 0, minRotation: 0,
        },
        grid: { display: false },
      },
    },
  };
}

// ── 유틸 ────────────────────────────────────────────────────────────────────
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function resetSelect(id, placeholder) {
  const sel = document.getElementById(id);
  sel.innerHTML = `<option value="">${placeholder}</option>`;
}

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function fmtMoney(v) {
  v = Number(v || 0);
  if (!v) return '0원';
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '억원';
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '만원';
  return v.toLocaleString() + '원';
}
function fmtInt(v) {
  if (v == null) return '-';
  const n = Number(v);
  return isFinite(n) ? Math.round(n).toLocaleString() : '-';
}
function fmtNum(v) {
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '억';
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '만';
  return Number(v).toLocaleString();
}
function fmtQuarter(q) {
  if (q == null) return '';
  const s = String(q).trim();
  // 표준 케이스: "20231" → "23년 1Q"
  const m = s.match(/^(\d{4})([1-4])$/);
  if (m) return `${m[1].slice(2)}년 ${m[2]}Q`;
  // "2023Q1" 형태도 허용
  const m2 = s.match(/^(\d{4})Q?([1-4])$/i);
  if (m2) return `${m2[1].slice(2)}년 ${m2[2]}Q`;
  return s;
}

function kpi(label, value) {
  return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value ?? '-'}</div></div>`;
}

function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^(\d+)\. (.+)$/gm, '<p><b>$1.</b> $2</p>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

// 다른 스크립트(운영중 사업자 전용)에서 재사용할 수 있도록 노출
window.goStep = goStep;
window.fetchJson = fetchJson;
