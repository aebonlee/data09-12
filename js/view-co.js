/* 화면: 원산지증명서(C/O) 요청 관리 (2026-09-30 요청 「통관팀이 요청한 원산지증명서 요청 메일 관리 탭 > 업체에 메일 초안 작성 후 전달」) */
(function (root) {
  'use strict';
  var L = root.OMLogic, C = root.OMCo, I = root.OMInvoice, App = root.OM, h = App.h;

  function nowIso() { return new Date().toISOString(); }
  function co() { App.db.co = App.db.co || C.emptyCo(); return App.db.co; }
  var FILTERS = [['open', '진행 중'], ['overdue', '기한 지남'], ['sent', '업체 회신 대기'], ['received', '통관팀 전달 전'], ['done', '끝남'], ['all', '전체']];
  function match(r, f, today) {
    if (f === 'all') return true;
    var done = r.status === 'forwarded' || r.status === 'cancelled';
    if (f === 'done') return done;
    if (f === 'open') return !done;
    if (f === 'overdue') return C.coFlags(r, today).some(function (x) { return x.code === 'overdue'; });
    return r.status === f;
  }

  App.views.co = function (main) {
    var db = App.db, today = App.today(), c = co(), cnt = C.coCounts(db, today);
    var flt = App.state.coFilter || 'open';
    main.appendChild(App.pageHead('원산지증명서 요청 관리', h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: function () {
        App.writeXlsx((db._sample ? '예시데이터_' : '') + '원산지증명서_요청_' + today + '.xlsx', { '요청': C.coRows(db, today, App.supplierName), '이력': C.coHistoryRows(db) });
      } }, '엑셀 내보내기'))));
    main.appendChild(h('p', null, '통관팀이 요청한 원산지증명서(C/O)를 한 건씩 적고, 업체에 보낼 영문 요청 메일 초안을 만들어 메일 프로그램으로 엽니다. 업체에 보냄 → C/O 수령 → 통관팀 전달까지 상태와 날짜를 남기고, 바꾼 기록은 이력으로 쌓입니다(고치거나 지우지 않음). 메일은 직접 보내지 않고 초안만 만듭니다.'));
    main.appendChild(h('div', { class: 'tiles' },
      tile('진행 중', cnt.open + '건'), tile('기한 지남', cnt.overdue + '건', cnt.overdue > 0), tile('업체 회신 대기', cnt.waiting + '건'), tile('통관팀 전달 전', cnt.toForward + '건', cnt.toForward > 0)));

    formCard(main);
    var counts = {};
    FILTERS.forEach(function (f) { counts[f[0]] = c.reqs.filter(function (r) { return match(r, f[0], today); }).length; });
    main.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': '상태 거르기' }, FILTERS.map(function (f) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(flt === f[0]), onclick: function () { App.state.coFilter = f[0]; App.render(); } }, f[1] + ' ' + counts[f[0]]);
    })));
    var rows = c.reqs.filter(function (r) { return match(r, flt, today); }).sort(function (a, b) { return String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(a.requested_on).localeCompare(String(b.requested_on)); });
    main.appendChild(App.table([
      { label: '요청일 · 통관팀', cls: 'nowrap', cell: function (r) { return h('span', null, r.requested_on, r.requester ? h('br') : null, r.requester ? h('small', { class: 'muted' }, r.requester) : null); } },
      { label: '대상', cell: function (r) { return h('span', null, r.invoice_no ? h('span', null, 'Invoice ', h('strong', null, r.invoice_no), h('br')) : null, r.bl_no ? h('span', null, 'B/L ' + r.bl_no, h('br')) : null, r.po_no ? h('small', { class: 'muted' }, 'PO ' + r.po_no) : null); } },
      { label: '업체', cls: 'clip', cell: function (r) { return r.supplier_code ? App.supplierName(r.supplier_code) : h('span', { class: 'badge warn' }, '업체 미지정'); } },
      { label: 'C/O 종류', cls: 'clip', cell: function (r) { return r.co_type || '-'; } },
      { label: '기한', cls: 'nowrap', cell: function (r) { return r.due_date || '-'; } },
      { label: '상태', cell: function (r) {
        var lvl = { requested: 'warn', drafted: 'warn', sent: 'muted', received: 'ok', forwarded: 'ok', cancelled: 'muted' }[r.status];
        return h('span', null, h('span', { class: 'badge ' + lvl }, C.statusLabel(r.status)),
          r.sent_on ? h('small', { class: 'muted' }, h('br'), '요청 ' + r.sent_on) : null, r.received_on ? h('small', { class: 'muted' }, h('br'), '수령 ' + r.received_on) : null,
          r.forwarded_on ? h('small', { class: 'muted' }, h('br'), '전달 ' + r.forwarded_on) : null,
          C.coFlags(r, today).filter(function (f) { return f.code !== 'nosup'; }).map(function (f) { return h('span', { class: 'badge ' + f.level }, f.label); }));
      } },
      { label: '', cell: function (r) {
        return h('div', { class: 'btn-row' },
          r.status !== 'forwarded' && r.status !== 'cancelled' ? h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { App.state.coDraftIds = [r.id]; App.render(); setTimeout(function () { var el = document.getElementById('coDraft'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 30); } }, '메일 초안') : null,
          h('button', { type: 'button', class: 'btn', onclick: function () { statusDialog(r); } }, '상태'),
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { editDialog(r); } }, '고치기·이력'));
      } }
    ], rows, function (r) { return { class: C.coFlags(r, today).some(function (f) { return f.code === 'overdue'; }) ? 'row-bad' : null }; }));

    draftCard(main);
    main.appendChild(h('details', { class: 'card' }, h('summary', null, h('strong', null, '이력 ' + c.history.length + '건')),
      h('p', { class: 'note' }, '요청 등록 · 내용 고침 · 상태 변경을 누른 시각과 함께 남깁니다. 이력은 고치거나 지울 수 없습니다.'),
      App.table([
        { label: '시각', cls: 'nowrap', cell: function (e) { return String(e['시각']).replace('T', ' ').slice(0, 16); } },
        { label: '요청', cell: function (e) { return e['요청']; } }, { label: '구분', cell: function (e) { return e['구분']; } },
        { label: '상태', cell: function (e) { return (e['이전 상태'] ? e['이전 상태'] + ' → ' : '') + e['바뀐 상태']; } },
        { label: '날짜', cls: 'nowrap', cell: function (e) { return e['날짜']; } }, { label: '메모', cls: 'clip', cell: function (e) { return e['메모']; } }
      ], C.coHistoryRows(db).slice(0, 300))));
    function tile(k, v, danger) { return h('div', { class: 'tile' + (danger ? ' danger' : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }
  };

  function typeList() { return h('datalist', { id: 'coTypes' }, C.TYPES.map(function (t) { return h('option', { value: t.ko }); })); }
  function formCard(main) {
    var db = App.db, pre = App.state.coPrefill || {};
    var f = {
      requested_on: h('input', { type: 'date', value: App.today() }), requester: h('input', { type: 'text', placeholder: '통관팀 담당자(선택)' }),
      invoice_no: h('input', { type: 'text', value: pre.invoice_no || '' }), bl_no: h('input', { type: 'text', value: pre.bl_no || '' }), po_no: h('input', { type: 'text', value: pre.po_no || '', placeholder: '여럿이면 쉼표로' }),
      supplier_code: App.supplierSelect(pre.supplier_code || '', {}), co_type: h('input', { type: 'text', list: 'coTypes', value: C.TYPES[0].ko }),
      due_date: h('input', { type: 'date' }), note: h('input', { type: 'text', placeholder: '통관팀 요청 내용·협정 이름 등' })
    };
    var via = h('p', { class: 'note' });
    function fillFromNumbers() {
      var s = C.coSuggest(db, { invoice_no: f.invoice_no.value, bl_no: f.bl_no.value, po_no: f.po_no.value }, L, I);
      if (s.po_no && !f.po_no.value.trim()) f.po_no.value = s.po_no;
      if (s.bl_no && !f.bl_no.value.trim()) f.bl_no.value = s.bl_no;
      if (s.supplier_code && !f.supplier_code.value) f.supplier_code.value = s.supplier_code;
      via.textContent = s.via.length ? '채운 근거: ' + s.via.join(' · ') : '대장·A/N·읽은 Invoice 에서 찾지 못했습니다. 직접 골라 주십시오.';
    }
    if (pre.invoice_no || pre.po_no || pre.bl_no) { setTimeout(fillFromNumbers, 0); App.state.coPrefill = null; }
    main.appendChild(h('details', { class: 'card', open: true }, h('summary', null, h('strong', null, '통관팀 요청 적기')),
      h('div', { class: 'form-grid cols-4' },
        App.field('요청 받은 날', f.requested_on), App.field('통관팀 담당', f.requester),
        App.field('Invoice 번호', f.invoice_no), App.field('B/L 번호', f.bl_no), App.field('PO 번호', f.po_no),
        App.field('업체', f.supplier_code), App.field('필요한 C/O 종류', f.co_type, '통관팀이 요청한 서식 이름을 그대로 적어 주세요'), App.field('기한', f.due_date),
        h('div', { class: 'span-all' }, App.field('메모', f.note))), typeList(), via,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: fillFromNumbers }, '번호로 업체·PO·B/L 채우기'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var input = {}; Object.keys(f).forEach(function (k) { input[k] = f[k].value; });
          try { var r = C.coAdd(db, input, nowIso()); App.save(); App.state.coDraftIds = [r.id]; App.state.coFilter = 'open'; App.render(); App.toast('요청을 등록했습니다. 아래에서 메일 초안을 확인해 주십시오.'); }
          catch (e) { App.toast(e.message, true); }
        } }, '요청 등록'),
        db._sample || !co().reqs.length ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: sample } , '예시 요청 넣기') : null),
      h('p', { class: 'note' }, 'Invoice·B/L·PO 중 하나만 적고 「번호로 채우기」를 누르면 관리 대장(PO → 업체), 도착 통지(B/L·Invoice 번호 → PO), 읽은 Invoice(→ PO·공급사)에서 나머지를 채웁니다.')));
  }
  function sample() {
    var db = App.db, now = nowIso(), t = App.today();
    function d(n) { var x = new Date(t + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
    [{ invoice_no: '9000001', co_type: C.TYPES[1].ko, requester: '통관팀 담당자A(예시)', due_date: d(5), note: '예시 — 항공 건' },
     { invoice_no: 'EXCI-2609-017', co_type: C.TYPES[0].ko, requester: '통관팀 담당자A(예시)', due_date: d(-1), note: '예시 — 기한 지난 건' }].forEach(function (x) {
      var s = C.coSuggest(db, x, L, I);
      C.coAdd(db, Object.assign({ requested_on: d(-3), po_no: s.po_no, bl_no: s.bl_no, supplier_code: s.supplier_code }, x), now);
    });
    db._sample = true; App.save(); App.render(); App.toast('예시 요청 2건을 넣었습니다(Invoice 화면의 예시와 짝).');
  }

  // 메일 초안 — 같은 업체의 진행 중 요청을 함께 묶을 수 있음
  function draftCard(main) {
    var db = App.db, ids = App.state.coDraftIds || [];
    var reqs = ids.map(function (id) { return C.byId(db, id); }).filter(Boolean);
    if (!reqs.length) return;
    var sup = L.supplierByCode(db.suppliers, reqs[0].supplier_code);
    var same = co().reqs.filter(function (r) { return r.supplier_code && r.supplier_code === reqs[0].supplier_code && ids.indexOf(r.id) < 0 && (r.status === 'requested' || r.status === 'drafted'); });
    var ko = App.state.coKo === true;
    var d = C.coDraft(reqs, sup, db, { includeKo: ko });
    var to = h('input', { type: 'text', value: d.to }), cc = h('input', { type: 'text', value: d.cc }), subj = h('input', { type: 'text', value: d.subject });
    var body = h('textarea', { rows: 14 }); body.value = d.body;
    function cur() { var x = Object.assign({}, d, { to: to.value, cc: cc.value, subject: subj.value, body: body.value }); x.mailto = C.mailtoUrl(x); return x; }
    var card = h('div', { class: 'card', id: 'coDraft' }, h('h2', null, '업체 요청 메일 초안 — ' + (sup ? sup.name : '업체 미지정')),
      !sup ? h('div', { class: 'alert warn' }, '업체가 정해지지 않아 받는 사람이 비어 있습니다. 「고치기」에서 업체를 골라 주십시오.') : sup && !sup.to ? h('div', { class: 'alert warn' }, '이 업체의 이메일이 업체 마스터에 없습니다.') : null,
      same.length ? h('div', { class: 'alert info' }, '같은 업체에 아직 보내지 않은 요청이 ' + same.length + '건 더 있습니다. ',
        h('button', { type: 'button', class: 'btn', onclick: function () { App.state.coDraftIds = ids.concat(same.map(function (r) { return r.id; })); App.render(); } }, '한 통으로 묶기')) : null,
      h('div', { class: 'form-grid' }, App.field('받는 사람(To)', to), App.field('참조(CC)', cc), h('div', { class: 'span-all' }, App.field('제목', subj)), h('div', { class: 'span-all' }, App.field('본문(영문)', body))),
      h('div', { class: 'alert info', style: 'white-space:pre-line' }, d.noteKo),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ko, onchange: function (e) { App.state.coKo = e.target.checked; App.render(); } }), ' 국문 요약을 메일 끝에도 넣기(기본은 화면에만 — 해외 업체에 보내는 메일이므로)'),
      h('div', { class: 'btn-row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var x = cur();
          if (C.isLongMailto(x.mailto)) App.toast('본문이 길어 메일 프로그램이 일부를 자를 수 있습니다. 「본문 복사」나 .eml 저장을 함께 써 주십시오.', true);
          mark('drafted'); location.href = x.mailto;
        } }, '메일 프로그램으로 열기'),
        h('button', { type: 'button', class: 'btn', onclick: function () { var x = cur(); App.copy('To: ' + x.to + (x.cc ? '\nCc: ' + x.cc : '') + '\nSubject: ' + x.subject + '\n\n' + x.body); mark('drafted'); } }, '전체 복사'),
        h('button', { type: 'button', class: 'btn', onclick: function () { App.copy(body.value); mark('drafted'); } }, '본문 복사'),
        h('button', { type: 'button', class: 'btn', onclick: function () { App.saveEml(cur()); mark('drafted'); } }, '.eml 저장(Outlook)'),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          reqs.forEach(function (r) { C.coSetStatus(db, r.id, 'sent', App.today(), nowIso(), '메일 제목: ' + subj.value); });
          App.save(); App.state.coDraftIds = []; App.render(); App.toast(reqs.length + '건을 「업체에 요청」(' + App.today() + ')으로 표시했습니다.');
        } }, '보냈음으로 표시'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { App.state.coDraftIds = []; App.render(); } }, '닫기')),
      h('p', { class: 'note' }, '문안은 「설정 → 메일 템플릿 → 원산지증명서(C/O) 요청」에서 바꿀 수 있습니다. 빈칸: {REF} {CO_TYPE} {CO_LIST} {DUE} {CONTACT} {SUPPLIER} {SENDER} {DEPT} {COMPANY}. 메일 프로그램으로 열어도 보내기는 직접 하셔야 하고, 보낸 뒤 「보냈음으로 표시」를 눌러 주십시오.'));
    main.appendChild(card);
    function mark(st) { var n = 0; reqs.forEach(function (r) { if (r.status === 'requested' && C.coSetStatus(db, r.id, st, App.today(), nowIso(), '초안 만듦')) n++; }); if (n) App.save(); }
  }

  function statusDialog(r) {
    var sel = h('select', null, C.STATUS.map(function (s) { return h('option', { value: s.key }, s.label + ' — ' + s.note); }));
    sel.value = r.status;
    var date = h('input', { type: 'date', value: App.today() }), note = h('input', { type: 'text', placeholder: '메모(선택)' });
    App.dialog('상태 바꾸기 — ' + C.refText(r), h('div', { class: 'form-grid' }, App.field('새 상태', sel), App.field('그 일이 있었던 날', date), h('div', { class: 'span-all' }, App.field('메모', note))),
      [{ label: '취소' }, { label: '바꾸기', primary: true, onClick: function () {
        if (sel.value === r.status) { App.toast('지금과 같은 상태입니다.', true); return false; }
        C.coSetStatus(App.db, r.id, sel.value, date.value, nowIso(), note.value); App.save(); App.render();
      } }]);
  }
  function editDialog(r) {
    var f = {};
    [['requested_on', '요청 받은 날', 'date'], ['requester', '통관팀 담당'], ['invoice_no', 'Invoice 번호'], ['bl_no', 'B/L 번호'], ['po_no', 'PO 번호'], ['co_type', 'C/O 종류'], ['due_date', '기한', 'date'], ['note', '메모']].forEach(function (x) {
      f[x[0]] = h('input', { type: x[2] || 'text', value: r[x[0]] || '', list: x[0] === 'co_type' ? 'coTypes' : null });
    });
    f.supplier_code = App.supplierSelect(r.supplier_code, {});
    var hist = C.coHistoryRows({ co: { reqs: [], history: co().history.filter(function (e) { return e.id === r.id; }) } });
    App.dialog('요청 고치기 · 이력', h('div', null,
      h('div', { class: 'form-grid' }, App.field('요청 받은 날', f.requested_on), App.field('통관팀 담당', f.requester), App.field('Invoice 번호', f.invoice_no), App.field('B/L 번호', f.bl_no),
        App.field('PO 번호', f.po_no), App.field('업체', f.supplier_code), App.field('C/O 종류', f.co_type), App.field('기한', f.due_date), h('div', { class: 'span-all' }, App.field('메모', f.note))), typeList(),
      h('h3', null, '이 요청의 이력'),
      App.table([{ label: '시각', cls: 'nowrap', cell: function (e) { return String(e['시각']).replace('T', ' ').slice(0, 16); } }, { label: '구분', cell: function (e) { return e['구분']; } },
        { label: '상태', cell: function (e) { return (e['이전 상태'] ? e['이전 상태'] + ' → ' : '') + e['바뀐 상태']; } }, { label: '날짜', cell: function (e) { return e['날짜']; } }, { label: '메모', cls: 'clip', cell: function (e) { return e['메모']; } }], hist)),
      [{ label: '닫기' }, { label: '저장', primary: true, onClick: function () {
        var p = {}; Object.keys(f).forEach(function (k) { p[k] = f[k].value; });
        if (C.coUpdate(App.db, r.id, p, nowIso())) { App.save(); App.render(); App.toast('고쳤습니다(이력에 남음).'); }
      } }]);
  }
})(window);
