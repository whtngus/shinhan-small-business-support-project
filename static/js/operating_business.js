/* 운영 중 사업자 전용 플로우 */
'use strict';

(function () {
  const OpState = {
    storeId: null,
    profile: null,
    analysis: null,
    actionPlan: null,
    actionPlanMeta: null,
    planFlashMessage: '',
    charts: {},
  };

  function fmtMoney(v) {
    const n = Number(v || 0);
    return new Intl.NumberFormat('ko-KR').format(Math.round(n)) + '원';
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function fmtPct(v) {
    return `${Math.round(Number(v || 0) * 100)}%`;
  }

  function truncMsg(s, max) {
    const t = s == null ? '' : String(s).trim();
    if (!t) return '';
    const m = max == null ? 200 : max;
    return t.length <= m ? t : `${t.slice(0, m)}…`;
  }

  function actionKey(item) {
    if (!item) return '';
    const w = item.week != null ? String(item.week) : '';
    const t = item.text != null ? String(item.text).trim() : '';
    return `${w}::${t}`;
  }

  /** 신한 CTA 모달에 운영 사업장 맥락 표시용 */
  function setOpShinhanContext(sp) {
    const name = sp?.store_name || '';
    const ind = sp?.industry || '';
    const ma = sp?.market_area || '';
    window.__SHINHAN_OP_CONTEXT__ = {
      headline: [name, ind].filter(Boolean).join(' · '),
      area_name: ma || name || '',
      service_name: ind || '',
    };
  }

  function opShinhanMini(title, subsidiaryBadge, brandClass, desc, ctaAction) {
    const bc = brandClass || 'shfg-kind-bank';
    return `
      <div class="shfg-product-card op-shfg-inline ${bc}">
        <div class="shfg-subsidiary-badge">${esc(subsidiaryBadge)}</div>
        <h4 class="shfg-title">${esc(title)}</h4>
        <p class="shfg-reason">${esc(desc)}</p>
        <button type="button" class="btn btn-secondary btn-sm spr-cta shfg-cta" data-cta-action="${esc(ctaAction)}">안내·체크리스트</button>
      </div>`;
  }

  function opShinhanStrip(cardsHtml) {
    return `
      <div class="op-shfg-strip info-box" style="margin-top:14px">
        <div class="info-title">부족한 부분 보완 · 신한금융그룹 참고</div>
        <p class="muted" style="margin:6px 0 12px;font-size:13px;line-height:1.45">
          진단 내용과 연결된 <strong>상담·점검 경로</strong>입니다. 특정 상품 확정 추천이 아니며, 금리·한도·보장은 심사·약관에 따릅니다.
        </p>
        <div class="shfg-product-list op-shfg-product-list">${cardsHtml}</div>
      </div>`;
  }

  function opCashflowShinhanHtml(d) {
    const cf = d.cashflow_insight || {};
    const net = Number(cf.net_cash_flow || 0);
    const msg = cf.message || '';
    const stressed = net < 0 || /낮|부족|마이너스|위험|주의/.test(msg);
    const cards = [];
    if (stressed) {
      cards.push(
        opShinhanMini(
          '운영자금·통장 여유 확보',
          '신한은행',
          'shfg-kind-bank',
          '순현금흐름이 불안정하면 월 고정비·대출 일정을 표로 정리한 뒤, 단기 운전자금·당좌 여유를 상담으로 점검해 보세요.',
          'bank_working',
        ),
      );
    }
    cards.push(
      opShinhanMini(
        '카드 매출 입금·정산 일정',
        '신한카드',
        'shfg-kind-card',
        '입금 지연·정산 주기 편차가 있으면 통장 잔액 곡선이 흔들립니다. 가맹점 정산 리드타임을 공식 채널에서 확인해 보세요.',
        'card_settlement',
      ),
      opShinhanMini(
        '사업자·법인카드 경비 분리',
        '신한카드',
        'shfg-kind-card',
        '개인과 사업 지출이 섞이면 현금흐름 분석이 어렵습니다. 경비 카드 구조를 재정비해 보세요.',
        'card_business_card',
      ),
    );
    return opShinhanStrip(cards.join(''));
  }

  function opLoanShinhanHtml(d) {
    const li = d.loan_insight || {};
    const cards = [];
    if (li.refinance_candidate) {
      cards.push(
        opShinhanMini(
          '대환·저금리 이전(갈아타기) 검토',
          '신한은행',
          'shfg-kind-bank',
          '현재 평균·최고 금리를 기준으로, 신한 채널에서 금리 우대·대환 시 월 이자·원리금 부담이 줄어드는지 비교해 보세요. 중도상환 수수료는 기존 약정을 확인해야 합니다.',
          'bank_refinance',
        ),
      );
    }
    cards.push(
      opShinhanMini(
        '사업자 대출 금리·한도 재구성 상담',
        '신한은행',
        'shfg-kind-bank',
        '동일 담보·매출 조건에서 더 낮은 금리 상품으로 정리할 수 있는지, 영업점·디지털 상담으로 확인할 수 있습니다.',
        'bank_refinance',
      ),
      opShinhanMini(
        '정책자금·보증 연계 가능 여부',
        '신한은행 · 정책자금',
        'shfg-kind-bank',
        '민간 대출만으로 부담이 크면 정책자금·보증 제도와 병행 가능한지 공식 포털에서 조건을 확인해 보세요.',
        'bank_policy',
      ),
    );
    return opShinhanStrip(cards.join(''));
  }

  function opInsuranceShinhanHtml(d) {
    const ins = d.insurance_insight || {};
    const gaps = (ins.gaps || []).map(g => String(g));
    const cards = [];
    const has = sub => gaps.some(g => g.includes(sub));
    if (has('영업배상') || has('배상')) {
      cards.push(
        opShinhanMini(
          '영업배상·고객 안전 사고',
          '신한라이프',
          'shfg-kind-life',
          '방문형 매장은 배상 리스크 점검이 중요합니다. 특약·면책을 약관으로 확인하세요.',
          'life_liability',
        ),
      );
    }
    if (has('화재')) {
      cards.push(
        opShinhanMini(
          '화재·시설물 보장',
          '신한라이프',
          'shfg-kind-life',
          '점포 시설·화기 사용 업종은 화재 보장 한도와 면책을 점검하세요.',
          'life_fire',
        ),
      );
    }
    if (has('영업중단')) {
      cards.push(
        opShinhanMini(
          '휴업·영업중단 리스크',
          '신한라이프',
          'shfg-kind-life',
          '임대료·인건비가 지속되는 동안 매출이 멈추는 시나리오를 대비해 보장 가능 범위를 확인하세요.',
          'life_interruption',
        ),
      );
    }
    if (has('재산') || has('시설') || has('종합')) {
      cards.push(
        opShinhanMini(
          '점포 재산·배상 종합(EZ)',
          '신한EZ손해보험',
          'shfg-kind-ez',
          '재산종합·배상 특약 등 업종별 설계가 다릅니다. 공백 진단 결과를 들고 상담 경로를 확인하세요.',
          'ez_sme_risk',
        ),
      );
    }
    if (!cards.length) {
      cards.push(
        opShinhanMini(
          '업종별 보장 체크리스트',
          '신한라이프',
          'shfg-kind-life',
          '보장 공백이 명시되지 않았어도 방문형 업종은 화재·배상·시설 리스크를 주기적으로 점검하는 것이 좋습니다.',
          'life_checklist',
        ),
        opShinhanMini(
          '소상공인 점포·재산 점검',
          '신한EZ손해보험',
          'shfg-kind-ez',
          '손해보험 계열에서 점포 면적·업종 코드 기준 보장 구조를 확인할 수 있습니다.',
          'ez_sme_risk',
        ),
      );
    }
    return opShinhanStrip(cards.join(''));
  }

  function opCashAvailableShinhanHtml(d) {
    const cash = d.cash_advice || {};
    const avail = Number(cash.available_cash || 0);
    const cards = [];
    if (avail < 15000000) {
      cards.push(
        opShinhanMini(
          '가용 현금 부족 시 운영자금 상담',
          '신한은행',
          'shfg-kind-bank',
          '당장 쓸 수 있는 금액이 적을 때는 단기 운전자금·한도 성격 상품을 오버만 보지 말고 상환·금리 조건까지 함께 비교하세요.',
          'bank_working',
        ),
      );
    }
    cards.push(
      opShinhanMini(
        '매출·지출 통합 관리(사업자 채널)',
        '신한은행',
        'shfg-kind-bank',
        '사업자 통장·결제 데이터가 한곳에 모일수록 “사용 가능 금액” 판단이 쉬워집니다.',
        'bank_working',
      ),
      opShinhanMini(
        '카드 매출·정산 안정화',
        '신한카드',
        'shfg-kind-card',
        '가맹점 정산 주기와 프로모션 비용을 파악하면 지출 계획이 정교해집니다.',
        'card_settlement',
      ),
    );
    return opShinhanStrip(cards.join(''));
  }

  function destroyOpCharts() {
    Object.keys(OpState.charts).forEach(k => {
      OpState.charts[k]?.destroy?.();
      delete OpState.charts[k];
    });
  }

  function bindGoButtons() {
    ['operating-connect', 'operating-store', 'operating-preview'].forEach(panel => {
      const root = document.getElementById('panel-' + panel);
      if (!root) return;
      root.querySelectorAll('[data-go]').forEach(btn => {
        btn.addEventListener('click', () => window.goStep(btn.dataset.go));
      });
    });
    const result = document.getElementById('panel-operating-result');
    result?.querySelectorAll('[data-go]').forEach(btn => {
      btn.addEventListener('click', () => window.goStep(btn.dataset.go));
    });
  }

  async function openStoreSelector() {
    window.goStep('operating-store');
    const box = document.getElementById('op-store-list');
    box.innerHTML = '<div class="muted">사업장 목록을 불러오는 중...</div>';
    try {
      const res = await window.fetchJson('/api/shinhan/business/stores');
      const stores = res.stores || [];
      if (!stores.length) {
        box.innerHTML = '<div class="info-box"><div class="info-body">사업장을 찾지 못했습니다. 목업 데이터로 진단할 수 있습니다.</div></div>';
        return;
      }
      box.innerHTML = stores.map(s => `
        <div class="op-store-card">
          <div class="op-store-title">${esc(s.store_name)}</div>
          <div class="op-store-meta">${esc(s.industry)} · ${esc(s.address)}</div>
          <div class="op-store-meta">최근 1개월 카드 매출: <b>${fmtMoney(s.monthly_card_sales)}</b> · 추이: ${esc(s.sales_trend)}</div>
          <div class="op-store-meta">연결 데이터: ${esc((s.connected_sources || []).join(', '))}</div>
          <button class="btn btn-primary btn-sm" data-store="${esc(s.store_id)}">이 사업장 진단하기</button>
        </div>
      `).join('');
      box.querySelectorAll('button[data-store]').forEach(btn => {
        btn.addEventListener('click', () => selectStore(btn.dataset.store));
      });
    } catch (e) {
      box.innerHTML = '<div class="info-box"><div class="info-body">사업장 목록을 불러오지 못했습니다.</div></div>';
    }
  }

  async function selectStore(storeId) {
    OpState.storeId = storeId;
    const profile = await window.fetchJson(`/api/shinhan/business/${storeId}/integrated-profile`);
    OpState.profile = profile;
    renderPreview(profile);
    window.goStep('operating-preview');
  }

  function renderPreview(p) {
    const wrap = document.getElementById('op-preview-wrap');
    const spMeta = p.store_profile || {};
    const sales = p.card_sales_profile || {};
    const spend = p.card_spending_profile || {};
    const bank = p.bank_account_profile || {};
    const loan = p.loan_profile || {};
    const ins = p.insurance_profile || {};
    const mk = p.external_market_profile || {};
    const mom = sales.mom_sales_pct != null ? `${sales.mom_sales_pct > 0 ? '+' : ''}${sales.mom_sales_pct}%` : '-';
    const week = sales.week_sales_ratio || {};
    const weekLabels = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
    const weekRow =
      Object.keys(week).length > 0
        ? `<div class="muted" style="margin-top:8px;font-size:12px;">요일 비중(참고): ${Object.entries(week)
            .map(([k, v]) => `${weekLabels[k] || k} ${v}%`)
            .join(' · ')}</div>`
        : '';
    const enrolled = (ins.enrolled_product_groups || [])
      .map(e => `${esc(e.insurer || '')} · ${esc(e.label || '')} (${fmtMoney(e.monthly_premium)}/월)`)
      .join('<br>');
    const contracts = (loan.loan_contracts || [])
      .map(
        c =>
          `<li>${esc(c.nickname || '')} · 잔액 ${fmtMoney(c.principal_balance)} · 금리 ${c.annual_rate_pct}% · 월 ${fmtMoney(c.monthly_repayment)} · 만기 ${esc(c.maturity_date || '')}</li>`,
      )
      .join('');
    const hints = (p.user_confirmation_hints || [])
      .map(h => `<li><strong>${esc(h.question)}</strong> → 권장: ${esc(h.suggested_answer || '')}</li>`)
      .join('');
    wrap.innerHTML = `
      <div class="info-box"><div class="info-title">사업장 개요</div><div class="info-body">${esc(spMeta.store_name || '')} · ${esc(spMeta.industry || '')} · ${esc(spMeta.address || '')}<br>
      상권: ${esc(spMeta.market_area || '')} · 업력 약 ${spMeta.operation_months || '-'}개월 · 사업자번호 ${esc(spMeta.business_no_masked || '')}</div></div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">최근 1개월 카드 매출</div><div class="kpi-value">${fmtMoney(sales.monthly_card_sales)}</div></div>
        <div class="kpi"><div class="kpi-label">전월 대비</div><div class="kpi-value">${mom}</div></div>
        <div class="kpi"><div class="kpi-label">평균 객단가</div><div class="kpi-value">${fmtMoney(sales.average_ticket)}</div></div>
        <div class="kpi"><div class="kpi-label">월 승인 건수</div><div class="kpi-value">${(sales.approval_count || 0).toLocaleString()}건</div></div>
        <div class="kpi"><div class="kpi-label">평일/주말 매출비중</div><div class="kpi-value">${sales.weekday_sales_ratio ?? '-'}% / ${sales.weekend_sales_ratio ?? '-'}%</div></div>
        <div class="kpi"><div class="kpi-label">상권 평균 대비(참고)</div><div class="kpi-value">${mk.market_average_sales ? `${Math.round((sales.monthly_card_sales / mk.market_average_sales) * 100)}%` : '-'}</div></div>
      </div>
      ${weekRow}
      <div class="info-box" style="margin-top:12px"><div class="info-title">카드 지출(신한 사업자·법인)</div><div class="info-body">월 합계 <b>${fmtMoney(spend.monthly_card_spending)}</b> · 사업자 ${fmtMoney(spend.business_card_spending)} · 법인 ${fmtMoney(spend.corporate_card_spending)}<br>
      증가 우려 카테고리: ${esc((spend.top_increase_categories_3m || []).join(', ') || '-')}</div></div>
      <div class="info-box"><div class="info-title">사업자 계좌(신한)</div><div class="info-body">현재 잔액 <b>${fmtMoney(bank.current_deposit_balance)}</b> · 3개월 평균 잔액 ${fmtMoney(bank.average_balance_3m)} · 월 입금 ${fmtMoney(bank.monthly_inflow)} / 출금 ${fmtMoney(bank.monthly_outflow)} · 30일 예정 지출 ${fmtMoney(bank.scheduled_outflow_next_30d)} · 예적금 ${fmtMoney(bank.savings_deposit_balance)}</div></div>
      <div class="info-box"><div class="info-title">대출(신한 연계)</div><div class="info-body">총 잔액 <b>${fmtMoney(loan.total_loan_balance)}</b> · 평균 금리 ${loan.average_interest_rate}% · 월 상환 ${fmtMoney(loan.monthly_repayment)}${loan.cardloan_or_cash_service ? ' · 카드론/현금성 포함' : ''}<ul style="margin:8px 0 0 18px;padding:0">${contracts || '<li>세부 약정은 영업점·뱅킹에서 확인</li>'}</ul></div></div>
      <div class="info-box"><div class="info-title">보험(신한라이프·EZ 연계)</div><div class="info-body">월 보험료 합계 ${fmtMoney(ins.monthly_premium)}<br>가입(목업): ${enrolled || '-'}<br>보장 공백 코드: ${esc((ins.insurance_gap || []).join(', ') || '-')}</div></div>
      <div class="info-box"><div class="info-title">자동 분류 확인(선택)</div><div class="info-body"><ul style="margin:0;padding-left:18px">${hints || '<li>추가 확인 항목 없음</li>'}</ul></div></div>
    `;
  }

  async function runAnalyze() {
    if (!OpState.storeId) return;
    window.goStep('operating-loading');
    animateLoading();
    const req = {
      main_concern: document.getElementById('op-main-concern')?.value || '잘 모르겠음',
      external_loan_exists: document.getElementById('op-external-loan')?.value || '없음',
      external_insurance_exists: document.getElementById('op-external-ins')?.value || '없음',
      planned_large_expense: document.getElementById('op-expense-plan')?.value || '없음',
      comparison_range: document.getElementById('op-compare-range')?.value || '500m',
    };
    const data = await window.fetchJson(`/api/shinhan/business/${OpState.storeId}/operating/analyze`, {
      method: 'POST',
      body: JSON.stringify(req),
    });
    OpState.analysis = data;
    renderResultTop(data);
    renderOpTab('summary');
    window.goStep('operating-result');
  }

  function animateLoading() {
    const items = document.querySelectorAll('#op-loading-checks li');
    items.forEach(it => it.classList.remove('done'));
    items.forEach((it, idx) => setTimeout(() => it.classList.add('done'), (idx + 1) * 220));
  }

  function renderResultTop(d) {
    const sp = d.integrated_profile?.store_profile || {};
    setOpShinhanContext(sp);
    const top = document.getElementById('op-result-top');
    top.innerHTML = `
      <div class="result-summary">
        <div class="summary-head">
          <div>
            <div class="summary-eyebrow">${esc(sp.store_name || '')} · ${esc(sp.industry || '')} · ${esc(sp.market_area || '')}</div>
            <div class="summary-title">${d.score}점 <span class="grade-badge">${esc(d.grade)}</span></div>
            <div class="summary-meta">${esc(d.summary || '')}</div>
          </div>
        </div>
        <div class="summary-finance-highlight">
          <div class="sfh-label">가장 시급한 개선 항목</div>
          <ul class="sfh-list">${(d.urgent_actions || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>
      </div>
    `;
  }

  function renderOpTab(tab) {
    destroyOpCharts();
    const d = OpState.analysis || {};
    const box = document.getElementById('op-tab-content');
    if (!box) return;
    if (tab === 'summary') {
      const good = (d.strengths || []).map(x => `<li>${esc(x)}</li>`).join('');
      const bad = (d.risk_points || []).map(x => `<li>${esc(x)}</li>`).join('');
      const sales = d.sales_insight || {};
      const si = d.spending_insight || {};
      const cf = d.cashflow_insight || {};
      const li = d.loan_insight || {};
      const ins = d.insurance_insight || {};
      const cad = d.cash_advice || {};
      const p = d.integrated_profile || {};
      const mk = p.external_market_profile || {};
      const bp = d.benchmark_pack || {};
      const urgent = d.urgent_actions || [];
      const products = (d.recommended_product_groups || []).slice(0, 5);
      const planRows = (OpState.actionPlan || []).slice(0, 4);

      const ratioVsSales =
        si.spending_ratio_vs_sales != null ? (Number(si.spending_ratio_vs_sales) * 100).toFixed(1) : '—';
      const matVsSales =
        si.materials_ratio_vs_sales != null ? (Number(si.materials_ratio_vs_sales) * 100).toFixed(1) : '—';
      const intBurdenPct = Math.round((li.interest_burden_ratio || 0) * 1000) / 10;
      const repBurdenPct = Math.round((li.repayment_burden_ratio || 0) * 1000) / 10;
      const gaps = ins.gaps || [];
      const gapStr = gaps.length ? esc(gaps.join(' · ')) : '특이 공백 없음(목업)';

      const productMini = products.length
        ? products
            .map(
              x => `
          <div class="op-dash-product">
            <span class="op-dash-pg">${esc(x.product_group || x.group || '')}</span>
            <span class="op-dash-pax muted">${esc(x.axis || '')} · ${esc(x.subsidiary || x.company || '')}</span>
          </div>`,
            )
            .join('')
        : '<span class="muted">추천 상품군 탭에서 그룹별 안내를 확인하세요.</span>';

      const planMini = planRows.length
        ? `<ul class="sfh-list op-dash-plan">${planRows.map(a => `<li>${a.week}주차 · ${esc(a.text)} · ${esc(a.status || '')}</li>`).join('')}</ul>`
        : '<p class="muted op-dash-plan-empty">30일 실행 플랜 탭에서 「실행 플랜 생성」으로 과제 목록을 만들 수 있습니다.</p>';

      const peerBlock = bp.peer_summary
        ? `<p class="op-dash-note">${esc(truncMsg(bp.peer_summary, 240))}</p>`
        : `<p class="op-dash-note muted">반경 내 동일 업종 <b>${mk.competitor_count != null ? esc(String(mk.competitor_count)) : '—'}</b>개 · 경쟁 강도 <b>${mk.competition_score != null ? esc(String(mk.competition_score)) : '—'}</b>점(참고). 상세는 주변 매장 벤치마킹 탭입니다.</p>`;

      const urgentHtml = urgent.length
        ? `<ol class="sfh-list op-urgent-ol">${urgent.map(u => `<li>${esc(u)}</li>`).join('')}</ol>`
        : '<p class="muted">시급 조치 항목이 없습니다.</p>';

      box.innerHTML = `
        <p class="tab-desc op-summary-lead">각 세부 탭과 동일한 분석 값을 한 화면에 모았습니다. (목업·추정 포함)</p>
        <div class="kpi-grid op-summary-kpis">
          <div class="kpi"><div class="kpi-label">최근 1개월 카드 매출</div><div class="kpi-value">${fmtMoney(sales.monthly_sales)}</div></div>
          <div class="kpi"><div class="kpi-label">상권 평균 대비</div><div class="kpi-value">${Math.round((sales.position_ratio || 0) * 100)}%</div></div>
          <div class="kpi"><div class="kpi-label">상위 20% 격차</div><div class="kpi-value">${fmtMoney(sales.top_gap)}</div></div>
          <div class="kpi"><div class="kpi-label">사용 가능 금액</div><div class="kpi-value">${fmtMoney(cad.available_cash)}</div></div>
          <div class="kpi"><div class="kpi-label">운영 안전자금</div><div class="kpi-value">${fmtMoney(cad.minimum_safety_cash)}</div></div>
          <div class="kpi"><div class="kpi-label">대출 상환 부담률</div><div class="kpi-value">${repBurdenPct}%</div></div>
        </div>

        <div class="info-box op-urgent-box">
          <div class="info-title">시급 조치·우선순위</div>
          <div class="info-body">${urgentHtml}</div>
        </div>

        <div class="op-dash-grid">
          <div class="op-dash-card">
            <div class="op-dash-head">매출·상권 비교</div>
            <div class="op-dash-row"><span class="op-dash-k">내 월 카드 매출</span><span class="op-dash-v">${fmtMoney(sales.monthly_sales)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">상권 평균 월매출</span><span class="op-dash-v">${fmtMoney(sales.market_average)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">상위 20% 매출</span><span class="op-dash-v">${fmtMoney(sales.top_20)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">상권 내 위치</span><span class="op-dash-v">${Math.round((sales.position_ratio || 0) * 100)}%</span></div>
            <div class="op-dash-row"><span class="op-dash-k">반경 내 동일 업종</span><span class="op-dash-v">${mk.competitor_count != null ? `${mk.competitor_count}곳` : '—'}</span></div>
            <p class="op-dash-note">${esc(truncMsg(sales.message || '', 140))}</p>
          </div>

          <div class="op-dash-card">
            <div class="op-dash-head">카드 지출 분석</div>
            <div class="op-dash-row"><span class="op-dash-k">월 카드 지출 합계</span><span class="op-dash-v">${fmtMoney(si.monthly_card_spending)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">매출 대비 지출</span><span class="op-dash-v">${ratioVsSales}%</span></div>
            <div class="op-dash-row"><span class="op-dash-k">매출 대비 원재료 추정</span><span class="op-dash-v">${matVsSales}%</span></div>
            <div class="op-dash-row"><span class="op-dash-k">증가 우려</span><span class="op-dash-v">${esc(si.risk || si.highest_category || '—')}</span></div>
            <p class="op-dash-note">${esc(truncMsg(si.diagnosis || si.message || '', 220))}</p>
          </div>

          <div class="op-dash-card">
            <div class="op-dash-head">은행 현금흐름</div>
            <div class="op-dash-row"><span class="op-dash-k">월 입금</span><span class="op-dash-v">${fmtMoney(cf.monthly_inflow)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">월 출금</span><span class="op-dash-v">${fmtMoney(cf.monthly_outflow)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">순현금흐름</span><span class="op-dash-v">${fmtMoney(cf.net_cash_flow)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">월중 최저 잔액</span><span class="op-dash-v">${fmtMoney(cf.lowest_balance)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">집중 리스크 일정</span><span class="op-dash-v">${esc((cf.risk_days || []).join(', ') || '—')}</span></div>
            <p class="op-dash-note">${esc(truncMsg(cf.message || '', 160))}</p>
          </div>

          <div class="op-dash-card">
            <div class="op-dash-head">대출·이자 점검</div>
            <div class="op-dash-row"><span class="op-dash-k">총 대출 잔액</span><span class="op-dash-v">${fmtMoney(li.total_loan_balance)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">평균 / 최고 금리</span><span class="op-dash-v">${esc(String(li.average_interest_rate ?? '—'))}% · ${esc(String(li.highest_interest_rate ?? '—'))}%</span></div>
            <div class="op-dash-row"><span class="op-dash-k">월 원리금 상환</span><span class="op-dash-v">${fmtMoney(li.monthly_repayment)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">매출 대비 이자 부담</span><span class="op-dash-v">${intBurdenPct}%</span></div>
            <div class="op-dash-row"><span class="op-dash-k">매출 대비 상환 부담</span><span class="op-dash-v">${repBurdenPct}%</span></div>
            <div class="op-dash-row"><span class="op-dash-k">대환 검토</span><span class="op-dash-v">${li.refinance_candidate ? '가능성 확인 권장' : '유지 점검'}</span></div>
            <p class="op-dash-note">${esc(truncMsg(li.message || '', 260))}</p>
          </div>

          <div class="op-dash-card">
            <div class="op-dash-head">보험 보장 점검</div>
            <div class="op-dash-row"><span class="op-dash-k">월 보험료(신한)</span><span class="op-dash-v">${ins.monthly_premium != null ? fmtMoney(ins.monthly_premium) : '—'}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">보장 공백 항목</span><span class="op-dash-v">${gaps.length}건</span></div>
            <div class="op-dash-full"><span class="op-dash-k">공백 요약</span><div class="op-dash-gapline">${gapStr}</div></div>
            <p class="op-dash-note">${esc(truncMsg(ins.message || '', 160))}</p>
          </div>

          <div class="op-dash-card">
            <div class="op-dash-head">사용 가능 금액·예치 구조</div>
            <div class="op-dash-row"><span class="op-dash-k">현재 예치금</span><span class="op-dash-v">${fmtMoney(cad.current_balance)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">세금 예비금</span><span class="op-dash-v">${fmtMoney(cad.tax_reserved)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">운영 안전자금</span><span class="op-dash-v">${fmtMoney(cad.minimum_safety_cash)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">사용 가능 금액</span><span class="op-dash-v">${fmtMoney(cad.available_cash)}</span></div>
            <div class="op-dash-row"><span class="op-dash-k">월 필수 현금(추정)</span><span class="op-dash-v">${fmtMoney(cad.monthly_required_cash)}</span></div>
            <p class="op-dash-note">${esc(truncMsg(cad.message || '', 180))}</p>
          </div>

          <div class="op-dash-card op-dash-card-wide">
            <div class="op-dash-head">추천 상품군 <span class="muted" style="font-weight:600">(신한금융그룹 연계 축)</span></div>
            <div class="op-dash-products">${productMini}</div>
          </div>

          <div class="op-dash-card">
            <div class="op-dash-head">주변 매장 벤치마킹</div>
            ${peerBlock}
          </div>

          <div class="op-dash-card">
            <div class="op-dash-head">30일 실행 플랜</div>
            ${planMini}
          </div>
        </div>

        <div class="op-summary-split" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">
          <div class="info-box"><div class="info-title">좋은 점</div><div class="info-body"><ul class="sfh-list">${good || '<li>-</li>'}</ul></div></div>
          <div class="info-box"><div class="info-title">점검할 점</div><div class="info-body"><ul class="sfh-list">${bad || '<li>-</li>'}</ul></div></div>
        </div>
        <div class="info-box" style="margin-top:12px"><div class="info-title">한 줄 진단</div><div class="info-body">${esc(d.summary || '')}</div></div>
      `;
    } else if (tab === 'sales') {
      const p = d.integrated_profile || {};
      const salesP = p.card_sales_profile || {};
      const market = p.external_market_profile || {};
      const sales = d.sales_insight || {};
      const ticketIdx = (salesP.average_ticket || 0) / Math.max(1, market.average_ticket || 0);
      const customerIdx = (salesP.daily_average_approval_count || 0) / Math.max(1, market.average_daily_customers || 0);
      box.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">내 월 카드 매출</div><div class="kpi-value">${fmtMoney(sales.monthly_sales)}</div></div>
          <div class="kpi"><div class="kpi-label">상권 평균 월매출</div><div class="kpi-value">${fmtMoney(sales.market_average)}</div></div>
          <div class="kpi"><div class="kpi-label">상위 20% 매출</div><div class="kpi-value">${fmtMoney(sales.top_20)}</div></div>
          <div class="kpi"><div class="kpi-label">상위 매장 격차</div><div class="kpi-value">${fmtMoney(sales.top_gap)}</div></div>
        </div>
        <div class="op-chart-grid">
          <div class="fin-chart-card">
            <div class="fin-chart-h">매출 위치 비교</div>
            <div class="fin-chart-canvas"><canvas id="op-sales-bar"></canvas></div>
          </div>
          <div class="fin-chart-card">
            <div class="fin-chart-h">최근 6개월 매출 추세</div>
            <div class="fin-chart-canvas"><canvas id="op-sales-trend"></canvas></div>
          </div>
          <div class="fin-chart-card">
            <div class="fin-chart-h">객단가 vs 승인건수 경쟁력</div>
            <div class="fin-chart-canvas"><canvas id="op-sales-index"></canvas></div>
            <div class="muted">객단가 지수 ${ticketIdx.toFixed(2)} / 승인건수 지수 ${customerIdx.toFixed(2)}</div>
          </div>
          <div class="fin-chart-card">
            <div class="fin-chart-h">시간대 매출 비중</div>
            <div class="fin-chart-canvas"><canvas id="op-time-ratio"></canvas></div>
          </div>
        </div>
        <div class="info-box" style="margin-top:12px">
          <div class="info-title">해석</div>
          <div class="info-body">${esc(sales.message || '')}<br>객단가보다 승인 건수 지수(${customerIdx.toFixed(2)})가 낮아 신규 고객 유입 개선을 우선 권장합니다.</div>
        </div>
        <div class="info-box" style="margin-top:10px">
          <div class="info-title">경쟁 강도</div>
          <div class="info-body">반경 내 동일 업종 ${market.competitor_count || 0}개 · 최근 6개월 신규 ${market.new_openings_6m || 0}개 · 폐업 ${market.closures_6m || 0}개 · 경쟁 강도 ${market.competition_score || 0}점</div>
        </div>
      `;
      drawSalesTabCharts(d);
    } else if (tab === 'spending') {
      const si = d.spending_insight || {};
      const p = d.integrated_profile || {};
      const sp = p.card_spending_profile || {};
      const ratioPct = si.spending_ratio_vs_sales != null ? (Number(si.spending_ratio_vs_sales) * 100).toFixed(1) : '';
      const matPct = si.materials_ratio_vs_sales != null ? (Number(si.materials_ratio_vs_sales) * 100).toFixed(1) : '';
      box.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">월 카드 지출 합계</div><div class="kpi-value">${fmtMoney(si.monthly_card_spending)}</div></div>
          <div class="kpi"><div class="kpi-label">매출 대비 카드 지출</div><div class="kpi-value">${ratioPct}%</div></div>
          <div class="kpi"><div class="kpi-label">매출 대비 원재료 추정</div><div class="kpi-value">${matPct}%</div></div>
          <div class="kpi"><div class="kpi-label">사업자카드</div><div class="kpi-value">${fmtMoney(sp.business_card_spending)}</div></div>
          <div class="kpi"><div class="kpi-label">법인카드</div><div class="kpi-value">${fmtMoney(sp.corporate_card_spending)}</div></div>
          <div class="kpi"><div class="kpi-label">개인·사업 혼재 리스크</div><div class="kpi-value">${esc(sp.personal_business_mixed_risk || '-')}</div></div>
        </div>
        <div class="op-chart-grid">
          <div class="fin-chart-card">
            <div class="fin-chart-h">지출 카테고리 비중</div>
            <div class="fin-chart-canvas"><canvas id="op-spend-pie"></canvas></div>
          </div>
          <div class="fin-chart-card">
            <div class="fin-chart-h">전월 대비 증가율 (%)</div>
            <div class="fin-chart-canvas"><canvas id="op-spend-mom"></canvas></div>
          </div>
          <div class="fin-chart-card">
            <div class="fin-chart-h">사업자카드 vs 법인카드</div>
            <div class="fin-chart-canvas"><canvas id="op-spend-split"></canvas></div>
          </div>
          <div class="fin-chart-card">
            <div class="fin-chart-h">최근 3개월 카드 지출 추이</div>
            <div class="fin-chart-canvas"><canvas id="op-spend-trend"></canvas></div>
          </div>
        </div>
        <div class="info-box" style="margin-top:12px"><div class="info-title">진단 요약</div><div class="info-body">${esc(si.diagnosis || si.message || '')}</div></div>
      `;
      drawSpendingTabCharts(d);
    } else if (tab === 'cashflow') {
      const cf = d.cashflow_insight || {};
      box.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">월 입금</div><div class="kpi-value">${fmtMoney(cf.monthly_inflow)}</div></div>
          <div class="kpi"><div class="kpi-label">월 출금</div><div class="kpi-value">${fmtMoney(cf.monthly_outflow)}</div></div>
          <div class="kpi"><div class="kpi-label">순현금흐름</div><div class="kpi-value">${fmtMoney(cf.net_cash_flow)}</div></div>
          <div class="kpi"><div class="kpi-label">월중 최저 잔액</div><div class="kpi-value">${fmtMoney(cf.lowest_balance)}</div></div>
          <div class="kpi"><div class="kpi-label">집중 리스크 일정</div><div class="kpi-value">${esc((cf.risk_days || []).join(', '))}</div></div>
        </div>
        <div class="op-chart-grid">
          <div class="fin-chart-card">
            <div class="fin-chart-h">월중 잔액 추이(모델링)</div>
            <div class="fin-chart-canvas"><canvas id="op-cf-balance"></canvas></div>
          </div>
          <div class="fin-chart-card">
            <div class="fin-chart-h">최근 6개월 입금 vs 출금</div>
            <div class="fin-chart-canvas"><canvas id="op-cf-inout"></canvas></div>
          </div>
          <div class="fin-chart-card op-chart-span-2">
            <div class="fin-chart-h">예정 반복 출금(이번 달)</div>
            <div class="fin-chart-canvas fin-chart-canvas-tall"><canvas id="op-cf-schedule"></canvas></div>
          </div>
        </div>
        <div class="info-box" style="margin-top:12px"><div class="info-title">해석</div><div class="info-body">${esc(cf.message || '')}</div></div>
        ${opCashflowShinhanHtml(d)}
      `;
      drawCashflowTabCharts(d);
    } else if (tab === 'loan') {
      const li = d.loan_insight || {};
      const scenarios = d.loan_scenarios || [];
      box.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">총 대출 잔액</div><div class="kpi-value">${fmtMoney(li.total_loan_balance)}</div></div>
          <div class="kpi"><div class="kpi-label">평균 금리 / 최고 금리</div><div class="kpi-value">${li.average_interest_rate}% · ${li.highest_interest_rate}%</div></div>
          <div class="kpi"><div class="kpi-label">월 원리금 상환</div><div class="kpi-value">${fmtMoney(li.monthly_repayment)}</div></div>
          <div class="kpi"><div class="kpi-label">매출 대비 상환 부담</div><div class="kpi-value">${Math.round((li.repayment_burden_ratio || 0) * 1000) / 10}%</div></div>
          <div class="kpi"><div class="kpi-label">추정 이자부담률(월)</div><div class="kpi-value">${Math.round((li.interest_burden_ratio || 0) * 1000) / 10}%</div></div>
          <div class="kpi"><div class="kpi-label">대환 검토</div><div class="kpi-value">${li.refinance_candidate ? '가능성 확인 권장' : '유지 점검'}</div></div>
        </div>
        <div class="op-chart-grid">
          <div class="fin-chart-card op-chart-span-2">
            <div class="fin-chart-h">시나리오별 월 이자·월 상환액(추정)</div>
            <div class="fin-chart-canvas fin-chart-canvas-tall"><canvas id="op-loan-scen"></canvas></div>
          </div>
        </div>
        <div class="info-box" style="margin-top:12px"><div class="info-title">해석</div><div class="info-body">${esc(li.message || '')}<br><span class="muted">실제 대출 가능 여부, 한도, 금리는 금융심사 결과에 따라 달라질 수 있습니다.</span></div></div>
        ${opLoanShinhanHtml(d)}
        ${scenarios.length ? `<details class="muted" style="margin-top:8px"><summary>시나리오 수치 펼치기</summary><ul>${scenarios.map(s => `<li>${esc(s.name)} · 이자 ${fmtMoney(s.monthly_interest)} · 상환 ${fmtMoney(s.monthly_repayment)} · 잔액 ${fmtMoney(s.loan_balance)}</li>`).join('')}</ul></details>` : ''}
      `;
      drawLoanTabCharts(d);
    } else if (tab === 'insurance') {
      const ins = d.insurance_insight || {};
      const rows = ins.coverage_rows || [];
      box.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">월 보험료(신한)</div><div class="kpi-value">${fmtMoney(ins.monthly_premium)}</div></div>
          <div class="kpi"><div class="kpi-label">보장 공백 항목</div><div class="kpi-value">${(ins.gaps || []).length}개</div></div>
        </div>
        <div class="op-chart-grid">
          <div class="fin-chart-card op-chart-span-2">
            <div class="fin-chart-h">가입 여부 한눈에 보기</div>
            <div class="fin-chart-canvas fin-chart-canvas-tall"><canvas id="op-ins-cov"></canvas></div>
          </div>
        </div>
        <div class="info-box" style="margin-top:12px"><div class="info-title">해석</div><div class="info-body">${esc(ins.message || '')}<br><span class="muted">보험 추천은 보장 공백 진단이며, 실제 가입 가능 여부와 보험료는 상품 조건 및 심사 결과에 따라 달라질 수 있습니다.</span></div></div>
        ${opInsuranceShinhanHtml(d)}
      `;
      drawInsuranceTabCharts(d);
    } else if (tab === 'cash') {
      const p = d.integrated_profile || {};
      const bank = p.bank_account_profile || {};
      const ins = p.insurance_profile || {};
      const loan = p.loan_profile || {};
      const cash = d.cash_advice || {};
      const rent = 2800000;
      const labor = 4200000;
      const utilities = 620000;
      const loanRepay = loan.monthly_repayment || 0;
      const insurance = ins.monthly_premium || 0;
      const required = cash.monthly_required_cash || (rent + labor + utilities + loanRepay + insurance);
      box.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">현재 예치금</div><div class="kpi-value">${fmtMoney(d.cash_advice?.current_balance)}</div></div>
          <div class="kpi"><div class="kpi-label">다음 30일 예정 지출</div><div class="kpi-value">${fmtMoney(bank.scheduled_outflow_next_30d)}</div></div>
          <div class="kpi"><div class="kpi-label">반드시 남길 금액</div><div class="kpi-value">${fmtMoney(d.cash_advice?.minimum_safety_cash)}</div></div>
          <div class="kpi"><div class="kpi-label">세금 예비금</div><div class="kpi-value">${fmtMoney(d.cash_advice?.tax_reserved)}</div></div>
          <div class="kpi"><div class="kpi-label">사용 가능 금액</div><div class="kpi-value">${fmtMoney(d.cash_advice?.available_cash)}</div></div>
        </div>
        <div class="op-chart-grid op-chart-grid-single" style="margin-top:10px">
          <div class="fin-chart-card">
            <div class="fin-chart-h">예치금 배분(예약금/안전자금/사용가능)</div>
            <div class="fin-chart-canvas"><canvas id="op-cash-alloc"></canvas></div>
          </div>
        </div>
        <div class="info-box" style="margin-top:12px">
          <div class="info-title">AI 자금 코치</div>
          <div class="info-body">${esc(d.cash_advice?.message || '')}<br>월 필수 지출 추정: ${fmtMoney(required)} (임대료·인건비·공과금·대출상환·보험료 포함)</div>
        </div>
        ${opCashAvailableShinhanHtml(d)}
        <div class="op-cash-checker">
          <div class="fin-chart-h">이 돈 써도 되나요?</div>
          <div class="form-grid">
            <div class="form-item"><label>사용 목적</label>
              <select id="op-use-purpose">
                <option>마케팅 광고비</option><option>인테리어/시설 교체</option><option>원재료/재고 매입</option>
                <option>대출 일부 상환</option><option>직원 채용</option><option>비상금 유지</option><option>기타</option>
              </select>
            </div>
            <div class="form-item"><label>사용 금액(원)</label><input type="number" id="op-use-amount" placeholder="예: 8000000"></div>
          </div>
          <button class="btn btn-primary btn-sm" id="op-btn-cash-check">사용 가능 여부 확인</button>
          <div id="op-cash-check-result" class="muted" style="margin-top:8px"></div>
        </div>
      `;
      drawCashTabChart(d);
      document.getElementById('op-btn-cash-check')?.addEventListener('click', runCashCheck);
    } else if (tab === 'products') {
      const items = d.recommended_product_groups || [];
      const kindClass = {
        bank: 'shfg-kind-bank',
        card: 'shfg-kind-card',
        life: 'shfg-kind-life',
        ez: 'shfg-kind-ez',
        invest: 'shfg-kind-inv',
      };
      box.innerHTML = `
        <div class="shfg-products-intro info-box">
          <div class="info-title">신한금융그룹 연계 추천</div>
          <div class="info-body muted">
            아래 카드는 <strong>신한은행·신한카드·신한라이프·신한EZ손해보험·신한투자증권</strong> 등 그룹 계열 채널과,
            이번에 불러온 매출·계좌·카드 지출·보험 데이터를 어떻게 연결할지 정리한 것입니다.
            특정 상품 판매가 아니라, <strong>부족 영역별 점검 경로</strong>입니다.
          </div>
        </div>
        <div class="shfg-product-list">
          ${items
            .map(x => {
              const k = kindClass[x.subsidiary_kind] || '';
              const title = x.product_group || x.group || '';
              const sub = x.subsidiary || x.company || '';
              const cta = x.cta_action
                ? `<button type="button" class="btn btn-secondary btn-sm spr-cta shfg-cta" data-cta-action="${esc(x.cta_action)}">안내·체크리스트</button>`
                : '';
              return `
            <div class="shfg-product-card ${k}">
              <div class="shfg-card-head">
                <span class="shfg-priority">${esc(x.priority)}</span>
                <span class="shfg-axis">${esc(x.axis || '')}</span>
              </div>
              <div class="shfg-subsidiary-badge">${esc(sub)}</div>
              <h4 class="shfg-title">${esc(title)}</h4>
              <div class="shfg-linked"><span class="shfg-linked-label">진단 데이터 연계</span> ${esc(x.linked_diagnosis || '')}</div>
              <p class="shfg-reason">${esc(x.reason || '')}</p>
              <p class="shfg-caution muted">${esc(x.caution || '')}</p>
              ${x.official_channel ? `<div class="shfg-channel">${esc(x.official_channel)}</div>` : ''}
              ${cta}
            </div>`;
            })
            .join('')}
        </div>`;
    } else if (tab === 'benchmark') {
      const p = d.integrated_profile || {};
      const mk = p.external_market_profile || {};
      const sp = p.store_profile || {};
      const bpApi = d.benchmark_pack || {};
      const industry = sp.industry || '동일 업종';
      const rng = bpApi.comparison_range || document.getElementById('op-compare-range')?.value || '500m';
      const maPb = sp.market_area || '주변 상권';
      const fallbackVisit = [
        `반경 ${rng} 부근 ${industry} 매장 중 리뷰·재방문 언급이 많은 곳`,
        `${maPb} 일대에서 시간대 매출 패턴이 다른 매장`,
        '포장·테이크아웃 동선과 가격표시가 명확한 근처 매장',
      ];
      const fallbackCheck = [
        '대표 메뉴 가격·원가·마진',
        '오후(14~17시) 프로모션·세트 구성',
        '포장 할인·적립·재방문 조건',
        '배달앱 노출·대표 사진·리뷰 키워드',
        '피크 시간 대기·결제 방식·직원 구성',
      ];
      const fallbackIdeas = [
        '오후 한정 세트 또는 번들 메뉴 2주 시범',
        '포장 고객 소액 쿠폰 A/B 테스트',
        '원재료 단가 높은 메뉴 판매 비중 조정',
      ];
      const visitSrc = bpApi.visit_store_types?.length ? bpApi.visit_store_types : fallbackVisit;
      const checkSrc = bpApi.checklist?.length ? bpApi.checklist : fallbackCheck;
      const ideasSrc = bpApi.apply_ideas?.length ? bpApi.apply_ideas : fallbackIdeas;
      const types = visitSrc.map(t => `<li>${esc(t)}</li>`).join('');
      const chk = checkSrc.map(t => `<li>${esc(t)}</li>`).join('');
      const ideas = ideasSrc.map(t => `<li>${esc(t)}</li>`).join('');
      const peerLine = bpApi.peer_summary || '';
      box.innerHTML = `
        <p class="tab-desc" style="margin-bottom:12px">선택한 비교 반경·상권 데이터를 바탕으로 방문 우선순위와 현장에서 볼 포인트를 정리했습니다.</p>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">비교 반경</div><div class="kpi-value">${esc(rng)}</div></div>
          <div class="kpi"><div class="kpi-label">상권</div><div class="kpi-value">${esc(bpApi.market_area_label || sp.market_area || '-')}</div></div>
          <div class="kpi"><div class="kpi-label">반경 내 동일 업종(목업)</div><div class="kpi-value">${mk.competitor_count != null ? `${mk.competitor_count}곳` : '-'}</div></div>
          <div class="kpi"><div class="kpi-label">경쟁 강도(참고)</div><div class="kpi-value">${mk.competition_score != null ? `${mk.competition_score}점` : '-'}</div></div>
        </div>
        ${peerLine ? `<div class="info-box" style="margin-top:10px"><div class="info-title">주변 매장 밀도 요약</div><div class="info-body">${esc(peerLine)}</div></div>` : ''}
        <div class="info-box" style="margin-top:10px">
          <div class="info-title">이번 주 방문 추천 유형</div>
          <div class="info-body"><ul class="sfh-list">${types}</ul></div>
        </div>
        <div class="info-box" style="margin-top:10px">
          <div class="info-title">방문 시 체크리스트</div>
          <div class="info-body"><ul class="sfh-list">${chk}</ul></div>
        </div>
        <div class="info-box" style="margin-top:10px">
          <div class="info-title">우리 매장에 적용해 볼 아이디어</div>
          <div class="info-body"><ul class="sfh-list">${ideas}</ul></div>
        </div>
        <p class="muted" style="margin-top:12px;line-height:1.5">${esc(bpApi.notes || '')}</p>
      `;
    } else if (tab === 'plan') {
      const rows = (OpState.actionPlan || []).map(a => `<li>${a.week}주차 · ${esc(a.text)} · <b>${esc(a.status)}</b></li>`).join('');
      const flash = OpState.planFlashMessage ? `<p class="muted op-plan-flash" role="status">${esc(OpState.planFlashMessage)}</p>` : '';
      OpState.planFlashMessage = '';
      const sales = d.sales_insight || {};
      const cf = d.cashflow_insight || {};
      const li = d.loan_insight || {};
      const ins = d.insurance_insight || {};
      const cad = d.cash_advice || {};
      const meta = OpState.actionPlanMeta || {};
      const added = meta.addedActions || [];
      const removed = meta.removedActions || [];
      const intBurdenPct = Math.round((li.interest_burden_ratio || 0) * 1000) / 10;
      const repBurdenPct = Math.round((li.repayment_burden_ratio || 0) * 1000) / 10;
      const reasonLines = [
        `매출/상권: 최근 1개월 ${fmtMoney(sales.monthly_sales)} · 상권 평균 대비 ${Math.round((sales.position_ratio || 0) * 100)}%`,
        `현금흐름: 월 입금 ${fmtMoney(cf.monthly_inflow)} · 출금 ${fmtMoney(cf.monthly_outflow)} · 순현금 ${fmtMoney(cf.net_cash_flow)}`,
        `대출부담: 월 상환 ${fmtMoney(li.monthly_repayment)} · 이자부담률 ${intBurdenPct}% · 상환부담률 ${repBurdenPct}%`,
        `보험공백: ${(ins.gaps || []).length}건 · ${(ins.gaps || []).join(' · ') || '특이 공백 없음(목업)'}`,
        `가용현금: 사용 가능 ${fmtMoney(cad.available_cash)} / 최소 안전자금 ${fmtMoney(cad.minimum_safety_cash)}`,
      ];
      const whyHtml = reasonLines.map(x => `<li>${esc(x)}</li>`).join('');
      const changeHtml = `
        <ul class="sfh-list">
          <li>생성 시각: <b>${esc(meta.generatedAt || '-')}</b></li>
          <li>초점: <b>${esc(meta.focus || '현금흐름 개선')}</b></li>
          <li>과제 수: 이전 <b>${meta.previousCount != null ? esc(String(meta.previousCount)) : '0'}</b>개 → 현재 <b>${meta.currentCount != null ? esc(String(meta.currentCount)) : '0'}</b>개</li>
          ${added.length ? `<li>신규 추가: ${added.map(x => esc(x)).join(' / ')}</li>` : '<li>신규 추가 과제 없음</li>'}
          ${removed.length ? `<li>제외된 항목: ${removed.map(x => esc(x)).join(' / ')}</li>` : ''}
        </ul>`;
      box.innerHTML = `
        ${flash}
        <div class="info-box">
          <div class="info-title">실행 플랜 생성 리포트</div>
          <div class="info-body">
            현재 진단값을 기준으로 30일 과제를 자동 생성했습니다. 아래는 "왜 이 과제가 나왔는지"에 대한 근거입니다.
            <ul class="sfh-list">${whyHtml}</ul>
          </div>
        </div>
        <div class="info-box" style="margin-top:10px">
          <div class="info-title">이번 생성에서 달라진 점</div>
          <div class="info-body">${changeHtml}</div>
        </div>
        <div class="info-box"><div class="info-title">30일 실행 플랜</div><div class="info-body"><ul>${rows || '<li>생성 버튼을 눌러주세요.</li>'}</ul></div></div>
        <p id="op-plan-status" class="muted op-plan-status-line" aria-live="polite"></p>
        <button type="button" class="btn btn-primary btn-sm" id="op-btn-build-plan">실행 플랜 생성</button>`;
      document.getElementById('op-btn-build-plan')?.addEventListener('click', buildActionPlan);
    }
  }

  function drawSalesTabCharts(d) {
    if (typeof Chart === 'undefined') return;
    const p = d.integrated_profile || {};
    const salesP = p.card_sales_profile || {};
    const market = p.external_market_profile || {};
    const sales = d.sales_insight || {};

    const cvBar = document.getElementById('op-sales-bar');
    if (cvBar) {
      OpState.charts.salesBar = new Chart(cvBar, {
        type: 'bar',
        data: {
          labels: ['내 매장', '상권 평균', '상위 20%'],
          datasets: [{ data: [sales.monthly_sales || 0, sales.market_average || 0, sales.top_20 || 0], backgroundColor: ['#2563eb', '#64748b', '#16a34a'] }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
      });
    }

    const cvTrend = document.getElementById('op-sales-trend');
    if (cvTrend) {
      const arr = salesP.sales_last_6_months || [];
      OpState.charts.salesTrend = new Chart(cvTrend, {
        type: 'line',
        data: { labels: arr.map((_, i) => `${i + 1}개월전`), datasets: [{ data: arr, borderColor: '#0ea5e9', backgroundColor: '#0ea5e922', fill: true, tension: 0.25 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
      });
    }

    const cvIdx = document.getElementById('op-sales-index');
    if (cvIdx) {
      const ticketIdx = (salesP.average_ticket || 0) / Math.max(1, market.average_ticket || 0);
      const customerIdx = (salesP.daily_average_approval_count || 0) / Math.max(1, market.average_daily_customers || 0);
      OpState.charts.salesIndex = new Chart(cvIdx, {
        type: 'bar',
        data: {
          labels: ['객단가 지수', '승인건수 지수'],
          datasets: [{ data: [ticketIdx, customerIdx], backgroundColor: ['#8b5cf6', '#f97316'] }],
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { suggestedMax: 1.4 } }, plugins: { legend: { display: false } } },
      });
    }

    const cvTime = document.getElementById('op-time-ratio');
    if (cvTime) {
      const t = salesP.time_sales_ratio || {};
      OpState.charts.timeRatio = new Chart(cvTime, {
        type: 'doughnut',
        data: {
          labels: ['오전', '점심', '오후', '저녁', '야간'],
          datasets: [{ data: [t.morning || 0, t.lunch || 0, t.afternoon || 0, t.evening || 0, t.night || 0], backgroundColor: ['#38bdf8', '#22c55e', '#f59e0b', '#6366f1', '#94a3b8'] }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }
  }

  function drawCashTabChart(d) {
    if (typeof Chart === 'undefined') return;
    const cv = document.getElementById('op-cash-alloc');
    if (!cv) return;
    const cash = d.cash_advice || {};
    const total = Number(cash.current_balance || 0);
    const tax = Number(cash.tax_reserved || 0);
    const safety = Number(cash.minimum_safety_cash || 0);
    const available = Number(cash.available_cash || 0);
    const reserve = Math.max(0, total - tax - safety - available);
    OpState.charts.cashAlloc = new Chart(cv, {
      type: 'bar',
      data: {
        labels: ['예치금 배분'],
        datasets: [
          { label: '운영예약금', data: [reserve], backgroundColor: '#64748b', stack: 'x' },
          { label: '세금예비금', data: [tax], backgroundColor: '#f59e0b', stack: 'x' },
          { label: '운영안전자금', data: [safety], backgroundColor: '#334155', stack: 'x' },
          { label: '사용가능액', data: [available], backgroundColor: '#16a34a', stack: 'x' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        scales: { x: { stacked: true }, y: { stacked: true } },
      },
    });
  }

  const SPEND_COLORS = ['#ea580c', '#2563eb', '#7c3aed', '#0891b2', '#ca8a04', '#475569', '#94a3b8'];

  function drawSpendingTabCharts(d) {
    if (typeof Chart === 'undefined') return;
    const p = d.integrated_profile || {};
    const sp = p.card_spending_profile || {};
    const cats = sp.spending_by_category || {};
    const labelsKo = sp.category_labels_ko || {};
    const mom = sp.mom_change_pct || {};
    const keys = Object.keys(cats);
    const labels = keys.map(k => labelsKo[k] || k);
    const values = keys.map(k => cats[k]);

    const pie = document.getElementById('op-spend-pie');
    if (pie && values.length) {
      OpState.charts.spendPie = new Chart(pie, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data: values, backgroundColor: SPEND_COLORS }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    const momCv = document.getElementById('op-spend-mom');
    if (momCv && keys.length) {
      const momVals = keys.map(k => Number(mom[k] || 0));
      OpState.charts.spendMom = new Chart(momCv, {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: '전월 대비(%)', data: momVals, backgroundColor: '#0ea5e9' }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { ticks: { callback: v => `${v}%` } } },
          plugins: { legend: { display: false } },
        },
      });
    }

    const split = document.getElementById('op-spend-split');
    if (split) {
      OpState.charts.spendSplit = new Chart(split, {
        type: 'pie',
        data: {
          labels: ['사업자카드', '법인카드'],
          datasets: [{
            data: [Number(sp.business_card_spending || 0), Number(sp.corporate_card_spending || 0)],
            backgroundColor: ['#22c55e', '#6366f1'],
          }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }

    const tr = document.getElementById('op-spend-trend');
    const arr = sp.total_spending_last_3_months || [];
    if (tr && arr.length) {
      const lbl =
        arr.length === 3
          ? ['2개월 전', '전월', '당월']
          : arr.map((_, i) => `${i + 1}번째 월`);
      OpState.charts.spendTrend = new Chart(tr, {
        type: 'line',
        data: {
          labels: lbl,
          datasets: [{ label: '월 카드 지출', data: arr, borderColor: '#f97316', backgroundColor: '#ffedd5', fill: true, tension: 0.2 }],
        },
        options: { responsive: true, maintainAspectRatio: false },
      });
    }
  }

  function drawCashflowTabCharts(d) {
    if (typeof Chart === 'undefined') return;
    const cf = d.cashflow_insight || {};
    const curve = cf.daily_balance_curve || [];
    const six = cf.monthly_in_out_6m || [];
    const p = d.integrated_profile || {};
    const bank = p.bank_account_profile || {};
    const recurring = bank.recurring_payments || [];

    const balCv = document.getElementById('op-cf-balance');
    if (balCv && curve.length) {
      OpState.charts.cfBal = new Chart(balCv, {
        type: 'line',
        data: {
          labels: curve.map(x => `${x.day}일`),
          datasets: [{ label: '잔액(원)', data: curve.map(x => x.balance), borderColor: '#0284c7', backgroundColor: '#bae6fd44', fill: true, tension: 0.25 }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
      });
    }

    const inout = document.getElementById('op-cf-inout');
    if (inout && six.length) {
      OpState.charts.cfInOut = new Chart(inout, {
        type: 'bar',
        data: {
          labels: six.map(x => x.label),
          datasets: [
            { label: '입금', data: six.map(x => x.inflow), backgroundColor: '#22c55e' },
            { label: '출금', data: six.map(x => x.outflow), backgroundColor: '#ef4444' },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false },
      });
    }

    const sch = document.getElementById('op-cf-schedule');
    if (sch && recurring.length) {
      OpState.charts.cfSch = new Chart(sch, {
        type: 'bar',
        data: {
          labels: recurring.map(x => `${x.day}일 ${x.name}`),
          datasets: [{ label: '금액', data: recurring.map(x => x.amount), backgroundColor: '#64748b' }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: { legend: { display: false } },
        },
      });
    }
  }

  function drawLoanTabCharts(d) {
    if (typeof Chart === 'undefined') return;
    const scenarios = d.loan_scenarios || [];
    const cv = document.getElementById('op-loan-scen');
    if (!cv || !scenarios.length) return;
    OpState.charts.loanScen = new Chart(cv, {
      type: 'bar',
      data: {
        labels: scenarios.map(s => s.name),
        datasets: [
          { label: '월 이자(추정)', data: scenarios.map(s => s.monthly_interest), backgroundColor: '#f59e0b' },
          { label: '월 상환액(추정)', data: scenarios.map(s => s.monthly_repayment), backgroundColor: '#334155' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { stacked: false } },
      },
    });
  }

  function drawInsuranceTabCharts(d) {
    if (typeof Chart === 'undefined') return;
    const rows = (d.insurance_insight || {}).coverage_rows || [];
    const cv = document.getElementById('op-ins-cov');
    if (!cv || !rows.length) return;
    OpState.charts.insCov = new Chart(cv, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.label),
        datasets: [{
          label: '가입(1)·미가입(0)',
          data: rows.map(r => (r.ok ? 1 : 0)),
          backgroundColor: rows.map(r => (r.ok ? '#16a34a' : '#dc2626')),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        scales: { x: { max: 1, ticks: { stepSize: 1 } } },
        plugins: { legend: { display: false } },
      },
    });
  }

  async function runCashCheck() {
    if (!OpState.storeId) return;
    const amt = Number(document.getElementById('op-use-amount')?.value || 0);
    const purpose = document.getElementById('op-use-purpose')?.value || '기타';
    const out = document.getElementById('op-cash-check-result');
    if (!out) return;
    if (amt <= 0) {
      out.textContent = '사용 금액을 입력해 주세요.';
      return;
    }
    out.textContent = '계산 중...';
    try {
      const r = await window.fetchJson(`/api/shinhan/business/${OpState.storeId}/cash-advice`, {
        method: 'POST',
        body: JSON.stringify({ planned_use_amount: amt, planned_use_purpose: purpose }),
      });
      out.innerHTML = `<b>${esc(r.decision || '')}</b> · ${esc(r.message || '')}${r.alternative ? `<br><span class="muted">${esc(r.alternative)}</span>` : ''}`;
    } catch (e) {
      out.textContent = '사용 가능 여부 계산에 실패했습니다.';
    }
  }

  async function buildActionPlan() {
    const statusEl = () => document.getElementById('op-plan-status');
    const btn = () => document.getElementById('op-btn-build-plan');

    const setBusy = (busy) => {
      const b = btn();
      if (b) {
        b.disabled = !!busy;
        b.textContent = busy ? '생성 중…' : '실행 플랜 생성';
      }
    };

    const showStatus = (msg) => {
      const el = statusEl();
      if (el) el.textContent = msg || '';
    };

    if (typeof window.fetchJson !== 'function') {
      showStatus('페이지 도구 로드 오류입니다. 새로고침 후 다시 시도해 주세요.');
      return;
    }
    if (!OpState.storeId) {
      showStatus('사업장이 선택되지 않았습니다. 연결 단계에서 매장을 고른 뒤 진단을 실행해 주세요.');
      return;
    }

    setBusy(true);
    showStatus('서버에 요청 중입니다…');
    try {
      const prevPlan = Array.isArray(OpState.actionPlan) ? OpState.actionPlan : [];
      const prevSet = new Set(prevPlan.map(actionKey));
      const sid = encodeURIComponent(OpState.storeId);
      const res = await window.fetchJson(`/api/shinhan/business/${sid}/action-plan`, {
        method: 'POST',
        body: JSON.stringify({ focus: '현금흐름 개선' }),
      });
      const nextPlan = Array.isArray(res.actions) ? res.actions : [];
      const nextSet = new Set(nextPlan.map(actionKey));
      const addedActions = nextPlan
        .filter(x => !prevSet.has(actionKey(x)))
        .map(x => `${x.week}주차 ${x.text}`);
      const removedActions = prevPlan
        .filter(x => !nextSet.has(actionKey(x)))
        .map(x => `${x.week}주차 ${x.text}`);
      OpState.actionPlan = nextPlan;
      const t = new Date();
      const stamp = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
      OpState.actionPlanMeta = {
        generatedAt: stamp,
        focus: '현금흐름 개선',
        previousCount: prevPlan.length,
        currentCount: nextPlan.length,
        addedActions,
        removedActions,
      };
      OpState.planFlashMessage = `실행 플랜을 불러왔습니다 (${stamp}). 위 목록이 최신입니다.`;
      renderOpTab('plan');
    } catch (e) {
      const msg = e && e.message ? String(e.message) : String(e);
      showStatus(`플랜 생성에 실패했습니다: ${msg}`);
      setBusy(false);
    }
  }

  async function saveReport() {
    if (!OpState.storeId) return;
    const r = await window.fetchJson(`/api/shinhan/business/${OpState.storeId}/report/save`, { method: 'POST' });
    alert(`리포트를 저장했습니다. (누적 ${r.saved_count || 1}건)`);
  }

  function bindTabs() {
    document.querySelectorAll('.op-tabs [data-op-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.op-tabs [data-op-tab]').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        renderOpTab(btn.dataset.opTab);
      });
    });
  }

  function init() {
    bindGoButtons();
    bindTabs();
    document.getElementById('op-btn-connect-all')?.addEventListener('click', openStoreSelector);
    document.getElementById('op-btn-connect-mock')?.addEventListener('click', openStoreSelector);
    document.getElementById('op-btn-connect-partial')?.addEventListener('click', openStoreSelector);
    document.getElementById('op-btn-analyze')?.addEventListener('click', runAnalyze);
    document.getElementById('op-btn-save-report')?.addEventListener('click', saveReport);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
