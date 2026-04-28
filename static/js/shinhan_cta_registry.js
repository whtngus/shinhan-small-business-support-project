/**
 * 신한 서비스 연결 탭 CTA 동작 — 상담 전 안내 모달 + 공식 링크 + 전화
 * URL은 공개 대표 안내 페이지 기준이며, 상품별 심층 URL은 금융사 정책에 따라 변경될 수 있습니다.
 */
(function () {
  'use strict';

  const UTM = 'utm_source=shinhan_soho_consult&utm_medium=web&utm_campaign=';

  function withUtm(url, campaign) {
    try {
      const u = new URL(url, window.location.origin);
      u.searchParams.set('utm_source', 'shinhan_soho_consult');
      u.searchParams.set('utm_medium', 'web');
      u.searchParams.set('utm_campaign', campaign);
      return u.toString();
    } catch (e) {
      return url + (url.includes('?') ? '&' : '?') + UTM + campaign;
    }
  }

  /** @type {Record<string, { headline: string, intro: string, checklist: string[], primary: {label:string, url:string}, phone?: {label:string, tel:string}, extras?: {label:string, url:string}[], note: string }>} */
  window.SHINHAN_CTA_REGISTRY = {
    bank_startup: {
      headline: '창업·시설 자금 상담 전 준비',
      intro:
        '대출 심사 시 사업 계획과 자금 용도가 명확할수록 상담이 수월합니다. 아래를 미리 정리해 두면 좋습니다.',
      checklist: [
        '사업자등록증(또는 사업 계획 중이면 예정 업종·입지 개요)',
        '임대차계약서·보증금·인테리어 견적서 등 초기 비용 근거',
        '최근 통장 거래 요약(운영자금 흐름 설명용)',
        '본 분석 화면 캡처(상권·손익 시뮬레이션 참고용)',
      ],
      primary: {
        label: '신한은행 홈페이지(대출·상품)',
        url: withUtm('https://bank.shinhan.com/index.jsp', 'cta_bank_startup'),
      },
      phone: { label: '신한은행 고객센터', tel: '1577-8000' },
      extras: [
        { label: '소상공인 정책자금 안내 포털', url: 'https://www.smefinance.go.kr/main.do' },
      ],
      note:
        '실제 한도·금리는 신용·담보·보증·매출 등 심사 결과로 결정됩니다. 본 서비스 수치는 참고용입니다.',
    },
    bank_working: {
      headline: '운영자금 상담 전 준비',
      intro:
        '단기 현금 부족 가능성을 줄이려면 월 고정비·변동비·대출 상환 일정을 숫자로 정리하는 것이 중요합니다.',
      checklist: [
        '월 임대료·인건비·재료비·대출 원리금을 표로 정리',
        '현금 보유액 및 예상 버퍼(개월)',
        '매출 급감 시 대응 계획 요약',
      ],
      primary: {
        label: '신한은행 홈페이지',
        url: withUtm('https://bank.shinhan.com/index.jsp', 'cta_bank_working'),
      },
      phone: { label: '신한은행 고객센터', tel: '1577-8000' },
      note: '운영자금 필요액은 본 플랫폼 시뮬레이션과 다를 수 있습니다.',
    },
    bank_policy: {
      headline: '정책자금·보증 — 사전 확인',
      intro:
        '정책자금은 업종·지역·업력·신용 등 조건과 예산 소진 여부에 따라 신청 가능 여부가 달라집니다. 공식 포털에서 최신 안내를 확인하세요.',
      checklist: ['사업자등록증', '매출·납세 증빙 가능 여부', '신용상태·연체 여부 요약', '필요 자금 용도·상환 계획 초안'],
      primary: {
        label: '소상공인 정책자금 통합 포털',
        url: 'https://www.smefinance.go.kr/main.do',
      },
      extras: [
        { label: '소상공인시장진흥공단', url: 'https://www.sbiz.or.kr' },
        {
          label: '금융소비자 정보포털 파인(금융권 공통 안내)',
          url: 'https://fine.fss.or.kr/fine/main/index.do',
        },
      ],
      note: '정책자금 신청은 각 상품별 세부 요건을 반드시 확인해야 합니다.',
    },
    bank_refinance: {
      headline: '대환(기존 대출 정리) 검토',
      intro:
        '금리·상환 방식이 불리하면 대환을 검토할 수 있습니다. 기존 계약서상 중도상환 수수료 등을 확인하세요.',
      checklist: ['기존 대출 약정서·잔액·금리', '상환 스케줄', '중도상환 조건'],
      primary: {
        label: '신한은행 홈페이지',
        url: withUtm('https://bank.shinhan.com/index.jsp', 'cta_bank_refinance'),
      },
      phone: { label: '신한은행 고객센터', tel: '1577-8000' },
      note: '대환 가능 여부는 기존 금융사 조건과 신용 상태에 따라 달라집니다.',
    },
    card_sales_report: {
      headline: '가맹점 매출 점검',
      intro:
        '카드 매출 리포트·정산 일정은 가맹 계약 및 카드사 시스템에서 제공합니다. 공식 채널에서 가맹점 전용 메뉴를 확인하세요.',
      checklist: ['가맹점 번호·MID 확인', '정산 계좌 정보', '주요 매출 시간대·요일 메모'],
      primary: {
        label: '신한카드 공식 사이트',
        url: withUtm('https://www.shinhancard.com/', 'cta_card_home'),
      },
      phone: { label: '신한카드 고객센터', tel: '1544-7000' },
      note: '실제 리포트 제공 범위는 가맹점 유형·계약에 따릅니다.',
    },
    card_settlement: {
      headline: '정산·입금 일정 확인',
      intro: '카드 매출과 실제 입금일은 결제 주기·정산일에 따라 차이가 날 수 있습니다.',
      checklist: ['정산 주기(일정)', '카드사별 입금 예정액 확인 방법', '단말기·결제 설정 점검'],
      primary: {
        label: '신한카드 공식 사이트',
        url: withUtm('https://www.shinhancard.com/', 'cta_card_settlement'),
      },
      phone: { label: '신한카드 고객센터', tel: '1544-7000' },
      note: '',
    },
    card_promo: {
      headline: '프로모션·재방문 전략',
      intro:
        '프로모션은 카드사·가맹점 제휴 프로그램과 병행할 수 있습니다. 과도한 할인은 마진을 압박하지 않도록 설계하세요.',
      checklist: ['타깃 시간대·요일', '재방문 쿠폰 조건', '예산 상한'],
      primary: {
        label: '신한카드 공식 사이트',
        url: withUtm('https://www.shinhancard.com/', 'cta_card_promo'),
      },
      phone: { label: '신한카드 고객센터', tel: '1544-7000' },
      note: '',
    },
    card_business_card: {
      headline: '사업자 카드·경비 관리',
      intro: '사업 관련 지출을 분리하면 세무·현금흐름 관리에 유리합니다.',
      checklist: ['경비 항목 분류 기준', '월별 지출 한도', '증빙 보관 방법'],
      primary: {
        label: '신한카드 공식 사이트',
        url: withUtm('https://www.shinhancard.com/', 'cta_card_biz'),
      },
      phone: { label: '신한카드 고객센터', tel: '1544-7000' },
      note: '상품별 연회비·혜택은 상품 설명서를 확인하세요.',
    },
    life_fire: {
      headline: '화재·시설 리스크 점검',
      intro:
        '업종별로 필요한 특약이 다릅니다. 실제 보장 내용은 약관·설계사 상담으로 확인해야 합니다.',
      checklist: ['점포 면적·구조·사용 설비', '임차인/임대인 책임 범위', '직전 보험 가입 여부'],
      primary: {
        label: '신한라이프 공식 사이트',
        url: withUtm('https://www.shinhanlife.co.kr/', 'cta_life_fire'),
      },
      phone: { label: '신한라이프 고객센터', tel: '1577-6363' },
      note: '본 화면은 보험 가입 권유가 아니라 리스크 점검용 안내입니다.',
    },
    life_liability: {
      headline: '배상책임·고객 사고',
      intro: '방문형 업종은 고객 안전사고와 시설물 배상에 유의해야 합니다.',
      checklist: ['영업 시설 안전 관리 포인트', '사고 시 연락 체계', '과거 사고 이력'],
      primary: {
        label: '신한라이프 공식 사이트',
        url: withUtm('https://www.shinhanlife.co.kr/', 'cta_life_liability'),
      },
      phone: { label: '신한라이프 고객센터', tel: '1577-6363' },
      note: '',
    },
    life_interruption: {
      headline: '휴업·영업중단 리스크',
      intro:
        '일시 휴업 시에도 임대료·인건비가 발생할 수 있습니다. 보장 가능 여부는 상품별 약관을 확인하세요.',
      checklist: ['월 고정비 규모', '현금 버퍼(개월)', '휴업 가능 시나리오'],
      primary: {
        label: '신한라이프 공식 사이트',
        url: withUtm('https://www.shinhanlife.co.kr/', 'cta_life_interruption'),
      },
      phone: { label: '신한라이프 고객센터', tel: '1577-6363' },
      note: '',
    },
    life_checklist: {
      headline: '업종별 보장 체크',
      intro: '업종 특성에 맞는 필수 점검 항목을 정리해 보세요.',
      checklist: ['화재·배상·고객안전·휴업 등 우선순위', '보험 외 리스크(계약·법규)', '증빙 서류 목록'],
      primary: {
        label: '신한라이프 공식 사이트',
        url: withUtm('https://www.shinhanlife.co.kr/', 'cta_life_checklist'),
      },
      phone: { label: '신한라이프 고객센터', tel: '1577-6363' },
      note: '',
    },
    inv_growth: {
      headline: '성장 단계·사업 점검',
      intro:
        '확장 전에는 매출 안정성·부채·현금흐름을 우선 점검하는 것이 일반적입니다.',
      checklist: ['최근 매출 추이', '부채 비율', '추가 투자 필요 시나리오'],
      primary: {
        label: '신한투자증권 공식 사이트',
        url: withUtm('https://www.shinhaninvest.com/', 'cta_inv_growth'),
      },
      phone: { label: '신한투자증권 고객센터', tel: '1588-0365' },
      note: '투자 상품 추천이 아닌 성장·자산관리 상담 경로 안내입니다.',
    },
    inv_corporate: {
      headline: '법인 전환 검토',
      intro:
        '매출 규모·고용·세무 구조에 따라 법인 전환 여부가 달라질 수 있습니다. 세무 전문가 상담을 병행하세요.',
      checklist: ['매출·비용 구조', '예상 세무 부담', '운영 형태(지점·직원)'],
      primary: {
        label: '신한투자증권 공식 사이트',
        url: withUtm('https://www.shinhaninvest.com/', 'cta_inv_corporate'),
      },
      phone: { label: '신한투자증권 고객센터', tel: '1588-0365' },
      note: '',
    },
    inv_asset: {
      headline: '사업자 자산·비상자금',
      intro: '여유 자금 운용 전에 비상자금 규모를 먼저 확정하는 편이 안전합니다.',
      checklist: ['월 순현금흐름', '비상자금 목표액', '유동성 필요 시점'],
      primary: {
        label: '신한투자증권 공식 사이트',
        url: withUtm('https://www.shinhaninvest.com/', 'cta_inv_asset'),
      },
      phone: { label: '신한투자증권 고객센터', tel: '1588-0365' },
      note: '',
    },
    inv_b2b: {
      headline: '확장·제휴 검토',
      intro: '상권 성장성과 재무 안정성이 확보된 뒤 확장을 검토하는 경우가 많습니다.',
      checklist: ['동일 업종 내 경쟁 구도', '추가 자금 계획', '운영 인력 계획'],
      primary: {
        label: '신한투자증권 공식 사이트',
        url: withUtm('https://www.shinhaninvest.com/', 'cta_inv_b2b'),
      },
      phone: { label: '신한투자증권 고객센터', tel: '1588-0365' },
      note: '',
    },
    ez_sme_risk: {
      headline: '신한EZ손해보험 — 점포·재산·배상(손해) 보장 점검',
      intro:
        '신한EZ손해보험은 신한금융그룹 계열 손해보험사로, 화재·재산종합·일부 배상 특약 등 업종에 따라 설계가 달라질 수 있습니다. 본 화면은 가입 권유가 아니라 데이터 기반 공백 안내입니다.',
      checklist: [
        '임차 점포 면적·업종 코드·주요 시설(주방·좌석)',
        '화재·시설물 사고 이력 및 예방 조치',
        '기존 보험 증권·특약 요약',
      ],
      primary: {
        label: '신한금융그룹 — 계열사 안내',
        url: withUtm('https://www.shinhangroup.co.kr/', 'cta_ez_group'),
      },
      extras: [
        {
          label: '금융소비자 정보포털 파인',
          url: 'https://fine.fss.or.kr/fine/main/index.do',
        },
      ],
      note: '실제 가입 가능 여부·보험료는 상품별 약관 및 심사 결과에 따라 달라질 수 있습니다.',
    },
    generic_fallback: {
      headline: '신한금융그룹 안내',
      intro: '선택한 메뉴의 상세 안내를 준비 중이거나 공식 페이지 구조가 변경된 경우입니다.',
      checklist: ['본 페이지 분석 결과를 캡처하여 상담 시 활용', '대표번호로 문의 채널 확인'],
      primary: {
        label: '신한금융그룹',
        url: 'https://www.shinhangroup.co.kr/',
      },
      note: '필요 시 해당 그룹사 고객센터로 문의해 주세요.',
    },
  };

  function escapeHtml(t) {
    if (t == null) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
  }

  window.openShinhanCtaModal = function (actionKey, context) {
    const reg =
      window.SHINHAN_CTA_REGISTRY[actionKey] || window.SHINHAN_CTA_REGISTRY.generic_fallback;
    const modal = document.getElementById('shinhan-cta-modal');
    if (!modal) return;

    const headlineEl = modal.querySelector('[data-shinhan-modal-headline]');
    const introEl = modal.querySelector('[data-shinhan-modal-intro]');
    const listEl = modal.querySelector('[data-shinhan-modal-checklist]');
    const primaryA = modal.querySelector('[data-shinhan-modal-primary]');
    const phoneA = modal.querySelector('[data-shinhan-modal-phone]');
    const extrasEl = modal.querySelector('[data-shinhan-modal-extras]');
    const noteEl = modal.querySelector('[data-shinhan-modal-note]');
    const ctxEl = modal.querySelector('[data-shinhan-modal-context]');

    if (headlineEl) headlineEl.innerHTML = escapeHtml(reg.headline);
    if (introEl) introEl.innerHTML = escapeHtml(reg.intro);

    const ctxParts = [];
    if (context && context.area_name) ctxParts.push(`분석 상권: ${context.area_name}`);
    else if (window.__SHINHAN_OP_CONTEXT__?.headline) {
      ctxParts.push(`운영 진단 사업장: ${window.__SHINHAN_OP_CONTEXT__.headline}`);
    }
    if (context && context.service_name) ctxParts.push(`업종: ${context.service_name}`);
    if (ctxEl) {
      ctxEl.innerHTML =
        ctxParts.length > 0 ? `<div class="shinhan-modal-context">${escapeHtml(ctxParts.join(' · '))}</div>` : '';
    }

    if (listEl) {
      listEl.innerHTML = (reg.checklist || [])
        .map(item => `<li>${escapeHtml(item)}</li>`)
        .join('');
    }

    if (primaryA && reg.primary) {
      primaryA.href = reg.primary.url;
      primaryA.textContent = reg.primary.label;
      primaryA.style.display = '';
    } else if (primaryA) {
      primaryA.style.display = 'none';
    }

    if (phoneA && reg.phone) {
      phoneA.href = 'tel:' + reg.phone.tel.replace(/[^0-9+]/g, '');
      phoneA.textContent = `${reg.phone.label} (${reg.phone.tel})`;
      phoneA.style.display = '';
    } else if (phoneA) {
      phoneA.style.display = 'none';
    }

    if (extrasEl) {
      if (reg.extras && reg.extras.length) {
        extrasEl.innerHTML =
          '<div class="shinhan-modal-extras-title">추가 참고 링크</div>' +
          reg.extras
            .map(ex => {
              const u = String(ex.url || '').replace(/"/g, '');
              return `<a class="shinhan-modal-extra-link" href="${u}" target="_blank" rel="noopener noreferrer">${escapeHtml(ex.label)}</a>`;
            })
            .join('');
        extrasEl.style.display = '';
      } else {
        extrasEl.innerHTML = '';
        extrasEl.style.display = 'none';
      }
    }

    if (noteEl) noteEl.textContent = reg.note || '';

    const copyBtn = modal.querySelector('[data-shinhan-copy-checklist]');
    if (copyBtn) {
      copyBtn.onclick = () => {
        const text = [reg.headline, '', ...(reg.checklist || [])].join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            () => {
              copyBtn.textContent = '복사됨 ✓';
              setTimeout(() => {
                copyBtn.textContent = '체크리스트 복사';
              }, 2000);
            },
            () => alert('복사에 실패했습니다. 브라우저 권한을 확인해 주세요.'),
          );
        }
      };
    }

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  window.closeShinhanCtaModal = function () {
    const modal = document.getElementById('shinhan-cta-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  function initShinhanCtaUi() {
    const modal = document.getElementById('shinhan-cta-modal');
    if (!modal) return;

    modal.querySelector('[data-shinhan-modal-close]')?.addEventListener('click', closeShinhanCtaModal);
    modal.querySelector('.shinhan-modal-backdrop')?.addEventListener('click', closeShinhanCtaModal);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) closeShinhanCtaModal();
    });

    document.addEventListener('click', e => {
      const btn = e.target.closest('.spr-cta[data-cta-action]');
      if (!btn || !btn.dataset.ctaAction) return;
      e.preventDefault();
      const area =
        window.__SHINHAN_OP_CONTEXT__?.area_name ||
        window.__SHINHAN_RESULT_CONTEXT__?.area_name;
      const svc =
        window.__SHINHAN_OP_CONTEXT__?.service_name ||
        window.__SHINHAN_RESULT_CONTEXT__?.service_name;
      window.openShinhanCtaModal(btn.dataset.ctaAction, { area_name: area, service_name: svc });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShinhanCtaUi);
  } else {
    initShinhanCtaUi();
  }
})();
