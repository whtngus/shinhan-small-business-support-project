/**
 * 지도 기반 상권 탐색 — 탐색 전용. 지도 클릭으로 진단/결과 화면 자동 이동하지 않음.
 */
'use strict';

(function () {
  const ME = {
    mapKind: null,
    leafletMap: null,
    kakaoMap: null,
    circles: {},
    kakaoCircles: [],
    centerMarkerLeaflet: null,
    centerOverlayKakao: null,
    storeLayer: null,
    kakaoStoreOverlays: [],
    keywordLayer: null,
    kakaoKeywordOverlays: [],
    tileLayer: null,
    centerLat: null,
    centerLon: null,
    pinLat: null,
    pinLon: null,
    radius: 500,
    industry: 'all',
    lastPayload: null,
    selectedAreaIdx: null,
    mapConfig: null,
    providerResolved: null,
    kakaoLoadError: '',
    requestSeq: 0,
    moveTimer: null,
    isProgrammaticMove: false,
  };

  const DEFAULT_CENTER = [37.5665, 126.978];
  const MAX_MARKERS = 80;

  let leafletPromise = null;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  async function fetchCfg() {
    try {
      return await window.fetchJson('/api/map-config');
    } catch (_) {
      return { provider: 'leaflet', configured: false, kakao_js_app_key: '' };
    }
  }

  function ensureLeaflet() {
    if (window.L) return Promise.resolve();
    if (!leafletPromise) {
      leafletPromise = (async () => {
        if (!document.querySelector('link[data-leaflet-css-map-exp="1"]')) {
          await new Promise((resolve, reject) => {
            const l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            l.setAttribute('data-leaflet-css-map-exp', '1');
            l.onload = () => resolve();
            l.onerror = () => reject(new Error('Leaflet CSS'));
            document.head.appendChild(l);
          });
        }
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('Leaflet JS'));
          document.head.appendChild(s);
        });
      })();
    }
    return leafletPromise;
  }

  function loadKakaoSdk(key) {
    return new Promise((resolve, reject) => {
      if (window.kakao && window.kakao.maps) {
        window.kakao.maps.load(() => resolve());
        return;
      }
      const script = document.createElement('script');
      script.src =
        'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' +
        encodeURIComponent(key) +
        '&autoload=false&libraries=services';
      script.onload = () => {
        try {
          window.kakao.maps.load(() => resolve());
        } catch (e) {
          reject(e);
        }
      };
      script.onerror = () => reject(new Error('kakao sdk'));
      document.head.appendChild(script);
    });
  }

  function invalidateSize() {
    try {
      if (ME.mapKind === 'leaflet' && ME.leafletMap && typeof ME.leafletMap.invalidateSize === 'function') {
        ME.leafletMap.invalidateSize({ animate: false });
      } else if (ME.mapKind === 'kakao' && ME.kakaoMap && ME.kakaoMap.relayout) {
        ME.kakaoMap.relayout();
      }
    } catch (_) {}
  }

  function densityColors(level) {
    if (level === '높음') return { ring: '#dc2626', fill: '#fecaca' };
    if (level === '보통') return { ring: '#ea580c', fill: '#fed7aa' };
    return { ring: '#16a34a', fill: '#bbf7d0' };
  }

  function clearCirclesAll() {
    const L = window.L;
    if (ME.mapKind === 'leaflet' && ME.leafletMap && L) {
      Object.values(ME.circles || {}).forEach((c) => {
        try {
          ME.leafletMap.removeLayer(c);
        } catch (_) {}
      });
      ME.circles = {};
      return;
    }
    if (ME.mapKind === 'kakao' && ME.kakaoMap) {
      ME.kakaoCircles.forEach((c) => {
        try {
          c.setMap(null);
        } catch (_) {}
      });
      ME.kakaoCircles = [];
    }
  }

  function drawCirclesUnified(lat, lon, activeR) {
    const dc = ME.lastPayload && ME.lastPayload.summary ? ME.lastPayload.summary.density_level : '';
    const pal = densityColors(dc);

    if (ME.mapKind === 'leaflet' && ME.leafletMap && window.L) {
      const L = window.L;
      const map = ME.leafletMap;
      clearCirclesAll();
      const center = [lat, lon];
      ME.circles[1000] = L.circle(center, {
        radius: 1000,
        color: '#94a3b8',
        weight: 1,
        fillColor: '#94a3b8',
        fillOpacity: 0.03,
        dashArray: '6 6',
      }).addTo(map);
      ME.circles[500] = L.circle(center, {
        radius: 500,
        color: '#64748b',
        weight: 1,
        fillColor: '#64748b',
        fillOpacity: 0.05,
        dashArray: '6 6',
      }).addTo(map);
      ME.circles[300] = L.circle(center, {
        radius: 300,
        color: pal.ring,
        weight: activeR === 300 ? 2.4 : 1.2,
        fillColor: pal.ring,
        fillOpacity: activeR === 300 ? 0.14 : 0.06,
        dashArray: activeR === 300 ? null : '6 6',
      }).addTo(map);
      ME.isProgrammaticMove = true;
      map.panTo(center, { animate: false });
      setTimeout(() => {
        ME.isProgrammaticMove = false;
      }, 120);
      return;
    }

    if (ME.mapKind === 'kakao' && ME.kakaoMap && window.kakao && window.kakao.maps) {
      const k = window.kakao.maps;
      clearCirclesAll();
      const cLatLng = new k.LatLng(lat, lon);
      const configs = [
        { r: 1000, color: '#94a3b8', w: 1, fo: 0.06 },
        { r: 500, color: '#64748b', w: activeR === 500 ? 3 : 1, fo: 0.08 },
        { r: 300, color: pal.ring, w: activeR === 300 ? 3 : 1, fo: activeR === 300 ? 0.18 : 0.09 },
      ];
      configs.forEach((cfg) => {
        const circle = new k.Circle({
          center: cLatLng,
          radius: cfg.r,
          strokeWeight: cfg.w,
          strokeColor: cfg.color,
          strokeOpacity: 0.82,
          fillColor: cfg.color,
          fillOpacity: cfg.fo,
        });
        circle.setMap(ME.kakaoMap);
        ME.kakaoCircles.push(circle);
      });
      ME.isProgrammaticMove = true;
      ME.kakaoMap.setCenter(cLatLng);
      setTimeout(() => {
        ME.isProgrammaticMove = false;
      }, 120);
    }
  }

  function setCenterMarker(lat, lon, label) {
    const txt = esc(label || '관심 위치');

    if (ME.mapKind === 'leaflet' && ME.leafletMap && window.L) {
      const L = window.L;
      if (ME.centerMarkerLeaflet) {
        try {
          ME.leafletMap.removeLayer(ME.centerMarkerLeaflet);
        } catch (_) {}
      }
      const html =
        '<div class="me-pin-wrap"><div class="me-pin-dot"></div><div class="me-pin-label">' +
        txt +
        '</div></div>';
      const icon = L.divIcon({
        className: 'me-center-pin',
        html,
        iconSize: [140, 48],
        iconAnchor: [70, 24],
      });
      ME.centerMarkerLeaflet = L.marker([lat, lon], { icon, zIndexOffset: 900 }).addTo(ME.leafletMap);
      return;
    }

    if (ME.mapKind === 'kakao' && ME.kakaoMap && window.kakao && window.kakao.maps) {
      const k = window.kakao.maps;
      const el = document.createElement('div');
      el.className = 'me-pin-wrap';
      el.innerHTML =
        '<div class="me-pin-dot"></div><div class="me-pin-label">' + txt + '</div>';
      if (ME.centerOverlayKakao) ME.centerOverlayKakao.setMap(null);
      ME.centerOverlayKakao = new k.CustomOverlay({
        position: new k.LatLng(lat, lon),
        content: el,
        yAnchor: 0.55,
      });
      ME.centerOverlayKakao.setMap(ME.kakaoMap);
    }
  }

  function clearStoreMarkersUnified() {
    const L = window.L;
    if (ME.mapKind === 'leaflet' && ME.storeLayer && ME.leafletMap && L) {
      try {
        ME.storeLayer.clearLayers();
      } catch (_) {}
      return;
    }
    if (ME.mapKind === 'kakao') {
      ME.kakaoStoreOverlays.forEach((o) => {
        try {
          o.setMap(null);
        } catch (_) {}
      });
      ME.kakaoStoreOverlays = [];
    }
  }

  function clearKeywordMarkers() {
    if (ME.mapKind === 'leaflet' && ME.keywordLayer) {
      try {
        ME.keywordLayer.clearLayers();
      } catch (_) {}
      return;
    }
    if (ME.mapKind === 'kakao') {
      ME.kakaoKeywordOverlays.forEach((o) => {
        try {
          o.setMap(null);
        } catch (_) {}
      });
      ME.kakaoKeywordOverlays = [];
    }
  }

  function renderKeywordMarkers(places) {
    clearKeywordMarkers();
    if (!places || !places.length) return;
    if (ME.mapKind === 'leaflet' && window.L && ME.keywordLayer) {
      const L = window.L;
      places.slice(0, 12).forEach((p) => {
        const la = Number(p.lat);
        const lo = Number(p.lon);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
        const m = L.circleMarker([la, lo], {
          radius: 6,
          color: '#7c3aed',
          fillColor: '#a78bfa',
          fillOpacity: 0.92,
          weight: 2,
        });
        m.bindPopup(`<div class="me-popup"><b>${esc(p.title || '검색 결과')}</b><div class="muted">${esc(p.address || '')}</div></div>`);
        ME.keywordLayer.addLayer(m);
      });
      return;
    }
    if (ME.mapKind === 'kakao' && window.kakao && window.kakao.maps) {
      const k = window.kakao.maps;
      places.slice(0, 12).forEach((p) => {
        const la = Number(p.lat);
        const lo = Number(p.lon);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
        const dot = document.createElement('div');
        dot.className = 'me-kakao-dot';
        dot.style.background = '#7c3aed';
        dot.style.borderColor = '#ede9fe';
        const ov = new k.CustomOverlay({
          position: new k.LatLng(la, lo),
          content: dot,
          yAnchor: 0.5,
          zIndex: 3,
        });
        ov.setMap(ME.kakaoMap);
        ME.kakaoKeywordOverlays.push(ov);
      });
    }
  }

  function markerColorForDensity(level) {
    if (level === '높음') return '#dc2626';
    if (level === '보통') return '#ea580c';
    return '#16a34a';
  }

  function renderStoreMarkers(stores, industryKey, densityLevel) {
    clearStoreMarkersUnified();
    if (!stores || !stores.length) return;
    const filtered = !!(industryKey && industryKey !== 'all');
    const mc = markerColorForDensity(densityLevel || '');

    if (ME.mapKind === 'leaflet' && ME.leafletMap && window.L && ME.storeLayer) {
      const L = window.L;
      stores.slice(0, MAX_MARKERS).forEach((s) => {
        const la = Number(s.lat);
        const lo = Number(s.lon);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
        const color = filtered ? mc : '#94a3b8';
        const m = L.circleMarker([la, lo], {
          radius: filtered ? 7 : 5,
          color,
          fillColor: color,
          fillOpacity: filtered ? 0.88 : 0.45,
          weight: filtered ? 2 : 1,
        });
        const nm = esc(s.store_name || '-');
        const cat = esc(s.industry_small || s.industry_middle || '');
        const addr = esc(s.road_address || s.address || '');
        const dist = esc(s.distance_label || '');
        m.bindPopup(
          `<div class="me-popup"><b>${nm}</b><div class="muted">${cat}</div>${addr ? `<div class="muted">${addr}</div>` : ''}<div class="muted">${dist}</div></div>`,
          { maxWidth: 260 },
        );
        ME.storeLayer.addLayer(m);
      });
      return;
    }

    if (ME.mapKind === 'kakao' && ME.kakaoMap && window.kakao && window.kakao.maps) {
      const k = window.kakao.maps;
      stores.slice(0, MAX_MARKERS).forEach((s) => {
        const la = Number(s.lat);
        const lo = Number(s.lon);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
        const dot = document.createElement('div');
        dot.className = 'me-kakao-dot' + (filtered ? ' me-kakao-dot--on' : '');
        dot.style.background = filtered ? mc : '#94a3b8';
        const ov = new k.CustomOverlay({
          position: new k.LatLng(la, lo),
          content: dot,
          yAnchor: 0.5,
          zIndex: 2,
        });
        ov.setMap(ME.kakaoMap);
        ME.kakaoStoreOverlays.push(ov);
      });
    }
  }

  function syncUiFromPayload(data) {
    ME.lastPayload = data;
    const sum = data.summary || {};
    const rb = data.radius_breakdown || {};

    document.getElementById('me-stat-total').textContent =
      sum.total_stores != null ? `${sum.total_stores}곳` : '—';
    document.getElementById('me-stat-same').textContent =
      sum.same_or_similar_stores != null ? `${sum.same_or_similar_stores}곳` : '—';

    const lvl = sum.density_level || '—';
    const lvlEl = document.getElementById('me-stat-level');
    lvlEl.textContent = lvl;
    lvlEl.className = 'me-level';
    if (lvl === '높음') lvlEl.classList.add('me-level-high');
    else if (lvl === '보통') lvlEl.classList.add('me-level-mid');
    else if (lvl === '낮음') lvlEl.classList.add('me-level-low');

    const ns = data.nearest_store;
    const ind = ME.industry && ME.industry !== 'all';
    document.getElementById('me-nearest').innerHTML = ns
      ? `${ind ? '가장 가까운 유사 점포' : '가장 가까운 점포'}: <strong>${esc(ns.store_name || '-')}</strong> · 약 ${Math.round(ns.distance_m)}m`
      : '';

    const tops = data.top_industries || [];
    document.getElementById('me-top3').textContent = tops.length
      ? `주요 업종 Top ${tops.length}: ${tops.map((t) => `${esc(t.name)} ${t.count}`).join(' · ')}`
      : '';

    renderTopBars(tops);

    document.getElementById('me-interpret').textContent = sum.density_comment || '';

    const rec = document.getElementById('me-recommended-action');
    if (rec) rec.textContent = data.recommended_next_step ? `추천 다음 행동: ${data.recommended_next_step}` : '';

    const strip = document.getElementById('me-radius-strip');
    if (strip) {
      const parts = [300, 500, 1000].map((r) => {
        const x = rb[String(r)];
        if (!x) return `${r}m: —`;
        const sa = x.same_or_similar_stores != null ? x.same_or_similar_stores : x.total_stores;
        return `${r}m 내 ${ind ? '유사' : '전체'} ${sa}곳 (${x.density_level || '—'})`;
      });
      strip.textContent = parts.join(' · ');
    }

    const hints = data.context_hints || {};
    const fp = hints.floating_pop || {};
    const sl = hints.sales_estimate || {};
    const mini = document.getElementById('me-hints-mini');
    if (mini) {
      mini.innerHTML = `
        ${fp.level ? `<span>유동인구 수준(로컬): <strong>${esc(fp.level)}</strong></span>` : `<span>${esc(fp.note || '')}</span>`}
        ${sl.monthly_manwon != null ? `<span> · 월매출 참고(추정): <strong>${esc(String(sl.monthly_manwon))}</strong>만원대</span>` : ''}`;
    }

    document.getElementById('me-mini-density').textContent = lvl;
    document.getElementById('me-mini-density-sub').textContent =
      sum.same_or_similar_stores != null && ME.radius
        ? `반경 ${ME.radius}m · 유사 업종 ${sum.same_or_similar_stores}곳`
        : '';
    document.getElementById('me-mini-total').textContent =
      sum.total_stores != null ? `${sum.total_stores}곳` : '—';
    document.getElementById('me-mini-fp').textContent = fp.level || '—';
    document.getElementById('me-mini-fp-sub').textContent = fp.note || (fp.level ? '로컬 유동인구 데이터 기준' : '상세 컨설팅에서 확인 가능');
    document.getElementById('me-mini-sales').textContent =
      sl.monthly_manwon != null ? `약 ${sl.monthly_manwon}만원대` : '상세 컨설팅에서 추정';
    document.getElementById('me-mini-sales-sub').textContent = sl.note || '';

    const acards = data.area_candidates || [];
    renderAreaCards(acards);
    renderComparisonStrip(acards.slice(0, 3));

    const orEl = document.getElementById('me-opportunity-risk');
    if (orEl) {
      const ol = (hints.opportunity_lines || []).map((x) => `<li>${esc(x)}</li>`).join('');
      const rl = (hints.risk_lines || []).map((x) => `<li>${esc(x)}</li>`).join('');
      orEl.innerHTML =
        '<div class="me-or-col"><strong>기회 요약</strong><ul class="me-or-ul">' +
        (ol || '<li class="muted">상세 컨설팅에서 추가 검토 가능</li>') +
        '</ul></div><div class="me-or-col"><strong>유의 사항</strong><ul class="me-or-ul">' +
        (rl || '<li class="muted">—</li>') +
        '</ul></div>';
    }

    renderStoreRows(data.stores || []);

    const candNames = acards.slice(0, 3).map((c) => esc(c.area_name || c.area_code)).join(', ');
    document.getElementById('me-location-label').textContent =
      `${ME.centerLat.toFixed(5)}, ${ME.centerLon.toFixed(5)} · 상권 후보: ${candNames || '탐색 중'}`;
  }

  function renderTopBars(items) {
    const wrap = document.getElementById('me-top-bar-wrap');
    if (!wrap) return;
    if (!items.length) {
      wrap.innerHTML = '';
      return;
    }
    const max = Math.max(...items.map((x) => x.count), 1);
    wrap.innerHTML =
      '<div class="me-bar-title muted">주요 업종 Top 5</div>' +
      items
        .slice(0, 5)
        .map((t) => {
          const pct = Math.round((t.count / max) * 100);
          return `<div class="me-bar-row"><span class="me-bar-name">${esc(t.name)}</span><div class="me-bar-track"><span class="me-bar-fill" style="width:${pct}%"></span></div><span class="me-bar-num">${t.count}</span></div>`;
        })
        .join('');
  }

  function renderAreaCards(list) {
    const box = document.getElementById('me-area-cards');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="muted me-small">상권 영역 데이터를 불러오면 후보가 표시됩니다.</div>';
      return;
    }
    box.innerHTML = list
      .map((c, idx) => {
        const sel = ME.selectedAreaIdx === idx ? ' me-area-card--selected' : '';
        const badges = (c.badges || []).slice(0, 4).map((b) => `<span class="me-badge">${esc(b)}</span>`).join('');
        const tops = (c.major_industries_display || []).join(', ');
        return `<article class="me-area-card${sel}" data-area-idx="${idx}" tabindex="0">
          <div class="me-area-card-head"><strong>${esc(c.area_name || '-')}</strong><span class="muted">${Math.round(c.dist_m)}m</span></div>
          <div class="muted me-small">${esc(c.area_type || '')} · 점포 합계 ${c.total_stores_in_area != null ? c.total_stores_in_area : '—'}</div>
          <div class="muted me-small">동일·유사 서비스 점포: ${c.same_service_stores_in_area != null ? c.same_service_stores_in_area : '—'} · 경쟁: ${esc(c.expected_competition || '—')}</div>
          ${tops ? `<div class="muted me-small">주요 업종: ${esc(tops)}</div>` : ''}
          <div class="me-badge-row">${badges}</div>
          <button type="button" class="btn btn-secondary btn-sm btn-block me-area-focus" data-area-idx="${idx}">지도에서 이 상권 보기</button>
          <button type="button" class="btn btn-primary btn-sm btn-block me-area-consult" data-area-idx="${idx}">이 상권으로 상세 컨설팅 시작</button>
        </article>`;
      })
      .join('');

    box.querySelectorAll('.me-area-card').forEach((card) => {
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('button')) return;
        const idx = Number(card.dataset.areaIdx);
        focusAreaCandidate(idx);
      });
    });
    box.querySelectorAll('.me-area-focus').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        focusAreaCandidate(Number(btn.dataset.areaIdx));
      });
    });
    box.querySelectorAll('.me-area-consult').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = Number(btn.dataset.areaIdx);
        startConsultFromArea(idx);
      });
    });
  }

  function renderComparisonStrip(top3) {
    const el = document.getElementById('me-comparison-cards');
    if (!el) return;
    el.innerHTML = top3
      .map((c) => {
        return `<div class="me-ccard"><div class="me-ccard-t">${esc(c.area_name || '')}</div>
          <div class="muted me-small">${Math.round(c.dist_m)}m · ${esc(c.expected_competition || '')}</div>
          <div class="me-ccard-row"><span>점포</span><b>${c.total_stores_in_area != null ? c.total_stores_in_area : '—'}</b></div>
          <div class="me-ccard-row"><span>유사 업종</span><b>${c.same_service_stores_in_area != null ? c.same_service_stores_in_area : '—'}</b></div></div>`;
      })
      .join('');
  }

  function renderStoreRows(stores) {
    const el = document.getElementById('me-store-list');
    if (!el) return;
    if (!stores.length) {
      el.innerHTML = '<div class="muted me-small">표시할 점포가 없습니다.</div>';
      return;
    }
    el.innerHTML = stores
      .slice(0, 40)
      .map(
        (s) =>
          `<div class="me-store-row"><span class="me-store-name">${esc(s.store_name)}</span><span class="muted">${esc(s.distance_label || '')}</span></div>`,
      )
      .join('');
  }

  function focusAreaCandidate(idx) {
    const list = ME.lastPayload && ME.lastPayload.area_candidates;
    if (!list || !list[idx]) return;
    const c = list[idx];
    if (c.lat == null || c.lon == null) return;
    ME.selectedAreaIdx = idx;
    ME.centerLat = Number(c.lat);
    ME.centerLon = Number(c.lon);
    ME.pinLat = ME.pinLat ?? ME.centerLat;
    ME.pinLon = ME.pinLon ?? ME.centerLon;
    fetchNearby();
  }

  function bridgePayload(kind) {
    const sum = (ME.lastPayload && ME.lastPayload.summary) || {};
    const cand =
      ME.selectedAreaIdx != null && ME.lastPayload && ME.lastPayload.area_candidates
        ? ME.lastPayload.area_candidates[ME.selectedAreaIdx]
        : null;
    const lat = ME.centerLat;
    const lon = ME.centerLon;
    return {
      lat,
      lon,
      radius_m: ME.radius,
      industry_key: ME.industry,
      area_code: cand ? cand.area_code : '',
      area_name: cand ? cand.area_name : '',
      district: cand ? cand.district : '',
      dong: cand ? cand.dong : '',
      density_level: sum.density_level || '',
      same_or_similar_stores: sum.same_or_similar_stores,
      selection_label: cand ? cand.area_name : '',
    };
  }

  function startConsultFromArea(idx) {
    const list = ME.lastPayload && ME.lastPayload.area_candidates;
    if (!list || !list[idx]) return;
    ME.selectedAreaIdx = idx;
    const c = list[idx];
    if (c.lat != null && c.lon != null) {
      ME.centerLat = Number(c.lat);
      ME.centerLon = Number(c.lon);
    }
    if (typeof window.goDiagnosisFromMapExplorer !== 'function') return;
    window.goDiagnosisFromMapExplorer('startup', {
      lat: ME.centerLat,
      lon: ME.centerLon,
      radius_m: ME.radius,
      industry_key: ME.industry,
      area_code: c.area_code,
      area_name: c.area_name,
      district: c.district,
      dong: c.dong,
      density_level: (ME.lastPayload && ME.lastPayload.summary && ME.lastPayload.summary.density_level) || '',
      same_or_similar_stores:
        (ME.lastPayload && ME.lastPayload.summary && ME.lastPayload.summary.same_or_similar_stores) || '',
      selection_label: c.area_name,
    });
  }

  async function fetchNearby() {
    const lat = ME.centerLat;
    const lon = ME.centerLon;
    if (lat == null || lon == null) return;
    setActionButtonsEnabled(true);
    const reqSeq = ++ME.requestSeq;
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      radius: String(ME.radius),
      industry: ME.industry || 'all',
      limit: '100',
    });
    let data;
    try {
      data = await window.fetchJson(`/api/map-explorer/nearby-stores?${params}`);
    } catch (e) {
      document.getElementById('me-interpret').textContent =
        '주변 점포 데이터를 불러오지 못했습니다. 네트워크와 서버 상태를 확인해 주세요.';
      return;
    }
    if (reqSeq !== ME.requestSeq) return;
    syncUiFromPayload(data);
    renderStoreMarkers(data.stores || [], ME.industry, data.summary && data.summary.density_level);
    drawCirclesUnified(lat, lon, ME.radius);
    setCenterMarker(lat, lon, ME.selectedAreaIdx != null ? '선택 상권' : '관심 위치');

    const hint = document.getElementById('me-search-hint');
    if (hint) {
      const w = (data.warnings || []).join(' ');
      hint.textContent = w || '';
    }

    const note = document.getElementById('me-map-provider-note');
    if (note && ME.providerResolved) {
      note.textContent =
        ME.providerResolved === 'kakao'
          ? '지도: 카카오맵 · 데이터: 로컬 상가 CSV · 반경·거리는 참고용입니다.'
          : '지도: Leaflet/OSM · 데이터: 로컬 상가 CSV · 반경·거리는 참고용입니다.';
      if (ME.kakaoLoadError && ME.providerResolved !== 'kakao') {
        note.textContent += ` (카카오맵 로드 실패: ${ME.kakaoLoadError})`;
      }
    }
  }

  function fetchNearbyDebounced() {
    if (ME.moveTimer) clearTimeout(ME.moveTimer);
    ME.moveTimer = setTimeout(() => {
      fetchNearby();
    }, 180);
  }

  function setActionButtonsEnabled(enabled) {
    ['me-btn-startup', 'me-btn-operate', 'me-btn-wizard', 'me-btn-cta-startup', 'me-btn-cta-operate'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = !enabled;
      el.classList.toggle('is-disabled', !enabled);
    });
  }

  function setRadius(r) {
    ME.radius = r;
    document.querySelectorAll('.me-rad').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.r) === r);
    });
    if (ME.centerLat != null) fetchNearby();
  }

  async function initLeafletInternal() {
    await ensureLeaflet();
    const el = document.getElementById('map-explorer-leaflet');
    if (!el || ME.leafletMap) return;
    const L = window.L;
    ME.mapKind = 'leaflet';
    ME.providerResolved = 'leaflet';
    ME.leafletMap = L.map(el, { zoomControl: true, preferCanvas: true }).setView(DEFAULT_CENTER, 12);
    ME.tileLayer = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; CARTO &copy; OSM' },
    ).addTo(ME.leafletMap);
    ME.storeLayer = L.layerGroup().addTo(ME.leafletMap);
    ME.keywordLayer = L.layerGroup().addTo(ME.leafletMap);

    ME.leafletMap.on('click', (e) => {
      ME.pinLat = e.latlng.lat;
      ME.pinLon = e.latlng.lng;
      ME.centerLat = e.latlng.lat;
      ME.centerLon = e.latlng.lng;
      ME.selectedAreaIdx = null;
      fetchNearby();
    });
    ME.leafletMap.on('moveend', () => {
      if (ME.isProgrammaticMove || ME.centerLat == null) return;
      const c = ME.leafletMap.getCenter();
      ME.centerLat = c.lat;
      ME.centerLon = c.lng;
      ME.selectedAreaIdx = null;
      fetchNearbyDebounced();
    });
  }

  async function initKakaoInternal(key) {
    const el = document.getElementById('map-explorer-leaflet');
    if (!el || ME.kakaoMap) return;
    await loadKakaoSdk(key);
    const k = window.kakao.maps;
    ME.mapKind = 'kakao';
    ME.providerResolved = 'kakao';
    ME.kakaoMap = new k.Map(el, {
      center: new k.LatLng(DEFAULT_CENTER[0], DEFAULT_CENTER[1]),
      level: 6,
    });
    k.event.addListener(ME.kakaoMap, 'click', function (mouseEvent) {
      const latlng = mouseEvent.latLng;
      ME.pinLat = latlng.getLat();
      ME.pinLon = latlng.getLng();
      ME.centerLat = latlng.getLat();
      ME.centerLon = latlng.getLng();
      ME.selectedAreaIdx = null;
      fetchNearby();
    });
    k.event.addListener(ME.kakaoMap, 'idle', function () {
      if (ME.isProgrammaticMove || ME.centerLat == null) return;
      const c = ME.kakaoMap.getCenter();
      ME.centerLat = c.getLat();
      ME.centerLon = c.getLng();
      ME.selectedAreaIdx = null;
      fetchNearbyDebounced();
    });
  }

  async function initMap() {
    const el = document.getElementById('map-explorer-leaflet');
    if (!el || ME.leafletMap || ME.kakaoMap) return;

    ME.mapConfig = await fetchCfg();
    const cfg = ME.mapConfig || {};
    const prov = (cfg.provider || 'auto').toLowerCase();
    const forceLeaflet = prov === 'leaflet';
    const preferKakao = (prov === 'kakao' || prov === 'auto') && cfg.configured && cfg.kakao_js_app_key;

    if (!forceLeaflet && preferKakao) {
      try {
        await initKakaoInternal(cfg.kakao_js_app_key);
        ME.kakaoLoadError = '';
        return;
      } catch (e) {
        console.warn('[map-explorer] Kakao map fallback to Leaflet', e);
        const msg = (e && e.message ? e.message : String(e || 'unknown')).slice(0, 180);
        ME.kakaoLoadError = msg;
        const hint = document.getElementById('me-search-hint');
        if (hint) {
          hint.textContent =
            `카카오맵 SDK 로드 실패로 Leaflet 지도로 전환했습니다. (${msg}) ` +
            '카카오 디벨로퍼스 Web 플랫폼 도메인(예: http://localhost:3288) 등록 여부를 확인해 주세요.';
        }
      }
    }
    await initLeafletInternal();
  }

  async function onMapExplorerShown() {
    await initMap();
    invalidateSize();
    setTimeout(invalidateSize, 320);
    setActionButtonsEnabled(ME.centerLat != null && ME.centerLon != null);
    if (ME.centerLat != null && ME.centerLon != null) fetchNearby();
  }

  function resetExplorer() {
    ME.centerLat = null;
    ME.centerLon = null;
    ME.pinLat = null;
    ME.pinLon = null;
    ME.lastPayload = null;
    ME.selectedAreaIdx = null;
    clearStoreMarkersUnified();
    clearKeywordMarkers();
    clearCirclesAll();
    if (ME.mapKind === 'leaflet') {
      if (ME.centerMarkerLeaflet) {
        try {
          ME.leafletMap.removeLayer(ME.centerMarkerLeaflet);
        } catch (_) {}
        ME.centerMarkerLeaflet = null;
      }
    }
    if (ME.mapKind === 'kakao') {
      if (ME.centerOverlayKakao) {
        try {
          ME.centerOverlayKakao.setMap(null);
        } catch (_) {}
        ME.centerOverlayKakao = null;
      }
    }
    document.getElementById('me-stat-total').textContent = '—';
    document.getElementById('me-stat-same').textContent = '—';
    document.getElementById('me-stat-level').textContent = '—';
    document.getElementById('me-nearest').innerHTML = '';
    document.getElementById('me-top3').textContent = '';
    document.getElementById('me-top-bar-wrap').innerHTML = '';
    document.getElementById('me-interpret').textContent =
      '지도에서 관심 위치를 클릭해 주변 상권을 먼저 확인하세요.';
    document.getElementById('me-search-results').innerHTML = '';
    document.getElementById('me-area-cards').innerHTML = '';
    document.getElementById('me-store-list').innerHTML = '';
    document.getElementById('me-comparison-cards').innerHTML = '';
    document.getElementById('me-location-label').textContent = '위치를 선택하면 좌표·선택 상권이 표시됩니다.';
    const hint = document.getElementById('me-search-hint');
    if (hint) hint.textContent = '';
    const strip = document.getElementById('me-radius-strip');
    if (strip) strip.textContent = '';
    const ra = document.getElementById('me-recommended-action');
    if (ra) ra.textContent = '';

    if (ME.mapKind === 'leaflet' && ME.leafletMap) ME.leafletMap.setView(DEFAULT_CENTER, 12);
    if (ME.mapKind === 'kakao' && ME.kakaoMap && window.kakao && window.kakao.maps) {
      ME.kakaoMap.setCenter(new window.kakao.maps.LatLng(DEFAULT_CENTER[0], DEFAULT_CENTER[1]));
      ME.kakaoMap.setLevel(6);
    }
    ME.kakaoLoadError = '';
    setActionButtonsEnabled(false);
  }

  async function runPlaceSearch() {
    const inp = document.getElementById('me-inp-search');
    const box = document.getElementById('me-search-results');
    const q = (inp && inp.value ? inp.value : '').trim();
    if (!q) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '<div class="muted me-small">검색 중…</div>';
    try {
      const res = await window.fetchJson('/api/external-search?q=' + encodeURIComponent(q));
      const places = res.local_places || [];
      renderKeywordMarkers(places);
      const errHint = res.errors && res.errors.local ? String(res.errors.local) : '';
      if (!places.length) {
        box.innerHTML = `<div class="muted">${esc(errHint || '검색 결과가 없습니다. 서버에 KAKAO_REST_API_KEY가 설정되어 있으면 장소 검색이 활성화됩니다.')}</div>`;
        return;
      }
      box.innerHTML = places
        .slice(0, 8)
        .map(
          (p, i) =>
            `
        <button type="button" class="me-place-row" data-idx="${i}">
          <span class="me-place-name">${esc(p.title || '')}</span>
          <span class="muted me-small">${esc(p.address || '')}</span>
        </button>`,
        )
        .join('');
      box.querySelectorAll('.me-place-row').forEach((row) => {
        row.addEventListener('click', () => {
          const i = Number(row.dataset.idx);
          const p = places[i];
          if (p.lat == null || p.lon == null) return;
          ME.centerLat = Number(p.lat);
          ME.centerLon = Number(p.lon);
          ME.pinLat = ME.centerLat;
          ME.pinLon = ME.centerLon;
          ME.selectedAreaIdx = null;
          box.innerHTML = '';
          if (inp) inp.value = p.title || '';
          fetchNearby();
        });
      });
    } catch (e) {
      box.innerHTML = `<div class="muted">${esc(e.message || String(e))}</div>`;
    }
  }

  function bindUi() {
    document.getElementById('btn-map-explorer-close')?.addEventListener('click', () => {
      if (typeof window.goStep === 'function') window.goStep('home');
    });

    document.querySelectorAll('.me-rad').forEach((b) => {
      b.addEventListener('click', () => setRadius(Number(b.dataset.r)));
    });

    document.getElementById('me-sel-industry')?.addEventListener('change', (e) => {
      ME.industry = e.target.value || 'all';
      fetchNearby();
    });

    document.getElementById('me-btn-search')?.addEventListener('click', runPlaceSearch);
    document.getElementById('me-inp-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runPlaceSearch();
      }
    });

    document.getElementById('me-btn-reset')?.addEventListener('click', resetExplorer);

    document.getElementById('me-btn-startup')?.addEventListener('click', () => {
      if (typeof window.goDiagnosisFromMapExplorer !== 'function') return;
      window.goDiagnosisFromMapExplorer('startup', bridgePayload('startup'));
    });

    document.getElementById('me-btn-operate')?.addEventListener('click', () => {
      if (typeof window.goDiagnosisFromMapExplorer !== 'function') return;
      window.goDiagnosisFromMapExplorer('operate', bridgePayload('operate'));
    });

    document.getElementById('me-btn-wizard')?.addEventListener('click', () => {
      if (typeof window.goDiagnosisFromMapExplorer !== 'function') return;
      window.goDiagnosisFromMapExplorer('wizard', bridgePayload('wizard'));
    });

    document.getElementById('me-btn-cta-startup')?.addEventListener('click', () => {
      document.getElementById('me-btn-startup')?.click();
    });
    document.getElementById('me-btn-cta-operate')?.addEventListener('click', () => {
      document.getElementById('me-btn-operate')?.click();
    });

    document.getElementById('me-help-toggle')?.addEventListener('click', () => {
      const p = document.getElementById('me-help-panel');
      const btn = document.getElementById('me-help-toggle');
      if (!p || !btn) return;
      const open = p.hidden;
      p.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.getElementById('me-interpret').textContent =
      '지도에서 관심 위치를 클릭해 주변 상권을 먼저 확인하세요.';
    setActionButtonsEnabled(false);
  }

  window.mapExplorerOnShown = onMapExplorerShown;

  document.addEventListener('DOMContentLoaded', () => {
    bindUi();
  });
})();
