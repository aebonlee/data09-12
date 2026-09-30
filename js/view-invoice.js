/* 화면: Invoice PDF → 엑셀 (2026-09-30 요청 「외자 부품 invoice 엑셀 변환 · PO 번호 추가」
         + 「인보이스 번호가 있으면 B/L 과 매칭해 항차등록 완료 여부 확인」)
   같은 부서 권도연 님의 hd-project16 동작 방식을 참고해 이 도구 안에서 새로 만들었습니다(설명은 js/invoice.js 머리말). */
(function (root) {
  'use strict';
  var L = root.OMLogic, S = root.OMSample, I = root.OMInvoice, AI = root.OMAi, App = root.OM, h = App.h;

  function docs() { App.db.invoices = App.db.invoices || []; return App.db.invoices; }
  function mem() { return App.state.invMem = App.state.invMem || {}; }   // 스캔본 PDF·그림 바이트(저장하지 않음 — 자동 보내기용)
  function newId(file, no) { return 'inv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (no ? '-' + I.keyOf(no).toLowerCase() : ''); }
  function readOpts() { return { poRegex: App.db.settings.po_regex || '', ledgerPos: App.db.pos.map(function (p) { return p.po_no; }) }; }

  /* ── PDF 읽기(pdf.js) ─────────────────────────────── */
  function openPdf(bytes) {
    if (!root.pdfjsLib) return Promise.reject(new Error('PDF 라이브러리를 불러오지 못했습니다'));
    return root.pdfjsLib.getDocument({ data: bytes.slice(0), cMapUrl: 'vendor/cmaps/', cMapPacked: true, isEvalSupported: false }).promise;
  }
  // 쪽마다 글 조각을 줄로 묶어(칸 사이는 공백 세 칸) 돌려줍니다
  function pdfText(bytes) {
    return openPdf(bytes).then(function (doc) {
      var n = Math.min(doc.numPages, 20), jobs = [];
      for (var i = 1; i <= n; i++) jobs.push(doc.getPage(i).then(function (p) { return p.getTextContent(); }).then(function (tc) { return I.itemsToLines(tc.items); }));
      return Promise.all(jobs).then(function (pages) { doc.destroy(); return pages; });
    });
  }
  // 스캔본 자동 보내기용: 쪽을 그림(JPEG)으로
  function pdfImages(bytes, max) {
    return openPdf(bytes).then(function (doc) {
      var out = [], chain = Promise.resolve();
      for (var i = 1; i <= Math.min(doc.numPages, max || 3); i++) (function (n) {
        chain = chain.then(function () {
          return doc.getPage(n).then(function (page) {
            var vp = page.getViewport({ scale: 1.6 }), cv = document.createElement('canvas');
            cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
            return page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function () { out.push(cv.toDataURL('image/jpeg', 0.82)); });
          });
        });
      })(i);
      return chain.then(function () { doc.destroy(); return out; });
    });
  }
  function fileDataUrl(file) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(file); });
  }

  // 글 → 문서 한 건
  function makeDoc(file, text, engine, pages) {
    var r = I.readInvoice(text, readOpts());
    return { id: newId(file, r.header.invoiceNo), file: file, engine: engine, pages: pages || 1, readAt: new Date().toISOString(),
      header: r.header, items: r.items, skipped: r.skipped, totals: r.totals, notes: r.notes, needsAi: false };
  }
  function scanDoc(file, why) {
    return { id: newId(file, ''), file: file, engine: '스캔본(글 없음) — AI 로 읽기 필요', pages: 1, readAt: new Date().toISOString(),
      header: { invoiceNo: '', date: '', dateAmbiguous: false, dateAlt: '', supplier: '', currency: '', poNo: '', incoterms: '', incotermsPlace: '', blNo: '' },
      items: [], skipped: [], totals: { sub: null, total: null, charges: [] }, notes: [why], needsAi: true };
  }
  function addDocs(list) {
    var ds = docs(), added = 0, replaced = 0;
    list.forEach(function (d) {
      var k = I.keyOf(d.header.invoiceNo);
      var ex = k ? ds.filter(function (x) { return I.keyOf(x.header.invoiceNo) === k && x.file === d.file; })[0] : null;
      if (ex) { ds[ds.indexOf(ex)] = Object.assign(d, { id: ex.id }); replaced++; } else { ds.push(d); added++; }
    });
    if (list.length) App.state.invSel = list[list.length - 1].id;
    App.save(); App.render();
    var scans = list.filter(function (d) { return d.needsAi; }).length;
    App.toast('Invoice ' + added + '건 추가' + (replaced ? ' · 같은 파일·번호 ' + replaced + '건 다시 읽음' : '') + (scans ? ' · 스캔본 ' + scans + '건은 아래 「AI 로 읽기」를 써 주십시오' : ''), scans > 0);
  }
  function readFiles(files) {
    return Promise.all(files.map(function (f) {
      if (/\.(png|jpe?g|webp)$/i.test(f.name)) {
        return fileDataUrl(f).then(function (u) { var d = scanDoc(f.name, '그림 파일이라 글을 꺼낼 수 없습니다. AI 로 읽어 주세요.'); mem()[d.id] = { images: [u] }; return d; });
      }
      return App.readBuffer(f).then(function (buf) {
        var bytes = new Uint8Array(buf);
        if (/\.txt$/i.test(f.name)) return makeDoc(f.name, new TextDecoder('utf-8').decode(bytes), '글 파일', 1);
        return pdfText(bytes).then(function (pages) {
          var text = pages.join('\n'), per = text.replace(/\s/g, '').length / Math.max(pages.length, 1);
          if (per < 60) { var d = scanDoc(f.name, '쪽마다 글자가 ' + Math.round(per) + '자뿐이라 스캔본으로 봤습니다. AI 로 읽어 주세요.'); mem()[d.id] = { bytes: bytes, text: text }; return d; }
          var doc = makeDoc(f.name, text, '전자 PDF', pages.length); mem()[doc.id] = { bytes: bytes, text: text }; return doc;
        }, function (e) { var d = scanDoc(f.name, 'PDF 글을 읽지 못했습니다(' + e.message + '). 글 붙여넣기나 AI 로 읽기를 써 주세요.'); mem()[d.id] = { bytes: bytes }; return d; });
      });
    })).then(addDocs);
  }
  function loadSample() {
    // 예시 Invoice 두 장과 짝이 되는 A/N(B/L)·대장 PO 를 먼저 넣습니다(모두 지어낸 값)
    var an = App.loadAnSample ? App.loadAnSample() : 0;
    App.db._sample = true;
    return Promise.all(S.invoicePdfs.map(function (p) {
      var bytes = L.makeSimplePdf(p.lines);
      return pdfText(bytes).then(function (pages) { var d = makeDoc(p.name, pages.join('\n'), '전자 PDF', pages.length); mem()[d.id] = { bytes: bytes }; return d; });
    })).then(function (list) { addDocs(list); if (an) App.toast('예시 Invoice 2건과 짝이 되는 예시 A/N ' + an + '건을 함께 넣었습니다.'); });
  }

  /* ── 화면 ─────────────────────────────── */
  App.views.invoice = function (main) {
    var db = App.db, ds = docs(), q = L.anQueue(db);
    var sel = ds.filter(function (d) { return d.id === App.state.invSel; })[0] || ds[ds.length - 1] || null;
    main.appendChild(App.pageHead('Invoice PDF → 엑셀', h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary', disabled: !ds.length, onclick: exportXlsx }, 'ERP 업로드 엑셀 내보내기'),
      h('button', { type: 'button', class: 'btn', disabled: !ds.length, onclick: function () { App.download((db._sample ? '예시데이터_' : '') + 'Invoice_ERP_' + App.today() + '.csv', L.toCsv(I.erpRows(ds)), 'text/csv;charset=utf-8'); } }, 'CSV'))));
    main.appendChild(h('p', null, '공급사 Invoice(전자 PDF)에서 Invoice 번호·날짜·공급사·통화·Incoterms·PO 번호(줄마다 또는 위쪽)·품번·품명·수량·단가·금액을 읽어, 부품 한 줄마다 헤더가 붙은 ERP 업로드용 엑셀로 만듭니다. 줄마다 「수량 × 단가 = 금액」을 검산해 맞지 않는 줄을 표시하고, 적힌 Sub Total 과도 대조합니다. 읽은 Invoice 는 PO 로 관리 대장과, Invoice 번호·PO 로 도착 통지(A/N)의 B/L 과 이어 항차등록이 끝났는지 보여 드립니다.'));
    main.appendChild(h('p', { class: 'note' }, '같은 부서 권도연 님의 「외자부품 Invoice 엑셀 자동 변환」(hd-project16) 방식 — 열 순서를 몰라도 수량 × 단가 = 금액이 맞는 조합으로 칸을 찾고, 유럽식 숫자(1.234,56)를 계산으로 가려내고, 맞지 않는 줄은 버리지 않고 표시하는 방식 — 을 참고해 이 도구에 맞게 새로 만들고 PO 번호·B/L·항차등록 연결을 더했습니다.'));

    // 올리기
    var fileIn = h('input', { type: 'file', accept: '.pdf,.txt,.png,.jpg,.jpeg,.webp,application/pdf', multiple: true, style: 'display:none' });
    fileIn.addEventListener('change', function () { var fs = Array.prototype.slice.call(fileIn.files); fileIn.value = ''; readFiles(fs).catch(function (e) { App.toast('읽지 못했습니다: ' + e.message, true); }); });
    var drop = h('div', { class: 'drop-zone', tabindex: '0', role: 'button', 'aria-label': 'Invoice PDF 를 끌어 놓거나 눌러서 고르기',
      onclick: function () { fileIn.click(); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } },
      h('strong', null, 'Invoice PDF 를 여기에 끌어 놓으십시오'), h('span', { class: 'muted' }, '여러 개를 한 번에 · 스캔본·사진도 받습니다(AI 로 읽기) · 눌러서 고를 수도 있습니다'));
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var fs = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []); if (fs.length) readFiles(fs); });
    var paste = h('textarea', { rows: 5, placeholder: 'PDF 뷰어에서 Invoice 를 열고 Ctrl+A → Ctrl+C 한 글을 붙여넣어 주십시오.' });
    main.appendChild(h('div', { class: 'card' }, h('h2', null, 'Invoice 올리기'), drop,
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('label', { class: 'btn btn-primary' }, '파일 선택(여러 개)', fileIn),
        h('button', { type: 'button', class: 'btn', onclick: function () { loadSample().catch(function (e) { App.toast('예시를 읽지 못했습니다: ' + e.message, true); }); } }, '예시 Invoice 2종으로 해 보기'),
        ds.length ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () {
          App.dialog('읽은 Invoice 모두 지우기', h('p', null, '읽은 Invoice ' + ds.length + '건을 목록에서 지웁니다. 원본 파일은 그대로입니다.'), [{ label: '취소' }, { label: '모두 지우기', danger: true, onClick: function () { App.db.invoices = []; App.state.invMem = {}; App.save(); App.render(); } }]);
        } }, '목록 비우기') : null),
      h('details', null, h('summary', null, 'PDF 가 안 열리면 — Invoice 글 붙여넣기'), paste,
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: function () {
          if (!paste.value.trim()) { App.toast('붙여넣은 글이 없습니다.', true); return; }
          addDocs([makeDoc('(붙여넣기) ' + App.today(), paste.value, '붙여넣은 글', 1)]); paste.value = '';
        } }, '붙여넣은 글 읽기'))),
      h('p', { class: 'note' }, '예시 Invoice 는 지어낸 두 가지 양식입니다(A: 독일식 숫자·PO 위쪽 한 번 / B: 줄마다 PO, 넷째 줄 금액을 일부러 틀리게). 실제 공급사 Invoice 를 받으면 그 배치에 맞춰 보정합니다. 스캔본은 글자가 없어 「AI 로 읽기」로 읽습니다.')));

    lookupCard(main, q);
    if (!ds.length) return;
    listCard(main, ds, q);
    if (sel) docCard(main, sel, q);
    aiCard(main, ds, sel);
  };

  // Invoice·PO 번호만으로 B/L·항차등록 확인(Invoice 를 올리지 않았어도 A/N 에 Invoice 번호가 있으면 찾음)
  function lookupCard(main, q) {
    var inp = h('input', { type: 'search', value: App.state.invLookup || '', placeholder: '예: 9000001 · EXCI-2609-017 · M261110501' });
    var out = h('div');
    function run() {
      App.state.invLookup = inp.value.trim(); out.innerHTML = '';
      if (!App.state.invLookup) return;
      var r = I.lookupByNumber(App.state.invLookup, App.db, L, docs());
      out.appendChild(h('p', null, h('strong', null, App.state.invLookup), ' — ' + r.kind + ' 로 찾음 · ', stateBadge(r.link)));
      out.appendChild(linkTable(r.link));
    }
    main.appendChild(h('div', { class: 'card' }, h('h2', null, 'Invoice 번호 → B/L → 항차등록 확인'),
      h('p', { class: 'note' }, 'Invoice 번호나 PO 번호를 넣으면, 도착 통지(A/N)에 적힌 Invoice 번호 · A/N 의 PO 목록 · 대장 PO 의 B/L 순서로 B/L 을 찾아 항차등록이 끝났는지 보여 드립니다. 항공 A/N(HAWB 사본)의 「INV:」, A/N 엑셀의 「Invoice No」 칸을 읽습니다.'),
      h('div', { class: 'btn-row', style: 'align-items:flex-end' }, App.field('번호', inp), h('button', { type: 'button', class: 'btn btn-primary', onclick: run }, '확인')), out));
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    run();
  }
  function stateBadge(lk) {
    var lvl = { registered: 'ok', partial: 'warn', pending: 'warn', no_an: 'muted', no_bl: 'danger', no_po: 'muted' }[lk.state] || 'muted';
    return h('span', { class: 'badge ' + lvl }, lk.label + (lk.multi ? ' · B/L ' + lk.bls.length + '건' : ''));
  }
  function linkTable(lk) {
    var rows = lk.bls.length ? lk.bls : [];
    return h('div', null,
      lk.pos.length ? h('p', null, 'PO ', lk.pos.map(function (p) { return h('span', { class: 'badge ' + (p.inLedger ? 'ok' : 'warn'), title: p.inLedger ? '대장에 있음' : '대장에 없음' }, p.po_no + (p.inLedger ? '' : ' (대장에 없음)')); })) : null,
      rows.length ? App.table([
        { label: 'B/L', cell: function (b) { return h('strong', null, b.bl); } },
        { label: '연결 근거', cell: function (b) { return b.via.join(' · '); } },
        { label: 'TMS NO', cell: function (b) { return b.tms; } },
        { label: 'ETA', cls: 'nowrap', cell: function (b) { return b.eta; } },
        { label: '항차등록', cell: function (b) { return h('span', { class: 'badge ' + (b.state === 'registered' ? 'ok' : b.state === 'no_an' ? 'muted' : b.state === 'reg_eta' ? 'danger' : 'warn') }, b.label); } }
      ], rows) : h('p', { class: 'muted' }, lk.pos.length ? '이 PO 가 든 A/N·대장 B/L 이 아직 없습니다. A/N 을 받으면 「도착 통지(A/N)」 화면에 올려 주십시오.' : 'PO·B/L 번호가 없어 연결할 수 없습니다.'),
      lk.multi && !lk.byInvoiceNo ? h('p', { class: 'note' }, 'PO 로만 찾아 B/L 이 여러 건입니다(분할 선적). Invoice 번호가 A/N 에 적혀 오면 그 B/L 하나로 좁혀집니다.') : null,
      h('p', null, h('a', { href: '#/an' }, '도착 통지(A/N) 화면에서 항차등록 표시하기')));
  }

  function listCard(main, ds, q) {
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '읽은 Invoice ' + ds.length + '건'),
      App.table([
        { label: '파일 · 읽은 방식', cls: 'clip', cell: function (d) { return h('span', null, h('strong', null, d.file), h('br'), h('small', { class: 'muted' }, d.engine)); } },
        { label: 'Invoice No · 날짜', cell: function (d) { return h('span', null, d.header.invoiceNo || h('span', { class: 'badge warn' }, '번호 없음'), h('br'), h('small', null, d.header.date || '-'), d.header.dateAmbiguous ? h('span', { class: 'badge warn' }, '일·월 확인') : null); } },
        { label: '공급사', cls: 'clip', cell: function (d) { return d.header.supplier; } },
        { label: 'PO', cell: function (d) { return I.invoicePos(d).join(', '); } },
        { label: '줄 · 금액 합', cell: function (d) {
          var s = I.docSummary(d);
          return h('span', null, s.lines + '줄 · ' + (d.header.currency ? d.header.currency + ' ' : '') + s.sum.toLocaleString('en-US'), h('br'),
            s.totalOk == null ? h('small', { class: 'muted' }, '적힌 합계 없음') : s.totalOk ? h('span', { class: 'badge ok' }, s.statedLabel + ' 일치') : h('span', { class: 'badge danger' }, s.statedLabel + ' 차이 ' + s.diff),
            s.bad ? h('span', { class: 'badge danger' }, '검산 ' + s.bad + '줄') : null);
        } },
        { label: 'B/L · 항차등록', cell: function (d) { var lk = I.invoiceLink(d, App.db, L, q); return h('span', null, lk.bls.map(function (b) { return b.bl; }).join(', ') || '-', h('br'), stateBadge(lk)); } },
        { label: '', cell: function (d) {
          return h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn' + (App.state.invSel === d.id ? ' btn-primary' : ''), onclick: function () { App.state.invSel = d.id; App.render(); } }, '열기'),
            h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { App.db.invoices = docs().filter(function (x) { return x !== d; }); delete mem()[d.id]; App.save(); App.render(); } }, '빼기'));
        } }
      ], ds, function (d) { return { class: d.needsAi ? 'row-bad' : null }; })));
  }

  function num(v) { if (v === '' || v == null) return ''; var c = I.amountCandidates(String(v)); return c.length ? c[0] : ''; }
  function docCard(main, d, q) {
    var hd = d.header, s = I.docSummary(d), lk = I.invoiceLink(d, App.db, L, q);
    var card = h('div', { class: 'card' }, h('h2', null, (hd.invoiceNo ? 'Invoice ' + hd.invoiceNo : d.file) + ' — 확인·고치기'));
    if (d.needsAi) card.appendChild(h('div', { class: 'alert warn' }, d.notes[0] || '스캔본입니다.', ' 아래 「AI 로 읽기」에서 읽어 주십시오.'));
    // 헤더 칸
    var F = [['invoiceNo', 'Invoice No'], ['date', '날짜(YYYY-MM-DD)'], ['supplier', '공급사'], ['currency', '통화'], ['incoterms', 'Incoterms'], ['incotermsPlace', 'Incoterms 장소'], ['poNo', 'PO 번호(위쪽)'], ['blNo', 'B/L·AWB 번호(Invoice 에 적힌 것)'], ['blDate', 'B/L DATE(YYYY-MM-DD, Invoice 에 적힌 것)']];
    var grid = h('div', { class: 'form-grid cols-4' });
    F.forEach(function (f) {
      var inp = h('input', { type: 'text', value: hd[f[0]] || '', onchange: function (e) {
        var v = e.target.value.trim(); if (f[0] === 'poNo' || f[0] === 'blNo' || f[0] === 'currency' || f[0] === 'incoterms') v = v.toUpperCase();
        var old = hd[f[0]]; hd[f[0]] = v;
        if (f[0] === 'date') hd.dateAmbiguous = false;
        if (f[0] === 'poNo') d.items.forEach(function (it) { if (it.poFrom === '헤더' && it.poNo === old) it.poNo = v; });
        App.save(); App.render();
      } });
      grid.appendChild(App.field(f[1], inp));
    });
    card.appendChild(grid);
    if (hd.dateAmbiguous) card.appendChild(h('div', { class: 'alert warn' }, '날짜 ' + hd.date + ' 는 일·월 순서가 애매합니다. ',
      h('button', { type: 'button', class: 'btn', onclick: function () { var a = hd.date; hd.date = hd.dateAlt; hd.dateAlt = a; App.save(); App.render(); } }, hd.dateAlt + ' 로 바꾸기'),
      ' ', h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { hd.dateAmbiguous = false; App.save(); App.render(); } }, '지금 날짜가 맞음')));
    (d.notes || []).filter(function (n) { return !d.needsAi && !/일·월 순서/.test(n); }).forEach(function (n) { card.appendChild(h('p', { class: 'note' }, n)); });

    // 합계 대조 + 연결
    card.appendChild(h('div', { class: 'tiles' },
      tile('부품 줄', s.lines + '줄'), tile('금액 합', (hd.currency ? hd.currency + ' ' : '') + s.sum.toLocaleString('en-US')),
      tile(s.statedLabel || '적힌 합계', s.stated == null ? '없음' : s.stated.toLocaleString('en-US') + (s.totalOk ? ' 일치' : ' (차이 ' + s.diff + ')'), s.totalOk === false),
      tile('검산 확인 필요', s.bad + '줄', s.bad > 0), tile('짐작한 줄', s.guessed + '줄', s.guessed > 0), tile('항차등록', lk.label, lk.state === 'no_bl' || lk.state === 'pending')));
    card.appendChild(h('h3', null, 'PO · B/L · 항차등록'));
    card.appendChild(linkTable(lk));

    // 부품 줄
    card.appendChild(h('h3', null, '부품 줄'));
    card.appendChild(h('p', { class: 'note' }, '칸을 고치면 바로 저장됩니다. 수량이나 단가를 고치면 금액을 다시 계산하고, 금액을 직접 고치면 그대로 둡니다(원본 금액이 맞고 단가가 반올림된 경우). 가장 빠른 확인은 금액 합을 원본의 Sub Total 과 맞춰 보는 것입니다.'));
    function cellInput(it, key, w) {
      return h('input', { type: 'text', class: 'cell', style: 'min-width:' + (w || 70) + 'px', value: it[key] == null ? '' : String(it[key]), onchange: function (e) {
        var v = e.target.value.trim();
        if (key === 'qty' || key === 'unitPrice' || key === 'amount') {
          v = num(v); it[key] = v;
          if (key !== 'amount' && it.qty !== '' && it.unitPrice !== '') it.amount = Math.round(Number(it.qty) * Number(it.unitPrice) * 100) / 100;
        } else it[key] = key === 'poNo' ? v.toUpperCase() : v;
        if (key === 'poNo') it.poFrom = '고침';
        it.edited = true; App.save(); App.render();
      } });
    }
    card.appendChild(App.table([
      { label: '#', cell: function (it, i) { return String(i + 1); } },
      { label: 'PO No', cell: function (it) { return h('span', null, cellInput(it, 'poNo', 110), it.poFrom ? h('br') : null, it.poFrom ? h('small', { class: 'muted' }, it.poFrom) : null); } },
      { label: 'Part No', cell: function (it) { return cellInput(it, 'partNo', 100); } },
      { label: 'Description', cell: function (it) { return cellInput(it, 'desc', 160); } },
      { label: 'Qty', cell: function (it) { return cellInput(it, 'qty', 60); } },
      { label: 'Unit Price', cell: function (it) { return cellInput(it, 'unitPrice', 80); } },
      { label: 'Amount', cell: function (it) { return cellInput(it, 'amount', 90); } },
      { label: '검산', cell: function (it) {
        var c = I.checkItem(it);
        return h('span', null, c.ok ? h('span', { class: 'badge ok' }, 'OK') : h('span', { class: 'badge danger', title: c.why }, '확인 필요'),
          !c.ok ? h('small', { class: 'muted' }, h('br'), c.why) : null,
          it.guessed && !it.edited ? h('span', { class: 'badge warn', title: it.why }, '짐작') : null, it.edited ? h('span', { class: 'badge muted' }, '고침') : null);
      } },
      { label: '원문 줄', cls: 'clip', cell: function (it) { return h('small', { class: 'muted' }, it.source); } },
      { label: '', cell: function (it) { return h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': '이 줄 빼기', onclick: function () { d.items = d.items.filter(function (x) { return x !== it; }); App.save(); App.render(); } }, '빼기'); } }
    ], d.items, function (it) { return { class: I.checkItem(it).ok ? null : 'row-bad' }; }));
    card.appendChild(h('div', { class: 'btn-row', style: 'margin-top:10px' },
      h('button', { type: 'button', class: 'btn', onclick: function () { d.items.push({ lineNo: 0, poNo: hd.poNo || '', poFrom: hd.poNo ? '헤더' : '', partNo: '', desc: '', qty: '', unitPrice: '', amount: '', guessed: false, why: '', source: '(직접 추가)', edited: true }); App.save(); App.render(); } }, '줄 추가'),
      hd.poNo ? h('button', { type: 'button', class: 'btn', onclick: function () { var n = 0; d.items.forEach(function (it) { if (!it.poNo) { it.poNo = hd.poNo; it.poFrom = '헤더'; n++; } }); App.save(); App.render(); App.toast('PO 가 빈 ' + n + '줄에 ' + hd.poNo + ' 를 넣었습니다.'); } }, 'PO 빈 줄에 위쪽 PO 넣기') : null,
      h('button', { type: 'button', class: 'btn', onclick: function () {
        App.state.coPrefill = { invoice_no: hd.invoiceNo, po_no: I.invoicePos(d).join(', '), bl_no: lk.bls.length === 1 ? lk.bls[0].bl : '' };
        App.go('#/co');
      } }, '이 Invoice 로 원산지증명서 요청 만들기')));
    if (d.skipped && d.skipped.length) card.appendChild(h('details', null, h('summary', null, '부품으로 넣지 않은 줄 ' + d.skipped.length + '개 — 빠진 부품이 없는지 확인'),
      App.table([{ label: '줄', cell: function (x) { return String(x.lineNo); } }, { label: '원문', cls: 'clip', cell: function (x) { return x.text; } }, { label: '이유', cell: function (x) { return x.reason; } }], d.skipped)));
    main.appendChild(card);
    function tile(k, v, danger) { return h('div', { class: 'tile' + (danger ? ' danger' : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v', style: 'font-size:1.05rem' }, v)); }
  }

  // 스캔본: 반자동(프롬프트 복사 → ChatGPT 등에 파일과 함께 → 답 붙여넣기)과 선택 사항인 자동 보내기
  function aiCard(main, ds, sel) {
    var target = sel && (sel.needsAi || App.state.invAiOpen) ? sel : ds.filter(function (d) { return d.needsAi; })[0] || sel;
    if (!target) return;
    var m = mem()[target.id] || {};
    var prompt = I.aiPrompt(target.file, m.text || '');
    var ans = h('textarea', { rows: 6, placeholder: 'AI 가 돌려준 답(JSON)을 여기에 붙여넣어 주십시오.' });
    var cfg = AI.load();
    var box = h('details', { class: 'card', open: target.needsAi ? true : null }, h('summary', null, h('strong', null, 'AI 로 읽기 — 스캔본·사진 (' + target.file + ')')),
      h('p', { class: 'note' }, '스캔본은 글자가 그림이라 이 도구가 직접 읽지 못합니다. ① 아래 요청문을 복사해 ② ChatGPT 등에 Invoice 파일(또는 사진)과 함께 넣고 ③ 받은 답을 붙여넣으면 같은 표로 읽어 검산합니다. 회사 밖 서비스에 거래 문서를 올려도 되는지 먼저 확인해 주십시오.'),
      h('textarea', { rows: 8, readonly: true, value: prompt }),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: function () { App.copy(prompt); } }, '요청문 복사')),
      ans,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { applyAnswer(target, ans.value, 'AI(반자동)'); } }, '답 읽기'),
        AI.ready(cfg) ? h('button', { type: 'button', class: 'btn', onclick: function () { autoSend(target, prompt, cfg); } }, '자동으로 보내기(' + AI.baseOf(cfg.baseUrl).replace(/^https?:\/\//, '').split('/')[0] + ')') : null));
    // 자동 보내기 설정(선택)
    var f = { baseUrl: h('input', { type: 'text', value: cfg.baseUrl, placeholder: 'https://api.openai.com/v1 또는 사내 OpenAI 호환 주소' }), model: h('input', { type: 'text', value: cfg.model, placeholder: '그림을 읽는 모델 이름' }),
      apiKey: h('input', { type: 'password', value: cfg.apiKey, autocomplete: 'off' }), remember: h('input', { type: 'checkbox', checked: cfg.remember }) };
    box.appendChild(h('details', null, h('summary', null, '자동 보내기 설정(선택 — 없어도 반자동으로 됩니다)'),
      h('div', { class: 'form-grid' }, App.field('주소(Base URL)', f.baseUrl), App.field('모델', f.model), App.field('API 키(사내 서버가 키 없이 열려 있으면 비움)', f.apiKey),
        h('label', { class: 'check' }, f.remember, ' 키를 이 브라우저에 기억(끄면 창을 닫을 때 잊음)')),
      h('p', { class: 'note' }, '키는 코드·리포에 들어가지 않고, 기억을 켠 경우에만 이 브라우저에 저장됩니다. 스캔본 PDF 는 쪽 그림(최대 3쪽)을 함께 보냅니다.'),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: function () {
        var c = { baseUrl: f.baseUrl.value, model: f.model.value, apiKey: f.apiKey.value, remember: f.remember.checked };
        var chk = AI.check(c, location.protocol);
        if (chk.errors.length && (c.baseUrl || c.model)) { App.toast(chk.errors[0], true); return; }
        AI.save(c); App.toast('저장했습니다.' + (chk.warnings.length ? ' ' + chk.warnings[0] : '')); App.render();
      } }, '설정 저장'))));
    main.appendChild(box);
  }
  function applyAnswer(target, text, engine) {
    var r;
    try { r = I.parseAiAnswer(text); } catch (e) { App.toast(e.message, true); return; }
    target.header = r.header; target.items = r.items; target.totals = r.totals; target.skipped = [];
    target.notes = r.notes.concat(['AI 가 읽은 값입니다. 원본과 대조해 확인해 주세요.']); target.engine = engine; target.needsAi = false;
    App.state.invSel = target.id; App.save(); App.render();
    var s = I.docSummary(target);
    App.toast('AI 답에서 ' + s.lines + '줄을 읽었습니다' + (s.bad ? ' · 검산 확인 필요 ' + s.bad + '줄' : ''), s.bad > 0);
  }
  function autoSend(target, prompt, cfg) {
    var chk = AI.check(cfg, location.protocol);
    if (chk.errors.length) { App.toast(chk.errors[0], true); return; }
    var m = mem()[target.id] || {};
    var imgs = m.images ? Promise.resolve(m.images) : m.bytes ? pdfImages(m.bytes, 3) : Promise.resolve([]);
    App.toast('AI 에 보내는 중입니다…');
    imgs.then(function (list) {
      if (!list.length && !m.text) throw new Error('보낼 파일이 이 창에 없습니다(새로 고침하면 사라집니다). 파일을 다시 올려 주세요.');
      return AI.send(cfg, prompt, list);
    }).then(function (t) { applyAnswer(target, t, 'AI(자동)'); }, function (e) { App.toast(e.message, true); });
  }

  function exportXlsx() {
    var ds = docs(), rows = I.erpRows(ds), skipped = [];
    ds.forEach(function (d) { (d.skipped || []).forEach(function (x) { skipped.push({ '파일': d.file, 'Invoice No': d.header.invoiceNo, '줄': x.lineNo, '원문': x.text, '이유': x.reason }); }); });
    App.writeXlsx((App.db._sample ? '예시데이터_' : '') + 'Invoice_ERP_' + App.today() + '.xlsx', {
      'ERP 업로드': rows,
      'Invoice 요약': I.summaryRows(ds, App.db, L),
      '검산 확인 필요': rows.filter(function (r) { return r['검산'] !== 'OK'; }),
      '부품으로 안 넣은 줄': skipped
    });
  }
})(window);
