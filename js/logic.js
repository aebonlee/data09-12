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
      oc_keywords: 'order confirmation, order acknowledgement, OC, confirmation',
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
      po_mail: {
        subject: '[PO {PO}] Purchase Order from {COMPANY}',
        body: 'Dear {CONTACT},\n\nPlease find attached our Purchase Order {PO}.\nKindly send us the Order Confirmation (OC) with the EXW date by return mail.\n\n{CHECKLIST}\n\nBest regards,\n{SENDER}\n{DEPT}\n{COMPANY}'
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

  function emptyDb() {
    return { suppliers: [], pos: [], settings: defaultSettings(), templates: defaultTemplates() };
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
      { key: 'note', label: '메모', aliases: ['메모', 'note', 'remark', '비고'] }
    ],
    weekly: [
      { key: 'po', label: 'PO 번호', required: true, aliases: ['po', 'po no', 'po number', 'po#', 'customer po', 'purchase order', 'order no', 'order number'] },
      { key: 'line', label: 'PO 라인', aliases: ['line', 'line no', 'po line', 'item no', 'line#', '라인'] },
      { key: 'part', label: '품번', aliases: ['part', 'part no', 'part number', 'item', 'material', '품번'] },
      { key: 'qty', label: '수량', aliases: ['qty', 'quantity', 'order qty', '수량'] },
      { key: 'promise', label: 'Promise Date', required: true, aliases: ['promise date', 'promised date', 'promise', 'promise dt', 'confirmed date'] }
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

  function poNumbersIn(text, customRegex) {
    var s = str(text);
    var found = [];
    var re;
    if (customRegex) {
      try { re = new RegExp(customRegex, 'g'); } catch (e) { return { list: [], error: '정규식 오류: ' + e.message }; }
    } else {
      re = new RegExp(DEFAULT_PO_RE.source, 'ig');
    }
    var m, guard = 0;
    while ((m = re.exec(s)) && guard++ < 500) {
      var v = (m[1] != null ? m[1] : m[0]).trim();
      if (!/\d/.test(v)) { if (m.index === re.lastIndex) re.lastIndex++; continue; }
      if (found.indexOf(v) < 0) found.push(v);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return { list: found, error: '' };
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
      note: str(r.note)
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
  function weeklyKey(r) {
    var po = str(r.po), line = str(r.line), part = str(r.part);
    return po + '|' + (line || part);
  }

  function compareWeekly(oldRows, newRows, dayFirst) {
    function index(rows, label) {
      var m = {}, dups = [];
      rows.forEach(function (r) {
        if (!str(r.po)) return;
        var k = weeklyKey(r);
        if (m[k]) dups.push(label + ' ' + k.replace('|', ' / '));
        m[k] = { po: str(r.po), line: str(r.line), part: str(r.part), qty: r.qty == null ? '' : r.qty, promise: toDate(r.promise, dayFirst), raw: str(r.promise) };
      });
      return { map: m, dups: dups };
    }
    var a = index(oldRows, '이전 파일'), b = index(newRows, '새 파일');
    var changed = [], added = [], removed = [], same = 0;
    Object.keys(b.map).forEach(function (k) {
      var n = b.map[k], o = a.map[k];
      if (!o) { added.push(n); return; }
      if (o.promise !== n.promise || (!o.promise && o.raw !== n.raw)) {
        changed.push({ po: n.po, line: n.line, part: n.part || o.part, qty: n.qty, old: o.promise || o.raw, new: n.promise || n.raw, diffDays: daysBetween(o.promise, n.promise) });
      } else same++;
    });
    Object.keys(a.map).forEach(function (k) { if (!b.map[k]) removed.push(a.map[k]); });
    changed.sort(function (x, y) { return (y.diffDays || 0) - (x.diffDays || 0); });
    return { changed: changed, added: added, removed: removed, same: same, duplicates: a.dups.concat(b.dups) };
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

  /* ── .eml 읽기·업체별 분류 ─────────────────────────────── */
  function decodeQP(s) {
    var bytes = [];
    s = s.replace(/=\r?\n/g, '');
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(s.charCodeAt(i) & 255);
    }
    return new Uint8Array(bytes);
  }
  function decodeWords(v) {
    return str(v).replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, function (all, cs, enc, txt) {
      var bytes = enc.toUpperCase() === 'B' ? unbase64(txt) : decodeQP(txt.replace(/_/g, ' '));
      return fromUtf8(bytes, cs);
    });
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
  function partText(part) {
    var ct = part.headers['content-type'] || 'text/plain';
    var enc = str(part.headers['content-transfer-encoding']).toLowerCase();
    var cs = (/charset="?([^";\s]+)/i.exec(ct) || [])[1] || 'utf-8';
    var bm = /boundary="?([^";]+)"?/i.exec(ct);
    if (/multipart\//i.test(ct) && bm) {
      var chunks = part.body.split('--' + bm[1]).slice(1);
      var texts = chunks.map(function (c) { return splitHead(c.replace(/^\r?\n/, '')); })
        .filter(function (p) { return !/attachment/i.test(p.headers['content-disposition'] || ''); });
      var plain = texts.filter(function (p) { return /text\/plain/i.test(p.headers['content-type'] || ''); })[0];
      var pick = plain || texts.filter(function (p) { return /text\/|multipart\//i.test(p.headers['content-type'] || ''); })[0];
      return pick ? partText(pick) : '';
    }
    var bytes;
    if (enc === 'base64') bytes = unbase64(part.body);
    else if (enc === 'quoted-printable') bytes = decodeQP(part.body);
    else bytes = null;
    var text = bytes ? fromUtf8(bytes, cs) : part.body;
    if (/text\/html/i.test(ct)) text = text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    return text;
  }
  function addrOf(v) {
    var m = /<([^>]+)>/.exec(v || '');
    return (m ? m[1] : str(v).split(/[,;]/)[0]).trim().toLowerCase();
  }
  function parseEml(raw) {
    var p = splitHead(String(raw || ''));
    var date = '';
    if (p.headers.date) { var t = Date.parse(p.headers.date.replace(/\s*\(.*\)$/, '')); if (!isNaN(t)) date = toDate(new Date(t)); }
    return {
      from: decodeWords(p.headers.from || ''), fromAddr: addrOf(decodeWords(p.headers.from || '')),
      to: decodeWords(p.headers.to || ''), subject: decodeWords(p.headers.subject || ''),
      date: date, body: partText(p)
    };
  }

  // 메일 한 통 분류: 발신 주소로 업체를 찾고, 제목·본문에 대장의 PO 번호가 있으면 연결합니다.
  // OC 후보 = 업체 메일 + 대장 PO 번호 포함 + 제목·본문에 OC 낱말 포함 + 그 PO 의 OC 수령일이 비어 있음
  function classifyMail(mail, db) {
    var sup = supplierByEmail(db.suppliers, mail.fromAddr);
    var hay = mail.subject + '\n' + mail.body;
    var hayN = hay.toUpperCase();
    var pos = db.pos.filter(function (p) {
      if (!p.po_no) return false;
      var re = new RegExp('(^|[^A-Z0-9])' + p.po_no.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&').toUpperCase() + '($|[^A-Z0-9])');
      return re.test(hayN);
    }).map(function (p) { return p.po_no; });
    var kws = str(db.settings.oc_keywords).split(/\s*,\s*/).filter(Boolean);
    var kwHit = kws.filter(function (k) {
      var re = new RegExp('(^|[^A-Za-z])' + k.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&') + '($|[^A-Za-z])', /^[A-Z]{2,3}$/.test(k) ? '' : 'i');
      return re.test(hay);
    });
    var ocTargets = pos.filter(function (no) {
      var p = db.pos.filter(function (x) { return x.po_no === no; })[0];
      return p && !p.oc_date && (!sup || !p.supplier_code || p.supplier_code === sup.code);
    });
    return {
      supplier_code: sup ? sup.code : '', supplier_name: sup ? sup.name : '(미분류)',
      pos: pos, keywords: kwHit,
      ocCandidates: sup && kwHit.length ? ocTargets : [],
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
        '상태': poFlags(p, today, db.settings).map(function (f) { return f.label; }).join(', '), '메모': p.note
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
    crc32: crc32, makeZip: makeZip, makeSimplePdf: makeSimplePdf, ledgerRows: ledgerRows, pct: pct, num1: num1
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OMLogic = api;
})(typeof window !== 'undefined' ? window : this);
