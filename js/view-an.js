/* 화면: 도착 통지(A/N) — 포워더 A/N 메일 읽기 · 항차등록 대기 · ETA 변경 · 이력 (2026-09-29 저녁 요청) */
(function (root) {
  'use strict';
  var L = root.OMLogic, S = root.OMSample, App = root.OM, h = App.h;

  function an() { App.db.an = App.db.an || L.emptyAn(); return App.db.an; }
  function nowIso() { return new Date().toISOString(); }
  function field(key) { return L.AN_FIELDS.filter(function (f) { return f.key === key; })[0]; }

  // 파일 목록 → A/N 기록(B/L 마다 한 건). .eml 은 본문 표와 첨부(엑셀·PDF)를 함께 읽고,
  // 엑셀(.xls·.xlsx)·PDF(B/L·AWB 사본)·HTML 은 파일 하나를 그대로 올려도 읽습니다(2026-09-29 밤, 실물 양식).
  function sheetGrid(bytes) {
    if (!root.XLSX) throw new Error('엑셀 라이브러리를 불러오지 못했습니다');
    var wb = XLSX.read(bytes, { type: 'array', cellDates: false });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true, blankrows: false });
  }
  function extrasOf(atts) {
    var extra = { grids: [], pdfs: [], errors: [] }, jobs = [];
    atts.forEach(function (a) {
      if (a.inline && !/\.(xlsx?|pdf)$/i.test(a.name)) return;
      if (/\.(xlsx?|xlsm|csv)$/i.test(a.name)) {
        try { extra.grids.push({ name: '첨부 ' + a.name, rows: sheetGrid(a.bytes) }); } catch (e) { extra.errors.push(a.name + '(' + e.message + ')'); }
      } else if (/\.pdf$/i.test(a.name) && App.pdfPages) {
        jobs.push(App.pdfPages(a.bytes, 30).then(function (pages) { extra.pdfs.push({ name: '첨부 ' + a.name, pages: pages }); },
          function (e) { extra.errors.push(a.name + '(글을 읽지 못함: ' + e.message + ')'); }));
      }
    });
    return Promise.all(jobs).then(function () { return extra; });
  }
  function readFiles(files) {
    var db = App.db, today = App.today(), skipped = [], errors = [];
    var jobs = files.map(function (f) {
      if (/\.msg$/i.test(f.name)) { skipped.push(f.name); return Promise.resolve([]); }
      return App.readBuffer(f).then(function (buf) {
        var bytes = new Uint8Array(buf), opts = { file: f.name, today: today, dayFirst: App.state.anDayFirst };
        var blank = { from: '', fromAddr: '', subject: '', date: '', dateTime: '', body: '', attachments: [] };
        if (/\.(xlsx?|xlsm|csv)$/i.test(f.name)) return extrasOf([{ name: f.name, bytes: bytes }]).then(function (x) { errors = errors.concat(x.errors); return L.anParseAll(blank, db, opts, x); });
        if (/\.pdf$/i.test(f.name)) return extrasOf([{ name: f.name, bytes: bytes }]).then(function (x) { errors = errors.concat(x.errors); return L.anParseAll(blank, db, opts, x); });
        var text = new TextDecoder('utf-8').decode(bytes);
        if (/\.html?$/i.test(f.name)) return L.anParseAll(Object.assign({}, blank, { html: text, body: text.replace(/<[^>]+>/g, ' ') }), db, opts, {});
        var mail = /\.(eml|mht|mhtml)$/i.test(f.name) || /^[\w\-]+:/.test(text.slice(0, 200)) ? L.parseEml(bytes) : L.anMailFromText(text);
        return extrasOf(mail.attachments || []).then(function (x) { errors = errors.concat(x.errors); return L.anParseAll(mail, db, opts, x); });
      });
    });
    return Promise.all(jobs).then(function (lists) {
      if (skipped.length) App.toast('Outlook .msg 는 읽지 못합니다(' + skipped.join(', ') + '). .eml 로 저장하거나 본문을 붙여넣어 주십시오.', true);
      else if (errors.length) App.toast('첨부 일부를 읽지 못했습니다: ' + errors.join(', '), true);
      return [].concat.apply([], lists);
    });
  }
  function addRecs(recs) {
    var r = L.anAddMails(App.db, recs);
    var n = L.anSyncToPos(App.db);
    App.save(); App.render();
    App.toast('A/N ' + r.added + '건 추가(B/L 별)' + (r.skipped ? ' · 이미 읽은 ' + r.skipped + '건 건너뜀' : '') + (n ? ' · 대장 ' + n + '건에 A/N·B/L·ETA 반영' : ''));
  }

  // 예시: A/N 예시와 짝이 되는 업체·PO 가 대장에 없으면 넣습니다.
  function ensureAnSample() {
    var db = App.db, today = App.today();
    var need = ['EX4500010002', 'EX4500010003', 'EX4500010005', 'EX4500010006', 'EX4500010007', 'EX4500010008'];   // 06~08: 도착일정통지 양식 예시
    var codes = ['EX-A01', 'EX-B02', 'EX-C03', 'EX-D04'];
    var rows = S.contactRows.filter(function (r) { return codes.indexOf(r['Vendor Code']) >= 0 && !L.supplierByCode(db.suppliers, r['Vendor Code']); });
    if (rows.length) db.suppliers = L.mergeSuppliers(db.suppliers, L.importSuppliers(L.applyMapping(rows, L.guessMapping(Object.keys(rows[0]), 'supplier'))).suppliers);
    var add = S.ledger(today).filter(function (p) { return need.indexOf(p.po_no) >= 0 && !db.pos.some(function (x) { return x.po_no === p.po_no; }); });
    if (add.length) db.pos = L.upsertPos(db.pos, add.map(function (p) { return L.cleanPo(p, db.suppliers); })).pos;
    // B/L 로만 붙는 예시(Gamma)를 위해 짝 PO 의 B/L 번호가 비어 있으면 넣음
    var p3 = db.pos.filter(function (x) { return x.po_no === 'EX4500010003'; })[0];
    if (p3 && !p3.bl_no) p3.bl_no = 'GMAO26090077';
    db._sample = true;
  }

  App.views.an = function (main) {
    var db = App.db, today = App.today(), st = App.state;
    an();
    var q = L.anQueue(db);
    main.appendChild(App.pageHead('도착 통지(A/N) · 항차등록 대기', h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: exportXlsx }, '엑셀 내보내기'),
      h('button', { type: 'button', class: 'btn', onclick: exportCsv }, 'CSV 내보내기'))));
    main.appendChild(h('p', null, '포워더가 보내는 A/N(도착일정통지) 메일을 올리면 B/L(HBL, 없으면 MBL)·TMS NO(= HIPRO 신청번호)·PO 목록·컨테이너·화물형태·입항일(ETA)·Incoterms·Local AR 등을 읽어 대장의 PO에 붙입니다. 메일에 적힌 B/L마다 한 줄로 「항차등록 대기」에 모으고, 등록을 마치면 날짜와 함께 「등록 완료」로 표시합니다. B/L 한 건에 PO가 여럿이면 한 줄에 PO 목록으로 보여 드립니다. 같은 B/L의 새 A/N에서 ETA가 바뀌면 이전 → 이후로 알려 드립니다.'));

    // ── 올리기: 끌어 놓기 · 파일 선택 · 붙여넣기 ──
    var fileIn = h('input', { type: 'file', accept: '.eml,.txt,.msg,.xls,.xlsx,.pdf,.htm,.html,message/rfc822,text/plain', multiple: true, style: 'display:none' });
    fileIn.addEventListener('change', function () { var fs = Array.prototype.slice.call(fileIn.files); fileIn.value = ''; readFiles(fs).then(addRecs); });
    var drop = h('div', { class: 'drop-zone', tabindex: '0', role: 'button', 'aria-label': 'A/N 메일 파일을 여기에 끌어 놓거나 눌러서 고르기',
      onclick: function () { fileIn.click(); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } },
      h('strong', null, 'A/N 메일(.eml)이나 A/N 엑셀·PDF를 여기에 끌어 놓으십시오'), h('span', { class: 'muted' }, '여러 개를 한 번에 놓아도 됩니다 · 눌러서 고를 수도 있습니다'));
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) {
      var fs = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (fs.length) readFiles(fs).then(addRecs);
      else App.toast('파일이 아닙니다. Outlook 메일은 「다른 이름으로 저장」(.eml) 후 놓거나, 본문을 아래 칸에 붙여넣어 주십시오.', true);
    });
    var paste = h('textarea', { rows: 5, placeholder: 'A/N 메일 본문(또는 메일 원문 전체)을 붙여넣어 주십시오. 메일의 표를 복사해 붙이면 칸이 탭으로 나뉘어 표 그대로 읽습니다' });
    var dayFirst = h('input', { type: 'checkbox', checked: !!st.anDayFirst, onchange: function (e) { st.anDayFirst = e.target.checked; } });
    main.appendChild(h('div', { class: 'card' }, h('h2', null, 'A/N 메일 올리기'), drop,
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('label', { class: 'btn btn-primary' }, '파일 선택(.eml·.xls·.pdf, 여러 개)', fileIn),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          ensureAnSample();
          var recs = S.anMails(today).map(function (m) { return L.parseArrivalNotice(L.parseEml(L.utf8(m.text)), App.db, { file: m.name, today: today }); });
          // 실물 양식을 본뜬 예시(해상 본문 표 + 엑셀 첨부 모양, 항공 본문 표) — 값은 모두 지어낸 것
          S.anRealMails(today).forEach(function (m) {
            var mail = L.parseEml(L.utf8(m.text));
            recs = recs.concat(L.anParseAll(mail, App.db, { file: m.name, today: today }, { grids: (m.grids || []).map(function (g) { return { name: '첨부 ' + g.name, rows: g.rows }; }), pdfs: (m.pdfs || []).map(function (d) { return { name: '첨부 ' + d.name, pages: d.pages }; }) }));
          });
          addRecs(recs);
        } }, '예시 A/N으로 해 보기'),
        q.groups.length ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () {
          App.dialog('A/N 메일 목록 비우기', h('p', null, '읽어 둔 A/N 메일을 모두 지웁니다. 항차등록 완료 표시와 이력, 대장에 이미 넣은 B/L·ETA는 그대로 둡니다.'),
            [{ label: '취소' }, { label: '비우기', danger: true, onClick: function () { an().mails = []; App.save(); App.render(); } }]);
        } }, 'A/N 목록 비우기') : null),
      h('div', { style: 'margin-top:12px' }, App.field('본문 붙여넣기', paste),
        h('div', { class: 'btn-row', style: 'margin-top:8px' },
          h('button', { type: 'button', class: 'btn', onclick: function () {
            if (!paste.value.trim()) { App.toast('붙여넣은 글이 없습니다.', true); return; }
            var mail = L.anMailFromText(paste.value);
            addRecs(L.anParseAll(mail, db, { file: '붙여넣기 ' + today, today: today, dayFirst: st.anDayFirst }, {}));
          } }, '붙여넣은 글 읽기'),
          h('label', { class: 'check' }, dayFirst, '12/10/2026 같은 날짜를 일/월/연도 순서로 읽기'))),
      h('p', { class: 'note' }, '「도착일정통지」 메일은 본문 표 한 줄(신청번호 한 건)을 B/L 한 건으로 읽습니다. PO LIST의 여러 PO(쉼표·전각 쉼표·줄바꿈·붙어 있는 번호)와 여러 컨테이너(화물형태·번호·형식 되풀이)를 나눕니다. 메일에 붙은 엑셀(.xls)·B/L 사본 PDF도 함께 읽어 같은 B/L의 빈 칸(항차·출항일 등)을 채웁니다. 해상·항공은 참고로만 표시합니다. Outlook 데스크톱에서 끌어 놓으면 .msg가 되는 경우가 있으니 .eml로 저장해 주십시오. 받은 날은 메일의 보낸 시각(이 PC 시간대 기준), 파일·붙여넣은 글은 오늘입니다.')));

    var groups = q.groups;
    if (!groups.length && !q.rows.length) {
      main.appendChild(h('div', { class: 'alert info' }, '아직 읽은 A/N이 없습니다. 「예시 A/N으로 해 보기」로 먼저 둘러보십시오(도착일정통지 해상·항공 양식을 본뜬 예시와 가상의 포워더 3곳 양식, 같은 B/L의 ETA 변경 1건 포함 — 값은 모두 지어낸 것).'));
      return;
    }
    var laterReg = q.done.filter(function (r) { return r.etaAfterReg; });
    main.appendChild(h('div', { class: 'tiles' },
      tile('읽은 A/N', (an().mails.length) + '건', 'B/L ' + groups.filter(function (g) { return g.bl; }).length + '건'),
      tile('항차등록 대기', q.pending.length + '건', 'B/L·A/N 있음, 등록 전', q.pending.length > 0),
      tile('등록 완료', q.done.length + '건', laterReg.length ? '등록 후 ETA 변경 ' + laterReg.length + '건' : '', laterReg.length > 0),
      tile('ETA 변경', q.etaChanged.length + '건', '같은 B/L의 새 A/N', q.etaChanged.length > 0),
      tile('대장에 없는 B/L', q.unmatched.length + '건', 'PO·B/L이 대장에 없음', q.unmatched.length > 0)));

    drawPending();
    drawDone();
    drawMails();
    drawUnmatched();
    drawHistory();

    // ── 항차등록 대기 ──
    function drawPending() {
      var pick = st.anPick = st.anPick || {};
      var dateIn = h('input', { type: 'date', value: st.anRegDate || today, onchange: function () { st.anRegDate = dateIn.value; } });
      var card = h('div', { class: 'card' }, h('h2', null, '항차등록 대기 ' + q.pending.length + '건'),
        h('p', { class: 'note' }, 'A/N을 받았는데 아직 「등록 완료」로 표시하지 않은 B/L입니다(B/L 한 건 = 한 줄). SRM은 HBL 기준이라 HBL로 관리하고, HBL 없이 MBL만 온 건은 MBL로 대신 올리되 「HBL 없음」 표시를 붙입니다. ETA가 빠른 순서입니다. SRM 항차 입력을 마친 건을 골라 등록일과 함께 표시해 주십시오. 대장에서 「A/N 수신」과 B/L 번호를 손으로 적은 PO도 B/L별로 여기에 나옵니다.'));
      card.appendChild(App.table([
        { label: '', cell: function (r) { return h('input', { type: 'checkbox', 'aria-label': r.bl + ' 고르기', checked: !!pick[r.key], onchange: function (e) { pick[r.key] = e.target.checked; } }); } },
        { label: 'B/L', cell: blCell },
        { label: 'PO', cell: poListCell },
        { label: '컨테이너', cell: cntrCell },
        { label: '선명 / 항차', cell: function (r) { return r.vessel ? r.vessel + (r.voyage ? ' / ' + r.voyage : '') : ''; } },
        { label: 'ETD', cls: 'nowrap', cell: function (r) { return r.etd; } },
        { label: 'ETA', cls: 'nowrap', cell: etaCell },
        { label: 'A/N', cls: 'nowrap', cell: function (r) { return r.anCount ? r.anCount + '통 · 마지막 ' + r.lastAn : '대장 표시'; } }
      ], q.pending));
      card.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px;align-items:flex-end' },
        App.field('항차등록일', dateIn),
        h('button', { type: 'button', class: 'btn', disabled: !q.pending.length, onclick: function () { q.pending.forEach(function (r) { pick[r.key] = true; }); App.render(); } }, '모두 고르기'),
        h('button', { type: 'button', class: 'btn btn-primary', disabled: !q.pending.length, onclick: function () {
          var rows = q.pending.filter(function (r) { return pick[r.key]; });
          if (!rows.length) { App.toast('등록 완료로 표시할 B/L을 골라 주십시오.', true); return; }
          if (!dateIn.value) { App.toast('항차등록일을 넣어 주십시오.', true); return; }
          L.anRegister(App.db, rows, dateIn.value, nowIso());
          rows.forEach(function (r) { delete pick[r.key]; });
          App.save(); App.render(); App.toast(rows.length + '건을 항차등록 완료(' + dateIn.value + ')로 표시했습니다.');
        } }, '고른 건 등록 완료')));
      main.appendChild(card);
    }
    function blCell(r) {
      return h('span', null, h('strong', null, r.bl),
        r.mblOnly ? h('span', { class: 'badge warn', title: 'SRM은 HBL 기준입니다. A/N에 MBL만 있어 MBL로 대신 관리합니다. HBL과 이 MBL이 함께 적힌 A/N이 오면 자동으로 이어집니다. HBL을 알면 「확인·고치기」에서 B/L(HBL) 칸에 넣어 주십시오.' }, 'HBL 없음 · MBL로 대신') : null,
        r.mbl ? h('small', { class: 'muted' }, h('br'), 'MBL ' + r.mbl) : null,
        h('br'), h('small', { class: 'muted' }, 'TMS NO ' + (r.tms || '-') + (r.req_no && r.req_no !== r.tms ? ' · 신청번호 ' + r.req_no : '') + (r.mode ? ' · ' + r.mode : '')));
    }
    function poListCell(r) {
      var inLedger = r.ledger.map(function (x) { return x.po_no; });
      var names = [];
      r.ledger.forEach(function (x) { var n = App.supplierName(x.supplier_code); if (n && names.indexOf(n) < 0) names.push(n); });
      return h('span', null, h('small', { class: 'muted' }, r.pos.length + '건 '),
        r.pos.map(function (no) { return h('span', { class: 'badge ' + (inLedger.indexOf(no) >= 0 ? 'ok' : 'warn'), title: inLedger.indexOf(no) >= 0 ? '대장에 있음' : '대장에 없음' }, no); }),
        names.length ? h('small', { class: 'muted' }, h('br'), names.join(', ')) : null);
    }
    function cntrCell(r) {
      if (!r.containers.length) return r.cargo_type || '-';
      return h('span', null, h('small', { class: 'muted' }, (r.cargo_type ? r.cargo_type + ' · ' : '') + r.containers.length + '개'), h('br'),
        h('small', null, r.containers.map(function (c) { return c.no + (c.type ? ' ' + c.type : ''); }).join(', ')));
    }
    function etaCell(r) {
      var out = [r.eta || '-'];
      if (r.etaChanges.length) {
        var c = r.etaChanges[r.etaChanges.length - 1];
        out.push(h('br'), h('span', { class: 'badge ' + (c.days > 0 ? 'danger' : 'warn') }, 'ETA 변경 ' + c.from + ' → ' + c.to));
        if (r.etaChanges.length > 1) out.push(h('small', { class: 'muted' }, ' 외 ' + (r.etaChanges.length - 1) + '회'));
      }
      return h('span', null, out);
    }

    // ── 등록 완료 ──
    function drawDone() {
      if (!q.done.length) return;
      var box = h('details', { class: 'card', open: laterReg.length ? true : null },
        h('summary', null, h('strong', null, '등록 완료 ' + q.done.length + '건' + (laterReg.length ? ' · 등록 후 ETA 변경 ' + laterReg.length + '건' : ''))));
      box.appendChild(h('p', { class: 'note' }, '등록한 뒤 새 A/N에서 ETA가 바뀐 건은 빨간 표시가 붙습니다. SRM의 조정 ETA를 고친 뒤 「조정 ETA 반영함」을 눌러 주십시오(이력에 남습니다).'));
      box.appendChild(App.table([
        { label: 'B/L', cell: blCell },
        { label: 'PO', cell: poListCell },
        { label: '항차등록일', cls: 'nowrap', cell: function (r) { return r.reg.date; } },
        { label: '등록 때 ETA', cls: 'nowrap', cell: function (r) { return r.reg.eta; } },
        { label: '지금 ETA', cls: 'nowrap', cell: function (r) { return r.etaAfterReg ? h('span', { class: 'badge danger' }, '등록 후 변경 ' + r.etaAfterReg.from + ' → ' + r.etaAfterReg.to) : (r.eta || ''); } },
        { label: '', cell: function (r) {
          return h('div', { class: 'btn-row' },
            r.etaAfterReg ? h('button', { type: 'button', class: 'btn', onclick: function () { L.anConfirmEta(App.db, r, nowIso()); App.save(); App.render(); } }, '조정 ETA 반영함') : null,
            h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { L.anUnregister(App.db, r, nowIso()); App.save(); App.render(); App.toast(r.bl + ' 등록 완료를 취소했습니다(이력에 남음).'); } }, '등록 취소'));
        } }
      ], q.done, function (r) { return r.etaAfterReg ? { class: 'row-bad' } : null; }));
      main.appendChild(box);
    }

    // ── 읽은 A/N 메일 ──
    function drawMails() {
      var recs = an().mails.slice().sort(function (a, b) { return String(b.receivedAt || b.received).localeCompare(String(a.receivedAt || a.received)); });
      var card = h('div', { class: 'card' }, h('h2', null, '읽은 A/N ' + recs.length + '건(B/L 별)'),
        h('p', { class: 'note' }, '칸마다 어느 글에서 읽었는지 「확인·고치기」에서 볼 수 있습니다. 양식이 처음 보는 모양이면 빈칸이 생길 수 있으니 원문과 대조해 채워 주십시오. 고친 값은 표시가 남습니다.'));
      card.appendChild(App.table([
        { label: '받은 날', cls: 'nowrap', cell: function (r) { return r.received; } },
        { label: '포워더 · 제목', cls: 'clip', cell: function (r) { return h('span', null, h('strong', null, r.fields.forwarder || '-'), h('br'), h('small', { class: 'muted' }, r.subject || r.file)); } },
        { label: 'B/L · TMS NO', cell: function (r) { return h('span', null, r.fields.bl || h('span', { class: 'badge danger' }, 'B/L 못 읽음'), L.anIsMblOnly(r) ? h('span', { class: 'badge warn', title: 'SRM은 HBL 기준입니다. 이 A/N에는 MBL만 있어 MBL로 대신 관리합니다.' }, 'HBL 없음') : null, h('br'), h('small', { class: 'muted' }, 'TMS ' + (r.fields.tms || '-') + (r.fields.req_no && r.fields.req_no !== r.fields.tms ? ' · ' + r.fields.req_no : ''))); } },
        { label: '선명 / 항차', cell: function (r) { return r.fields.vessel ? r.fields.vessel + (r.fields.voyage ? ' / ' + r.fields.voyage : '') : ''; } },
        { label: 'ETA', cls: 'nowrap', cell: function (r) { return r.fields.eta; } },
        { label: '대장 PO', cell: function (r) { return poCell(r); } },
        { label: '확인', cell: function (r) {
          var fixed = L.AN_FIELDS.filter(function (f) { return r.parsed && r.fields[f.key] !== r.parsed[f.key]; }).length;
          var empty = ['bl', 'eta', 'vessel'].filter(function (k) { return !r.fields[k]; }).length;
          return h('span', null, fixed ? h('span', { class: 'badge ok' }, fixed + '칸 고침') : null, empty ? h('span', { class: 'badge warn' }, '빈칸 ' + empty) : null,
            r.notes && r.notes.length ? h('span', { class: 'badge warn', title: r.notes.join(' / ') }, '확인 메모 ' + r.notes.length) : null);
        } },
        { label: '', cell: function (r) { return h('button', { type: 'button', class: 'btn', onclick: function () { editRec(r); } }, '확인·고치기'); } }
      ], recs));
      main.appendChild(card);
    }
    function poCell(r) {
      var g = q.groups.filter(function (x) { return x.recs.indexOf(r) >= 0; })[0];
      if (!g) return '';
      var m = L.anMatch(g, db);
      return h('span', null, m.list.map(function (x) { return h('span', { class: 'badge ok' }, x.po.po_no + ' (' + x.via + ')'); }),
        m.unknown.map(function (no) { return h('span', { class: 'badge warn' }, no + ' 대장에 없음'); }),
        !m.list.length && !m.unknown.length ? h('span', { class: 'badge danger' }, '못 찾음') : null);
    }

    // 칸별 값 + 근거 원문, 고치기
    function editRec(r) {
      var inputs = {};
      var rows = L.AN_FIELDS.map(function (f) {
        var inp = inputs[f.key] = h('input', { type: f.date ? 'date' : 'text', value: r.fields[f.key] || '' });
        var changed = r.parsed && r.fields[f.key] !== r.parsed[f.key];
        var note = r.src && r.src[f.key] ? '원문: ' + r.src[f.key] : '원문에서 찾지 못함';
        if (changed) note += ' · 읽은 값 「' + (r.parsed[f.key] || '빈칸') + '」을 고침';
        if (f.key === 'weight' && r.fields.weight) { var kg = L.weightKg(r.fields.weight); if (kg != null) note += ' · ' + kg + ' kg'; }
        if (f.key === 'pos') note += ' · 여러 개는 쉼표로(' + L.anPoList(r.fields.pos).length + '건)';
        if (f.key === 'containers' && r.fields.containers) note += ' · ' + L.anContainerList(r.fields.containers).length + '개';
        if (f.key === 'local_ar' && L.anMoney(r.fields.local_ar)) { var mo = L.anMoney(r.fields.local_ar); note += ' · ' + (mo.ccy || '통화 없음') + ' ' + mo.amount; }
        if (f.key === 'tms' && !r.fields.tms) note += ' · TMS NO = HIPRO 신청번호(칸 이름은 설정 「A/N 의 TMS NO 칸 이름」)';
        if (f.key === 'bl' && L.anIsMblOnly(r)) note += ' · HBL이 없어 MBL을 넣었습니다. SRM은 HBL 기준이니 HBL을 알면 고쳐 주십시오';
        if (f.key === 'mode') note += ' · 참고용(비워도 됩니다)';
        return App.field(f.label, inp, note);
      });
      var content = h('div', null,
        h('p', { class: 'note' }, (r.from ? '보낸 사람 ' + r.from + ' · ' : '') + '받은 날 ' + (r.received || '-') + (r.file ? ' · ' + r.file : '')),
        r.notes && r.notes.length ? h('div', { class: 'alert warn' }, r.notes.join(' / ')) : null,
        r.info && r.info.length ? h('p', { class: 'note muted' }, r.info.join(' / ')) : null,
        h('div', { class: 'form-grid' }, rows),
        h('details', { style: 'margin-top:12px' }, h('summary', null, '메일 원문 보기'), h('pre', { class: 'an-raw' }, (r.subject ? '제목: ' + r.subject + '\n\n' : '') + (r.text || ''))));
      App.dialog('A/N 확인·고치기' + (r.fields.bl ? ' — ' + r.fields.bl : ''), content, [
        { label: '이 A/N 삭제', danger: true, onClick: function () { an().mails = an().mails.filter(function (x) { return x !== r; }); App.save(); App.render(); } },
        { label: '취소' },
        { label: '저장', primary: true, onClick: function () {
          L.AN_FIELDS.forEach(function (f) { r.fields[f.key] = inputs[f.key].value.trim(); });
          if (r.fields.pos) r.fields.pos = L.anPoList(r.fields.pos).join(', ');
          if (r.fields.containers && L.anContainerList(r.fields.containers).length) r.fields.containers = L.anContainerText(L.anContainerList(r.fields.containers));
          var n = L.anSyncToPos(App.db);
          App.save(); App.render(); App.toast('저장했습니다.' + (n ? ' 대장 ' + n + '건에 반영.' : ''));
        } }
      ]);
    }

    // ── 대장에 없는 A/N ──
    function drawUnmatched() {
      if (!q.unmatched.length) return;
      main.appendChild(h('div', { class: 'card' }, h('h2', null, '대장 PO에 붙지 않은 B/L ' + q.unmatched.length + '건'),
        h('p', { class: 'note' }, 'A/N의 PO 번호가 대장에 없고, 대장에 같은 B/L 번호를 적은 PO도 없습니다. 항차등록 대기에는 그대로 올라가지만 대장에는 반영되지 않습니다. 관리 대장에 해당 PO를 넣거나 B/L 번호를 적으면 자동으로 연결됩니다.'),
        App.table([
          { label: 'B/L', cell: function (u) { return u.group.bl || '(못 읽음)'; } },
          { label: '포워더', cell: function (u) { return u.group.merged.forwarder; } },
          { label: 'ETA', cls: 'nowrap', cell: function (u) { return u.group.merged.eta; } },
          { label: 'A/N의 PO 번호', cell: function (u) { return u.unknown.join(', ') || '없음'; } },
          { label: '', cell: function (u) { return h('button', { type: 'button', class: 'btn', onclick: function () { editRec(u.group.latest); } }, '확인·고치기'); } }
        ], q.unmatched)));
    }

    // ── 이력 ──
    function drawHistory() {
      var hist = L.anHistory(db);
      if (!hist.length) return;
      main.appendChild(h('details', { class: 'card' }, h('summary', null, h('strong', null, '이력 ' + hist.length + '건 (등록 · 취소 · ETA 변경)')),
        h('p', { class: 'note' }, '등록 완료·취소·조정 ETA 반영은 누른 시각으로 남고, ETA 변경은 A/N 받은 날로 보여 줍니다.'),
        App.table([
          { label: '시각', cls: 'nowrap', cell: function (e) { return String(e.at).replace('T', ' ').slice(0, 16); } },
          { label: '구분', cell: function (e) { return h('span', { class: 'badge ' + (e.action === 'register' ? 'ok' : e.action === 'eta_change' ? 'warn' : 'muted') }, L.AN_ACTION[e.action] || e.action); } },
          { label: 'B/L', cell: function (e) { return h('span', null, e.bl, e.tms ? h('small', { class: 'muted' }, h('br'), 'TMS ' + e.tms) : null); } },
          { label: 'PO', cell: function (e) { return e.po_no; } },
          { label: '내용', cell: function (e) {
            return e.action === 'eta_change' || e.action === 'eta_confirm' ? 'ETA ' + e.eta_from + ' → ' + e.eta + (e.file ? ' (' + e.file + ')' : '')
              : '등록일 ' + (e.date || '-') + (e.eta ? ' · ETA ' + e.eta : '');
          } }
        ], hist)));
    }

    function tile(k, v, s, danger) { return h('div', { class: 'tile' + (danger ? ' danger' : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), h('div', { class: 's' }, s || '')); }
    function prefix() { return (db._sample ? '예시데이터_' : ''); }
    function exportXlsx() {
      App.writeXlsx(prefix() + '도착통지_AN_' + today + '.xlsx', {
        '항차등록 대기': L.anQueueRows(q.pending, db), '등록 완료': L.anQueueRows(q.done, db),
        'AN 메일': L.anMailRows(db), '이력': L.anHistoryRows(db)
      });
    }
    function exportCsv() {
      var files = [
        { name: '항차등록_대기.csv', text: L.toCsv(L.anQueueRows(q.pending, db)) },
        { name: '항차등록_완료.csv', text: L.toCsv(L.anQueueRows(q.done, db)) },
        { name: 'AN_메일.csv', text: L.toCsv(L.anMailRows(db)) },
        { name: '이력.csv', text: L.toCsv(L.anHistoryRows(db)) }
      ];
      App.download(prefix() + '도착통지_AN_CSV_' + today + '.zip', L.makeZip(files), 'application/zip');
    }
  };
})(window);
