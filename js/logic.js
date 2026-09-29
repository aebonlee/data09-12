/* 외자재 운영관리 도우미 — 순수 계산 로직 (브라우저·Node 공용, DOM 사용 안 함)
   테스트: node test/logic.test.mjs */
(function (root) {
  'use strict';

  var DAY = 86400000;

  /* ── 기본 데이터 ─────────────────────────────── */
  // 판단 기준값은 모두 화면(설정)에서 바꿉니다. 아래는 처음 열었을 때의 임시 기본값(가정)입니다.
  function defaultSettings() {
    return {
      oc_wait_days: 3,        // 송부 후 이 일수가 지나도 OC 가 없으면 「OC 미접수」
      exw_soon_days: 7,       // 약속 EXW DATE 까지 남은 일수가 이 값 이하이면 「EXW 임박」
      exw_grace_days: 0,      // 실제 출고일이 약속일 + 이 일수 이내이면 「준수」
      weight_tol_kg: 0,       // 중량 허용 오차(kg)
      weight_tol_pct: 0,      // 중량 허용 오차(%) — kg·% 중 큰 쪽을 허용
      po_regex: '',           // PO 번호 찾기 정규식(비우면 기본 규칙)
      oc_keywords: 'order confirmation, order acknowledgement, OC, confirmation, O.A/O.C',
      oc_request_days: 7,     // 발주 메일에 「OC 를 며칠 안에 보내 달라」고 적는 일수(실제 메일: 7일)
      transit_us: 60,         // 항차 매뉴얼 「지역별 평균 운송기간」(일)
      transit_eu: 90,
      transit_jpcn: 15,
      transit_in: 45,
      sender_name: '',
      sender_email: '',
      sender_company: '',
      sender_dept: ''
    };
  }

  var TEMPLATE_KEYS = [
    { key: 'po_mail', label: '발주 메일(PO 송부)' },
    { key: 'oc_followup', label: 'OC 미접수 팔로우업' },
    { key: 'delivery_check', label: '납기(EXW) 확인 요청' },
    { key: 'docs_request', label: '선적서류 요청' },
    { key: 'an_missing', label: 'A/N 미수신 확인' }
  ];

  // 상황별 영문 메일 기본 문안(빈칸 채우기). 실제 사내 문안을 받으면 설정 화면에서 바꿉니다.
  function defaultTemplates() {
    return {
      // 2026-09-29 받은 실제 발주 메일의 제목·문안 구성을 따랐습니다(한 업체의 PO 여러 건을 한 통에 묶을 수 있음).
      po_mail: {
        subject: 'Purchase Order [{CODE}] : {PO} / {SUPPLIER}',
        body: 'Dear sirs,\n\nHope you\'re having a good day.\n\nPlease find attached the new P.O.\nWe would appreciate it if you could kindly provide the O.A/O.C within {OC_DAYS} days.\n\nPO NO: {PO}\n\n{CHECKLIST}\n\nBest regards\n{SENDER}\n{DEPT}\n{COMPANY}'
      },
      oc_followup: {
        subject: '[Reminder] Order Confirmation request - {SUPPLIER}',
        body: 'Dear {CONTACT},\n\nWe have not yet received the Order Confirmation (OC) for the following purchase order(s):\n\n{PO_LIST}\n\nCould you please send the OC with the confirmed EXW date at your earliest convenience?\n\nBest regards,\n{SENDER}\n{DEPT}\n{COMPANY}'
      },
      delivery_check: {
        subject: '[PO {PO}] EXW date confirmation',
        body: 'Dear {CONTACT},\n\nPlease confirm that PO {PO} will be ready on the EXW date {EXW}.\nIf there is any change, please let us know the new date.\n\nBest regards,\n{SENDER}\n{DEPT}\n{COMPANY}'
      },
      docs_request: {
        subject: '[PO {PO}] Shipping documents request',
        body: 'Dear {CONTACT},\n\nPlease send us the shipping documents (Commercial Invoice, Packing List, B/L) for PO {PO}.\n\n{CHECKLIST}\n\nBest regards,\n{SENDER}\n{DEPT}\n{COMPANY}'
      },
      an_missing: {
        subject: '[PO {PO}] Arrival Notice status',
        body: 'Dear {CONTACT},\n\nWe have not received the Arrival Notice for PO {PO} yet.\nCould you please check the shipment status and let us know?\n\nBest regards,\n{SENDER}\n{DEPT}\n{COMPANY}'
      }
    };
  }

  // 도착 통지(A/N): 읽은 메일, 항차등록 완료 표시(PO|B/L 별), 등록 이력
  function emptyAn() { return { mails: [], regs: {}, history: [] }; }

  function emptyDb() {
    return { suppliers: [], pos: [], settings: defaultSettings(), templates: defaultTemplates(), an: emptyAn() };
  }

  /* ── 문자열·날짜 ─────────────────────────────── */
  function str(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return str(v).toLowerCase().replace(/[\s\.\,\-_()\/&]+/g, ''); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  function ymd(y, m, d) {
    y = +y; m = +m; d = +d;
    if (y < 100) y += 2000;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return '';
    return y + '-' + pad(m) + '-' + pad(d);
  }

  // 여러 형태의 날짜를 'YYYY-MM-DD' 로. 못 읽으면 ''.
  // 월/일/연 과 일/월/연 이 헷갈리는 '03/04/2026' 형태는 dayFirst 로 정합니다(기본 월/일, 가정).
  function toDate(v, dayFirst) {
    if (v == null || v === '') return '';
    if (v instanceof Date) {
      if (isNaN(v)) return '';
      return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    }
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) { // 엑셀 날짜 일련번호
        var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * DAY);
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
      }
      return '';
    }
    var s = str(v);
    var m;
    if ((m = s.match(/^(\d{4})[-.\/년\s]+(\d{1,2})[-.\/월\s]+(\d{1,2})/))) return ymd(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return ymd(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{1,2})[-.\s\/]([A-Za-z]{3,4})[a-z]*[-.\s\/,]+(\d{2,4})/))) {
      var mo = MONTHS[m[2].toLowerCase()];
      return mo ? ymd(m[3], mo, m[1]) : '';
    }
    if ((m = s.match(/^([A-Za-z]{3,4})[a-z]*[\s.\-]+(\d{1,2}),?[\s\-]+(\d{2,4})/))) {
      var mo2 = MONTHS[m[1].toLowerCase()];
      return mo2 ? ymd(m[3], mo2, m[2]) : '';
    }
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))) {
      return dayFirst ? ymd(m[3], m[2], m[1]) : ymd(m[3], m[1], m[2]);
    }
    var t = Date.parse(s);
    if (!isNaN(t) && /[a-z]/i.test(s)) return toDate(new Date(t));
    return '';
  }

  function dayNum(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : null;
  }
  // b - a (일). 둘 중 하나라도 비면 null
  function daysBetween(a, b) {
    var x = dayNum(a), y = dayNum(b);
    return x == null || y == null ? null : Math.round(y - x);
  }
  function todayIso(d) { return toDate(d || new Date()); }

  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = str(v).replace(/,/g, '').replace(/\s*(kgs?|kg\.)$/i, '');
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  /* ── 열 매핑 ─────────────────────────────── */
  // 실제 파일의 열 이름을 모르므로, 흔한 이름(별칭)으로 먼저 짐작하고 화면에서 고칩니다.
  var FIELDS = {
    supplier: [
      { key: 'code', label: '업체 코드', aliases: ['업체코드', 'vendor code', 'vendor no', 'supplier code', 'vendor', '코드', 'code'] },
      { key: 'name', label: '업체명', required: true, aliases: ['업체명', 'supplier', 'supplier name', 'vendor name', 'company', '회사명', '공급사', 'name'] },
      { key: 'contact', label: '담당자', aliases: ['담당자', 'contact', 'contact person', 'attn', 'person', '담당'] },
      { key: 'to', label: '수신 이메일(To)', required: true, aliases: ['email', 'e-mail', 'mail', '이메일', 'to', '수신', 'email address'] },
      { key: 'cc', label: '참조 이메일(CC)', aliases: ['cc', '참조', 'cc email'] },
      { key: 'phone', label: '전화', aliases: ['phone', 'tel', 'telephone', '전화', '연락처', 'mobile'] },
      { key: 'country', label: '국가', aliases: ['country', '국가', 'nation'] },
      { key: 'checklist', label: '체크리스트·특이사항', aliases: ['체크리스트', 'checklist', '특이사항', 'remark', 'remarks', 'note', 'notes', '비고'] }
    ],
    ledger: [
      { key: 'po_no', label: 'PO 번호', required: true, aliases: ['po', 'po no', 'po number', 'po#', '발주번호', 'po 번호', 'order no'] },
      { key: 'supplier_code', label: '업체 코드', aliases: ['업체코드', 'vendor code', 'supplier code', 'vendor'] },
      { key: 'supplier_name', label: '업체명', aliases: ['업체명', 'supplier', 'supplier name', 'vendor name'] },
      { key: 'item', label: '품목·품번', aliases: ['품목', '품번', 'item', 'part', 'part no', 'material', '자재'] },
      { key: 'po_date', label: '발주일', aliases: ['발주일', 'po date', 'order date'] },
      { key: 'sent_date', label: '송부일', aliases: ['송부일', 'sent date', '발송일', '메일 송부일'] },
      { key: 'oc_date', label: 'OC 수령일', aliases: ['oc 수령일', 'oc date', 'oc일자', 'oc', 'order confirmation date', 'oc 일자'] },
      { key: 'exw_promised', label: '약속 EXW DATE', aliases: ['exw date', 'exw', '약속 exw', 'exw 약속일', 'confirmed exw', 'promise date'] },
      { key: 'exw_actual', label: '실제 출고일', aliases: ['실제 출고일', 'actual exw', 'exw actual', '출고일', 'shipped date'] },
      { key: 'etd', label: '선적 예정일(ETD)', aliases: ['etd', '선적 예정일', '선적일'] },
      { key: 'an_received', label: 'A/N 수신', aliases: ['a/n', 'an', 'a/n 수신', 'arrival notice'] },
      { key: 'docs_received', label: '선적서류 수신', aliases: ['선적서류', '선적서류 수신', 'shipping documents', 'docs'] },
      { key: 'note', label: '메모', aliases: ['메모', 'note', 'remark', '비고'] },
      { key: 'delivery_date', label: 'PO 납기', aliases: ['po 납기', 'contract delivery date', 'delivery date', '납기일', '납기'] },
      { key: 'oc_no', label: 'OC 번호', aliases: ['oc 번호', 'oc no', 'oc#', 'oc number', 'confirmation no'] },
      { key: 'bl_no', label: 'B/L 번호', aliases: ['b/l 번호', 'b/l no', 'bl no', 'b/l', 'hbl', 'house b/l'] },
      { key: 'eta', label: 'ETA', aliases: ['eta', '도착 예정일', '입항 예정일', '입항일'] }
    ],
    weekly: [
      { key: 'po', label: 'PO 번호', required: true, aliases: ['po', 'po no', 'po number', 'po#', 'customer po', 'purchase order', 'order no', 'order number'] },
      { key: 'line', label: 'PO 라인', aliases: ['line', 'line no', 'po line', 'item no', 'line#', '라인'] },
      { key: 'part', label: '품번', aliases: ['part', 'part no', 'part number', 'item', 'material', '품번'] },
      { key: 'qty', label: '수량', aliases: ['qty', 'quantity', 'order qty', '수량'] },
      { key: 'promise', label: 'Promise Date', required: true, aliases: ['promise date', 'promised date', 'promise', 'promise dt', 'confirmed date'] },
      // 실제 Cummins Integrated Order Status 열(2026-09-29 메일 자료): 1OM#·SO#·Req Date·Status·Remarks
      { key: 'om', label: '1OM# (오더 번호, 선택)', aliases: ['1om#', '1om', 'om#', 'om no'] },
      { key: 'so', label: 'SO# (선택)', aliases: ['so#', 'so no', 'sales order', 'so'] },
      { key: 'req', label: 'Req Date (선택)', aliases: ['req date', 'request date', 'required date', 'requested date'] },
      { key: 'status', label: 'Status (선택)', aliases: ['status', '상태'] },
      { key: 'remarks', label: 'Remarks (선택)', aliases: ['remarks', 'remark', 'comment', 'comments', '비고'] }
    ],
    packing: [
      { key: 'group', label: '묶음 기준(Invoice·B/L 번호 등, 선택)', aliases: ['invoice', 'invoice no', 'b/l', 'bl no', 'b/l no', 'shipment', 'container'] },
      { key: 'part', label: '자재·품번', aliases: ['part', 'part no', 'part number', 'item', 'description', 'material', '품번', '자재'] },
      { key: 'qty', label: '수량', aliases: ['qty', 'quantity', '수량', "q'ty"] },
      { key: 'weight', label: '중량', required: true, aliases: ['gross weight', 'g.w', 'g/w', 'gw', 'weight', 'net weight', 'n.w', 'n/w', '중량', '총중량'] }
    ]
  };

  function guessMapping(headers, kind) {
    var defs = FIELDS[kind] || [];
    var used = {};
    var map = {};
    var hn = headers.map(function (h) { return norm(h); });
    // 1) 완전 일치 → 2) 포함 순서로 짐작
    [true, false].forEach(function (exact) {
      defs.forEach(function (f) {
        if (map[f.key] != null) return;
        var cands = [f.label].concat(f.aliases).map(norm);
        for (var i = 0; i < hn.length; i++) {
          if (used[i] || !hn[i]) continue;
          var ok = cands.some(function (c) { return exact ? hn[i] === c : (c.length >= 3 && hn[i].indexOf(c) >= 0); });
          if (ok) { map[f.key] = headers[i]; used[i] = true; break; }
        }
      });
    });
    return map;
  }

  function missingRequired(mapping, kind) {
    return (FIELDS[kind] || []).filter(function (f) { return f.required && !mapping[f.key]; }).map(function (f) { return f.label; });
  }

  function applyMapping(rows, mapping) {
    return rows.map(function (r) {
      var o = {};
      Object.keys(mapping).forEach(function (k) { if (mapping[k]) o[k] = r[mapping[k]]; });
      return o;
    });
  }

  /* ── 업체 마스터 ─────────────────────────────── */
  function splitEmails(v) {
    return str(v).split(/[;,\s]+/).map(function (x) { return x.replace(/^<|>$/g, '').trim(); })
      .filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
  }
  function domainOf(email) {
    var m = /@([^@>\s]+)$/.exec(str(email).toLowerCase());
    return m ? m[1] : '';
  }

  function supplierFromRow(r, i) {
    var to = splitEmails(r.to);
    var cc = splitEmails(r.cc);
    var domains = [];
    to.concat(cc).forEach(function (e) { var d = domainOf(e); if (d && domains.indexOf(d) < 0) domains.push(d); });
    return {
      code: str(r.code) || ('S' + pad(i + 1)),
      name: str(r.name),
      contact: str(r.contact),
      to: to.join('; '),
      cc: cc.join('; '),
      phone: str(r.phone),
      country: str(r.country),
      domains: domains.join('; '),
      checklist: str(r.checklist)
    };
  }

  // 표 → 업체 목록. 이름 없는 행은 건너뛰고, 이메일이 없는 업체는 경고로 돌려줍니다.
  function importSuppliers(mappedRows) {
    var out = [], warnings = [];
    mappedRows.forEach(function (r, i) {
      if (!str(r.name)) return;
      var s = supplierFromRow(r, out.length);
      if (!s.to) warnings.push(s.name + ': 수신 이메일이 없습니다');
      out.push(s);
    });
    return { suppliers: out, warnings: warnings };
  }

  // 같은 업체 코드는 덮어쓰고, 새 코드는 추가
  function mergeSuppliers(existing, incoming) {
    var byCode = {};
    var res = existing.slice();
    res.forEach(function (s, i) { byCode[s.code] = i; });
    incoming.forEach(function (s) {
      if (byCode[s.code] != null) res[byCode[s.code]] = Object.assign({}, res[byCode[s.code]], s);
      else { byCode[s.code] = res.length; res.push(s); }
    });
    return res;
  }

  function searchSuppliers(list, q) {
    var k = norm(q);
    if (!k) return list.slice();
    return list.filter(function (s) {
      return [s.code, s.name, s.contact, s.to, s.cc, s.country].some(function (v) { return norm(v).indexOf(k) >= 0; });
    });
  }

  function supplierByCode(list, code) {
    return list.filter(function (s) { return s.code === code; })[0] || null;
  }

  // 글(파일명·PDF 본문) 속에서 업체를 찾습니다. 업체 코드·업체명·메일 도메인 중 가장 긴 일치를 씁니다.
  function findSupplierInText(list, text) {
    var t = norm(text);
    var best = null, bestLen = 0;
    list.forEach(function (s) {
      var keys = [s.name, str(s.name).replace(/\([^)]*\)/g, ''), s.code].concat(str(s.domains).split(/;\s*/).map(function (d) { return d.split('.')[0]; }));
      keys.forEach(function (k) {
        var nk = norm(k);
        if (nk.length < 3) return;
        if (t.indexOf(nk) >= 0 && nk.length > bestLen) { best = s; bestLen = nk.length; }
      });
    });
    return best;
  }

  function supplierByEmail(list, email) {
    var d = domainOf(email);
    var e = str(email).toLowerCase();
    if (!d) return null;
    var exact = list.filter(function (s) {
      return splitEmails(s.to + ';' + s.cc).some(function (x) { return x.toLowerCase() === e; });
    })[0];
    if (exact) return exact;
    return list.filter(function (s) {
      return str(s.domains).toLowerCase().split(/;\s*/).indexOf(d) >= 0;
    })[0] || null;
  }

  /* ── PO 번호 찾기 ─────────────────────────────── */
  // 기본 규칙: 'PO', 'P/O', 'Purchase Order', 'Order No' 다음에 오는 숫자 포함 토큰(가정 — 실제 PO 양식 확인 후 조정)
  var DEFAULT_PO_RE = /(?:\bP\.?\s?\/?O\.?|purchase\s+order|order)\s*(?:no\.?|number|#)?\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/]{3,}[0-9])/ig;
  // 실제 PO 체계(2026-09-29 메일 자료): 영문 1자 + 숫자 9자리(예: M·O·B 로 시작). 낱말 앞에 'PO' 가 없어도 찾습니다.
  var HD_PO_RE = /(?:^|[^A-Za-z0-9])([A-Z]\d{9})(?![A-Za-z0-9])/g;

  function poNumbersIn(text, customRegex) {
    var s = str(text);
    var hits = [];
    var res = customRegex ? [] : [new RegExp(HD_PO_RE.source, 'g'), new RegExp(DEFAULT_PO_RE.source, 'ig')];
    if (customRegex) {
      try { res.push(new RegExp(customRegex, 'g')); } catch (e) { return { list: [], error: '정규식 오류: ' + e.message }; }
    }
    res.forEach(function (re) {
      var m, guard = 0;
      while ((m = re.exec(s)) && guard++ < 500) {
        var v = (m[1] != null ? m[1] : m[0]).trim();
        if (/\d/.test(v)) hits.push({ v: v, i: m.index });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
    // 글 속 위치 순서로, 같은 번호는 한 번만
    hits.sort(function (a, b) { return a.i - b.i; });
    var found = [];
    hits.forEach(function (x) { if (found.indexOf(x.v) < 0) found.push(x.v); });
    return { list: found, error: '' };
  }

  /* ── PO 본문(구매발주서) 읽기 ─────────────────────────────── */
  // 실제 구매발주서(PDF, 2026-09-29 메일 자료) 레이아웃 기준.
  // pdf.js 로 읽은 글, PDF 뷰어에서 복사해 붙여넣은 글 모두 줄바꿈 모양이 달라서, 공백을 하나로 편 뒤 순서로 읽습니다.
  //   To <공급사> Date <YYYY-MM-DD> / Attn. <담당> Prepared by / Subject: Purchase Order (<PO>)
  //   Seller's name : <공급사> Address : ... Contract No. : <PO> Issued Date : <MON D, YYYY>
  //   1. Scope of Supply ... ITEM DESCRIPTION
  //   <SEQ> <PART NO.> <UNIT> <Q'ty> <Currency> <PRICE> <AMOUNT> <Delivery Date> <설명 [Mfr Part Number : X]>
  //   2. Contract Amount : <통화> <금액> <인코텀즈> <장소>, Incoterms 2010
  var UNIT_RE = '(?:EA|PC|PCS|SET|SETS|KG|G|M|MM|L|LOT|EACH|PR|PAIR|ROLL|BOX|UNIT|UNITS|MT|TON)';
  var INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DAT', 'DDP'];
  function flat(s) { return str(s).replace(/[ \s]+/g, ' '); }
  function num(v) { var n = toNumber(v); return n == null ? null : n; }

  function parsePoText(text) {
    var t = flat(text);
    var r = { po_no: '', refs: [], supplier: '', attn: '', po_date: '', issued_date: '', currency: '', amount: null,
      incoterms: '', incoterms_place: '', origin: '', payment: '', lines: [], delivery_date: '', warnings: [] };
    if (!t) { r.warnings.push('글이 비어 있습니다'); return r; }
    var m;
    // PO 번호: Contract No. → Our Ref. → Subject 괄호 → 일반 규칙 순
    // 번호에는 숫자가 하나 이상 있어야 합니다(복사한 글에서 「Our Ref. Prepared by」처럼 칸 이름이 이어 붙는 경우 제외)
    var NO = '([A-Z0-9\\-]*\\d[A-Z0-9\\-]*)';
    [new RegExp('Contract No\\.?\\s*:?\\s*' + NO, 'i'), new RegExp('Our Ref\\.?\\s*:?\\s*(?:Prepared by\\s+)?' + NO, 'i'), new RegExp('Purchase Order\\s*\\(\\s*' + NO + '\\s*\\)', 'i')].forEach(function (re) {
      var x = re.exec(t); if (x && r.refs.indexOf(x[1]) < 0) r.refs.push(x[1]);
    });
    r.po_no = r.refs[0] || poNumbersIn(t).list[0] || '';
    if (r.refs.length > 1) r.warnings.push('PO 번호가 서로 다르게 적혀 있습니다: ' + r.refs.join(', '));
    if ((m = /Seller['’`]?s\s+name\s*:\s*(.+?)\s+Address\s*:/i.exec(t))) r.supplier = m[1];
    else if ((m = /(?:^|\s)To\s+(.+?)\s+(?:Date|Fax)\b/.exec(t))) r.supplier = m[1];
    if ((m = /Attn\.?\s*:?\s*(.+?)\s+(?:Prepared by|CC\b|Subject)/i.exec(t))) r.attn = m[1];
    if ((m = /(?:^|\s)Date\s*:?\s*(\d{4}-\d{2}-\d{2})/.exec(t))) r.po_date = m[1];
    if ((m = /Issued Date\s*:?\s*([A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{4}[-.\/]\d{1,2}[-.\/]\d{1,2})/i.exec(t))) r.issued_date = toDate(m[1]);
    if ((m = new RegExp('Contract Amount\\s*:?\\s*([A-Z]{3})\\s*([\\d,]+(?:\\.\\d+)?)(?:\\s+(' + INCOTERMS.join('|') + ')\\b\\s*([^,0-9]*))?', 'i').exec(t))) {
      r.currency = m[1].toUpperCase(); r.amount = num(m[2]);
      if (m[3]) { r.incoterms = m[3].toUpperCase(); r.incoterms_place = str(m[4]).replace(/\s*Incoterms.*$/i, ''); }
    }
    if ((m = /Country of Origin\s*:\s*(.+?)\s+(?:The country|\d+\.\s)/i.exec(t))) r.origin = m[1];
    if ((m = /Payment Terms\s*:\s*(.+?)\s+\d+\.\s/i.exec(t))) r.payment = m[1];

    // 품목 줄: 「ITEM DESCRIPTION」 뒤 ~ 「Contract Amount」 앞
    var start = t.search(/ITEM DESCRIPTION/i); start = start < 0 ? 0 : start + 'ITEM DESCRIPTION'.length;
    var end = t.search(/Contract Amount/i); if (end < start) end = t.length;
    var sec = ' ' + t.slice(start, end);
    var re = new RegExp('\\s(\\d{1,3})\\s+([A-Z0-9][A-Z0-9\\-./]{2,})\\s+(' + UNIT_RE + ')\\s+([\\d,]+(?:\\.\\d+)?)\\s+([A-Z]{3})\\s+([\\d,]+(?:\\.\\d+)?)\\s+([\\d,]+(?:\\.\\d+)?)\\s+([A-Za-z]{3,9}\\.? \\d{1,2},? \\d{4}|\\d{4}[-./]\\d{1,2}[-./]\\d{1,2})', 'g');
    var hits = [], x;
    while ((x = re.exec(sec))) hits.push({ m: x, s: x.index, e: re.lastIndex });
    hits.forEach(function (hh, i) {
      var desc = sec.slice(hh.e, i + 1 < hits.length ? hits[i + 1].s : sec.length).trim().replace(/\s+\d{1,2}\.$/, '');
      var mfr = /\[\s*Mfr\.?\s*Part\s*(?:Number|No\.?)\s*:\s*([^\]]+?)\s*\]/i.exec(desc);
      var L = {
        seq: +hh.m[1], part: hh.m[2], unit: hh.m[3], qty: num(hh.m[4]), currency: hh.m[5], price: num(hh.m[6]), amount: num(hh.m[7]),
        delivery: toDate(hh.m[8]), desc: desc.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim(), mfr_part: mfr ? mfr[1] : ''
      };
      if (L.qty != null && L.price != null && L.amount != null && Math.abs(L.qty * L.price - L.amount) > Math.max(1, L.amount * 0.001)) {
        r.warnings.push(L.seq + '번 줄: 수량×단가(' + round2(L.qty * L.price) + ')와 금액(' + L.amount + ')이 다릅니다');
      }
      r.lines.push(L);
    });
    // PDF 뷰어에서 복사하면 표가 열 단위로 끊겨 「SEQ PART UNIT Q'ty Currency 설명」 묶음과
    // 「PRICE AMOUNT Delivery Date」 묶음이 따로 나옵니다. 그때는 두 묶음을 나온 순서대로 짝짓습니다.
    if (!hits.length) {
      var reA = new RegExp('\\s(\\d{1,3})\\s+([A-Z0-9][A-Z0-9\\-./]{2,})\\s+(' + UNIT_RE + ')\\s+([\\d,]+(?:\\.\\d+)?)\\s+([A-Z]{3})\\s', 'g');
      var reB = /([\d,]*\d(?:\.\d+)?)\s+([\d,]*\d(?:\.\d+)?)\s+([A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{4}[-.\/]\d{1,2}[-.\/]\d{1,2})/g;
      var as = [], bs = [], y;
      while ((y = reA.exec(sec))) as.push({ m: y, s: y.index, e: reA.lastIndex });
      var afterA = as.length ? as[as.length - 1].e : 0;
      as.forEach(function (a, i) {
        var d = sec.slice(a.e, i + 1 < as.length ? as[i + 1].s : sec.length);
        var cut = d.search(/\s(?:PRICE|AMOUNT|Contract\s+Delivery|REMARK)\b|\s[\d,]*\d(?:\.\d+)?\s+[\d,]*\d(?:\.\d+)?\s+[A-Za-z]{3,9}\.? \d{1,2},? \d{4}/);
        a.desc = (cut >= 0 ? d.slice(0, cut) : d).trim();
      });
      reB.lastIndex = afterA;
      while ((y = reB.exec(sec))) bs.push(y);
      as.forEach(function (a, i) {
        var b = bs[i] || null;
        var mfr = /\[\s*Mfr\.?\s*Part\s*(?:Number|No\.?)\s*:\s*([^\]]+?)\s*\]/i.exec(a.desc);
        r.lines.push({ seq: +a.m[1], part: a.m[2], unit: a.m[3], qty: num(a.m[4]), currency: a.m[5], price: b ? num(b[1]) : null, amount: b ? num(b[2]) : null,
          delivery: b ? toDate(b[3]) : '', desc: a.desc.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim(), mfr_part: mfr ? mfr[1] : '' });
      });
      if (as.length && bs.length !== as.length) r.warnings.push('단가·금액·납기 묶음 수(' + bs.length + ')가 품목 수(' + as.length + ')와 달라 확인이 필요합니다');
    }
    if (!r.lines.length) r.warnings.push('품목 줄을 찾지 못했습니다(스캔본이거나 양식이 다름)');
    else {
      var sum = r.lines.reduce(function (a, l) { return a + (l.amount || 0); }, 0);
      if (r.amount != null && Math.abs(sum - r.amount) > 1) r.warnings.push('품목 금액 합계(' + round2(sum) + ')와 Contract Amount(' + r.amount + ')가 다릅니다');
      var ds = r.lines.map(function (l) { return l.delivery; }).filter(Boolean).sort();
      r.delivery_date = ds[0] || '';
      if (ds.length && ds[0] !== ds[ds.length - 1]) r.warnings.push('줄마다 납기가 다릅니다(' + ds[0] + ' ~ ' + ds[ds.length - 1] + ') — 가장 이른 날을 PO 납기로 둡니다');
    }
    return r;
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  // 대장 「품목」 칸용 한 줄 요약
  function itemSummary(lines) {
    if (!lines || !lines.length) return '';
    return lines[0].part + (lines.length > 1 ? ' 외 ' + (lines.length - 1) + '건' : '');
  }

  /* ── 날짜 더하기·지역 운송기간·L/C 일정 (항차 매뉴얼 규칙) ─────────────────────────────── */
  function addDays(iso, n) {
    var d = dayNum(iso); if (d == null || n == null || isNaN(n)) return '';
    var x = new Date((d + Number(n)) * DAY);
    return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate());
  }
  function addWorkdays(iso, n) {
    var cur = iso, left = n;
    if (dayNum(iso) == null) return '';
    while (left > 0) { cur = addDays(cur, 1); var wd = new Date(dayNum(cur) * DAY).getUTCDay(); if (wd !== 0 && wd !== 6) left--; }
    return cur;
  }
  function addMonths(iso, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return '';
    var y = +m[1], mo = +m[2] - 1 + n, d = +m[3];
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return y + '-' + pad(mo + 1) + '-' + pad(Math.min(d, last));
  }
  // 매뉴얼 표 「지역별 평균 운송기간」: 미국 60일, 유럽 90일, 일본·중국 15일, 인도 45일
  var REGIONS = [
    { key: 'us', label: '미국', setting: 'transit_us', words: ['usa', 'us', 'u.s.a', 'u.s.a.', 'united states', 'america', '미국'] },
    { key: 'eu', label: '유럽', setting: 'transit_eu', words: ['germany', 'italy', 'france', 'spain', 'uk', 'united kingdom', 'england', 'netherlands', 'belgium', 'sweden', 'finland', 'denmark', 'norway', 'poland', 'czech', 'austria', 'switzerland', 'portugal', 'hungary', 'slovakia', 'europe', '독일', '이탈리아', '프랑스', '스페인', '영국', '네덜란드', '벨기에', '스웨덴', '핀란드', '덴마크', '폴란드', '체코', '오스트리아', '스위스', '유럽'] },
    { key: 'jpcn', label: '일본·중국', setting: 'transit_jpcn', words: ['japan', 'china', 'prc', '일본', '중국'] },
    { key: 'in', label: '인도', setting: 'transit_in', words: ['india', '인도'] }
  ];
  function regionOf(country) {
    var c = str(country).toLowerCase().replace(/\s+/g, ' ');
    if (!c) return null;
    var cn = c.replace(/[.\s]/g, '');
    return REGIONS.filter(function (r) {
      return r.words.some(function (w) { var wn = w.replace(/[.\s]/g, ''); return wn.length <= 3 ? cn === wn : cn.indexOf(wn) >= 0; });
    })[0] || null;
  }
  function transitDays(country, st) {
    var r = regionOf(country); st = st || defaultSettings();
    return r ? { region: r.label, days: Number(st[r.setting]) } : null;
  }
  // 매뉴얼: Delivery Date(PO Sheet) − 운송기간 = Incoterms Date / ETA 는 ETD(없으면 B/L Date) + 운송일
  function exwTarget(deliveryIso, country, st) { var t = transitDays(country, st); return t && deliveryIso ? addDays(deliveryIso, -t.days) : ''; }
  function etaFromEtd(etdIso, country, st) { var t = transitDays(country, st); return t && etdIso ? addDays(etdIso, t.days) : ''; }
  // 매뉴얼 L/C 요청: 개설일 = 신청일 + 2영업일, 최종선적일 = 개설일 + 6개월, 유효기일 = 최종선적일 + 3주
  function lcDates(requestIso) {
    var open = addWorkdays(requestIso, 2);
    var ship = addMonths(open, 6);
    return { open: open, lastShipment: ship, expiry: addDays(ship, 21) };
  }

  // 파일명에서 PO 번호 후보: 확장자를 떼고, 숫자를 포함한 5자 이상 토큰
  function poFromFileName(name, customRegex) {
    var base = str(name).replace(/\.[a-z0-9]+$/i, '');
    if (customRegex) {
      var r = poNumbersIn(base, customRegex);
      return r.list[0] || '';
    }
    var r2 = poNumbersIn(base.replace(/_/g, ' '));
    if (r2.list[0]) return r2.list[0];
    var toks = base.split(/[\s_]+/).filter(function (t) { return t.length >= 5 && /\d/.test(t) && /^[A-Za-z0-9\-\/]+$/.test(t); });
    return toks[0] || '';
  }

  // PO PDF 한 건: 파일명과 본문으로 PO 번호·업체를 찾습니다.
  function matchPoFile(file, suppliers, settings) {
    var rx = settings && settings.po_regex;
    var fromName = poFromFileName(file.name, rx);
    var fromText = poNumbersIn(file.text || '', rx).list;
    var po = fromName || fromText[0] || '';
    var sup = findSupplierInText(suppliers, file.name) || findSupplierInText(suppliers, file.text || '');
    var issues = [];
    if (!po) issues.push('PO 번호를 찾지 못했습니다');
    if (fromName && fromText.length && fromText.indexOf(fromName) < 0) issues.push('파일명과 본문의 PO 번호가 다릅니다(본문: ' + fromText[0] + ')');
    if (!sup) issues.push('업체를 찾지 못했습니다');
    else if (!sup.to) issues.push('업체 수신 이메일이 없습니다');
    return { file: file.name, po_no: po, supplier_code: sup ? sup.code : '', candidates: fromText, issues: issues };
  }

  /* ── 템플릿·메일 ─────────────────────────────── */
  function fillTemplate(tpl, vars) {
    return str(tpl).replace(/\{([A-Z_]+)\}/g, function (all, k) {
      return vars[k] != null ? String(vars[k]) : all;
    }).replace(/\n{3,}/g, '\n\n');
  }

  function checklistText(s) {
    var lines = str(s && s.checklist).split(/\r?\n|;\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!lines.length) return '';
    return 'Please note:\n' + lines.map(function (x) { return '- ' + x; }).join('\n');
  }

  function mailVars(settings, supplier, extra) {
    var st = settings || {};
    var v = {
      SENDER: st.sender_name || '', DEPT: st.sender_dept || '', COMPANY: st.sender_company || '',
      SUPPLIER: supplier ? supplier.name : '', CONTACT: (supplier && supplier.contact) || 'Sir or Madam',
      CODE: supplier ? supplier.code : '', OC_DAYS: st.oc_request_days != null && st.oc_request_days !== '' ? st.oc_request_days : 7,
      CHECKLIST: checklistText(supplier)
    };
    Object.keys(extra || {}).forEach(function (k) { v[k] = extra[k]; });
    return v;
  }

  // UTF-8 바이트
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return Buffer.from(s, 'utf8');
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63];
    }
    var rest = bytes.length - i;
    if (rest === 1) { var a = bytes[i] << 16; out += B64[a >> 18 & 63] + B64[a >> 12 & 63] + '=='; }
    else if (rest === 2) { var b = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[b >> 18 & 63] + B64[b >> 12 & 63] + B64[b >> 6 & 63] + '='; }
    return out;
  }
  function unbase64(s) {
    s = str(s).replace(/[^A-Za-z0-9+\/]/g, '');
    var out = [], buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      buf = (buf << 6) | B64.indexOf(s[i]); bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
    }
    return new Uint8Array(out);
  }
  function fromUtf8(bytes, charset) {
    try { return new TextDecoder(charset || 'utf-8').decode(bytes); }
    catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }
  function wrap76(s) { return s.replace(/.{1,76}/g, '$&\r\n').replace(/\r\n$/, ''); }
  function encodeWord(s) {
    return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + base64(utf8(s)) + '?=';
  }
  function rfcDate(d) {
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-';
    off = Math.abs(off);
    return days[d.getDay()] + ', ' + d.getDate() + ' ' + mons[d.getMonth()] + ' ' + d.getFullYear() + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + sign + pad(Math.floor(off / 60)) + pad(off % 60);
  }

  // Outlook 에서 「보내기 전 초안」으로 열리는 .eml 텍스트(X-Unsent: 1). 발송은 하지 않습니다.
  // attachments: [{ name, type, bytes(Uint8Array) }]
  function buildEml(m, now) {
    var boundary = '----=_data0912_' + Math.abs(hashCode(m.subject + (m.to || ''))).toString(16);
    var h = [];
    h.push('X-Unsent: 1');
    if (m.from) h.push('From: ' + m.from);
    h.push('To: ' + (m.to || ''));
    if (m.cc) h.push('Cc: ' + m.cc);
    h.push('Subject: ' + encodeWord(m.subject || ''));
    h.push('Date: ' + rfcDate(now || new Date()));
    h.push('MIME-Version: 1.0');
    var bodyPart = 'Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
      wrap76(base64(utf8(str(m.body).replace(/\r?\n/g, '\r\n'))));
    var atts = m.attachments || [];
    if (!atts.length) return h.join('\r\n') + '\r\n' + bodyPart + '\r\n';
    h.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
    var parts = ['--' + boundary + '\r\n' + bodyPart];
    atts.forEach(function (a) {
      var fname = encodeWord(a.name);
      parts.push('--' + boundary + '\r\nContent-Type: ' + (a.type || 'application/octet-stream') + '; name="' + fname + '"\r\n' +
        'Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="' + fname + '"\r\n\r\n' + wrap76(base64(a.bytes)));
    });
    return h.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + '\r\n--' + boundary + '--\r\n';
  }

  function hashCode(s) { var h = 0; s = str(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  function safeFileName(s) { return str(s).replace(/[\\\/:*?"<>|\r\n]+/g, '_').slice(0, 120) || 'mail'; }

  function poMailDraft(po, supplier, db, attachment) {
    var t = db.templates.po_mail;
    var vars = mailVars(db.settings, supplier, { PO: po.po_no, EXW: po.exw_promised || '' });
    return {
      from: db.settings.sender_email || '',
      to: supplier ? supplier.to : '',
      cc: supplier ? supplier.cc : '',
      subject: fillTemplate(t.subject, vars),
      body: fillTemplate(t.body, vars),
      attachments: attachment ? [attachment] : [],
      fileName: safeFileName('PO_' + po.po_no + '_' + (supplier ? supplier.name : '업체미상')) + '.eml'
    };
  }

  // 한 업체의 PO 여러 건을 메일 한 통으로(실제 발주 메일 방식: 제목·본문에 PO 번호를 쉼표로 나열, PDF 여러 개 첨부)
  function poMailDraftGroup(pos, supplier, db, attachments) {
    var t = db.templates.po_mail;
    var nos = pos.map(function (p) { return p.po_no; });
    var vars = mailVars(db.settings, supplier, { PO: nos.join(', '), EXW: '' });
    return {
      from: db.settings.sender_email || '',
      to: supplier ? supplier.to : '',
      cc: supplier ? supplier.cc : '',
      subject: fillTemplate(t.subject, vars),
      body: fillTemplate(t.body, vars),
      attachments: attachments || [],
      fileName: safeFileName('PO_' + nos.join('_') + '_' + (supplier ? supplier.name : '업체미상')) + '.eml'
    };
  }

  function situationDraft(key, po, supplier, db) {
    var t = db.templates[key];
    var vars = mailVars(db.settings, supplier, { PO: po.po_no, EXW: po.exw_promised || '(TBD)', PO_LIST: '- ' + po.po_no });
    return {
      from: db.settings.sender_email || '', to: supplier ? supplier.to : '', cc: supplier ? supplier.cc : '',
      subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars), attachments: [],
      fileName: safeFileName(key + '_' + po.po_no) + '.eml'
    };
  }

  /* ── 관리 대장 ─────────────────────────────── */
  function yes(v) {
    if (v === true) return true;
    var s = norm(v);
    return ['y', 'yes', 'o', 'true', '1', '수신', '완료', 'received', 'v', '✓'].indexOf(s) >= 0;
  }

  function cleanPo(r, suppliers) {
    var sup = r.supplier_code ? supplierByCode(suppliers, str(r.supplier_code)) : null;
    if (!sup && r.supplier_name) sup = suppliers.filter(function (s) { return norm(s.name) === norm(r.supplier_name); })[0] || null;
    return {
      po_no: str(r.po_no),
      supplier_code: sup ? sup.code : str(r.supplier_code),
      item: str(r.item),
      po_date: toDate(r.po_date),
      sent_date: toDate(r.sent_date),
      oc_date: toDate(r.oc_date),
      exw_promised: toDate(r.exw_promised),
      exw_actual: toDate(r.exw_actual),
      etd: toDate(r.etd),
      an_received: yes(r.an_received),
      docs_received: yes(r.docs_received),
      note: str(r.note),
      delivery_date: toDate(r.delivery_date),   // PO 납기(구매발주서의 Contract Delivery Date)
      oc_no: str(r.oc_no),                      // 공급사 OC 번호(OC 파일의 INV # 등)
      followup_date: toDate(r.followup_date),
      lines: Array.isArray(r.lines) ? r.lines : [],               // PO 품목 줄(PO 본문 읽기 결과)
      voyage: r.voyage && typeof r.voyage === 'object' ? r.voyage : {},  // 항차 체크리스트 {단계: 완료일}
      oc_lines: Array.isArray(r.oc_lines) ? r.oc_lines : [],       // OC 품목(품번·수량) — 수량 대조용
      exw_plan: r.exw_plan && typeof r.exw_plan === 'object' ? r.exw_plan : {},  // Part No. 별 출하 일정 [{date, qty}] (Cummins 오더 현황)
      bl_no: str(r.bl_no),                      // B/L 번호(선적서류·A/N) — A/N 을 PO 에 붙이는 두 번째 열쇠
      eta: toDate(r.eta)                        // 도착 예정일(A/N 의 가장 최근 ETA)
    };
  }

  // 같은 PO 번호는 비어 있지 않은 값으로 덮어씁니다.
  function upsertPos(list, incoming) {
    var res = list.slice();
    var idx = {};
    res.forEach(function (p, i) { idx[p.po_no] = i; });
    var added = 0, updated = 0;
    incoming.forEach(function (p) {
      if (!p.po_no) return;
      if (idx[p.po_no] != null) {
        var cur = Object.assign({}, res[idx[p.po_no]]);
        Object.keys(p).forEach(function (k) {
          if (typeof p[k] === 'boolean') { if (p[k]) cur[k] = true; }
          else if (Array.isArray(p[k])) { if (p[k].length) cur[k] = p[k]; }
          else if (p[k] && typeof p[k] === 'object') { if (Object.keys(p[k]).length) cur[k] = Object.assign({}, cur[k] || {}, p[k]); }
          else if (p[k] !== '' && p[k] != null) cur[k] = p[k];
        });
        res[idx[p.po_no]] = cur; updated++;
      } else { idx[p.po_no] = res.length; res.push(Object.assign(cleanPo({}, []), p)); added++; }
    });
    return { pos: res, added: added, updated: updated };
  }

  // PO 한 건의 경고 표시. 여러 개가 동시에 붙을 수 있습니다.
  function poFlags(po, today, st) {
    st = st || defaultSettings();
    var f = [];
    if (!po.sent_date) f.push({ code: 'unsent', label: '미송부', level: 'muted' });
    if (po.sent_date && !po.oc_date) {
      var wait = daysBetween(po.sent_date, today);
      if (wait != null && wait > Number(st.oc_wait_days)) f.push({ code: 'oc_overdue', label: 'OC 미접수 ' + wait + '일', level: 'danger' });
      else f.push({ code: 'oc_wait', label: 'OC 대기', level: 'muted' });
    }
    if (po.exw_promised && !po.exw_actual) {
      var left = daysBetween(today, po.exw_promised);
      if (left < -Number(st.exw_grace_days)) f.push({ code: 'exw_late', label: 'EXW 지연 ' + (-left) + '일', level: 'danger' });
      else if (left <= Number(st.exw_soon_days)) f.push({ code: 'exw_soon', label: 'EXW 임박 D-' + Math.max(left, 0), level: 'warn' });
    }
    if (po.exw_actual && !po.docs_received) f.push({ code: 'docs_missing', label: '선적서류 미수신', level: 'warn' });
    if (po.exw_actual && !po.an_received) f.push({ code: 'an_missing', label: 'A/N 미수신', level: 'warn' });
    if (po.exw_actual && po.an_received && po.docs_received) f.push({ code: 'done', label: '선적 서류 완료', level: 'ok' });
    return f;
  }

  function hasFlag(po, code, today, st) {
    return poFlags(po, today, st).some(function (x) { return x.code === code; });
  }

  // OC 접수율 = OC 수령 건 / 송부 건 (송부일이 있는 PO 기준)
  function ocStats(pos, today, st) {
    var sent = pos.filter(function (p) { return !!p.sent_date; });
    var got = sent.filter(function (p) { return !!p.oc_date; });
    var overdue = sent.filter(function (p) { return hasFlag(p, 'oc_overdue', today, st); });
    var lead = got.map(function (p) { return daysBetween(p.sent_date, p.oc_date); }).filter(function (x) { return x != null && x >= 0; });
    return {
      sent: sent.length, received: got.length, overdue: overdue.length,
      rate: sent.length ? got.length / sent.length : null,
      avgLeadDays: lead.length ? lead.reduce(function (a, b) { return a + b; }, 0) / lead.length : null
    };
  }

  // EXW 준수율 = 약속일 + 허용 일수 이내 출고 건 / 출고 완료 건(약속일·실제일 모두 있는 건)
  // 평균 지연일 = 평가 대상 전체의 지연일 평균(약속보다 이르거나 같으면 0일로 셈)
  // 지연 건 평균 = 지연된 건만의 평균 지연일
  function exwStats(pos, today, st) {
    st = st || defaultSettings();
    var grace = Number(st.exw_grace_days) || 0;
    var ev = pos.filter(function (p) { return p.exw_promised && p.exw_actual; });
    var delays = ev.map(function (p) { return Math.max(0, daysBetween(p.exw_promised, p.exw_actual)); });
    var onTime = delays.filter(function (d) { return d <= grace; }).length;
    var late = delays.filter(function (d) { return d > grace; });
    var openLate = pos.filter(function (p) { return hasFlag(p, 'exw_late', today, st); }).length;
    function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
    return {
      evaluated: ev.length, onTime: onTime, late: late.length,
      rate: ev.length ? onTime / ev.length : null,
      avgDelay: avg(delays), avgDelayLateOnly: avg(late),
      openLate: openLate
    };
  }

  function statsBySupplier(pos, suppliers, today, st) {
    var codes = [];
    pos.forEach(function (p) { if (codes.indexOf(p.supplier_code) < 0) codes.push(p.supplier_code); });
    return codes.map(function (c) {
      var mine = pos.filter(function (p) { return p.supplier_code === c; });
      var s = supplierByCode(suppliers, c);
      return { code: c, name: s ? s.name : (c || '(업체 미지정)'), count: mine.length, oc: ocStats(mine, today, st), exw: exwStats(mine, today, st) };
    }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  }

  // OC 미접수 건을 업체별로 묶어 팔로우업 초안 목록을 만듭니다.
  function ocFollowups(db, today) {
    var groups = {};
    db.pos.forEach(function (p) {
      if (!hasFlag(p, 'oc_overdue', today, db.settings)) return;
      (groups[p.supplier_code] = groups[p.supplier_code] || []).push(p);
    });
    return Object.keys(groups).sort().map(function (code) {
      var s = supplierByCode(db.suppliers, code);
      var list = groups[code];
      var poList = list.map(function (p) {
        return '- PO ' + p.po_no + (p.item ? ' (' + p.item + ')' : '') + ', sent on ' + p.sent_date;
      }).join('\n');
      var t = db.templates.oc_followup;
      var vars = mailVars(db.settings, s, { PO_LIST: poList, PO: list.map(function (p) { return p.po_no; }).join(', ') });
      return {
        supplier_code: code, supplier: s, pos: list,
        maxWait: Math.max.apply(null, list.map(function (p) { return daysBetween(p.sent_date, today); })),
        draft: {
          from: db.settings.sender_email || '', to: s ? s.to : '', cc: s ? s.cc : '',
          subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars), attachments: [],
          fileName: safeFileName('OC_followup_' + (s ? s.name : code)) + '.eml'
        },
        problem: !s ? '업체 마스터에 없는 업체 코드입니다' : (!s.to ? '수신 이메일이 없습니다' : '')
      };
    });
  }

  /* ── Weekly Order Status: Promise Date 변경 ─────────────────────────────── */
  // 실제 파일(Cummins Integrated Order Status, 2026-09-29 메일 자료)에서 확인한 것:
  //  - 한 파일에 주차별 시트(wk38, wk43 …)가 여러 개, 머리글이 1행 또는 2행
  //  - 같은 Customer PO + Part No. 가 여러 행(분할 출고 — 1OM#·SO# 가 다름) → PO·품번만으로는 행이 겹침
  //  - Promise Date 칸에 글이 들어가기도 함: 'cancelled', '2/29/2024=>2/1'(칸 안에 이전→변경 기록)
  //  - Remarks 에 '9/12->10/25', '6/30=>8/17로 변경' 같은 변경 기록
  // 그래서 PO + (라인 또는 품번) + 1OM# + SO# 로 먼저 맞추고, 남은 행은 PO + (라인 또는 품번) 의 나온 순서로 다시 맞춥니다.
  var ARROW_RE = /\s*(?:=>|->|→|~>)\s*/;
  var MD_RE = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;

  // 연도 없는 'M/D' 를 기준일에 가까운 연도로(기준일보다 6개월 넘게 앞서면 다음 해)
  function mdWithYear(s, refIso, dayFirst) {
    var m = MD_RE.exec(str(s));
    if (!m) return '';
    if (m[3]) return dayFirst ? ymd(m[3], m[2], m[1]) : ymd(m[3], m[1], m[2]);
    var ry = refIso ? +refIso.slice(0, 4) : new Date().getFullYear();
    var mo = dayFirst ? m[2] : m[1], d = dayFirst ? m[1] : m[2];
    var cand = ymd(ry, mo, d);
    if (refIso && cand) {
      var diff = daysBetween(refIso, cand);
      if (diff < -183) cand = ymd(ry + 1, mo, d);
      else if (diff > 183) cand = ymd(ry - 1, mo, d);
    }
    return cand;
  }

  // Promise Date 칸 한 개 → { date, prev, cancelled, raw }
  function parsePromiseCell(v, dayFirst) {
    var raw = str(v);
    if (typeof v === 'number' || v instanceof Date) return { date: toDate(v, dayFirst), prev: '', cancelled: false, raw: raw };
    if (/cancel/i.test(raw)) return { date: '', prev: '', cancelled: true, raw: raw };
    var parts = raw.split(ARROW_RE);
    if (parts.length >= 2) {
      var prev = toDate(parts[0], dayFirst) || mdWithYear(parts[0], '', dayFirst);
      var last = parts[parts.length - 1];
      var now = toDate(last, dayFirst) || mdWithYear(last, prev, dayFirst);
      return { date: now, prev: prev, cancelled: false, raw: raw };
    }
    return { date: toDate(raw, dayFirst), prev: '', cancelled: false, raw: raw };
  }

  function weeklyRow(r, dayFirst) {
    var p = parsePromiseCell(r.promise, dayFirst);
    return {
      po: str(r.po), line: str(r.line), part: str(r.part), om: str(r.om), so: str(r.so),
      qty: r.qty == null ? '' : r.qty, status: str(r.status), remarks: str(r.remarks), req: toDate(r.req, dayFirst),
      promise: p.date, prevInCell: p.prev, cancelled: p.cancelled, raw: p.raw
    };
  }
  function weeklyKey(r) { return str(r.po) + '|' + (str(r.line) || str(r.part)); }

  function compareWeekly(oldRows, newRows, dayFirst) {
    var A = oldRows.filter(function (r) { return str(r.po); }).map(function (r) { return weeklyRow(r, dayFirst); });
    var B = newRows.filter(function (r) { return str(r.po); }).map(function (r) { return weeklyRow(r, dayFirst); });
    var dups = 0;
    function countDups(rows) { var s = {}; rows.forEach(function (r) { var k = weeklyKey(r); s[k] = (s[k] || 0) + 1; }); Object.keys(s).forEach(function (k) { if (s[k] > 1) dups += s[k] - 1; }); }
    countDups(A); countDups(B);
    var pairs = [], usedA = [], usedB = [];
    // 1차: PO|라인·품번|1OM#|SO# 와 같은 키 안의 순서, 2차: PO|라인·품번 과 남은 행의 순서
    [function (r) { return weeklyKey(r) + '|' + r.om + '|' + r.so; }, weeklyKey].forEach(function (keyFn) {
      var idx = {};
      A.forEach(function (r, i) { if (usedA[i]) return; var k = keyFn(r); (idx[k] = idx[k] || []).push(i); });
      B.forEach(function (r, j) {
        if (usedB[j]) return;
        var list = idx[keyFn(r)];
        if (list && list.length) { var i = list.shift(); usedA[i] = usedB[j] = true; pairs.push([A[i], r]); }
      });
    });
    var changed = [], same = 0;
    pairs.forEach(function (pr) {
      var o = pr[0], n = pr[1];
      var sameDate = o.promise && n.promise ? o.promise === n.promise : (o.raw === n.raw && o.cancelled === n.cancelled);
      if (sameDate && o.cancelled === n.cancelled) { same++; return; }
      var d = daysBetween(o.promise, n.promise);
      var dir = n.cancelled && !o.cancelled ? 'cancel' : d == null ? 'check' : d > 0 ? 'later' : d < 0 ? 'earlier' : 'same';
      changed.push({ po: n.po, line: n.line, part: n.part || o.part, om: n.om, so: n.so, qty: n.qty, status: n.status, remarks: n.remarks,
        old: o.promise || o.raw, new: n.promise || n.raw, diffDays: d, dir: dir });
    });
    var added = B.filter(function (r, j) { return !usedB[j]; });
    var removed = A.filter(function (r, i) { return !usedA[i]; });
    changed.sort(function (x, y) { return (y.diffDays || 0) - (x.diffDays || 0); });
    return { changed: changed, added: added, removed: removed, same: same, duplicates: dups ? ['같은 PO·품번(라인)이 여러 행: ' + dups + '행 — 1OM#·SO#, 없으면 나온 순서로 맞췄습니다'] : [] };
  }

  var DIR_LABEL = { later: '밀림', earlier: '당김', cancel: '취소', check: '날짜 확인', same: '같음' };

  // 한 주 파일만 있을 때: 칸 안(2/29=>2/1)·Remarks(9/12->10/25) 에 적힌 변경 기록을 모읍니다.
  function weeklyInFileChanges(rows, dayFirst) {
    var out = [];
    rows.forEach(function (r) {
      if (!str(r.po)) return;
      var w = weeklyRow(r, dayFirst);
      var ref = w.promise || w.req;
      if (w.prevInCell) {
        out.push({ po: w.po, part: w.part, so: w.so, source: 'Promise Date 칸', old: w.prevInCell, new: w.promise || w.raw.split(ARROW_RE).pop(), diffDays: daysBetween(w.prevInCell, w.promise), note: w.raw });
        return;
      }
      if (w.cancelled) { out.push({ po: w.po, part: w.part, so: w.so, source: 'Promise Date 칸', old: '', new: 'cancelled', diffDays: null, note: w.raw }); return; }
      // '7/11=> 7/28 => 7/21' 처럼 여러 번 바뀐 기록은 처음 → 마지막
      var D = '\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?';
      var m = new RegExp('(' + D + ')((?:' + ARROW_RE.source + D + ')+)').exec(w.remarks);
      if (m) {
        var chain = m[2].split(ARROW_RE).filter(Boolean);
        var o = mdWithYear(m[1], ref, dayFirst), n = mdWithYear(chain[chain.length - 1], o || ref, dayFirst);
        out.push({ po: w.po, part: w.part, so: w.so, source: 'Remarks', old: o, new: n, diffDays: daysBetween(o, n), note: w.remarks });
      }
    });
    return out;
  }

  /* ── Cummins 오더 현황 → 대장 EXW DATE (2026-09-29 메일 추가 요청 2) ─────────────────────────────── */
  // 요청: 「wk38 분석E」 시트에서 Status=Undispatched · 구분=HCE 만 골라 Promise Date 를 EXW DATE 로 입력.
  //       노란 줄 = EXW 변경 건(확인 요망). PO·Part No. 수량에 맞게 — 분할 선적이면 날짜별 수량이 PO·OC 수량과 다를 수 있어 확인.
  // 실물 확인: 2행 머리글, Status 는 수식(=IF(COUNTBLANK(INV#)…,"Abnormal","Undispatched"),"Dispatched")의 저장된 값.
  var CUM_COLS = {
    gubun: /^구분$/, status: /^status$/, po: /^customerpo$|^po$|^pono$/, part: /^partno$|^part$|^partnumber$/, qty: /^qty$|^quantity$/,
    promise: /^promisedate$/, remarks: /^remarks?$/, so: /^so#?$/, om: /^1om#?$/, inv: /^inv#$/, req: /^reqdate$/
  };
  // grid: 행 배열(엑셀 1행부터, 빈 행 포함), yellow: { 엑셀 행번호: true }
  function cumminsRows(grid, yellow) {
    yellow = yellow || {};
    var hi = -1, col = {};
    for (var i = 0; i < Math.min(grid.length, 15) && hi < 0; i++) {
      var c = {};
      (grid[i] || []).forEach(function (v, j) { var n = norm(v); Object.keys(CUM_COLS).forEach(function (k) { if (c[k] == null && CUM_COLS[k].test(n)) c[k] = j; }); });
      if (c.po != null && c.part != null && c.promise != null) { hi = i; col = c; }
    }
    if (hi < 0) return { rows: [], headerRow: 0, error: 'Customer PO · Part No. · Promise Date 머리글을 찾지 못했습니다' };
    var rows = [];
    for (var r = hi + 1; r < grid.length; r++) {
      var g = grid[r] || [];
      var po = str(g[col.po]), part = str(g[col.part]);
      if (!po || !part) continue;                     // 합계·통계 줄은 PO·품번이 없어 빠집니다
      var p = parsePromiseCell(g[col.promise]);
      var at = function (k) { return col[k] == null ? '' : g[col[k]]; };
      rows.push({ rowNo: r + 1, po: po, part: part, gubun: str(at('gubun')), status: str(at('status')), qty: toNumber(at('qty')),
        promise: p.date, promiseRaw: p.raw, cancelled: p.cancelled, remarks: str(at('remarks')), so: str(at('so')), om: str(at('om')),
        inv: str(at('inv')), yellow: !!yellow[r + 1] });
    }
    return { rows: rows, headerRow: hi + 1, error: '', hasInv: col.inv != null };
  }
  function cumKey(po, part) { return str(po).toUpperCase() + '|' + norm(part); }
  function sameWord(a, b) { return str(a).toLowerCase().replace(/\s+/g, '') === str(b).toLowerCase().replace(/\s+/g, ''); }

  // 파일의 Status 수식(실물): =IF(COUNTBLANK(INV#)=1, IF(Promise Date<TODAY(),"Abnormal","Undispatched"), "Dispatched")
  // 엑셀은 열 때마다 TODAY() 로 다시 계산하지만, 파일 안에 저장된 값은 마지막으로 저장한 날 기준입니다.
  // 수강생 답(09-29): 「금일 기준으로 선적되었는지 확인하는 파일」 → 기준일(asOf)로 같은 식을 다시 계산합니다.
  // Promise Date 칸이 비면 엑셀은 0 으로 비교해 Abnormal, 글자(cancelled 등)는 숫자보다 크게 비교돼 Undispatched 입니다.
  // 수식 대신 손으로 적은 값(실물 분석 시트의 'x' 등)은 사람이 일부러 적은 것이라 그대로 둡니다.
  var CUM_STATUS_FORMULA = /^(undispatched|abnormal|dispatched)?$/;
  function cumminsStatusAsOf(r, asOf) {
    if (!CUM_STATUS_FORMULA.test(str(r.status).toLowerCase())) return str(r.status);
    if (str(r.inv)) return 'Dispatched';
    if (r.promise) return r.promise < asOf ? 'Abnormal' : 'Undispatched';
    return str(r.promiseRaw) ? 'Undispatched' : 'Abnormal';
  }

  /* 지난주 파일과 비교(수강생 답 09-29: 「전 주 송부받은 파일과 다른 경우에도 노란색」)
     맞추는 키: Customer PO + Part No. + 1OM# + SO# — 분할 선적은 같은 PO·품번이 SO# 로 나뉘므로 SO# 까지 넣어야 줄이 1:1 로 맞습니다.
       한 주 사이에 SO# 가 새로 붙는 줄이 있어, 남은 줄은 Customer PO + Part No. 의 나온 순서로 한 번 더 맞춥니다(「Promise Date」 화면과 같은 방식).
     비교하는 칸: Promise Date(= SRM 에 넣는 EXW DATE)와 QTY(그 날짜의 선적 수량). SRM 에 들어가는 값이 이 두 개이기 때문입니다.
       Status 는 수식이라 날짜만 지나도 바뀌고, Remarks 는 자유 글이라 비교하지 않습니다. 지난주에 없던 줄(분할 추가 등)도 「다름」입니다. */
  function cumminsWeekDiff(prevRows, curRows) {
    var byRow = {}, used = {}, usedCur = {};
    var k1 = function (r) { return cumKey(r.po, r.part) + '|' + str(r.om) + '|' + str(r.so); };
    var k2 = function (r) { return cumKey(r.po, r.part); };
    var pairs = [];
    [k1, k2].forEach(function (kf) {
      var idx = {};
      prevRows.forEach(function (r, i) { if (!used[i]) (idx[kf(r)] = idx[kf(r)] || []).push(i); });
      curRows.forEach(function (r, j) {
        if (usedCur[j]) return;
        var list = idx[kf(r)];
        if (list && list.length) { var i = list.shift(); used[i] = usedCur[j] = true; pairs.push([prevRows[i], r]); }
      });
    });
    function pd(r) { return r.promise || (r.cancelled ? 'cancelled' : str(r.promiseRaw)); }
    var changed = 0, added = 0;
    pairs.forEach(function (pr) {
      var o = pr[0], n = pr[1], ch = [];
      if (pd(o) !== pd(n)) ch.push({ field: 'Promise Date', old: pd(o) || '(비어 있음)', new: pd(n) || '(비어 있음)' });
      if ((o.qty || 0) !== (n.qty || 0)) ch.push({ field: 'QTY', old: o.qty == null ? '' : o.qty, new: n.qty == null ? '' : n.qty });
      if (ch.length) { byRow[n.rowNo] = { added: false, changes: ch, prevRow: o.rowNo }; changed++; }
    });
    curRows.forEach(function (r, j) { if (!usedCur[j]) { byRow[r.rowNo] = { added: true, changes: [] }; added++; } });
    var removed = prevRows.filter(function (r, i) { return !used[i]; });
    return { byRow: byRow, removed: removed, counts: { prev: prevRows.length, cur: curRows.length, same: pairs.length - changed, changed: changed, added: added, removed: removed.length } };
  }
  function weekNoteText(w) {
    if (!w) return '';
    if (w.added) return '지난주 파일에 없던 줄';
    return w.changes.map(function (c) { return c.field + ' ' + c.old + ' → ' + c.new; }).join(', ');
  }

  // opts: { status: 'Undispatched', gubun: 'HCE', supplierCode: 대장의 이 업체 PO 중 파일에 없는 것을 찾을 때,
  //         asOf: 'YYYY-MM-DD' 이면 Status 를 그 날 기준으로 다시 계산, weekDiff: cumminsWeekDiff 결과 }
  // 수량 대조는 거른 줄(미선적 Undispatched)의 합으로만 합니다(수강생 답 09-29). 거른 밖 줄(출고·Abnormal)의 수량은 참고로만 둡니다.
  function cumminsExwPlan(rows, pos, opts) {
    opts = opts || {};
    var week = (opts.weekDiff && opts.weekDiff.byRow) || {};
    rows.forEach(function (r) { r.statusNow = opts.asOf ? cumminsStatusAsOf(r, opts.asOf) : r.status; r.week = week[r.rowNo] || null; });
    var inGubun = rows.filter(function (r) { return !opts.gubun || sameWord(r.gubun, opts.gubun); });
    var target = inGubun.filter(function (r) { return !opts.status || sameWord(r.statusNow, opts.status); });
    var allByKey = {};
    inGubun.forEach(function (r) { (allByKey[cumKey(r.po, r.part)] = allByKey[cumKey(r.po, r.part)] || []).push(r); });
    var groups = {}, order = [];
    target.forEach(function (r) { var k = cumKey(r.po, r.part); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(r); });
    var out = [], notInLedger = [];
    order.forEach(function (k) {
      var rs = groups[k];
      var byDate = {};
      rs.forEach(function (r) {
        var d = r.promise || (r.cancelled ? 'cancelled' : r.promiseRaw || '(날짜 없음)');
        byDate[d] = byDate[d] || { date: d, qty: 0, rows: [], yellow: false, week: [] };
        byDate[d].qty += r.qty || 0; byDate[d].rows.push(r.rowNo);
        if (r.yellow) byDate[d].yellow = true;
        if (r.week) byDate[d].week.push(weekNoteText(r.week));
      });
      var schedule = Object.keys(byDate).sort().map(function (d) { return byDate[d]; });
      var all = allByKey[k] || rs;
      var g = {
        key: k, po: rs[0].po, part: rs[0].part, rows: rs, schedule: schedule,
        remainQty: rs.filter(function (r) { return !r.cancelled; }).reduce(function (a, r) { return a + (r.qty || 0); }, 0),
        outsideQty: all.filter(function (r) { return rs.indexOf(r) < 0 && !r.cancelled; }).reduce(function (a, r) { return a + (r.qty || 0); }, 0),
        yellow: rs.some(function (r) { return r.yellow; }), weekChanged: rs.some(function (r) { return !!r.week; }), badDate: schedule.some(function (x) { return !/^\d{4}-\d{2}-\d{2}$/.test(x.date); })
      };
      var po = pos.filter(function (p) { return str(p.po_no).toUpperCase() === str(g.po).toUpperCase(); })[0];
      if (!po) { g.state = 'no_po'; notInLedger.push(g); return; }
      g.po_no = po.po_no; g.supplier_code = po.supplier_code;
      var line = (po.lines || []).filter(function (l) { return norm(l.part) === norm(g.part) || (l.mfr_part && norm(l.mfr_part) === norm(g.part)); })[0];
      var oc = (po.oc_lines || []).filter(function (l) { return norm(l.part) === norm(g.part) || (l.sup_part && norm(l.sup_part) === norm(g.part)); })[0];
      g.poQty = line ? line.qty : null; g.ocQty = oc ? oc.qty : null;
      var plan = po.exw_plan && po.exw_plan[g.part];
      g.before = plan && plan.length ? plan.map(function (x) { return x.date + (x.qty != null ? ' ×' + x.qty : ''); }).join(', ') : (po.exw_promised || '');
      g.after = schedule.map(function (x) { return x.date + ' ×' + x.qty; }).join(', ');
      g.changed = !!g.before && g.before !== g.after && !(schedule.length === 1 && g.before === schedule[0].date);
      var issues = [];
      if (po.lines && po.lines.length && !line) issues.push('PO 품목에 없는 Part No.');
      if (g.poQty == null && g.ocQty == null) issues.push('대장에 PO 수량 없음(PO 본문·OC 를 먼저 읽어 주십시오)');
      var q = g.remainQty;
      if (g.poQty != null && q !== g.poQty) issues.push('미선적 수량 합 ' + q + ' ≠ PO 수량 ' + g.poQty + (q < g.poQty ? '(부족 ' + (g.poQty - q) + ')' : '(초과 ' + (q - g.poQty) + ')'));
      if (g.ocQty != null && q !== g.ocQty) issues.push('미선적 수량 합 ' + q + ' ≠ OC 수량 ' + g.ocQty + (q < g.ocQty ? '(부족 ' + (g.ocQty - q) + ')' : '(초과 ' + (q - g.ocQty) + ')'));
      if (g.badDate) issues.push('Promise Date 가 날짜가 아닌 줄');
      g.issues = issues;
      g.state = issues.length ? 'check' : 'match';
      out.push(g);
    });
    // 대장에는 있으나 파일(거른 뒤)에 없는 PO·품번 — 이 업체의 PO 중 아직 출고 전인 것
    var codes = [];
    if (opts.supplierCode) codes.push(opts.supplierCode);
    else out.forEach(function (g) { if (g.supplier_code && codes.indexOf(g.supplier_code) < 0) codes.push(g.supplier_code); });
    var seen = {}; order.forEach(function (k) { seen[k] = true; });
    var fileKeysAll = {}; rows.forEach(function (r) { fileKeysAll[cumKey(r.po, r.part)] = r.statusNow; });
    var missing = [];
    pos.forEach(function (p) {
      if (codes.indexOf(p.supplier_code) < 0 || p.exw_actual) return;
      var parts = (p.lines && p.lines.length) ? p.lines.map(function (l) { return l.part; }) : [''];
      parts.forEach(function (part) {
        var k = cumKey(p.po_no, part);
        if (part ? seen[k] : order.some(function (x) { return x.indexOf(str(p.po_no).toUpperCase() + '|') === 0; })) return;
        missing.push({ po_no: p.po_no, part: part, inFileAs: part && fileKeysAll[k] != null ? (fileKeysAll[k] || '(Status 없음)') : '' });
      });
    });
    return { groups: out, notInLedger: notInLedger, ledgerMissing: missing,
      counts: { rows: rows.length, target: target.length, groups: order.length, match: out.filter(function (g) { return g.state === 'match'; }).length,
        check: out.filter(function (g) { return g.state === 'check'; }).length, yellow: target.filter(function (r) { return r.yellow; }).length,
        weekChanged: target.filter(function (r) { return !!r.week; }).length,
        marked: target.filter(function (r) { return r.yellow || !!r.week; }).length,
        restatus: opts.asOf ? inGubun.filter(function (r) { return !sameWord(r.statusNow, r.status); }).length : 0 },
      target: target };
  }

  // 고른 묶음을 대장에 넣습니다: po.exw_plan[Part No.] = [{date, qty}], 약속 EXW DATE = 그 PO 의 가장 이른 날
  function applyCumminsExw(pos, groups, keys) {
    var changes = [];
    var res = pos.map(function (p) { return p; });
    groups.forEach(function (g) {
      if (keys.indexOf(g.key) < 0) return;
      var i = -1; res.forEach(function (p, j) { if (i < 0 && str(p.po_no).toUpperCase() === str(g.po).toUpperCase()) i = j; });
      if (i < 0) return;
      var p = Object.assign({}, res[i]);
      p.exw_plan = Object.assign({}, p.exw_plan || {});
      var before = p.exw_promised || '';
      p.exw_plan[g.part] = g.schedule.filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x.date); }).map(function (x) { return { date: x.date, qty: x.qty, yellow: x.yellow }; });
      var dates = [];
      Object.keys(p.exw_plan).forEach(function (k) { p.exw_plan[k].forEach(function (x) { dates.push(x.date); }); });
      dates.sort();
      if (dates.length) p.exw_promised = dates[0];
      res[i] = p;
      changes.push({ po_no: p.po_no, part: g.part, before_exw: before, after_exw: p.exw_promised, before: g.before, after: g.after, yellow: g.yellow, state: g.state });
    });
    return { pos: res, changes: changes };
  }
  // SRM EXW DATE 입력 목록 — 분할 선적은 건별로 한 줄씩(수강생 답 09-29: 「분할 선적일 때 EXW DATE에 건별로 넣음」)
  function exwEntries(groups) {
    var out = [];
    groups.forEach(function (g) {
      var sch = g.schedule.filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x.date); });
      sch.forEach(function (x, i) {
        out.push({ po: g.po, part: g.part, seq: (i + 1) + '/' + sch.length, date: x.date, qty: x.qty, rows: x.rows.join(','),
          inLedger: g.state !== 'no_po', yellow: !!x.yellow, week: x.week.filter(Boolean).join('; ') });
      });
    });
    return out;
  }
  function exwPlanText(p) {
    if (!p.exw_plan) return '';
    return Object.keys(p.exw_plan).map(function (k) { return k + ': ' + p.exw_plan[k].map(function (x) { return x.date + '×' + x.qty; }).join(', '); }).join(' / ');
  }

  /* ── 항차 체크리스트(항차 업무 매뉴얼, 2026-09-29 메일 자료) ─────────────────────────────── */
  // 사람 이름·내부 코드는 빼고 단계만 옮겼습니다. auto 가 있는 단계는 대장 값으로 자동 완료됩니다.
  var VOYAGE_STEPS = [
    { key: 'po_delivery', group: 'PO 송부', label: 'SRM PO Sheet 에 Delivery Date 입력·저장 (Delivery Date − 지역 운송기간 = Incoterms Date)' },
    { key: 'po_sent', group: 'PO 송부', label: 'PO PDF 저장 후 공급사에 메일 송부', auto: 'sent_date' },
    { key: 'oc_received', group: 'OC 접수', label: '공급사 OC 수령', auto: 'oc_date' },
    { key: 'oc_srm', group: 'OC 접수', label: 'SRM 선적납기관리 — EXW DATE 에 OC DATE(출하 예정일) 입력', auto: 'exw_promised' },
    { key: 'lc_request', group: 'L/C (해당 업체만)', label: 'L/C 개설 의뢰 — 개설일 = 신청일+2영업일, 최종선적일 = 개설일+6개월, 유효기일 = 최종선적일+3주', optional: true },
    { key: 'docs_download', group: '항차 입력', label: '수입운송의뢰에서 B/L·C/I·P/L(AL 있으면 AL) 내려받기', auto: 'docs_received' },
    { key: 'ci_check', group: '항차 입력', label: '선적납기관리 — 선적 수량·인보이스 총금액을 C/I 와 대조' },
    { key: 'bl_input', group: '항차 입력', label: 'Invoice Date·BL Date·인보이스 총금액, 최초/조정 ETD·ETA 입력(없으면 ETD = BL Date, ETA = 운송일 계산) 후 선적서류 확정' },
    { key: 'bl_due', group: '항차 입력', label: 'B/L Due List — BL·C/I·P/L·COO(있으면) 첨부 후 선적문서 생성' },
    { key: 'bl_weight', group: '항차 입력', label: 'Bill of Lading — Total Net/Gross Weight·Vessel Name 입력(P/L 합중량과 대조) 후 Confirm' },
    { key: 'erp_send', group: '항차 입력', label: '외자 대금 지불 요청 — Invoice ERP 송신' },
    { key: 'iv_gr', group: '항차 입력', label: 'SAP BL/IV 관리 — IV 및 GR, WorkFlow(송장 전기일 확인)' },
    { key: 'approval', group: '항차 입력', label: '사내 결재에 BL·INV·PL 첨부' },
    { key: 'bonded', group: '운송', label: '보세운송 요청(당일 오후 3시 전 도착 건은 다음 날 08시 창고 도착, B/L 첨부 필수) 또는 독차 요청' }
  ];
  function voyageStepDone(po, s) {
    if (po.voyage && po.voyage[s.key]) return po.voyage[s.key];
    if (s.auto) { var v = po[s.auto]; return v === true ? 'Y' : (v || ''); }
    return '';
  }
  function voyageProgress(po) {
    var steps = VOYAGE_STEPS.filter(function (s) { return !s.optional || (po.voyage && po.voyage[s.key]); });
    var done = steps.filter(function (s) { return voyageStepDone(po, s); });
    var next = steps.filter(function (s) { return !voyageStepDone(po, s); })[0] || null;
    return { done: done.length, total: steps.length, next: next };
  }

  // 공급사에 보내는 체크리스트 기본 문안 — 실제 구매발주서의 조건(5~6항)과 발주 메일에서 뽑았습니다.
  var DEFAULT_SUPPLIER_CHECKLIST = [
    'Please send the O.A/O.C within 7 days with the EXW (ready) date.',
    'Mark the country of origin on the item itself and on the shipping documents (must be identical).',
    'Shipping mark: company name in diamond shape with Contract No., Case No., Description, Gross Weight and Origin.',
    'Invoice: seller name/address, Contract No., beneficiary and bank information.',
    'Send a copy of the shipping documents (B/L, C/I, P/L) within 5 days after shipment.',
    'Wooden packing must be ISPM No.15 stamped (heat treated).'
  ].join('\n');

  /* ── .eml 읽기 ─────────────────────────────── */
  function decodeQP(s) {
    var bytes = [];
    s = s.replace(/=\r?\n/g, '');
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(s.charCodeAt(i) & 255);
    }
    return new Uint8Array(bytes);
  }
  // RFC 2047: =?charset?B|Q?...?= (이웃한 두 인코딩 낱말 사이 공백은 지움)
  function decodeWords(v) {
    return str(v).replace(/(\?=)\s+(=\?)/g, '$1$2').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, function (all, cs, enc, txt) {
      var bytes = enc.toUpperCase() === 'B' ? unbase64(txt) : decodeQP(txt.replace(/_/g, ' '));
      return fromUtf8(bytes, cs);
    });
  }
  // 파일을 바이트로 읽었을 때(권장): 한 바이트 = 한 글자인 문자열로 바꿔 두고, 각 부분을 제 charset 으로 풉니다.
  function bytesToBinary(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return s;
  }
  function binaryToBytes(s) {
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
    return u;
  }
  function splitHead(raw) {
    var i = raw.search(/\r?\n\r?\n/);
    var head = i < 0 ? raw : raw.slice(0, i);
    var body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '');
    var headers = {};
    head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(function (line) {
      var m = /^([\w\-]+):\s*(.*)$/.exec(line);
      if (m) { var k = m[1].toLowerCase(); if (headers[k] == null) headers[k] = m[2]; }
    });
    return { headers: headers, body: body };
  }
  // 머리글 매개변수: name="x", name=x, name*=utf-8''%ED..., name*0*=... name*1*=... (RFC 2231)
  function headerParam(h, name) {
    h = str(h);
    var parts = {}, re = new RegExp('(?:^|;)\\s*' + name + '(\\*\\d+)?(\\*)?\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|[^;]*)', 'ig'), m, any = false;
    while ((m = re.exec(h))) {
      any = true;
      var n = m[1] ? +m[1].slice(1) : 0;
      var v = m[3].trim(); if (v[0] === '"') v = v.slice(1, -1).replace(/\\(.)/g, '$1');
      parts[n] = { v: v, ext: !!m[2] };
    }
    if (!any) return '';
    var keys = Object.keys(parts).map(Number).sort(function (a, b) { return a - b; });
    var cs = 'utf-8', out = [];
    keys.forEach(function (k, i) {
      var p = parts[k], v = p.v;
      if (p.ext) {
        if (i === 0) { var q = /^([^']*)'[^']*'(.*)$/.exec(v); if (q) { cs = q[1] || cs; v = q[2]; } }
        var bytes = [];
        for (var j = 0; j < v.length; j++) {
          if (v[j] === '%' && /^[0-9A-F]{2}$/i.test(v.substr(j + 1, 2))) { bytes.push(parseInt(v.substr(j + 1, 2), 16)); j += 2; }
          else bytes.push(v.charCodeAt(j) & 255);
        }
        out.push(fromUtf8(new Uint8Array(bytes), cs));
      } else out.push(decodeWords(v));
    });
    return out.join('');
  }
  function htmlToText(t) {
    return t.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<\/t[dh]>/gi, '\t').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  // 부분 하나를 재귀로 훑어 본문(plain/html)과 첨부를 모읍니다.
  function walkPart(part, out, binary, depth) {
    var ct = part.headers['content-type'] || 'text/plain';
    var bm = /boundary\s*=\s*"?([^";]+)"?/i.exec(ct);
    if (/^\s*multipart\//i.test(ct) && bm && depth < 12) {
      var chunks = part.body.split('--' + bm[1]);
      chunks.slice(1).forEach(function (c) {
        if (/^--/.test(c)) return;                 // 닫는 경계 뒤(맺음말)
        walkPart(splitHead(c.replace(/^[ \t]*\r?\n/, '')), out, binary, depth + 1);
      });
      return;
    }
    if (/^\s*message\/rfc822/i.test(ct) && depth < 12) { walkPart(splitHead(part.body), out, binary, depth + 1); return; }
    var enc = str(part.headers['content-transfer-encoding']).toLowerCase();
    var disp = part.headers['content-disposition'] || '';
    var name = headerParam(disp, 'filename') || headerParam(ct, 'name');
    var bytes;
    if (enc === 'base64') bytes = unbase64(part.body);
    else if (enc === 'quoted-printable') bytes = decodeQP(part.body);
    else bytes = binary ? binaryToBytes(part.body) : null;
    var isText = /^\s*text\/(plain|html)/i.test(ct);
    if (name || /^\s*attachment/i.test(disp) || !isText) {
      if (!bytes) bytes = utf8(part.body);
      out.attachments.push({ name: name || '(이름 없음)', type: ct.split(';')[0].trim().toLowerCase(), size: bytes.length, bytes: bytes, inline: /^\s*inline/i.test(disp) });
      return;
    }
    var cs = (/charset\s*=\s*"?([^";\s]+)/i.exec(ct) || [])[1] || 'utf-8';
    var text = bytes ? fromUtf8(bytes, cs) : part.body;
    if (/text\/html/i.test(ct)) { if (out.html == null) out.html = htmlToText(text); }
    else if (out.plain == null) out.plain = text;
  }
  function addrOf(v) {
    var m = /<([^>]+)>/.exec(v || '');
    return (m ? m[1] : str(v).split(/[,;]/)[0]).trim().toLowerCase();
  }
  // raw: 문자열 또는 Uint8Array(파일 바이트). opts.tzOffsetMin: 받은 날을 셀 시간대(분, 한국 540). 없으면 이 PC 시간대.
  function parseEml(raw, opts) {
    opts = opts || {};
    var binary = raw instanceof Uint8Array;
    var text = binary ? bytesToBinary(raw) : String(raw || '');
    var p = splitHead(text);
    function hv(k) {
      var v = p.headers[k] || '';
      if (binary && /[\x80-\xff]/.test(v)) v = fromUtf8(binaryToBytes(v), 'utf-8'); // 인코딩 없이 들어온 8비트 머리글
      return decodeWords(v);
    }
    var date = '', dateTime = '';
    if (p.headers.date) {
      var t = Date.parse(p.headers.date.replace(/\s*\(.*\)\s*$/, ''));
      if (!isNaN(t)) {
        dateTime = new Date(t).toISOString();
        if (opts.tzOffsetMin != null) { var d = new Date(t + opts.tzOffsetMin * 60000); date = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
        else date = toDate(new Date(t));
      }
    }
    var out = { plain: null, html: null, attachments: [] };
    walkPart(p, out, binary, 0);
    var from = hv('from');
    return {
      from: from, fromAddr: addrOf(from), to: hv('to'), cc: hv('cc'), subject: hv('subject'),
      date: date, dateTime: dateTime, body: out.plain != null ? out.plain : (out.html || ''), attachments: out.attachments
    };
  }

  /* ── 업체별 메일 분류 ─────────────────────────────── */
  var OC_FILE_RE = /(?:^|[^A-Za-z])(?:OC|OA|O\.C|O\.A)(?:[^A-Za-z]|$)|order[\s_\-]*confirm|acknowledg/i;
  function isOcAttachment(a) {
    return !a.inline && /\.(xlsx?|xlsm|csv|pdf)$/i.test(a.name) && OC_FILE_RE.test(a.name.replace(/\.[^.]+$/, ''));
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }

  // 메일 한 통 분류: 발신 주소로 업체를 찾고, 제목·본문·첨부 파일명에 대장의 PO 번호가 있으면 연결합니다.
  // 발신 도메인이 업체 마스터에 없어도, 찾은 PO 가 모두 한 업체 것이면 그 업체로 분류합니다(대리점·그룹사 메일).
  // OC 후보 = 업체 확인 + 대장 PO 번호 포함 + (OC 낱말 또는 OC 첨부) + 그 PO 의 OC 수령일이 비어 있음
  function classifyMail(mail, db) {
    var atts = mail.attachments || [];
    var names = atts.filter(function (a) { return !a.inline; }).map(function (a) { return a.name; }).join('\n');
    var hay = mail.subject + '\n' + mail.body + '\n' + names;
    var hayN = hay.toUpperCase();
    var pos = db.pos.filter(function (p) {
      if (!p.po_no) return false;
      return new RegExp('(^|[^A-Z0-9])' + escRe(p.po_no.toUpperCase()) + '($|[^A-Z0-9])').test(hayN);
    }).map(function (p) { return p.po_no; });
    var sup = supplierByEmail(db.suppliers, mail.fromAddr), via = sup ? 'email' : '';
    if (!sup && pos.length) {
      var codes = [];
      pos.forEach(function (no) { var p = db.pos.filter(function (x) { return x.po_no === no; })[0]; if (p && p.supplier_code && codes.indexOf(p.supplier_code) < 0) codes.push(p.supplier_code); });
      if (codes.length === 1) { sup = supplierByCode(db.suppliers, codes[0]); via = sup ? 'po' : ''; }
    }
    var kws = str(db.settings.oc_keywords).split(/\s*,\s*/).filter(Boolean);
    var kwHit = kws.filter(function (k) {
      var re = new RegExp('(^|[^A-Za-z])' + escRe(k) + '(s|es)?($|[^A-Za-z])', /^[A-Z]{2,3}$/.test(k) ? '' : 'i');
      return re.test(mail.subject + '\n' + mail.body);
    });
    var ocFiles = atts.filter(isOcAttachment).map(function (a) { return a.name; });
    var ocTargets = pos.filter(function (no) {
      var p = db.pos.filter(function (x) { return x.po_no === no; })[0];
      return p && !p.oc_date && (!sup || !p.supplier_code || p.supplier_code === sup.code);
    });
    var known = db.pos.map(function (p) { return p.po_no; });
    var unknownPos = poNumbersIn(mail.subject + '\n' + names, db.settings.po_regex).list.filter(function (no) { return known.indexOf(no) < 0; });
    return {
      supplier_code: sup ? sup.code : '', supplier_name: sup ? sup.name : '(미분류)', supplier_via: via,
      pos: pos, keywords: kwHit, ocFiles: ocFiles, unknownPos: unknownPos,
      ocCandidates: sup && (kwHit.length || ocFiles.length) ? ocTargets : [],
      mismatch: sup ? pos.filter(function (no) {
        var p = db.pos.filter(function (x) { return x.po_no === no; })[0];
        return p && p.supplier_code && p.supplier_code !== sup.code;
      }) : []
    };
  }

  function applyOcDates(pos, updates) {
    // updates: [{ po_no, date }] — 이미 OC 수령일이 있으면 건드리지 않습니다.
    var n = 0;
    var res = pos.map(function (p) {
      var u = updates.filter(function (x) { return x.po_no === p.po_no; })[0];
      if (u && !p.oc_date && u.date) { n++; return Object.assign({}, p, { oc_date: u.date }); }
      return p;
    });
    return { pos: res, applied: n };
  }

  /* ── OC(Order Confirmation) 파일 읽기·PO 대조 ─────────────────────────────── */
  // 실제 OC 엑셀(2026-09-29 메일 첨부, 공급사 양식)에서 확인한 것:
  //  - 제목 「ORDER CONFIRMATION」, 16행쯤에 머리글: Units | <공급사> Part # | Cust. Part # | PO # | INV # | … | Unit Value | Total Value
  //  - 확정 납기 열은 없고, 파일명 「<코드> <PO> OC <번호> <MM-DD-YY>.xls」의 날짜와 서명란 날짜가 같음
  //    → 항차 매뉴얼 「OC Date 는 출하 예정일」에 따라 이 날짜를 OC 출하 예정일(약속 EXW DATE 후보)로 봅니다.
  function parseOcFileName(name) {
    var base = str(name).replace(/\.[a-z0-9]+$/i, '');
    var oc = /(?:^|[^A-Za-z])OC\s*[#:.\-]?\s*(\d{3,})/i.exec(base);
    var dm = /(\d{1,2})[-.](\d{1,2})[-.](\d{2,4})\s*$/.exec(base);
    return { oc_no: oc ? oc[1] : '', date: dm ? ymd(dm[3], dm[1], dm[2]) : '', pos: poNumbersIn(base).list.filter(function (x) { return /^[A-Z]\d{9}$/.test(x); }) };
  }
  function cellN(v) { return norm(v).replace(/[#'’.]/g, function (c) { return c === '#' ? '#' : ''; }); }
  function parseOcGrid(grid, fileName) {
    var res = { oc_no: '', doc_date: '', is_oc: false, lines: [], pos: [], warnings: [] };
    var fn = parseOcFileName(fileName);
    var flatText = grid.slice(0, 80).map(function (r) { return r.join(' '); }).join(' ');
    res.is_oc = /order\s+confirmation|acknowledg|\bO\.?C\b/i.test(flatText + ' ' + str(fileName));
    var hi = -1, col = {};
    for (var i = 0; i < Math.min(grid.length, 60) && hi < 0; i++) {
      var c = {};
      (grid[i] || []).forEach(function (v, j) {
        var n = cellN(v);
        if (!n) return;
        if (c.po == null && /^(po#?|pono|ponumber|purchaseorder#?|customerpo|yourpo#?|orderno)$/.test(n)) c.po = j;
        else if (c.qty == null && /^(units?|qty|quantity|qty#|orderqty|confirmedqty)$/.test(n)) c.qty = j;
        else if (c.cust == null && /(cust|customer|buyer|your).*part/.test(n)) c.cust = j;
        else if (c.sup == null && /part/.test(n) && !/desc/.test(n)) c.sup = j;
        else if (c.inv == null && /^(inv#?|invoice#?|invoiceno|oc#?|ocno|confirmation#?|ackno)$/.test(n)) c.inv = j;
        else if (c.price == null && /(unit(value|price|cost)|^price$|^unitprice$)/.test(n)) c.price = j;
        else if (c.total == null && /(total(value|amount|price)?$|^amount$|^extended)/.test(n)) c.total = j;
        else if (c.date == null && /((ship|exw|ready|promise|promised|delivery|dispatch|confirm(ed)?).*date|^etd$|^exw$)/.test(n)) c.date = j;
        else if (c.desc == null && /desc/.test(n)) c.desc = j;
      });
      if (c.po != null && (c.qty != null || c.cust != null || c.sup != null)) { hi = i; col = c; }
    }
    if (hi < 0) { res.warnings.push('OC 표 머리글(PO # · 수량 · 품번)을 찾지 못했습니다'); }
    else {
      var blank = 0;
      for (var r = hi + 1; r < grid.length && blank < 3; r++) {
        var row = grid[r] || [];
        var part = str(row[col.cust]) || str(row[col.sup]);
        var qty = col.qty != null ? toNumber(row[col.qty]) : null;
        if (!part && !str(row[col.po])) { blank++; continue; }
        blank = 0;
        if (!part) continue;
        res.lines.push({
          po: str(row[col.po]) || (fn.pos.length === 1 ? fn.pos[0] : ''), cust_part: str(row[col.cust]), sup_part: col.sup != null ? str(row[col.sup]) : '',
          qty: qty, price: col.price != null ? toNumber(row[col.price]) : null, total: col.total != null ? toNumber(row[col.total]) : null,
          oc_ref: col.inv != null ? str(row[col.inv]) : '', date: col.date != null ? toDate(row[col.date]) : '', desc: col.desc != null ? str(row[col.desc]) : ''
        });
      }
      res.lines.forEach(function (l) { if (l.po && res.pos.indexOf(l.po) < 0) res.pos.push(l.po); });
    }
    res.oc_no = fn.oc_no || (res.lines[0] && res.lines[0].oc_ref) || '';
    res.doc_date = fn.date;
    if (!res.doc_date) {
      // 파일명에 날짜가 없으면 표 아래(서명란 등)의 날짜 칸
      for (var k = Math.max(hi + 1, 0); k < grid.length && !res.doc_date; k++) (grid[k] || []).forEach(function (v) { if (!res.doc_date && typeof v === 'number' && v > 40000 && v < 60000) res.doc_date = toDate(v); });
    }
    if (!res.lines.length && hi >= 0) res.warnings.push('OC 품목 줄이 없습니다');
    if (!res.doc_date && !res.lines.some(function (l) { return l.date; })) res.warnings.push('출하 예정일(OC DATE)을 찾지 못했습니다 — 직접 입력해 주십시오');
    return res;
  }

  // OC 한 건 ↔ 대장 PO 한 건(PO 본문에서 읽은 품목 줄) 대조
  function compareOcToPo(po, oc) {
    var rows = [], issues = 0;
    var ocLines = oc.lines.filter(function (l) { return !l.po || l.po === po.po_no; });
    var poLines = (po.lines || []).slice();
    var usedPo = [];
    var ocDate = function (l) { return l.date || oc.doc_date || ''; };
    ocLines.forEach(function (l) {
      var i = -1;
      poLines.forEach(function (p, j) {
        if (i >= 0 || usedPo[j]) return;
        if (norm(p.part) === norm(l.cust_part) || (l.sup_part && (norm(p.part) === norm(l.sup_part) || norm(p.mfr_part) === norm(l.sup_part)))) i = j;
      });
      var p = i >= 0 ? poLines[i] : null;
      if (i >= 0) usedPo[i] = true;
      var notes = [];
      if (!poLines.length) notes.push({ level: 'muted', text: 'PO 품목 정보 없음(PO 본문을 먼저 읽어 주십시오)' });
      else if (!p) notes.push({ level: 'danger', text: 'PO 에 없는 품번' });
      else {
        if (p.qty != null && l.qty != null && p.qty !== l.qty) notes.push({ level: 'danger', text: '수량 다름(PO ' + p.qty + ' / OC ' + l.qty + ')' });
        if (p.price != null && l.price != null && Math.abs(p.price - l.price) > 0.005) notes.push({ level: 'danger', text: '단가 다름(PO ' + p.price + ' / OC ' + l.price + ')' });
        if (p.mfr_part && l.sup_part && norm(p.mfr_part) !== norm(l.sup_part)) notes.push({ level: 'warn', text: '공급사 품번 다름(PO Mfr ' + p.mfr_part + ' / OC ' + l.sup_part + ')' });
        var d = daysBetween(p.delivery, ocDate(l));
        if (d != null && d > 0) notes.push({ level: 'warn', text: 'OC 출하 예정일이 PO 납기보다 ' + d + '일 늦음' });
      }
      if (notes.some(function (n) { return n.level === 'danger' || n.level === 'warn'; })) issues++;
      rows.push({ part: l.cust_part || l.sup_part, sup_part: l.sup_part, po_qty: p ? p.qty : null, oc_qty: l.qty, po_price: p ? p.price : null, oc_price: l.price,
        po_delivery: p ? p.delivery : (po.delivery_date || ''), oc_date: ocDate(l), notes: notes.length ? notes : [{ level: 'ok', text: '일치' }] });
    });
    poLines.forEach(function (p, j) {
      if (usedPo[j]) return;
      issues++;
      rows.push({ part: p.part, sup_part: p.mfr_part, po_qty: p.qty, oc_qty: null, po_price: p.price, oc_price: null, po_delivery: p.delivery, oc_date: '', notes: [{ level: 'danger', text: 'OC 에 없는 PO 줄' }] });
    });
    var dates = ocLines.map(ocDate).filter(Boolean).sort();
    return { po_no: po.po_no, oc_no: oc.oc_no, oc_date: dates[0] || '', rows: rows, issues: issues };
  }

  /* ── Packing List 합중량 vs B/L 중량 ─────────────────────────────── */
  // weightIsPerUnit 가 참이면 행 중량 × 수량으로 합산(열이 개당 중량일 때)
  function packingTotals(rows, weightIsPerUnit) {
    var groups = {}, order = [], skipped = [];
    rows.forEach(function (r, i) {
      var w = toNumber(r.weight);
      if (w == null) { if (str(r.weight) || str(r.part)) skipped.push(i + 2); return; }
      if (/^(total|합계|소계|sub\s*total|grand\s*total)/i.test(str(r.part))) { skipped.push(i + 2); return; }
      if (weightIsPerUnit) { var q = toNumber(r.qty); w = w * (q == null ? 1 : q); }
      var g = str(r.group) || '전체';
      if (!groups[g]) { groups[g] = { group: g, rows: 0, total: 0 }; order.push(g); }
      groups[g].rows++; groups[g].total += w;
    });
    return { groups: order.map(function (g) { groups[g].total = Math.round(groups[g].total * 1000) / 1000; return groups[g]; }), skippedRows: skipped };
  }

  function compareWeight(plTotal, blWeight, st) {
    st = st || defaultSettings();
    var bl = toNumber(blWeight);
    if (bl == null) return { status: 'none', diff: null, diffPct: null, allowed: null };
    var diff = Math.round((plTotal - bl) * 1000) / 1000;
    var allowed = Math.max(Number(st.weight_tol_kg) || 0, Math.abs(bl) * (Number(st.weight_tol_pct) || 0) / 100);
    var pct = bl ? diff / bl * 100 : null;
    return { status: Math.abs(diff) <= allowed + 1e-9 ? 'ok' : 'mismatch', diff: diff, diffPct: pct, allowed: allowed };
  }

  // 엑셀·PDF 표를 복사해 붙여넣은 글(탭 구분, 없으면 2칸 이상 공백) → { headers, rows }
  // 첫 줄에 숫자가 없으면 머리글로 씁니다. 자료가 파일로 오지 않을 때 쓰는 입력 양식입니다.
  function parseTsv(text) {
    var lines = str(text).split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return { headers: [], rows: [] };
    var split = function (l) { return (/\t/.test(l) ? l.split('\t') : l.trim().split(/\s{2,}/)).map(function (c) { return c.trim(); }); };
    var first = split(lines[0]);
    var hasHead = !first.some(function (c) { return toNumber(c) != null; });
    var width = Math.max.apply(null, lines.map(function (l) { return split(l).length; }));
    var headers = hasHead ? first : [];
    for (var i = headers.length; i < width; i++) headers.push('열' + (i + 1));
    var rows = (hasHead ? lines.slice(1) : lines).map(function (l) { var c = split(l), o = {}; headers.forEach(function (hd, j) { o[hd] = c[j] == null ? '' : c[j]; }); return o; });
    return { headers: headers, rows: rows };
  }
  var LB_TO_KG = 0.45359237;

  /* ── 묶음 내려받기(ZIP, 무압축) ─────────────────────────────── */
  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  // files: [{ name, bytes | text }] → Uint8Array (ZIP, 파일명 UTF-8 플래그)
  function makeZip(files) {
    var chunks = [], central = [], offset = 0;
    function u16(v) { return [v & 255, v >>> 8 & 255]; }
    function u32(v) { return [v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255]; }
    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = f.bytes || utf8(f.text || '');
      var crc = crc32(data);
      var local = [].concat([0x50, 0x4b, 0x03, 0x04], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      chunks.push(new Uint8Array(local), name, data);
      central.push(new Uint8Array([].concat([0x50, 0x4b, 0x01, 0x02], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    var cSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = new Uint8Array([].concat([0x50, 0x4b, 0x05, 0x06], u16(0), u16(0), u16(files.length), u16(files.length), u32(cSize), u32(offset), u16(0)));
    var all = chunks.concat(central, [end]);
    var total = all.reduce(function (n, c) { return n + c.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  /* ── 예시용 단순 PDF 만들기(영문 텍스트 한 쪽) ─────────────────────────────── */
  function makeSimplePdf(lines) {
    function esc(s) { return String(s).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?'); }
    var content = 'BT /F1 12 Tf 60 780 Td 16 TL\n' + lines.map(function (l) { return '(' + esc(l) + ') Tj T*'; }).join('\n') + '\nET';
    var objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'
    ];
    var out = '%PDF-1.4\n', offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' +
      offs.map(function (o) { return ('0000000000' + o).slice(-10) + ' 00000 n \n'; }).join('') +
      'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    return utf8(out);
  }

  /* ── 도착 통지(A/N) — 2026-09-29 저녁 요청 「도착일정통지 메일 관리」 ─────────────────────────────── */
  // 포워더마다 A/N 양식이 달라 한 가지 틀로 읽을 수 없습니다. 흔한 영문·국문 라벨을 넓게 잡고
  // 「라벨 : 값」 줄, 한 줄에 여러 칸(탭·3칸 이상 띄움), 라벨 다음 줄의 값, HTML 표를 모두 읽습니다.
  // 읽은 값마다 근거가 된 원문 줄을 남겨 사람이 확인하고 고칩니다(실물 A/N 을 받기 전이라 규칙은 가정).
  var AN_FIELDS = [
    { key: 'bl', label: 'B/L 번호' },
    { key: 'mbl', label: 'Master B/L' },
    { key: 'vessel', label: '선명(Vessel)' },
    { key: 'voyage', label: '항차(Voyage)' },
    { key: 'etd', label: 'ETD(출항)', date: true },
    { key: 'eta', label: 'ETA(도착)', date: true },
    { key: 'pol', label: '선적항(POL)' },
    { key: 'pod', label: '도착항(POD)' },
    { key: 'containers', label: '컨테이너' },
    { key: 'forwarder', label: '포워더' },
    { key: 'pos', label: 'PO 번호' },
    { key: 'packages', label: '포장 수량' },
    { key: 'weight', label: '중량' }
  ];
  // part: 「A / B」 로 묶인 두 칸 라벨에서 몇 번째 값인지. pick: 날짜가 여럿이면 first|last
  var AN_RULES = {
    bl: [{ re: 'H\\.?\\s?B\\/?L(?:\\s*(?:No|Number|#|번호)\\.?)?' }, { re: 'House\\s*B\\/?L(?:\\s*(?:No|Number)\\.?)?' },
      { re: '(?:B\\/L|BL|Bill\\s+of\\s+Lading)\\s*(?:No|Number|#|번호)\\.?' }, { re: 'B\\/L' }, { re: '선하증권\\s*번호|비엘\\s*번호' }],
    mbl: [{ re: 'M\\.?\\s?B\\/?L(?:\\s*(?:No|Number|#|번호)\\.?)?' }, { re: 'Master\\s*B\\/?L(?:\\s*(?:No|Number)\\.?)?' }],
    vesvoy: [{ re: '(?:Vessel|VSL|Ship)(?:\\s*Name)?\\s*\\/\\s*Voy(?:age)?\\.?(?:\\s*No\\.?)?' }, { re: '(?:모선|선명)\\s*\\/\\s*항차' }],
    vessel: [{ re: 'Vessel(?:\\s*Name)?' }, { re: 'VSL' }, { re: 'Flight(?:\\s*No\\.?)?' }, { re: '모선명|모선|선명' }],
    voyage: [{ re: 'Voy(?:age)?\\.?(?:\\s*No\\.?)?' }, { re: '항차' }],
    etd: [{ re: 'ETD(?:\\s*\\/\\s*ETA)?', pick: 'first' }, { re: 'On\\s*Board(?:\\s*Date)?', pick: 'first' }, { re: 'Sailing\\s*Date', pick: 'first' },
      { re: 'Departure(?:\\s*Date)?', pick: 'first' }, { re: '출항\\s*(?:예정)?\\s*일?|선적일', pick: 'first' }],
    eta: [{ re: '(?:New|Revised|Updated|Changed|Latest)\\s*ETA' }, { re: '변경\\s*(?:ETA|입항일|도착일)' }, { re: 'ETA' },
      { re: 'Est(?:imated|\\.)?\\s*(?:Time\\s*of\\s*)?Arrival(?:\\s*Date)?' }, { re: 'Arrival\\s*Date' }, { re: '입항\\s*예정\\s*일?|입항일|도착\\s*예정\\s*일?|도착일' }],
    pol: [{ re: 'POL\\s*\\/\\s*POD', part: 0 }, { re: 'POL' }, { re: 'Port\\s*of\\s*Loading' }, { re: 'Loading\\s*Port' }, { re: '선적항' }],
    pod: [{ re: 'POL\\s*\\/\\s*POD', part: 1 }, { re: 'POD' }, { re: 'Port\\s*of\\s*Discharge' }, { re: 'Discharg(?:e|ing)\\s*Port' }, { re: '양하항|도착항|입항지' }],
    forwarder: [{ re: 'Forwarder|Forwarding\\s*Agent' }, { re: '포워더|운송사' }],
    packages: [{ re: 'No\\.?\\s*of\\s*(?:Pkgs?|Packages)' }, { re: 'Packages?|PKGS?' }, { re: '포장\\s*수량|포장|수량' }],
    weight: [{ re: 'Gross\\s*Weight|G\\.?\\s*\\/?\\s*W(?:T)?\\.?' }, { re: 'Weight' }, { re: '총\\s*중량|중량' }],
    containers: [{ re: 'Container(?:\\s*No\\.?)?|CNTR(?:\\s*No\\.?)?' }, { re: '컨테이너(?:\\s*번호)?' }],
    pos: [{ re: 'P\\.?\\s?O\\.?\\s*(?:No|Number|#)\\.?' }, { re: 'Order\\s*No\\.?' }, { re: 'Customer\\s*Ref(?:erence)?\\.?|Your\\s*Ref\\.?' }, { re: '발주\\s*번호|오더\\s*번호' }]
  };
  var AN_DATE_LABEL = { etd: true, eta: true };
  var TEXT_FIELD = { vessel: true, vesvoy: true, voyage: true, pol: true, pod: true, forwarder: true, containers: true };

  // 줄 안의 라벨 뒤 값: 앞은 글자가 아닌 곳에서 시작, 뒤는 글자가 붙지 않아야 라벨입니다(POL ≠ POLAND, G/W ≠ GWANGYANG).
  function labelRegex(src, isDate) {
    // 날짜 라벨은 「ETA BUSAN :」·「ETA (Busan):」처럼 라벨과 쌍점 사이에 항구 이름이 끼어도 받습니다.
    var port = isDate ? '(?:\\s*\\([^)]{0,24}\\)|\\s+(?:at\\s+|to\\s+|in\\s+)?[A-Za-z가-힣][A-Za-z가-힣 ,]{1,20}?(?=\\s*[:：]))?' : '';
    var paren = isDate ? '' : '(?:\\s*\\([^)]{0,24}\\))?';   // 「발주번호(REF)」
    return new RegExp('(^|[^A-Za-z0-9가-힣])(?:' + src + ')(?![A-Za-z가-힣])' + port + paren + '(\\s*(?:[:：=]|-(?=\\s))?\\s*)(.*)$', 'i');
  }
  function cutCell(v) { return str(str(v).split(/\t|\s{3,}|\s\|\s/)[0]).replace(/^[\s:：\-=.]+/, '').trim(); }

  // 글 속 날짜를 모두 찾아 위치 순서로 돌려줍니다. d/m/y 와 m/d/y 가 헷갈리는 모양은 ambiguous 표시.
  var AN_MON = 'jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec';
  function datesIn(s, dayFirst) {
    s = str(s);
    var res = [
      /\d{4}\s*[-.\/년]\s*\d{1,2}\s*[-.\/월]\s*\d{1,2}\s*일?/g,
      new RegExp('\\d{1,2}(?:st|nd|rd|th)?[\\s\\-.\\/]*(?:' + AN_MON + ')[a-z]*\\.?[\\s\\-.\\/,]*\\d{4}', 'gi'),
      new RegExp('(?:' + AN_MON + ')[a-z]*\\.?[\\s\\-]*\\d{1,2}(?:st|nd|rd|th)?,?[\\s\\-]*\\d{4}', 'gi'),
      /\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}/g
    ];
    var hits = [];
    res.forEach(function (re, k) {
      var m;
      while ((m = re.exec(s))) {
        var raw = m[0], iso = '', amb = false;
        if (k === 1) { var q = new RegExp('(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-.\\/]*(' + AN_MON + ')[a-z]*\\.?[\\s\\-.\\/,]*(\\d{4})', 'i').exec(raw); iso = q ? ymd(q[3], MONTHS[q[2].toLowerCase()], q[1]) : ''; }
        else if (k === 2) { var q2 = new RegExp('(' + AN_MON + ')[a-z]*\\.?[\\s\\-]*(\\d{1,2})(?:st|nd|rd|th)?,?[\\s\\-]*(\\d{4})', 'i').exec(raw); iso = q2 ? ymd(q2[3], MONTHS[q2[1].toLowerCase()], q2[2]) : ''; }
        else if (k === 3) { var p = raw.split(/[\/.\-]/); amb = +p[0] <= 12 && +p[1] <= 12 && p[0] !== p[1]; iso = toDate(raw, dayFirst); }
        else iso = toDate(raw);
        if (iso) hits.push({ i: m.index, end: m.index + raw.length, iso: iso, raw: raw, ambiguous: amb });
      }
    });
    hits.sort(function (a, b) { return a.i - b.i || (b.end - b.i) - (a.end - a.i); });
    var out = [];
    hits.forEach(function (h) { if (!out.length || h.i >= out[out.length - 1].end) out.push(h); });
    return out;
  }

  var CNTR_RE = /(^|[^A-Z0-9])([A-Z]{3}[UJZ])\s?(\d{6})\s?(\d)(?![0-9])(?:\s*[\/(,]?\s*((?:20|40|45)\s?(?:GP|DC|DV|HC|HQ|RF|RH|OT|FR|TK|FT|')))?/g;
  function weightKg(s) {
    var m = /(\d[\d,]*(?:\.\d+)?)\s*(KGS?|KILOS?|LBS?|POUNDS?|MT|TONS?|톤|킬로그램|kg)?/i.exec(str(s));
    if (!m) return null;
    var n = Number(m[1].replace(/,/g, '')); if (isNaN(n)) return null;
    var u = (m[2] || 'kg').toLowerCase();
    if (/^(lb|lbs|pound|pounds)$/.test(u)) n = n * LB_TO_KG;
    else if (/^(mt|ton|tons|톤)$/.test(u)) n = n * 1000;
    return Math.round(n * 100) / 100;
  }
  function anKey(v) { return str(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function anPoList(v) { return str(v).split(/[\s,;\/]+/).map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean); }

  // 값 검사: 라벨이 본문 문장 속에 우연히 나와도(「packages will arrive」) 값 모양이 아니면 다음 후보로 넘어갑니다.
  function anValue(key, v, dayFirst) {
    v = str(v);
    if (!v) return null;
    var m;
    switch (key) {
      case 'bl': case 'mbl':
        m = /[A-Z0-9][A-Z0-9\-]{5,24}/g; var t;
        while ((t = m.exec(v.toUpperCase()))) if (/\d/.test(t[0]) && /[A-Z]/.test(t[0].replace(/^NO/, '')) || /^\d{8,}$/.test(t[0])) return t[0];
        return null;
      case 'etd': case 'eta': {
        var ds = datesIn(v, dayFirst);
        return ds.length ? ds : null;
      }
      case 'voyage':
        m = /(?:^|\s)(V\.?\s?)?([0-9A-Z][0-9A-Z.\-]{1,11})(?=\s|$)/i.exec(v);
        return m && /\d/.test(m[2]) ? (m[1] ? 'V.' : '') + m[2].toUpperCase() : null;
      case 'vessel': case 'vesvoy': case 'pol': case 'pod': case 'forwarder':
        v = v.replace(/\s+/g, ' ').replace(/[,;.\s]+$/, '');
        return /[A-Za-z가-힣]{2}/.test(v) && v.length <= 60 && !/^(no|n\/a|tba|tbc)$/i.test(v) ? v : null;
      case 'packages':
        m = /(\d[\d,]*)\s*([A-Za-z\/'가-힣]+)?/.exec(v);
        return m ? (m[1] + (m[2] ? ' ' + m[2].toUpperCase() : '')).trim() : null;
      case 'weight':
        m = /(\d[\d,]*(?:\.\d+)?)\s*(KGS?|KILOS?|LBS?|MT|TONS?|톤|kg)?/i.exec(v);
        return m ? (m[1] + (m[2] ? ' ' + m[2].toUpperCase() : '')).trim() : null;
      case 'containers':
        return /[A-Za-z0-9]{3}/.test(v) && v.length <= 80 ? v : null;
      case 'pos':
        return /\d/.test(v) ? v : null;
    }
    return null;
  }

  // 한 가지 칸을 라벨 규칙 순서대로 찾습니다. 같은 규칙은 글 위(제목 → 본문)부터.
  function anFind(key, lines, dayFirst) {
    var rules = AN_RULES[key];
    for (var r = 0; r < rules.length; r++) {
      var re = labelRegex(rules[r].re, !!AN_DATE_LABEL[key]);
      for (var i = 0; i < lines.length; i++) {
        var m = re.exec(lines[i]);
        if (!m) continue;
        var raw = m[3], used = false;
        // 근거 원문: 한 줄에 칸이 여럿(표)이면 라벨과 그 값 칸만, 아니면 줄 전체. 첫 줄은 메일 제목.
        var src = /\t/.test(lines[i]) ? (lines[i].slice(m.index + m[1].length, lines[i].length - raw.length).trim() + ' ' + cutCell(raw)).trim() : lines[i].trim();
        if (i === 0) src = '제목: ' + src;
        // 글자 칸(선명·항구·포워더)은 문장 속 낱말(「the following vessel arrives」)을 값으로 오인하기 쉬워,
        // 줄 맨 앞 라벨이거나 쌍점·탭·여러 칸 띄움으로 값과 나뉜 경우만 받습니다.
        var atStart = !lines[i].slice(0, m.index + m[1].length).trim();
        var strict = atStart || /[:：=\t]|\s{2,}/.test(m[2]) || !raw.trim();
        if (!strict && TEXT_FIELD[key]) continue;
        if (!cutCell(raw) || /^[:：]?\s*$/.test(raw)) {
          // 라벨만 있는 줄 → 다음 비지 않은 줄이 값(표를 줄 단위로 복사한 모양)
          for (var j = i + 1; j < Math.min(lines.length, i + 3); j++) if (lines[j].trim()) { raw = lines[j]; src += ' ⏎ ' + lines[j].trim(); used = true; break; }
          if (!used) continue;
        }
        var cell = cutCell(raw);
        if (AN_DATE_LABEL[key] && !datesIn(cell, dayFirst).length) cell = raw;   // 칸 나눔에 날짜가 잘렸으면 줄 나머지
        if (rules[r].part != null) cell = str(cell.split(/\s*(?:\/|→|->)\s*/)[rules[r].part]);
        var val = anValue(key, cell, dayFirst);
        if (val == null) continue;
        return { value: val, src: src.slice(0, 200), pick: rules[r].pick || 'last' };
      }
    }
    return null;
  }

  // mail: { subject, body, from, fromAddr, date, dateTime } (parseEml 결과) · db: 대장(PO 번호 찾기) · opts: { file, dayFirst, today, now }
  function parseArrivalNotice(mail, db, opts) {
    opts = opts || {};
    var dayFirst = !!opts.dayFirst;
    var text = str(mail.subject) + '\n' + str(mail.body).replace(/ /g, ' ');
    var lines = text.split(/\r?\n/).map(function (l) { return l.replace(/\s+$/, ''); });
    var f = {}, src = {}, notes = [];
    ['bl', 'mbl', 'etd', 'eta', 'pol', 'pod', 'forwarder', 'packages', 'weight'].forEach(function (k) {
      var r = anFind(k, lines, dayFirst);
      if (!r) return;
      if (AN_DATE_LABEL[k]) {
        var d = r.pick === 'first' ? r.value[0] : r.value[r.value.length - 1];
        f[k] = d.iso;
        if (d.ambiguous) notes.push(AN_FIELDS.filter(function (x) { return x.key === k; })[0].label + ' 「' + d.raw + '」 — 일/월 순서 확인');
      } else f[k] = r.value;
      src[k] = r.src;
    });
    if (f.bl && f.mbl && f.bl === f.mbl) delete f.mbl;
    if (!f.bl && f.mbl) { f.bl = f.mbl; src.bl = src.mbl; delete f.mbl; delete src.mbl; }   // B/L 이 하나뿐이면 그 번호를 씀
    // 선명·항차: 「선명 / 항차」 한 칸 → 따로 적힌 칸 순서
    var vv = anFind('vesvoy', lines, dayFirst);
    if (vv) {
      var cell = cutCell(vv.value), parts = cell.split(/\s*\/\s*/), ves = parts[0], voy = parts[1] || '';
      if (!voy) { var mv = /^(.*?)\s+((?:V\.?\s?)?[0-9][0-9A-Z]{1,6})$/i.exec(ves); if (mv) { ves = mv[1]; voy = mv[2]; } }
      if (anValue('vessel', ves)) { f.vessel = anValue('vessel', ves); src.vessel = vv.src; }
      if (voy && anValue('voyage', voy)) { f.voyage = anValue('voyage', voy); src.voyage = vv.src; }
    }
    ['vessel', 'voyage'].forEach(function (k) {
      if (f[k]) return;
      var r = anFind(k, lines, dayFirst);
      if (r) { f[k] = r.value; src[k] = r.src; }
    });
    // 컨테이너: ISO 6346 모양(영문 4자 + 숫자 7자리)을 글 전체에서. 없으면 라벨 값(LCL 등)
    var cn = [], cnSrc = [];
    lines.forEach(function (l) {
      var m, re = new RegExp(CNTR_RE.source, 'g'), hit = false;
      while ((m = re.exec(l))) {
        var v = m[2] + m[3] + m[4] + (m[5] ? '(' + m[5].replace(/\s/g, '').toUpperCase() + ')' : '');
        if (!cn.some(function (x) { return x.slice(0, 11) === v.slice(0, 11); })) cn.push(v);
        hit = true;
      }
      if (hit && cnSrc.length < 3) cnSrc.push(l.trim().slice(0, 120));
    });
    if (cn.length) { f.containers = cn.join(', '); src.containers = cnSrc.join(' ⏎ '); }
    else { var rc = anFind('containers', lines, dayFirst); if (rc) { f.containers = rc.value; src.containers = rc.src; } }
    // PO 번호: 대장 PO 번호가 글에 있으면 먼저, 다음은 PO 번호 규칙(설정) · PO 라벨 값. B/L·컨테이너 번호와 같은 것은 뺌
    var found = [], poSrc = [], up = text.toUpperCase();
    var skip = [anKey(f.bl), anKey(f.mbl)].concat(cn.map(function (c) { return c.slice(0, 11); }));
    function addPo(no) { no = str(no).toUpperCase(); if (no && found.indexOf(no) < 0 && skip.indexOf(anKey(no)) < 0) found.push(no); }
    ((db && db.pos) || []).forEach(function (p) {
      if (p.po_no && new RegExp('(^|[^A-Z0-9])' + escRe(p.po_no.toUpperCase()) + '($|[^A-Z0-9])').test(up)) addPo(p.po_no);
    });
    poNumbersIn(text, db && db.settings ? db.settings.po_regex : '').list.forEach(addPo);
    var rp = anFind('pos', lines, dayFirst);
    if (rp) anPoList(cutCell(rp.value)).filter(function (x) { return /\d/.test(x) && x.length >= 5; }).forEach(addPo);
    if (found.length) {
      f.pos = found.join(', ');
      lines.forEach(function (l) { if (poSrc.length < 3 && found.some(function (no) { return l.toUpperCase().indexOf(no) >= 0; })) poSrc.push(l.trim().slice(0, 120)); });
      src.pos = poSrc.join(' ⏎ ');
    }
    // 포워더: 라벨 → 보낸 사람 이름 → 도메인
    if (!f.forwarder && mail.from) {
      var name = str(mail.from).replace(/<[^>]*>/, '').replace(/^["'\s]+|["'\s]+$/g, '');
      var dom = mail.fromAddr ? domainOf(mail.fromAddr) : '';
      f.forwarder = name && !/@/.test(name) ? name : dom;
      if (f.forwarder) src.forwarder = 'From: ' + str(mail.from);
    }
    var fields = {};
    AN_FIELDS.forEach(function (x) { fields[x.key] = f[x.key] || ''; });
    var now = opts.now || new Date().toISOString();
    return {
      id: 'an' + (hashCode(str(mail.from) + '|' + str(mail.subject) + '|' + str(mail.dateTime) + '|' + str(mail.body).slice(0, 4000)) >>> 0).toString(36),
      file: str(opts.file), received: mail.date || opts.today || '', receivedAt: mail.dateTime || now,
      from: str(mail.from), subject: str(mail.subject), fields: fields, parsed: Object.assign({}, fields), src: src, notes: notes,
      text: str(mail.body).slice(0, 8000)
    };
  }

  // 붙여넣은 글: 메일 원문(머리글 포함)이면 .eml 처럼, 아니면 본문으로 읽습니다.
  function anMailFromText(text) {
    text = str(text);
    if (/^(?:[\w\-]+:.*\r?\n)*(?:From|Subject):/i.test(text) && /\r?\n\r?\n/.test(text) && /^(?:[\w\-]+:[^\n]*\r?\n)+/.test(text)) return parseEml(text);
    return { from: '', fromAddr: '', subject: '', date: '', dateTime: '', body: text, attachments: [] };
  }

  // 같은 B/L(House 또는 Master 번호가 겹치면 같은 건)의 A/N 을 묶어, 받은 순서대로 ETA 변경을 찾습니다.
  function anGroups(recs) {
    var groups = [];
    (recs || []).forEach(function (r) {
      var keys = [anKey(r.fields.bl), anKey(r.fields.mbl)].filter(Boolean);
      var g = keys.length ? groups.filter(function (x) { return keys.some(function (k) { return x.keys.indexOf(k) >= 0; }); })[0] : null;
      if (!g) { g = { keys: [], recs: [] }; groups.push(g); }
      keys.forEach(function (k) { if (g.keys.indexOf(k) < 0) g.keys.push(k); });
      g.recs.push(r);
    });
    groups.forEach(function (g) {
      g.recs = g.recs.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
        return str(a.r.receivedAt || a.r.received).localeCompare(str(b.r.receivedAt || b.r.received)) || a.i - b.i;
      }).map(function (x) { return x.r; });
      var merged = {}, changes = [], last = '', pos = [];
      g.recs.forEach(function (r) {
        AN_FIELDS.forEach(function (x) { if (r.fields[x.key]) merged[x.key] = r.fields[x.key]; });
        anPoList(r.fields.pos).forEach(function (no) { if (pos.indexOf(no) < 0) pos.push(no); });
        var e = r.fields.eta;
        if (e) { if (last && e !== last) changes.push({ from: last, to: e, at: r.received, file: r.file, id: r.id, days: daysBetween(last, e) }); last = e; }
      });
      merged.pos = pos.join(', ');
      g.merged = merged; g.poList = pos; g.etaChanges = changes;
      g.bl = merged.bl || merged.mbl || '';
      g.first = g.recs[0]; g.latest = g.recs[g.recs.length - 1];
    });
    return groups;
  }

  // A/N 묶음 → 대장 PO: 글에 적힌 PO 번호, 또는 대장에 적힌 B/L 번호가 같은 PO
  function anMatch(g, db) {
    var list = [], seen = {}, unknown = [];
    g.poList.forEach(function (no) {
      var p = db.pos.filter(function (x) { return x.po_no && x.po_no.toUpperCase() === no; })[0];
      if (p) { if (!seen[p.po_no]) { seen[p.po_no] = 1; list.push({ po: p, via: 'PO 번호' }); } }
      else unknown.push(no);
    });
    db.pos.forEach(function (p) {
      if (p.bl_no && !seen[p.po_no] && g.keys.indexOf(anKey(p.bl_no)) >= 0) { seen[p.po_no] = 1; list.push({ po: p, via: 'B/L' }); }
    });
    return { list: list, unknown: unknown };
  }

  // 항차등록 대기: B/L 이 있고 A/N 을 받았는데 아직 「등록 완료」가 아닌 PO. 열쇠 = PO 번호 | B/L(분할 선적이면 B/L 마다 한 줄)
  function anQueue(db) {
    var an = db.an || emptyAn(), regs = an.regs || {};
    var groups = anGroups(an.mails), rows = [], unmatched = [], covered = {};
    groups.forEach(function (g) {
      var m = anMatch(g, db);
      if (!m.list.length) { unmatched.push({ group: g, unknown: m.unknown }); return; }
      if (!g.bl) return;   // B/L 을 못 읽은 A/N 은 대기 목록에 올리지 않고 메일 목록에서 고치게 함
      m.list.forEach(function (x) {
        var key = x.po.po_no + '|' + anKey(g.bl);
        if (covered[key]) return;
        covered[key] = true;
        var reg = regs[key] || null, eta = g.merged.eta || '';
        rows.push({
          key: key, po_no: x.po.po_no, supplier_code: x.po.supplier_code, bl: g.bl, mbl: g.merged.mbl || '', via: x.via, source: 'mail',
          vessel: g.merged.vessel || '', voyage: g.merged.voyage || '', etd: g.merged.etd || '', eta: eta, pod: g.merged.pod || '',
          etaChanges: g.etaChanges, anCount: g.recs.length, firstAn: g.first.received, lastAn: g.latest.received, unknownPos: m.unknown,
          reg: reg, etaAfterReg: reg && reg.eta && eta && reg.eta !== eta ? { from: reg.eta, to: eta } : null
        });
      });
    });
    // 메일 없이 대장에 「A/N 수신」과 B/L 을 손으로 적은 PO 도 대기 대상
    db.pos.forEach(function (p) {
      if (!p.an_received || !p.bl_no) return;
      var key = p.po_no + '|' + anKey(p.bl_no);
      if (covered[key]) return;
      covered[key] = true;
      var reg = regs[key] || null;
      rows.push({ key: key, po_no: p.po_no, supplier_code: p.supplier_code, bl: p.bl_no, mbl: '', via: '대장', source: 'ledger',
        vessel: '', voyage: '', etd: p.etd || '', eta: p.eta || '', pod: '', etaChanges: [], anCount: 0, firstAn: '', lastAn: '', unknownPos: [],
        reg: reg, etaAfterReg: reg && reg.eta && p.eta && reg.eta !== p.eta ? { from: reg.eta, to: p.eta } : null });
    });
    rows.sort(function (a, b) { return str(a.eta || '9999').localeCompare(str(b.eta || '9999')) || a.po_no.localeCompare(b.po_no); });
    return {
      groups: groups, rows: rows, unmatched: unmatched,
      pending: rows.filter(function (r) { return !r.reg; }),
      done: rows.filter(function (r) { return r.reg; }),
      etaChanged: groups.filter(function (g) { return g.etaChanges.length; })
    };
  }

  // 같은 메일(보낸 사람·제목·보낸 시각·본문이 같음)은 한 번만 넣습니다.
  function anAddMails(db, recs) {
    db.an = db.an || emptyAn();
    var ids = db.an.mails.map(function (r) { return r.id; }), added = 0, skipped = 0;
    recs.forEach(function (r) { if (ids.indexOf(r.id) >= 0) { skipped++; return; } ids.push(r.id); db.an.mails.push(r); added++; });
    return { added: added, skipped: skipped };
  }

  // 대장에 반영: A/N 수신 표시, B/L 번호(비어 있을 때만), ETA(가장 최근 A/N 값), ETD(비어 있을 때만)
  function anSyncToPos(db) {
    var q = anQueue(db), n = 0;
    q.rows.forEach(function (r) {
      if (r.source !== 'mail') return;
      var p = db.pos.filter(function (x) { return x.po_no === r.po_no; })[0];
      if (!p) return;
      var before = JSON.stringify([p.an_received, p.bl_no, p.eta, p.etd]);
      p.an_received = true;
      if (!p.bl_no) p.bl_no = r.bl;
      if (r.eta) p.eta = r.eta;
      if (!p.etd && r.etd) p.etd = r.etd;
      if (JSON.stringify([p.an_received, p.bl_no, p.eta, p.etd]) !== before) n++;
    });
    return n;
  }

  function anHistPush(db, e) { db.an.history.push(e); }
  // 항차등록 완료 표시. date = 등록일(사람이 고름), now = 누른 시각(이력)
  function anRegister(db, rows, date, now) {
    db.an = db.an || emptyAn();
    now = now || new Date().toISOString();
    rows.forEach(function (r) {
      db.an.regs[r.key] = { date: date, eta: r.eta || '', at: now };
      anHistPush(db, { at: now, action: 'register', po_no: r.po_no, bl: r.bl, date: date, eta: r.eta || '' });
    });
    return rows.length;
  }
  function anUnregister(db, row, now) {
    now = now || new Date().toISOString();
    var reg = db.an.regs[row.key];
    if (!reg) return false;
    delete db.an.regs[row.key];
    anHistPush(db, { at: now, action: 'unregister', po_no: row.po_no, bl: row.bl, date: reg.date, eta: reg.eta });
    return true;
  }
  // 등록 뒤 ETA 가 바뀐 건: SRM 조정 ETA 를 고쳐 넣었다고 표시(등록 때 ETA 를 새 값으로)
  function anConfirmEta(db, row, now) {
    now = now || new Date().toISOString();
    var reg = db.an.regs[row.key];
    if (!reg || !row.etaAfterReg) return false;
    anHistPush(db, { at: now, action: 'eta_confirm', po_no: row.po_no, bl: row.bl, date: reg.date, eta_from: reg.eta, eta: row.eta });
    reg.eta = row.eta;
    return true;
  }
  var AN_ACTION = { register: '항차등록 완료', unregister: '등록 취소', eta_confirm: '등록 후 ETA 변경 반영', eta_change: 'A/N ETA 변경' };
  // 이력 = 사람이 누른 기록(저장) + A/N 에서 찾은 ETA 변경(계산). 최근 것부터.
  function anHistory(db) {
    var an = db.an || emptyAn();
    var out = an.history.map(function (e) { return Object.assign({ kind: 'user' }, e); });
    anGroups(an.mails).forEach(function (g) {
      g.etaChanges.forEach(function (c) { out.push({ kind: 'mail', at: c.at, action: 'eta_change', po_no: g.poList.join(', '), bl: g.bl, eta_from: c.from, eta: c.to, file: c.file }); });
    });
    return out.sort(function (a, b) { return str(b.at).localeCompare(str(a.at)); });
  }
  function anRegDateOf(db, poNo) {
    var regs = (db && db.an && db.an.regs) || {}, out = [];
    Object.keys(regs).forEach(function (k) { if (k.split('|')[0] === poNo) out.push(regs[k].date); });
    return out.join(', ');
  }

  /* 내보내기 표 */
  function anMailRows(db) {
    var q = anQueue(db);
    return ((db.an && db.an.mails) || []).map(function (r) {
      var g = q.groups.filter(function (x) { return x.recs.indexOf(r) >= 0; })[0];
      var m = g ? anMatch(g, db) : { list: [], unknown: [] };
      var o = { '받은 날': r.received, '파일': r.file, '보낸 사람': r.from, '제목': r.subject };
      AN_FIELDS.forEach(function (f) { o[f.label] = r.fields[f.key]; });
      o['중량(kg 환산)'] = weightKg(r.fields.weight) == null ? '' : weightKg(r.fields.weight);
      o['대장 PO 연결'] = m.list.map(function (x) { return x.po.po_no + '(' + x.via + ')'; }).join(', ');
      o['대장에 없는 PO 번호'] = m.unknown.join(', ');
      o['고친 칸'] = AN_FIELDS.filter(function (f) { return r.parsed && r.fields[f.key] !== r.parsed[f.key]; }).map(function (f) { return f.label; }).join(', ');
      return o;
    });
  }
  function anQueueRows(rows, db) {
    return rows.map(function (r) {
      var s = supplierByCode(db.suppliers, r.supplier_code);
      return {
        'PO 번호': r.po_no, '업체': s ? s.name : r.supplier_code, 'B/L 번호': r.bl, 'Master B/L': r.mbl, '연결 근거': r.via,
        '선명': r.vessel, '항차': r.voyage, 'ETD': r.etd, 'ETA': r.eta, '도착항': r.pod,
        'ETA 변경': r.etaChanges.map(function (c) { return c.from + ' → ' + c.to; }).join('; '),
        'A/N 통수': r.anCount, '첫 A/N': r.firstAn, '마지막 A/N': r.lastAn,
        '항차등록일': r.reg ? r.reg.date : '', '등록 때 ETA': r.reg ? r.reg.eta : '',
        '상태': !r.reg ? '항차등록 대기' : r.etaAfterReg ? '등록 후 ETA 변경(' + r.etaAfterReg.from + ' → ' + r.etaAfterReg.to + ')' : '등록 완료'
      };
    });
  }
  function anHistoryRows(db) {
    return anHistory(db).map(function (e) {
      return { '시각': e.at, '구분': AN_ACTION[e.action] || e.action, 'PO 번호': e.po_no, 'B/L 번호': e.bl, '등록일': e.date || '', '이전 ETA': e.eta_from || '', 'ETA': e.eta || '', '근거 파일': e.file || '' };
    });
  }
  // CSV — 엑셀에서 한글이 깨지지 않도록 BOM, 칸 안의 쉼표·따옴표·줄바꿈은 따옴표로 감쌈
  function toCsv(rows) {
    if (!rows.length) return '﻿';
    var head = [];
    rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (head.indexOf(k) < 0) head.push(k); }); });
    function q(v) { v = v == null ? '' : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    return '﻿' + [head.map(q).join(',')].concat(rows.map(function (r) { return head.map(function (k) { return q(r[k]); }).join(','); })).join('\r\n') + '\r\n';
  }

  /* ── 엑셀 내보내기용 표 ─────────────────────────────── */
  function ledgerRows(db, today) {
    return db.pos.map(function (p) {
      var s = supplierByCode(db.suppliers, p.supplier_code);
      var delay = p.exw_promised && p.exw_actual ? daysBetween(p.exw_promised, p.exw_actual) : '';
      return {
        'PO 번호': p.po_no, '업체 코드': p.supplier_code, '업체명': s ? s.name : '', '품목·품번': p.item,
        '발주일': p.po_date, '송부일': p.sent_date, 'OC 수령일': p.oc_date,
        '약속 EXW DATE': p.exw_promised, '실제 출고일': p.exw_actual, 'EXW 지연일': delay,
        '선적 예정일(ETD)': p.etd, 'A/N 수신': p.an_received ? 'Y' : '', '선적서류 수신': p.docs_received ? 'Y' : '',
        '상태': poFlags(p, today, db.settings).map(function (f) { return f.label; }).join(', '), '메모': p.note,
        'PO 납기': p.delivery_date || '', 'OC 번호': p.oc_no || '', 'EXW 일정(품번별)': exwPlanText(p),
        '항차 진행': (function () { var v = voyageProgress(p); return v.done + '/' + v.total; })(),
        'B/L 번호': p.bl_no || '', 'ETA': p.eta || '', '항차등록일': anRegDateOf(db, p.po_no)
      };
    });
  }

  function pct(v) { return v == null ? '-' : (Math.round(v * 1000) / 10).toFixed(1) + '%'; }
  function num1(v) { return v == null ? '-' : (Math.round(v * 10) / 10).toFixed(1); }

  var api = {
    emptyDb: emptyDb, defaultSettings: defaultSettings, defaultTemplates: defaultTemplates, TEMPLATE_KEYS: TEMPLATE_KEYS,
    FIELDS: FIELDS, guessMapping: guessMapping, missingRequired: missingRequired, applyMapping: applyMapping,
    toDate: toDate, daysBetween: daysBetween, todayIso: todayIso, toNumber: toNumber, norm: norm, str: str,
    splitEmails: splitEmails, domainOf: domainOf, importSuppliers: importSuppliers, mergeSuppliers: mergeSuppliers,
    searchSuppliers: searchSuppliers, supplierByCode: supplierByCode, findSupplierInText: findSupplierInText, supplierByEmail: supplierByEmail,
    poNumbersIn: poNumbersIn, poFromFileName: poFromFileName, matchPoFile: matchPoFile,
    fillTemplate: fillTemplate, checklistText: checklistText, buildEml: buildEml, poMailDraft: poMailDraft, situationDraft: situationDraft,
    base64: base64, unbase64: unbase64, utf8: utf8, safeFileName: safeFileName,
    cleanPo: cleanPo, upsertPos: upsertPos, poFlags: poFlags, hasFlag: hasFlag, ocStats: ocStats, exwStats: exwStats,
    statsBySupplier: statsBySupplier, ocFollowups: ocFollowups,
    compareWeekly: compareWeekly, packingTotals: packingTotals, compareWeight: compareWeight,
    parseEml: parseEml, classifyMail: classifyMail, applyOcDates: applyOcDates,
    parsePoText: parsePoText, itemSummary: itemSummary, poMailDraftGroup: poMailDraftGroup,
    addDays: addDays, addWorkdays: addWorkdays, addMonths: addMonths, regionOf: regionOf, transitDays: transitDays,
    exwTarget: exwTarget, etaFromEtd: etaFromEtd, lcDates: lcDates,
    parsePromiseCell: parsePromiseCell, weeklyInFileChanges: weeklyInFileChanges, DIR_LABEL: DIR_LABEL,
    VOYAGE_STEPS: VOYAGE_STEPS, voyageStepDone: voyageStepDone, voyageProgress: voyageProgress, DEFAULT_SUPPLIER_CHECKLIST: DEFAULT_SUPPLIER_CHECKLIST,
    isOcAttachment: isOcAttachment, parseOcFileName: parseOcFileName, parseOcGrid: parseOcGrid, compareOcToPo: compareOcToPo,
    parseTsv: parseTsv, cumminsRows: cumminsRows, cumminsExwPlan: cumminsExwPlan, applyCumminsExw: applyCumminsExw,
    cumminsStatusAsOf: cumminsStatusAsOf, cumminsWeekDiff: cumminsWeekDiff, weekNoteText: weekNoteText, exwEntries: exwEntries, exwPlanText: exwPlanText, LB_TO_KG: LB_TO_KG, bytesToBinary: bytesToBinary,
    crc32: crc32, makeZip: makeZip, makeSimplePdf: makeSimplePdf, ledgerRows: ledgerRows, pct: pct, num1: num1,
    emptyAn: emptyAn, AN_FIELDS: AN_FIELDS, AN_ACTION: AN_ACTION, datesIn: datesIn, weightKg: weightKg, anKey: anKey, anPoList: anPoList,
    parseArrivalNotice: parseArrivalNotice, anMailFromText: anMailFromText, anGroups: anGroups, anMatch: anMatch, anQueue: anQueue,
    anAddMails: anAddMails, anSyncToPos: anSyncToPos, anRegister: anRegister, anUnregister: anUnregister, anConfirmEta: anConfirmEta,
    anHistory: anHistory, anRegDateOf: anRegDateOf, anMailRows: anMailRows, anQueueRows: anQueueRows, anHistoryRows: anHistoryRows, toCsv: toCsv
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OMLogic = api;
})(typeof window !== 'undefined' ? window : this);
