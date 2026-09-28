/* 화면: 메일 분류 · Promise Date 변경 · Packing List–B/L 중량 대조 */
(function (root) {
  'use strict';
  var L = root.OMLogic, S = root.OMSample, App = root.OM, h = App.h;

  /* ── 메일 분류 ─────────────────────────────── */
  App.views.mail = function (main) {
    var db = App.db, today = App.today();
    var mails = App.state.mails = App.state.mails || [];
    main.appendChild(App.pageHead('업체별 메일 분류'));
    main.appendChild(h('p', null, 'Outlook에서 저장한 메일 파일(.eml)을 올리면 보낸 사람의 메일 주소(도메인)로 업체를 찾아 나누고, 제목·본문에 대장의 PO 번호와 OC 낱말이 함께 있으면 OC 수령일 기재 후보로 보여 줍니다. 반영은 사람이 확인한 뒤 버튼으로 합니다.'));
    var fileIn = h('input', { type: 'file', accept: '.eml,message/rfc822', multiple: true, style: 'display:none' });
    fileIn.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileIn.files); fileIn.value = '';
      Promise.all(files.map(function (f) { return App.readText(f).then(function (t) { return { name: f.name, raw: t }; }); }))
        .then(function (list) { add(list); });
    });
    main.appendChild(h('div', { class: 'card' },
      h('div', { class: 'btn-row' },
        h('label', { class: 'btn btn-primary' }, '.eml 파일 선택(여러 개)', fileIn),
        h('button', { type: 'button', class: 'btn', onclick: function () { add(S.mails(today).map(function (m) { return { name: m.name, raw: m.text }; })); } }, '예시 메일로 해 보기'),
        mails.length ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { App.state.mails = []; App.render(); } }, '목록 비우기') : null),
      h('p', { class: 'note' }, 'Outlook 데스크톱에서 메일을 끌어 폴더에 놓으면 .msg로 저장되는 경우가 있습니다. 1단계는 .eml만 읽습니다(새 Outlook·웹 Outlook의 「다운로드」는 .eml). .msg 지원은 2단계에서 검토합니다.')));
    if (!mails.length) return;

    mails.forEach(function (m) { m.cls = L.classifyMail(m.mail, db); });
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
      { label: '업체', cell: function (m) { return m.cls.supplier_code ? m.cls.supplier_name : h('span', { class: 'badge muted' }, '미분류'); } },
      { label: '제목', cls: 'clip', cell: function (m) { return m.mail.subject; } },
      { label: 'PO', cell: function (m) {
        return h('span', null, m.cls.pos.join(', '), m.cls.mismatch.length ? h('span', { class: 'badge warn' }, '다른 업체 PO: ' + m.cls.mismatch.join(', ')) : null);
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
            return { name: L.safeFileName(m.cls.supplier_code ? m.cls.supplier_name : '미분류') + '/' + L.safeFileName(m.name), text: m.raw };
          })), 'application/zip');
        } }, '업체별 폴더로 묶어 내려받기(ZIP)'),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          App.writeXlsx((db._sample ? '예시데이터_' : '') + '메일분류_' + today + '.xlsx', { '메일분류': mails.map(function (m) {
            return { '받은 날': m.mail.date, '보낸 사람': m.mail.from, '업체 코드': m.cls.supplier_code, '업체': m.cls.supplier_name, '제목': m.mail.subject, 'PO': m.cls.pos.join(', '), 'OC 후보': m.cls.ocCandidates.join(', '), '파일': m.name };
          }) });
        } }, '분류표 엑셀 내보내기'))));

    function add(list) {
      App.state.mails = mails.concat(list.map(function (x) { return { name: x.name, raw: x.raw, mail: L.parseEml(x.raw) }; }));
      App.render();
    }
  };

  /* ── Promise Date 변경 ─────────────────────────────── */
  App.views.promise = function (main) {
    var db = App.db, st = App.state;
    main.appendChild(App.pageHead('Weekly Order Status — Promise Date 변경 확인'));
    main.appendChild(h('p', null, '공급사가 보내는 Weekly Order Status 엑셀(예: Cummins) 두 주차를 올리면, PO 번호와 라인(없으면 품번)으로 행을 맞춰 Promise Date가 바뀐 건, 새로 생긴 건, 빠진 건을 보여 줍니다. 실제 파일의 열 이름은 아직 받지 못해 열 연결 화면에서 맞춥니다.'));
    var dayFirst = h('input', { type: 'checkbox', checked: !!st.wDayFirst, onchange: function (e) { st.wDayFirst = e.target.checked; App.render(); } });
    main.appendChild(h('label', { class: 'check' }, dayFirst, '날짜가 「일/월/연」 순서입니다(예: 05/10/2026 = 10월 5일)'));
    main.appendChild(h('div', { class: 'grid-2' },
      h('div', null, st.wOld ? h('p', { class: 'alert info' }, '이전 주차: ' + st.wOld.name + ' · ' + st.wOld.rows.length + '행') : null,
        App.mappingPanel({ kind: 'weekly', title: '① 이전 주차 파일', applyLabel: '이전 주차로 사용',
          sample: { label: '예시 이전 주차', name: '예시데이터_Weekly_Order_Status_이전주차', headers: Object.keys(S.weeklyOld[0]), rows: S.weeklyOld },
          onApply: function (rows, info) { st.wOld = { name: info.name, rows: rows }; App.render(); } })),
      h('div', null, st.wNew ? h('p', { class: 'alert info' }, '이번 주차: ' + st.wNew.name + ' · ' + st.wNew.rows.length + '행') : null,
        App.mappingPanel({ kind: 'weekly', title: '② 이번 주차 파일', applyLabel: '이번 주차로 사용',
          sample: { label: '예시 이번 주차', name: '예시데이터_Weekly_Order_Status_이번주차', headers: Object.keys(S.weeklyNew[0]), rows: S.weeklyNew },
          onApply: function (rows, info) { st.wNew = { name: info.name, rows: rows }; App.render(); } }))));
    if (!st.wOld || !st.wNew) return;

    var r = L.compareWeekly(st.wOld.rows, st.wNew.rows, st.wDayFirst);
    function inLedger(po) { return db.pos.some(function (p) { return p.po_no === po; }) ? '등록' : ''; }
    var out = h('div', { class: 'card' }, h('h2', null, '비교 결과'),
      h('div', { class: 'tiles' },
        tile('Promise Date 변경', r.changed.length + '건', r.changed.length > 0), tile('새로 생긴 행', r.added.length + '건'),
        tile('빠진 행', r.removed.length + '건'), tile('변경 없음', r.same + '건')),
      r.duplicates.length ? h('div', { class: 'alert warn' }, '같은 PO·라인이 두 번 이상 나온 행이 있어 마지막 행으로 비교했습니다: ' + r.duplicates.slice(0, 10).join(', ') + (r.duplicates.length > 10 ? ' 외' : '')) : null,
      h('h3', null, 'Promise Date가 바뀐 건'),
      App.table([
        { label: 'PO', cell: function (c) { return c.po; } }, { label: '라인', cell: function (c) { return c.line; } },
        { label: '품번', cell: function (c) { return c.part; } }, { label: '이전', cls: 'nowrap', cell: function (c) { return c.old; } },
        { label: '이번', cls: 'nowrap', cell: function (c) { return c.new; } },
        { label: '차이', cell: function (c) {
          if (c.diffDays == null) return h('span', { class: 'badge warn' }, '날짜 확인');
          return c.diffDays > 0 ? h('span', { class: 'badge danger' }, c.diffDays + '일 늦어짐') : h('span', { class: 'badge ok' }, (-c.diffDays) + '일 당겨짐');
        } },
        { label: '관리 대장', cell: function (c) { return inLedger(c.po); } }
      ], r.changed),
      h('h3', { style: 'margin-top:16px' }, '새로 생긴 행'),
      App.table([{ label: 'PO', cell: function (x) { return x.po; } }, { label: '라인', cell: function (x) { return x.line; } }, { label: '품번', cell: function (x) { return x.part; } }, { label: 'Promise Date', cell: function (x) { return x.promise || x.raw; } }], r.added),
      h('h3', { style: 'margin-top:16px' }, '빠진 행(출고 완료 또는 취소 여부 확인)'),
      App.table([{ label: 'PO', cell: function (x) { return x.po; } }, { label: '라인', cell: function (x) { return x.line; } }, { label: '품번', cell: function (x) { return x.part; } }, { label: '이전 Promise Date', cell: function (x) { return x.promise || x.raw; } }], r.removed),
      h('div', { class: 'btn-row', style: 'margin-top:16px' }, h('button', { type: 'button', class: 'btn', onclick: function () {
        App.writeXlsx((st.wOld.name.indexOf('예시') === 0 ? '예시데이터_' : '') + 'PromiseDate_변경_' + App.today() + '.xlsx', {
          '변경': r.changed.map(function (c) { return { 'PO': c.po, '라인': c.line, '품번': c.part, '이전 Promise Date': c.old, '이번 Promise Date': c.new, '차이(일)': c.diffDays == null ? '' : c.diffDays }; }),
          '신규': r.added.map(function (x) { return { 'PO': x.po, '라인': x.line, '품번': x.part, 'Promise Date': x.promise || x.raw }; }),
          '빠짐': r.removed.map(function (x) { return { 'PO': x.po, '라인': x.line, '품번': x.part, '이전 Promise Date': x.promise || x.raw }; })
        });
      } }, '결과 엑셀 내보내기')));
    main.appendChild(out);
    function tile(k, v, danger) { return h('div', { class: 'tile' + (danger ? ' danger' : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)); }
  };

  /* ── Packing List ↔ B/L 중량 ─────────────────────────────── */
  App.views.weight = function (main) {
    var db = App.db, st = App.state;
    st.bl = st.bl || {};
    main.appendChild(App.pageHead('Packing List 합중량 · B/L 중량 대조'));
    main.appendChild(h('p', null, 'Packing List 엑셀의 자재 중량을 합해 B/L에 적힌 중량과 비교합니다. 묶음 기준 열(Invoice·B/L 번호 등)을 연결하면 묶음마다 따로 합칩니다. 「TOTAL」「합계」로 시작하는 행은 빼고 셉니다. 두 값은 같은 단위(kg 가정)여야 합니다.'));
    var perUnit = h('input', { type: 'checkbox', checked: !!st.perUnit, onchange: function (e) { st.perUnit = e.target.checked; App.render(); } });
    main.appendChild(h('label', { class: 'check' }, perUnit, '중량 열이 「개당 중량」입니다(수량을 곱해 합산)'));
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
    var allowNote = '허용 오차: ' + db.settings.weight_tol_kg + 'kg 또는 ' + db.settings.weight_tol_pct + '% 중 큰 쪽(「설정」에서 변경)';
    var box = h('div', { class: 'card' }, h('h2', null, '대조 결과 — ' + st.pl.name), h('p', { class: 'note' }, allowNote),
      tot.skippedRows.length ? h('p', { class: 'note' }, '계산에서 뺀 행(합계 행·중량 없음): 엑셀 ' + tot.skippedRows.join(', ') + '행') : null);
    var tableBox = h('div'); box.appendChild(tableBox);
    function draw() {
      tableBox.innerHTML = '';
      tableBox.appendChild(App.table([
        { label: '묶음', cell: function (g) { return g.group; } },
        { label: '행 수', cell: function (g) { return g.rows; } },
        { label: 'Packing List 합중량', cell: function (g) { return fmt(g.total); } },
        { label: 'B/L 중량', cell: function (g) {
          return h('input', { class: 'cell', type: 'text', inputmode: 'decimal', value: st.bl[g.group] || '', 'aria-label': g.group + ' B/L 중량',
            onchange: function (e) { st.bl[g.group] = e.target.value; draw(); } });
        } },
        { label: '차이(PL − B/L)', cell: function (g) { var c = L.compareWeight(g.total, st.bl[g.group], db.settings); return c.diff == null ? '' : fmt(c.diff) + (c.diffPct == null ? '' : ' (' + c.diffPct.toFixed(2) + '%)'); } },
        { label: '판정', cell: function (g) {
          var c = L.compareWeight(g.total, st.bl[g.group], db.settings);
          return c.status === 'none' ? h('span', { class: 'badge muted' }, 'B/L 중량 입력') : c.status === 'ok' ? h('span', { class: 'badge ok' }, '일치') : h('span', { class: 'badge danger' }, '불일치');
        } }
      ], tot.groups));
    }
    draw();
    box.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn', onclick: function () {
      App.writeXlsx((st.pl.name.indexOf('예시') === 0 ? '예시데이터_' : '') + '중량대조_' + App.today() + '.xlsx', { '중량대조': tot.groups.map(function (g) {
        var c = L.compareWeight(g.total, st.bl[g.group], db.settings);
        return { '묶음': g.group, '행 수': g.rows, 'PL 합중량': g.total, 'B/L 중량': L.toNumber(st.bl[g.group]) == null ? '' : L.toNumber(st.bl[g.group]), '차이': c.diff == null ? '' : c.diff, '판정': c.status === 'ok' ? '일치' : c.status === 'mismatch' ? '불일치' : '' };
      }) });
    } }, '결과 엑셀 내보내기')));
    main.appendChild(box);
    function fmt(n) { return (Math.round(n * 1000) / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 3 }); }
  };
})(window);
