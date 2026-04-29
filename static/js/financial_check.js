/* 금융 점검 전용 플로우 */
'use strict';

(function () {
  const S = { storeId: null, profile: null, analysis: null, charts: {} };

  const FC_CAT_COLORS = ['#ea580c', '#2563eb', '#7c3aed', '#0891b2', '#ca8a04', '#475569', '#94a3b8'];

  function money(v) { return `${Number(v || 0).toLocaleString()}원`; }
  function esc(x) { const d = document.createElement('div'); d.textContent = x == null ? '' : String(x); return d.innerHTML; }
  function destroyCharts() { Object.values(S.charts).forEach(c => c?.destroy?.()); S.charts = {}; }

  function bindGo() {
    ['financial-connect', 'financial-store', 'financial-preview'].forEach(p => {
      document.querySelectorAll(`#panel-${p} [data-go]`).forEach(btn => {
        btn.addEventListener('click', () => window.goStep(btn.dataset.go));
      });
    });
    document.querySelectorAll('#panel-financial-result [data-go]').forEach(btn => {
      btn.addEventListener('click', () => window.goStep(btn.dataset.go));
    });
  }

  async function openStoreList() {
    window.goStep('financial-store');
    const box = document.getElementById('fc-store-list');
    box.innerHTML = '<div class="muted">불러오는 중...</div>';
    const res = await window.fetchJson('/api/shinhan/business/financial-check/stores');
    const arr = res.stores || [];
    box.innerHTML = arr.map(s => `
      <div class="op-store-card">
        <div class="op-store-title">${esc(s.store_name)}</div>
        <div class="op-store-meta">${esc(s.industry)} · ${esc(s.address)}</div>
        <div class="op-store-meta">최근 1개월 카드 매출: <b>${money(s.monthly_card_sales)}</b></div>
        <button class="btn btn-primary btn-sm" data-store="${esc(s.store_id)}">이 사업장 금융 점검하기</button>
      </div>
    `).join('');
    box.querySelectorAll('button[data-store]').forEach(btn => btn.addEventListener('click', () => selectStore(btn.dataset.store)));
  }

  async function selectStore(storeId) {
    S.storeId = storeId;
    S.profile = await window.fetchJson(`/api/shinhan/business/${storeId}/financial-profile`);
    renderPreview();
    window.goStep('financial-preview');
  }

  function renderPreview() {
    const p = S.profile || {};
    const st = p.store_profile || {};
    const bank = p.bank_account_profile || {};
    const loan = p.loan_profile || {};
    const card = p.card_profile || {};
    const ins = p.insurance_profile || {};
    const lc = (loan.loan_contracts || [])
      .map(
        x =>
          `<li>${esc(x.nickname)} · 잔액 ${money(x.principal_balance)} · 연 ${x.annual_rate_pct}% · 월 ${money(x.monthly_repayment)}</li>`,
      )
      .join('');
    const incCats = (card.increased_categories || []).map(x => `${esc(x.category)} +${x.increase_rate}%`).join(', ');
    document.getElementById('fc-preview-wrap').innerHTML = `
      <div class="info-box"><div class="info-title">금융 점검 대상</div><div class="info-body">${esc(st.store_name || '')} · ${esc(st.industry || '')} · ${esc(st.address || '')}<br>상권: ${esc(st.market_area || '')}</div></div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">현재 잔액</div><div class="kpi-value">${money(bank.current_balance)}</div></div>
        <div class="kpi"><div class="kpi-label">30일 예정 지출</div><div class="kpi-value">${money(bank.scheduled_outflow_next_30d)}</div></div>
        <div class="kpi"><div class="kpi-label">최근 1개월 순현금흐름</div><div class="kpi-value">${money(bank.net_cash_flow)}</div></div>
        <div class="kpi"><div class="kpi-label">월 카드 매출</div><div class="kpi-value">${money(card.monthly_card_sales)}</div>${card.mom_sales_pct != null ? `<div class="muted" style="font-size:11px">전월대비 ${card.mom_sales_pct}%</div>` : ''}</div>
        <div class="kpi"><div class="kpi-label">월 카드 지출</div><div class="kpi-value">${money(card.monthly_business_card_spending)}</div></div>
        <div class="kpi"><div class="kpi-label">카드값 결제 예정일</div><div class="kpi-value">${card.payment_due_day || '-'}일 전후 ${money(card.card_payment_due)}</div></div>
        <div class="kpi"><div class="kpi-label">총 대출 잔액</div><div class="kpi-value">${money(loan.total_loan_balance)}</div></div>
        <div class="kpi"><div class="kpi-label">평균 금리</div><div class="kpi-value">${loan.average_interest_rate || 0}%</div></div>
        <div class="kpi"><div class="kpi-label">월 원리금 상환</div><div class="kpi-value">${money(loan.monthly_repayment)}</div></div>
        <div class="kpi"><div class="kpi-label">보험료·공백</div><div class="kpi-value">${money(ins.monthly_premium)} · 공백 ${(ins.insurance_gap || []).length}건</div></div>
      </div>
      <div class="info-box" style="margin-top:12px"><div class="info-title">대출 세부(연계 목업)</div><div class="info-body"><ul style="margin:0;padding-left:18px">${lc || '<li>약정 상세는 기업뱅킹·영업점에서 확인</li>'}</ul></div></div>
      <div class="info-box"><div class="info-title">카드 지출 증가 카테고리(전월 대비)</div><div class="info-body">${incCats || '-'}</div></div>
      <div class="info-box"><div class="info-title">보험 가입 요약</div><div class="info-body">${(ins.enrolled_product_groups || []).map(e => `${esc(e.insurer)} · ${esc(e.label)} (${money(e.monthly_premium)})`).join('<br>') || '-'}</div></div>
    `;
  }

  function animateLoading() {
    const items = document.querySelectorAll('#fc-loading-checks li');
    items.forEach(x => x.classList.remove('done'));
    items.forEach((x, i) => setTimeout(() => x.classList.add('done'), (i + 1) * 210));
  }

  async function analyze() {
    if (!S.storeId) return;
    window.goStep('financial-loading');
    animateLoading();
    const req = {
      main_financial_concern: document.getElementById('fc-concern')?.value || '잘 모르겠음',
      external_loan_exists: (document.getElementById('fc-external-loan')?.value || '없음') === '있음',
      external_insurance_exists: (document.getElementById('fc-external-ins')?.value || '없음') === '있음',
      planned_large_expense: document.getElementById('fc-expense')?.value || '없음',
      planned_use_amount: parseBandToAmount(document.getElementById('fc-use-amount-band')?.value || '없음'),
      planned_use_purpose: document.getElementById('fc-use-purpose')?.value || '기타',
    };
    S.analysis = await window.fetchJson(`/api/shinhan/business/${S.storeId}/financial-check/analyze`, {
      method: 'POST',
      body: JSON.stringify(req),
    });
    renderTop();
    renderTab('summary');
    window.goStep('financial-result');
  }

  function parseBandToAmount(v) {
    const m = { '없음': 0, '100만 원 이하': 1000000, '100만~300만 원': 3000000, '300만~500만 원': 5000000, '500만~1,000만 원': 10000000, '1,000만 원 이상': 12000000 };
    return m[v] || 0;
  }

  function renderTop() {
    const d = S.analysis || {};
    const sp = d.financial_profile?.store_profile || {};
    document.getElementById('fc-result-top').innerHTML = `
      <div class="result-summary">
        <div class="summary-head">
          <div>
            <div class="summary-eyebrow">${esc(sp.store_name || '')} · ${esc(sp.industry || '')}${sp.market_area ? ` · ${esc(sp.market_area)}` : ''}</div>
            <div class="summary-title">${d.financial_health_score || 0}점 <span class="grade-badge">${esc(d.grade || '')}</span></div>
            <div class="summary-meta">${esc(d.summary || '')}</div>
          </div>
        </div>
        <div class="summary-finance-highlight"><ul class="sfh-list">${(d.urgent_actions || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      </div>
    `;
  }

  async function renderTab(tab) {
    destroyCharts();
    const d = S.analysis || {};
    const p = d.financial_profile || {};
    const box = document.getElementById('fc-tab-content');
    if (!box) return;

    if (tab === 'summary') {
      const sg = (d.strengths || []).map(x => `<li>${esc(x)}</li>`).join('');
      const rk = (d.risk_points || []).map(x => `<li>${esc(x)}</li>`).join('');
      box.innerHTML = `
        <div class="info-box" style="margin-bottom:12px"><div class="info-title">사장님 요약</div><div class="info-body">${esc(d.summary || '')}</div></div>
        <div class="fc-summary-split">
          <div class="info-box"><div class="info-title">긍정 신호</div><div class="info-body"><ul class="sfh-list">${sg}</ul></div></div>
          <div class="info-box"><div class="info-title">유의 신호</div><div class="info-body"><ul class="sfh-list">${rk}</ul></div></div>
        </div>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">현재 예치금</div><div class="kpi-value">${money(d.current_balance)}</div></div>
          <div class="kpi"><div class="kpi-label">실제 사용 가능 금액</div><div class="kpi-value">${money(d.available_cash)}</div></div>
          <div class="kpi"><div class="kpi-label">운영 안전자금</div><div class="kpi-value">${money(d.minimum_safety_cash)}</div></div>
          <div class="kpi"><div class="kpi-label">현금 보유 개월수</div><div class="kpi-value">${d.cash_runway_months || 0}개월</div></div>
          <div class="kpi"><div class="kpi-label">순현금흐름</div><div class="kpi-value">${money(d.net_cash_flow)}</div></div>
          <div class="kpi"><div class="kpi-label">평균 금리</div><div class="kpi-value">${d.average_interest_rate || 0}%</div></div>
        </div>
      `;
    } else if (tab === 'cash') {
      const bank = p.bank_account_profile || {};
      box.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">현재 예치금</div><div class="kpi-value">${money(d.current_balance)}</div></div>
          <div class="kpi"><div class="kpi-label">30일 예정 지출</div><div class="kpi-value">${money(bank.scheduled_outflow_next_30d)}</div></div>
          <div class="kpi"><div class="kpi-label">세금 예비금</div><div class="kpi-value">${money(bank.tax_reserved_estimate)}</div></div>
          <div class="kpi"><div class="kpi-label">사용 가능 금액</div><div class="kpi-value">${money(d.available_cash)}</div></div>
        </div>
        <div class="fin-chart-card" style="margin-top:12px"><div class="fin-chart-h">예치금 배분</div><div class="fin-chart-canvas"><canvas id="fc-cash-chart"></canvas></div></div>
        <div class="op-cash-checker">
          <div class="form-grid">
            <div class="form-item"><label>사용 목적</label><select id="fc-check-purpose"><option>마케팅 광고비</option><option>인테리어</option><option>장비 교체</option><option>재고 매입</option><option>대출 일부 상환</option><option>직원 채용</option><option>기타</option></select></div>
            <div class="form-item"><label>사용 금액</label><input type="number" id="fc-check-amount" placeholder="예: 8000000"></div>
          </div>
          <button class="btn btn-primary btn-sm" id="fc-btn-cash-advice">이 돈 써도 되나요?</button>
          <div id="fc-cash-advice-result" class="muted" style="margin-top:8px"></div>
        </div>
      `;
      drawCashChart(d, p);
      document.getElementById('fc-btn-cash-advice')?.addEventListener('click', askCashAdvice);
    } else if (tab === 'cashflow') {
      const r = await window.fetchJson(`/api/shinhan/business/${S.storeId}/financial-check/cashflow-calendar`);
      const bank = p.bank_account_profile || {};
      box.innerHTML = `
        <div class="info-box"><div class="info-title">한 줄 설명</div><div class="info-body">${esc(r.owner_message || r.message)}</div></div>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">월 입금</div><div class="kpi-value">${money(r.monthly_inflow || bank.monthly_inflow)}</div></div>
          <div class="kpi"><div class="kpi-label">월 출금</div><div class="kpi-value">${money(r.monthly_outflow || bank.monthly_outflow)}</div></div>
          <div class="kpi"><div class="kpi-label">순현금흐름</div><div class="kpi-value">${money((r.monthly_inflow || bank.monthly_inflow) - (r.monthly_outflow || bank.monthly_outflow))}</div></div>
        </div>
        <div class="op-chart-grid">
          <div class="fin-chart-card"><div class="fin-chart-h">월중 잔액 추이</div><div class="fin-chart-canvas"><canvas id="fc-cf-balance"></canvas></div></div>
          <div class="fin-chart-card"><div class="fin-chart-h">최근 6개월 입금 vs 출금</div><div class="fin-chart-canvas"><canvas id="fc-cf-inout"></canvas></div></div>
          <div class="fin-chart-card op-chart-span-2"><div class="fin-chart-h">예정 반복 출금</div><div class="fin-chart-canvas fin-chart-canvas-tall"><canvas id="fc-cf-schedule"></canvas></div></div>
        </div>
        <div class="info-box" style="margin-top:12px"><div class="info-title">반복 출금 일정</div><div class="info-body"><ul>${(r.recurring_payments || []).map(x => `<li>${x.day}일 ${esc(x.name)} ${money(x.amount)}</li>`).join('')}</ul>${esc(r.message || '')}</div></div>
      `;
      drawFcCashflowCharts(r);
    } else if (tab === 'loan') {
      const sim = await window.fetchJson(`/api/shinhan/business/${S.storeId}/financial-check/loan-simulation`, { method: 'POST', body: JSON.stringify({ scenario: '금리 2%p 인하' }) });
      const loanP = p.loan_profile || {};
      box.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">총 대출 잔액</div><div class="kpi-value">${money(loanP.total_loan_balance || d.loan_balance)}</div></div>
          <div class="kpi"><div class="kpi-label">월 상환액</div><div class="kpi-value">${money(d.monthly_repayment)}</div></div>
          <div class="kpi"><div class="kpi-label">매출 대비 상환 부담</div><div class="kpi-value">${Math.round((d.repayment_burden_ratio || 0) * 1000) / 10}%</div></div>
          <div class="kpi"><div class="kpi-label">평균 금리</div><div class="kpi-value">${d.average_interest_rate || loanP.average_interest_rate || 0}%</div></div>
        </div>
        <div class="fin-chart-card" style="margin-top:12px"><div class="fin-chart-h">시나리오별 이자·상환(추정)</div><div class="fin-chart-canvas fin-chart-canvas-tall"><canvas id="fc-loan-chart"></canvas></div></div>
        <div class="info-box" style="margin-top:12px"><div class="info-body"><span class="muted">실제 대출 가능 여부, 한도, 금리는 금융심사 결과에 따라 달라질 수 있습니다.</span></div></div>
      `;
      drawFcLoanChart(sim);
    } else if (tab === 'card') {
      const card = await window.fetchJson(`/api/shinhan/business/${S.storeId}/financial-check/card-spending`);
      const cats = card.spending_by_category || {};
      const labelsKo = card.category_labels_ko || {};
      const keys = Object.keys(cats);
      const lbl = keys.map(k => labelsKo[k] || k);
      box.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">월 카드 매출</div><div class="kpi-value">${money(card.monthly_card_sales)}</div></div>
          <div class="kpi"><div class="kpi-label">월 카드 지출</div><div class="kpi-value">${money(card.monthly_business_card_spending)}</div></div>
          <div class="kpi"><div class="kpi-label">매출 대비 지출</div><div class="kpi-value">${(Number(card.spending_ratio || 0) * 100).toFixed(1)}%</div></div>
          <div class="kpi"><div class="kpi-label">사업자카드</div><div class="kpi-value">${money(card.business_card_spending)}</div></div>
          <div class="kpi"><div class="kpi-label">법인카드</div><div class="kpi-value">${money(card.corporate_card_spending)}</div></div>
        </div>
        <div class="op-chart-grid">
          <div class="fin-chart-card"><div class="fin-chart-h">지출 카테고리</div><div class="fin-chart-canvas"><canvas id="fc-card-pie"></canvas></div></div>
          <div class="fin-chart-card"><div class="fin-chart-h">전월 대비 증가율(%)</div><div class="fin-chart-canvas"><canvas id="fc-card-mom"></canvas></div></div>
          <div class="fin-chart-card"><div class="fin-chart-h">사업자 vs 법인</div><div class="fin-chart-canvas"><canvas id="fc-card-split"></canvas></div></div>
          <div class="fin-chart-card"><div class="fin-chart-h">3개월 지출 추이</div><div class="fin-chart-canvas"><canvas id="fc-card-trend"></canvas></div></div>
        </div>
        <div class="info-box" style="margin-top:12px"><div class="info-body">${esc(card.diagnosis || card.message)} · 전월 대비 증가: ${(card.increased_categories || []).map(x => `${esc(x.category)} +${x.increase_rate}%`).join(', ')}</div></div>
      `;
      drawFcCardCharts(card, lbl, keys);
    } else if (tab === 'insurance') {
      const ins = await window.fetchJson(`/api/shinhan/business/${S.storeId}/financial-check/insurance-gap`);
      box.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">월 보험료(신한)</div><div class="kpi-value">${money(ins.monthly_premium)}</div></div>
          <div class="kpi"><div class="kpi-label">점검 권장 항목</div><div class="kpi-value">${(ins.gaps || []).length}건</div></div>
        </div>
        <div class="fin-chart-card" style="margin-top:12px"><div class="fin-chart-h">보장 영역 가입 여부</div><div class="fin-chart-canvas fin-chart-canvas-tall"><canvas id="fc-ins-chart"></canvas></div></div>
        <div class="info-box" style="margin-top:12px"><div class="info-title">공백 상세</div><div class="info-body"><ul>${(ins.gaps || []).map(g => `<li>${esc(g.name)} · ${esc(g.reason)}</li>`).join('')}</ul><span class="muted">실제 가입 가능 여부와 보험료는 상품 조건 및 심사 결과에 따라 달라질 수 있습니다.</span></div></div>
      `;
      drawFcInsuranceChart(ins);
    } else if (tab === 'stress') {
      const st = await window.fetchJson(`/api/shinhan/business/${S.storeId}/financial-check/stress-test`, { method: 'POST', body: JSON.stringify({ scenario: 'sales_down_20' }) });
      box.innerHTML = `
        <div class="info-box"><div class="info-body">${esc(st.owner_message || '')}</div></div>
        <div class="info-box"><div class="info-title">선택 시나리오</div><div class="info-body">${esc(st.message)}<br>위험 등급: <b>${esc(st.risk_grade)}</b></div></div>
        <div class="fin-chart-card" style="margin-top:12px"><div class="fin-chart-h">시나리오별 현금버퍼(개월)</div><div class="fin-chart-canvas"><canvas id="fc-stress-chart"></canvas></div></div>
        <div class="info-box" style="margin-top:10px"><div class="info-body muted">고정비·대출 조건은 그대로일 때의 참고 시뮬레이션입니다.</div></div>
      `;
      drawFcStressChart(st);
    } else if (tab === 'products') {
      const items = d.product_recommendations || [];
      const kindClass = {
        bank: 'shfg-kind-bank',
        card: 'shfg-kind-card',
        life: 'shfg-kind-life',
        ez: 'shfg-kind-ez',
        invest: 'shfg-kind-inv',
      };
      box.innerHTML = items.length
        ? `
        <div class="shfg-products-intro info-box">
          <div class="info-title">신한금융그룹 연계 추천</div>
          <div class="info-body muted">
            통장·카드·대출·보험을 한데 묶어 본 뒤, <strong>그룹 계열사별로 어떤 점을 함께 보면 좋은지</strong>만 골랐습니다.
            상품 가입 권유가 아니라 <strong>데이터와 맞닿은 점검 축</strong>입니다.
          </div>
        </div>
        <div class="shfg-product-list">
          ${items
            .map(x => {
              const k = kindClass[x.subsidiary_kind] || '';
              const cta = x.cta_action
                ? `<button type="button" class="btn btn-secondary btn-sm spr-cta shfg-cta" data-cta-action="${esc(x.cta_action)}">안내·체크리스트</button>`
                : '';
              return `
            <div class="shfg-product-card ${k}">
              <div class="shfg-card-head">
                <span class="shfg-priority">${esc(x.priority)}</span>
                <span class="shfg-axis">${esc(x.area || '')}</span>
                <span class="shfg-status">${esc(x.status || '')}</span>
              </div>
              <div class="shfg-subsidiary-badge">${esc(x.subsidiary || '')}</div>
              <h4 class="shfg-title">${esc(x.group || '')}</h4>
              <div class="shfg-linked"><span class="shfg-linked-label">진단 데이터 연계</span> ${esc(x.linked_diagnosis || '')}</div>
              <p class="shfg-reason">${esc(x.why || '')}</p>
              ${x.note ? `<p class="shfg-caution muted">${esc(x.note)}</p>` : ''}
              ${x.official_channel ? `<div class="shfg-channel">${esc(x.official_channel)}</div>` : ''}
              ${cta}
            </div>`;
            })
            .join('')}
        </div>`
        : `<div class="info-box"><div class="info-body">분석 결과를 불러오지 못했습니다. 요약 탭에서 점검을 다시 실행해 주세요.</div></div>`;
    } else if (tab === 'plan') {
      const plan = await window.fetchJson(`/api/shinhan/business/${S.storeId}/financial-check/action-plan`, { method: 'POST', body: JSON.stringify({ focus: '현금흐름 개선' }) });
      box.innerHTML = `<div class="info-box"><div class="info-title">금융 개선 실행 플랜</div><div class="info-body"><ul>${(plan.actions || []).map(a => `<li>${a.week}주차 · ${esc(a.text)}</li>`).join('')}</ul></div></div>`;
    }
  }

  function drawCashChart(d, p) {
    if (typeof Chart === 'undefined') return;
    const cv = document.getElementById('fc-cash-chart');
    if (!cv) return;
    const bank = p.bank_account_profile || {};
    const current = Number(d.current_balance || 0);
    const tax = Number(bank.tax_reserved_estimate || 0);
    const safety = Number(d.minimum_safety_cash || 0);
    const available = Number(d.available_cash || 0);
    const reserve = Math.max(0, current - tax - safety - available);
    S.charts.cash = new Chart(cv, {
      type: 'bar',
      data: { labels: ['예치금'], datasets: [
        { label: '예약금', data: [reserve], backgroundColor: '#64748b', stack: 's' },
        { label: '세금', data: [tax], backgroundColor: '#f59e0b', stack: 's' },
        { label: '안전자금', data: [safety], backgroundColor: '#334155', stack: 's' },
        { label: '사용 가능', data: [available], backgroundColor: '#16a34a', stack: 's' },
      ]},
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { stacked: true }, y: { stacked: true } } },
    });
  }

  function drawFcCashflowCharts(r) {
    if (typeof Chart === 'undefined') return;
    const curve = r.daily_balance_curve || [];
    const six = r.monthly_in_out_6m || [];
    const recurring = r.recurring_payments || [];

    const cvb = document.getElementById('fc-cf-balance');
    if (cvb && curve.length) {
      S.charts.cfBal = new Chart(cvb, {
        type: 'line',
        data: {
          labels: curve.map(x => `${x.day}일`),
          datasets: [{ data: curve.map(x => x.balance), borderColor: '#0284c7', backgroundColor: '#bae6fd44', fill: true, tension: 0.25 }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
      });
    }
    const cvi = document.getElementById('fc-cf-inout');
    if (cvi && six.length) {
      S.charts.cfInOut = new Chart(cvi, {
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
    const cvs = document.getElementById('fc-cf-schedule');
    if (cvs && recurring.length) {
      S.charts.cfSch = new Chart(cvs, {
        type: 'bar',
        data: {
          labels: recurring.map(x => `${x.day}일 ${x.name}`),
          datasets: [{ data: recurring.map(x => x.amount), backgroundColor: '#64748b' }],
        },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } },
      });
    }
  }

  function drawFcLoanChart(sim) {
    if (typeof Chart === 'undefined') return;
    const cv = document.getElementById('fc-loan-chart');
    const scenarios = sim.scenarios || [];
    if (!cv || !scenarios.length) return;
    S.charts.fcLoan = new Chart(cv, {
      type: 'bar',
      data: {
        labels: scenarios.map(s => s.name),
        datasets: [
          { label: '월 이자(추정)', data: scenarios.map(s => s.monthly_interest), backgroundColor: '#f59e0b' },
          { label: '월 상환(추정)', data: scenarios.map(s => s.monthly_repayment), backgroundColor: '#1e293b' },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }

  function drawFcCardCharts(card, lbl, keys) {
    if (typeof Chart === 'undefined') return;
    const cats = card.spending_by_category || {};
    const vals = keys.map(k => cats[k]);
    const mom = card.mom_change_pct || {};

    const pie = document.getElementById('fc-card-pie');
    if (pie && vals.length) {
      S.charts.fcCardPie = new Chart(pie, {
        type: 'doughnut',
        data: { labels: lbl, datasets: [{ data: vals, backgroundColor: FC_CAT_COLORS }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }
    const momCv = document.getElementById('fc-card-mom');
    if (momCv && keys.length) {
      S.charts.fcCardMom = new Chart(momCv, {
        type: 'bar',
        data: {
          labels: lbl,
          datasets: [{ label: '전월대비%', data: keys.map(k => Number(mom[k] || 0)), backgroundColor: '#0ea5e9' }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { ticks: { callback: v => `${v}%` } } },
          plugins: { legend: { display: false } },
        },
      });
    }
    const sp = document.getElementById('fc-card-split');
    if (sp) {
      S.charts.fcCardSplit = new Chart(sp, {
        type: 'pie',
        data: {
          labels: ['사업자카드', '법인카드'],
          datasets: [{
            data: [Number(card.business_card_spending || 0), Number(card.corporate_card_spending || 0)],
            backgroundColor: ['#22c55e', '#6366f1'],
          }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
      });
    }
    const tr = document.getElementById('fc-card-trend');
    const arr = card.total_spending_last_3_months || [];
    if (tr && arr.length) {
      const tl = arr.length === 3 ? ['2개월 전', '전월', '당월'] : arr.map((_, i) => `${i + 1}`);
      S.charts.fcCardTrend = new Chart(tr, {
        type: 'line',
        data: {
          labels: tl,
          datasets: [{ label: '지출', data: arr, borderColor: '#ea580c', backgroundColor: '#ffedd5', fill: true, tension: 0.2 }],
        },
        options: { responsive: true, maintainAspectRatio: false },
      });
    }
  }

  function drawFcInsuranceChart(ins) {
    if (typeof Chart === 'undefined') return;
    const cv = document.getElementById('fc-ins-chart');
    const rows = ins.coverage_rows || [];
    if (!cv || !rows.length) return;
    S.charts.fcIns = new Chart(cv, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.label),
        datasets: [{
          data: rows.map(r => (r.score != null ? r.score : (r.status === '가입' ? 1 : 0))),
          backgroundColor: rows.map(r => ((r.score != null ? r.score : (r.status === '가입' ? 1 : 0)) ? '#16a34a' : '#dc2626')),
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

  function drawFcStressChart(st) {
    if (typeof Chart === 'undefined') return;
    const cv = document.getElementById('fc-stress-chart');
    const rows = st.scenarios_compare || [];
    if (!cv || !rows.length) return;
    S.charts.fcStress = new Chart(cv, {
      type: 'bar',
      data: {
        labels: rows.map(x => x.label),
        datasets: [{ label: '현금버퍼(개월)', data: rows.map(x => x.months), backgroundColor: '#6366f1' }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
  }

  async function askCashAdvice() {
    const amt = Number(document.getElementById('fc-check-amount')?.value || 0);
    const purpose = document.getElementById('fc-check-purpose')?.value || '기타';
    const out = document.getElementById('fc-cash-advice-result');
    if (!out || amt <= 0) return;
    out.textContent = '계산 중...';
    const r = await window.fetchJson(`/api/shinhan/business/${S.storeId}/financial-check/cash-advice`, {
      method: 'POST',
      body: JSON.stringify({ planned_use_amount: amt, planned_use_purpose: purpose }),
    });
    out.innerHTML = `<b>${esc(r.decision)}</b> · ${esc(r.message)}${r.alternative ? `<br>${esc(r.alternative)}` : ''}`;
  }

  async function saveReport() {
    const r = await window.fetchJson(`/api/shinhan/business/${S.storeId}/financial-check/report/save`, { method: 'POST' });
    alert(`리포트를 저장했습니다. (누적 ${r.saved_count || 1}건)`);
  }

  function bindTabs() {
    document.querySelectorAll('#panel-financial-result [data-fc-tab]').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('#panel-financial-result [data-fc-tab]').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        await renderTab(btn.dataset.fcTab);
      });
    });
  }

  function init() {
    bindGo();
    bindTabs();
    ['fc-btn-all', 'fc-btn-partial', 'fc-btn-mock'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', openStoreList);
    });
    document.getElementById('fc-btn-analyze')?.addEventListener('click', analyze);
    document.getElementById('fc-btn-save-report')?.addEventListener('click', saveReport);
  }

  window.openFinancialStoreList = openStoreList;
  document.addEventListener('DOMContentLoaded', init);
})();
