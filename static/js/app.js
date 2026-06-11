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
  account: null,                       // { provider, id, name }
  /** 시뮬레이션 기본값 자동 채움 후 설명 패널용 */
  financeRecommendationApplied: false,
  financeRecommendationBaseline: null,
  /** 지도 기반 탐색에서 진단으로 넘길 때 좌표·반경·업종 필터 */
  mapExplorerContext: null,
  /** 조건 입력 화면 상단 배너용 요약 */
  mapExplorerSummary: null,
  /** area 패널 기본값 자동 채움 예약 */
  mapExplorerAreaPrefillPending: false,
  /** 외부(카카오) 검색 결과 캐시 */
  externalPlaces: null,
};

const ACCOUNT_KEY = 'shinhan.account.v1';
const SAVED_KEY_PREFIX = 'shinhan.savedProfiles.';
const HISTORY_KEY_PREFIX = 'shinhan.analysisHistory.';
const ACCOUNT_SYNC_ON = true;
const MAP_MARKER_LIMIT_LEAFLET = 220;
const MAP_MARKER_LIMIT_KAKAO = 160;

/** HTML 이스케이프 (외부 검색·결과 렌더 등 전역 사용) */
function escapeHtml(str) {
  if (str == null || str === '') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hasPlaceCoords(p) {
  if (!p) return false;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function renderExternalPlaceCard(p, i) {
  const title = escapeHtml(p.title || '-');
  const cat = escapeHtml(p.category || p.category_group || '');
  const addr = escapeHtml(p.address || '');
  const tel = p.telephone ? ` · ${escapeHtml(p.telephone)}` : '';
  const link = p.link ? escapeHtml(p.link) : '';
  const mapBtn = link
    ? `<a class="btn btn-secondary btn-xs" href="${link}" target="_blank" rel="noopener noreferrer">카카오맵에서 보기 ↗</a>`
    : '';
  const fillBtn = hasPlaceCoords(p)
    ? `<button type="button" class="btn btn-primary btn-xs" data-fill-place="${i}">이 위치로 지역·업종 채우기</button>`
    : '';
  return `
    <div class="ext-card" data-place-idx="${i}">
      <div class="ext-title">${title}</div>
      <div class="ext-meta">${cat}</div>
      <div class="ext-meta muted">${addr}${tel}</div>
      <div class="ext-card-actions">${mapBtn}${fillBtn}</div>
    </div>`;
}

// ── 초기 진입 ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initAccountFeatures();
  initHomeButtons();
  initUserTypeStep();
  initAreaStep();
  initFinanceStep();
  initResultTabs();
  initHeaderNav();
  loadHomeStats();
  goStep('home');
});

function getSavedStorageKey() {
  const id = State.account?.id;
  return id ? `${SAVED_KEY_PREFIX}${id}` : '';
}

function loadSavedProfiles() {
  const key = getSavedStorageKey();
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function getHistoryStorageKey() {
  const id = State.account?.id;
  return id ? `${HISTORY_KEY_PREFIX}${id}` : '';
}

function loadAnalysisHistory() {
  const key = getHistoryStorageKey();
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

async function syncLoginAccount() {
  if (!ACCOUNT_SYNC_ON || !State.account?.id) return;
  if (State.account.provider !== 'google') return;
  try {
    await fetchJson('/api/account/login', {
      method: 'POST',
      body: JSON.stringify({
        account_id: State.account.id,
        provider: 'google',
        account_name: State.account.name || State.account.id,
      }),
    });
  } catch (_) {}
}

async function pullAccountDataFromServer() {
  if (!ACCOUNT_SYNC_ON || !State.account?.id) return;
  try {
    const q = encodeURIComponent(State.account.id);
    const [saved, history] = await Promise.all([
      fetchJson(`/api/account/saved-profiles?account_id=${q}`),
      fetchJson(`/api/account/history?account_id=${q}`),
    ]);
    if (Array.isArray(saved?.rows)) {
      const key = getSavedStorageKey();
      if (key) localStorage.setItem(key, JSON.stringify(saved.rows));
    }
    if (Array.isArray(history?.rows)) {
      const key = getHistoryStorageKey();
      if (key) localStorage.setItem(key, JSON.stringify(history.rows));
    }
  } catch (_) {}
}

function pushSavedProfilesToServer(rows) {
  if (!ACCOUNT_SYNC_ON || !State.account?.id) return;
  const q = encodeURIComponent(State.account.id);
  fetchJson(`/api/account/saved-profiles?account_id=${q}`, {
    method: 'PUT',
    body: JSON.stringify({ rows: rows || [] }),
  }).catch(() => {});
}

function pushHistoryToServer(rows) {
  if (!ACCOUNT_SYNC_ON || !State.account?.id) return;
  const q = encodeURIComponent(State.account.id);
  fetchJson(`/api/account/history?account_id=${q}`, {
    method: 'PUT',
    body: JSON.stringify({ rows: rows || [] }),
  }).catch(() => {});
}

function writeAnalysisHistory(rows) {
  const key = getHistoryStorageKey();
  if (!key) return;
  const safeRows = rows || [];
  localStorage.setItem(key, JSON.stringify(safeRows));
  pushHistoryToServer(safeRows);
}

function writeSavedProfiles(rows) {
  const key = getSavedStorageKey();
  if (!key) return;
  const safeRows = rows || [];
  localStorage.setItem(key, JSON.stringify(safeRows));
  pushSavedProfilesToServer(safeRows);
}

function buildSnapshot() {
  return {
    id: `p_${Date.now()}`,
    title: `${State.area_name || '미지정 상권'} · ${State.service_name || '미지정 업종'}`,
    created_at: new Date().toISOString(),
    payload: {
      user_type: State.user_type || '',
      district: State.district || '',
      dong: State.dong || '',
      area_code: State.area_code || '',
      area_name: State.area_name || '',
      service_name: State.service_name || '',
      finance_mode: State.finance_mode || 'simple',
      finance: readFinance(),
    },
  };
}

function buildAnalysisHistoryRow(result) {
  return {
    id: `h_${Date.now()}`,
    created_at: new Date().toISOString(),
    favorite: false,
    note: '',
    payload: {
      user_type: State.user_type || '',
      district: State.district || '',
      dong: State.dong || '',
      area_code: State.area_code || '',
      area_name: State.area_name || '',
      service_name: State.service_name || '',
      finance_mode: State.finance_mode || 'simple',
      finance: State.finance || {},
    },
    result_snapshot: result || null,
    headline: `${State.area_name || '미지정 상권'} · ${State.service_name || '미지정 업종'}`,
  };
}

function autoSaveAnalysisHistory(result) {
  if (!State.account || !result) return;
  const rows = loadAnalysisHistory();
  rows.unshift(buildAnalysisHistoryRow(result));
  writeAnalysisHistory(rows.slice(0, 30));
}

function loadHistoryToDashboard(row) {
  if (!row?.result_snapshot) return;
  const p = row.payload || {};
  State.user_type = p.user_type || '';
  State.district = p.district || '';
  State.dong = p.dong || '';
  State.area_code = p.area_code || '';
  State.area_name = p.area_name || '';
  State.service_name = p.service_name || '';
  State.finance_mode = p.finance_mode || 'simple';
  State.finance = p.finance || {};
  State.result = row.result_snapshot;
  renderResult(State.result);
  goStep('result');
}

function renderAccountHistory() {
  const wrap = document.getElementById('account-history');
  if (!wrap) return;
  if (!State.account) {
    wrap.innerHTML = '';
    return;
  }
  const rows = loadAnalysisHistory();
  if (!rows.length) {
    wrap.innerHTML = '<div class="muted">아직 조회 이력이 없습니다. 분석을 실행하면 자동으로 쌓입니다.</div>';
    return;
  }
  wrap.innerHTML = rows.map(r => `
    <div class="saved-profile-item">
      <div class="saved-profile-meta">
        <b>${r.favorite ? '★ ' : ''}${r.headline || '-'}</b><br>
        ${r.payload?.user_type || '-'} · ${new Date(r.created_at).toLocaleString('ko-KR')}<br>
        ${(r.result_snapshot?.final_result?.score != null) ? `종합점수: ${r.result_snapshot.final_result.score}점` : ''}
      </div>
      <div class="saved-profile-actions">
        <button class="btn btn-primary btn-sm" data-open-history="${r.id}">대시보드 열기</button>
        <button class="btn btn-secondary btn-sm" data-fav-history="${r.id}">${r.favorite ? '즐겨찾기 해제' : '즐겨찾기'}</button>
        <button class="btn btn-back btn-sm" data-del-history="${r.id}">삭제</button>
      </div>
      <input class="saved-profile-note" type="text" data-note-history="${r.id}" value="${escapeHtml(r.note || '')}" placeholder="메모 입력 후 Enter">
    </div>
  `).join('');

  wrap.querySelectorAll('[data-open-history]').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = rows.find(x => x.id === btn.dataset.openHistory);
      if (row) loadHistoryToDashboard(row);
    });
  });
  wrap.querySelectorAll('[data-fav-history]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = rows.map(x => x.id === btn.dataset.favHistory ? { ...x, favorite: !x.favorite } : x)
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || String(b.created_at).localeCompare(String(a.created_at)));
      writeAnalysisHistory(next);
      renderAccountHistory();
    });
  });
  wrap.querySelectorAll('[data-del-history]').forEach(btn => {
    btn.addEventListener('click', () => {
      writeAnalysisHistory(rows.filter(x => x.id !== btn.dataset.delHistory));
      renderAccountHistory();
    });
  });
  wrap.querySelectorAll('[data-note-history]').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const next = rows.map(x => x.id === input.dataset.noteHistory ? { ...x, note: input.value || '' } : x);
      writeAnalysisHistory(next);
      renderAccountHistory();
    });
  });
}

function restoreSnapshot(snapshot) {
  const p = snapshot?.payload || {};
  State.user_type = p.user_type || '';
  State.district = p.district || '';
  State.dong = p.dong || '';
  State.area_code = p.area_code || '';
  State.area_name = p.area_name || '';
  State.service_name = p.service_name || '';
  State.finance_mode = p.finance_mode || 'simple';
  State.finance = p.finance || {};

  selectUserTypeCard(State.user_type || null);
  if (State.user_type) {
    goStep('area');
    hydrateAreaSelectionFromState().then(() => {
      goStep('finance');
      document.querySelectorAll('#panel-finance .mode-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.mode === State.finance_mode));
      applyFinanceMode(State.finance_mode);
      Object.entries(State.finance || {}).forEach(([k, v]) => {
        const el = document.getElementById('fin-' + k);
        if (el) el.value = v;
      });
      refreshFinanceLivePreview();
      alert('저장된 정보를 불러왔습니다. 바로 분석을 진행할 수 있습니다.');
    });
  } else {
    goStep('user-type');
  }
}

async function hydrateAreaSelectionFromState() {
  await loadDistricts(true);
  const distSel = document.getElementById('sel-district');
  if (State.district && [...distSel.options].some(o => o.value === State.district)) {
    distSel.value = State.district;
    await onDistrictChange();
  }
  const dongSel = document.getElementById('sel-dong');
  if (State.dong && [...dongSel.options].some(o => o.value === State.dong)) {
    dongSel.value = State.dong;
    await onDongChange();
  }
  const areaSel = document.getElementById('sel-area');
  if (State.area_code) {
    if (![...areaSel.options].some(o => o.value === State.area_code)) {
      const o = document.createElement('option');
      o.value = State.area_code;
      o.textContent = `${State.area_name || State.area_code} (저장값)`;
      o.dataset.name = State.area_name || '';
      areaSel.appendChild(o);
    }
    areaSel.value = State.area_code;
    await onAreaChange();
  }
  const serviceSel = document.getElementById('sel-service');
  if (State.service_name) {
    if (![...serviceSel.options].some(o => o.value === State.service_name)) {
      const o = document.createElement('option');
      o.value = State.service_name;
      o.textContent = `${State.service_name} (저장값)`;
      serviceSel.appendChild(o);
    }
    serviceSel.value = State.service_name;
    onServiceChange();
  }
}

/** 홈 화면 상단: 로그인 사용자 전용 "이어서 관리" 대시보드 밴드 */
function renderHomeAccountBand() {
  const band = document.getElementById('home-account-band');
  if (!band) return;

  if (!State.account) {
    band.hidden = false;
    band.classList.add('home-account-band--guest');
    band.innerHTML = `
      <div class="hab-guest">
        <div class="hab-guest-text">
          <div class="hab-guest-title">내 사업장을 등록하고 이어서 관리하세요</div>
          <div class="hab-guest-desc">로그인하면 분석 조건과 진단 이력이 저장되어, 다음 방문 때 처음부터 다시 입력하지 않아도 됩니다.</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="hab-guest-login">로그인 · 내 계정 열기</button>
      </div>`;
    document.getElementById('hab-guest-login')?.addEventListener('click', () => {
      const pop = document.getElementById('account-popover');
      if (pop) pop.removeAttribute('hidden');
    });
    return;
  }

  band.hidden = false;
  band.classList.remove('home-account-band--guest');
  const saved = loadSavedProfiles();
  const history = loadAnalysisHistory();
  const name = escapeHtml(State.account.name || '사용자');
  const recent = history.slice(0, 3);

  const recentHtml = recent.length
    ? recent.map((r) => `
        <button type="button" class="hab-recent-card" data-hab-open="${escapeHtml(r.id)}">
          <span class="hab-recent-type">${escapeHtml(r.payload?.user_type || '분석')}</span>
          <span class="hab-recent-title">${escapeHtml(r.headline || '-')}</span>
          <span class="hab-recent-date">${new Date(r.created_at).toLocaleDateString('ko-KR')} 진단</span>
        </button>`).join('')
    : `<div class="hab-empty">아직 진단 이력이 없습니다. 아래에서 새 분석을 시작하면 여기에 자동으로 쌓입니다.</div>`;

  band.innerHTML = `
    <div class="hab-head">
      <div class="hab-greeting">
        <span class="hab-badge">내 워크스페이스</span>
        <h2 class="hab-title">${name} 님, 다시 오셨네요</h2>
        <p class="hab-sub">저장된 사업장 <b>${saved.length}</b>건 · 진단 이력 <b>${history.length}</b>건이 계정에 보관되어 있습니다.</p>
      </div>
      <div class="hab-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="hab-open-operating">운영 매장 진단</button>
        <button type="button" class="btn btn-ghost btn-sm" id="hab-open-account">내 계정 전체보기</button>
      </div>
    </div>
    <div class="hab-recent-row">
      <div class="hab-recent-label">최근 진단 이어보기</div>
      <div class="hab-recent-list">${recentHtml}</div>
    </div>`;

  band.querySelectorAll('[data-hab-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = history.find((x) => x.id === btn.dataset.habOpen);
      if (row) loadHistoryToDashboard(row);
    });
  });
  document.getElementById('hab-open-operating')?.addEventListener('click', quickGoOperating);
  document.getElementById('hab-open-account')?.addEventListener('click', () => {
    const pop = document.getElementById('account-popover');
    if (pop) pop.removeAttribute('hidden');
  });
}

