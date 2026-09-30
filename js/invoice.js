/* 외자 부품 Invoice 읽기 — 순수 로직 (브라우저·Node 공용, DOM 사용 안 함)
   2026-09-30 요청 「INVOICE PDF 파일 > 엑셀 변환, PO 번호 추가」.

   같은 부서 권도연 님의 hd-project16 「외자부품 Invoice 엑셀 자동 변환」 동작 방식을 참고해
   data09-12 안에서 새로 작성했습니다(코드는 가져오지 않음). 참고한 생각:
     · 공급사마다 열 순서·이름이 달라 열 이름으로 맞히지 않는다. 한 줄의 숫자 중
       「수량 × 단가 = 금액」이 성립하는 조합을 찾는다(열 순서를 몰라도 됨).
     · 유럽식 1.234,56 과 미국식 1,234.56 을 둘 다 읽어 보고 계산이 맞는 쪽을 고른다.
     · 곱셈은 자리를 바꿔도 성립하므로(2 × 2480 = 2480 × 2) 표 전체에서 흔한 자리를 먼저 쓴다.
     · 계산이 안 맞는 부품 줄은 버리지 않고 「짐작」으로 넣어 사람이 고치게 한다.
     · 엑셀은 부품 한 줄마다 헤더(Invoice No·날짜·공급사…)를 붙인 평평한 표.
   data09-12 에서 더한 것: PO 번호(줄마다 · PO 구역 · 헤더), Incoterms, B/L 번호, 적힌 합계(Sub Total)와 대조,
   대장 PO·A/N B/L·항차등록 연결(invoiceLink — logic.js 의 anQueue 를 받아 씀), AI 답(JSON) 읽기, ERP 업로드 표.
   테스트: node test/invoice.test.mjs */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OMInvoice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function keyOf(v) { return str(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  /* ── 숫자 한 토막 → 가능한 값들 ─────────────────────────────── */
  // 1,234.56(미국식) · 1.234,56(유럽식) · 1 234,56(공백 천단위는 줄 나눔에서 이미 갈라져 여기 오지 않음)
  // 점·쉼표가 한 종류로 한 번만 있고 뒤가 정확히 세 자리이면(1.234 · 2,480) 천단위인지 소수점인지 모릅니다 → 둘 다 돌려줌.
  // 그 밖(12.50 · 0,85 · 1,234,567)은 모양으로 확정됩니다. 고르는 것은 계산입니다(solveLine).
  var CUR_WORDS = /\b(?:USD|EUR|JPY|KRW|CNY|RMB|GBP|CHF|SGD|HKD|INR|AUD|CAD|SEK)\b|US\$|[$€£¥₩]/gi;
  function amountCandidates(tok) {
    var s = str(tok).replace(CUR_WORDS, '').replace(/\s+/g, '');
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    s = s.replace(/^[(\-]+|\)+$/g, '');
    if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return [];
    var dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length, out = [];
    function add(x) { x = Number(x); if (isFinite(x)) { if (neg) x = -x; if (out.indexOf(x) < 0) out.push(x); } }
    if (dots && commas) {
      if (s.lastIndexOf('.') > s.lastIndexOf(',')) add(s.replace(/,/g, ''));
      else add(s.replace(/\./g, '').replace(',', '.'));
    } else if (dots || commas) {
      var sep = dots ? '.' : ',', parts = s.split(sep);
      if (parts.length > 2) {
        // 여러 번 끊겼는데 뒤가 모두 세 자리 → 천단위. 아니면 숫자로 볼 수 없음(1.2.3)
        if (parts.slice(1).every(function (g) { return /^\d{3}$/.test(g); })) add(parts.join(''));
      } else if (parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0') {
        add(parts.join('')); add(parts[0] + '.' + parts[1]);
      } else add(parts[0] + '.' + parts[1]);
    } else add(s);
    return out;
  }

  // 한 줄의 숫자 토막(위치 포함). 글자에 붙은 숫자(품번 DIN-912-M8, PO M261110501, 날짜 2026-03-04)는 숫자 칸이 아닙니다.
  function numberCells(line) {
    var s = String(line || ''), out = [], re = /(^|[\s|:;$€£¥₩])((?:US\$|[$€£¥₩])?\(?-?\d[\d.,]*\)?)(?=$|[\s|;])/g, m;
    while ((m = re.exec(s))) {
      var tok = m[2], at = m.index + m[1].length;
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(tok) || /^\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}$/.test(tok)) continue;   // 날짜
      var vals = amountCandidates(tok);
      if (vals.length) out.push({ tok: tok, at: at, vals: vals });
      re.lastIndex = at + tok.length;
    }
    return out;
  }

  var TOL_ABS = 0.02, TOL_REL = 0.0005;   // 단가 반올림 차이는 봐 줍니다(작은 금액은 0.02, 큰 금액은 0.05%)
  function near(a, b) { return isFinite(a) && isFinite(b) && (Math.abs(a - b) <= TOL_ABS || Math.abs(a - b) <= Math.abs(b) * TOL_REL); }

  // 숫자 칸들에서 (수량, 단가, 금액) 을 찾습니다. 자리 pos 는 뒤에서 센 번호(-1 = 맨 뒤)로 돌려줍니다 —
  // 줄 앞쪽(항번·품번 속 숫자)은 줄마다 개수가 달라도, 금액 열은 늘 뒤쪽이기 때문입니다.
  function solveLine(cells, pattern) {
    var n = cells.length;
    if (n < 3) return null;
    var best = null;
    function tryIdx(iq, iu, ia, bonus) {
      cells[iq].vals.forEach(function (q) {
        cells[iu].vals.forEach(function (u) {
          cells[ia].vals.forEach(function (a) {
            if (!(q > 0) || u < 0 || !near(q * u, a)) return;
            if (q === 1 && u === a && a <= 1) return;   // 1 × 1 = 1 같은 우연한 일치
            var score = bonus + ia * 100 + (Math.floor(q) === q ? 40 : 0) + (iq < iu ? 10 : 0) + (u >= q ? 3 : 0) + (ia === n - 1 ? 20 : 0);
            if (!best || score > best.score) best = { qty: q, unit: u, amount: a, score: score, pos: [iq - n, iu - n, ia - n], at: Math.min(cells[iq].at, cells[iu].at, cells[ia].at) };
          });
        });
      });
    }
    if (pattern) {
      var iq = n + pattern[0], iu = n + pattern[1], ia = n + pattern[2];
      if (iq >= 0 && iu >= 0 && ia >= 0 && iq < n && iu < n && ia < n) tryIdx(iq, iu, ia, 100000);
      if (best) return best;
    }
    for (var a = 2; a < n; a++) for (var q = 0; q < a; q++) for (var u = 0; u < a; u++) if (q !== u) tryIdx(q, u, a, 0);
    return best;
  }

  /* ── 날짜 ─────────────────────────────── */
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function iso(y, m, d) {
    if (y < 100) y += 2000;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (y < 1990 || y > 2100 || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  // { iso, ambiguous, alt } — 03/04/2026 처럼 일·월을 가릴 수 없으면 월/일로 두고 ambiguous(다른 해석 alt).
  // 점(15.02.2026)은 유럽식 일.월.연 으로 봅니다(둘 다 12 이하면 역시 ambiguous).
  function readDate(text) {
    var t = str(text), m;
    if ((m = /(\d{4})[-.\/년]\s*(\d{1,2})[-.\/월]\s*(\d{1,2})/.exec(t))) { var a = iso(+m[1], +m[2], +m[3]); return a ? { iso: a, ambiguous: false, alt: '' } : null; }   // 2026-02-30 은 없는 날
    if ((m = /(\d{1,2})(?:st|nd|rd|th)?[\s\-.\/]*([A-Za-z]{3,9})\.?[\s\-.\/,]*(\d{2,4})/.exec(t)) && MON[m[2].slice(0, 3).toLowerCase()]) {
      var b = iso(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]); if (b) return { iso: b, ambiguous: false, alt: '' };
    }
    if ((m = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/.exec(t)) && MON[m[1].slice(0, 3).toLowerCase()]) {
      var c = iso(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]); if (c) return { iso: c, ambiguous: false, alt: '' };
    }
    if ((m = /(?:^|[^\d])(\d{1,2})([.\/\-])(\d{1,2})\2(\d{4}|\d{2}(?!\d))/.exec(t))) {
      var p = +m[1], q = +m[3], y = +m[4], dayFirst = m[2] === '.';
      if (p > 12 && q <= 12) return { iso: iso(y, q, p), ambiguous: false, alt: '' };
      if (q > 12 && p <= 12) return { iso: iso(y, p, q), ambiguous: false, alt: '' };
      if (p <= 12 && q <= 12) {
        var md = iso(y, p, q), dm = iso(y, q, p);
        if (p === q) return { iso: md, ambiguous: false, alt: '' };
        return dayFirst ? { iso: dm, ambiguous: true, alt: md } : { iso: md, ambiguous: true, alt: dm };
      }
    }
    return null;
  }

  /* ── 헤더(라벨 : 값) ─────────────────────────────── */
  var CURRENCIES = ['USD', 'EUR', 'JPY', 'KRW', 'CNY', 'RMB', 'GBP', 'CHF', 'SGD', 'HKD', 'INR', 'AUD', 'CAD', 'SEK'];
  var INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CNF', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DAT', 'DDP'];
  // 구체적인 라벨부터. 라벨을 바깥 고리로 돌아야 위쪽 제목 「COMMERCIAL INVOICE」가 느슨한 라벨에 먼저 걸리지 않습니다.
  var LABELS = {
    invoiceNo: ['commercial invoice no', 'invoice number', 'invoice no', 'invoice #', 'inv. no', 'inv no', 'rechnungsnummer', 'rechnung nr', 'invoice', '인보이스 번호', '송장 번호'],
    date: ['invoice date', 'date of invoice', 'issue date', 'date of issue', 'rechnungsdatum', 'datum', 'date', '발행일', '일자'],
    supplier: ['supplier', 'seller', 'shipper / exporter', 'shipper/exporter', 'exporter', 'shipper', 'vendor', 'lieferant', 'beneficiary', 'from', '공급자', '수출자'],
    currency: ['currency', 'curr.', 'ccy', 'währung', '통화'],
    poNo: ['purchase order no', 'purchase order', 'p/o no', 'po no', 'p.o. no', 'po number', 'contract no', 'your order no', 'your order', 'order no', 'ihre bestellung', '발주 번호', '발주번호'],
    blNo: ['b/l no', 'bl no', 'bill of lading no', 'awb no', 'hawb no', 'house b/l', 'b/l']
  };
  function cleanLines(text) { return String(text || '').split(/\r?\n/).map(function (l) { return l.replace(/ /g, ' ').replace(/\s+$/, ''); }); }
  // 줄 안 라벨 → 값(같은 줄 뒤, 없으면 다음 줄). 값은 칸 사이(3칸 이상 공백·탭) 앞까지.
  function findLabel(lines, labels) {
    for (var k = 0; k < labels.length; k++) {
      var lab = labels[k];
      for (var i = 0; i < lines.length; i++) {
        var low = lines[i].toLowerCase(), at = low.indexOf(lab);
        while (at >= 0) {
          var before = at ? low.charAt(at - 1) : ' ', after = low.charAt(at + lab.length) || ' ';
          if (!/[a-z0-9]/.test(before) && !/[a-z]/.test(after)) break;
          at = low.indexOf(lab, at + 1);
        }
        if (at < 0) continue;
        var rest = lines[i].slice(at + lab.length);
        if (/^\s*\.?\s*[A-Za-z]+(?=[\s,.]|$)/.test(rest) && !/^\s*[:：#]/.test(rest) && lab.length < 6) continue;   // 「Date of shipment」의 date 같은 것(숫자 섞인 값 M261110501 은 값)
        var val = rest.replace(/^[\s.:：#\-]+/, '').split(/\t|\s{3,}/)[0].trim();
        if (val) return { value: val, line: i, label: lab };
        for (var j = i + 1; j < Math.min(lines.length, i + 3); j++) if (lines[j].trim()) return { value: lines[j].trim().split(/\t|\s{3,}/)[0], line: j, label: lab };
      }
    }
    return null;
  }
  function incotermIn(text) {
    var m = new RegExp('\\b(' + INCOTERMS.join('|') + ')\\b(?!\\s*(?:DATE|DAY))\\s*([A-Za-z][A-Za-z .,\\-]{1,30})?', 'i').exec(str(text));
    if (!m) return null;
    var place = str(String(m[2] || '').split(/\s{2,}|\t/)[0]).replace(/\b(incoterms?|20\d\d)\b.*$/i, '').replace(/[.,\s]+$/, '');
    return { code: m[1].toUpperCase().replace('CNF', 'CFR'), place: place };
  }

  // PO 번호 찾기: 설정 정규식(있으면) · 사내 PO 모양(영문 1자 + 숫자 9자리) · 대장에 있는 PO 번호
  function poFinder(opts) {
    opts = opts || {};
    var custom = null;
    if (opts.poRegex) { try { custom = new RegExp(opts.poRegex, 'g'); } catch (e) { custom = null; } }
    var ledger = (opts.ledgerPos || []).map(function (p) { return str(p).toUpperCase(); }).filter(function (p) { return p.length >= 5; });
    return function (line) {
      var s = String(line || ''), up = s.toUpperCase(), hits = [];
      function add(v, i) { v = str(v).toUpperCase(); if (v && /\d/.test(v) && !hits.some(function (h) { return h.v === v; })) hits.push({ v: v, at: i, len: v.length }); }
      if (custom) { custom.lastIndex = 0; var m, g = 0; while ((m = custom.exec(s)) && g++ < 50) { var v = m[1] != null ? m[1] : m[0]; add(v, m.index + m[0].indexOf(v)); if (m.index === custom.lastIndex) custom.lastIndex++; } }
      var re = /(^|[^A-Za-z0-9])([A-Z]\d{9})(?![A-Za-z0-9])/g, m2;
      while ((m2 = re.exec(up))) add(m2[2], m2.index + m2[1].length);
      ledger.forEach(function (p) { var at = up.indexOf(p); if (at >= 0 && !/[A-Z0-9]/.test(up.charAt(at - 1) || ' ') && !/[A-Z0-9]/.test(up.charAt(at + p.length) || ' ')) add(p, at); });
      return hits.sort(function (a, b) { return a.at - b.at; });
    };
  }

  var TOTAL_RE = /\b(sub[\s\-]*total|grand\s*total|total\s*amount|invoice\s*total|amount\s*due|total|zwischensumme|gesamtbetrag|summe|freight|shipping\s*charge|insurance|discount|handling|packing\s*charge|surcharge|vat|tax)\b|합\s*계|소\s*계|총\s*액/i;
  var HEADERISH_RE = /\b(invoice\s*(no|date|#|number)|date\b|p\/?o\s*no|purchase\s*order|order\s*no|contract\s*no|currency|tel\b|fax\b|phone|e-?mail|address|incoterms?|terms\s*of|payment|b\/l|awb|page\s*\d)/i;

  /* ── Invoice 글 하나 읽기 ─────────────────────────────── */
  // opts: { poRegex, ledgerPos: [대장 PO 번호…] }
  function readInvoice(text, opts) {
    opts = opts || {};
    var lines = cleanLines(text), findPo = poFinder(opts);
    var notes = [];
    var h = { invoiceNo: '', date: '', dateAmbiguous: false, dateAlt: '', supplier: '', currency: '', poNo: '', incoterms: '', incotermsPlace: '', blNo: '' };

    var f = findLabel(lines, LABELS.invoiceNo);
    if (f) { var mi = /[A-Za-z0-9][A-Za-z0-9\-_\/.]{1,30}/.exec(f.value.replace(/^(no\.?|number|#)\s*/i, '')); if (mi && /\d/.test(mi[0])) h.invoiceNo = mi[0].replace(/[.]+$/, ''); }
    f = findLabel(lines, LABELS.date);
    var d = f && readDate(f.value);
    if (!d) for (var i = 0; i < lines.length && !d; i++) { d = readDate(lines[i]); if (d) notes.push('날짜 라벨이 없어 본문의 첫 날짜를 썼습니다 — 확인해 주세요'); }
    if (d) { h.date = d.iso; h.dateAmbiguous = d.ambiguous; h.dateAlt = d.alt; if (d.ambiguous) notes.push('날짜 ' + d.iso + ' 는 일·월 순서가 애매합니다(다른 해석 ' + d.alt + ')'); }
    f = findLabel(lines, LABELS.supplier);
    if (f && /[A-Za-z가-힣]{2}/.test(f.value)) h.supplier = f.value.replace(/[,;]\s*$/, '');
    if (!h.supplier) {
      for (var j = 0; j < Math.min(lines.length, 10); j++) {
        if (/\b(co\.?,?\s*ltd|corp(oration)?|inc\.?|gmbh|ag\b|s\.?p\.?a|s\.?a\.?|b\.?v\.?|limited|llc|plc|k\.?k\.?)\b|주식회사|株式会社/i.test(lines[j])) {
          h.supplier = lines[j].trim().split(/\s{3,}|\t/)[0]; notes.push('공급사 라벨이 없어 위쪽 회사명을 썼습니다 — 확인해 주세요'); break;
        }
      }
    }
    f = findLabel(lines, LABELS.currency);
    var curRe = new RegExp('\\b(' + CURRENCIES.join('|') + ')\\b', 'i');
    var cm = f && curRe.exec(f.value);
    if (!cm) cm = curRe.exec(lines.join('\n'));
    if (cm) h.currency = cm[1].toUpperCase().replace('RMB', 'CNY');
    else if (/€/.test(text)) h.currency = 'EUR'; else if (/\$/.test(text)) h.currency = 'USD';
    // Incoterms: 라벨이 든 줄에서 라벨 뒤 글(「Terms of Delivery: EXW Frankfurt, Incoterms 2020」)
    var INC_LABEL = /(incoterms?|terms\s+of\s+delivery|delivery\s+terms?|price\s+terms?|trade\s+terms?|lieferbedingung(?:en)?|인도\s*조건)\s*[:：]?/i, inc = null;
    for (var li = 0; li < lines.length && !inc; li++) {
      var lm = INC_LABEL.exec(lines[li]);
      if (lm) inc = incotermIn(lines[li].slice(lm.index + lm[0].length)) || incotermIn(lines[li]);
    }
    if (!inc) { inc = incotermIn(lines.filter(function (l) { return !numberCells(l).length || /incoterm|terms/i.test(l); }).join('\n')); if (inc) notes.push('Incoterms 라벨 없이 글에서 찾았습니다(' + inc.code + ')'); }
    if (inc) { h.incoterms = inc.code; h.incotermsPlace = inc.place; }
    f = findLabel(lines, LABELS.blNo);
    if (f) { var mb = /[A-Z0-9][A-Z0-9\-]{5,24}/.exec(f.value.toUpperCase()); if (mb && /\d/.test(mb[0])) h.blNo = mb[0]; }

    // PO: 헤더 라벨 → 그 줄의 PO 모양 번호가 우선, 없으면 라벨 값
    var poLabel = findLabel(lines, LABELS.poNo);
    if (poLabel) {
      var ph = findPo(lines[poLabel.line]);
      if (ph.length) h.poNo = ph[0].v;
      else { var mp = /[A-Za-z0-9][A-Za-z0-9\-\/]{3,24}/.exec(poLabel.value); if (mp && /\d/.test(mp[0])) h.poNo = mp[0].toUpperCase(); }
    }

    // ── 1차: 줄마다 숫자 칸을 맞혀 표에서 흔한 자리를 찾습니다(PO 번호는 숫자 칸에서 뺍니다)
    var info = lines.map(function (line) {
      var pos = findPo(line), masked = line;
      pos.forEach(function (p) { masked = masked.slice(0, p.at) + new Array(p.len + 1).join(' ') + masked.slice(p.at + p.len); });
      var cells = numberCells(masked);
      // 헤더 낱말이 있어도 끝이 「수량 단가 금액」 모양이면 부품 줄로 봅니다(품명에 date 등). 전화·팩스 줄은 언제나 헤더
      var phone = /\b(tel|fax|phone|mobile|h\.?p)\b\.?\s*[:：]?/i.test(line);
      return { line: line, masked: masked, pos: pos, cells: cells, total: TOTAL_RE.test(line), header: phone || (HEADERISH_RE.test(line) && !/\d+\s+[\d.,]+\s+[\d.,]+\s*$/.test(masked)) };
    });
    var votes = {};
    info.forEach(function (x) { if (x.total || x.cells.length < 3) return; var s = solveLine(x.cells); if (s) { var k = s.pos.join(','); votes[k] = (votes[k] || 0) + 1; } });
    var pattern = null, top = 0;
    Object.keys(votes).forEach(function (k) { if (votes[k] > top) { top = votes[k]; pattern = k.split(',').map(Number); } });
    if (top < 2) pattern = null;   // 한 줄뿐이면 다수결이 뜻이 없음

    // ── 2차: 부품 줄 · 합계 줄 · PO 구역
    var items = [], skipped = [], totals = { sub: null, total: null, charges: [] }, sectionPo = '', sawItem = false;
    info.forEach(function (x, idx) {
      var line = x.line;
      if (!line.trim()) return;
      if (x.total) {
        var last = x.cells[x.cells.length - 1], v = last ? last.vals[0] : null;
        if (v != null) {
          if (/sub[\s\-]*total|zwischensumme|소\s*계/i.test(line)) totals.sub = v;
          else if (/freight|shipping|insurance|discount|handling|packing|surcharge|vat|tax/i.test(line)) totals.charges.push({ label: line.replace(/[\d.,\s$€£¥₩]+$/, '').trim().slice(0, 40), amount: v });
          else totals.total = v;
        }
        return;
      }
      var sol = x.cells.length >= 3 ? solveLine(x.cells, pattern) : null, guessed = false, why = '';
      if (!sol) {
        // PO 만 적힌 줄(「PO No. M261110501」·「Your order: …」) = 아래 부품의 PO 구역
        // 첫 부품 줄 전의 헤더 PO 줄은 구역이 아니라 헤더입니다
        if (x.pos.length && x.cells.length < 3) { var sp = x.pos[x.pos.length - 1].v; if (sawItem || sp !== h.poNo) sectionPo = sp; return; }
        if (x.cells.length < 3 || x.header) return;
        var head = x.masked.slice(0, x.cells[x.cells.length - 3].at);
        if (!/[A-Za-z가-힣]{3,}/.test(head)) { skipped.push({ lineNo: idx + 1, text: line.trim(), reason: '부품 줄로 보이지 않습니다(숫자 앞에 품번·품명이 없음)' }); return; }
        var t3 = x.cells.slice(-3), vals = t3.map(function (c) { return c.vals[0]; });
        if (!vals.every(function (v) { return v > 0; })) { skipped.push({ lineNo: idx + 1, text: line.trim(), reason: '수량·단가·금액을 양수로 읽지 못했습니다' }); return; }
        sol = { qty: vals[0], unit: vals[1], amount: vals[2], at: t3[0].at };
        guessed = true; why = '수량 × 단가 = 금액이 맞지 않아 뒤의 세 숫자를 차례로 넣었습니다 — 원본과 대조해 고쳐 주세요';
      }
      sawItem = true;
      var body = x.masked.slice(0, sol.at).replace(/^\s*\d{1,3}\s*[.)\]]?\s+(?=\S)/, '').trim();
      // 품번: 영문·숫자가 섞이거나 하이픈이 든 첫 낱말. 숫자만 3자리 이하(항번)는 아님
      var words = body.split(/\s+/), partNo = '', rest = [];
      words.forEach(function (w) {
        var c = w.replace(/[,;]+$/, '');
        if (!partNo && c.length >= 3 && /\d/.test(c) && (/[A-Za-z]/.test(c) || /[\-.\/]/.test(c) || c.length >= 5) && /^[A-Za-z0-9][A-Za-z0-9\-._\/]*$/.test(c)) partNo = c;
        else rest.push(w);
      });
      var desc = rest.join(' ').replace(/^[\s|.\-:]+|[\s|.\-:]+$/g, '').replace(/\s{2,}/g, ' ');
      // 금액 뒤의 숫자 칸(단위 무게 등)은 무시. 줄 속 PO 가 여럿이면 첫째
      var po = x.pos.length ? x.pos[0].v : (sectionPo || h.poNo || '');
      var poFrom = x.pos.length ? '줄' : sectionPo ? 'PO 구역' : h.poNo ? '헤더' : '';
      items.push({ lineNo: idx + 1, poNo: po, poFrom: poFrom, partNo: partNo, desc: desc, qty: sol.qty, unitPrice: sol.unit, amount: sol.amount, guessed: guessed, why: why, source: line.trim(), edited: false });
    });
    if (!h.poNo) {
      var all = [];
      items.forEach(function (it) { if (it.poNo && all.indexOf(it.poNo) < 0) all.push(it.poNo); });
      if (all.length === 1) h.poNo = all[0];
    }
    if (!items.length && sawItem === false) notes.push('부품 줄을 찾지 못했습니다. 스캔본이면 「AI 로 읽기」를 써 주세요');
    return { header: h, items: items, skipped: skipped, totals: totals, notes: notes, pattern: pattern };
  }

  /* ── 검산 ─────────────────────────────── */
  function checkItem(it) {
    var q = Number(it.qty), u = Number(it.unitPrice), a = Number(it.amount);
    if (!isFinite(q) || !isFinite(u) || !isFinite(a) || it.qty === '' || it.unitPrice === '' || it.amount === '') return { ok: false, expected: null, diff: null, why: '수량·단가·금액 중 숫자가 아닌 칸이 있습니다' };
    var e = round2(q * u);
    if (near(q * u, a)) return { ok: true, expected: e, diff: 0, why: '' };
    return { ok: false, expected: e, diff: round2(a - e), why: '수량 × 단가 = ' + e + ' 인데 금액은 ' + a + ' (차이 ' + round2(a - e) + ')' };
  }
  // 문서 합계: 부품 금액 합, 적힌 Sub Total(없으면 Total − 부대비용)과 대조
  function docSummary(doc) {
    var sum = 0, bad = 0, guessed = 0;
    (doc.items || []).forEach(function (it) { var a = Number(it.amount); if (isFinite(a)) sum += a; if (!checkItem(it).ok) bad++; if (it.guessed && !it.edited) guessed++; });
    sum = round2(sum);
    var t = doc.totals || {}, stated = null, statedLabel = '';
    if (t.sub != null) { stated = t.sub; statedLabel = 'Sub Total'; }
    else if (t.total != null) {
      var ch = (t.charges || []).reduce(function (a, c) { return a + (Number(c.amount) || 0); }, 0);
      stated = round2(t.total - ch); statedLabel = ch ? 'Total − 부대비용' : 'Total';
    }
    var totalOk = stated == null ? null : near(sum, stated);
    return { sum: sum, lines: (doc.items || []).length, bad: bad, guessed: guessed, stated: stated, statedLabel: statedLabel, totalOk: totalOk, diff: stated == null ? null : round2(sum - stated) };
  }

  /* ── PDF 글 조각 → 줄 (pdf.js getTextContent 의 items) ─────────────────────────────── */
  // 같은 높이(y ±2)끼리 한 줄, 왼쪽부터. 조각 사이가 글자 폭보다 넓게 벌어지면 칸이 나뉜 것이라 공백 세 칸을 넣어 열을 살립니다.
  function itemsToLines(items) {
    var rows = [];
    (items || []).forEach(function (it) {
      if (!it || !it.str || !it.transform) return;
      var y = it.transform[5], x = it.transform[4], size = Math.abs(it.transform[0]) || Math.abs(it.transform[3]) || 10;
      var w = it.width != null ? it.width : it.str.length * size * 0.5;
      var row = null;
      for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i].y - y) <= 2) { row = rows[i]; break; }
      if (!row) { row = { y: y, parts: [] }; rows.push(row); }
      row.parts.push({ x: x, end: x + w, s: it.str, size: size });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      var out = '', prev = null;
      r.parts.forEach(function (p) {
        if (prev) {
          var gap = p.x - prev.end;
          if (gap > p.size * 1.2) out += '   ';
          else if (gap > p.size * 0.15 && !/\s$/.test(out) && !/^\s/.test(p.s)) out += ' ';
        }
        out += p.s; prev = p;
      });
      return out.replace(/\s+$/, '');
    }).join('\n');
  }

  /* ── 반자동 AI(스캔본) ─────────────────────────────── */
  var AI_SCHEMA = '{"invoice_no":"","invoice_date":"YYYY-MM-DD","supplier":"","currency":"","incoterms":"","incoterms_place":"","po_no":"","bl_no":"","sub_total":null,"total":null,"lines":[{"po_no":"","part_no":"","description":"","qty":0,"unit_price":0,"amount":0}]}';
  function aiPrompt(fileName, extraText) {
    return [
      '첨부한 외자 부품 Invoice(' + (fileName || '파일') + ')에서 아래 값을 읽어 JSON 하나로만 답해줘. 설명 글이나 코드 블록 표시는 빼줘.',
      '',
      '형식:',
      AI_SCHEMA,
      '',
      '규칙:',
      '1. 부품 한 줄마다 lines 에 하나씩 넣어줘. Sub Total·Freight·Insurance·Total 같은 합계·부대비용 줄은 lines 에 넣지 말고 sub_total·total 에만 넣어줘.',
      '2. 숫자는 쉼표 없는 숫자로 적어줘. 유럽식 1.234,56 은 1234.56 이야.',
      '3. PO 번호(발주 번호, Order No, Contract No)가 줄마다 있으면 그 줄의 po_no 에, 문서 위쪽에 하나만 있으면 po_no 에 적어줘.',
      '4. 날짜는 YYYY-MM-DD 로. 03/04/2026 처럼 일·월을 알 수 없으면 원문 그대로 적어줘.',
      '5. 보이지 않거나 흐려서 확실하지 않은 칸은 지어내지 말고 빈칸("")이나 null 로 둬줘.',
      '6. 수량 × 단가 가 금액과 다르더라도 고치지 말고 문서에 적힌 그대로 적어줘.',
      extraText ? '\n참고로 PDF 에서 꺼낸 글은 아래와 같아(스캔본이면 비어 있을 수 있어):\n' + String(extraText).slice(0, 6000) : ''
    ].join('\n').trim();
  }
  function num(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return v;
    var c = amountCandidates(String(v).replace(/\s/g, ''));
    return c.length ? c[0] : '';
  }
  // AI 답(글) → 문서. ```json 울타리·앞뒤 설명이 섞여 있어도 가장 바깥 { } 를 꺼내 읽습니다.
  function parseAiAnswer(text) {
    var s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('답에서 JSON({ … })을 찾지 못했습니다.');
    var j;
    try { j = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('JSON 형식이 올바르지 않습니다: ' + e.message); }
    var lines = Array.isArray(j.lines) ? j.lines : Array.isArray(j.items) ? j.items : null;
    if (!lines) throw new Error('lines(부품 줄 목록)가 없습니다.');
    var notes = [];
    var d = readDate(j.invoice_date || j.date || '');
    if (str(j.invoice_date) && !d) notes.push('날짜 「' + j.invoice_date + '」를 읽지 못했습니다 — 확인해 주세요');
    if (d && d.ambiguous) notes.push('날짜 ' + d.iso + ' 는 일·월 순서가 애매합니다(다른 해석 ' + d.alt + ')');
    var headPo = str(j.po_no).toUpperCase();
    var items = lines.map(function (l, i) {
      var po = str(l.po_no || l.po).toUpperCase();
      return { lineNo: i + 1, poNo: po || headPo, poFrom: po ? '줄' : headPo ? '헤더' : '', partNo: str(l.part_no || l.partNo), desc: str(l.description || l.desc),
        qty: num(l.qty), unitPrice: num(l.unit_price != null ? l.unit_price : l.unitPrice), amount: num(l.amount), guessed: false, why: '', source: 'AI 답 ' + (i + 1) + '번째 줄', edited: false };
    });
    var inc = incotermIn(str(j.incoterms) + ' ' + str(j.incoterms_place));
    return {
      header: { invoiceNo: str(j.invoice_no), date: d ? d.iso : '', dateAmbiguous: !!(d && d.ambiguous), dateAlt: d ? d.alt : '', supplier: str(j.supplier),
        currency: str(j.currency).toUpperCase(), poNo: headPo, incoterms: inc ? inc.code : str(j.incoterms).toUpperCase(), incotermsPlace: str(j.incoterms_place) || (inc ? inc.place : ''), blNo: str(j.bl_no).toUpperCase() },
      items: items, skipped: [], totals: { sub: num(j.sub_total) === '' ? null : num(j.sub_total), total: num(j.total) === '' ? null : num(j.total), charges: [] }, notes: notes, pattern: null
    };
  }

  /* ── 대장 PO · A/N B/L · 항차등록 연결 ─────────────────────────────── */
  // L = OMLogic(anQueue·anInvList 사용). 연결 순서(2026-09-30 요청 「인보이스 번호가 있으면 B/L 과 매칭해 항차등록 여부 확인」):
  //  ① A/N 에 적힌 Invoice 번호가 같은 B/L(가장 확실) → ② Invoice 의 PO 번호가 A/N 의 PO 목록에 있는 B/L
  //  → ③ 대장 PO 에 적힌 B/L 번호 → ④ Invoice 에 적힌 B/L 번호. ①이 있으면 ②~④는 참고로만 붙입니다.
  function invoicePos(doc) {
    var out = [];
    if (doc.header && doc.header.poNo) out.push(str(doc.header.poNo).toUpperCase());
    (doc.items || []).forEach(function (it) { var p = str(it.poNo).toUpperCase(); if (p && out.indexOf(p) < 0) out.push(p); });
    return out;
  }
  function invoiceLink(doc, db, L, queue) {
    var q = queue || L.anQueue(db), rows = q.rows, invKey = keyOf(doc.header && doc.header.invoiceNo);
    var pos = invoicePos(doc).map(function (no) {
      var p = (db.pos || []).filter(function (x) { return str(x.po_no).toUpperCase() === no; })[0];
      return { po_no: no, inLedger: !!p, supplier_code: p ? p.supplier_code : '', bl_no: p ? str(p.bl_no) : '' };
    });
    var bls = [];
    function add(row, via, blNo) {
      var k = row ? row.key : keyOf(blNo);
      if (!k) return;
      var ex = bls.filter(function (b) { return b.key === k || (row && row.keys && row.keys.indexOf(b.key) >= 0); })[0];
      if (!ex) { ex = { key: k, bl: row ? row.bl : blNo, row: row || null, via: [] }; bls.push(ex); }
      if (ex.via.indexOf(via) < 0) ex.via.push(via);
    }
    function rowByKey(k) { return rows.filter(function (r) { return r.key === k || keyOf(r.mbl) === k || (r.alias || []).indexOf(k) >= 0; })[0] || null; }
    if (invKey) rows.forEach(function (r) { if ((r.invs || []).some(function (x) { return keyOf(x) === invKey; })) add(r, 'A/N 의 Invoice 번호'); });
    var byInv = bls.length > 0;
    pos.forEach(function (p) {
      rows.forEach(function (r) { if (r.pos.indexOf(p.po_no) >= 0) add(r, 'PO ' + p.po_no + '(A/N)'); });
      if (p.bl_no) add(rowByKey(keyOf(p.bl_no)), 'PO ' + p.po_no + '(대장 B/L)', p.bl_no);
    });
    if (doc.header && doc.header.blNo) add(rowByKey(keyOf(doc.header.blNo)), 'Invoice 에 적힌 B/L', doc.header.blNo);
    // Invoice 번호로 찾았으면 PO 로만 걸린 다른 B/L(같은 PO 의 다른 선적)은 뺍니다
    if (byInv) bls = bls.filter(function (b) { return b.via.indexOf('A/N 의 Invoice 번호') >= 0 || b.via.indexOf('Invoice 에 적힌 B/L') >= 0; });
    bls.forEach(function (b) {
      var r = b.row;
      b.reg = r ? r.reg : null;
      b.eta = r ? r.eta : '';
      b.tms = r ? r.tms : '';
      b.state = !r ? 'no_an' : r.reg ? (r.etaAfterReg ? 'reg_eta' : 'registered') : 'pending';
      b.label = { no_an: 'A/N 없음(항차등록 대기 목록에 없음)', pending: '항차등록 대기', registered: '항차등록 완료 ' + (r && r.reg ? r.reg.date : ''), reg_eta: '등록 후 ETA 변경 — SRM 조정 필요' }[b.state];
      delete b.row;
    });
    var state;
    if (!bls.length) state = pos.length ? 'no_bl' : 'no_po';
    else if (bls.every(function (b) { return b.state === 'registered'; })) state = 'registered';
    else if (bls.some(function (b) { return b.state === 'registered' || b.state === 'reg_eta'; })) state = 'partial';
    else if (bls.some(function (b) { return b.state === 'pending'; })) state = 'pending';
    else state = 'no_an';
    var LABEL = { registered: '항차등록 완료', partial: '일부만 등록(B/L 여러 건)', pending: '항차등록 대기', no_an: 'B/L 은 있으나 A/N 없음', no_bl: '연결된 B/L 없음', no_po: 'PO·B/L 번호 없음' };
    return { pos: pos, bls: bls, byInvoiceNo: byInv, multi: bls.length > 1, state: state, label: LABEL[state] };
  }
  // Invoice 번호(또는 PO 번호)만으로 찾기 — Invoice PDF 를 올리지 않아도 A/N·대장으로 확인
  function lookupByNumber(no, db, L, docs) {
    var k = keyOf(no);
    if (!k) return null;
    var doc = (docs || []).filter(function (d) { return keyOf(d.header && d.header.invoiceNo) === k; })[0];
    if (doc) return { kind: 'Invoice(올린 문서)', link: invoiceLink(doc, db, L) };
    var isPo = (db.pos || []).some(function (p) { return keyOf(p.po_no) === k; }) || /^[A-Z]\d{9}$/.test(k);
    var fake = { header: { invoiceNo: isPo ? '' : str(no), poNo: isPo ? str(no).toUpperCase() : '' }, items: [] };
    return { kind: isPo ? 'PO 번호' : 'Invoice 번호(A/N)', link: invoiceLink(fake, db, L) };
  }

  /* ── 엑셀 표 ─────────────────────────────── */
  // ERP 업로드용: 부품 한 줄 = 한 행, 헤더를 행마다 붙입니다(여러 Invoice 를 합쳐도 어느 줄인지 알 수 있게)
  function erpRows(docs) {
    var out = [];
    (docs || []).forEach(function (d) {
      var h = d.header || {};
      (d.items || []).forEach(function (it) {
        var c = checkItem(it);
        out.push({
          'Invoice No': h.invoiceNo, 'Invoice Date': h.date, 'Supplier': h.supplier, 'Currency': h.currency, 'Incoterms': h.incoterms + (h.incotermsPlace ? ' ' + h.incotermsPlace : ''),
          'PO No': it.poNo || '', 'Part No': it.partNo, 'Description': it.desc, 'Qty': it.qty, 'Unit Price': it.unitPrice, 'Amount': it.amount,
          '검산': c.ok ? 'OK' : '확인 필요', '검산 메모': c.ok ? '' : c.why, 'PO 출처': it.poFrom || '', '짐작 줄': it.guessed && !it.edited ? 'Y' : '', '고침': it.edited ? 'Y' : '',
          '읽은 방식': d.engine || '', '파일': d.file || '', '원문 줄': it.source || ''
        });
      });
    });
    return out;
  }
  function summaryRows(docs, db, L) {
    var q = L ? L.anQueue(db) : null;
    return (docs || []).map(function (d) {
      var s = docSummary(d), h = d.header || {}, lk = L ? invoiceLink(d, db, L, q) : null;
      return {
        '파일': d.file, '읽은 방식': d.engine, 'Invoice No': h.invoiceNo, 'Invoice Date': h.date + (h.dateAmbiguous ? '(일·월 확인)' : ''), 'Supplier': h.supplier, 'Currency': h.currency,
        'Incoterms': h.incoterms + (h.incotermsPlace ? ' ' + h.incotermsPlace : ''), 'PO No(헤더)': h.poNo, 'PO 목록': invoicePos(d).join(', '),
        '부품 줄': s.lines, '금액 합': s.sum, '적힌 합계': s.stated == null ? '' : s.stated, '합계 대조': s.totalOk == null ? '적힌 합계 없음' : s.totalOk ? '일치' : '다름(' + s.diff + ')',
        '검산 확인 필요': s.bad, '대장에 없는 PO': lk ? lk.pos.filter(function (p) { return !p.inLedger; }).map(function (p) { return p.po_no; }).join(', ') : '',
        'B/L': lk ? lk.bls.map(function (b) { return b.bl; }).join(', ') : '', 'B/L 연결 근거': lk ? lk.bls.map(function (b) { return b.bl + ': ' + b.via.join(' · '); }).join(' / ') : '',
        '항차등록': lk ? lk.label : '', 'B/L 별 상태': lk ? lk.bls.map(function (b) { return b.bl + ' ' + b.label; }).join(' / ') : ''
      };
    });
  }

  return {
    amountCandidates: amountCandidates, numberCells: numberCells, solveLine: solveLine, readDate: readDate, incotermIn: incotermIn, poFinder: poFinder,
    readInvoice: readInvoice, checkItem: checkItem, docSummary: docSummary, itemsToLines: itemsToLines,
    AI_SCHEMA: AI_SCHEMA, aiPrompt: aiPrompt, parseAiAnswer: parseAiAnswer,
    invoicePos: invoicePos, invoiceLink: invoiceLink, lookupByNumber: lookupByNumber, erpRows: erpRows, summaryRows: summaryRows, keyOf: keyOf
  };
});
