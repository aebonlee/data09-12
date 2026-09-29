/* 화면: 도착 통지(A/N) — 포워더 A/N 메일 읽기 · 항차등록 대기 · ETA 변경 · 이력 (2026-09-29 저녁 요청) */
(function (root) {
  'use strict';
  var L = root.OMLogic, S = root.OMSample, App = root.OM, h = App.h;

  function an() { App.db.an = App.db.an || L.emptyAn(); return App.db.an; }
  function nowIso() { return new Date().toISOString(); }
  function field(key) { return L.AN_FIELDS.filter(function (f) { return f.key === key; })[0]; }

  // 파일 목록 → A/N 기록. .eml 은 PDF 첨부 글도 함께 읽습니다(포워더가 A/N 을 PDF 로 붙이는 경우).
  function readFiles(files) {
    var db = App.db, today = App.today(), skipped = [];
    var jobs = files.map(function (f) {
      if (/\.msg$/i.test(f.name)) { skipped.push(f.name); return Promise.resolve(null); }
      return App.readBuffer(f).then(function (buf) {
        var bytes = new Uint8Array(buf);
        var mail = /\.(eml|mht|mhtml)$/i.test(f.name) || /^[\w\-]+:/.test(new TextDecoder('utf-8').decode(bytes.subarray(0, 200)))
          ? L.parseEml(bytes) : L.anMailFromText(new TextDecoder('utf-8').decode(bytes));
        return withPdfText(mail).then(function (m) { return L.parseArrivalNotice(m, db, { file: f.name, today: today }); });
      });
    });
    return Promise.all(jobs).then(function (recs) {
      if (skipped.length) App.toast('Outlook .msg 는 읽지 못합니다(' + skipped.join(', ') + '). .eml 로 저장하거나 본문을 붙여넣어 주십시오.', true);
      return recs.filter(Boolean);
    });
  }
  function withPdfText(mail) {
    var pdfs = (mail.attachments || []).filter(function (a) { return !a.inline && /\.pdf$/i.test(a.name); });
    if (!pdfs.length || !App.pdfText) return Promise.resolve(mail);
    return Promise.all(pdfs.map(function (a) {
      return App.pdfText(a.bytes).then(function (t) { return '\n[첨부 ' + a.name + ']\n' + t; }, function () { return '\n[첨부 ' + a.name + ' — 글을 읽지 못함]'; });
    })).then(function (texts) { return Object.assign({}, mail, { body: (mail.body || '') + texts.join('\n') }); });
  }
  function addRecs(recs) {
    var r = L.anAddMails(App.db, recs);
    var n = L.anSyncToPos(App.db);
    App.save(); App.render();
    App.toast('A/N ' + r.added + '통 추가' + (r.skipped ? ' · 이미 있는 메일 ' + r.skipped + '통 건너뜀' : '') + (n ? ' · 대장 ' + n + '건에 A/N·B/L·ETA 반영' : ''));
  }

  // 예시: A/N 예시와 짝이 되는 업체·PO 가 대장에 없으면 넣습니다.
  function ensureAnSample() {
    var db = App.db, today = App.today();
    var need = ['EX4500010002', 'EX4500010003', 'EX4500010005'];
    var codes = ['EX-A01', 'EX-B02', 'EX-C03'];
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
    main.appendChild(h('p', null, '포워더가 보내는 A/N(Arrival Notice) 메일을 올리면 B/L 번호·선명/항차·ETD/ETA·항구·컨테이너·포장·중량·PO 번호를 읽어 대장의 PO에 붙입니다(PO 번호 또는 대장의 B/L 번호로). B/L과 A/N이 있는데 아직 항차등록을 하지 않은 PO를 「항차등록 대기」로 모아 보여 주고, 등록을 마치면 날짜와 함께 「등록 완료」로 표시합니다. 같은 B/L의 새 A/N에서 ETA가 바뀌면 이전 → 이후로 알려 드립니다.'));

    // ── 올리기: 끌어 놓기 · 파일 선택 · 붙여넣기 ──
    var fileIn = h('input', { type: 'file', accept: '.eml,.txt,.msg,message/rfc822,text/plain', multiple: true, style: 'display:none' });
    fileIn.addEventListener('change', function () { var fs = Array.prototype.slice.call(fileIn.files); fileIn.value = ''; readFiles(fs).then(addRecs); });
    var drop = h('div', { class: 'drop-zone', tabindex: '0', role: 'button', 'aria-label': 'A/N 메일 파일을 여기에 끌어 놓거나 눌러서 고르기',
      onclick: function () { fileIn.click(); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } },
      h('strong', null, 'A/N 메일(.eml)을 여기에 끌어 놓으십시오'), h('span', { class: 'muted' }, '여러 통을 한 번에 놓아도 됩니다 · 눌러서 고를 수도 있습니다'));
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) {
      var fs = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (fs.length) readFiles(fs).then(addRecs);
      else App.toast('파일이 아닙니다. Outlook 메일은 「다른 이름으로 저장」(.eml) 후 놓거나, 본문을 아래 칸에 붙여넣어 주십시오.', true);
    });
    var paste = h('textarea', { rows: 5, placeholder: 'A/N 메일 본문(또는 메일 원문 전체)을 붙여넣어 주십시오' });
    var dayFirst = h('input', { type: 'checkbox', checked: !!st.anDayFirst, onchange: function (e) { st.anDayFirst = e.target.checked; } });
    main.appendChild(h('div', { class: 'card' }, h('h2', null, 'A/N 메일 올리기'), drop,
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('label', { class: 'btn btn-primary' }, '.eml 파일 선택(여러 개)', fileIn),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          ensureAnSample();
          var recs = S.anMails(today).map(function (m) { return L.parseArrivalNotice(L.parseEml(L.utf8(m.text)), App.db, { file: m.name, today: today }); });
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
            var rec = L.parseArrivalNotice(mail, db, { file: '붙여넣기 ' + today, today: today, dayFirst: st.anDayFirst });
            addRecs([rec]);
          } }, '붙여넣은 글 읽기'),
          h('label', { class: 'check' }, dayFirst, '12/10/2026 같은 날짜를 일/월/연도 순서로 읽기'))),
      h('p', { class: 'note' }, 'Outlook 데스크톱에서 끌어 놓으면 .msg가 되는 경우가 있습니다. 이 도구는 .eml·글(.txt)과 붙여넣은 본문을 읽고, .eml에 PDF 첨부가 있으면 그 글도 함께 읽습니다. 받은 날은 메일의 보낸 시각(이 PC 시간대 기준), 붙여넣은 글은 오늘입니다.')));

    var groups = q.groups;
    if (!groups.length && !q.rows.length) {
      main.appendChild(h('div', { class: 'alert info' }, '아직 읽은 A/N이 없습니다. 「예시 A/N으로 해 보기」로 먼저 둘러보십시오(가상의 포워더 3곳 양식, 같은 B/L의 ETA 변경 1건 포함).'));
      return;
    }
    var laterReg = q.done.filter(function (r) { return r.etaAfterReg; });
    main.appendChild(h('div', { class: 'tiles' },
      tile('A/N 메일', (an().mails.length) + '통', 'B/L ' + groups.filter(function (g) { return g.bl; }).length + '건'),
      tile('항차등록 대기', q.pending.length + '건', 'B/L·A/N 있음, 등록 전', q.pending.length > 0),
      tile('등록 완료', q.done.length + '건', laterReg.length ? '등록 후 ETA 변경 ' + laterReg.length + '건' : '', laterReg.length > 0),
      tile('ETA 변경', q.etaChanged.length + '건', '같은 B/L의 새 A/N', q.etaChanged.length > 0),
      tile('대장에 없는 A/N', q.unmatched.length + '건', 'PO·B/L을 못 찾음', q.unmatched.length > 0)));

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
        h('p', { class: 'note' }, 'B/L 번호가 있고 A/N을 받았는데 아직 「등록 완료」로 표시하지 않은 PO입니다. ETA가 빠른 순서입니다. SRM 항차 입력을 마친 건을 골라 등록일과 함께 표시해 주십시오. 대장에서 「A/N 수신」과 B/L 번호를 손으로 적은 PO도 여기에 나옵니다.'));
      card.appendChild(App.table([
        { label: '', cell: function (r) { return h('input', { type: 'checkbox', 'aria-label': r.po_no + ' 고르기', checked: !!pick[r.key], onchange: function (e) { pick[r.key] = e.target.checked; } }); } },
        { label: 'PO', cell: function (r) { return h('span', null, h('strong', null, r.po_no), h('br'), h('small', { class: 'muted' }, App.supplierName(r.supplier_code))); } },
        { label: 'B/L', cell: function (r) { return h('span', null, r.bl, h('br'), h('small', { class: 'muted' }, '연결: ' + r.via)); } },
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
          if (!rows.length) { App.toast('등록 완료로 표시할 PO를 골라 주십시오.', true); return; }
          if (!dateIn.value) { App.toast('항차등록일을 넣어 주십시오.', true); return; }
          L.anRegister(App.db, rows, dateIn.value, nowIso());
          rows.forEach(function (r) { delete pick[r.key]; });
          App.save(); App.render(); App.toast(rows.length + '건을 항차등록 완료(' + dateIn.value + ')로 표시했습니다.');
        } }, '고른 건 등록 완료')));
      main.appendChild(card);
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
        { label: 'PO', cell: function (r) { return h('span', null, h('strong', null, r.po_no), h('br'), h('small', { class: 'muted' }, App.supplierName(r.supplier_code))); } },
        { label: 'B/L', cell: function (r) { return r.bl; } },
        { label: '항차등록일', cls: 'nowrap', cell: function (r) { return r.reg.date; } },
        { label: '등록 때 ETA', cls: 'nowrap', cell: function (r) { return r.reg.eta; } },
        { label: '지금 ETA', cls: 'nowrap', cell: function (r) { return r.etaAfterReg ? h('span', { class: 'badge danger' }, '등록 후 변경 ' + r.etaAfterReg.from + ' → ' + r.etaAfterReg.to) : (r.eta || ''); } },
        { label: '', cell: function (r) {
          return h('div', { class: 'btn-row' },
            r.etaAfterReg ? h('button', { type: 'button', class: 'btn', onclick: function () { L.anConfirmEta(App.db, r, nowIso()); App.save(); App.render(); } }, '조정 ETA 반영함') : null,
            h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { L.anUnregister(App.db, r, nowIso()); App.save(); App.render(); App.toast(r.po_no + ' 등록 완료를 취소했습니다(이력에 남음).'); } }, '등록 취소'));
        } }
      ], q.done, function (r) { return r.etaAfterReg ? { class: 'row-bad' } : null; }));
      main.appendChild(box);
    }

    // ── 읽은 A/N 메일 ──
    function drawMails() {
      var recs = an().mails.slice().sort(function (a, b) { return String(b.receivedAt || b.received).localeCompare(String(a.receivedAt || a.received)); });
      var card = h('div', { class: 'card' }, h('h2', null, '읽은 A/N 메일 ' + recs.length + '통'),
        h('p', { class: 'note' }, '칸마다 어느 글에서 읽었는지 「확인·고치기」에서 볼 수 있습니다. 양식이 처음 보는 모양이면 빈칸이 생길 수 있으니 원문과 대조해 채워 주십시오. 고친 값은 표시가 남습니다.'));
      card.appendChild(App.table([
        { label: '받은 날', cls: 'nowrap', cell: function (r) { return r.received; } },
        { label: '포워더 · 제목', cls: 'clip', cell: function (r) { return h('span', null, h('strong', null, r.fields.forwarder || '-'), h('br'), h('small', { class: 'muted' }, r.subject || r.file)); } },
        { label: 'B/L', cell: function (r) { return r.fields.bl || h('span', { class: 'badge danger' }, 'B/L 못 읽음'); } },
        { label: '선명 / 항차', cell: function (r) { return r.fields.vessel ? r.fields.vessel + (r.fields.voyage ? ' / ' + r.fields.voyage : '') : ''; } },
        { label: 'ETA', cls: 'nowrap', cell: function (r) { return r.fields.eta; } },
        { label: '대장 PO', cell: function (r) { return poCell(r); } },
        { label: '확인', cell: function (r) {
          var fixed = L.AN_FIELDS.filter(function (f) { return r.parsed && r.fields[f.key] !== r.parsed[f.key]; }).length;
          var empty = ['bl', 'eta', 'vessel'].filter(function (k) { return !r.fields[k]; }).length;
          return h('span', null, fixed ? h('span', { class: 'badge ok' }, fixed + '칸 고침') : null, empty ? h('span', { class: 'badge warn' }, '빈칸 ' + empty) : null,
            r.notes && r.notes.length ? h('span', { class: 'badge warn' }, '날짜 순서 확인') : null);
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
        if (f.key === 'pos') note += ' · 여러 개는 쉼표로';
        return App.field(f.label, inp, note);
      });
      var content = h('div', null,
        h('p', { class: 'note' }, (r.from ? '보낸 사람 ' + r.from + ' · ' : '') + '받은 날 ' + (r.received || '-') + (r.file ? ' · ' + r.file : '')),
        r.notes && r.notes.length ? h('div', { class: 'alert warn' }, r.notes.join(' / ')) : null,
        h('div', { class: 'form-grid' }, rows),
        h('details', { style: 'margin-top:12px' }, h('summary', null, '메일 원문 보기'), h('pre', { class: 'an-raw' }, (r.subject ? '제목: ' + r.subject + '\n\n' : '') + (r.text || ''))));
      App.dialog('A/N 확인·고치기', content, [
        { label: '이 A/N 삭제', danger: true, onClick: function () { an().mails = an().mails.filter(function (x) { return x !== r; }); App.save(); App.render(); } },
        { label: '취소' },
        { label: '저장', primary: true, onClick: function () {
          L.AN_FIELDS.forEach(function (f) { r.fields[f.key] = inputs[f.key].value.trim(); });
          if (r.fields.pos) r.fields.pos = L.anPoList(r.fields.pos).join(', ');
          var n = L.anSyncToPos(App.db);
          App.save(); App.render(); App.toast('저장했습니다.' + (n ? ' 대장 ' + n + '건에 반영.' : ''));
        } }
      ]);
    }

    // ── 대장에 없는 A/N ──
    function drawUnmatched() {
      if (!q.unmatched.length) return;
      main.appendChild(h('div', { class: 'card' }, h('h2', null, '대장 PO에 붙지 않은 A/N ' + q.unmatched.length + '건'),
        h('p', { class: 'note' }, 'A/N의 PO 번호가 대장에 없고, 대장에 같은 B/L 번호를 적은 PO도 없습니다. A/N의 PO 번호를 고치거나(「확인·고치기」) 관리 대장의 해당 PO에 B/L 번호를 넣으면 대기 목록으로 옮겨집니다.'),
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
          { label: 'PO', cell: function (e) { return e.po_no; } },
          { label: 'B/L', cell: function (e) { return e.bl; } },
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
