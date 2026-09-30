/* 원산지증명서(C/O) 요청 관리 — 순수 로직 (브라우저·Node 공용, DOM 사용 안 함)
   2026-09-30 요청: 「통관팀이 요청한 원산지증명서 요청 메일 관리 탭 > 업체에 메일 초안 작성 후 전달」
   · 통관팀 요청을 한 건씩 적고(요청일·B/L·Invoice·PO·업체·필요한 C/O 종류·기한·상태)
   · 업체에 보낼 영문 메일 초안(국문 요약 함께)을 만들어 메일 프로그램으로 열기(mailto)·복사·.eml 저장
   · 상태(요청 접수 → 메일 작성 → 업체에 요청 → C/O 수령 → 통관팀 전달)와 바꾼 이력을 남깁니다(이력은 고치거나 지우지 않음).
   테스트: node test/logic.test.mjs */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OMCo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function keyOf(v) { return str(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function dayNum(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(iso)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; }

  var STATUS = [
    { key: 'requested', label: '요청 접수', note: '통관팀에게 요청을 받음' },
    { key: 'drafted', label: '메일 작성', note: '업체 메일 초안을 만듦' },
    { key: 'sent', label: '업체에 요청', note: '업체에 메일을 보냄' },
    { key: 'received', label: 'C/O 수령', note: '업체에게 원산지증명서를 받음' },
    { key: 'forwarded', label: '통관팀 전달', note: '받은 C/O 를 통관팀에 넘김(끝)' },
    { key: 'cancelled', label: '취소', note: '요청이 없어짐' }
  ];
  var DONE = { forwarded: true, cancelled: true };
  function statusLabel(k) { var s = STATUS.filter(function (x) { return x.key === k; })[0]; return s ? s.label : k; }

  // 흔히 쓰는 이름만 예로 둡니다. 실제로는 통관팀이 요청한 서식 이름을 그대로 적습니다(협정마다 서식·발급 방식이 다름).
  var TYPES = [
    { ko: 'FTA 원산지증명서', en: 'FTA Certificate of Origin' },
    { ko: '원산지신고서(Origin Declaration)', en: 'Origin Declaration (on the commercial invoice)' },
    { ko: '일반 원산지증명서(비특혜)', en: 'Certificate of Origin (non-preferential)' }
  ];
  function typeEn(ko) {
    var t = TYPES.filter(function (x) { return x.ko === str(ko); })[0];
    if (t) return t.en;
    return /[가-힣]/.test(str(ko)) ? 'Certificate of Origin' + (str(ko) ? ' — ' + str(ko) : '') : (str(ko) || 'Certificate of Origin');
  }

  function emptyCo() { return { reqs: [], history: [] }; }
  function ensure(db) { db.co = db.co && typeof db.co === 'object' ? db.co : emptyCo(); db.co.reqs = db.co.reqs || []; db.co.history = db.co.history || []; return db.co; }

  var FIELDS = ['requested_on', 'requester', 'bl_no', 'invoice_no', 'po_no', 'supplier_code', 'co_type', 'due_date', 'note', 'bl_date', 'issue_date'];
  function clean(input) {
    var r = {};
    FIELDS.forEach(function (k) { r[k] = str(input && input[k]); });
    r.bl_no = r.bl_no.toUpperCase(); r.po_no = r.po_no.toUpperCase().replace(/\s*[,;\s]\s*/g, ', ').replace(/^,\s*|,\s*$/g, '');
    return r;
  }
  // 새 요청. now = ISO 시각(기록), id 는 시각 + 순번으로
  function coAdd(db, input, now) {
    var co = ensure(db), r = clean(input);
    if (!r.bl_no && !r.invoice_no && !r.po_no) throw new Error('B/L·Invoice·PO 번호 중 하나는 적어 주세요.');
    if (!r.requested_on) r.requested_on = str(now).slice(0, 10);
    r.id = 'co' + str(now).replace(/[^0-9]/g, '').slice(0, 14) + '-' + (co.reqs.length + 1);
    r.status = 'requested'; r.sent_on = ''; r.received_on = ''; r.forwarded_on = ''; r.created_at = now;
    co.reqs.push(r);
    co.history.push({ at: now, id: r.id, action: 'create', from: '', to: 'requested', date: r.requested_on, ref: refText(r), note: r.note });
    return r;
  }
  function byId(db, id) { return ensure(db).reqs.filter(function (r) { return r.id === id; })[0] || null; }
  // 칸 고치기 — 바뀐 칸 이름을 이력에 남깁니다
  function coUpdate(db, id, patch, now) {
    var r = byId(db, id);
    if (!r) return false;
    var c = clean(Object.assign({}, r, patch)), changed = [];
    FIELDS.forEach(function (k) { if (patch && k in patch && c[k] !== str(r[k])) { changed.push(k); r[k] = c[k]; } });
    if (changed.length) ensure(db).history.push({ at: now, id: id, action: 'edit', from: r.status, to: r.status, date: '', ref: refText(r), note: '고친 칸: ' + changed.join(', ') });
    return changed.length > 0;
  }
  // 상태 바꾸기. date = 그 일이 있었던 날(사람이 고름). 보낸 날·받은 날·전달한 날을 요청에 적습니다.
  function coSetStatus(db, id, to, date, now, note) {
    var r = byId(db, id);
    if (!r || !STATUS.some(function (s) { return s.key === to; }) || r.status === to) return false;
    var from = r.status;
    r.status = to;
    date = str(date) || str(now).slice(0, 10);
    if (to === 'sent') r.sent_on = date;
    if (to === 'received') r.received_on = date;
    if (to === 'forwarded') { r.forwarded_on = date; if (!r.received_on) r.received_on = date; }
    ensure(db).history.push({ at: now, id: id, action: 'status', from: from, to: to, date: date, ref: refText(r), note: str(note) });
    return true;
  }
  function refText(r) {
    return [r.invoice_no ? 'Invoice ' + r.invoice_no : '', r.bl_no ? 'B/L ' + r.bl_no : '', r.po_no ? 'PO ' + r.po_no : ''].filter(Boolean).join(' · ');
  }
  // 기한 판정: 끝나지 않았는데 기한이 지났으면 「기한 지남」, 3일 안이면 「기한 임박」, 요청 후 2일 넘게 업체에 안 보냈으면 「미발송」
  // 소급문구: B/L DATE 에서 기준일까지 설정 일수(기본 7일) 이상이면 「소급문구 필요」(취소 건 빼고 끝난 건에도 — C/O 에 문구가 들어갔는지 확인용). st = db.settings
  function coFlags(r, today, st) {
    var out = [], t = dayNum(today), due = dayNum(r.due_date), req = dayNum(r.requested_on);
    if (r.status !== 'cancelled') { var rt = coRetro(r, today, st); if (rt.need) out.push({ code: 'retro', label: '소급문구 필요 ' + rt.days + '일', level: 'danger', detail: rt.detail }); }
    if (DONE[r.status]) return out;
    if (r.status !== 'received' && due != null && t != null) {
      if (due < t) out.push({ code: 'overdue', label: '기한 지남 ' + (t - due) + '일', level: 'danger' });
      else if (due - t <= 3) out.push({ code: 'soon', label: '기한 ' + (due - t === 0 ? '오늘' : (due - t) + '일 남음'), level: 'warn' });
    }
    if ((r.status === 'requested' || r.status === 'drafted') && req != null && t != null && t - req > 2) out.push({ code: 'unsent', label: '업체 미요청 ' + (t - req) + '일', level: 'warn' });
    if (r.status === 'received') out.push({ code: 'toforward', label: '통관팀 전달 전', level: 'warn' });
    if (!r.supplier_code) out.push({ code: 'nosup', label: '업체 미지정', level: 'muted' });
    return out;
  }

  // 번호 하나만 적어도 업체·PO·B/L 을 채워 줍니다. L = OMLogic, I = OMInvoice(없어도 됨)
  //   PO → 대장의 업체 · B/L → A/N(항차등록 대기 목록)의 PO → 업체 · Invoice → 올린 Invoice 의 PO·공급사, 또는 A/N 의 Invoice 번호
  function coSuggest(db, input, L, I) {
    var out = { supplier_code: '', po_no: '', bl_no: '', bl_date: '', invoice_no: '', via: [] };
    var pos = [], q = L && L.anQueue ? L.anQueue(db) : { rows: [] };
    function addPo(no, via) { no = str(no).toUpperCase(); if (no && pos.indexOf(no) < 0) { pos.push(no); if (via && out.via.indexOf(via) < 0) out.via.push(via); } }
    str(input.po_no).toUpperCase().split(/[\s,;]+/).forEach(function (x) { addPo(x); });
    var inv = keyOf(input.invoice_no), bl = keyOf(input.bl_no);
    if (inv) {
      (db.invoices || []).forEach(function (d) {
        if (keyOf(d.header && d.header.invoiceNo) !== inv) return;
        (I ? I.invoicePos(d) : [str(d.header.poNo)]).forEach(function (p) { addPo(p, 'Invoice 문서의 PO'); });
        if (!out.supplier_code && L && L.findSupplierInText) { var s = L.findSupplierInText(db.suppliers || [], d.header.supplier); if (s) { out.supplier_code = s.code; out.via.push('Invoice 의 공급사 이름'); } }
      });
      q.rows.forEach(function (r) { if ((r.invs || []).some(function (x) { return keyOf(x) === inv; })) { if (!bl) { out.bl_no = r.bl; out.via.push('A/N 의 Invoice 번호 → B/L'); } r.pos.forEach(function (p) { addPo(p, 'A/N 의 PO'); }); } });
    }
    if (bl) q.rows.forEach(function (r) { if (r.key === bl || keyOf(r.mbl) === bl) r.pos.forEach(function (p) { addPo(p, 'B/L 의 A/N PO'); }); });
    if (!bl && !out.bl_no && pos.length) {
      var hit = q.rows.filter(function (r) { return r.pos.some(function (p) { return pos.indexOf(p) >= 0; }); });
      if (hit.length === 1) { out.bl_no = hit[0].bl; out.via.push('PO 가 든 A/N 의 B/L'); }
    }
    pos.forEach(function (no) {
      var p = (db.pos || []).filter(function (x) { return str(x.po_no).toUpperCase() === no; })[0];
      if (p && !out.supplier_code && p.supplier_code) { out.supplier_code = p.supplier_code; out.via.push('대장 PO ' + no + ' 의 업체'); }
      if (p && !out.bl_no && !bl && p.bl_no) { out.bl_no = p.bl_no; out.via.push('대장 PO 의 B/L'); }
    });
    // B/L DATE(선적일, 소급문구 판정용): ① A/N 의 ETD(B/L 사본의 On Board 날짜를 읽은 값 포함) → ② 읽은 Invoice 에 적힌 B/L DATE
    //   → ③ 대장 PO 의 「선적 예정일(ETD)」(예정일일 수 있어 근거에 「확인」을 붙임)
    out.bl_date = '';
    var fb = bl || keyOf(out.bl_no);
    if (fb) { var ar = q.rows.filter(function (r) { return r.key === fb || keyOf(r.mbl) === fb; })[0]; if (ar && dayNum(ar.etd) != null) { out.bl_date = ar.etd; out.via.push('A/N 의 ETD(On Board) → B/L DATE'); } }
    if (!out.bl_date && inv) (db.invoices || []).forEach(function (d) { if (!out.bl_date && keyOf(d.header && d.header.invoiceNo) === inv && dayNum(d.header.blDate) != null) { out.bl_date = d.header.blDate; out.via.push('Invoice 에 적힌 B/L DATE'); } });
    if (!out.bl_date) pos.some(function (no) {
      var p = (db.pos || []).filter(function (x) { return str(x.po_no).toUpperCase() === no; })[0];
      if (p && dayNum(p.etd) != null) { out.bl_date = p.etd; out.via.push('대장 PO ' + no + ' 의 선적 예정일(ETD) — 실제 B/L DATE 와 같은지 확인'); return true; }
      return false;
    });
    out.po_no = pos.join(', ');
    return out;
  }

  /* ── B/L DATE 소급문구 (2026-09-30 요청 「B/L DATE 선적일 기준 7일 이상 지난 건에 대해 소급문구 적용 필요」) ──
     data09-12(외부망)와 data09-28(폐쇄망)의 js/co.js 에 같은 코드로 둡니다(한쪽을 고치면 다른 쪽도).
     경과일 = 기준일 − B/L DATE(선적일). 기준일은 이 순서로 고릅니다(화면·엑셀에 어느 날짜를 썼는지 함께 적음):
       ① 요청에 적은 「C/O 발급(예정)일」 → ② C/O 를 이미 받은 건이면 「C/O 수령일」 → ③ 설정의 기준(「오늘」 기본 · 「요청 받은 날」)
     경과일이 기준 일수(설정, 기본 7) 이상이면 「소급문구 필요」 — 6일은 아님, 7일부터 필요.
     실제 문구는 협정(FTA)마다 다를 수 있어 단정하지 않고 설정으로 둡니다(기본 「ISSUED RETROSPECTIVELY」 — 통관팀 확인 필요).
     업체 메일에는 소급 발급을 부탁하는 문장(설정에서 고칠 수 있음)을 자동으로 넣습니다. */
  var RETRO_DEFAULT = {
    days: 7, basis: 'today', phrase: 'ISSUED RETROSPECTIVELY',
    line: 'Please note that the B/L date of {RETRO_REFS} is {RETRO_BL_DATES}, which is {RETRO_DAYS} or more days before the issue date of the certificate. Could you please issue the certificate retrospectively and mark it "{RETRO_PHRASE}"?'
  };
  var RETRO_BASIS = [{ key: 'today', label: '오늘' }, { key: 'requested', label: '요청 받은 날' }];
  var RETRO_BASIS_LABEL = { issue: 'C/O 발급(예정)일', received: 'C/O 수령일', requested: '요청 받은 날', today: '오늘' };
  var RETRO_NEED_LABEL = '소급문구 필요 (Issued Retrospectively)';
  function retroSettings(st) {
    st = st || {};
    var d = parseInt(str(st.co_retro_days), 10);
    return {
      days: isFinite(d) && d >= 1 ? d : RETRO_DEFAULT.days,
      basis: str(st.co_retro_basis) === 'requested' ? 'requested' : 'today',
      phrase: str(st.co_retro_phrase) || RETRO_DEFAULT.phrase,
      line: str(st.co_retro_line) || RETRO_DEFAULT.line
    };
  }
  function localToday() { var d = new Date(); function p(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  // 한 요청의 판정 → { blDate, refDate, basis, basisLabel, threshold, days, known, need, label, detail }
  function coRetro(r, today, st) {
    var s = retroSettings(st), basis, ref;
    if (dayNum(r.issue_date) != null) { basis = 'issue'; ref = r.issue_date; }
    else if ((r.status === 'received' || r.status === 'forwarded') && dayNum(r.received_on) != null) { basis = 'received'; ref = r.received_on; }
    else if (s.basis === 'requested' && dayNum(r.requested_on) != null) { basis = 'requested'; ref = r.requested_on; }
    else { basis = 'today'; ref = str(today); }
    var out = { blDate: str(r.bl_date), refDate: ref, basis: basis, basisLabel: RETRO_BASIS_LABEL[basis], threshold: s.days, days: null, known: false, need: false, label: '', detail: '' };
    var b = dayNum(r.bl_date), t = dayNum(ref);
    if (b == null || t == null) { out.label = str(r.bl_date) ? 'B/L DATE 형식 확인(YYYY-MM-DD)' : 'B/L DATE 없음'; return out; }
    out.known = true; out.days = t - b; out.need = out.days >= s.days;
    out.label = out.need ? RETRO_NEED_LABEL : out.days < 0 ? 'B/L DATE 가 기준일보다 뒤' : '소급 불필요';
    out.detail = 'B/L DATE ' + out.blDate + ' → 기준일 ' + ref + '(' + out.basisLabel + ') ' + out.days + '일 경과 · 기준 ' + s.days + '일 이상이면 소급문구';
    return out;
  }
  function shortRef(r) { return r.invoice_no ? 'Invoice ' + r.invoice_no : r.bl_no ? 'B/L ' + r.bl_no : 'PO ' + r.po_no; }
  // 업체 메일에 넣을 소급 발급 요청 문장(해당 건이 없으면 빈 글)
  function retroLine(reqs, today, st) {
    var s = retroSettings(st), hit = (reqs || []).filter(function (r) { return r && r.status !== 'cancelled' && coRetro(r, today, st).need; });
    if (!hit.length) return { text: '', reqs: [] };
    var v = { RETRO_REFS: hit.map(shortRef).join(', '), RETRO_BL_DATES: hit.map(function (r) { return enDate(r.bl_date); }).join(' / '), RETRO_DAYS: s.days, RETRO_PHRASE: s.phrase };
    return { text: fill(s.line, v), reqs: hit };
  }
  // 문안에 {RETRO} 빈칸이 없으면(예전에 저장한 문안) 대상 목록 바로 뒤에 넣습니다
  function withRetroSlot(body) {
    body = str(body);
    if (body.indexOf('{RETRO}') >= 0) return body;
    return body.indexOf('{CO_LIST}') >= 0 ? body.replace('{CO_LIST}', '{CO_LIST}\n\n{RETRO}') : body + '\n\n{RETRO}';
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function enDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(iso)); return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : ''; }
  function fill(tpl, v) { return str(tpl).replace(/\{([A-Z_]+)\}/g, function (a, k) { return v[k] != null ? String(v[k]) : a; }).replace(/\n{3,}/g, '\n\n'); }

  // 업체 한 곳에 보낼 초안(같은 업체의 요청 여러 건을 한 통으로 묶을 수 있음)
  // opts: { includeKo: 국문 요약을 메일 끝에 넣을지(기본 넣지 않음 — 화면에만 보여 드림) }
  function coDraft(reqs, supplier, db, opts) {
    opts = opts || {};
    var st = db.settings || {}, t = (db.templates && db.templates.co_request) || { subject: '[Request] Certificate of Origin - {REF}', body: '{CO_LIST}' };
    reqs = (reqs || []).filter(Boolean);
    var types = [], dues = [];
    reqs.forEach(function (r) { var e = typeEn(r.co_type); if (types.indexOf(e) < 0) types.push(e); if (r.due_date) dues.push(r.due_date); });
    dues.sort();
    var list = reqs.map(function (r) {
      return '- ' + [r.invoice_no ? 'Invoice No: ' + r.invoice_no : '', r.bl_no ? 'B/L No: ' + r.bl_no : '', dayNum(r.bl_date) != null ? 'B/L Date: ' + enDate(r.bl_date) : '', r.po_no ? 'PO No: ' + r.po_no : '', reqs.length > 1 || types.length > 1 ? 'Type: ' + typeEn(r.co_type) : ''].filter(Boolean).join(' / ');
    }).join('\n');
    var first = reqs[0] || {};
    var ref = first.invoice_no ? 'Invoice ' + first.invoice_no : first.bl_no ? 'B/L ' + first.bl_no : 'PO ' + first.po_no;
    if (reqs.length > 1) ref += ' and ' + (reqs.length - 1) + ' more';
    var v = {
      REF: ref, CO_TYPE: types.join(' / ') || 'Certificate of Origin', CO_LIST: list, DUE: dues.length ? enDate(dues[0]) : 'your earliest convenience',
      SUPPLIER: supplier ? supplier.name : '', CONTACT: (supplier && supplier.contact) || 'Sir or Madam', CODE: supplier ? supplier.code : '',
      SENDER: st.sender_name || '', DEPT: st.sender_dept || '', COMPANY: st.sender_company || ''
    };
    // 소급문구: B/L DATE 에서 기준일까지 설정 일수 이상인 건이 있으면 소급 발급 요청 문장({RETRO})을 넣습니다. opts.today = 기준 「오늘」(없으면 이 PC 날짜)
    var today = opts.today || localToday(), rl = retroLine(reqs, today, st);
    v.RETRO = rl.text;
    var body = fill(rl.text ? withRetroSlot(t.body) : t.body, v).replace(/by your earliest convenience/, 'at your earliest convenience');
    var noteKo = '[국문 요약] ' + (supplier ? supplier.name : '업체') + '에 원산지증명서(' + reqs.map(function (r) { return r.co_type || 'C/O'; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ') + ')를 요청합니다. ' +
      '대상: ' + reqs.map(refText).join(' / ') + '. ' + (dues.length ? '기한 ' + dues[0] + '까지 보내 달라고 적었습니다. ' : '기한은 적지 않았습니다. ') +
      'C/O 의 Invoice 번호·품명·수량이 Commercial Invoice 와 같은지 확인해 달라는 문장이 들어 있습니다.';
    if (rl.reqs.length) noteKo += ' 소급문구 필요(B/L DATE 에서 ' + retroSettings(st).days + '일 이상): ' + rl.reqs.map(function (r) { var x = coRetro(r, today, st); return shortRef(r) + ' — ' + x.detail.replace(/ · 기준.*$/, ''); }).join(' / ') +
      '. 소급 발급과 「' + retroSettings(st).phrase + '」 표기를 부탁하는 문장을 넣었습니다(문구는 설정에서 바꿀 수 있음).';
    if (opts.includeKo) body += '\n\n----\n' + noteKo;
    var draft = {
      from: st.sender_email || '', to: supplier ? supplier.to : '', cc: supplier ? supplier.cc : '',
      subject: fill(t.subject, v), body: body, noteKo: noteKo, retro: rl.reqs.map(function (r) { return r.id; }), attachments: [],
      fileName: ('CO요청_' + (supplier ? supplier.name : '업체미정') + '_' + reqs.map(function (r) { return r.invoice_no || r.bl_no || r.po_no; }).join('_')).replace(/[\\\/:*?"<>|\r\n]+/g, '_').slice(0, 120) + '.eml'
    };
    draft.mailto = mailtoUrl(draft);
    return draft;
  }
  // mailto: 주소 — 받는 사람은 쉼표로, 제목·본문은 인코딩. 너무 길면(약 1,800자) 메일 프로그램이 자를 수 있어 long 표시
  function mailtoUrl(d) {
    var to = str(d.to).split(/[;,\s]+/).filter(Boolean).join(',');
    var q = [];
    var cc = str(d.cc).split(/[;,\s]+/).filter(Boolean).join(',');
    if (cc) q.push('cc=' + encodeURIComponent(cc));
    q.push('subject=' + encodeURIComponent(d.subject || ''));
    q.push('body=' + encodeURIComponent(String(d.body || '').replace(/\r?\n/g, '\r\n')));
    var url = 'mailto:' + to.split(',').map(encodeURIComponent).join(',').replace(/%40/g, '@') + '?' + q.join('&');
    return url;
  }
  function isLongMailto(url) { return String(url || '').length > 1800; }

  /* 엑셀 표 */
  function coRows(db, today, supplierName) {
    return ensure(db).reqs.map(function (r) {
      var rt = coRetro(r, today, db.settings);
      return {
        '요청일': r.requested_on, '통관팀 담당': r.requester, 'Invoice 번호': r.invoice_no, 'B/L 번호': r.bl_no, 'PO 번호': r.po_no,
        'B/L DATE(선적일)': r.bl_date || '', 'C/O 발급(예정)일': r.issue_date || '', '소급 기준일': rt.refDate, '기준일 구분': rt.basisLabel, '경과일': rt.known ? rt.days : '',
        '소급문구': rt.need ? '필요' : rt.known ? '불필요' : rt.label,
        '업체 코드': r.supplier_code, '업체명': supplierName ? supplierName(r.supplier_code) : '', 'C/O 종류': r.co_type, '기한': r.due_date,
        '상태': statusLabel(r.status), '업체 요청일': r.sent_on, 'C/O 수령일': r.received_on, '통관팀 전달일': r.forwarded_on,
        '확인': coFlags(r, today, db.settings).map(function (f) { return f.label; }).join(', '), '메모': r.note
      };
    });
  }
  function coHistoryRows(db) {
    return ensure(db).history.slice().sort(function (a, b) { return str(b.at).localeCompare(str(a.at)); }).map(function (e) {
      return { '시각': e.at, '요청': e.ref, '구분': e.action === 'create' ? '요청 등록' : e.action === 'edit' ? '내용 고침' : '상태 변경', '이전 상태': e.from ? statusLabel(e.from) : '', '바뀐 상태': statusLabel(e.to), '날짜': e.date, '메모': e.note || '' };
    });
  }
  function coCounts(db, today) {
    var c = { total: 0, open: 0, overdue: 0, waiting: 0, toForward: 0, retro: 0 };
    ensure(db).reqs.forEach(function (r) {
      c.total++;
      if (r.status !== 'cancelled' && coRetro(r, today, db.settings).need) c.retro++;
      if (DONE[r.status]) return;
      c.open++;
      if (coFlags(r, today, db.settings).some(function (f) { return f.code === 'overdue'; })) c.overdue++;
      if (r.status === 'sent') c.waiting++;
      if (r.status === 'received') c.toForward++;
    });
    return c;
  }

  return {
    STATUS: STATUS, TYPES: TYPES, statusLabel: statusLabel, typeEn: typeEn, emptyCo: emptyCo, coAdd: coAdd, coUpdate: coUpdate, coSetStatus: coSetStatus,
    coFlags: coFlags, coSuggest: coSuggest, coDraft: coDraft, mailtoUrl: mailtoUrl, isLongMailto: isLongMailto, enDate: enDate, refText: refText,
    coRows: coRows, coHistoryRows: coHistoryRows, coCounts: coCounts, byId: byId,
    coRetro: coRetro, retroSettings: retroSettings, retroLine: retroLine, RETRO_DEFAULT: RETRO_DEFAULT, RETRO_BASIS: RETRO_BASIS, RETRO_NEED_LABEL: RETRO_NEED_LABEL
  };
});
