/* 화면: PO 발주 메일 · 관리 대장 · OC 팔로우업 · 접수율·준수율 */
(function (root) {
  'use strict';
  var L = root.OMLogic, S = root.OMSample, App = root.OM, h = App.h;

  /* ── PDF 본문 읽기(pdf.js, 브라우저 안에서만) ─────────────────────────────── */
  function pdfText(bytes) {
    if (!root.pdfjsLib) return Promise.reject(new Error('PDF 라이브러리를 불러오지 못했습니다'));
    var task = root.pdfjsLib.getDocument({ data: bytes.slice(0), cMapUrl: 'vendor/cmaps/', cMapPacked: true, isEvalSupported: false });
    return task.promise.then(function (doc) {
      var n = Math.min(doc.numPages, 5), jobs = [];
      for (var i = 1; i <= n; i++) jobs.push(doc.getPage(i).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
        var out = '', lastY = null;
        tc.items.forEach(function (it) {
          var y = it.transform ? Math.round(it.transform[5]) : null;
          if (lastY != null && y !== lastY) out += '\n'; else if (out) out += ' ';
          out += it.str; lastY = y;
        });
        return out;
      }));
      return Promise.all(jobs).then(function (p) { doc.destroy(); return p.join('\n'); });
    });
  }

  function poIssues(row) {
    var db = App.db, out = [];
    if (!row.po_no) out.push('PO 번호 없음');
    var s = L.supplierByCode(db.suppliers, row.supplier_code);
    if (!s) out.push('업체 미지정');
    else if (!s.to) out.push('수신 이메일 없음');
    var ex = db.pos.filter(function (p) { return p.po_no === row.po_no; })[0];
    if (ex && ex.sent_date) out.push('이미 송부 기록 있음(' + ex.sent_date + ')');
    if (row.nameTextMismatch) out.push(row.nameTextMismatch);
    if (row.textError) out.push(row.textError);
    return out;
  }

  /* ── PO 발주 메일 ─────────────────────────────── */
  App.views.po = function (main) {
    var db = App.db;
    var rows = App.state.poRows = App.state.poRows || [];
    main.appendChild(App.pageHead('PO 발주 메일 초안'));
    main.appendChild(h('p', null, 'PO PDF를 여러 개 올리면 파일명과 본문에서 PO 번호와 업체를 찾아, 업체별 수신·참조·제목·본문과 PO 첨부가 채워진 메일 초안(.eml)을 만듭니다. 초안을 더블클릭하면 Outlook에서 열리며, 확인한 뒤 직접 보내십시오.'));
    var fileIn = h('input', { type: 'file', accept: '.pdf,application/pdf', multiple: true, style: 'display:none' });
    fileIn.addEventListener('change', function () { addFiles(Array.prototype.slice.call(fileIn.files)); fileIn.value = ''; });
    main.appendChild(h('div', { class: 'card' },
      h('div', { class: 'btn-row' },
        h('label', { class: 'btn btn-primary' }, 'PO PDF 선택(여러 개)', fileIn),
        h('button', { type: 'button', class: 'btn', onclick: sampleFiles }, '예시 PO PDF로 해 보기'),
        rows.length ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { App.state.poRows = []; App.render(); } }, '목록 비우기') : null),
      !db.suppliers.length ? h('div', { class: 'alert warn' }, '업체 마스터가 비어 있어 업체를 찾을 수 없습니다. 먼저 「업체」에서 Contact List를 올려 주십시오.') : null,
      h('p', { class: 'note' }, 'PO 번호 찾기 규칙은 「설정」에서 바꿀 수 있습니다. 스캔본 PDF는 본문 글자를 읽을 수 없어 파일명으로만 찾습니다.')));

    if (!rows.length) return;
    main.appendChild(App.table([
      { label: '파일', cell: function (r) { return h('span', null, r.file, r.textLen === 0 ? h('small', { class: 'muted' }, ' (본문 글자 없음)') : null); } },
      { label: 'PO 번호', cell: function (r) { return h('input', { class: 'cell', value: r.po_no, 'aria-label': 'PO 번호', onchange: function (e) { r.po_no = e.target.value.trim(); App.render(); } }); } },
      { label: '업체', cell: function (r) { return App.supplierSelect(r.supplier_code, { 'aria-label': '업체', onchange: function (e) { r.supplier_code = e.target.value; App.render(); } }); } },
      { label: '수신(To)', cell: function (r) { var s = L.supplierByCode(db.suppliers, r.supplier_code); return s ? s.to : ''; } },
      { label: '확인 사항', cell: function (r) { var is = poIssues(r); return is.length ? is.map(function (x) { return h('span', { class: 'badge warn' }, x); }) : h('span', { class: 'badge ok' }, '준비됨'); } },
      { label: '', cell: function (r) { return h('button', { type: 'button', class: 'btn', disabled: !r.po_no || !r.supplier_code, onclick: function () { App.saveEml(draftOf(r)); } }, '초안'); } }
    ], rows, function (r) { return { class: poIssues(r).length ? 'row-bad' : 'row-ok' }; }));

    var ready = rows.filter(function (r) { return r.po_no && r.supplier_code; });
    main.appendChild(h('div', { class: 'card', style: 'margin-top:16px' },
      h('p', null, '초안을 만들 수 있는 PO ' + ready.length + '건 / 전체 ' + rows.length + '건'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: !ready.length, onclick: function () {
          App.saveEmlZip(ready.map(draftOf), (db._sample ? '예시데이터_' : '') + '발주메일초안_' + App.today() + '.zip');
        } }, '메일 초안 모두 내려받기(ZIP)'),
        h('button', { type: 'button', class: 'btn', disabled: !ready.length, onclick: function () { register(false); } }, '관리 대장에 등록'),
        h('button', { type: 'button', class: 'btn', disabled: !ready.length, onclick: function () { register(true); } }, '보낸 것으로 기록(송부일 오늘)')),
      h('p', { class: 'note' }, '「보낸 것으로 기록」은 Outlook에서 실제로 보낸 뒤 누르십시오. 송부일이 들어가야 OC 미접수 판정이 시작됩니다.')));

    function draftOf(r) {
      var s = L.supplierByCode(db.suppliers, r.supplier_code);
      return L.poMailDraft({ po_no: r.po_no }, s, db, r.bytes ? { name: r.file, type: 'application/pdf', bytes: r.bytes } : null);
    }
    function register(sent) {
      var today = App.today();
      var inc = ready.map(function (r) { return L.cleanPo({ po_no: r.po_no, supplier_code: r.supplier_code, po_date: today, sent_date: sent ? today : '' }, db.suppliers); });
      var res = L.upsertPos(db.pos, inc);
      db.pos = res.pos; App.save();
      App.toast('대장 추가 ' + res.added + '건, 갱신 ' + res.updated + '건' + (sent ? ' · 송부일 ' + today : ''));
      App.render();
    }
    function addFiles(files) {
      Promise.all(files.map(function (f) {
        return App.readBuffer(f).then(function (buf) { return analyse(f.name, new Uint8Array(buf)); });
      })).then(function (list) { App.state.poRows = rows.concat(list); App.render(); });
    }
    function sampleFiles() {
      Promise.all(S.poPdfs.map(function (p) { return analyse(p.name, L.makeSimplePdf(p.lines)); }))
        .then(function (list) { App.state.poRows = rows.concat(list); App.render(); });
    }
  };

  function analyse(name, bytes) {
    return pdfText(bytes).then(function (t) { return { text: t, err: '' }; }, function (e) { return { text: '', err: '본문을 읽지 못함(' + e.message + ')' }; })
      .then(function (x) {
        var m = L.matchPoFile({ name: name, text: x.text }, App.db.suppliers, App.db.settings);
        var mis = m.issues.filter(function (i) { return /파일명과 본문/.test(i); })[0] || '';
        return { file: name, bytes: bytes, po_no: m.po_no, supplier_code: m.supplier_code, textLen: x.text.trim().length, nameTextMismatch: mis, textError: x.err };
      });
  }
  App.analysePdf = analyse;

  /* ── 관리 대장 ─────────────────────────────── */
  var FILTERS = [
    ['all', '전체'], ['oc_overdue', 'OC 미접수'], ['oc_wait', 'OC 대기'], ['exw_soon', 'EXW 임박'], ['exw_late', 'EXW 지연'],
    ['docs', '선적서류·A/N 미수신'], ['unsent', '미송부']
  ];
  App.views.ledger = function (main) {
    var db = App.db, today = App.today();
    var flt = App.state.ledgerFilter || 'all';
    main.appendChild(App.pageHead('PO·OC·EXW 관리 대장', h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: function () { editPo(null); } }, 'PO 추가'),
      h('button', { type: 'button', class: 'btn', onclick: function () {
        App.writeXlsx((db._sample ? '예시데이터_' : '') + '관리대장_' + today + '.xlsx', { '관리대장': L.ledgerRows(db, today) });
      } }, '엑셀 내보내기'))));
    var counts = {};
    FILTERS.forEach(function (f) { counts[f[0]] = db.pos.filter(function (p) { return match(p, f[0]); }).length; });
    main.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': '상태 거르기' }, FILTERS.map(function (f) {
      return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(flt === f[0]), onclick: function () { App.state.ledgerFilter = f[0]; App.render(); } }, f[1] + ' ' + counts[f[0]]);
    })));
    var q = h('input', { type: 'search', value: App.state.ledgerQ || '', placeholder: 'PO 번호·업체·품목', oninput: function () { App.state.ledgerQ = q.value; draw(); } });
    main.appendChild(h('div', { class: 'filters', style: 'margin-bottom:12px' }, App.field('찾기', q)));
    var box = h('div'); main.appendChild(box); draw();

    main.appendChild(h('div', { style: 'margin-top:24px' }, App.mappingPanel({
      kind: 'ledger', title: '관리 대장 엑셀 가져오기',
      note: '이 도구에서 내보낸 대장이나 HD360 등에서 받은 엑셀을 올립니다. 같은 PO 번호는 빈칸이 아닌 값만 덮어씁니다.',
      applyLabel: '대장에 반영',
      onApply: function (rows) {
        var inc = rows.map(function (r) { return L.cleanPo(r, db.suppliers); }).filter(function (p) { return p.po_no; });
        var res = L.upsertPos(db.pos, inc); db.pos = res.pos; App.save(); App.render();
        App.toast('추가 ' + res.added + '건, 갱신 ' + res.updated + '건');
      }
    })));

    function match(p, f) {
      if (f === 'all') return true;
      if (f === 'docs') return L.hasFlag(p, 'docs_missing', today, db.settings) || L.hasFlag(p, 'an_missing', today, db.settings);
      return L.hasFlag(p, f, today, db.settings);
    }
    function draw() {
      box.innerHTML = '';
      var k = L.norm(App.state.ledgerQ || '');
      var rows = db.pos.filter(function (p) {
        return match(p, flt) && (!k || [p.po_no, p.item, App.supplierName(p.supplier_code)].some(function (v) { return L.norm(v).indexOf(k) >= 0; }));
      });
      box.appendChild(h('p', { class: 'list-meta' }, rows.length + '건 / 전체 ' + db.pos.length + '건 · 오늘 ' + today));
      box.appendChild(App.table([
        { label: 'PO 번호·품목', cell: function (p) { return h('span', null, h('strong', null, p.po_no), p.item ? h('br') : null, p.item ? h('small', { class: 'muted' }, p.item) : null); } },
        { label: '업체', cell: function (p) { return App.supplierName(p.supplier_code); } },
        { label: '송부일', cls: 'nowrap', cell: function (p) { return p.sent_date; } },
        { label: 'OC 수령일', cls: 'nowrap', cell: function (p) { return p.oc_date; } },
        { label: '약속 EXW', cls: 'nowrap', cell: function (p) { return p.exw_promised; } },
        { label: '실제 출고', cls: 'nowrap', cell: function (p) {
          if (!p.exw_actual) return '';
          var d = L.daysBetween(p.exw_promised, p.exw_actual);
          return h('span', null, p.exw_actual, d != null ? h('br') : null, d != null ? h('small', { class: 'muted' }, d > 0 ? d + '일 늦음' : (d < 0 ? (-d) + '일 이름' : '당일')) : null);
        } },
        { label: 'A/N·서류', cell: function (p) { return (p.an_received ? 'A/N ✓' : 'A/N -') + ' / ' + (p.docs_received ? '서류 ✓' : '서류 -'); } },
        { label: '상태', cell: function (p) { return App.badges(L.poFlags(p, today, db.settings)); } },
        { label: '', cell: function (p) {
          return h('div', { class: 'btn-row' },
            p.sent_date && !p.oc_date ? h('button', { type: 'button', class: 'btn', onclick: function () { p.oc_date = today; App.save(); App.render(); App.toast(p.po_no + ' OC 수령일 ' + today); } }, 'OC 오늘 수령') : null,
            h('button', { type: 'button', class: 'btn', onclick: function () { editPo(p); } }, '수정'));
        } }
      ], rows));
    }
  };

  function editPo(p) {
    var db = App.db, isNew = !p;
    p = p || L.cleanPo({}, []);
    var f = {};
    f.po_no = h('input', { type: 'text', value: p.po_no });
    f.supplier_code = App.supplierSelect(p.supplier_code);
    f.item = h('input', { type: 'text', value: p.item });
    ['po_date', 'sent_date', 'oc_date', 'exw_promised', 'exw_actual', 'etd'].forEach(function (k) { f[k] = h('input', { type: 'date', value: p[k] }); });
    f.an_received = h('input', { type: 'checkbox', checked: p.an_received });
    f.docs_received = h('input', { type: 'checkbox', checked: p.docs_received });
    f.note = h('textarea', { rows: 3 }); f.note.value = p.note || '';
    var tplSel = h('select', null, L.TEMPLATE_KEYS.filter(function (t) { return t.key !== 'po_mail' && t.key !== 'oc_followup'; }).map(function (t) { return h('option', { value: t.key }, t.label); }));
    var content = h('div', null,
      h('div', { class: 'form-grid' },
        App.field('PO 번호', f.po_no), App.field('업체', f.supplier_code), App.field('품목·품번', f.item), App.field('발주일', f.po_date),
        App.field('송부일', f.sent_date), App.field('OC 수령일', f.oc_date, '공급사 회신 메일을 받은 날(가정)'),
        App.field('약속 EXW DATE', f.exw_promised), App.field('실제 출고일', f.exw_actual), App.field('선적 예정일(ETD)', f.etd),
        h('div', null, h('label', { class: 'check' }, f.an_received, 'A/N 수신'), h('label', { class: 'check' }, f.docs_received, '선적서류 수신')),
        h('div', { class: 'span-all' }, App.field('메모', f.note))),
      !isNew ? h('div', { class: 'card', style: 'margin:16px 0 0' }, h('h3', null, '상황별 메일 초안'),
        h('div', { class: 'btn-row' }, tplSel, h('button', { type: 'button', class: 'btn', onclick: function () {
          var s = L.supplierByCode(db.suppliers, p.supplier_code);
          if (!s) { App.toast('업체가 지정되지 않았습니다.', true); return; }
          App.saveEml(L.situationDraft(tplSel.value, p, s, db));
        } }, '.eml 초안 내려받기'))) : null);
    var buttons = [{ label: '취소' }];
    if (!isNew) buttons.push({ label: '삭제', danger: true, onClick: function () { db.pos = db.pos.filter(function (x) { return x !== p; }); App.save(); App.render(); } });
    buttons.push({ label: '저장', primary: true, onClick: function () {
      var v = {}; Object.keys(f).forEach(function (k) { v[k] = f[k].type === 'checkbox' ? f[k].checked : f[k].value; });
      var np = L.cleanPo(v, db.suppliers);
      if (!np.po_no) { App.toast('PO 번호를 입력해 주십시오.', true); return false; }
      if (np.po_no !== p.po_no && db.pos.some(function (x) { return x.po_no === np.po_no; })) { App.toast('이미 있는 PO 번호입니다.', true); return false; }
      np.followup_date = p.followup_date || '';
      if (isNew) db.pos.push(np); else db.pos[db.pos.indexOf(p)] = np;
      App.save(); App.render();
    } });
    App.dialog(isNew ? 'PO 추가' : 'PO ' + p.po_no, content, buttons);
  }

  /* ── OC 팔로우업 ─────────────────────────────── */
  App.views.followup = function (main) {
    var db = App.db, today = App.today();
    var groups = L.ocFollowups(db, today);
    var waiting = db.pos.filter(function (p) { return L.hasFlag(p, 'oc_wait', today, db.settings); }).length;
    main.appendChild(App.pageHead('OC 미접수 팔로우업', groups.length ? h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
      App.saveEmlZip(groups.map(function (g) { return g.draft; }), (db._sample ? '예시데이터_' : '') + 'OC팔로우업_' + today + '.zip');
    } }, '업체별 초안 모두 내려받기(ZIP)') : null));
    main.appendChild(h('p', null, '송부 후 ' + db.settings.oc_wait_days + '일이 지나도 OC 수령일이 비어 있는 PO를 업체별로 묶었습니다. 기준 일수는 「설정」에서 바꿉니다. 아직 기준을 넘지 않은 OC 대기 건은 ' + waiting + '건입니다.'));
    if (!groups.length) { main.appendChild(h('div', { class: 'alert info' }, 'OC 미접수 건이 없습니다.')); return; }
    groups.forEach(function (g) {
      var subj = h('input', { type: 'text', value: g.draft.subject });
      var body = h('textarea', { rows: 12 }); body.value = g.draft.body;
      function cur() { return Object.assign({}, g.draft, { subject: subj.value, body: body.value }); }
      main.appendChild(h('div', { class: 'card' },
        h('h2', null, g.supplier ? g.supplier.name : g.supplier_code, ' ', h('span', { class: 'badge danger' }, g.pos.length + '건 · 최장 ' + g.maxWait + '일')),
        g.problem ? h('div', { class: 'alert warn' }, g.problem) : null,
        App.table([
          { label: 'PO 번호', cell: function (p) { return p.po_no; } },
          { label: '품목', cell: function (p) { return p.item; } },
          { label: '송부일', cell: function (p) { return p.sent_date; } },
          { label: '경과', cell: function (p) { return L.daysBetween(p.sent_date, today) + '일'; } },
          { label: '마지막 팔로우업', cell: function (p) { return p.followup_date || ''; } }
        ], g.pos),
        h('div', { class: 'mail-box', style: 'margin-top:12px' },
          h('p', { class: 'note' }, '받는 사람: ' + (g.draft.to || '(없음)') + (g.draft.cc ? ' · 참조: ' + g.draft.cc : '')),
          App.field('제목', subj), App.field('본문(고쳐서 내려받을 수 있습니다)', body),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { App.saveEml(cur()); } }, '.eml 초안 내려받기'),
            h('button', { type: 'button', class: 'btn', onclick: function () { App.copy(body.value); } }, '본문 복사'),
            h('button', { type: 'button', class: 'btn', onclick: function () {
              g.pos.forEach(function (p) { p.followup_date = today; }); App.save(); App.render(); App.toast('팔로우업 날짜를 기록했습니다.');
            } }, '보낸 것으로 기록(오늘)')))));
    });
  };

  /* ── 접수율·준수율 ─────────────────────────────── */
  App.views.kpi = function (main) {
    var db = App.db, today = App.today();
    var from = App.state.kpiFrom || '', to = App.state.kpiTo || '';
    var pos = db.pos.filter(function (p) {
      var d = p.sent_date || p.po_date;
      return (!from || (d && d >= from)) && (!to || (d && d <= to));
    });
    var oc = L.ocStats(pos, today, db.settings), ex = L.exwStats(pos, today, db.settings);
    var bySup = L.statsBySupplier(pos, db.suppliers, today, db.settings);
    main.appendChild(App.pageHead('OC 접수율 · EXW 준수율', h('button', { type: 'button', class: 'btn', onclick: function () {
      App.writeXlsx((db._sample ? '예시데이터_' : '') + '업체별_접수율_준수율_' + today + '.xlsx', { '업체별': bySup.map(function (r) {
        return { '업체': r.name, 'PO 건수': r.count, '송부': r.oc.sent, 'OC 수령': r.oc.received, 'OC 접수율(%)': r.oc.rate == null ? '' : Math.round(r.oc.rate * 1000) / 10,
          'OC 미접수': r.oc.overdue, '출고 평가 건': r.exw.evaluated, 'EXW 준수': r.exw.onTime, 'EXW 준수율(%)': r.exw.rate == null ? '' : Math.round(r.exw.rate * 1000) / 10,
          '평균 지연일': r.exw.avgDelay == null ? '' : Math.round(r.exw.avgDelay * 10) / 10, '미출고 지연': r.exw.openLate };
      }) });
    } }, '엑셀 내보내기')));
    var fIn = h('input', { type: 'date', value: from }), tIn = h('input', { type: 'date', value: to });
    main.appendChild(h('div', { class: 'card' }, h('div', { class: 'filters' },
      App.field('송부일(없으면 발주일) 부터', fIn), App.field('까지', tIn),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { App.state.kpiFrom = fIn.value; App.state.kpiTo = tIn.value; App.render(); } }, '기간 적용'),
        h('button', { type: 'button', class: 'btn', onclick: function () { App.state.kpiFrom = App.state.kpiTo = ''; App.render(); } }, '전체')))));
    main.appendChild(h('div', { class: 'tiles' },
      tile('OC 접수율', L.pct(oc.rate), '수령 ' + oc.received + ' / 송부 ' + oc.sent),
      tile('OC 미접수', oc.overdue + '건', '평균 회신 ' + (oc.avgLeadDays == null ? '-' : L.num1(oc.avgLeadDays) + '일'), oc.overdue > 0),
      tile('EXW 준수율', L.pct(ex.rate), '준수 ' + ex.onTime + ' / 출고 ' + ex.evaluated),
      tile('평균 지연일', ex.avgDelay == null ? '-' : L.num1(ex.avgDelay) + '일', '지연 건만 ' + (ex.avgDelayLateOnly == null ? '-' : L.num1(ex.avgDelayLateOnly) + '일')),
      tile('미출고 지연', ex.openLate + '건', '약속일이 지났는데 출고일 없음', ex.openLate > 0)));
    main.appendChild(h('div', { class: 'formula' },
      h('p', null, h('strong', null, '산식(가정 — 사내 기준 확인 필요). '), 'OC 접수율 = OC 수령일이 있는 PO ÷ 송부일이 있는 PO.'),
      h('p', null, 'EXW 준수율 = 실제 출고일 ≤ 약속 EXW DATE + 허용 ' + db.settings.exw_grace_days + '일 인 PO ÷ 약속일과 실제 출고일이 모두 있는 PO.'),
      h('p', null, '평균 지연일 = 출고 완료 PO의 (실제 출고일 − 약속 EXW DATE) 평균. 약속보다 이르거나 같으면 0일로 셉니다. 아직 출고하지 않은 지연 건은 「미출고 지연」으로 따로 셉니다.')));
    main.appendChild(h('h2', { style: 'margin-top:20px' }, '업체별'));
    main.appendChild(App.table([
      { label: '업체', cell: function (r) { return r.name; } },
      { label: 'PO', cell: function (r) { return r.count; } },
      { label: 'OC 접수율', cell: function (r) { return bar(r.oc.rate, r.oc.received + '/' + r.oc.sent); } },
      { label: 'OC 미접수', cell: function (r) { return r.oc.overdue ? h('span', { class: 'badge danger' }, r.oc.overdue + '건') : '0'; } },
      { label: 'EXW 준수율', cell: function (r) { return bar(r.exw.rate, r.exw.onTime + '/' + r.exw.evaluated, true); } },
      { label: '평균 지연일', cell: function (r) { return r.exw.avgDelay == null ? '-' : L.num1(r.exw.avgDelay) + '일'; } },
      { label: '미출고 지연', cell: function (r) { return r.exw.openLate ? h('span', { class: 'badge danger' }, r.exw.openLate + '건') : '0'; } }
    ], bySup));
    function tile(k, v, s, danger) { return h('div', { class: 'tile' + (danger ? ' danger' : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), h('div', { class: 's' }, s)); }
    function bar(rate, sub, ok) {
      return h('div', { class: 'bar-cell' }, h('div', { class: 'bar' + (ok ? ' ok' : ''), role: 'img', 'aria-label': L.pct(rate) },
        h('span', { style: 'width:' + (rate == null ? 0 : Math.round(rate * 100)) + '%' })), h('b', null, L.pct(rate)), h('small', { class: 'muted' }, sub));
    }
  };
})(window);