function renderSavedProfiles() {
  renderHomeAccountBand();
  const wrap = document.getElementById('saved-profiles');
  const status = document.getElementById('account-status');
  const panelBtn = document.getElementById('btn-account-panel');
  if (!wrap || !status) return;
  if (!State.account) {
    if (panelBtn) panelBtn.textContent = '로그인 · 내 계정';
    status.textContent = '로그인되지 않았습니다.';
    wrap.innerHTML = '';
    return;
  }
  if (panelBtn) panelBtn.textContent = `${State.account.name} · 내 계정`;
  const rows = loadSavedProfiles();
  status.textContent = `${State.account.name} 님으로 로그인됨 · 저장 ${rows.length}건 · 분석 시 조회 이력이 자동 저장됩니다.`;
  if (!rows.length) {
    wrap.innerHTML = '<div class="muted">저장된 정보가 없습니다. 사업 조건 화면에서 "내 정보 저장"을 눌러주세요.</div>';
    return;
  }
  wrap.innerHTML = rows.map(r => `
    <div class="saved-profile-item">
      <div class="saved-profile-meta">
        <b>${r.title || '저장 항목'}</b><br>
        ${r.payload?.user_type || '-'} · ${r.payload?.district || '-'} ${r.payload?.dong || ''}<br>
        저장시각: ${new Date(r.created_at).toLocaleString('ko-KR')}
      </div>
      <div class="saved-profile-actions">
        <button class="btn btn-primary btn-sm" data-load-profile="${r.id}">불러오기</button>
        <button class="btn btn-back btn-sm" data-del-profile="${r.id}">삭제</button>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-load-profile]').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = rows.find(x => x.id === btn.dataset.loadProfile);
      if (row) restoreSnapshot(row);
    });
  });
  wrap.querySelectorAll('[data-del-profile]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = rows.filter(x => x.id !== btn.dataset.delProfile);
      writeSavedProfiles(next);
      renderSavedProfiles();
    });
  });
  renderAccountHistory();
}

function saveCurrentProfile() {
  if (!State.account) {
    alert('먼저 우측 상단에서 Google 로그인을 해주세요.');
    return;
  }
  if (!State.user_type || !State.area_code || !State.service_name) {
    alert('저장하려면 사용자 유형/상권/업종 선택이 필요합니다.');
    return;
  }
  const rows = loadSavedProfiles();
  rows.unshift(buildSnapshot());
  writeSavedProfiles(rows.slice(0, 10));
  renderSavedProfiles();
  alert('내 정보로 저장했습니다. 홈 화면에서 불러올 수 있습니다.');
}

async function afterAccountLogin() {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(State.account));
  await syncLoginAccount();
  await pullAccountDataFromServer();
  renderSavedProfiles();
  goStep('home');
}

function quickGoOperating() {
  if (!State.account) {
    alert('먼저 로그인해주세요.');
    return;
  }
  if (typeof window.openOperatingStoreSelector === 'function') {
    window.openOperatingStoreSelector();
    return;
  }
  goStep('operating-connect');
}

function quickGoFinancial() {
  if (!State.account) {
    alert('먼저 로그인해주세요.');
    return;
  }
  if (typeof window.openFinancialStoreList === 'function') {
    window.openFinancialStoreList();
    return;
  }
  goStep('financial-connect');
}

async function loginWithGoogleToken(idToken) {
  const res = await fetchJson('/api/account/google-login', {
    method: 'POST',
    body: JSON.stringify({ id_token: idToken }),
  });
  State.account = res.account || null;
  if (!State.account?.id) throw new Error('google login failed');
  await afterAccountLogin();
}

function initGoogleButton() {
  const clientId = String(window.__GOOGLE_CLIENT_ID__ || '').trim();
  const wrap = document.getElementById('google-login-button');
  if (!wrap) return;

  if (!clientId || !window.google?.accounts?.id) return;
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: async (resp) => {
      try {
        await loginWithGoogleToken(resp.credential);
      } catch (e) {
        alert('Google 로그인에 실패했습니다.');
      }
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  wrap.innerHTML = '';
  window.google.accounts.id.renderButton(wrap, {
    theme: 'outline',
    size: 'medium',
    type: 'standard',
    shape: 'pill',
    text: 'signin_with',
    width: 220,
  });
}

async function initAccountFeatures() {
  const panelBtn = document.getElementById('btn-account-panel');
  const pop = document.getElementById('account-popover');
  panelBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!pop) return;
    const isHidden = pop.hasAttribute('hidden');
    if (isHidden) pop.removeAttribute('hidden');
    else pop.setAttribute('hidden', '');
  });
  document.addEventListener('click', (e) => {
    if (!pop || !panelBtn) return;
    if (pop.hasAttribute('hidden')) return;
    if (pop.contains(e.target) || panelBtn.contains(e.target)) return;
    pop.setAttribute('hidden', '');
  });

  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.provider === 'google' && parsed?.id) State.account = parsed;
      else localStorage.removeItem(ACCOUNT_KEY);
    }
  } catch (_) {}

  document.getElementById('btn-logout-account')?.addEventListener('click', () => {
    try {
      window.google?.accounts?.id?.disableAutoSelect?.();
    } catch (_) {}
    State.account = null;
    localStorage.removeItem(ACCOUNT_KEY);
    renderSavedProfiles();
  });
  document.getElementById('btn-quick-operating')?.addEventListener('click', quickGoOperating);
  document.getElementById('btn-quick-financial')?.addEventListener('click', quickGoFinancial);
  document.getElementById('btn-save-profile')?.addEventListener('click', saveCurrentProfile);
  initGoogleButton();
  setTimeout(initGoogleButton, 800);
  setTimeout(initGoogleButton, 1800);
  if (State.account) {
    await syncLoginAccount();
    await pullAccountDataFromServer();
  }
  renderSavedProfiles();
}

// ── 단계 전환 ───────────────────────────────────────────────────────────────
function goStep(step) {
  State.step = step;
  ['home', 'user-type', 'area', 'finance', 'loading', 'result',
   'map-explorer',
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
  stepper.style.display = (step === 'home' || step === 'map-explorer') ? 'none' : 'flex';
  stepper.querySelectorAll('.step').forEach(el => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n === stepIdx);
    el.classList.toggle('done',   n <  stepIdx);
  });

  if (step === 'area') {
    if (State.mapExplorerAreaPrefillPending) {
      requestAnimationFrame(() => {
        applyMapExplorerAreaPrefill().catch((e) => console.warn('[mapExplorer prefill]', e));
      });
    } else {
      loadDistricts();
    }
  }

  if (step === 'map-explorer') {
    requestAnimationFrame(() => {
      if (typeof window.mapExplorerOnShown === 'function') window.mapExplorerOnShown();
    });
  }

  if (step === 'finance') updateMapExplorerFinanceBanner();

  if (step === 'home') renderHomeAccountBand();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function inferServiceFromMapExplorerContext(ctx) {
  const raw = String(ctx?.place_category || ctx?.place_title || '').toLowerCase();
  if (!raw) return '';
  if (raw.includes('약국') || raw.includes('의약')) return '의약품';
  if (raw.includes('카페') || raw.includes('커피')) return '커피-음료';
  if (raw.includes('편의점')) return '편의점';
  if (raw.includes('한식')) return '한식음식점';
  if (raw.includes('미용') || raw.includes('헤어') || raw.includes('네일')) return '미용실';
  return '';
}

function applyMapExplorerDefaultsToState(chosen, serviceName) {
  if (chosen && chosen.area_code) {
    State.district = chosen.district || State.district || '';
    State.dong = chosen.dong || State.dong || '';
    State.area_code = chosen.area_code;
    State.area_name = chosen.area_name || State.area_name || '';
  }
  if (serviceName) {
    State.service_name = serviceName;
  }
}

async function applyMapExplorerAreaPrefill() {
  if (!State.mapExplorerAreaPrefillPending) return;
  const ctx = State.mapExplorerContext || {};
  const wantedDistrict = String(ctx.district || State.district || '').trim();
  const wantedDong = String(ctx.dong || State.dong || '').trim();
  const wantedAreaCode = String(ctx.area_code || State.area_code || '').trim();
  const wantedAreaName = String(ctx.area_name || State.area_name || '').trim();
  const wantedService = String(ctx.service_name || State.service_name || '').trim();

  if (!wantedAreaCode) {
    State.mapExplorerAreaPrefillPending = false;
    return;
  }
  State.mapExplorerAreaPrefillPending = false;
  await loadDistricts(true);

  const districtSel = document.getElementById('sel-district');
  const dongSel = document.getElementById('sel-dong');
  const areaSel = document.getElementById('sel-area');
  const serviceSel = document.getElementById('sel-service');

  // 1) 자치구
  if (districtSel && wantedDistrict) {
    const distOpt = [...districtSel.options].find(
      (o) => String(o.value || '').trim() === wantedDistrict,
    );
    if (!distOpt) {
      const o = document.createElement('option');
      o.value = wantedDistrict;
      o.textContent = wantedDistrict;
      districtSel.appendChild(o);
    }
    districtSel.value = wantedDistrict;
    await onDistrictChange();
  }

  // 2) 행정동
  if (dongSel && wantedDong) {
    const dongOpt = [...dongSel.options].find(
      (o) => String(o.value || '').trim() === wantedDong,
    );
    if (!dongOpt) {
      const o = document.createElement('option');
      o.value = wantedDong;
      o.textContent = `${wantedDong} (지도 선택)`;
      dongSel.appendChild(o);
    }
    dongSel.value = wantedDong;
    State.dong = wantedDong;
    await loadAreaList();
  }

  // 3) 상권
  if (areaSel && wantedAreaCode) {
    const areaOpt = [...areaSel.options].find(
      (o) => String(o.value || '').trim() === wantedAreaCode,
    );
    if (!areaOpt) {
      const o = document.createElement('option');
      o.value = wantedAreaCode;
      o.textContent = `${wantedAreaName || wantedAreaCode} (지도 선택)`;
      o.dataset.name = wantedAreaName || '';
      areaSel.appendChild(o);
    }
    areaSel.value = wantedAreaCode;
    await onAreaChange();
  }

  // 4) 업종
  if (serviceSel && wantedService) {
    const svcOpt = [...serviceSel.options].find(
      (o) => String(o.value || '').trim() === wantedService,
    );
    if (!svcOpt) {
      const o = document.createElement('option');
      o.value = wantedService;
      o.textContent = `${wantedService} (지도 선택)`;
      serviceSel.appendChild(o);
    }
    serviceSel.value = wantedService;
    onServiceChange();
  }

  validateAreaStep();
}

function updateMapExplorerFinanceBanner() {
  const box = document.getElementById('finance-map-selection-banner');
  if (!box) return;
  const s = State.mapExplorerSummary;
  if (!s || s.lat == null || !Number.isFinite(Number(s.lat))) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  const svc =
    s.service_name ||
    MAP_EXPLORER_SERVICE_NAME[s.industryKey || 'all'] ||
    MAP_EXPLORER_SERVICE_NAME.all;
  box.innerHTML = `
    <div class="finance-map-banner-inner">
      <div class="finance-map-banner-title">지도에서 선택한 위치</div>
      <ul class="finance-map-banner-list">
        <li><strong>선택 상권</strong>: ${escapeHtml(s.area_name || '(다음 단계에서 선택 가능)')}</li>
        <li><strong>선택 업종</strong>: ${escapeHtml(svc)}</li>
        <li><strong>기준 반경</strong>: ${escapeHtml(String(s.radius_m || ''))}m</li>
        <li><strong>반경 내 유사 업종</strong>: ${s.same_or_similar_stores != null ? escapeHtml(String(s.same_or_similar_stores)) + '개' : '—'}</li>
        <li><strong>경쟁 강도</strong>: ${escapeHtml(s.density_level || '—')}</li>
        <li class="muted">좌표: ${Number(s.lat).toFixed(5)}, ${Number(s.lon).toFixed(5)}</li>
      </ul>
    </div>`;
}

// ── 홈 화면 ─────────────────────────────────────────────────────────────────
function initHomeButtons() {
  document.querySelector('[data-action="start-create"]').addEventListener('click', goToConsultingEntry);
  document.querySelector('[data-action="start-operate"]').addEventListener('click', () => {
    if (State.account && typeof window.openOperatingStoreSelector === 'function') {
      window.openOperatingStoreSelector();
    } else {
      goToConsultingEntry();
    }
  });
  document.querySelector('[data-action="start-financial"]').addEventListener('click', quickGoFinancial);
  document.querySelector('[data-action="open-samples"]').addEventListener('click', loadSamples);
  document.querySelectorAll('[data-action="open-map-explorer"]').forEach((btn) => {
    btn.addEventListener('click', () => goStep('map-explorer'));
  });
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
    autoSaveAnalysisHistory(result);
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

function ensureExternalSearchOpen() {
  const body = document.getElementById('external-body');
  const btn = document.getElementById('btn-toggle-external');
  if (body && body.hasAttribute('hidden')) {
    body.removeAttribute('hidden');
    if (btn) btn.textContent = '고급 검색 닫기';
  }
}

function scrollToExternalResults() {
  const el = document.getElementById('external-results');
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('external-results--flash');
    void el.offsetWidth;
    el.classList.add('external-results--flash');
    setTimeout(() => el.classList.remove('external-results--flash'), 2200);
  });
}

async function runExternalSearch() {
  const q = (document.getElementById('inp-external-q').value || '').trim();
  if (!q) return;
  ensureExternalSearchOpen();
  const status = document.getElementById('external-status');
  const placesEl  = document.getElementById('external-places');
  const matchedEl = document.getElementById('external-matched');
  status.innerHTML = '<span class="muted">카카오 검색 중…</span>';
  placesEl.innerHTML = '';
  matchedEl.innerHTML = '';

  let res;
  try {
    res = await fetchJson('/api/external-search?q=' + encodeURIComponent(q));
  } catch (e) {
    console.error('[external-search]', e);
    status.innerHTML = `<span class="error">외부 검색 실패. 카카오 REST API 키와 네트워크를 확인해주세요. (${escapeHtml(e.message || '오류')})</span>`;
    placesEl.innerHTML = '<div class="muted">결과 없음</div>';
    return;
  }

  const errMsg = (res && res.errors && res.errors.local) ? String(res.errors.local) : '';
  const places = Array.isArray(res.local_places) ? res.local_places : [];

  if (res.kakao_enabled) {
    status.innerHTML = errMsg
      ? `<span class="warn">카카오 API 오류: ${escapeHtml(errMsg)}</span>`
      : `<span class="ok">카카오 검색 결과 ${places.length}건</span>
         <button type="button" class="ext-jump" id="btn-jump-ext-results">결과 위치로 이동 ↓</button>`;
  } else {
    const help = (res.help && res.help.external_help) ? res.help.external_help : '카카오 REST API 키가 설정되지 않았습니다.';
    status.innerHTML = `<span class="warn">${escapeHtml(help)}</span>`;
  }

  State.externalPlaces = places;

  try {
    placesEl.innerHTML = places.length
      ? places.map((p, i) => renderExternalPlaceCard(p, i)).join('')
      : `<div class="muted">검색 결과가 없습니다.${errMsg ? `<br><span class="error">${escapeHtml(errMsg)}</span>` : ''}</div>`;

    placesEl.querySelectorAll('[data-fill-place]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.fillPlace);
        const list = State.externalPlaces || [];
        const place = list[idx];
        if (place) fillAreaFromPlace(place, q, btn);
      });
    });
  } catch (renderErr) {
    console.error('[external-search render]', renderErr);
    placesEl.innerHTML = `<div class="error">결과 표시 중 오류가 발생했습니다. (${escapeHtml(renderErr.message || '렌더 오류')})</div>`;
  }

  const matched = Array.isArray(res.matched_areas) ? res.matched_areas : [];
  if (!matched.length) {
    matchedEl.innerHTML = '<div class="muted">매칭되는 공공 데이터 상권을 찾지 못했습니다.<br>좌측 결과의 위치 정보를 활용해 자치구를 직접 선택해주세요.</div>';
  } else {
    matchedEl.innerHTML = matched.map(a => `
      <div class="ext-card matched" data-area="${escapeHtml(a.area_code)}" data-name="${escapeHtml(a.area_name)}" data-district="${escapeHtml(a.district)}" data-dong="${escapeHtml(a.dong)}">
        <div class="ext-title">${escapeHtml(a.area_name)}</div>
        <div class="ext-meta">${escapeHtml(a.area_type)} · ${escapeHtml(a.district)} ${escapeHtml(a.dong)}</div>
        <div class="ext-meta muted">검색 위치에서 약 ${escapeHtml(String(a.dist_m))}m</div>
        <button class="btn btn-secondary btn-xs">이 상권 선택</button>
      </div>`).join('');
    matchedEl.querySelectorAll('.ext-card.matched').forEach(card => {
      card.addEventListener('click', () => applyMatchedArea(card.dataset, q));
    });
  }

  document.getElementById('btn-jump-ext-results')?.addEventListener('click', scrollToExternalResults);
  scrollToExternalResults();
}

/** 검색어·카카오 카테고리·상호명에서 공공데이터 업종명 추정 */
function inferServiceNameFromText(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return '';
  if (s.includes('약국') || s.includes('의약') || s.includes('한약')) return '의약품';
  if (s.includes('카페') || s.includes('커피') || s.includes('스타벅스') || s.includes('베이커') || s.includes('디저트')) return '커피-음료';
  if (s.includes('치킨')) return '치킨전문점';
  if (s.includes('분식') || s.includes('떡볶') || s.includes('김밥')) return '분식전문점';
  if (s.includes('편의점') || s.includes('cu') || s.includes('gs25') || s.includes('세븐일레븐')) return '편의점';
  if (s.includes('미용') || s.includes('헤어') || s.includes('네일') || s.includes('이발')) return '미용실';
  if (s.includes('사진')) return '사진관';
  if (s.includes('학원') || s.includes('교습') || s.includes('어학')) return '일반교습학원';
  if (s.includes('피트니스') || s.includes('헬스') || s.includes('요가') || s.includes('필라테스')) return '헬스장';
  if (s.includes('세탁')) return '세탁소';
  if (s.includes('주점') || s.includes('술집') || s.includes('호프') || s.includes('바')) return '일반유흥주점';
  if (s.includes('한식') || s.includes('국밥') || s.includes('찌개') || s.includes('백반')) return '한식음식점';
  if (s.includes('중식') || s.includes('중국')) return '중식음식점';
  if (s.includes('일식') || s.includes('초밥') || s.includes('돈까스') || s.includes('라멘')) return '일식음식점';
  if (s.includes('양식') || s.includes('파스타') || s.includes('스테이크') || s.includes('피자')) return '양식음식점';
  if (s.includes('패스트푸드') || s.includes('버거') || s.includes('햄버거')) return '패스트푸드';
  if (s.includes('베이커') || s.includes('빵') || s.includes('제과')) return '제과점';
  if (s.includes('슈퍼') || s.includes('마트') || s.includes('식자재')) return '슈퍼마켓';
  if (s.includes('부동산')) return '부동산중개업';
  if (s.includes('세차') || s.includes('주유')) return '세차장';
  return '';
}

function guessServiceNameFromKeyword(q) {
  return inferServiceNameFromText(q);
}

/** 카카오 로컬 place 객체(category·상호·검색어)에서 업종 추정 */
function guessServiceNameFromPlace(place, sourceKeyword = '') {
  if (!place) return guessServiceNameFromKeyword(sourceKeyword);
  const parts = [
    place.category,
    place.category_group,
    place.title,
    sourceKeyword,
  ].filter(Boolean);
  for (const part of parts) {
    const hit = inferServiceNameFromText(part);
    if (hit) return hit;
  }
  return '';
}

/** sel-service 옵션 중 추정 업종과 가장 잘 맞는 값 선택 (없으면 옵션 추가) */
function applyServiceNameToSelect(serviceSel, serviceName, labelSuffix = '외부 검색 추정') {
  if (!serviceSel || !serviceName) return false;
  const guess = String(serviceName).trim();
  if (!guess) return false;

  const opts = [...serviceSel.options].filter((o) => o.value);
  let matched = opts.find((o) => o.value === guess);
  if (!matched) {
    matched = opts.find((o) => o.value.includes(guess) || guess.includes(o.value));
  }
  if (!matched) {
    const gLower = guess.toLowerCase();
    matched = opts.find((o) => {
      const v = String(o.value).toLowerCase();
      return v.includes(gLower) || gLower.includes(v);
    });
  }

  const finalVal = matched ? matched.value : guess;
  if (!opts.some((o) => o.value === finalVal)) {
    const opt = document.createElement('option');
    opt.value = finalVal;
    opt.textContent = `${finalVal} (${labelSuffix})`;
    serviceSel.appendChild(opt);
  }
  serviceSel.value = finalVal;
  onServiceChange();
  return true;
}

/** 카카오 로컬 검색 결과(가맹점)의 좌표로 가장 가까운 공공데이터 상권을 찾아
 *  자치구·행정동·상권·업종을 자동으로 채운다. (지도 이동은 별도 '카카오맵에서 보기' 버튼) */
async function fillAreaFromPlace(place, sourceKeyword = '', btnEl = null) {
  if (!place || !place.lat || !place.lon) {
    alert('이 장소는 좌표 정보가 없어 자동 채우기를 할 수 없습니다.');
    return;
  }
  const prevText = btnEl ? btnEl.textContent : '';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '매칭 중…'; }
  try {
    const res = await fetchJson(
      `/api/map-explorer/nearest-area?lat=${encodeURIComponent(place.lat)}&lon=${encodeURIComponent(place.lon)}`,
    );
    const cand = (res?.candidates || [])[0];
    if (!cand || !cand.area_code) {
      alert('가까운 공공데이터 상권을 찾지 못했습니다. 우측 매칭 상권 목록을 이용해 주세요.');
      return;
    }
    const svcGuess = guessServiceNameFromPlace(place, sourceKeyword);
    await applyMatchedArea(
      {
        area: cand.area_code,
        name: cand.area_name,
        district: cand.district,
        dong: cand.dong,
      },
      sourceKeyword || place.title || '',
      svcGuess,
    );
  } catch (e) {
    alert('지역·업종 자동 채우기에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = prevText; }
  }
}

async function applyMatchedArea(d, sourceKeyword = '', serviceHint = '') {
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
  const svcGuess = String(serviceHint || '').trim() || guessServiceNameFromKeyword(sourceKeyword);
  const serviceSel = document.getElementById('sel-service');
  if (svcGuess && serviceSel) {
    applyServiceNameToSelect(serviceSel, svcGuess);
  }
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
  btn.disabled = true; const oldText = btn.textContent; btn.textContent = '시뮬레이션 기본값 계산 중…';
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

    State.financeRecommendationApplied = true;
    State.financeRecommendationBaseline = JSON.parse(JSON.stringify(readFinance()));

    refreshFinanceLivePreview();

    // 각 입력 옆에 시뮬 기본값 hint 표시
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
      hint.innerHTML = `<span class="rec-tag">시뮬 기본값</span> ${formatted}<br><span class="rec-src">${escapeHtml(src)}</span>`;
    });

    const conf = { high: '높음', medium: '보통', low: '낮음 (합성 데이터 기반)' }[r.confidence] || r.confidence;
    desc.innerHTML = `
      <b>${r.area_name || State.area_code} · ${r.service_name || '-'}</b> 기준 시뮬레이션 기본값을 채웠습니다.
      신뢰도: <b>${conf}</b>. 산식·근거는 아래 카드를 참고하고, 항목별 출처는 입력란 아래를 보세요.
      수정하면 미리보기와 참고 수치가 함께 바뀝니다. 이어서 <b>분석 시작</b>을 누르세요.`;
  } catch (e) {
    console.error(e);
    alert('시뮬레이션 기본값 계산에 실패했습니다.');
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
  State.financeRecommendationApplied = false;
  State.financeRecommendationBaseline = null;
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
  State.financeRecommendationApplied = false;
  State.financeRecommendationBaseline = null;
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

const FIN_REC_SNAPSHOT_KEYS = [
  'monthly_sales', 'rent', 'labor_cost', 'loan_balance', 'cash_balance', 'own_capital',
  'interest_rate', 'monthly_repayment', 'initial_investment', 'cost_ratio',
  'misc_monthly_cost', 'misc_initial_cost',
];

function financeFieldNearEqual(a, b, key) {
  if (a === '' || a === undefined || a === null) {
    return b === '' || b === undefined || b === null;
  }
  if (b === '' || b === undefined || b === null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) === String(b);
  if (key === 'cost_ratio') return Math.abs(na - nb) < 0.0001;
  return Math.abs(na - nb) < 1;
}

function countFinanceDiff(baseline, current) {
  const baselineObj = baseline || {};
  const currentObj = current || {};
  let changed = 0;
  let tracked = 0;
  FIN_REC_SNAPSHOT_KEYS.forEach((k) => {
    const bv = baselineObj[k];
    const cv = currentObj[k];
    const bEmpty = bv === undefined || bv === '' || (typeof bv === 'number' && !Number.isFinite(bv));
    const cEmpty = cv === undefined || cv === '' || (typeof cv === 'number' && !Number.isFinite(cv));
    if (bEmpty && cEmpty) return;
    tracked += 1;
    if (!financeFieldNearEqual(bv, cv, k)) changed += 1;
  });
  return { changed, tracked };
}

/**
 * 자동 채움 응답·현재 폼값 기준 산식·근거 카드 (대출 추천 아님).
 * recommendation.explanation·sources·notes 우선, 없으면 fallback 문구 사용.
 */
function buildFinanceRecommendationExplanation(recommendation, formValues) {
  const rec = recommendation || {};
  const fv = formValues || {};
  const apiEx = rec.explanation || {};
  const srcAll = rec.sources || {};
  const model = buildFinancePreviewModel(fv);
  const fundingGap = Math.max(0, model.recommended_working_capital - Number(fv.cash_balance || 0));
  const fixed = model.fixed_cost;
  const rawCash = Number(fv.cash_balance || 0);
  const cashMo = fixed > 0 ? rawCash / fixed : null;

  function mergeCard(cardKey, title, fallback, extra = {}) {
    const ax = apiEx[cardKey];
    const fb = fallback || {};
    const formula = (ax && ax.formula) ? String(ax.formula) : fb.formula;
    const basis = (ax && ax.basis) ? String(ax.basis) : fb.basis;
    const caution = (ax && ax.caution) ? String(ax.caution) : fb.caution;
    const srcLine = srcAll[cardKey] ? String(srcAll[cardKey]) : '';
    return {
      title,
      formula,
      basis,
      caution,
      sourceExtra: srcLine,
      computedNote: extra.computedNote,
    };
  }

  const cards = [
    mergeCard(
      'monthly_sales',
      '월 평균 매출',
      {
        formula: '선택 상권·업종 분기 추정매출 ÷ 3개월 ÷ 동일 업종 점포 수',
        basis: '서울시 상권 추정매출 + 점포 데이터',
        caution: '개별 점포 실제 매출과 다를 수 있음',
      },
    ),
    mergeCard(
      'rent',
      '월 임대료',
      {
        formula: '예상 월매출 × 업종별 임대료 부담률 × 지역 보정계수',
        basis: '업종 운영 템플릿 + 임대료 지표',
        caution: '실제 임대료는 면적, 층수, 계약조건에 따라 다름',
      },
    ),
    mergeCard(
      'labor_cost',
      '월 인건비',
      {
        formula: '업종별 인건비 비율 × 예상 월매출 (직원 수·급여 가정을 매출 비율로 근사)',
        basis: '업종 운영 템플릿',
        caution: '근무시간과 고용형태에 따라 달라짐',
      },
    ),
    mergeCard(
      'funding_check_gap',
      '자금 점검 필요액',
      {
        formula: '최소 권장 현금보유액 − 현재 현금보유액 (최소 권장 ≈ 월 고정비 × 3개월)',
        basis: '월 고정비 3개월분 기준',
        caution: '대출 추천이 아니라 자금 점검 참고값',
      },
      {
        computedNote:
          `현재 입력 기준: 최소 권장 현금 약 ${fmtMoney(model.recommended_working_capital)}, `
          + `점검 여유 부족분 약 ${fmtMoney(fundingGap)}`,
      },
    ),
    mergeCard(
      'cash_runway_months',
      '현금보유개월 수',
      {
        formula: '현금보유액 ÷ 월 고정비',
        basis: '입력값 또는 시뮬레이션 기본값 기반',
        caution: '매출 변동이 크면 실제 버틸 수 있는 기간은 달라질 수 있음',
      },
      {
        computedNote: Number.isFinite(cashMo) && fixed > 0
          ? `현재 입력 기준 약 ${cashMo.toFixed(1)}개월 (월 고정비 합 약 ${fmtMoney(fixed)})`
          : '월 고정비가 0에 가까우면 개월 수 해석이 불안정할 수 있습니다.',
      },
    ),
  ];

  const footerNotes = Array.isArray(rec.notes) ? rec.notes.slice() : [];

  return { cards, footerNotes };
}

function renderFinanceRecommendationExplainHtml(rec, formValues, baseline) {
  const pack = buildFinanceRecommendationExplanation(rec, formValues);
  const { changed, tracked } = countFinanceDiff(baseline, formValues);
  let bannerHtml = '';
  if (changed > 0) {
    bannerHtml =
      changed >= tracked && tracked > 0
        ? `<div class="fre-banner fre-banner-strong">${escapeHtml(
          '현재 숫자는 사용자 수정값 기준으로 미리보기가 재계산되었습니다.',
        )}</div>`
        : `<div class="fre-banner">${escapeHtml(
          '일부 값은 사용자가 수정했습니다. 아래 산식·근거는 참고용입니다.',
        )}</div>`;
  }

  const cardsHtml = pack.cards
    .map((c) => {
      const srcBlock = c.sourceExtra
        ? `<div class="fre-src-line"><span class="fre-src-label">출처 요약</span> ${escapeHtml(c.sourceExtra)}</div>`
        : '';
      const computed = c.computedNote
        ? `<dt>참고 수치</dt><dd class="fre-computed">${escapeHtml(c.computedNote)}</dd>`
        : '';
      return `
      <div class="fre-card">
        <div class="fre-card-title">${escapeHtml(c.title)}</div>
        <dl class="fre-dl">
          <dt>산식</dt><dd>${escapeHtml(c.formula)}</dd>
          <dt>근거</dt><dd>${escapeHtml(c.basis)}${srcBlock}</dd>
          <dt>주의</dt><dd>${escapeHtml(c.caution)}</dd>
          ${computed}
        </dl>
      </div>`;
    })
    .join('');

  const notesHtml = pack.footerNotes.length
    ? `<ul class="fre-notes">${pack.footerNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
    : '';

  return `
    ${bannerHtml}
    <div class="fre-head-block">
      <h3 class="fre-main-title">추천값 산식·근거</h3>
      <p class="fre-sub">공공데이터·업종 휴리스틱 기준 <strong>사업 조건 시뮬레이션 기본값</strong> 설명입니다. 특정 금융상품을 권유하지 않습니다.</p>
    </div>
    <div class="fre-cards">${cardsHtml}</div>
    ${notesHtml}
    <p class="fre-disclaimer">대출 가능 여부와 금리는 실제 심사·상담을 통해 확인해야 합니다.</p>
  `;
}

function updateFinanceRecommendationExplainPanel() {
  const wrap = document.getElementById('finance-recommendation-explain');
  if (!wrap) return;
  if (!State.financeRecommendationApplied || !State.recommendation) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  const fv = readFinance();
  wrap.hidden = false;
  wrap.innerHTML = renderFinanceRecommendationExplainHtml(
    State.recommendation,
    fv,
    State.financeRecommendationBaseline,
  );
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

/** 사용자 유형 「창업 예정자」(예비창업) 여부 */
function isPreStartupUser(d) {
  const ut = String(d?.user_type || State.user_type || '').trim();
  return ut === '창업 예정자';
}

/**
 * 예비창업 시뮬레이션 (창업비·자기자본·대출금리·개업 후 운영 가용).
 * 분석 결과 재무 스냅샷 f의 월 손익·고정비 가정을 그대로 사용한다.
 */
function computeStartupFundingSimulation(inputs, f) {
  const startup = Math.max(0, Number(inputs.startup || 0));
  const equity = Math.max(0, Number(inputs.equity || 0));
  const ratePct = Number(inputs.ratePct ?? 5.5);
  const reserve = Math.max(0, Number(inputs.reserve || 0));

  const loanNeed = Math.max(0, startup - equity);
  const loanMonthlyInt = loanNeed * (ratePct / 100) / 12;

  const ms = Number(f.monthly_sales) || 0;
  const fixed = Number(f.fixed_cost) || 0;
  const variable = Number(f.variable_cost) || 0;
  const mrep = Number(f.monthly_repayment) || 0;
  const legacyInt = Number(f.monthly_interest) || 0;

  const netMonthly = ms - fixed - variable - mrep - legacyInt - loanMonthlyInt;

  let runwayMonths = null;
  let runwayNote = '';
  if (reserve <= 0) {
    runwayNote = '개업 직후 운영에 쓸 수 있는 현금(운영 가용)을 입력하면, 적자일 때 대략 몇 개월 버틸 수 있는지 계산합니다.';
  } else if (netMonthly >= 0) {
    runwayNote = `이 가정에서는 월 순현금이 약 ${fmtMoney(netMonthly)} 흑자(추정)입니다. 창업 초기에는 매출·비용이 변동할 수 있어, 운영 가용은 안전 버퍼로 두는 것을 권장합니다.`;
  } else {
    const deficit = -netMonthly;
    runwayMonths = reserve / deficit;
    runwayNote = `월 순현금이 약 ${fmtMoney(deficit)} 부족(추정)일 때, 운영 가용 ${fmtMoney(reserve)}으로는 약 <b>${runwayMonths.toFixed(1)}개월</b> 버틸 수 있는 수준(참고)입니다.`;
  }

  const equityRatio = startup > 0 ? Math.round((Math.min(equity, startup) / startup) * 1000) / 10 : null;
  const loanCoverRatio = startup > 0 ? Math.round((loanNeed / startup) * 1000) / 10 : null;

  return {
    startup,
    equity,
    ratePct,
    reserve,
    loanNeed,
    loanMonthlyInt,
    netMonthly,
    runwayMonths,
    runwayNote,
    equityRatio,
    loanCoverRatio,
  };
}

function renderStartupOverviewExtras(d) {
  if (!isPreStartupUser(d)) return '';
  const f = financeForResultView(d);
  const initTot = Number(f.initial_investment || 0);
  const own = Number((f.own_capital != null && f.own_capital !== '') ? f.own_capital : (f.cash_balance || 0));
  const gap = Number(f.funding_gap_estimate ?? Math.max(0, initTot - own));
  const loanEst = Number(f.loan_needed_estimate ?? gap);
  const rec = Number(f.recommended_working_capital || 0);
  const ir = Number(f.interest_rate || 5.5);
  const loanInt = Number(f.loan_monthly_interest_estimate || loanEst * ir / 100 / 12);

  return `
    <div class="startup-overview-banner">
      <div class="startup-overview-title">예비창업 자금·조달 가늠치 (추정 · 참고)</div>
      <p class="startup-overview-lead">
        아래 수치는 선택 상권·업종과 입력한 사업 조건(또는 합성 데이터)으로 계산된 <b>참고값</b>입니다. 실제 가맹비·인테리어·보증금은 계약에 따라 달라질 수 있습니다.
      </p>
      <ul class="startup-overview-list">
        <li><strong>초기 소요(추정)</strong> 약 <b>${fmtMoney(initTot)}</b> — 시설·보증금·가맹비 등 구성은 자금 탭에서 확인</li>
        <li><strong>자기자본(반영값)</strong> 약 <b>${fmtMoney(own)}</b> — 부족분은 조달·대출 검토 구간으로 가늠</li>
        <li><strong>참고 조달·대출 검토액</strong> 약 <b>${fmtMoney(loanEst)}</b> (자기자본을 초기 소요까지 채운 뒤 남는 부족분 기준)</li>
        <li><strong>위 조달액 가정 시 월 이자(연 ${ir}% 가정)</strong> 약 <b>${fmtMoney(loanInt)}</b></li>
        <li><strong>권장 운영자금(약 3개월 고정비)</strong> 약 <b>${fmtMoney(rec)}</b> — 오픈 초 현금 흐름 완충용으로 별도 확보 검토</li>
      </ul>
    </div>`;
}

function buildStartupSimulatorSection(d, f) {
  if (!isPreStartupUser(d)) return '';

  const startupDef = Math.round(Number(f.initial_investment || 0));
  const equityDef = Math.round(Number((f.own_capital != null && f.own_capital !== '') ? f.own_capital : (f.cash_balance || 0)));
  const rateDef = Number(f.interest_rate || 5.5);
  const reserveDef = Math.round(Number(f.cash_balance || 0));

  return `
    <section class="startup-sim-card" aria-labelledby="startup-sim-heading">
      <h4 class="startup-sim-title" id="startup-sim-heading">예비창업 자금 시뮬레이션</h4>
      <p class="startup-sim-lead">
        <b>예상 창업비용</b>과 <b>직접 부담 가능한 자금</b>을 넣으면, 부족분을 대출로 메웠다고 가정할 때의 <b>참고 대출액·월 이자</b>를 볼 수 있습니다.
        <b>개업 직후 운영 가용 현금</b>을 넣으면, 분석 결과의 월 매출·비용 가정으로 <b>대략 몇 개월 운영을 버틸 수 있는지</b>도 계산합니다.
      </p>
      <div class="startup-sim-grid">
        <label class="startup-sim-field">
          <span>예상 창업비용 총액 (원)</span>
          <input type="number" id="startup-sim-startup" min="0" step="100000" value="${startupDef}" />
        </label>
        <label class="startup-sim-field">
          <span>직접 부담 가능 자금 · 자기자본 (원)</span>
          <input type="number" id="startup-sim-equity" min="0" step="100000" value="${equityDef}" />
        </label>
        <label class="startup-sim-field">
          <span>조달 대출 금리 가정 (연 %)</span>
          <input type="number" id="startup-sim-rate" min="0" max="30" step="0.1" value="${rateDef}" />
        </label>
        <label class="startup-sim-field">
          <span>개업 직후 운영 가용 현금 (원)</span>
          <input type="number" id="startup-sim-reserve" min="0" step="100000" value="${reserveDef}" />
        </label>
      </div>
      <div class="startup-sim-results" id="startup-sim-results"></div>
      <p class="startup-sim-footnote">
        월 순현금에는 분석 결과의 월 매출·임대·인건비·원가율·기존 대출 월상환·기존 대출 이자에,
        위에서 가정한 <b>추가 조달분에 대한 월 이자</b>까지 반영합니다. 실제 심사 한도·금리·상환 조건은 금융기관 상담 결과와 다를 수 있습니다.
      </p>
    </section>`;
}

function updateStartupSimulatorDOM(d) {
  const root = document.getElementById('startup-sim-results');
  if (!root || !isPreStartupUser(d)) return;

  const f = financeForResultView(d);
  const startup = Number(document.getElementById('startup-sim-startup')?.value || 0);
  const equity = Number(document.getElementById('startup-sim-equity')?.value || 0);
  const ratePct = Number(document.getElementById('startup-sim-rate')?.value ?? 5.5);
  const reserve = Number(document.getElementById('startup-sim-reserve')?.value || 0);

  const sim = computeStartupFundingSimulation(
    { startup, equity, ratePct, reserve },
    f,
  );

  const loanPctTxt = sim.loanCoverRatio != null
    ? `창업비 중 약 <b>${sim.loanCoverRatio}%</b>를 조달·대출로 메운다고 가정`
    : '';
  const equityPctTxt = sim.equityRatio != null
    ? `창업비 중 약 <b>${sim.equityRatio}%</b>를 자기자본으로 부담`
    : '';

  root.innerHTML = `
    <div class="startup-sim-kpis">
      <div class="startup-sim-kpi">
        <div class="startup-sim-kpi-label">조달·대출 필요액 (추정)</div>
        <div class="startup-sim-kpi-value">${fmtMoney(sim.loanNeed)}</div>
        <div class="startup-sim-kpi-sub">${loanPctTxt}</div>
      </div>
      <div class="startup-sim-kpi">
        <div class="startup-sim-kpi-label">위 금액 가정 시 월 이자 (추정)</div>
        <div class="startup-sim-kpi-value">${fmtMoney(sim.loanMonthlyInt)}</div>
        <div class="startup-sim-kpi-sub">${equityPctTxt}</div>
      </div>
      <div class="startup-sim-kpi wide">
        <div class="startup-sim-kpi-label">개업 후 월 순현금흐름 (추정)</div>
        <div class="startup-sim-kpi-value">${fmtMoney(sim.netMonthly)}</div>
        <div class="startup-sim-kpi-sub">매출 − 고정·변동비 − 기존 대출 상환·이자 − <b>추가 조달 이자</b></div>
      </div>
    </div>
    <div class="startup-sim-runway">
      <div class="startup-sim-runway-label">운영 가용 현금으로 버티는 기간 (참고)</div>
      <div class="startup-sim-runway-body">${sim.runwayNote}</div>
    </div>`;
}

function bindStartupSimulatorPanel(d) {
  if (!isPreStartupUser(d)) return;
  ['startup-sim-startup', 'startup-sim-equity', 'startup-sim-rate', 'startup-sim-reserve'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => updateStartupSimulatorDOM(d));
    document.getElementById(id)?.addEventListener('change', () => updateStartupSimulatorDOM(d));
  });
  updateStartupSimulatorDOM(d);
}

function refreshFinanceLivePreview() {
  updateFinanceRecommendationExplainPanel();
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
    autoSaveAnalysisHistory(data);
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

/** 결과 패널 탭 id (순서와 무관하게 표시 전환에 사용) */
const RESULT_PANEL_TAB_IDS = ['overview', 'trend', 'map', 'finance', 'services', 'action-plan', 'report'];

function switchResultTab(target) {
  document.querySelectorAll('#panel-result .tab').forEach(x => {
    x.classList.toggle('active', x.dataset.tab === target);
  });
  RESULT_PANEL_TAB_IDS.forEach((name) => {
    const el = document.getElementById(`tab-${name}`);
    if (!el) return;
    el.style.display = (name === target) ? '' : 'none';
    if (name === target) el.classList.add('active');
    else el.classList.remove('active');
  });
  if (target === 'trend') renderTrendTab();
  if (target === 'finance' && State.result) drawFinanceCharts(State.result);
  if (target === 'map') renderMapTab();
  if (target === 'report') renderReportTab();
  if (target === 'action-plan') renderActionPlanTab(State.result);
}

function normalizeActionPlanItem(item) {
  if (item == null) return null;
  if (typeof item === 'string') {
    const text = item.trim();
    return text ? { text, cta: null } : null;
  }
  if (typeof item === 'object') {
    const text = String(item.text || item.title || item.label || '').trim();
    if (!text) return null;
    let cta = null;
    if (item.cta && typeof item.cta === 'object' && item.cta.label && item.cta.tab) {
      cta = { label: String(item.cta.label), tab: String(item.cta.tab) };
    } else if (item.cta_label && item.cta_tab) {
      cta = { label: String(item.cta_label), tab: String(item.cta_tab) };
    }
    return { text, cta };
  }
  return null;
}

function normalizeActionPlanFromApi(raw) {
  if (!raw || typeof raw !== 'object') return null;
  function pickArr(...keys) {
    for (const k of keys) {
      const v = raw[k];
      if (Array.isArray(v) && v.length) return v;
    }
    return [];
  }
  const today = pickArr('today', '오늘', 'today_tasks').map(normalizeActionPlanItem).filter(Boolean);
  const week = pickArr('week', '이번주', 'week_tasks').map(normalizeActionPlanItem).filter(Boolean);
  const month = pickArr('month', '이번달', 'month_tasks').map(normalizeActionPlanItem).filter(Boolean);
  if (!today.length && !week.length && !month.length) return null;
  return { today, week, month };
}

const PLAN_30_STARTUP = {
  today: [
    { text: '후보 상권 2곳 추가 비교', cta: { label: '상권 요약 보기', tab: 'overview' } },
    { text: '예상 임대료와 보증금 확인', cta: { label: '자금·손익분기점 보기', tab: 'finance' } },
    { text: '경쟁점 10개 메뉴·가격 조사', cta: { label: '경쟁점 지도 보기', tab: 'map' } },
  ],
  week: [
    { text: '손익분기점 기준으로 월 고정비 재조정', cta: { label: '자금 시뮬레이션 보기', tab: 'finance' } },
    { text: '초기 운영자금 6개월분 확보 가능성 점검', cta: { label: '자금·손익분기점 보기', tab: 'finance' } },
    { text: '카드 매출관리 전략 설계', cta: { label: '신한 서비스 연결 보기', tab: 'services' } },
  ],
  month: [
    { text: '정책자금·보증 상담 가능성 확인', cta: { label: '상담 준비자료 보기', tab: 'services' } },
    { text: '보험 체크리스트 확인', cta: { label: '보험 체크리스트 보기', tab: 'services' } },
    { text: '오픈 전 프로모션 계획 수립', cta: { label: 'AI 리포트 보기', tab: 'report' } },
  ],
};

const PLAN_30_OPERATING = {
  today: [
    { text: '약한 시간대 매출 확인', cta: { label: '매출·점포 추이 보기', tab: 'trend' } },
    { text: '고정비 항목 점검', cta: { label: '자금 시뮬레이션 보기', tab: 'finance' } },
    { text: '최근 4주 매출 변화 확인', cta: { label: '매출·점포 추이 보기', tab: 'trend' } },
  ],
  week: [
    { text: '재방문 쿠폰 또는 프로모션 테스트', cta: { label: '신한 서비스 연결 보기', tab: 'services' } },
    { text: '매출 감소 시나리오 점검', cta: { label: '자금·손익분기점 보기', tab: 'finance' } },
    { text: '카드 정산 주기 확인', cta: { label: '신한 서비스 연결 보기', tab: 'services' } },
  ],
  month: [
    { text: '운영자금 상담 필요성 점검', cta: { label: '신한 서비스 연결 보기', tab: 'services' } },
    { text: '보험 보장 공백 확인', cta: { label: '보험 체크리스트 보기', tab: 'services' } },
    { text: '비용 절감 항목 실행', cta: { label: '자금 시뮬레이션 보기', tab: 'finance' } },
  ],
};

function clone30DayPlan(p) {
  const cp = (arr) => arr.map((x) => ({
    text: x.text,
    cta: x.cta ? { label: x.cta.label, tab: x.cta.tab } : null,
  }));
  return {
    today: cp(p.today || []),
    week: cp(p.week || []),
    month: cp(p.month || []),
  };
}

function actionPlanPersonaIsOperating(d) {
  const ut = String(d?.user_type || State.user_type || '').trim();
  return ut.includes('운영') || ut.includes('금융 점검') || ut.includes('금융/보험');
}

function buildDefault30DayActionPlan(data) {
  const d = data || {};
  return clone30DayPlan(actionPlanPersonaIsOperating(d) ? PLAN_30_OPERATING : PLAN_30_STARTUP);
}

function augmentActionPlanWithSignals(plan, d) {
  const out = clone30DayPlan(plan);
  const fin = financeForResultView(d) || {};
  const cmRaw = fin.cash_months ?? fin.cash_runway_months ?? d?.finance?.cash_months;
  const cm = Number(cmRaw);
  if (Number.isFinite(cm) && cm < 6) {
    out.week.unshift({
      text: `현금보유개월이 약 ${cm.toFixed(1)}개월 수준으로 추정되어 운영자금 버퍼를 우선 점검하세요.`,
      cta: { label: '자금·손익분기점 보기', tab: 'finance' },
    });
  }
  const comp = Number(d?.scores?.competition?.score);
  if (Number.isFinite(comp) && comp >= 58) {
    const hit = [...out.today, ...out.week].some((x) => /경쟁/.test(x.text));
    if (!hit) {
      out.today.push({
        text: '경쟁 강도가 높게 나왔습니다. 반경 내 유사 업종 가격대를 다시 확인하세요.',
        cta: { label: '경쟁점 지도 보기', tab: 'map' },
      });
    }
  }
  const warns = Array.isArray(d.warnings) ? d.warnings : [];
  if (warns.length) {
    out.week.push({
      text: `조기경보 ${warns.length}건을 반영해 원인·대응을 메모해 두세요.`,
      cta: { label: '매출·점포 추이 보기', tab: 'trend' },
    });
  }
  return out;
}

/**
 * API의 action_plan_30days / action_plan 우선, 없으면 유형·점수·경고 기반 fallback.
 * @returns {{ today: Array<{text:string, cta:{label:string, tab:string}|null}>, week: ..., month: ... }}
 */
function build30DayActionPlan(data) {
  const d = data || {};
  const fromApi = normalizeActionPlanFromApi(d.action_plan_30days)
    || normalizeActionPlanFromApi(d.action_plan);
  const base = fromApi || buildDefault30DayActionPlan(d);
  return augmentActionPlanWithSignals(base, d);
}

function renderActionPlanTab(data) {
  const wrap = document.getElementById('tab-action-plan');
  if (!wrap) return;
  const d = data || State.result;
  if (!d) {
    wrap.innerHTML = '<p class="tab-desc">분석 결과가 없습니다.</p>';
    return;
  }
  const plan = build30DayActionPlan(d);

  function col(title, items, slug) {
    const lis = items.map((it) => {
      const ctaHtml = it.cta && it.cta.label && it.cta.tab
        ? `<div class="action-plan-cta-row"><button type="button" class="btn btn-ghost btn-sm action-plan-cta" data-ap-tab="${escapeHtml(it.cta.tab)}">${escapeHtml(it.cta.label)}</button></div>`
        : '';
      return `<li class="action-plan-item"><span class="action-plan-text">${escapeHtml(it.text)}</span>${ctaHtml}</li>`;
    }).join('');
    return `
      <section class="action-plan-section" aria-labelledby="ap-${slug}">
        <h4 class="action-plan-h" id="ap-${slug}">${escapeHtml(title)}</h4>
        <ul class="action-plan-list">${lis}</ul>
      </section>`;
  }

  wrap.innerHTML = `
    <h3 class="tab-title">30일 실행 플랜</h3>
    <p class="tab-desc">바로 실행할 수 있는 행동 목록입니다. 아래 버튼은 이 결과 화면 안의 다른 탭으로만 이동하며, 외부 상담 신청이나 데이터 전송은 하지 않습니다.</p>
    <div class="action-plan-grid">
      ${col('오늘 할 일', plan.today, 'today')}
      ${col('이번 주 할 일', plan.week, 'week')}
      ${col('이번 달 할 일', plan.month, 'month')}
    </div>
  `;
}

// ── 5. 결과 렌더링 ─────────────────────────────────────────────────────────
function initResultTabs() {
  document.querySelectorAll('#panel-result .tab').forEach(t => {
    t.addEventListener('click', () => switchResultTab(t.dataset.tab));
  });

  const panelResult = document.getElementById('panel-result');
  if (panelResult && !panelResult.dataset.apTabBound) {
    panelResult.dataset.apTabBound = '1';
    panelResult.addEventListener('click', (e) => {
      const btn = e.target.closest('.action-plan-cta[data-ap-tab]');
      if (!btn || !panelResult.contains(btn)) return;
      const tab = btn.dataset.apTab;
      if (!tab || !RESULT_PANEL_TAB_IDS.includes(tab)) return;
      e.preventDefault();
      switchResultTab(tab);
    });
  }

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
  document.getElementById('tab-action-plan').innerHTML = '';
  destroyMapView();
  document.getElementById('tab-map').innerHTML    = '';
  // 결과 패널 탭만 초기화 (전역 .tab 은 운영/금융 등 다른 패널 탭과 섞이면 안 됨)
  document.querySelectorAll('#panel-result .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === 'overview');
  });
  RESULT_PANEL_TAB_IDS.forEach((n) => {
    const el = document.getElementById('tab-' + n);
    if (!el) return;
    el.style.display = (n === 'overview') ? '' : 'none';
    el.classList.toggle('active', n === 'overview');
  });
}

function fmtManwon(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '추정 불가';
  return `${Math.round(n / 10000).toLocaleString('ko-KR')}만 원`;
}

function fmtMonth1(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '추정 불가';
  return `${n.toFixed(1)}개월`;
}

function buildDecisionSummary(data) {
  const d = data || {};
  const finance = financeForResultView(d) || {};
  const final = d?.scores?.final || {};
  const userType = String(d?.user_type || State.user_type || '').trim();

  const pickNum = (...vals) => {
    for (const v of vals) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const monthly = pickNum(
    d.monthly_sales,
    d.estimated_monthly_sales,
    d?.finance?.monthly_sales,
    d?.business_input?.monthly_sales,
    finance.monthly_sales,
  );
  const breakEven = pickNum(
    d.break_even_sales,
    d?.finance?.break_even_sales,
    d?.business_input?.break_even_sales,
    d?.finance?.break_even,
    finance.break_even,
  );
  const cashRunway = pickNum(
    d.cash_runway_months,
    d?.finance?.cash_runway_months,
    d?.business_input?.cash_runway_months,
    d?.finance?.cash_months,
    finance.cash_months,
  );

  let baseConclusion = '의사결정 판단을 위해 추가 점검이 필요합니다.';
  if (userType === '창업 예정자') baseConclusion = '창업은 조건부 추천입니다.';
  else if (userType === '운영 중인 사업자') baseConclusion = '운영 안정도는 보통 수준입니다.';
  else if (userType === '금융 점검' || userType === '금융/보험/비용 구조 점검') baseConclusion = '재무 체력 점검이 필요합니다.';

  const scoreTxt = Number.isFinite(Number(final.score))
    ? `${Number(final.score).toFixed(0)}점${final.label ? `(${final.label})` : ''}`
    : null;
  const beStatus = (monthly != null && breakEven != null)
    ? (monthly >= breakEven ? '예상 월매출이 손익분기 매출을 상회하지만' : '예상 월매출이 손익분기 매출에 못 미쳐')
    : '핵심 수치 확인이 더 필요하며';
  const conclusion = scoreTxt
    ? `${baseConclusion} 현재 종합 평가는 ${scoreTxt}이고, ${beStatus} 리스크 점검이 필요합니다.`
    : `${baseConclusion} ${beStatus} 운영·상권 조건 점검이 필요합니다.`;

  const warnings = Array.isArray(d.warnings) ? d.warnings.filter(Boolean).slice(0, 3) : [];
  const score = d?.scores || {};
  const riskPool = [];
  if ((score.competition?.score ?? 0) >= 60) riskPool.push('동일 업종 경쟁 강도');
  if ((score.rent?.score ?? 0) >= 60) riskPool.push('임대료·고정비 부담');
  if ((score.debt?.score ?? 100) < 50) riskPool.push('초기 자금·현금 여력');
  if ((score.attraction?.score ?? 100) < 50) riskPool.push('상권 매력도');
  const riskHead = riskPool.slice(0, 3);
  const risk = riskHead.length
    ? `${riskHead.join(', ')}이 주요 리스크입니다.${warnings.length ? ` (${warnings.join(' / ')})` : ''}`
    : (warnings.length ? `${warnings.join(' / ')} 점검이 필요합니다.` : '핵심 리스크는 경쟁 강도·고정비·현금 여력 중심으로 점검이 필요합니다.');

  const actionItems = [];
  if (cashRunway != null && cashRunway < 6) actionItems.push('6개월 내 운영자금 버퍼 확보');
  if ((score.competition?.score ?? 0) >= 60) actionItems.push('경쟁점 대비 차별화 전략 수립');
  if ((score.shinhan_card?.score ?? 0) >= 50) actionItems.push('카드 매출관리 계획 점검');
  if (!actionItems.length) actionItems.push('손익분기·현금흐름 월간 점검');
  const action = `${actionItems.slice(0, 3).join(', ')}이 필요합니다.`;

  return {
    conclusion,
    risk,
    action,
    metrics: [
      { label: '예상 월매출', value: monthly == null ? '추정 불가' : fmtManwon(monthly), helper: '상권·업종 기준 추정' },
      { label: '손익분기 매출', value: breakEven == null ? '추정 불가' : fmtManwon(breakEven), helper: '적자 없이 버티기 위한 최소 매출' },
      { label: '현금보유개월 수', value: cashRunway == null ? '추정 불가' : fmtMonth1(cashRunway), helper: '현재 현금으로 버틸 수 있는 기간' },
    ],
  };
}

/** 기회·주의 요인의 내부 source 키 → 화면용 근거 라벨 (개발자 식별자는 노출하지 않음) */
const FACTOR_SOURCE_LABELS = {
  detect_early_warning: '조기경보 · 공공데이터',
  'scores.final': '종합 점수',
  'scores.survival': '업종 생존성',
  'scores.population': '유동인구',
  'scores.growth': '매출 성장성',
  'scores.competition': '경쟁 강도',
  'scores.rent': '임대·고정비',
  'scores.attraction': '상권 매력도',
  'scores.ecosystem': '점포 생태계',
  'finance.cash_months': '재무·현금 추정',
  'finance 추정': '재무 추정',
  'shinhan_panels.card': '카드·시간대 분석',
  API: '분석 결과',
  분석: '분석 결과',
};

function humanizeFactorSource(source) {
  const s = String(source || '').trim();
  if (!s) return '';
  if (FACTOR_SOURCE_LABELS[s]) return FACTOR_SOURCE_LABELS[s];
  if (/^scores\./.test(s)) {
    const tail = s.replace(/^scores\./, '');
    const map = {
      final: '종합 점수',
      survival: '업종 생존성',
      population: '유동인구',
      growth: '매출 성장성',
      competition: '경쟁 강도',
      rent: '임대·고정비',
      attraction: '상권 매력도',
      ecosystem: '점포 생태계',
      debt: '부채 체력',
    };
    return map[tail] ? `${map[tail]} 지표` : '';
  }
  if (/^finance\./.test(s)) return '재무 추정';
  if (/^shinhan_/.test(s)) return '신한 연계 분석';
  return '';
}

/**
 * 기회·주의 요인 Top 3용 구조화 데이터.
 * API 필드 opportunity_factors / risk_factors 가 있으면 우선 사용하고, 없으면 점수·경고·재무 등으로 보완한다.
 * @returns {{ opportunities: Array<{title:string,description:string,level:string,source:string}>, risks: Array<...> }}
 */
function buildOpportunityRiskFactors(data) {
  const d = data || {};
  const EMPTY_LEVEL = 'medium';

  function normalizeFactor(raw, fallbackSource) {
    if (raw == null) return null;
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s) return null;
      return {
        title: s.length > 28 ? `${s.slice(0, 28)}…` : s,
        description: s,
        level: EMPTY_LEVEL,
        source: fallbackSource,
      };
    }
    const title = String(raw.title ?? raw.label ?? raw.name ?? '').trim() || '요약';
    const description = String(
      raw.description ?? raw.detail ?? raw.message ?? raw.text ?? raw.body ?? '',
    ).trim();
    const lev = String(raw.level || '').toLowerCase();
    const level = lev === 'high' || lev === 'medium' || lev === 'low' ? lev : EMPTY_LEVEL;
    const source = String(raw.source ?? fallbackSource ?? '분석');
    return {
      title,
      description: description || title,
      level,
      source,
    };
  }

  function buildFallbackFactors() {
  const scores = d.scores || {};
  const finance = financeForResultView(d) || {};
  const warnings = Array.isArray(d.warnings) ? d.warnings.filter(Boolean) : [];
  const shinhanCard = d?.shinhan_panels?.card?.diagnosis || {};

  const pickNum = (...vals) => {
    for (const v of vals) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const monthly = pickNum(
    d.monthly_sales,
    d.estimated_monthly_sales,
    d?.finance?.monthly_sales,
    d?.business_input?.monthly_sales,
    finance.monthly_sales,
  );
  const breakEven = pickNum(
    d.break_even_sales,
    d?.finance?.break_even_sales,
    d?.business_input?.break_even_sales,
    d?.finance?.break_even,
    finance.break_even,
  );
  const cashRunway = pickNum(
    d.cash_runway_months,
    d?.finance?.cash_runway_months,
    d?.business_input?.cash_runway_months,
    d?.finance?.cash_months,
    finance.cash_months,
  );

  const finalSc = Number(scores.final?.score);
  const survivalSc = Number(scores.survival?.score);
  const populationSc = Number(scores.population?.score);
  const growthSc = Number(scores.growth?.score);
  const competitionSc = Number(scores.competition?.score);
  const rentSc = Number(scores.rent?.score);
  const attractionSc = Number(scores.attraction?.score);
  const ecosystemSc = Number(scores.ecosystem?.score);
  const shinhanCardSc = Number(scores.shinhan_card?.score);

  const levPos = (sc) => {
    if (!Number.isFinite(sc)) return EMPTY_LEVEL;
    if (sc >= 72) return 'high';
    if (sc >= 55) return 'medium';
    return 'low';
  };
  const levNegHigh = (sc) => {
    if (!Number.isFinite(sc)) return EMPTY_LEVEL;
    if (sc >= 65) return 'high';
    if (sc >= 50) return 'medium';
    return 'low';
  };
  const levPosLow = (sc) => {
    if (!Number.isFinite(sc)) return EMPTY_LEVEL;
    if (sc <= 35) return 'high';
    if (sc <= 45) return 'medium';
    return 'low';
  };

  const opportunities = [];
  const risks = [];
  const seenO = new Set();
  const seenR = new Set();

  function pushO(title, description, level, source) {
    const key = `${title}|${description}`;
    if (seenO.has(key) || opportunities.length >= 3) return;
    seenO.add(key);
    opportunities.push({ title, description, level, source });
  }
  function pushR(title, description, level, source) {
    const key = `${title}|${description}`;
    if (seenR.has(key) || risks.length >= 3) return;
    seenR.add(key);
    risks.push({ title, description, level, source });
  }

  warnings.forEach((w) => {
    const msg = String(w).trim();
    if (!msg || risks.length >= 3) return;
    pushR(
      '조기경보',
      msg,
      /급증|감소|낮음|미만/.test(msg) ? 'high' : 'medium',
      'detect_early_warning',
    );
  });

  if (Number.isFinite(finalSc) && finalSc >= 60) {
    pushO(
      '종합 점수',
      '종합 점수가 보통 이상입니다.',
      levPos(finalSc),
      'scores.final',
    );
  }
  if (
    monthly != null
    && breakEven != null
    && breakEven > 0
    && monthly > breakEven
  ) {
    pushO(
      '손익분기 대비 매출',
      '예상 월매출이 손익분기점을 상회합니다.',
      'high',
      'finance 추정',
    );
  }
  if (Number.isFinite(survivalSc) && survivalSc >= 58) {
    pushO(
      '업종 생존성',
      '업종 생존성이 양호합니다.',
      levPos(survivalSc),
      'scores.survival',
    );
  }
  if (Number.isFinite(populationSc) && populationSc >= 55) {
    pushO(
      '유동인구',
      '유동인구 적합도가 보통 이상입니다.',
      levPos(populationSc),
      'scores.population',
    );
  }
  if (Number.isFinite(growthSc) && growthSc >= 60) {
    pushO(
      '매출 성장성',
      '매출 성장성이 높게 나타납니다.',
      levPos(growthSc),
      'scores.growth',
    );
  }
  if (
    Number.isFinite(shinhanCardSc)
    && shinhanCardSc >= 50
    && String(shinhanCard.weak_time || '').trim()
  ) {
    pushO(
      '카드·시간대',
      '카드 활용 전략을 통해 약한 시간대 개선 여지가 있습니다.',
      'medium',
      'shinhan_panels.card',
    );
  }

  if (cashRunway != null && cashRunway < 6) {
    pushR(
      '현금 버퍼',
      '현금보유개월 수가 6개월 미만입니다.',
      cashRunway < 4 ? 'high' : 'medium',
      'finance.cash_months',
    );
  }
  if (Number.isFinite(competitionSc) && competitionSc >= 55) {
    pushR(
      '경쟁 강도',
      '동일 업종 경쟁이 강한 편입니다.',
      levNegHigh(competitionSc),
      'scores.competition',
    );
  }
  if (Number.isFinite(rentSc) && rentSc >= 55) {
    pushR(
      '임대·고정비',
      '임대료·고정비 부담이 높은 편입니다.',
      levNegHigh(rentSc),
      'scores.rent',
    );
  }
  if (Number.isFinite(attractionSc) && attractionSc < 48) {
    pushR(
      '상권 매력도',
      '상권 매력도가 낮은 편입니다.',
      levPosLow(attractionSc),
      'scores.attraction',
    );
  }
  if (Number.isFinite(ecosystemSc) && ecosystemSc < 48) {
    pushR(
      '점포 생태계',
      '점포 생태계 안정성이 낮습니다.',
      levPosLow(ecosystemSc),
      'scores.ecosystem',
    );
  }

  return {
    opportunities: opportunities.slice(0, 3),
    risks: risks.slice(0, 3),
  };
  }

  const oppApi = Array.isArray(d.opportunity_factors) ? d.opportunity_factors : [];
  const riskApi = Array.isArray(d.risk_factors) ? d.risk_factors : [];
  const fb = buildFallbackFactors();

  function mergeFactorLists(primaryRaw, fallbackList, apiLabel) {
    const primary = primaryRaw
      .map(x => normalizeFactor(x, apiLabel))
      .filter(Boolean);
    if (!primary.length) return fallbackList.slice(0, 3);
    const seen = new Set(primary.map(f => `${f.title}|${f.description}`));
    const out = [...primary];
    for (const f of fallbackList) {
      if (out.length >= 3) break;
      const k = `${f.title}|${f.description}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
    }
    return out.slice(0, 3);
  }

  const opportunities = mergeFactorLists(oppApi, fb.opportunities, 'API');
  const risks = mergeFactorLists(riskApi, fb.risks, 'API');

  return { opportunities, risks };
}

function renderOpportunityRiskFactorsHtml(data) {
  const ORF_EMPTY = '현재 데이터로 식별된 주요 요인이 부족합니다.';
  const { opportunities, risks } = buildOpportunityRiskFactors(data);

  function renderItem(f, kind) {
    const lvlClass = `orf-level-${escapeHtml(f.level || 'medium')}`;
    const iconClass = kind === 'opp' ? 'orf-icon-opp' : 'orf-icon-risk';
    const icon = kind === 'opp' ? '✓' : '⚠';
    const srcLabel = humanizeFactorSource(f.source);
    const srcHtml = srcLabel
      ? `<span class="orf-item-src">근거: ${escapeHtml(srcLabel)}</span>`
      : '';
    return `
      <li class="orf-item ${iconClass} ${lvlClass}">
        <div class="orf-item-head">
          <span class="orf-item-icon" aria-hidden="true">${icon}</span>
          <span class="orf-item-title">${escapeHtml(f.title)}</span>
        </div>
        <p class="orf-item-desc">${escapeHtml(f.description)}</p>
        ${srcHtml}
      </li>`;
  }

  const oppHtml = opportunities.length
    ? `<ul class="orf-list">${opportunities.map(o => renderItem(o, 'opp')).join('')}</ul>`
    : `<p class="orf-empty">${ORF_EMPTY}</p>`;
  const riskHtml = risks.length
    ? `<ul class="orf-list">${risks.map(r => renderItem(r, 'risk')).join('')}</ul>`
    : `<p class="orf-empty">${ORF_EMPTY}</p>`;

  return `
    <div class="opportunity-risk-block">
      <div class="orf-grid">
        <div class="orf-card orf-card-opp">
          <div class="orf-card-head">
            <span class="orf-card-icon orf-card-icon-opp" aria-hidden="true">✓</span>
            <h3 class="orf-card-title">기회 요인 Top 3</h3>
          </div>
          ${oppHtml}
        </div>
        <div class="orf-card orf-card-risk">
          <div class="orf-card-head">
            <span class="orf-card-icon orf-card-icon-risk" aria-hidden="true">⚠</span>
            <h3 class="orf-card-title">주의 요인 Top 3</h3>
          </div>
          ${riskHtml}
        </div>
      </div>
    </div>`;
}

function renderResultSummary(d) {
  const final = d?.scores?.final || {};
  const finance = financeForResultView(d);
  const wrap = document.getElementById('result-summary');
  const decision = buildDecisionSummary(d);

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
    <div class="decision-summary-block">
      <div class="decision-main-card">
        <div class="decision-title">의사결정 요약</div>
        <div class="decision-line decision-conclusion"><strong>종합 결론</strong> ${escapeHtml(decision.conclusion)}</div>
        <div class="decision-line decision-risk"><strong>핵심 리스크</strong> ${escapeHtml(decision.risk)}</div>
        <div class="decision-line decision-action"><strong>우선 실행 과제</strong> ${escapeHtml(decision.action)}</div>
      </div>
      <div class="decision-metric-grid">
        ${decision.metrics.map(m => `
          <div class="decision-metric-card">
            <div class="decision-metric-label">${escapeHtml(m.label)}</div>
            <div class="decision-metric-value">${escapeHtml(m.value)}</div>
            <div class="decision-metric-helper">${escapeHtml(m.helper)}</div>
          </div>
        `).join('')}
      </div>
    </div>

    ${renderOpportunityRiskFactorsHtml(d)}

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

/** 점수 카드·근거 보기용 라벨 (renderScoreGrid 순서와 동일) */
const SCORE_GRID_LABEL_BY_KEY = {
  attraction: '상권 매력도',
  growth: '매출 성장성',
  competition: '경쟁 강도',
  population: '유동인구 적합도',
  ecosystem: '점포 생태계',
  survival: '업종 생존성',
  rent: '임대료 부담',
  debt: '부채 체력',
  shinhan_bank: '금융 점검 필요성',
  shinhan_card: '카드 활용도',
  shinhan_life: '보험 점검 필요성',
  shinhan_growth: '성장지원 가능성',
};

function normalizeReasonBulletArray(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map(x => {
      if (typeof x === 'string') return x.trim();
      if (x != null && typeof x === 'object') {
        if (x.text != null) return String(x.text).trim();
        if (x.line != null) return String(x.line).trim();
      }
      return String(x ?? '').trim();
    })
    .filter(Boolean);
}

function pickScoreReasonFromApi(scoreKey, data) {
  if (!data || typeof data !== 'object') return null;
  const pickFromObject = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const v = obj[scoreKey];
    if (v == null || v === '') return null;
    if (Array.isArray(v)) return normalizeReasonBulletArray(v);
    if (typeof v === 'string') {
      return v.split(/\n+|•|;|·/).map(s => s.trim()).filter(Boolean);
    }
    if (typeof v === 'object') {
      if (Array.isArray(v.bullets)) return normalizeReasonBulletArray(v.bullets);
      if (Array.isArray(v.lines)) return normalizeReasonBulletArray(v.lines);
      if (v.reason != null) return normalizeReasonBulletArray([v.reason]);
      if (v.detail != null) return normalizeReasonBulletArray([v.detail]);
    }
    return null;
  };
  const fromSr = pickFromObject(data.score_reasons);
  if (fromSr && fromSr.length) return fromSr;
  const fromEx = pickFromObject(data.explanations);
  if (fromEx && fromEx.length) return fromEx;
  const fromSd = pickFromObject(data.score_details);
  if (fromSd && fromSd.length) return fromSd;
  return null;
}

/** 양호/보통/열위 등 근거 문구용 구간 (위험형 지표는 점수가 높을수록 불리) */
function scoreSituationBand(scoreKey, scoreValue) {
  const meta = SCORE_TOOLTIP_HELP[scoreKey];
  const neg = meta && meta.dir === 'negative';
  const v = Number(scoreValue);
  if (!Number.isFinite(v)) return 'moderate';
  if (!neg) {
    if (v >= 62) return 'good';
    if (v >= 42) return 'moderate';
    return 'poor';
  }
  if (v >= 58) return 'poor';
  if (v >= 38) return 'moderate';
  return 'good';
}

function buildFallbackScoreReasonBullets(scoreKey, scoreValue, data) {
  const band = scoreSituationBand(scoreKey, scoreValue);
  const finance = typeof financeForResultView === 'function' ? financeForResultView(data || {}) : {};
  const cm = Number(finance.cash_months);
  const monthly = Number(finance.monthly_sales || 0);
  const be = Number(finance.break_even || 0);

  const F = {
    attraction: {
      poor: [
        '상권 내 수요 기반이 제한적일 수 있습니다.',
        '매출 규모 또는 집객 요인이 비교 상권 대비 낮은 편입니다.',
        '유동·상주·직장 인구 반영 결과가 보수적으로 나왔을 수 있습니다.',
      ],
      moderate: [
        '상권 활력은 무난한 구간으로 추정됩니다.',
        '추정매출·유동 등 요약 지표를 함께 참고하는 편이 좋습니다.',
      ],
      good: [
        '유동·추정매출 등 활력 요인이 비교적 유리한 편입니다.',
        '동일 상권 내 다른 업종 대비 후보 업종 적합도를 함께 검토하세요.',
      ],
    },
    growth: {
      poor: [
        '매출 추이 데이터가 부족하거나 변동성이 커 보일 수 있습니다.',
        '최근 분기 대비 하락 기미가 있으면 성장성 판단이 보수적으로 나옵니다.',
      ],
      moderate: [
        '매출 추이는 중간 수준으로 해석됩니다.',
        '추세 전환 여부는 분기 단위로 재점검하는 편이 좋습니다.',
      ],
      good: [
        '최근 매출 흐름이 양호하게 나타납니다.',
        monthly > 0 && be > 0 && monthly >= be
          ? '손익분기점 대비 예상 매출 여력이 있는 편으로 함께 계산되었습니다.'
          : '상권 평균 추세와 비교해 성장 신호가 상대적으로 나타납니다.',
      ],
    },
    competition: {
      poor: [
        '동일 업종 점포 수가 많거나 증가 추세로 관측될 수 있습니다.',
        '반경 내 경쟁점 수가 많을 가능성이 있습니다.',
      ],
      moderate: [
        '경쟁 밀도는 중간 수준으로 추정됩니다.',
        '차별화·입지 요건을 함께 검토하는 편이 좋습니다.',
      ],
      good: [
        '동일 업종 밀도가 상대적으로 완만한 편으로 계산되었을 수 있습니다.',
        '그래도 준공·입점 등으로 향후 변동은 지속 관측이 필요합니다.',
      ],
    },
    population: {
      poor: [
        '유동 규모 또는 증감 추세가 후보 업종에 불리할 수 있습니다.',
        '길단위·상주·직장 인구 합성 결과가 보수적으로 나왔을 수 있습니다.',
      ],
      moderate: [
        '유동인구 적합도는 보통 구간입니다.',
        '시간대별 편차가 크면 입지·캐파 조건을 따로 확인해야 합니다.',
      ],
      good: [
        '선택 업종과 유동인구 패턴이 비교적 잘 맞습니다.',
        '상주·직장·길단위 인구를 함께 반영했습니다.',
      ],
    },
    ecosystem: {
      poor: [
        '개업·폐업 흐름이 안정적이지 않을 수 있습니다.',
        '상권변화지표 또는 폐업 관련 관측값을 추가로 확인해야 합니다.',
      ],
      moderate: [
        '점포 생태계는 중간 수준으로 추정됩니다.',
        '업종별 폐업률·상권 변동 신호를 함께 보는 편이 좋습니다.',
      ],
      good: [
        '폐업률·상권 변동 신호가 비교적 안정적인 편으로 계산되었습니다.',
        '그래도 신규 출점·입점은 지역 이벤트에 따라 달라질 수 있습니다.',
      ],
    },
    survival: {
      poor: [
        '공개 통계 기준 업종 생존 신호가 보수적으로 나왔을 수 있습니다.',
        '브랜드·운영 역량은 별도로 검토해야 합니다.',
      ],
      moderate: [
        '업종 평균 대비 생존 신호는 중간 구간입니다.',
        '지역·규모별 편차가 크므로 참고용으로만 활용하세요.',
      ],
      good: [
        '통계 기준 업종 생존 신호가 비교적 양호한 편입니다.',
        '실제 사업계획·마진 구조와 함께 판단해야 합니다.',
      ],
    },
    rent: {
      poor: [
        '임대료 수준 또는 변동 신호가 부담으로 해석될 수 있습니다.',
        '고정비 구조와 함께 손익 민감도를 점검하는 편이 좋습니다.',
      ],
      moderate: [
        '임대료 부담은 중간 수준으로 추정됩니다.',
        '계약 조건·인상 주기는 현장 확인이 필요합니다.',
      ],
      good: [
        '임대료 부담은 상대적으로 완만한 편으로 계산되었을 수 있습니다.',
        '실제 임차료·관리비는 계약서 기준으로 확인해야 합니다.',
      ],
    },
    debt: {
      poor: [
        '현금보유개월 수가 충분히 길지 않습니다.',
        '매출 감소 시 운영자금 여력이 줄어들 수 있습니다.',
        Number.isFinite(cm) && cm < 6
          ? `추정 현금버퍼는 약 ${cm.toFixed(1)}개월 수준입니다.`
          : '이자·고정비 대비 매출 비중을 함께 확인해야 합니다.',
      ].filter(Boolean),
      moderate: [
        '부채·현금 흐름 체력은 보통 구간으로 추정됩니다.',
        '매출·비용 가정이 바뀌면 민감하게 변할 수 있습니다.',
      ],
      good: [
        '이자부담·현금버퍼 신호가 비교적 양호한 편입니다.',
        '실제 금리·상환 조건은 금융기관 조건과 다를 수 있습니다.',
      ],
    },
    shinhan_bank: {
      poor: [
        '초기 자금 공백 또는 현금흐름 점검이 필요할 수 있습니다.',
        '금리·한도·대출 가능 여부는 실제 상담으로 확인해야 합니다.',
        '본 표시는 특정 상품을 제안하는 것이 아닙니다.',
      ],
      moderate: [
        '금융 구조 점검 필요 신호가 중간 수준입니다.',
        '부채·현금 흐름은 입력값 변화에 민감합니다.',
      ],
      good: [
        '진단 스냅샷상 긴급 상담 필요 신호는 상대적으로 낮은 편입니다.',
        '그래도 예비 자금 계획은 주기적으로 점검하는 편이 좋습니다.',
      ],
    },
    shinhan_card: {
      poor: [
        '매출 변동·경쟁 신호를 바탕으로 결제·매출 관리 점검이 유리할 수 있습니다.',
        '시간대별 매출 편차가 크면 운영 계획을 재확인해야 합니다.',
      ],
      moderate: [
        '카드·결제 관련 점검 필요도는 중간 수준입니다.',
        '업종·포맷에 따라 우선순위가 달라질 수 있습니다.',
      ],
      good: [
        '카드 관련 점검 신호는 상대적으로 낮은 편으로 계산되었습니다.',
        '매출 구조는 분기별로 재확인하는 편이 좋습니다.',
      ],
    },
    shinhan_life: {
      poor: [
        '업종 특성상 화재·배상 등 보장 공백 점검이 필요할 수 있습니다.',
        '실제 가입 여부·약관은 별도 확인이 필요합니다.',
      ],
      moderate: [
        '보장 점검 필요 신호는 중간 수준입니다.',
        '업종 키워드 가중치에 따라 달라질 수 있습니다.',
      ],
      good: [
        '보장 점검 필요 신호는 상대적으로 낮은 편입니다.',
        '그래도 사업장 규모·임직원 여부에 따라 요구가 달라질 수 있습니다.',
      ],
    },
    shinhan_growth: {
      poor: [
        '성장·확장 검토 신호가 보수적으로 나왔을 수 있습니다.',
        '재무·상권 조건이 함께 맞아야 의미가 있습니다.',
      ],
      moderate: [
        '성장지원 검토 여지는 중간 구간으로 추정됩니다.',
        '종합 점수와 재무 스냅샷을 함께 보세요.',
      ],
      good: [
        '매력도·성장·부채 체력 신호를 종합해 검토 여지가 있는 편입니다.',
        '지원 가능 여부는 기관·프로그램별로 다릅니다.',
      ],
    },
  };

  const pack = F[scoreKey];
  if (!pack) return [];
  const bullets = pack[band] || pack.moderate || [];
  return normalizeReasonBulletArray(bullets).slice(0, 4);
}

/**
 * 점수 카드·툴팁 공통: 근거 불릿 2~4개 (텍스트만).
 * API의 score_reasons / explanations / score_details 우선, 없으면 점수 구간·재무 스냅샷 기반 fallback.
 */
function buildScoreReason(scoreKey, scoreLabel, scoreValue, data) {
  const sc = data?.scores?.[scoreKey];
  const v = Number(scoreValue);
  const scoreNum = Number.isFinite(v) ? v : Number(sc?.score ?? NaN);

  const apiLines = pickScoreReasonFromApi(scoreKey, data);
  if (apiLines && apiLines.length) {
    const merged = normalizeReasonBulletArray(apiLines).slice(0, 4);
    if (merged.length >= 2) return merged;
    const fb = buildFallbackScoreReasonBullets(scoreKey, scoreNum, data);
    const fill = [...merged];
    for (const b of fb) {
      if (fill.length >= 4) break;
      if (!fill.includes(b)) fill.push(b);
    }
    return fill.slice(0, 4);
  }

  const fromScoreObj = [];
  if (sc?.reason && String(sc.reason).trim()) {
    fromScoreObj.push(String(sc.reason).replace(/<[^>]+>/g, '').trim());
  }
  if (sc?.message && String(sc.message).trim()) {
    const m = String(sc.message).replace(/<[^>]+>/g, '').trim();
    if (m && m !== fromScoreObj[0]) fromScoreObj.push(m);
  }

  const fb = buildFallbackScoreReasonBullets(scoreKey, scoreNum, data);
  const out = [];
  const seen = new Set();
  for (const line of [...fromScoreObj, ...fb]) {
    const t = String(line).trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 4) break;
  }

  if (out.length >= 2) return out.slice(0, 4);
  if (out.length === 1 && fb.length) {
    const extra = fb.filter(b => b !== out[0]).slice(0, 3);
    return normalizeReasonBulletArray([...out, ...extra]).slice(0, 4);
  }
  return fb.length ? fb.slice(0, 4) : [];
}

function buildScoreTooltipBody(k, sc, data) {
  const base = SCORE_TOOLTIP_HELP[k];
  if (!base) return '';
  const parts = [];
  const label = SCORE_GRID_LABEL_BY_KEY[k] || k;
  const reasons = buildScoreReason(k, label, Number(sc?.score), data || {});
  if (reasons.length) {
    parts.push(
      `<div class="st-block st-reason-block"><div class="st-label">참고 근거 요약</div><ul class="st-reason-ul">${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul><p class="st-reason-note">데이터·룰 기반 참고 설명이며 확정 판단이나 금융상품 제안이 아닙니다.</p></div>`,
    );
  }
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
    const tipBody = buildScoreTooltipBody(k, sc, d);
    const reasons = buildScoreReason(k, name, Number(sc.score), d);
    const reasonUl = reasons.length
      ? `<ul class="score-reason-list">${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
      : `<p class="score-reason-fallback">참고 근거 요약을 불러오지 못했습니다. 상단의 i 버튼으로 산출 요약을 확인해 주세요.</p>`;
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
          <details class="score-reason-details">
            <summary class="score-reason-summary"><span class="score-reason-summary-text">근거 보기</span></summary>
            <div class="score-reason-panel">
              ${reasonUl}
              <p class="score-reason-note">데이터·룰 기반 참고 설명이며 확정 판단이 아닙니다.</p>
            </div>
          </details>
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
  const startupBlock = renderStartupOverviewExtras(d);
  const storeCount = Number(ss.store_count || 0);
  const openCount = Number(ss.open_count || 0);
  const closeCount = Number(ss.close_count || 0);
  const franchiseCount = Number(ss.franchise_count || 0);
  const closureRateNum = parseFloat(String(ss.closure_rate || '').replace('%', ''));
  const franchiseRatio = storeCount > 0 ? ((franchiseCount / storeCount) * 100).toFixed(1) : null;
  const openCloseGap = openCount - closeCount;
  wrap.innerHTML = `
    <h3 class="tab-title">상권 종합 진단</h3>
    <p class="tab-desc">선택 상권의 점포·인구·운영 지표 요약입니다.</p>
    ${startupBlock}
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
      <div class="info-title">상권 요약</div>
      <div class="info-body">
        <ul class="insight-list">
          <li><strong>점포 밀도:</strong> ${storeCount > 0 ? `상권 기준 점포 <b>${fmtInt(storeCount)}개</b>가 관측됩니다.` : '현재 상권 기준 점포 데이터가 매우 적거나 0으로 관측됩니다.'}</li>
          <li><strong>개·폐업 흐름:</strong> ${Number.isFinite(openCloseGap) ? `개업 ${fmtInt(openCount)}개 / 폐업 ${fmtInt(closeCount)}개로 ${openCloseGap >= 0 ? '순증' : '순감'} <b>${fmtInt(Math.abs(openCloseGap))}개</b>입니다.` : '개·폐업 추세 데이터가 제한적입니다.'}</li>
          <li><strong>브랜드 집중도:</strong> ${franchiseRatio != null ? `프랜차이즈 비중은 약 <b>${franchiseRatio}%</b> 수준입니다.` : '프랜차이즈 비중 데이터가 충분하지 않습니다.'}</li>
          <li><strong>폐업 리스크:</strong> ${Number.isFinite(closureRateNum) ? `최근 폐업률은 <b>${ss.closure_rate}</b>로, ${closureRateNum >= 10 ? '운영 안정성 점검이 필요한 구간입니다.' : '상대적으로 관리 가능한 구간으로 보입니다.'}` : '폐업률 데이터가 제한적입니다.'}</li>
        </ul>
      </div>
    </div>

    <div id="overview-radius-note"></div>

    <div class="info-box">
      <div class="info-title">데이터 기반 해석</div>
      <div class="info-body">${overviewNarrative(d)}${isPreStartupUser(d) ? '<br><br>' + overviewStartupExtraLine(d) : ''}</div>
    </div>
  `;

  // 점포 수가 매우 적은 경우 반경 확장 안내를 상권요약 탭에서도 즉시 노출
  if (storeCount <= 0) {
    ensureRadiusExpansionForTrend().then(() => {
      const note = document.getElementById('overview-radius-note');
      if (!note) return;
      const rx = State.radiusExpansion;
      if (rx && rx.message) {
        note.innerHTML = `<div class="info-box trend-radius-notice"><div class="info-title">점포 데이터 확장 안내</div><div class="info-body">${escapeHtml(
          rx.message,
        )}</div></div>`;
      } else {
        note.innerHTML = `<div class="info-box trend-radius-notice"><div class="info-title">점포 데이터 확장 안내</div><div class="info-body">선택 상권에서 점포 수가 0으로 관측되어, 주변 반경(최대 2km) 참고 데이터까지 함께 확인하는 것을 권장합니다.</div></div>`;
      }
    });
  }
}

function overviewStartupExtraLine(d) {
  const f = financeForResultView(d);
  const gap = Number(f.funding_gap_estimate || 0);
  if (gap <= 0) {
    return '<b>예비창업 관점:</b> 초기 소요 대비 자기자본이 비교적 맞춰진 편으로 계산되었습니다. 다만 권장 운영자금(약 3개월 고정비)은 별도 확보를 검토하세요.';
  }
  return `<b>예비창업 관점:</b> 초기 소요 대비 약 <b>${fmtMoney(gap)}</b> 규모의 조달이 필요할 수 있다는 참고치입니다. 「자금·손익분기점」 탭에서 창업비·자기자본을 바꿔 시뮬레이션할 수 있습니다.`;
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
    if (State.mapEngine === 'kakao' && State.map && window.kakao && window.kakao.maps) {
      (State.mapMarkers || []).forEach((m) => {
        try {
          if (m.marker && typeof m.marker.setMap === 'function') m.marker.setMap(null);
          if (m.infoWindow && typeof m.infoWindow.close === 'function') m.infoWindow.close();
        } catch (_) {}
      });
      Object.values(State.circles || {}).forEach((c) => {
        try {
          if (c && typeof c.setMap === 'function') c.setMap(null);
        } catch (_) {}
      });
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
let _kakaoLoadPromise = null;
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

async function fetchMapConfig() {
  try {
    return await fetchJson('/api/map-config');
  } catch (_) {
    return { provider: 'leaflet', configured: false, kakao_js_app_key: '' };
  }
}

function ensureKakaoMaps(jsKey) {
  if (!jsKey) return Promise.reject(new Error('카카오 JavaScript 키가 없습니다.'));
  if (window.kakao && window.kakao.maps) {
    return new Promise((resolve) => {
      window.kakao.maps.load(() => resolve());
    });
  }
  if (!_kakaoLoadPromise) {
    _kakaoLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(jsKey)}&autoload=false`;
      s.onload = () => {
        try {
          window.kakao.maps.load(() => resolve());
        } catch (e) {
          reject(e);
        }
      };
      s.onerror = () => reject(new Error('kakao sdk'));
      document.head.appendChild(s);
    });
  }
  return _kakaoLoadPromise;
}

/** 결과 데이터 기준 입지·경쟁 요약 카드 (GIS 탭 우측 상단) */
function buildMapInsightCardHtml(d) {
  const data = d || State.result;
  if (!data) return '';
  const area = escapeHtml(data.area_name || State.area_name || '-');
  const svc = escapeHtml(data.service_name || State.service_name || '-');
  const att = data.scores?.attraction;
  const comp = data.scores?.competition;
  const pop = data.scores?.population;
  const warns = Array.isArray(data.warnings) ? data.warnings.length : 0;
  const lines = [];
  if (att && Number.isFinite(att.score)) {
    lines.push(`상권 매력도 <strong>${escapeHtml(String(att.score))}점</strong> (${escapeHtml(att.label || '-')})`);
  }
  if (comp && Number.isFinite(comp.score)) {
    lines.push(`경쟁 강도 <strong>${escapeHtml(String(comp.score))}점</strong> (${escapeHtml(comp.label || '-')}) · 높을수록 경쟁 치열`);
  }
  if (pop && Number.isFinite(pop.score)) {
    lines.push(`유동인구 적합도 <strong>${escapeHtml(String(pop.score))}점</strong>`);
  }
  if (warns > 0) {
    lines.push(`조기경보 <strong>${warns}</strong>건 · 추세·경쟁 신호를 함께 보세요.`);
  }
  if (!lines.length) {
    lines.push('점수 요약을 불러오지 못했습니다. 상단 종합 점수 카드를 참고하세요.');
  }
  return `
    <div class="map-insight-card">
      <div class="map-insight-kicker">입지 스냅샷</div>
      <div class="map-insight-area">${area} · ${svc}</div>
      <ul class="map-insight-list">${lines.map((li) => `<li>${li}</li>`).join('')}</ul>
      <p class="map-insight-note">본 탭은 반경 내 점포 밀도와 검색 위치를 시각화합니다. 행정 경계·축 미세 분석은 외부 GIS와 결합할 수 있습니다.</p>
    </div>`;
}

function mapPublicDataMoreHtml() {
  return `
    <details class="map-data-more">
      <summary class="map-data-more-sum">추가로 연계하면 좋은 공공·참고 데이터</summary>
      <div class="map-data-more-body">
        <p class="map-data-more-lead">현재 PoC는 서울시 상권·점포·추정매출 등 핵심 공공데이터에 집중합니다. 입지 분석을 더 풍부하게 만들려면 아래를 검토할 수 있습니다.</p>
        <ul class="map-data-more-ul">
          <li><strong>SGIS·행정경계·격자</strong> — 통계청·행안부 기준 격자 단위 인구·가구 (KOSIS·SGIS API)</li>
          <li><strong>V-World·건축물대장</strong> — 건물 용도·연면적·층수로 임대 적합도 보조 판단</li>
          <li><strong>대중교통·접근성</strong> — 지하철 승하차·버스 정류장 거리 (공공데이터포털·TAGO 등)</li>
          <li><strong>실측 유동인구·통행량</strong> — 일부는 유료·제한 API (통신·카드사 OD 등) — 라이선스·개인정보 이슈 검토 필요</li>
          <li><strong>상가 임대 호가·상가 정보</strong> — 소상공인365·민간 매물과 병합 시 입지 비교에 유리</li>
        </ul>
        <p class="map-data-more-ref">
          참고: <a href="https://bigdata.sbiz.or.kr/#/gis/locAnls" target="_blank" rel="noopener noreferrer">소상공인365 입지·GIS 분석</a>과 유사한 관점으로 확장할 수 있습니다. (외부 서비스이며 본 PoC와 무관합니다.)
        </p>
      </div>
    </details>`;
}

// ── Tab: 경쟁점 지도 (카카오맵 우선, 실패 시 Leaflet fallback) ─
async function renderMapTab() {
  destroyMapView();
  const wrap = document.getElementById('tab-map');
  const insight = buildMapInsightCardHtml(State.result);
  const dataMore = mapPublicDataMoreHtml();
  wrap.innerHTML = `
    <div class="map-gis-head">
      <div class="map-gis-head-text">
        <div class="map-gis-eyebrow">GIS · 입지·경쟁 분석</div>
        <h3 class="tab-title map-gis-title">경쟁점 지도</h3>
        <p class="tab-desc map-gis-desc">
          <strong>선택한 상권·업종 기준</strong>으로 경쟁 환경을 해석합니다. 장소 검색으로 분석 중심을 옮기면 그 좌표 기준으로 경쟁점이 다시 계산됩니다.
        </p>
        <p class="tab-note map-gis-note muted">홈의 「지도 기반 상권 탐색」은 관심 위치를 먼저 둘러본 뒤 진단을 시작하는 화면입니다. 이 탭은 분석 결과 설명용입니다.</p>
      </div>
    </div>

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
        <button class="map-style-btn" data-style="SKYVIEW" data-leaflet-style="light">위성</button>
        <button class="map-style-btn" data-style="HYBRID" data-leaflet-style="dark">하이브리드</button>
      </div>
    </div>

    <div class="map-grid map-gis-grid">
      <div class="map-stage">
        <div class="map-container map-container-elevated">
          <div id="competitor-map" style="height:560px"></div>
          <div class="map-search">
            <input type="text" id="map-place-q" placeholder="장소 검색 (예: 강남역 스타벅스) · 서버 키 설정 시 카카오 로컬 검색">
            <button class="btn btn-primary btn-sm" id="map-place-go">검색</button>
            <button class="btn btn-ghost btn-xs" id="map-place-reset" title="원래 상권 중심으로 돌아가기">초기화</button>
            <div class="map-search-results" id="map-place-results"></div>
          </div>
        </div>
      </div>

      <div class="map-sidebar-col">
        ${insight}
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
        ${dataMore}
      </div>
    </div>
    <div class="competitor-summary" id="competitor-summary">로딩 중…</div>
  `;

  const cfg = await fetchMapConfig();
  const prov = String(cfg.provider || 'auto').toLowerCase();
  let mapBoot = null;
  let usingKakao = false;
  if ((prov === 'kakao' || prov === 'auto') && cfg.configured && cfg.kakao_js_app_key) {
    mapBoot = await Promise.allSettled([ensureKakaoMaps(cfg.kakao_js_app_key), fetchCompetitorsPayload()]);
    if (mapBoot[0].status !== 'fulfilled') {
      console.warn('[result-map] Kakao fallback to Leaflet:', mapBoot[0].reason);
      mapBoot = await Promise.allSettled([ensureLeaflet(), Promise.resolve(mapBoot[1].status === 'fulfilled' ? mapBoot[1].value : null)]);
      usingKakao = false;
    } else {
      usingKakao = true;
    }
  } else {
    mapBoot = await Promise.allSettled([ensureLeaflet(), fetchCompetitorsPayload()]);
    usingKakao = false;
  }

  const mapRes = mapBoot[0];
  const dataRes = mapBoot[1];
  if (mapRes.status === 'rejected') {
    const err = mapRes.reason;
    showMapDisabled(err && err.message ? err.message : String(err));
    return;
  }

  if (dataRes.status === 'rejected') {
    document.getElementById('competitor-summary').innerHTML =
      '<div class="info-box"><div class="info-body">경쟁점 데이터를 불러오지 못했습니다.</div></div>';
    document.getElementById('competitor-list').innerHTML =
      '<div class="muted">데이터를 불러오지 못했습니다.</div>';
    return;
  }

  let payload = dataRes.value;
  if (!payload) {
    try {
      payload = await fetchCompetitorsPayload();
    } catch (_) {}
  }
  if (!payload) {
    document.getElementById('competitor-summary').innerHTML =
      '<div class="info-box"><div class="info-body">경쟁점 데이터를 불러오지 못했습니다.</div></div>';
    document.getElementById('competitor-list').innerHTML =
      '<div class="muted">데이터를 불러오지 못했습니다.</div>';
    return;
  }

  State.mapEngine = usingKakao ? 'kakao' : 'leaflet';
  applyCompetitorDraw(payload, { initial: true });

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
      if (State.mapEngine === 'kakao') {
        switchKakaoMapType(btn.dataset.style || 'ROADMAP', btn);
      } else {
        switchLeafletTiles(btn.dataset.leafletStyle || 'voyager', btn);
      }
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
  if (State.mapEngine === 'kakao') drawKakaoMap(data, { initial });
  else drawLeafletMap(data, { initial });
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

function switchKakaoMapType(style, btn) {
  if (!State.map || State.mapEngine !== 'kakao' || !(window.kakao && window.kakao.maps)) return;
  const k = window.kakao.maps;
  const typeId = style === 'HYBRID' ? k.MapTypeId.HYBRID : style === 'SKYVIEW' ? k.MapTypeId.SKYVIEW : k.MapTypeId.ROADMAP;
  State.map.setMapTypeId(typeId);
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
  const drawTargets = (State.competitors || []).slice(0, MAP_MARKER_LIMIT_LEAFLET);
  drawTargets.forEach((s, i) => {
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

function drawKakaoMap(data, { initial }) {
  if (!(window.kakao && window.kakao.maps)) return;
  const k = window.kakao.maps;
  const [lat, lon] = data.center || [37.5665, 126.9780];
  const center = new k.LatLng(lat, lon);
  const el = document.getElementById('competitor-map');
  if (!el) return;

  if (State.map && State.mapEngine === 'kakao') {
    try {
      (State.mapMarkers || []).forEach((m) => {
        if (m.marker && typeof m.marker.setMap === 'function') m.marker.setMap(null);
      });
      Object.values(State.circles || {}).forEach((c) => c && c.setMap && c.setMap(null));
    } catch (_) {}
  }

  State.map = new k.Map(el, { center, level: 4 });
  State.mapEngine = 'kakao';
  State.circles = {};
  State.circles[1000] = new k.Circle({
    center, radius: 1000, strokeWeight: 1.2, strokeColor: '#ef4444', strokeOpacity: 0.7, fillColor: '#ef4444', fillOpacity: 0.04,
  });
  State.circles[500] = new k.Circle({
    center, radius: 500, strokeWeight: 1.2, strokeColor: '#16a34a', strokeOpacity: 0.7, fillColor: '#16a34a', fillOpacity: 0.06,
  });
  State.circles[300] = new k.Circle({
    center, radius: 300, strokeWeight: 1.5, strokeColor: '#3b82f6', strokeOpacity: 0.8, fillColor: '#3b82f6', fillOpacity: 0.10,
  });
  Object.values(State.circles).forEach((c) => c.setMap(State.map));

  State.mapMarkers = [];
  const drawTargets = (State.competitors || []).slice(0, MAP_MARKER_LIMIT_KAKAO);
  drawTargets.forEach((s) => {
    if (s['위도'] == null || s['경도'] == null) return;
    const same = !!s.is_same;
    const dot = document.createElement('div');
    dot.className = 'me-kakao-dot' + (same ? ' me-kakao-dot--on' : '');
    dot.style.background = same ? '#1a56db' : '#94a3b8';
    const marker = new k.CustomOverlay({
      position: new k.LatLng(s['위도'], s['경도']),
      content: dot,
      yAnchor: 0.5,
      zIndex: same ? 5 : 3,
    });
    marker.setMap(State.map);
    State.mapMarkers.push({ marker, store: s, position: marker.getPosition() });
  });

  if (initial) State.map.setCenter(center);
  focusRadius(State.activeRadius || 300);
}

function openStoreInfo(idx) {
  const m = State.mapMarkers[idx];
  if (!m || !State.map) return;
  if (State.mapEngine === 'leaflet' && m.marker) {
    m.marker.openPopup();
    State.map.flyTo(m.marker.getLatLng(), 17, { animate: true, duration: 0.45 });
    return;
  }
  if (State.mapEngine === 'kakao' && window.kakao && window.kakao.maps && m.position) {
    const k = window.kakao.maps;
    const info = new k.InfoWindow({
      content: `<div class="map-popup">${buildStorePopupHTML(m.store || {})}</div>`,
      removable: true,
    });
    info.open(State.map, m.marker);
    State.map.setCenter(m.position);
    State.map.setLevel(3);
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
  if (State.mapEngine === 'leaflet') {
    State.map.setView([la, lo], 17, { animate: true });
  } else if (State.mapEngine === 'kakao' && window.kakao && window.kakao.maps) {
    State.map.setCenter(new window.kakao.maps.LatLng(la, lo));
    State.map.setLevel(3);
  }
}

function focusRadius(r) {
  if (!State.map || !State.circles) return;
  if (State.mapEngine === 'leaflet') {
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
  } else if (State.mapEngine === 'kakao') {
    Object.entries(State.circles).forEach(([k, c]) => {
      const active = Number(k) === r;
      if (!c || !c.setOptions) return;
      c.setOptions({
        strokeWeight: active ? 3 : 1.2,
        fillOpacity: active ? 0.18 : 0.05,
      });
    });
    const level = r <= 300 ? 3 : r <= 500 ? 4 : 5;
    State.map.setLevel(level);
  }
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
          선택한 업종과 일치하는 점포가 없어 목록을 비워 두었습니다.
          <br>필요하면 <b>동일업종만</b> 체크를 해제해 주변 업종 분포를 참고하세요.
        </div>
      </div>`;
    html += '';
  } else if (!sameOnly && arr.length === 0 && (State.competitors || []).length === 0 && refOther.length > 0) {
    html = `
      <div class="info-box comp-expand-intro"><div class="info-body">이 위치 근처 상가 데이터가 적습니다. 아래는 참고용 인근 점포입니다.</div></div>`;
    html += refOther.map(s => rowHtml(s, { flyOnly: true, extraClass: 'comp-row-ref', badge: '참고' })).join('');
  } else {
    html = `<div class="muted">반경 ${r}m 이내 ${sameOnly ? '동일 업종 ' : ''}경쟁점이 없습니다.</div>`;
    if (sameOnly && extSame.length === 0 && refOther.length > 0) {
      html += `<div class="muted comp-fallback-note" style="margin-top:10px">동일 업종만 보기 해제 시 주변 업종 분포를 참고할 수 있습니다.</div>`;
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
    if (State.mapEngine === 'leaflet') {
      State.map.setView([lat, lon], State.map.getZoom(), { animate: true });
    } else if (State.mapEngine === 'kakao' && window.kakao && window.kakao.maps) {
      State.map.setCenter(new window.kakao.maps.LatLng(lat, lon));
    }
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

    ${buildStartupSimulatorSection(d, f)}

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
  requestAnimationFrame(() => {
    drawFinanceCharts(d);
    bindStartupSimulatorPanel(d);
  });
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

/** 신한라이프: 추천 보장 점검(상담 후보) 블록 */
function renderShinhanRecommendedInsurance(rec) {
  if (!rec || !Array.isArray(rec.items) || rec.items.length === 0) return '';
  const title = escapeHtml(rec.section_title || '');
  const lead = rec.lead ? `<p class="sp-rec-lead">${escapeHtml(rec.lead)}</p>` : '';
  const cards = rec.items.map((it) => `
    <div class="sp-rec-card">
      <div class="sp-rec-name">${escapeHtml(it.name || '')}</div>
      ${it.summary ? `<div class="sp-rec-sum">${escapeHtml(it.summary)}</div>` : ''}
      <ul class="sp-rec-ben">${(it.benefits || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      ${it.consult_focus ? `<div class="sp-rec-focus"><span class="sp-rec-focus-k">상담 시 확인</span> ${escapeHtml(it.consult_focus)}</div>` : ''}
    </div>`).join('');
  const link = rec.official_url
    ? `<div class="sp-rec-link"><a href="${escapeHtml(rec.official_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm">${escapeHtml(rec.official_label || '공식 사이트')}</a></div>`
    : '';
  return `<div class="sp-rec-wrap sp-rec-life"><div class="sp-rec-head">${title}</div>${lead}<div class="sp-rec-grid">${cards}</div>${link}</div>`;
}

/** 신한카드: 혜택 비교·우대 카드(상담 후보) 블록 */
function renderShinhanRecommendedCards(rec) {
  if (!rec || !Array.isArray(rec.items) || rec.items.length === 0) return '';
  const title = escapeHtml(rec.section_title || '');
  const lead = rec.lead ? `<p class="sp-rec-lead">${escapeHtml(rec.lead)}</p>` : '';
  const tip = rec.extra_tip ? `<p class="sp-rec-tip">${escapeHtml(rec.extra_tip)}</p>` : '';
  const cards = rec.items.map((it) => `
    <div class="sp-rec-card">
      <div class="sp-rec-name">${escapeHtml(it.name || '')}</div>
      ${it.tier_note ? `<div class="sp-rec-tier">${escapeHtml(it.tier_note)}</div>` : ''}
      <ul class="sp-rec-ben">${(it.benefits || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      ${it.vs_general_note ? `<div class="sp-rec-vs">${escapeHtml(it.vs_general_note)}</div>` : ''}
    </div>`).join('');
  const link = rec.official_url
    ? `<div class="sp-rec-link"><a href="${escapeHtml(rec.official_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm">${escapeHtml(rec.official_label || '공식 사이트')}</a></div>`
    : '';
  return `<div class="sp-rec-wrap sp-rec-cardsec"><div class="sp-rec-head">${title}</div>${lead}${tip}<div class="sp-rec-grid">${cards}</div>${link}</div>`;
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

  const recBlock = key === 'life' && panel.recommended_insurance
    ? renderShinhanRecommendedInsurance(panel.recommended_insurance)
    : key === 'card' && panel.recommended_cards
      ? renderShinhanRecommendedCards(panel.recommended_cards)
      : '';

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
      ${recBlock}
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

  const preStartupBanner = isPreStartupUser(d)
    ? `<div class="prestartup-services-banner">
        <div class="prestartup-services-title">예비창업자 · 자금·대출 안내</div>
        <p>
          아래 <strong>신한은행</strong> 패널에는 <b>초기 소요(추정)</b>, <b>보유 현금 대비 자금 공백(추정)</b>, <b>창업자금·운영자금 상담 후보 금액(목업)</b>이 표시됩니다.
          부족분은 전부 대출로 메웠다고 가정한 것이 아니라, <b>상담 시 참고할 규모</b>입니다. 실제 한도·금리·보증은 심사 후 확정됩니다.
        </p>
        <ul class="prestartup-services-list">
          <li><strong>얼마나 필요한가:</strong> 진단 스냅샷의 초기 소요·자금 공백, 상품별 「추정 필요·참고 금액」 확인</li>
          <li><strong>대출로 어느 정도까지:</strong> 목업 상품은 참고 범위(예: 창업자금 상담 후보 금액)로 표시되며, 「자금·손익분기점」 탭 시뮬레이터에서 조달액·월 이자를 가정해 볼 수 있습니다.</li>
          <li><strong>버티는 기간:</strong> 현금 보유개월·운영자금 상품 후보는 분석 결과와 연동된 참고치입니다.</li>
        </ul>
      </div>`
    : '';

  wrap.innerHTML = `
    <h3 class="tab-title">신한 서비스 연결</h3>
    <p class="tab-desc">
      진단 결과에 따라 우선 검토할 신한금융그룹 상담 후보입니다.
      <b>확정 추천이 아닌</b> 상담·점검 단계이며, 실제 상품 조건은 각 사 상담 및 심사 결과에 따릅니다.
    </p>
    ${preStartupBanner}
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

// ── 지도 탐색 → 진단 연결 ───────────────────────────────────────────────────
const MAP_EXPLORER_SERVICE_NAME = {
  all: '커피-음료',
  food: '한식음식점',
  cafe: '커피-음료',
  beauty: '미용실',
  academy: '외국어학원',
  sports: '스포츠클럽',
  retail: '편의점',
  other: '일반의류',
};

async function goDiagnosisFromMapExplorer(kind, ctx) {
  const rawLat = ctx && ctx.lat;
  const rawLon = ctx && ctx.lon;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  const radius = Number(ctx.radius_m ?? ctx.radius ?? 500);
  const industryKey = ctx.industry_key || 'all';
  const validLatLon =
    rawLat !== null &&
    rawLat !== undefined &&
    rawLon !== null &&
    rawLon !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat > 33 &&
    lat < 39 &&
    lon > 124 &&
    lon < 132;
  if (!validLatLon) {
    alert('먼저 지도에서 위치를 선택하거나 검색으로 중심을 지정해 주세요.');
    return;
  }
  State.customCenter = [lat, lon];
  State.mapExplorerContext = {
    lat,
    lon,
    radius_m: radius,
    industryKey,
    area_code: ctx.area_code || '',
    area_name: ctx.area_name || '',
  };
  State.activeRadius = radius <= 300 ? 300 : radius <= 500 ? 500 : 1000;

  let cand = null;
  try {
    const na = await fetchJson(
      `/api/map-explorer/nearest-area?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
    );
    cand = na.candidates && na.candidates[0];
  } catch (e) {
    console.warn(e);
  }

  State.service_name = MAP_EXPLORER_SERVICE_NAME[industryKey] || MAP_EXPLORER_SERVICE_NAME.all;
  const inferredSvc = inferServiceFromMapExplorerContext(ctx);
  const resolvedService = inferredSvc || State.service_name;
  const chosenArea =
    ctx.area_code
      ? {
          area_code: ctx.area_code,
          area_name: ctx.area_name || '',
          district: ctx.district || '',
          dong: ctx.dong || '',
        }
      : (cand && cand.area_code ? cand : null);

  applyMapExplorerDefaultsToState(chosenArea, resolvedService);

  State.mapExplorerSummary = {
    lat,
    lon,
    radius_m: radius,
    industryKey,
    area_code: chosenArea?.area_code || '',
    area_name: chosenArea?.area_name || '',
    service_name: resolvedService,
    density_level: ctx.density_level || '',
    same_or_similar_stores:
      ctx.same_or_similar_stores === undefined || ctx.same_or_similar_stores === ''
        ? null
        : ctx.same_or_similar_stores,
  };
  State.mapExplorerContext = {
    ...State.mapExplorerContext,
    area_code: chosenArea?.area_code || '',
    area_name: chosenArea?.area_name || '',
    district: chosenArea?.district || '',
    dong: chosenArea?.dong || '',
    service_name: resolvedService,
    place_category: ctx.place_category || '',
    place_title: ctx.place_title || '',
  };
  State.mapExplorerAreaPrefillPending = true;

  if (kind === 'wizard') {
    State.user_type = '';
    selectUserTypeCard(null);
    goStep('user-type');
    return;
  }

  if (kind === 'operate') {
    window.__MAP_EXPLORER_LAST_CONTEXT__ = {
      lat,
      lon,
      radius_m: radius,
      industryKey,
      area_code: chosenArea?.area_code || '',
      area_name: chosenArea?.area_name || '',
      district: chosenArea?.district || '',
      dong: chosenArea?.dong || '',
      service_name: resolvedService || '',
    };
    if (typeof window.openOperatingStoreSelector === 'function') {
      window.openOperatingStoreSelector();
    } else {
      goStep('operating-connect');
    }
    return;
  }

  if (kind === 'startup') {
    State.user_type = '창업 예정자';
    selectUserTypeCard('창업 예정자');
    if (!chosenArea || !chosenArea.area_code) {
      State.district = '';
      State.dong = '';
      State.area_code = '';
      State.area_name = '';
      alert('가까운 상권을 자동으로 찾지 못했습니다. 다음 화면에서 상권을 직접 선택해 주세요.');
    }
    goStep('area');
    return;
  }
}

window.goDiagnosisFromMapExplorer = goDiagnosisFromMapExplorer;

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
