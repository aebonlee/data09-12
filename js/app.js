/* 외자재 운영관리 도우미 — 화면 공통부·처음·업체·설정
   화면별 코드는 view-po.js(발주·대장·팔로우업·성과), view-tools.js(메일 분류·Promise Date·중량 대조) */
(function (root) {
  'use strict';
  var L = root.OMLogic, S = root.OMSample, ST = root.OMStore;
  var App = root.OM = { views: {}, state: {} };

  App.db = ST.loadDb();
  App.save = function () { ST.saveDb(App.db); document.getElementById('sampleBanner').hidden = !App.db._sample; };
  App.today = function () { return L.todayIso(new Date()); };

  /* ── DOM 도우미 ─────────────────────────────── */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  App.h = h;

  var toastTimer;
  App.toast = function (msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.className = 'toast' + (isError ? ' error' : ''); el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3600);
  };

  // buttons: [{ label, primary, danger, onClick }] — onClick 이 false 를 돌려주면 닫지 않음
  App.dialog = function (title, content, buttons) {
    var dlg = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = title;
    var c = document.getElementById('dialogContent'); c.innerHTML = ''; append(c, content);
    var a = document.getElementById('dialogActions'); a.innerHTML = '';
    (buttons || [{ label: '닫기' }]).forEach(function (b) {
      a.appendChild(h('button', {
        class: 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : ''), type: 'button',
        onclick: function () { if (b.onClick && b.onClick() === false) return; dlg.close(); }
      }, b.label));
    });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  };

  App.download = function (name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  };
  App.copy = function (text) {
    function fallback() {
      var t = h('textarea', { style: 'position:fixed;left:-9999px' }); t.value = text; document.body.appendChild(t);
      t.select(); try { document.execCommand('copy'); } catch (e) { /* 무시 */ } t.remove();
    }
    if (navigator.clipboard && root.isSecureContext) navigator.clipboard.writeText(text).catch(fallback); else fallback();
    App.toast('복사했습니다.');
  };
  App.saveEml = function (draft) {
    App.download(draft.fileName, L.buildEml(draft), 'message/rfc822');
  };
  App.saveEmlZip = function (drafts, zipName) {
    var files = drafts.map(function (d, i) { return { name: String(i + 1).padStart(2, '0') + '_' + d.fileName, text: L.buildEml(d) }; });
    App.download(zipName, L.makeZip(files), 'application/zip');
  };
  App.writeXlsx = function (name, sheets) {
    if (!root.XLSX) { App.toast('엑셀 라이브러리를 불러오지 못했습니다.', true); return; }
    var wb = XLSX.utils.book_new();
    Object.keys(sheets).forEach(function (n) {
      var rows = sheets[n];
      XLSX.utils.book_append_sheet(wb, rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['(없음)']]), n.slice(0, 31));
    });
    XLSX.writeFile(wb, name);
  };

  App.badges = function (flags) {
    return flags.length ? flags.map(function (f) { return h('span', { class: 'badge ' + f.level }, f.label); }) : h('span', { class: 'muted' }, '-');
  };
  App.supplierName = function (code) { var s = L.supplierByCode(App.db.suppliers, code); return s ? s.name : (code ? code + ' (마스터 없음)' : '-'); };
  App.supplierSelect = function (value, attrs) {
    var sel = h('select', Object.assign({ class: 'cell' }, attrs || {}), h('option', { value: '' }, '(업체 선택)'),
      App.db.suppliers.map(function (s) { return h('option', { value: s.code }, s.name + ' · ' + s.code); }));
    sel.value = value || '';
    return sel;
  };
  App.field = function (label, control, note) {
    return h('label', { class: 'field' }, h('span', null, label), control, note ? h('small', { class: 'muted' }, note) : null);
  };
  App.table = function (cols, rows, rowAttrs) {
    return h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { scope: 'col' }, c.label); }))),
      h('tbody', null, rows.length ? rows.map(function (r, i) {
        return h('tr', rowAttrs ? rowAttrs(r, i) : null, cols.map(function (c) { var v = c.cell(r, i); return h('td', { class: c.cls || null }, v == null || v === '' ? '-' : v); }));
      }) : h('tr', null, h('td', { colspan: cols.length, class: 'muted' }, '표시할 항목이 없습니다.')))));
  };

  /* ── 파일 읽기 ─────────────────────────────── */
  App.readBuffer = function (file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      r.readAsArrayBuffer(file);
    });
  };
  App.readText = function (file) {
    return App.readBuffer(file).then(function (b) { return new TextDecoder('utf-8').decode(b); });
  };
  // 엑셀·CSV → { sheetNames, grid(sheet) } (grid = 행 배열의 배열)
  App.readWorkbook = function (file) {
    if (!root.XLSX) return Promise.reject(new Error('엑셀 라이브러리(vendor/xlsx.full.min.js)를 불러오지 못했습니다.'));
    return App.readBuffer(file).then(function (buf) {
      var wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false });
      return {
        sheetNames: wb.SheetNames,
        grid: function (name) { return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true, blankrows: false }); }
      };
    });
  };
  // 머리글 행 짐작: 앞 15행 중 채워진 칸이 가장 많은 행
  function guessHeaderRow(grid) {
    var best = 0, bestN = -1;
    grid.slice(0, 15).forEach(function (r, i) {
      var n = r.filter(function (c) { return String(c).trim() !== ''; }).length;
      if (n > bestN) { bestN = n; best = i; }
    });
    return best;
  }
  function gridToRows(grid, headerIdx) {
    var head = (grid[headerIdx] || []).map(function (c, i) { var s = String(c).trim(); return s || ('열' + (i + 1)); });
    var seen = {};
    head = head.map(function (x) { if (seen[x]) { seen[x]++; return x + '_' + seen[x]; } seen[x] = 1; return x; });
    var rows = grid.slice(headerIdx + 1).filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); })
      .map(function (r) { var o = {}; head.forEach(function (k, i) { o[k] = r[i] == null ? '' : r[i]; }); return o; });
    return { headers: head, rows: rows };
  }

  /* ── 열 매핑 패널 ─────────────────────────────── */
  // opts: { kind, title, note, applyLabel, sample: { label, headers, rows, name }, onApply(mappedRows, info) }
  App.mappingPanel = function (opts) {
    var kind = opts.kind, defs = L.FIELDS[kind];
    var box = h('div', { class: 'card' });
    var st = { wb: null, sheet: '', headerIdx: 0, headers: [], rows: [], mapping: {}, name: '' };
    var fileIn = h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv' });
    var body = h('div');
    box.appendChild(h('h2', null, opts.title));
    if (opts.note) box.appendChild(h('p', { class: 'note' }, opts.note));
    box.appendChild(h('div', { class: 'btn-row' },
      h('label', { class: 'btn' }, '엑셀·CSV 파일 선택', fileIn),
      opts.sample ? h('button', { type: 'button', class: 'btn', onclick: function () {
        st.wb = null; st.name = opts.sample.name; st.headers = opts.sample.headers; st.rows = opts.sample.rows; st.headerIdx = 0;
        st.mapping = guess(); draw();
      } }, opts.sample.label) : null));
    fileIn.style.display = 'none';
    box.appendChild(body);

    function guess() {
      var saved = (App.db.mappings || {})[kind];
      var g = L.guessMapping(st.headers, kind);
      if (saved) Object.keys(saved).forEach(function (k) { if (st.headers.indexOf(saved[k]) >= 0) g[k] = saved[k]; });
      return g;
    }
    function loadSheet() {
      var grid = st.wb.grid(st.sheet);
      var r = gridToRows(grid, st.headerIdx);
      st.headers = r.headers; st.rows = r.rows; st.grid = grid;
    }
    fileIn.addEventListener('change', function () {
      var f = fileIn.files[0]; if (!f) return;
      App.readWorkbook(f).then(function (wb) {
        st.wb = wb; st.name = f.name; st.sheet = wb.sheetNames[0];
        st.headerIdx = guessHeaderRow(wb.grid(st.sheet));
        loadSheet(); st.mapping = guess(); draw();
      }).catch(function (e) { App.toast('파일을 읽지 못했습니다: ' + e.message, true); });
      fileIn.value = '';
    });

    function draw() {
      body.innerHTML = '';
      body.appendChild(h('p', null, h('strong', null, st.name), ' · ' + st.rows.length + '행'));
      if (st.wb) {
        var sheetSel = h('select', { onchange: function () { st.sheet = sheetSel.value; st.headerIdx = guessHeaderRow(st.wb.grid(st.sheet)); loadSheet(); st.mapping = guess(); draw(); } },
          st.wb.sheetNames.map(function (n) { return h('option', { value: n }, n); }));
        sheetSel.value = st.sheet;
        var hdr = h('input', { type: 'number', min: 1, value: st.headerIdx + 1, onchange: function () { st.headerIdx = Math.max(0, (+hdr.value || 1) - 1); loadSheet(); st.mapping = guess(); draw(); } });
        body.appendChild(h('div', { class: 'form-grid' }, App.field('시트', sheetSel), App.field('머리글(열 이름) 행 번호', hdr, '표 위에 제목 줄이 있으면 번호를 바꿔 주십시오.')));
      }
      var grid = h('div', { class: 'map-grid' });
      defs.forEach(function (f) {
        var sel = h('select', { onchange: function () { st.mapping[f.key] = sel.value; drawPreview(); } },
          h('option', { value: '' }, '(사용 안 함)'), st.headers.map(function (x) { return h('option', { value: x }, x); }));
        sel.value = st.mapping[f.key] || '';
        grid.appendChild(h('label', { class: 'field' }, h('span', null, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), sel));
      });
      body.appendChild(h('h3', null, '열 연결'));
      body.appendChild(h('p', { class: 'note' }, '실제 파일의 열 이름을 모르므로 비슷한 이름으로 먼저 짐작했습니다. 틀린 곳을 고친 뒤 「' + (opts.applyLabel || '적용') + '」을 누르십시오. 고친 연결은 다음에도 기억합니다.'));
      body.appendChild(grid);
      var prev = h('div', { class: 'preview' });
      body.appendChild(prev);
      body.appendChild(h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: apply }, opts.applyLabel || '적용')));
      drawPreview();
      function drawPreview() {
        prev.innerHTML = '';
        var used = defs.filter(function (f) { return st.mapping[f.key]; });
        var mapped = L.applyMapping(st.rows.slice(0, 5), st.mapping);
        prev.appendChild(h('h3', null, '미리보기(앞 5행)'));
        prev.appendChild(App.table(used.map(function (f) { return { label: f.label, cell: function (r) { return String(r[f.key] == null ? '' : r[f.key]); } }; }), mapped));
      }
    }
    function apply() {
      var miss = L.missingRequired(st.mapping, kind);
      if (miss.length) { App.toast('필수 열을 연결해 주십시오: ' + miss.join(', '), true); return; }
      App.db.mappings = App.db.mappings || {};
      if (st.wb) { App.db.mappings[kind] = Object.assign({}, st.mapping); App.save(); }
      opts.onApply(L.applyMapping(st.rows, st.mapping), { name: st.name, sheet: st.wb && st.wb.sheetNames.length > 1 ? st.sheet : '', mapping: st.mapping, isSample: !st.wb });
    }
    return box;
  };

  /* ── 라우팅 ─────────────────────────────── */
  var MENU = [
    ['#/home', '처음'], ['#/suppliers', '업체'], ['#/po', 'PO 발주 메일'], ['#/ledger', '관리 대장'],
    ['#/followup', 'OC 팔로우업'], ['#/kpi', '접수율·준수율'], ['#/mail', '메일 분류'],
    ['#/promise', 'Promise Date'], ['#/cummins', 'Cummins EXW'], ['#/weight', '중량 대조'], ['#/settings', '설정']
  ];
  App.go = function (hash) { if (location.hash === hash) App.render(); else location.hash = hash; };
  App.render = function () {
    var route = (location.hash || '#/home').split('?')[0];
    if (!App.views[route.slice(2)]) route = '#/home';
    var nav = document.getElementById('nav'); nav.innerHTML = '';
    MENU.forEach(function (m) { nav.appendChild(h('a', { href: m[0], 'aria-current': m[0] === route ? 'page' : null }, m[1])); });
    nav.classList.remove('open'); document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
    var main = document.getElementById('main'); main.innerHTML = '';
    try { App.views[route.slice(2)](main); }
    catch (e) { main.appendChild(h('div', { class: 'alert warn' }, '화면을 그리다 오류가 났습니다: ' + e.message)); if (root.console) console.error(e); }
    main.setAttribute('data-route', route);
    document.title = (MENU.filter(function (m) { return m[0] === route; })[0] || MENU[0])[1] + ' — 외자재 운영관리 도우미';
  };
  App.pageHead = function (title, right) {
    return h('div', { class: 'page-head' }, h('h1', null, title), right || null);
  };

  /* ── 예시 데이터 ─────────────────────────────── */
  App.loadSample = function () {
    function doIt() {
      var db = L.emptyDb();
      db.settings = App.db.settings; db.templates = App.db.templates; db.mappings = App.db.mappings || {};
      if (!db.settings.sender_name) { db.settings.sender_name = 'Sample Buyer'; db.settings.sender_company = 'Example Co. (예시)'; db.settings.sender_dept = 'Production Control'; db.settings.sender_email = 'buyer@our-company.example.com'; }
      var map = L.guessMapping(Object.keys(S.contactRows[0]), 'supplier');
      db.suppliers = L.importSuppliers(L.applyMapping(S.contactRows, map)).suppliers;
      db.pos = S.ledger(App.today()).map(function (p) { return L.cleanPo(p, db.suppliers); });
      db._sample = true;
      App.db = db; App.save();
      App.ensureEcho();   // 실물 양식 예시(Echo 업체, OC 대기 PO 2건)
      App.ensureFox();    // Cummins 오더 현황 예시와 짝이 되는 PO
      App.toast('예시 데이터를 불러왔습니다.'); App.render();
    }
    if (App.db.suppliers.length || App.db.pos.length) {
      App.dialog('예시 데이터 불러오기', h('p', null, '지금 들어 있는 업체·PO를 지우고 예시 데이터로 바꿉니다. 설정과 메일 템플릿은 그대로 둡니다. 계속하시겠습니까?'),
        [{ label: '취소' }, { label: '예시 데이터로 바꾸기', primary: true, onClick: doIt }]);
    } else doIt();
  };

  /* ── 처음 ─────────────────────────────── */
  App.views.home = function (main) {
    var db = App.db, today = App.today();
    var oc = L.ocStats(db.pos, today, db.settings), ex = L.exwStats(db.pos, today, db.settings);
    main.appendChild(App.pageHead('외자재 운영관리 도우미',
      h('button', { type: 'button', class: 'btn', onclick: App.loadSample }, '예시 데이터 불러오기')));
    main.appendChild(h('p', null, '해외 공급업체 발주 흐름 「PO(.pdf) 발행 → 공급사 송부 → OC 회신 확인 → EXW DATE 관리 → 선적서류 확인」을 한곳에서 챙기는 1단계 도구입니다. 모든 데이터는 이 브라우저 안에만 저장되고, 메일은 Outlook에서 열어 확인 후 보내는 초안 파일(.eml)로만 만듭니다.'));
    if (!db.suppliers.length && !db.pos.length) {
      main.appendChild(h('div', { class: 'alert info' }, '아직 데이터가 없습니다. 「예시 데이터 불러오기」로 먼저 둘러보시거나, 「업체」에서 Contact List 엑셀을 올려 시작하십시오.'));
    }
    main.appendChild(h('div', { class: 'tiles' },
      tile('업체', db.suppliers.length + '곳', '업체 마스터'),
      tile('관리 중인 PO', db.pos.length + '건', '관리 대장'),
      tile('OC 접수율', L.pct(oc.rate), '수령 ' + oc.received + ' / 송부 ' + oc.sent),
      tile('OC 미접수', oc.overdue + '건', '송부 후 ' + db.settings.oc_wait_days + '일 초과', oc.overdue > 0),
      tile('EXW 준수율', L.pct(ex.rate), '준수 ' + ex.onTime + ' / 출고 ' + ex.evaluated),
      tile('평균 지연일', ex.avgDelay == null ? '-' : L.num1(ex.avgDelay) + '일', '미출고 지연 ' + ex.openLate + '건', ex.openLate > 0)));
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '업무 순서'),
      h('ol', { class: 'steps' },
        step('#/suppliers', '업체', 'Contact List 엑셀을 올려 업체 마스터(수신·참조·체크리스트)를 만듭니다.'),
        step('#/po', 'PO 발주 메일', 'PO PDF 여러 개(또는 복사한 글)에서 PO 번호·업체·품목 줄을 읽어, 업체별로 묶은 발주 메일 초안(.eml)을 한 번에 만듭니다.'),
        step('#/ledger', '관리 대장', '송부일·OC 수령일·약속/실제 EXW DATE·A/N·선적서류와 항차 체크리스트(매뉴얼 단계)를 기록합니다.'),
        step('#/mail', '메일 분류·OC 확인', '받은 회신 메일(.eml)을 업체별로 나누고, OC 회신이면 수령일을 대장에 넣습니다. 첨부된 OC 엑셀은 PO 품목(수량·단가·품번)과 대조하고 OC DATE를 약속 EXW DATE로 넣습니다.'),
        step('#/followup', 'OC 팔로우업', 'OC 미접수 건을 업체별로 묶어 팔로우업 메일 초안을 만듭니다.'),
        step('#/kpi', '접수율·준수율', 'OC 접수율, EXW 준수율(%), 평균 지연일을 전체·업체별로 봅니다.'),
        step('#/promise', 'Promise Date', 'Cummins Weekly Order Status 두 주차(시트)를 비교해 Promise Date가 밀림·당김·취소된 줄을 찾습니다. 한 주차뿐이면 파일 안 변경 기록을 모읍니다.'),
        step('#/cummins', 'Cummins EXW', '오더 현황 분석 시트에서 Status·구분으로 거른 줄의 Promise Date를 PO·품번별로 대장 EXW DATE에 넣습니다. 분할 선적 수량 합을 PO·OC 수량과 대조하고 노란 줄(EXW 변경)을 표시합니다.'),
        step('#/weight', '중량 대조', 'Packing List 자재 합중량과 B/L 중량이 맞는지 확인합니다.'))));
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '1단계에서 하지 않는 것'),
      h('ul', null,
        h('li', null, '메일 자동 발송·메일함 직접 연결 — 초안 파일만 만들고, 보내기는 사람이 Outlook에서 합니다.'),
        h('li', null, 'HD360 페이지 자동 조회 — 내려받을 수 있는 자료가 있으면 관리 대장 가져오기로 연결할 예정입니다.'),
        h('li', null, 'B/L·Packing List PDF에서 중량 자동 추출 — 실물 샘플을 받기 전이라 Packing List 엑셀·표 붙여넣기와 B/L 중량 직접 입력입니다.'),
        h('li', null, 'SRM·SAP·HD360 화면 자동 입력 — 도구는 넣을 값과 순서(항차 체크리스트)를 정리해 주고, 입력은 사람이 합니다.'),
        h('li', null, 'Outlook .msg 파일 읽기 — 1단계는 .eml 파일만 읽습니다.'))));
    function tile(k, v, s, danger) { return h('div', { class: 'tile' + (danger ? ' danger' : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), h('div', { class: 's' }, s)); }
    function step(href, name, text) { return h('li', null, h('a', { href: href }, name), ' — ' + text); }
  };

  /* ── 업체 ─────────────────────────────── */
  App.views.suppliers = function (main) {
    var db = App.db;
    main.appendChild(App.pageHead('업체 마스터', h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: function () { editSupplier(null); } }, '업체 추가'),
      h('button', { type: 'button', class: 'btn', onclick: function () {
        App.writeXlsx((db._sample ? '예시데이터_' : '') + '업체마스터_' + App.today() + '.xlsx', { '업체': db.suppliers.map(function (s) {
          return { '업체 코드': s.code, '업체명': s.name, '담당자': s.contact, 'Email': s.to, 'CC': s.cc, '전화': s.phone, '국가': s.country, '체크리스트': s.checklist };
        }) });
      } }, '엑셀 내보내기'))));
    var q = App.state.supQ || '';
    var qIn = h('input', { type: 'search', value: q, placeholder: '업체명·코드·담당자·이메일', oninput: function () { App.state.supQ = qIn.value; drawList(); } });
    main.appendChild(h('div', { class: 'card' }, App.field('업체 연락처 조회', qIn)));
    var listBox = h('div');
    main.appendChild(listBox);
    drawList();

    main.appendChild(App.mappingPanel({
      kind: 'supplier', title: 'Contact List 엑셀 가져오기',
      note: '같은 업체 코드는 새 값으로 바꾸고, 새 코드는 추가합니다. 이메일이 여러 개면 ; 또는 , 로 나눠 읽습니다.',
      applyLabel: '업체 마스터에 반영',
      sample: { label: '예시 Contact List로 해 보기', name: '예시데이터_ContactList', headers: Object.keys(S.contactRows[0]), rows: S.contactRows },
      onApply: function (rows, info) {
        var r = L.importSuppliers(rows);
        db.suppliers = L.mergeSuppliers(db.suppliers, r.suppliers);
        if (info.isSample) db._sample = true;
        App.save(); App.render();
        App.toast(r.suppliers.length + '곳 반영' + (r.warnings.length ? ' · 확인 필요 ' + r.warnings.length + '건' : ''), r.warnings.length > 0);
      }
    }));

    function drawList() {
      listBox.innerHTML = '';
      var rows = L.searchSuppliers(db.suppliers, App.state.supQ || '');
      listBox.appendChild(h('p', { class: 'list-meta' }, rows.length + '곳 / 전체 ' + db.suppliers.length + '곳'));
      listBox.appendChild(App.table([
        { label: '업체', cell: function (s) { return h('span', null, h('strong', null, s.name), h('br'), h('small', { class: 'muted' }, s.code + (s.country ? ' · ' + s.country : ''))); } },
        { label: '담당자·전화', cell: function (s) { return h('span', null, s.contact || '-', h('br'), h('small', { class: 'muted' }, s.phone || '')); } },
        { label: '수신(To)', cell: function (s) { return s.to ? h('span', null, s.to, ' ', h('button', { type: 'button', class: 'chip', onclick: function () { App.copy(s.to); } }, '복사')) : h('span', { class: 'badge danger' }, '이메일 없음'); } },
        { label: '참조(CC)', cell: function (s) { return s.cc; } },
        { label: '체크리스트', cls: 'clip', cell: function (s) { return s.checklist ? h('span', { style: 'white-space:pre-line' }, s.checklist.replace(/;\s*/g, '\n')) : ''; } },
        { label: '', cell: function (s) { return h('button', { type: 'button', class: 'btn', onclick: function () { editSupplier(s); } }, '수정'); } }
      ], rows));
    }

    function editSupplier(s) {
      var isNew = !s;
      s = s || { code: '', name: '', contact: '', to: '', cc: '', phone: '', country: '', checklist: '' };
      var f = {};
      [['code', '업체 코드'], ['name', '업체명'], ['contact', '담당자'], ['to', '수신 이메일(To) — 여러 개는 ; 로'], ['cc', '참조 이메일(CC)'], ['phone', '전화'], ['country', '국가']].forEach(function (x) {
        f[x[0]] = h('input', { type: 'text', value: s[x[0]] || '' });
      });
      f.checklist = h('textarea', null); f.checklist.value = s.checklist || '';
      var content = h('div', { class: 'form-grid' },
        App.field('업체 코드', f.code), App.field('업체명', f.name), App.field('담당자', f.contact), App.field('전화', f.phone),
        App.field('수신 이메일(To) — 여러 개는 ; 로', f.to), App.field('참조 이메일(CC)', f.cc), App.field('국가', f.country),
        h('div', { class: 'span-all' }, App.field('체크리스트·특이사항 (한 줄에 하나)', f.checklist, '발주 메일과 선적서류 요청 메일에 「Please note」로 함께 들어갑니다.'),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: function () {
            f.checklist.value = (f.checklist.value.trim() ? f.checklist.value.trim() + '\n' : '') + L.DEFAULT_SUPPLIER_CHECKLIST;
          } }, '구매발주서 조건으로 기본 항목 넣기')),
          h('p', { class: 'note' }, '기본 항목은 실제 구매발주서의 조건(원산지 표기, Shipping Mark, Invoice 기재 사항, 선적 후 5일 이내 서류, ISPM 15 목재 포장)과 「OC 7일 이내」 요청에서 뽑았습니다. 업체에 맞지 않는 줄은 지워 주십시오.')));
      var buttons = [{ label: '취소' }];
      if (!isNew) buttons.push({ label: '삭제', danger: true, onClick: function () {
        if (db.pos.some(function (p) { return p.supplier_code === s.code; })) { App.toast('이 업체의 PO가 대장에 있어 삭제하지 않았습니다.', true); return; }
        db.suppliers = db.suppliers.filter(function (x) { return x !== s; }); App.save(); App.render();
      } });
      buttons.push({ label: '저장', primary: true, onClick: function () {
        var v = {}; Object.keys(f).forEach(function (k) { v[k] = f[k].value; });
        if (!v.name.trim()) { App.toast('업체명을 입력해 주십시오.', true); return false; }
        var ns = L.importSuppliers([v]).suppliers[0];
        if (!v.code.trim()) ns.code = 'S' + String(db.suppliers.length + 1).padStart(3, '0');
        if (isNew && L.supplierByCode(db.suppliers, ns.code)) { App.toast('이미 있는 업체 코드입니다.', true); return false; }
        if (isNew) db.suppliers.push(ns);
        else {
          db.pos.forEach(function (p) { if (p.supplier_code === s.code) p.supplier_code = ns.code; });
          db.suppliers[db.suppliers.indexOf(s)] = ns;
        }
        App.save(); App.render();
      } });
      App.dialog(isNew ? '업체 추가' : '업체 수정', content, buttons);
    }
  };

  /* ── 설정 ─────────────────────────────── */
  App.views.settings = function (main) {
    var db = App.db, st = db.settings;
    main.appendChild(App.pageHead('설정'));
    var f = {};
    function inp(k, type) { f[k] = h('input', { type: type || 'text', value: st[k], step: type === 'number' ? 'any' : null, min: type === 'number' ? 0 : null }); return f[k]; }
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '보내는 사람(메일 서명)'),
      h('div', { class: 'form-grid' }, App.field('이름', inp('sender_name')), App.field('이메일', inp('sender_email')),
        App.field('부서', inp('sender_dept')), App.field('회사', inp('sender_company')))));
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '판단 기준'),
      h('p', { class: 'note' }, '처음 값은 임시 기본값(가정)입니다. 사내 기준을 확인해 바꿔 주십시오.'),
      h('div', { class: 'form-grid cols-4' },
        App.field('OC 대기 일수', inp('oc_wait_days', 'number'), '송부 후 이 일수를 넘도록 OC가 없으면 「OC 미접수」'),
        App.field('EXW 임박 일수', inp('exw_soon_days', 'number'), '약속 EXW DATE까지 이 일수 이하면 「EXW 임박」'),
        App.field('EXW 허용 일수', inp('exw_grace_days', 'number'), '실제 출고가 약속일 + 이 일수 이내면 「준수」'),
        App.field('중량 허용 오차(kg)', inp('weight_tol_kg', 'number')),
        App.field('중량 허용 오차(%)', inp('weight_tol_pct', 'number'), 'kg·% 중 큰 쪽까지 허용'),
        App.field('발주 메일의 OC 요청 일수', inp('oc_request_days', 'number'), '메일 문안 {OC_DAYS}. 실제 메일은 「within 7 days」 — OC 대기 일수도 7일로 맞출지 확인해 주십시오'))));
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '지역별 평균 운송기간(일)'),
      h('p', { class: 'note' }, '항차 업무 매뉴얼의 표 값입니다. 업체의 「국가」로 지역을 찾아 ETA(= ETD + 운송기간)와 Incoterms Date(= Delivery Date − 운송기간) 참고값을 계산합니다.'),
      h('div', { class: 'form-grid cols-4' },
        App.field('미국', inp('transit_us', 'number')), App.field('유럽', inp('transit_eu', 'number')),
        App.field('일본·중국', inp('transit_jpcn', 'number')), App.field('인도', inp('transit_in', 'number')))));
    var rxTest = h('input', { type: 'text', placeholder: '예: PO No.: 4500012345' });
    var rxOut = h('p', { class: 'note' });
    function testRx() { var r = L.poNumbersIn(rxTest.value, f.po_regex.value.trim()); rxOut.textContent = r.error || ('찾은 PO 번호: ' + (r.list.join(', ') || '없음')); }
    main.appendChild(h('div', { class: 'card' }, h('h2', null, 'PO 번호·OC 메일 찾기 규칙'),
      h('div', { class: 'form-grid' },
        App.field('PO 번호 정규식(비우면 기본 규칙)', inp('po_regex'), '괄호로 묶은 부분이 있으면 그 부분을 PO 번호로 씁니다. 예: 45\\d{8}'),
        App.field('시험 문장', rxTest),
        h('div', { class: 'span-all' }, h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: testRx }, '규칙 시험')), rxOut),
        h('div', { class: 'span-all' }, App.field('OC 회신 판단 낱말(쉼표로 구분)', inp('oc_keywords'), '대문자 2~3자 낱말(OC 등)은 대소문자를 구분합니다.')))));
    main.appendChild(h('div', { class: 'btn-row', style: 'margin-bottom:20px' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
      Object.keys(f).forEach(function (k) { st[k] = f[k].type === 'number' ? Math.max(0, Number(f[k].value) || 0) : f[k].value.trim(); });
      App.save(); App.toast('설정을 저장했습니다.');
    } }, '설정 저장')));

    // 메일 템플릿
    var tcard = h('div', { class: 'card' }, h('h2', null, '메일 템플릿'),
      h('p', { class: 'note' }, '빈칸: {PO} {PO_LIST} {SUPPLIER} {CODE}(업체 코드) {CONTACT} {EXW} {OC_DAYS} {CHECKLIST} {SENDER} {DEPT} {COMPANY}. 발주 메일은 받은 실제 메일의 제목·문안 구성을 따랐고, 나머지는 일반적인 영문 예시입니다.'));
    L.TEMPLATE_KEYS.forEach(function (t) {
      var subj = h('input', { type: 'text', value: db.templates[t.key].subject });
      var body = h('textarea', { rows: 8 }); body.value = db.templates[t.key].body;
      tcard.appendChild(h('div', { class: 'mail-box', style: 'margin-bottom:18px' }, h('h3', null, t.label), App.field('제목', subj), App.field('본문', body),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { db.templates[t.key] = { subject: subj.value, body: body.value }; App.save(); App.toast(t.label + ' 템플릿을 저장했습니다.'); } }, '저장'),
          h('button', { type: 'button', class: 'btn', onclick: function () { var d = L.defaultTemplates()[t.key]; subj.value = d.subject; body.value = d.body; } }, '기본 문안으로'))));
    });
    main.appendChild(tcard);

    // 백업
    var restoreIn = h('input', { type: 'file', accept: '.json', style: 'display:none' });
    restoreIn.addEventListener('change', function () {
      var file = restoreIn.files[0]; if (!file) return;
      App.readText(file).then(function (t) {
        App.db = ST.normalize(JSON.parse(t)); App.save(); App.toast('백업을 불러왔습니다.'); App.render();
      }).catch(function (e) { App.toast('백업 파일을 읽지 못했습니다: ' + e.message, true); });
    });
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '데이터 보관'),
      h('p', { class: 'note' }, '데이터는 이 브라우저에만 있습니다. 다른 PC로 옮기거나 담당자에게 넘길 때는 백업 파일(JSON)을 내려받아 전달하십시오.'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: function () { App.download((db._sample ? '예시데이터_' : '') + '외자재도우미_백업_' + App.today() + '.json', JSON.stringify(db, null, 1), 'application/json'); } }, '백업 내려받기'),
        h('label', { class: 'btn' }, '백업 불러오기', restoreIn),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
          App.dialog('모든 데이터 지우기', h('p', null, '업체·PO·설정·템플릿을 모두 지웁니다. 되돌릴 수 없습니다.'), [{ label: '취소' }, { label: '모두 지우기', danger: true, onClick: function () { ST.clearDb(); App.db = ST.loadDb(); App.save(); App.render(); } }]);
        } }, '모든 데이터 지우기'))));
  };

  /* ── 시작 ─────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    if (root.pdfjsLib) root.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    document.getElementById('storeWarn').hidden = ST.available();
    document.getElementById('sampleBanner').hidden = !App.db._sample;
    document.getElementById('menuBtn').addEventListener('click', function () {
      var nav = document.getElementById('nav');
      var open = !nav.classList.contains('open');
      nav.classList.toggle('open', open); this.setAttribute('aria-expanded', String(open));
    });
    root.addEventListener('hashchange', App.render);
    App.render();
  });
})(window);
