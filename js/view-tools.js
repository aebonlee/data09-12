/* 화면: 메일 분류 · Promise Date 변경 · Packing List–B/L 중량 대조 */
(function (root) {
  'use strict';
  var L = root.OMLogic, S = root.OMSample, App = root.OM, h = App.h;

  /* ── 메일 분류 · OC 회신 확인 ─────────────────────────────── */
  // OC 엑셀(첨부 또는 직접 올린 파일) → { name, oc }
  function readOcBytes(name, bytes) {
    if (!root.XLSX) throw new Error('엑셀 라이브러리를 불러오지 못했습니다');
    var wb = XLSX.read(bytes, { type: 'array', cellDates: false });
    var grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true, blankrows: false });
    return { name: name, oc: L.parseOcGrid(grid, name) };
  }
  function b64(bytes) { return L.base64(bytes); }

  App.views.mail = function (main) {
    var db = App.db, today = App.today();
    var mails = App.state.mails = App.state.mails || [];
    var ocDocs = App.state.ocDocs = App.state.ocDocs || [];
    main.appendChild(App.pageHead('업체별 메일 분류 · OC 회신 확인'));
    main.appendChild(h('p', null, 'Outlook에서 저장한 메일 파일(.eml)을 올리면 보낸 사람의 메일 주소(도메인)로 업체를 나누고, 제목·본문·첨부 파일명에 대장의 PO 번호가 있으면 연결합니다. 발신 도메인이 업체 마스터에 없어도 PO 번호가 한 업체 것이면 그 업체로 나눕니다. OC 낱말이나 OC 첨부(파일명에 OC)가 있으면 메일 받은 날을 OC 수령일 후보로 보여 주고, 첨부된 OC 엑셀은 PO 품목과 대조합니다. 반영은 확인한 뒤 버튼으로 합니다.'));
    var fileIn = h('input', { type: 'file', accept: '.eml,message/rfc822', multiple: true, style: 'display:none' });
    fileIn.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileIn.files); fileIn.value = '';
      Promise.all(files.map(function (f) { return App.readBuffer(f).then(function (b) { return { name: f.name, bytes: new Uint8Array(b) }; }); }))
        .then(function (list) { add(list); });
    });
    var ocIn = h('input', { type: 'file', accept: '.xls,.xlsx,.xlsm,.csv', multiple: true, style: 'display:none' });
    ocIn.addEventListener('change', function () {
      var files = Array.prototype.slice.call(ocIn.files); ocIn.value = '';
      Promise.all(files.map(function (f) { return App.readBuffer(f).then(function (b) { return readOcBytes(f.name, new Uint8Array(b)); }); }))
        .then(function (list) { App.state.ocDocs = ocDocs.concat(list); App.render(); })
        .catch(function (e) { App.toast('OC 파일을 읽지 못했습니다: ' + e.message, true); });
    });
    main.appendChild(h('div', { class: 'card' },
      h('div', { class: 'btn-row' },
        h('label', { class: 'btn btn-primary' }, '.eml 파일 선택(여러 개)', fileIn),
        h('label', { class: 'btn' }, 'OC 엑셀만 올리기', ocIn),
        h('button', { type: 'button', class: 'btn', onclick: sample }, '예시 메일로 해 보기'),
        mails.length || ocDocs.length ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { App.state.mails = []; App.state.ocDocs = []; App.render(); } }, '목록 비우기') : null),
      h('p', { class: 'note' }, 'Outlook 데스크톱에서 메일을 끌어 폴더에 놓으면 .msg로 저장되는 경우가 있습니다. 이 도구는 .eml만 읽습니다(새 Outlook·웹 Outlook의 「다운로드」는 .eml). OC 수령일은 메일 받은 날(이 PC 시간대 기준)입니다.')));
    if (!mails.length && !ocDocs.length) return;

    mails.forEach(function (m) { m.cls = L.classifyMail(m.mail, db); });
    if (mails.length) drawMails();
    drawOc();

    function drawMails() {
      var names = [];
      mails.forEach(function (m) { if (names.indexOf(m.cls.supplier_name) < 0) names.push(m.cls.supplier_name); });
      var sel = App.state.mailFilter || '';
      main.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': '업체 거르기' },
        [['', '전체 ' + mails.length]].concat(names.map(function (n) { return [n, n + ' ' + mails.filter(function (m) { return m.cls.supplier_name === n; }).length]; }))
          .map(function (x) { return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(sel === x[0]), onclick: function () { App.state.mailFilter = x[0]; App.render(); } }, x[1]); })));
      var shown = mails.filter(function (m) { return !sel || m.cls.supplier_name === sel; });
      main.appendChild(App.table([
        { label: '받은 날', cls: 'nowrap', cell: function (m) { return m.mail.date; } },
        { label: '보낸 사람', cell: function (m) { return m.mail.from; } },
        { label: '업체', cell: function (m) {
          if (!m.cls.supplier_code) return h('span', { class: 'badge muted' }, '미분류');
          return h('span', null, m.cls.supplier_name, m.cls.supplier_via === 'po' ? h('span', { class: 'badge warn', title: '발신 도메인이 업체 마스터에 없습니다. 업체의 수신·참조에 이 도메인을 넣으면 다음부터 바로 나뉩니다.' }, 'PO 번호로 분류') : null);
        } },
        { label: '제목', cls: 'clip', cell: function (m) { return m.mail.subject; } },
        { label: '첨부', cls: 'clip', cell: function (m) {
          var a = (m.mail.attachments || []).filter(function (x) { return !x.inline; });
          if (!a.length) return '';
          return h('span', null, a.map(function (x) { return h('span', { class: 'badge ' + (L.isOcAttachment(x) ? 'ok' : 'muted') }, x.name); }));
        } },
        { label: 'PO', cell: function (m) {
          return h('span', null, m.cls.pos.join(', '),
            m.cls.mismatch.length ? h('span', { class: 'badge warn' }, '다른 업체 PO: ' + m.cls.mismatch.join(', ')) : null,
            m.cls.unknownPos.length ? h('span', { class: 'badge warn' }, '대장에 없는 PO: ' + m.cls.unknownPos.join(', ')) : null);
        } },
        { label: 'OC 수령일 후보', cell: function (m) {
          if (!m.cls.ocCandidates.length) return '';
          m.pick = m.pick || {};
          return h('div', null, m.cls.ocCandidates.map(function (no) {
            if (m.pick[no] == null) m.pick[no] = true;
            return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: m.pick[no], onchange: function (e) { m.pick[no] = e.target.checked; } }), no + ' → ' + (m.mail.date || today));
          }));
        } }
      ], shown));

      var cand = mails.reduce(function (n, m) { return n + m.cls.ocCandidates.length; }, 0);
      main.appendChild(h('div', { class: 'card', style: 'margin-top:16px' },
        h('p', null, 'OC 수령일 후보 ' + cand + '건. 메일을 받은 날을 OC 수령일로 넣습니다(이미 수령일이 있는 PO는 건드리지 않음).'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', disabled: !cand, onclick: function () {
            var ups = [];
            mails.forEach(function (m) { m.cls.ocCandidates.forEach(function (no) { if (!m.pick || m.pick[no] !== false) ups.push({ po_no: no, date: m.mail.date || today }); }); });
            var r = L.applyOcDates(db.pos, ups); db.pos = r.pos; App.save(); App.render();
            App.toast('OC 수령일 ' + r.applied + '건 반영');
          } }, '선택한 OC 수령일을 대장에 반영'),
          h('button', { type: 'button', class: 'btn', onclick: function () {
            App.download((db._sample ? '예시데이터_' : '') + '업체별_메일_' + today + '.zip', L.makeZip(mails.map(function (m) {
              return { name: L.safeFileName(m.cls.supplier_code ? m.cls.supplier_name : '미분류') + '/' + L.safeFileName(m.name), bytes: m.bytes };
            })), 'application/zip');
          } }, '업체별 폴더로 묶어 내려받기(ZIP)'),
          h('button', { type: 'button', class: 'btn', onclick: function () {
            App.writeXlsx((db._sample ? '예시데이터_' : '') + '메일분류_' + today + '.xlsx', { '메일분류': mails.map(function (m) {
              return { '받은 날': m.mail.date, '보낸 사람': m.mail.from, '업체 코드': m.cls.supplier_code, '업체': m.cls.supplier_name, '분류 근거': m.cls.supplier_via === 'po' ? 'PO 번호' : m.cls.supplier_via === 'email' ? '메일 도메인' : '',
                '제목': m.mail.subject, 'PO': m.cls.pos.join(', '), '대장에 없는 PO': m.cls.unknownPos.join(', '), 'OC 첨부': m.cls.ocFiles.join(', '), 'OC 후보': m.cls.ocCandidates.join(', '), '파일': m.name };
            }) });
          } }, '분류표 엑셀 내보내기'))));
    }

    // OC 엑셀 ↔ 대장 PO 품목 대조
    function drawOc() {
      if (!ocDocs.length) return;
      var box = h('div', { class: 'card', style: 'margin-top:16px' }, h('h2', null, 'OC(Order Confirmation) 대조 — ' + ocDocs.length + '개 파일'),
        h('p', { class: 'note' }, '항차 매뉴얼에 따라 OC의 날짜를 출하 예정일(OC DATE)로 보고, SRM의 EXW DATE에 넣는 값(대장의 약속 EXW DATE)으로 제안합니다. 실물 OC에는 날짜 칸이 따로 없어 파일명 끝 날짜(월-일-연)와 서명란 날짜를 씁니다.'));
      var applies = [];
      ocDocs.forEach(function (d) {
        var oc = d.oc;
        box.appendChild(h('h3', { style: 'margin-top:14px' }, d.name));
        if (oc.warnings.length) box.appendChild(h('div', { class: 'alert warn' }, oc.warnings.join(' / ')));
        if (!oc.pos.length) { box.appendChild(h('p', { class: 'muted' }, 'PO 번호를 찾지 못했습니다.')); return; }
        oc.pos.forEach(function (no) {
          var po = db.pos.filter(function (p) { return p.po_no === no; })[0];
          if (!po) { box.appendChild(h('p', null, h('span', { class: 'badge warn' }, no + ' — 관리 대장에 없는 PO'))); return; }
          var c = L.compareOcToPo(po, oc);
          box.appendChild(h('p', null, h('strong', null, 'PO ' + no), ' · ' + App.supplierName(po.supplier_code) + ' · OC 번호 ' + (oc.oc_no || '-') + ' · OC DATE ' + (c.oc_date || '-') +
            ' · 지금 약속 EXW ' + (po.exw_promised || '(비어 있음)') + ' ', !(po.lines && po.lines.length) ? h('span', { class: 'badge muted' }, 'PO 품목 없음 — 대조 못 함') : c.issues ? h('span', { class: 'badge danger' }, '확인 ' + c.issues + '건') : h('span', { class: 'badge ok' }, 'PO와 일치')));
          box.appendChild(App.table([
            { label: '품번', cell: function (r) { return h('span', null, r.part, r.sup_part ? h('br') : null, r.sup_part ? h('small', { class: 'muted' }, '공급사 ' + r.sup_part) : null); } },
            { label: '수량 PO / OC', cell: function (r) { return fmt(r.po_qty) + ' / ' + fmt(r.oc_qty); } },
            { label: '단가 PO / OC', cell: function (r) { return fmt(r.po_price) + ' / ' + fmt(r.oc_price); } },
            { label: 'PO 납기 / OC DATE', cls: 'nowrap', cell: function (r) { return (r.po_delivery || '-') + ' / ' + (r.oc_date || '-'); } },
            { label: '판정', cell: function (r) { return r.notes.map(function (n) { return h('span', { class: 'badge ' + n.level }, n.text); }); } }
          ], c.rows));
          applies.push({ po: po, oc_no: oc.oc_no, date: c.oc_date, lines: oc.lines.filter(function (l) { return !l.po || l.po === no; }).map(function (l) { return { part: l.cust_part || l.sup_part, sup_part: l.sup_part, qty: l.qty }; }) });
        });
      });
      var over = h('input', { type: 'checkbox' });
      box.appendChild(h('label', { class: 'check' }, over, '이미 약속 EXW DATE가 있어도 OC DATE로 바꾸기'));
      box.appendChild(h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: !applies.length, onclick: function () {
          var n = 0;
          applies.forEach(function (a) {
            var changed = false;
            if (a.oc_no && !a.po.oc_no) { a.po.oc_no = a.oc_no; changed = true; }
            if (a.lines && a.lines.length) { a.po.oc_lines = a.lines; changed = true; }   // Cummins 수량 대조에 씀
            if (a.date && (!a.po.exw_promised || over.checked) && a.po.exw_promised !== a.date) { a.po.exw_promised = a.date; changed = true; }
            if (changed) n++;
          });
          App.save(); App.render(); App.toast('OC 번호·OC DATE ' + n + '건 반영');
        } }, 'OC 번호·OC DATE를 대장에 반영'),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          var rows = [];
          ocDocs.forEach(function (d) { d.oc.pos.forEach(function (no) {
            var po = db.pos.filter(function (p) { return p.po_no === no; })[0]; if (!po) return;
            L.compareOcToPo(po, d.oc).rows.forEach(function (r) { rows.push({ 'OC 파일': d.name, 'PO': no, 'OC 번호': d.oc.oc_no, '품번': r.part, '공급사 품번': r.sup_part, 'PO 수량': r.po_qty, 'OC 수량': r.oc_qty, 'PO 단가': r.po_price, 'OC 단가': r.oc_price, 'PO 납기': r.po_delivery, 'OC DATE': r.oc_date, '판정': r.notes.map(function (x) { return x.text; }).join('; ') }); });
          }); });
          App.writeXlsx((db._sample ? '예시데이터_' : '') + 'OC대조_' + today + '.xlsx', { 'OC대조': rows });
        } }, '대조 결과 엑셀 내보내기')));
      main.appendChild(box);
    }
    function fmt(v) { return v == null || v === '' ? '-' : String(v); }

    function add(list) {
      var docs = [];
      var parsed = list.map(function (x) {
        var mail = L.parseEml(x.bytes);
        mail.attachments.filter(L.isOcAttachment).forEach(function (a) {
          if (!/\.(xlsx?|xlsm|csv)$/i.test(a.name)) return;
          try { docs.push(readOcBytes(a.name, a.bytes)); } catch (e) { App.toast(a.name + ' 을(를) 읽지 못했습니다: ' + e.message, true); }
        });
        return { name: x.name, bytes: x.bytes, mail: mail };
      });
      App.state.mails = mails.concat(parsed);
      App.state.ocDocs = ocDocs.concat(docs);
      App.render();
    }
    function sample() {
      var list = S.mails(today).map(function (m) { return { name: m.name, bytes: L.utf8(m.text) }; });
      // 실물 구조의 OC 회신 메일: OC 엑셀 2개를 만들어 첨부. 짝이 되는 PO 가 대장에 없으면 먼저 넣습니다.
      if (root.XLSX) {
        var atts = S.ocFiles.map(function (f) {
          var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(S.ocGrid(f.po)), 'Sheet1');
          return { name: f.name, b64: b64(new Uint8Array(XLSX.write(wb, { bookType: 'biff8', type: 'array' }))) };
        });
        list.push({ name: '예시데이터_메일5_Echo_OC회신.eml', bytes: L.utf8(S.replyEml(today, atts)) });
        ensureEcho();
      }
      add(list);
    }
  };

  // 예시: Echo 업체와 두 PO(송부 완료, OC 대기)를 대장에 없으면 넣습니다.
  function ensureEcho() {
    var db = App.db, today = App.today();
    if (!L.supplierByCode(db.suppliers, 'EX-E05')) {
      var m = L.guessMapping(Object.keys(S.echoSupplier), 'supplier');
      db.suppliers = L.mergeSuppliers(db.suppliers, L.importSuppliers(L.applyMapping([S.echoSupplier], m)).suppliers);
    }
    db.pos = L.upsertPos(db.pos, S.realLedger(today).filter(function (p) { return !db.pos.some(function (x) { return x.po_no === p.po_no; }); }).map(function (p) { return L.cleanPo(p, db.suppliers); })).pos;
    db._sample = true;
    App.save();
  }
  App.ensureEcho = ensureEcho;

  /* ── Promise Date 변경 ─────────────────────────────── */
  var DIR_BADGE = { later: 'danger', earlier: 'ok', cancel: 'danger', check: 'warn', same: 'muted' };
  var SHOW_MAX = 300;
  App.views.promise = function (main) {
    var db = App.db, st = App.state;
    main.appendChild(App.pageHead('Weekly Order Status — Promise Date 변경 확인'));
    main.appendChild(h('p', null, 'Cummins Integrated Order Status 같은 주간 오더 현황 엑셀 두 주차를 올리면, 같은 오더 줄을 맞춰 Promise Date가 밀린 건·당겨진 건·취소된 건, 새로 생긴 줄, 빠진 줄을 보여 줍니다.'));
    main.appendChild(h('div', { class: 'alert info' },
      '실제 파일은 한 파일 안에 주차별 시트(wk38 등)가 여러 개입니다. 같은 파일을 ①·②에 각각 올리고 시트만 다르게 고르면 됩니다. ',
      '같은 Customer PO·Part No. 가 여러 줄(분할 출고)이라 1OM#·SO# 까지 맞추고, 그래도 겹치면 나온 순서로 맞춥니다. ',
      'Promise Date 칸의 「cancelled」 「2/29/2024=>2/1」 같은 글도 읽습니다. 파일이 한 주차뿐이면 칸 안과 Remarks의 변경 기록(9/12->10/25 등)을 모아 보여 줍니다.'));
    var dayFirst = h('input', { type: 'checkbox', checked: !!st.wDayFirst, onchange: function (e) { st.wDayFirst = e.target.checked; App.render(); } });
    main.appendChild(h('label', { class: 'check' }, dayFirst, '날짜가 「일/월/연」 순서입니다(예: 05/10/2026 = 10월 5일). 실물 파일은 월/일 순서입니다.'));
    function sampleOf(rows, label) { return { label: label, name: '예시데이터_Weekly_Order_Status_' + label.replace(/\s/g, ''), headers: S.WOS_HEAD, rows: rows }; }
    main.appendChild(h('div', { class: 'grid-2' },
      h('div', null, st.wOld ? h('p', { class: 'alert info' }, '이전 주차: ' + st.wOld.name + ' · ' + st.wOld.rows.length + '행') : null,
        App.mappingPanel({ kind: 'weekly', title: '① 이전 주차(시트)', applyLabel: '이전 주차로 사용', sample: sampleOf(S.weeklyWk37, '예시 wk37'),
          onApply: function (rows, info) { st.wOld = { name: info.name + (info.sheet ? ' / ' + info.sheet : ''), rows: rows }; App.render(); } })),
      h('div', null, st.wNew ? h('p', { class: 'alert info' }, '이번 주차: ' + st.wNew.name + ' · ' + st.wNew.rows.length + '행') : null,
        App.mappingPanel({ kind: 'weekly', title: '② 이번 주차(시트)', applyLabel: '이번 주차로 사용', sample: sampleOf(S.weeklyWk38, '예시 wk38'),
          onApply: function (rows, info) { st.wNew = { name: info.name + (info.sheet ? ' / ' + info.sheet : ''), rows: rows }; App.render(); } }))));
    if (!st.wOld && !st.wNew) return;
    var isSample = ((st.wNew || st.wOld).name.indexOf('예시') === 0);
    function inLedger(po) { return db.pos.some(function (p) { return p.po_no === po; }) ? '등록' : ''; }
    function tile(k, v, danger) { return h('div', { class: 'tile' + (danger ? ' danger' : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }
    function capped(rows) { return rows.length > SHOW_MAX ? rows.slice(0, SHOW_MAX) : rows; }
    function capNote(rows) { return rows.length > SHOW_MAX ? h('p', { class: 'note' }, '앞 ' + SHOW_MAX + '건만 보입니다. 전체는 엑셀로 내보내 주십시오.') : null; }

    // 한 주차 파일 안의 변경 기록
    var one = st.wNew || st.wOld;
    var notes = L.weeklyInFileChanges(one.rows, st.wDayFirst);
    var noteCols = [
      { label: 'Customer PO', cell: function (c) { return c.po; } }, { label: 'Part No.', cell: function (c) { return c.part; } }, { label: 'SO#', cell: function (c) { return c.so; } },
      { label: '기록 위치', cell: function (c) { return c.source; } }, { label: '이전', cls: 'nowrap', cell: function (c) { return c.old; } }, { label: '변경', cls: 'nowrap', cell: function (c) { return c.new; } },
      { label: '차이', cell: function (c) { return c.diffDays == null ? '' : c.diffDays > 0 ? h('span', { class: 'badge danger' }, c.diffDays + '일 밀림') : c.diffDays < 0 ? h('span', { class: 'badge ok' }, (-c.diffDays) + '일 당김') : '같음'; } },
      { label: '원문', cls: 'clip', cell: function (c) { return c.note; } }
    ];
    var noteBox = h('details', { class: 'card', open: !(st.wOld && st.wNew) ? true : null },
      h('summary', null, h('strong', null, '파일 안에 적힌 변경 기록 — ' + one.name + ' · ' + notes.length + '건')),
      h('p', { class: 'note' }, 'Promise Date 칸의 「이전=>변경」과 Remarks의 「날짜->날짜」를 모았습니다. 연도가 없는 날짜는 그 줄의 Promise Date(없으면 Req Date)에 가까운 해로 봅니다.'),
      App.table(noteCols, capped(notes)), capNote(notes));
    if (!(st.wOld && st.wNew)) {
      main.appendChild(noteBox);
      main.appendChild(h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: function () {
        App.writeXlsx((isSample ? '예시데이터_' : '') + 'PromiseDate_기록_' + App.today() + '.xlsx', { '파일 안 기록': notes.map(noteRow) });
      } }, '변경 기록 엑셀 내보내기')));
      return;
    }

    var r = L.compareWeekly(st.wOld.rows, st.wNew.rows, st.wDayFirst);
    var cnt = { later: 0, earlier: 0, cancel: 0, check: 0 };
    r.changed.forEach(function (c) { cnt[c.dir] = (cnt[c.dir] || 0) + 1; });
    var flt = st.wDir || '';
    var shown = r.changed.filter(function (c) { return !flt || c.dir === flt; });
    var out = h('div', { class: 'card' }, h('h2', null, '비교 결과'),
      h('div', { class: 'tiles' },
        tile('밀림', cnt.later + '건', cnt.later > 0), tile('당김', cnt.earlier + '건'), tile('취소', cnt.cancel + '건', cnt.cancel > 0),
        tile('날짜 확인', cnt.check + '건'), tile('새로 생긴 줄', r.added.length + '건'), tile('빠진 줄', r.removed.length + '건'), tile('변경 없음', r.same + '건')),
      r.duplicates.length ? h('p', { class: 'note' }, r.duplicates.join(' ')) : null,
      h('div', { class: 'chips', role: 'group', 'aria-label': '변경 거르기' }, [['', '전체 ' + r.changed.length], ['later', '밀림 ' + cnt.later], ['earlier', '당김 ' + cnt.earlier], ['cancel', '취소 ' + cnt.cancel], ['check', '날짜 확인 ' + cnt.check]].map(function (x) {
        return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(flt === x[0]), onclick: function () { st.wDir = x[0]; App.render(); } }, x[1]);
      })),
      h('h3', null, 'Promise Date가 바뀐 줄'),
      App.table([
        { label: 'Customer PO', cell: function (c) { return c.po; } }, { label: 'Part No.', cell: function (c) { return c.part; } },
        { label: '1OM# · SO#', cell: function (c) { return [c.om, c.so].filter(Boolean).join(' · '); } }, { label: 'QTY', cell: function (c) { return c.qty; } },
        { label: '이전', cls: 'nowrap', cell: function (c) { return c.old; } }, { label: '이번', cls: 'nowrap', cell: function (c) { return c.new; } },
        { label: '구분', cell: function (c) { return h('span', { class: 'badge ' + DIR_BADGE[c.dir] }, L.DIR_LABEL[c.dir] + (c.diffDays ? ' ' + Math.abs(c.diffDays) + '일' : '')); } },
        { label: 'Status', cell: function (c) { return c.status; } }, { label: 'Remarks', cls: 'clip', cell: function (c) { return c.remarks; } },
        { label: '관리 대장', cell: function (c) { return inLedger(c.po); } }
      ], capped(shown)), capNote(shown),
      h('details', { style: 'margin-top:16px' }, h('summary', null, h('strong', null, '새로 생긴 줄 ' + r.added.length + '건')),
        App.table([{ label: 'Customer PO', cell: function (x) { return x.po; } }, { label: 'Part No.', cell: function (x) { return x.part; } }, { label: 'SO#', cell: function (x) { return x.so; } }, { label: 'Promise Date', cell: function (x) { return x.promise || x.raw; } }, { label: 'Status', cell: function (x) { return x.status; } }], capped(r.added)), capNote(r.added)),
      h('details', { style: 'margin-top:8px' }, h('summary', null, h('strong', null, '빠진 줄 ' + r.removed.length + '건 (출고 완료로 목록에서 빠졌는지, 취소인지 확인)')),
        App.table([{ label: 'Customer PO', cell: function (x) { return x.po; } }, { label: 'Part No.', cell: function (x) { return x.part; } }, { label: 'SO#', cell: function (x) { return x.so; } }, { label: '이전 Promise Date', cell: function (x) { return x.promise || x.raw; } }, { label: 'Status', cell: function (x) { return x.status; } }], capped(r.removed)), capNote(r.removed)),
      h('div', { class: 'btn-row', style: 'margin-top:16px' }, h('button', { type: 'button', class: 'btn', onclick: function () {
        function base(x) { return { 'Customer PO': x.po, 'Part No.': x.part, '1OM#': x.om, 'SO#': x.so, 'QTY': x.qty }; }
        App.writeXlsx((isSample ? '예시데이터_' : '') + 'PromiseDate_변경_' + App.today() + '.xlsx', {
          '변경': r.changed.map(function (c) { return Object.assign(base(c), { '이전 Promise Date': c.old, '이번 Promise Date': c.new, '차이(일)': c.diffDays == null ? '' : c.diffDays, '구분': L.DIR_LABEL[c.dir], 'Status': c.status, 'Remarks': c.remarks }); }),
          '신규': r.added.map(function (x) { return Object.assign(base(x), { 'Promise Date': x.promise || x.raw, 'Status': x.status }); }),
          '빠짐': r.removed.map(function (x) { return Object.assign(base(x), { '이전 Promise Date': x.promise || x.raw, 'Status': x.status }); }),
          '파일 안 기록': notes.map(noteRow)
        });
      } }, '결과 엑셀 내보내기')));
    main.appendChild(out);
    main.appendChild(noteBox);
    function noteRow(c) { return { 'Customer PO': c.po, 'Part No.': c.part, 'SO#': c.so, '기록 위치': c.source, '이전': c.old, '변경': c.new, '차이(일)': c.diffDays == null ? '' : c.diffDays, '원문': c.note }; }
  };

  /* ── Packing List ↔ B/L 중량 ─────────────────────────────── */
  App.views.weight = function (main) {
    var db = App.db, st = App.state;
    st.bl = st.bl || {};
    main.appendChild(App.pageHead('Packing List 합중량 · B/L 중량 대조'));
    main.appendChild(h('p', null, 'Packing List의 자재 중량을 합해 B/L에 적힌 중량과 비교합니다. 묶음 기준 열(Invoice·B/L 번호 등)을 연결하면 묶음마다 따로 합칩니다. 「TOTAL」「합계」로 시작하는 행은 빼고 셉니다. 항차 입력 때 Bill of Lading 화면의 Total Net/Gross Weight를 넣기 전에 여기서 맞는지 확인하십시오.'));
    main.appendChild(h('div', { class: 'alert info' }, 'Packing List·B/L 실물은 아직 받지 못했습니다(엑셀인지 PDF인지, kg인지 lb인지, 순중량·총중량 중 무엇을 비교하는지 확인 중). 그래서 엑셀 파일, 또는 표를 복사해 붙여넣는 두 가지로 받고, 단위를 고를 수 있게 했습니다.'));
    var perUnit = h('input', { type: 'checkbox', checked: !!st.perUnit, onchange: function (e) { st.perUnit = e.target.checked; App.render(); } });
    function unitSel(key) {
      var sel = h('select', { onchange: function () { st[key] = sel.value; App.render(); } }, h('option', { value: 'kg' }, 'kg'), h('option', { value: 'lb' }, 'lb (파운드)'));
      sel.value = st[key] || 'kg'; return sel;
    }
    main.appendChild(h('div', { class: 'form-grid cols-4' },
      h('label', { class: 'check' }, perUnit, '중량 열이 「개당 중량」입니다(수량을 곱해 합산)'),
      App.field('Packing List 중량 단위', unitSel('plUnit')), App.field('B/L 중량 단위', unitSel('blUnit'), '비교는 kg으로 바꿔서 합니다(1 lb = 0.45359237 kg)')));
    var pasteBox = h('textarea', { rows: 5, placeholder: '예)\nInvoice No\tPart No\tGross Weight\nINV-1\tA-100\t36.5' });
    main.appendChild(h('details', { class: 'card' }, h('summary', null, h('strong', null, '엑셀 파일 없이 — 표 붙여넣기')),
      h('p', { class: 'note' }, 'Packing List(엑셀·PDF)에서 표를 복사해 붙여넣으십시오. 첫 줄이 열 이름이면 그대로 쓰고, 열 이름이 없으면 「열1·열2…」로 둡니다. 중량 열 이름에 weight·중량이 들어 있으면 자동으로 찾습니다.'),
      pasteBox,
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        var t = L.parseTsv(pasteBox.value);
        if (!t.rows.length) { App.toast('붙여넣은 표가 없습니다.', true); return; }
        var m = L.guessMapping(t.headers, 'packing');
        if (!m.weight) { var last = t.headers[t.headers.length - 1]; m.weight = last; }
        if (!m.part && t.headers.length > 1) m.part = t.headers[0] === m.weight ? t.headers[1] : t.headers[0];
        st.pl = { name: '붙여넣은 표', rows: L.applyMapping(t.rows, m) };
        App.render(); App.toast('중량 열: ' + m.weight + (m.group ? ' · 묶음 열: ' + m.group : ''));
      } }, '붙여넣은 표로 계산'))));
    main.appendChild(App.mappingPanel({
      kind: 'packing', title: 'Packing List 엑셀', applyLabel: '합중량 계산',
      sample: { label: '예시 Packing List로 해 보기', name: '예시데이터_PackingList', headers: Object.keys(S.packingRows[0]), rows: S.packingRows },
      onApply: function (rows, info) {
        st.pl = { name: info.name, rows: rows };
        if (info.isSample) Object.keys(S.blWeights).forEach(function (k) { st.bl[k] = String(S.blWeights[k]); });
        App.render();
      }
    }));
    if (!st.pl) return;
    var tot = L.packingTotals(st.pl.rows, st.perUnit);
    var plF = st.plUnit === 'lb' ? L.LB_TO_KG : 1, blF = st.blUnit === 'lb' ? L.LB_TO_KG : 1;
    function plKg(g) { return Math.round(g.total * plF * 1000) / 1000; }
    function blKg(g) { var n = L.toNumber(st.bl[g.group]); return n == null ? '' : Math.round(n * blF * 1000) / 1000; }
    function cmp(g) { return L.compareWeight(plKg(g), blKg(g), db.settings); }
    var allowNote = '허용 오차: ' + db.settings.weight_tol_kg + 'kg 또는 ' + db.settings.weight_tol_pct + '% 중 큰 쪽(「설정」에서 변경) · 비교 단위 kg';
    var box = h('div', { class: 'card' }, h('h2', null, '대조 결과 — ' + st.pl.name), h('p', { class: 'note' }, allowNote),
      tot.skippedRows.length ? h('p', { class: 'note' }, '계산에서 뺀 행(합계 행·중량 없음): 엑셀 ' + tot.skippedRows.join(', ') + '행') : null);
    var tableBox = h('div'); box.appendChild(tableBox);
    function draw() {
      tableBox.innerHTML = '';
      tableBox.appendChild(App.table([
        { label: '묶음', cell: function (g) { return g.group; } },
        { label: '행 수', cell: function (g) { return g.rows; } },
        { label: 'Packing List 합중량', cell: function (g) { return fmt(g.total) + ' ' + (st.plUnit || 'kg') + (plF !== 1 ? ' (' + fmt(plKg(g)) + ' kg)' : ''); } },
        { label: 'B/L 중량(' + (st.blUnit || 'kg') + ')', cell: function (g) {
          return h('input', { class: 'cell', type: 'text', inputmode: 'decimal', value: st.bl[g.group] || '', 'aria-label': g.group + ' B/L 중량',
            onchange: function (e) { st.bl[g.group] = e.target.value; draw(); } });
        } },
        { label: '차이(PL − B/L, kg)', cell: function (g) { var c = cmp(g); return c.diff == null ? '' : fmt(c.diff) + (c.diffPct == null ? '' : ' (' + c.diffPct.toFixed(2) + '%)'); } },
        { label: '판정', cell: function (g) {
          var c = cmp(g);
          return c.status === 'none' ? h('span', { class: 'badge muted' }, 'B/L 중량 입력') : c.status === 'ok' ? h('span', { class: 'badge ok' }, '일치') : h('span', { class: 'badge danger' }, '불일치');
        } }
      ], tot.groups));
    }
    draw();
    box.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn', onclick: function () {
      App.writeXlsx((st.pl.name.indexOf('예시') === 0 ? '예시데이터_' : '') + '중량대조_' + App.today() + '.xlsx', { '중량대조': tot.groups.map(function (g) {
        var c = cmp(g);
        return { '묶음': g.group, '행 수': g.rows, 'PL 합중량': g.total, 'PL 단위': st.plUnit || 'kg', 'B/L 중량': L.toNumber(st.bl[g.group]) == null ? '' : L.toNumber(st.bl[g.group]), 'B/L 단위': st.blUnit || 'kg',
          'PL(kg)': plKg(g), 'B/L(kg)': blKg(g), '차이(kg)': c.diff == null ? '' : c.diff, '판정': c.status === 'ok' ? '일치' : c.status === 'mismatch' ? '불일치' : '' };
      }) });
    } }, '결과 엑셀 내보내기')));
    main.appendChild(box);
    function fmt(n) { return (Math.round(n * 1000) / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 3 }); }
  };
})(window);
/* 화면: Cummins 오더 현황(분석 시트) → 관리 대장 EXW DATE — 2026-09-29 메일 추가 요청 2 */
(function (root) {
  'use strict';
  var L = root.OMLogic, S = root.OMSample, App = root.OM, h = App.h;

  // 시트 → { grid(1행부터, 빈 행 포함), yellow{엑셀 행: true} }. 노란 채우기는 cellStyles 로 읽은 셀 채우기 색(FFFF00)
  function sheetGrid(ws) {
    var rg = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    var grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true, range: { s: { r: 0, c: rg.s.c }, e: rg.e } });
    var yellow = {}, n = 0;
    for (var r = rg.s.r; r <= rg.e.r; r++) for (var c = rg.s.c; c <= rg.e.c; c++) {
      var x = ws[XLSX.utils.encode_cell({ r: r, c: c })];
      if (x && x.s && x.s.patternType === 'solid' && x.s.fgColor && /FFFF00$/i.test(x.s.fgColor.rgb || '')) { yellow[r + 1] = true; n++; break; }
    }
    return { grid: grid, yellow: yellow, yellowCount: n };
  }
  function pickSheet(names) {
    return names.filter(function (n) { return /분석/.test(n); })[0] || names.filter(function (n) { return /^wk/i.test(n); })[0] || names[0];
  }
  function ensureFox() {
    var db = App.db;
    if (!L.supplierByCode(db.suppliers, 'EX-F06')) {
      var m = L.guessMapping(Object.keys(S.foxSupplier), 'supplier');
      db.suppliers = L.mergeSuppliers(db.suppliers, L.importSuppliers(L.applyMapping([S.foxSupplier], m)).suppliers);
    }
    var inc = S.cumLedger(App.today()).filter(function (p) { return !db.pos.some(function (x) { return x.po_no === p.po_no; }); }).map(function (p) { return L.cleanPo(p, db.suppliers); });
    db.pos = L.upsertPos(db.pos, inc).pos; db._sample = true; App.save();
  }

  App.views.cummins = function (main) {
    // 기본값(수강생 답 09-29): 오늘 기준으로 다시 계산한 Status 가 Undispatched(미선적)인 줄만 — Abnormal·Dispatched 제외, 구분 HCE
    var db = App.db, st = App.state.cum = App.state.cum || { status: 'Undispatched', gubun: 'HCE', recalc: true, asOf: App.today(), pick: {} };
    main.appendChild(App.pageHead('Cummins 오더 현황 → EXW DATE 입력'));
    main.appendChild(h('p', null, 'Cummins Integrated Order Status 파일의 분석 시트(예: 「wk38 분석E」)에서 Status·구분으로 거른 줄의 Promise Date를 관리 대장의 약속 EXW DATE로 넣습니다. Customer PO + Part No. 로 대장과 맞추고, 같은 PO·품번이 여러 날짜로 나뉘어 있으면(분할 선적) 날짜별 수량으로 보여 줍니다.'));
    main.appendChild(h('div', { class: 'alert info' },
      '오늘 기준으로 아직 선적되지 않은 줄(Undispatched)만 봅니다. Abnormal(Promise Date가 지났는데 INV#가 없는 줄)과 Dispatched는 뺍니다. ',
      '수량 확인은 거른 미선적 줄의 수량 합만 대장의 PO 수량(초기 발주)·OC 수량과 비교합니다. 이미 출고된 수량은 참고로만 보여 줍니다. 일치하는 묶음만 처음부터 골라 두고, 부족·초과·수량 모름은 확인한 뒤 직접 골라 반영해 주세요. ',
      '「변경 확인 필요」는 파일의 노란 칠, 또는 지난주 파일과 비교해 Promise Date·수량이 달라진 줄입니다. 지난주 파일을 함께 올리면 칠이 빠진 변경도 잡습니다.'));
    var prevIn = h('input', { type: 'file', accept: '.xlsx,.xlsm,.xls', style: 'display:none' });
    prevIn.addEventListener('change', function () {
      var f = prevIn.files[0]; prevIn.value = ''; if (!f) return;
      App.readBuffer(f).then(function (buf) {
        var wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellStyles: false, cellDates: false });
        st.prevWb = wb; st.prevName = f.name; st.prevSheet = pickSheet(wb.SheetNames); loadPrev(); App.render();
      }).catch(function (e) { App.toast('지난주 파일을 읽지 못했습니다: ' + e.message, true); });
    });
    var fileIn = h('input', { type: 'file', accept: '.xlsx,.xlsm,.xls', style: 'display:none' });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
      App.readBuffer(f).then(function (buf) {
        var wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellStyles: true, cellDates: false });
        st.wb = wb; st.name = f.name; st.sample = false; st.asOf = App.today(); st.sheet = pickSheet(wb.SheetNames); load(); App.render();
      }).catch(function (e) { App.toast('파일을 읽지 못했습니다: ' + e.message, true); });
    });
    main.appendChild(h('div', { class: 'card' }, h('div', { class: 'btn-row' },
      h('label', { class: 'btn btn-primary' }, '이번 주 오더 현황 엑셀 선택', fileIn),
      h('label', { class: 'btn' }, '지난주 파일 선택(비교용)', prevIn),
      h('button', { type: 'button', class: 'btn', onclick: function () {
        ensureFox(); var g = S.cumGrid(), pg = S.cumPrevGrid();
        st.wb = null; st.name = '예시데이터_Integrated_Order_Status_wk38_분석'; st.sample = true; st.sheet = 'wk38 분석(예시)';
        st.grid = g.grid; st.yellow = g.yellow; st.yellowCount = Object.keys(g.yellow).length; st.pick = {}; st.last = null; parse();
        st.prevWb = null; st.prevName = '예시데이터_Integrated_Order_Status_wk37_분석'; st.prevSheet = 'wk37 분석(예시)';
        st.prevRows = L.cumminsRows(pg.grid, {}).rows;
        st.asOf = S.CUM_AS_OF;   // 예시 파일을 저장한 날 기준
        App.render();
      } }, '예시 파일로 해 보기')),
      h('p', { class: 'note' }, '지난주 파일은 선택 사항입니다. 같은 파일 안의 지난주 시트를 쓰려면 같은 파일을 한 번 더 고르고 시트를 바꿔 주세요.')));
    if (!st.rows) return;

    var sheetSel = st.wb ? h('select', { onchange: function () { st.sheet = sheetSel.value; load(); App.render(); } }, st.wb.SheetNames.map(function (n) { return h('option', { value: n }, n); })) : null;
    if (sheetSel) sheetSel.value = st.sheet;
    var stIn = h('input', { type: 'text', value: st.status, list: 'cumStatus' }), gbIn = h('input', { type: 'text', value: st.gubun, list: 'cumGubun' });
    var recalcIn = h('input', { type: 'checkbox', checked: st.recalc !== false && st.hasInv !== false, disabled: st.hasInv === false });
    var asOfIn = h('input', { type: 'date', value: st.asOf || App.today() });
    function uniq(k) { var o = []; st.rows.forEach(function (r) { if (r[k] && o.indexOf(r[k].trim()) < 0) o.push(r[k].trim()); }); return o.slice(0, 20); }
    var supSel = App.supplierSelect(st.supplier || '', {});
    supSel.options[0].textContent = '(자동: 파일과 맞은 PO의 업체)';
    main.appendChild(h('div', { class: 'card' },
      h('p', null, h('strong', null, st.name), ' · 시트 ', h('strong', null, st.sheet), ' · ', st.headerRow + '행 머리글 · 자료 ' + st.rows.length + '줄 · 노란 채우기 줄 ' + st.yellowCount + '개(머리글·합계 줄 포함)'),
      st.error ? h('div', { class: 'alert warn' }, st.error) : null,
      h('div', { class: 'form-grid cols-4' },
        sheetSel ? App.field('시트', sheetSel, '「분석」이 든 시트를 먼저 고릅니다') : null,
        App.field('Status', stIn, '비우면 전체. 대소문자·공백 무시'), App.field('구분', gbIn, '비우면 전체'),
        App.field('「파일에 없는 PO」를 찾을 업체', supSel),
        App.field('Status 기준일', h('span', null, h('span', { class: 'check' }, recalcIn, ' 이 날 기준으로 다시 계산'), asOfIn),
          st.hasInv === false ? 'INV# 열이 없어 파일에 저장된 Status를 씁니다' : '파일의 Status 수식과 같은 규칙(INV# 빔 + Promise Date가 기준일보다 앞 = Abnormal). 손으로 적은 값(x 등)은 그대로')),
      h('datalist', { id: 'cumStatus' }, uniq('status').map(function (v) { return h('option', { value: v }); })),
      h('datalist', { id: 'cumGubun' }, uniq('gubun').map(function (v) { return h('option', { value: v }); })),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        st.status = stIn.value.trim(); st.gubun = gbIn.value.trim(); st.supplier = supSel.value; st.recalc = recalcIn.checked; st.asOf = asOfIn.value || App.today(); st.pick = {}; App.render();
      } }, '거르기 적용')),
      h('p', { class: 'note' }, '실물 파일의 Status는 =IF(INV#가 빔, IF(Promise Date < TODAY(), "Abnormal", "Undispatched"), "Dispatched") 수식입니다. 파일에 저장된 값은 마지막으로 저장한 날 기준이라, 기준일로 같은 규칙을 다시 계산합니다(엑셀에서 오늘 열었을 때와 같은 결과).')));

    var wd = st.prevRows ? L.cumminsWeekDiff(st.prevRows, st.rows) : null;
    var useAsOf = st.recalc !== false && st.hasInv !== false ? (st.asOf || App.today()) : '';
    var plan = L.cumminsExwPlan(st.rows, db.pos, { status: st.status, gubun: st.gubun, supplierCode: st.supplier || '', asOf: useAsOf, weekDiff: wd });
    if (wd) {
      var prevSel = st.prevWb ? h('select', { onchange: function () { st.prevSheet = prevSel.value; loadPrev(); App.render(); } }, st.prevWb.SheetNames.map(function (n) { return h('option', { value: n }, n); })) : null;
      if (prevSel) prevSel.value = st.prevSheet;
      main.appendChild(h('div', { class: 'card' }, h('h2', null, '지난주 파일과 비교'),
        h('p', null, h('strong', null, st.prevName), ' · 시트 ', h('strong', null, st.prevSheet), ' · 지난주 ' + wd.counts.prev + '줄 / 이번 주 ' + wd.counts.cur + '줄 · 같음 ' + wd.counts.same + ' · 달라짐 ' + wd.counts.changed + ' · 새 줄 ' + wd.counts.added + ' · 빠진 줄 ' + wd.counts.removed),
        prevSel ? h('div', { class: 'form-grid cols-4' }, App.field('지난주 시트', prevSel)) : null,
        h('p', { class: 'note' }, '줄 맞추는 키: Customer PO + Part No. + 1OM# + SO#. 분할 선적은 같은 PO·품번이 SO#로 나뉘므로 SO#까지 넣어야 줄이 하나씩 맞습니다. 한 주 사이에 SO#가 새로 붙은 줄은 Customer PO + Part No.의 나온 순서로 한 번 더 맞춥니다. ',
          '비교하는 칸: Promise Date(SRM에 넣는 EXW DATE)와 QTY(그 날짜의 선적 수량). Status는 날짜만 지나도 바뀌는 수식이고 Remarks는 자유 글이라 비교하지 않습니다. 지난주에 없던 줄(분할 추가 등)도 「지난주와 다름」입니다.'),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { st.prevRows = null; st.prevWb = null; App.render(); } }, '지난주 비교 끄기')),
        wd.removed.length ? h('details', null, h('summary', null, '지난주에 있었는데 이번 주 파일에 없는 줄 ' + wd.removed.length + '개'),
          App.table([{ label: 'Customer PO', cell: function (r) { return r.po; } }, { label: 'Part No.', cell: function (r) { return r.part; } }, { label: 'SO#', cell: function (r) { return r.so; } },
            { label: 'QTY', cell: function (r) { return r.qty; } }, { label: 'Promise Date', cell: function (r) { return r.promise || r.promiseRaw; } }, { label: '지난주 Status', cell: function (r) { return r.status; } }], wd.removed.slice(0, 300))) : null));
    }
    plan.groups.forEach(function (g) { if (st.pick[g.key] == null) st.pick[g.key] = g.state === 'match'; });
    var c = plan.counts;
    function tile(k, v, danger) { return h('div', { class: 'tile' + (danger ? ' danger' : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }
    main.appendChild(h('div', { class: 'tiles' },
      tile('거른 줄', c.target + '줄'), tile('PO·품번 묶음', c.groups + '건'), tile('수량 일치', c.match + '건'), tile('확인 필요', c.check + '건', c.check > 0),
      tile('노란 칠', c.yellow + '줄', c.yellow > 0), wd ? tile('지난주와 다름', c.weekChanged + '줄', c.weekChanged > 0) : null,
      tile('변경 확인 필요', c.marked + '줄', c.marked > 0),
      useAsOf ? tile('기준일로 Status 바뀜', c.restatus + '줄') : null,
      tile('대장에 없음', plan.notInLedger.length + '건'), tile('파일에 없음', plan.ledgerMissing.length + '건')));

    
    main.appendChild(h('div', { class: 'card' },
      h('h2', null, '대장에 있는 PO — EXW DATE 입력 후보'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: function () { plan.groups.forEach(function (g) { st.pick[g.key] = g.state === 'match'; }); App.render(); } }, '일치 건만 고르기'),
        h('button', { type: 'button', class: 'btn', onclick: function () { plan.groups.forEach(function (g) { st.pick[g.key] = false; }); App.render(); } }, '모두 풀기')),
      App.table([
        { label: '반영', cell: function (g) { return h('input', { type: 'checkbox', checked: !!st.pick[g.key], 'aria-label': g.po + ' ' + g.part + ' 반영', onchange: function (e) { st.pick[g.key] = e.target.checked; } }); } },
        { label: 'Customer PO · Part No.', cell: function (g) { return h('span', null, h('strong', null, g.po), h('br'), h('small', null, g.part)); } },
        { label: 'Promise Date × 수량', cls: 'nowrap', cell: function (g) {
          return h('span', null, g.schedule.map(function (x, i) {
            return [i ? h('br') : null, x.date + ' × ' + x.qty, x.yellow ? h('span', { class: 'badge warn' }, '노란 칠') : null,
              x.week.length ? h('span', { class: 'badge warn', title: '지난주와 다름' }, '지난주와 다름: ' + x.week.join('; ')) : null];
          }));
        } },
        { label: '미선적 수량 합', cell: function (g) { return h('span', null, String(g.remainQty), g.outsideQty ? h('br') : null, g.outsideQty ? h('small', { class: 'muted' }, '참고: 거른 밖 ' + g.outsideQty) : null); } },
        { label: 'PO / OC 수량', cell: function (g) { return (g.poQty == null ? '-' : g.poQty) + ' / ' + (g.ocQty == null ? '-' : g.ocQty); } },
        { label: '지금 EXW(OC·대장)', cls: 'nowrap', cell: function (g) { return g.before || '(비어 있음)'; } },
        { label: '판정', cell: function (g) {
          return h('span', null,
            g.yellow || g.weekChanged ? h('span', { class: 'badge danger' }, '변경 확인 필요') : null,
            g.changed ? h('span', { class: 'badge warn' }, 'OC·대장 EXW와 다름') : null,
            g.issues.length ? g.issues.map(function (t) { return h('span', { class: 'badge warn' }, t); }) : h('span', { class: 'badge ok' }, '수량 일치'));
        } },
        { label: '파일 행', cell: function (g) { return h('small', { class: 'muted' }, g.rows.map(function (r) { return r.rowNo; }).join(', ')); } }
      ], plan.groups, function (g) { return { class: g.yellow || g.weekChanged ? 'row-bad' : null }; }),
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var now = plan.groups.filter(function (g) { return st.pick[g.key]; });   // 누른 때의 체크 상태
          if (!now.length) { App.toast('고른 묶음이 없습니다.', true); return; }
          var r = L.applyCumminsExw(db.pos, plan.groups, now.map(function (g) { return g.key; }));
          db.pos = r.pos; App.save(); st.last = r.changes; st.pick = {}; App.render();
          App.toast('EXW DATE ' + r.changes.length + '건 반영');
        } }, '고른 묶음을 대장 EXW DATE에 반영'),
        h('button', { type: 'button', class: 'btn', onclick: function () { exportAll(plan); } }, '대조 결과 엑셀 내보내기')),
      h('p', { class: 'note' }, '반영하면 PO의 품번별 출하 일정(분할 건마다 날짜 × 수량)을 저장합니다. 대장 목록의 약속 EXW DATE 칸은 하나라 그 PO의 가장 이른 날짜를 보여 주고, SRM에는 아래 「건별 입력 목록」대로 한 건씩 넣습니다.')));

    // SRM EXW DATE 건별 입력 목록(수강생 답 09-29: 분할 선적은 건별로 입력)
    var entries = L.exwEntries(plan.groups.concat(plan.notInLedger));
    var tsvHead = ['Customer PO', 'Part No.', '분할', 'EXW DATE', 'QTY', '변경 확인'];
    function tsv() { return [tsvHead.join('\t')].concat(entries.map(function (e) { return [e.po, e.part, e.seq, e.date, e.qty, e.yellow || e.week ? 'Y' : ''].join('\t'); })).join('\n'); }
    main.appendChild(h('details', { class: 'card', open: true }, h('summary', null, h('strong', null, 'SRM EXW DATE 건별 입력 목록 ' + entries.length + '건')),
      h('p', { class: 'note' }, '거른 미선적 줄을 PO·품번·날짜별로 한 줄씩 나눴습니다. 분할 선적은 1/2, 2/2처럼 건마다 EXW DATE를 넣어 주세요. 대장에 없는 PO도 들어 있습니다.'),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: function () { App.copy(tsv()); } }, '표 복사(엑셀 붙여넣기용)')),
      App.table([
        { label: 'Customer PO', cell: function (e) { return e.po; } }, { label: 'Part No.', cell: function (e) { return e.part; } },
        { label: '분할', cell: function (e) { return e.seq; } }, { label: 'EXW DATE', cls: 'nowrap', cell: function (e) { return e.date; } },
        { label: 'QTY', cell: function (e) { return e.qty; } },
        { label: '', cell: function (e) { return h('span', null, e.inLedger ? null : h('span', { class: 'badge muted' }, '대장에 없음'), e.yellow || e.week ? h('span', { class: 'badge danger' }, '변경 확인 필요') : null); } }
      ], entries.slice(0, 500))));

    if (st.last && st.last.length) main.appendChild(h('div', { class: 'card' }, h('h2', null, '방금 반영한 것 — 반영 전/후'),
      App.table([
        { label: 'PO', cell: function (x) { return x.po_no; } }, { label: 'Part No.', cell: function (x) { return x.part; } },
        { label: '약속 EXW 전 → 후', cls: 'nowrap', cell: function (x) { return (x.before_exw || '(비어 있음)') + ' → ' + x.after_exw; } },
        { label: '품번 일정 전', cell: function (x) { return x.before; } }, { label: '품번 일정 후', cell: function (x) { return x.after; } },
        { label: '', cell: function (x) { return h('span', null, x.yellow ? h('span', { class: 'badge danger' }, '노란 줄') : null, x.state === 'check' ? h('span', { class: 'badge warn' }, '확인 후 반영') : null); } }
      ], st.last)));

    main.appendChild(h('details', { class: 'card' }, h('summary', null, h('strong', null, '대장에 없는 PO·품번 ' + plan.notInLedger.length + '건')),
      h('p', { class: 'note' }, '파일에는 있지만 관리 대장에 PO가 없습니다. PO 발주 메일 화면이나 대장 가져오기로 먼저 등록하십시오.'),
      App.table([{ label: 'Customer PO', cell: function (g) { return g.po; } }, { label: 'Part No.', cell: function (g) { return g.part; } },
        { label: 'Promise Date × 수량', cell: function (g) { return g.schedule.map(function (x) { return x.date + '×' + x.qty; }).join(', '); } },
        { label: '노란 줄', cell: function (g) { return g.yellow ? '예' : ''; } }], plan.notInLedger.slice(0, 300))));
    main.appendChild(h('details', { class: 'card' }, h('summary', null, h('strong', null, '대장에는 있으나 거른 결과에 없는 PO·품번 ' + plan.ledgerMissing.length + '건')),
      h('p', { class: 'note' }, '같은 업체의 PO 중 실제 출고일이 없는 것입니다. 파일의 다른 Status(Abnormal 등)로 있으면 그 값을 적었습니다.'),
      App.table([{ label: 'PO', cell: function (x) { return x.po_no; } }, { label: 'Part No.', cell: function (x) { return x.part || '(PO 품목 없음)'; } },
        { label: '파일에서의 Status', cell: function (x) { return x.inFileAs || '파일에 없음'; } }], plan.ledgerMissing)));

    function exportAll(plan) {
      function sch(g) { return g.schedule.map(function (x) { return x.date + '×' + x.qty + (x.yellow ? '(노란)' : '') + (x.week.length ? '(지난주: ' + x.week.join('; ') + ')' : ''); }).join(', '); }
      App.writeXlsx((st.sample ? '예시데이터_' : '') + 'Cummins_EXW대조_' + App.today() + '.xlsx', {
        '대장 PO': plan.groups.map(function (g) { return { 'Customer PO': g.po, 'Part No.': g.part, 'Promise Date×수량': sch(g), '미선적 수량 합': g.remainQty, '참고: 거른 밖 수량': g.outsideQty, 'PO 수량': g.poQty == null ? '' : g.poQty, 'OC 수량': g.ocQty == null ? '' : g.ocQty, '지금 EXW': g.before, '판정': g.issues.join('; ') || '수량 일치', '노란 칠': g.yellow ? 'Y' : '', '지난주와 다름': g.weekChanged ? 'Y' : '', 'OC·대장 EXW와 다름': g.changed ? 'Y' : '', '파일 행': g.rows.map(function (r) { return r.rowNo; }).join(',') }; }),
        'SRM 건별 입력': entries.map(function (e) { return { 'Customer PO': e.po, 'Part No.': e.part, '분할': e.seq, 'EXW DATE': e.date, 'QTY': e.qty, '대장': e.inLedger ? '있음' : '없음', '노란 칠': e.yellow ? 'Y' : '', '지난주와 다름': e.week, '파일 행': e.rows }; }),
        '지난주와 다름': wd ? plan.target.filter(function (r) { return r.week; }).map(function (r) { return { 'Customer PO': r.po, 'Part No.': r.part, 'SO#': r.so, '이번 주 행': r.rowNo, '달라진 것': L.weekNoteText(r.week) }; }) : [],
        '대장에 없음': plan.notInLedger.map(function (g) { return { 'Customer PO': g.po, 'Part No.': g.part, 'Promise Date×수량': sch(g), '노란 줄': g.yellow ? 'Y' : '' }; }),
        '파일에 없음': plan.ledgerMissing.map(function (x) { return { 'PO': x.po_no, 'Part No.': x.part, '파일 Status': x.inFileAs }; }),
        '반영 전후': (st.last || []).map(function (x) { return { 'PO': x.po_no, 'Part No.': x.part, '약속 EXW 전': x.before_exw, '약속 EXW 후': x.after_exw, '품번 일정 전': x.before, '품번 일정 후': x.after }; })
      });
    }
    function load() {
      var g = sheetGrid(st.wb.Sheets[st.sheet]);
      st.grid = g.grid; st.yellow = g.yellow; st.yellowCount = g.yellowCount; st.pick = {}; st.last = null; parse();
    }
    function parse() { var r = L.cumminsRows(st.grid, st.yellow); st.rows = r.rows; st.headerRow = r.headerRow; st.error = r.error; st.hasInv = r.hasInv; }
    function loadPrev() {
      var g = sheetGrid(st.prevWb.Sheets[st.prevSheet]);
      var r = L.cumminsRows(g.grid, {});
      if (r.error) { App.toast('지난주 파일: ' + r.error, true); st.prevRows = null; return; }
      st.prevRows = r.rows;
    }
  };
  App.ensureFox = ensureFox;
})(window);
