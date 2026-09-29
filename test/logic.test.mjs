// 실행: node test/logic.test.mjs   (의존성 없음)
// 기대값은 손으로 계산해 적었습니다(주석에 계산 근거).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const S = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const TODAY = '2026-09-28';
const ST = L.defaultSettings();

function sampleDb() {
  const db = L.emptyDb();
  const map = L.guessMapping(Object.keys(S.contactRows[0]), 'supplier');
  db.suppliers = L.importSuppliers(L.applyMapping(S.contactRows, map)).suppliers;
  db.pos = S.ledger(TODAY).map(p => L.cleanPo(p, db.suppliers));
  return db;
}

console.log('날짜');
test('점 구분 날짜', () => assert.equal(L.toDate('2026.09.28'), '2026-09-28'));
test('엑셀 일련번호 46293 = 2026-09-28 (46023=2026-01-01, +270일)', () => assert.equal(L.toDate(46293), '2026-09-28'));
test('12-Oct-2026', () => assert.equal(L.toDate('12-Oct-2026'), '2026-10-12'));
test('Oct 5, 2026', () => assert.equal(L.toDate('Oct 5, 2026'), '2026-10-05'));
test('03/04/2026 기본은 월/일', () => assert.equal(L.toDate('03/04/2026'), '2026-03-04'));
test('03/04/2026 일/월 선택', () => assert.equal(L.toDate('03/04/2026', true), '2026-04-03'));
test('없는 날짜 2026-02-30 은 빈 값', () => assert.equal(L.toDate('2026-02-30'), ''));
test('일수 차이 09-20 → 09-28 = 8', () => assert.equal(L.daysBetween('2026-09-20', '2026-09-28'), 8));

console.log('열 매핑·업체');
test('Contact List 열 짐작', () => {
  const m = L.guessMapping(Object.keys(S.contactRows[0]), 'supplier');
  assert.deepEqual(m, { code: 'Vendor Code', name: 'Supplier Name', contact: 'Contact', to: 'E-mail', cc: 'CC', phone: 'Tel', country: 'Country', checklist: 'Remarks' });
});
test('Weekly·Packing 열 짐작', () => {
  const w = L.guessMapping(Object.keys(S.weeklyOld[0]), 'weekly');
  assert.deepEqual(w, { po: 'PO Number', line: 'Line', part: 'Part Number', qty: 'Order Qty', promise: 'Promise Date' });
  const p = L.guessMapping(Object.keys(S.packingRows[0]), 'packing');
  assert.deepEqual(p, { group: 'Invoice No', part: 'Part No', qty: "Q'ty", weight: 'Gross Weight (kg)' });
});
test('필수 열 누락 표시', () => assert.deepEqual(L.missingRequired({ name: 'x' }, 'supplier'), ['수신 이메일(To)']));
test('업체 가져오기: 4곳, 도메인 추출', () => {
  const db = sampleDb();
  assert.equal(db.suppliers.length, 4);
  assert.equal(db.suppliers[0].domains, 'alpha-precision.example.com');
  assert.equal(db.suppliers[3].cc, '');
});
test('업체 검색(담당자 이름)', () => assert.deepEqual(L.searchSuppliers(sampleDb().suppliers, 'chen').map(s => s.code), ['EX-C03']));
test('메일 주소로 업체 찾기 — 같은 도메인의 다른 사람도 그 업체', () => {
  const sup = sampleDb().suppliers;
  assert.equal(L.supplierByEmail(sup, 'someone@charlie-hyd.example.com').code, 'EX-C03');
  assert.equal(L.supplierByEmail(sup, 'x@nowhere.example.com'), null);
});

console.log('PO 매칭');
test('파일명·본문에서 PO 번호와 업체', () => {
  const sup = sampleDb().suppliers;
  const f = S.poPdfs[0];
  const r = L.matchPoFile({ name: f.name, text: f.lines.join('\n') }, sup, ST);
  assert.equal(r.po_no, 'EX4500010011');
  assert.equal(r.supplier_code, 'EX-A01');
  assert.deepEqual(r.issues, []);
});
test('파일명에 PO 가 없으면 본문에서, 업체 미등록은 경고', () => {
  const sup = sampleDb().suppliers;
  const f = S.poPdfs[2];
  const r = L.matchPoFile({ name: f.name, text: f.lines.join('\n') }, sup, ST);
  assert.equal(r.po_no, 'EX4500010013');
  assert.equal(r.supplier_code, '');
  assert.ok(r.issues.includes('업체를 찾지 못했습니다'));
});
test('사용자 정규식', () => assert.deepEqual(L.poNumbersIn('ref 45001234 and 45009999', '45\\d{6}').list, ['45001234', '45009999']));
test('잘못된 정규식은 오류 문구', () => assert.match(L.poNumbersIn('x', '(').error, /정규식 오류/));

console.log('대장 상태');
test('송부 4일, OC 없음 → OC 미접수 (기준 3일 초과)', () => {
  const f = L.poFlags({ po_no: 'A', sent_date: '2026-09-24', oc_date: '' }, TODAY, ST);
  assert.equal(f[0].code, 'oc_overdue'); assert.equal(f[0].label, 'OC 미접수 4일');
});
test('송부 3일, OC 없음 → 아직 대기 (3일 초과가 아님)', () => {
  assert.equal(L.poFlags({ po_no: 'A', sent_date: '2026-09-25' }, TODAY, ST)[0].code, 'oc_wait');
});
test('EXW 이틀 남음 → 임박 D-2, 3일 지남 → 지연 3일', () => {
  const a = L.poFlags({ sent_date: '2026-09-01', oc_date: '2026-09-02', exw_promised: '2026-09-30' }, TODAY, ST);
  assert.deepEqual(a.map(x => x.label), ['EXW 임박 D-2']);
  const b = L.poFlags({ sent_date: '2026-09-01', oc_date: '2026-09-02', exw_promised: '2026-09-25' }, TODAY, ST);
  assert.deepEqual(b.map(x => x.label), ['EXW 지연 3일']);
});
test('기준값을 바꾸면 판정도 바뀜(OC 대기 5일)', () => {
  const st = Object.assign({}, ST, { oc_wait_days: 5 });
  assert.equal(L.poFlags({ sent_date: '2026-09-24' }, TODAY, st)[0].code, 'oc_wait');
});

console.log('OC 접수율·EXW 준수율');
const exwPos = [
  { exw_promised: '2026-10-01', exw_actual: '2026-10-01' }, // 0
  { exw_promised: '2026-10-01', exw_actual: '2026-10-05' }, // 4
  { exw_promised: '2026-10-10', exw_actual: '2026-10-08' }, // 이름 → 0
  { exw_promised: '2026-10-01', exw_actual: '2026-10-02' }, // 1
  { exw_promised: '2026-10-20', exw_actual: '' }            // 평가 제외
];
test('준수율 2/4 = 50%, 평균 지연 (0+4+0+1)/4 = 1.25일, 지연 건 평균 2.5일', () => {
  const r = L.exwStats(exwPos, '2026-09-28', ST);
  assert.equal(r.evaluated, 4); assert.equal(r.onTime, 2); assert.equal(r.rate, 0.5);
  assert.equal(r.avgDelay, 1.25); assert.equal(r.avgDelayLateOnly, 2.5);
});
test('허용 1일이면 준수율 3/4 = 75%', () => {
  assert.equal(L.exwStats(exwPos, '2026-09-28', Object.assign({}, ST, { exw_grace_days: 1 })).rate, 0.75);
});
test('예시 대장 OC 접수율 6/10, 미접수 3건(9·12·6일), 평균 회신 (3+1+1+4+5+2)/6 = 2.667일', () => {
  const r = L.ocStats(sampleDb().pos, TODAY, ST);
  assert.equal(r.sent, 10); assert.equal(r.received, 6); assert.equal(r.overdue, 3);
  assert.equal(Math.round(r.avgLeadDays * 1000), 2667);
});
test('예시 대장 EXW: 출고 4건 중 준수 2건(0001 정시, 0003 조기), 평균 (0+4+0+10)/4 = 3.5일, 미출고 지연 1건(0004)', () => {
  const r = L.exwStats(sampleDb().pos, TODAY, ST);
  assert.equal(r.evaluated, 4); assert.equal(r.onTime, 2); assert.equal(r.avgDelay, 3.5); assert.equal(r.openLate, 1);
});
test('업체별 집계: Alpha 3건, OC 3/3', () => {
  const rows = L.statsBySupplier(sampleDb().pos, sampleDb().suppliers, TODAY, ST);
  const a = rows.find(r => r.code === 'EX-A01');
  assert.equal(a.count, 3); assert.equal(a.oc.rate, 1);
});

console.log('OC 팔로우업');
test('미접수 건을 업체별로 묶음: Charlie 1건, Delta 2건(최대 12일)', () => {
  const db = sampleDb();
  db.settings.sender_name = 'Kim';
  const g = L.ocFollowups(db, TODAY);
  assert.deepEqual(g.map(x => [x.supplier_code, x.pos.length]), [['EX-C03', 1], ['EX-D04', 2]]);
  assert.equal(g[1].maxWait, 12);
  assert.ok(g[1].draft.body.includes('- PO EX4500010007 (Cast bracket), sent on 2026-09-16'));
  assert.ok(g[1].draft.body.includes('Dear Davide Rossi'));
  assert.equal(g[1].draft.to, 'd.rossi@delta-cast.example.com');
});

console.log('Promise Date 비교');
test('변경 2건(+7, -5), 신규 1, 삭제 1, 동일 2', () => {
  const m = L.guessMapping(Object.keys(S.weeklyOld[0]), 'weekly');
  const r = L.compareWeekly(L.applyMapping(S.weeklyOld, m), L.applyMapping(S.weeklyNew, m));
  assert.deepEqual(r.changed.map(c => [c.po, c.line, c.old, c.new, c.diffDays]), [
    ['EX4500010004', '1', '2026-10-12', '2026-10-19', 7],
    ['EX4500010010', '1', '2026-11-02', '2026-10-28', -5]
  ]);
  assert.deepEqual(r.added.map(x => x.po), ['EX4500010015']);
  assert.deepEqual(r.removed.map(x => x.po), ['EX4500010014']);
  assert.equal(r.same, 2);
});
test('날짜 형식만 다르고 같은 날이면 변경 아님', () => {
  const r = L.compareWeekly([{ po: 'P1', promise: '2026-10-05' }], [{ po: 'P1', promise: '05-Oct-2026' }]);
  assert.equal(r.changed.length, 0); assert.equal(r.same, 1);
});

console.log('Packing List 중량');
const pm = L.guessMapping(Object.keys(S.packingRows[0]), 'packing');
const pt = L.packingTotals(L.applyMapping(S.packingRows, pm), false);
test('합계 행(TOTAL)은 빼고 묶음별 합: 36.5+58.2+57.9=152.6, 210+45.5=255.5', () => {
  assert.deepEqual(pt.groups.map(g => [g.group, g.rows, g.total]), [['EX-INV-001', 3, 152.6], ['EX-INV-002', 2, 255.5]]);
  assert.deepEqual(pt.skippedRows, [5]);
});
test('B/L 152.6 → 일치, B/L 262 → 차이 -6.5kg 불일치', () => {
  assert.equal(L.compareWeight(152.6, 152.6, ST).status, 'ok');
  const r = L.compareWeight(255.5, 262, ST);
  assert.equal(r.status, 'mismatch'); assert.equal(r.diff, -6.5);
});
test('허용 3%(262×3%=7.86kg)면 일치, 허용 5kg 이면 불일치', () => {
  assert.equal(L.compareWeight(255.5, 262, Object.assign({}, ST, { weight_tol_pct: 3 })).status, 'ok');
  assert.equal(L.compareWeight(255.5, 262, Object.assign({}, ST, { weight_tol_kg: 5 })).status, 'mismatch');
});
test('개당 중량 열이면 수량을 곱함: 2kg×3 = 6kg', () => {
  assert.equal(L.packingTotals([{ weight: '2', qty: 3 }], true).groups[0].total, 6);
});
test('B/L 중량이 비면 판정 없음', () => assert.equal(L.compareWeight(10, '', ST).status, 'none'));

console.log('메일 파일');
test('base64: Man→TWFu, Ma→TWE=, 가→6rCA', () => {
  assert.equal(L.base64(L.utf8('Man')), 'TWFu');
  assert.equal(L.base64(L.utf8('Ma')), 'TWE=');
  assert.equal(L.base64(L.utf8('가')), '6rCA');
  assert.equal(new TextDecoder().decode(L.unbase64('6rCA')), '가');
});
test('crc32("123456789") = CBF43926', () => assert.equal(L.crc32(L.utf8('123456789')).toString(16), 'cbf43926'));
test('.eml 초안: 미발송 표시, 한글 제목 인코딩, 첨부, 다시 읽으면 제목·본문 그대로', () => {
  const eml = L.buildEml({ from: 'me@our.example.com', to: 'a@b.example.com', cc: 'c@b.example.com', subject: '[PO 1] 발주서 송부', body: '안녕하세요\n본문', attachments: [{ name: 'PO_1.pdf', type: 'application/pdf', bytes: L.utf8('%PDF') }] }, new Date(2026, 8, 28, 9, 0));
  assert.ok(eml.startsWith('X-Unsent: 1\r\n'));
  assert.ok(eml.includes('Subject: =?UTF-8?B?'));
  assert.ok(eml.includes('filename="PO_1.pdf"'));
  const back = L.parseEml(eml);
  assert.equal(back.subject, '[PO 1] 발주서 송부');
  assert.equal(back.body.replace(/\r\n/g, '\n'), '안녕하세요\n본문');
  assert.equal(back.date, '2026-09-28');
});
test('발주 메일 초안: 템플릿 빈칸과 체크리스트 채움', () => {
  const db = sampleDb();
  db.settings.sender_name = 'Kim'; db.settings.sender_company = 'Our Co.';
  const d = L.poMailDraft({ po_no: 'EX4500010011' }, db.suppliers[0], db, null);
  // 2026-09-29 실제 발주 메일 구성: 'Purchase Order [업체코드] : PO / 업체명', OC 요청 일수(기본 7일)
  assert.equal(d.subject, 'Purchase Order [EX-A01] : EX4500010011 / Alpha Precision GmbH (예시)');
  assert.ok(d.body.includes('provide the O.A/O.C within 7 days'));
  assert.ok(d.body.includes('PO NO: EX4500010011'));
  assert.ok(d.body.includes('- OC 에 EXW DATE 기재 요청'));
  assert.equal(d.cc, 'sales@alpha-precision.example.com');
});
test('Q 인코딩 제목 해독', () => assert.equal(L.parseEml('Subject: =?utf-8?Q?OC_=ED=99=95=EC=9D=B8?=\r\n\r\nx').subject, 'OC 확인'));

console.log('메일 분류');
test('Charlie OC 메일 → 업체 EX-C03, PO 0006, OC 후보', () => {
  const db = sampleDb();
  const m = S.mails(TODAY).map(x => L.classifyMail(L.parseEml(x.text), db));
  assert.equal(m[0].supplier_code, 'EX-C03');
  assert.deepEqual(m[0].pos, ['EX4500010006']);
  assert.deepEqual(m[0].ocCandidates, ['EX4500010006']);
  assert.deepEqual(m[1].ocCandidates, []);          // 문의 메일: OC 낱말 없음
  assert.equal(m[1].supplier_code, 'EX-D04');
  assert.equal(m[3].supplier_code, '');             // 미등록 발신자
});
test('OC 수령일 반영: 비어 있는 건만', () => {
  const r = L.applyOcDates([{ po_no: 'A', oc_date: '' }, { po_no: 'B', oc_date: '2026-09-01' }], [{ po_no: 'A', date: TODAY }, { po_no: 'B', date: TODAY }]);
  assert.equal(r.applied, 1); assert.equal(r.pos[0].oc_date, TODAY); assert.equal(r.pos[1].oc_date, '2026-09-01');
});

console.log('대장 가져오기·묶음');
test('같은 PO 는 빈 값이 아닌 항목만 덮어씀', () => {
  const r = L.upsertPos([{ po_no: 'A', oc_date: '2026-09-01', note: 'x' }], [{ po_no: 'A', oc_date: '', note: 'y' }, { po_no: 'B' }]);
  assert.equal(r.updated, 1); assert.equal(r.added, 1);
  assert.equal(r.pos[0].oc_date, '2026-09-01'); assert.equal(r.pos[0].note, 'y');
});
test('대장 내보내기 → 다시 가져오기 열 짐작이 모두 맞음', () => {
  const rows = L.ledgerRows(sampleDb(), TODAY);
  const m = L.guessMapping(Object.keys(rows[0]), 'ledger');
  ['po_no', 'supplier_code', 'item', 'sent_date', 'oc_date', 'exw_promised', 'exw_actual', 'an_received', 'docs_received'].forEach(k => assert.ok(m[k], k));
  assert.equal(m.oc_date, 'OC 수령일'); assert.equal(m.exw_promised, '약속 EXW DATE');
});
test('ZIP: 머리 PK0304, 끝 레코드에 파일 2개', () => {
  const z = L.makeZip([{ name: 'a.eml', text: 'hi' }, { name: '한글.eml', text: 'x' }]);
  assert.deepEqual([...z.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const e = z.length - 22;
  assert.deepEqual([...z.slice(e, e + 4)], [0x50, 0x4b, 0x05, 0x06]);
  assert.equal(z[e + 10], 2);
});
test('예시 PDF 는 %PDF 로 시작하고 xref 위치가 맞음', () => {
  const b = L.makeSimplePdf(['PO No.: X1']);
  const s = new TextDecoder().decode(b);
  assert.ok(s.startsWith('%PDF-1.4'));
  const x = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.equal(s.slice(x, x + 4), 'xref');
});

// ─────────────────────────────────────────────────────────────
// 2026-09-29 메일 자료(실물 PO·OC·회신 메일·주간 오더 현황·항차 매뉴얼) 반영분
// 시험 입력은 모두 실물과 같은 배치의 예시값(sample-data.js)입니다.
console.log('PO 번호 체계·PO 본문 읽기');
test('영문 1자+숫자 9자리 PO 번호를 「PO」 낱말 없이도 찾고, 글 속 순서대로', () => {
  assert.deepEqual(L.poNumbersIn('RE: Purchase Order [EX-E05] : O261110502, M261110501 / Echo').list, ['O261110502', 'M261110501']);
  assert.deepEqual(L.poNumbersIn('INV 400181101 and X12345678901').list, []);   // 숫자만·자릿수 다른 것은 아님
  assert.equal(L.poFromFileName('M261110501.pdf'), 'M261110501');
});
test('PDF 줄 배치(pdftotext -layout 형): PO·업체·품목 2줄·금액·납기·Mfr 품번', () => {
  const r = L.parsePoText(S.realPoLines.join('\n'));
  assert.equal(r.po_no, 'M261110501'); assert.equal(r.supplier, 'Echo Lighting Inc.');
  assert.equal(r.po_date, '2026-09-01'); assert.equal(r.issued_date, '2026-09-01');
  assert.deepEqual([r.currency, r.amount, r.incoterms, r.incoterms_place, r.origin], ['USD', 1970, 'EXW', 'Example Port', 'U.S.A']);
  // 200×5.50 = 1,100 · 120×7.25 = 870 · 합 1,970 = Contract Amount → 경고 없음
  assert.deepEqual(r.lines.map(l => [l.seq, l.part, l.qty, l.price, l.amount, l.delivery, l.mfr_part, l.desc]), [
    [1, 'EX11-10001', 200, 5.5, 1100, '2026-10-30', 'EC-2001', 'LAMP-EXAMPLE A'],
    [2, 'EX11-10002', 120, 7.25, 870, '2026-10-30', 'EC-2002', 'LAMP-EXAMPLE B']]);
  assert.equal(r.delivery_date, '2026-10-30'); assert.deepEqual(r.warnings, []);
});
test('PDF 뷰어에서 복사한 열 단위 배치도 짝지어 읽음(Our Ref. 뒤 칸 이름 건너뜀)', () => {
  const r = L.parsePoText(S.realPoPaste);
  assert.equal(r.po_no, 'O261110502'); assert.deepEqual(r.refs, ['O261110502']);
  assert.deepEqual(r.lines.map(l => [l.part, l.qty, l.price, l.amount, l.delivery, l.mfr_part]), [['EX22-20001', 60, 12, 720, '2026-10-15', 'EC-3001']]);
  assert.deepEqual(r.warnings, []);
});
test('수량×단가 ≠ 금액, 합계 ≠ Contract Amount 이면 경고', () => {
  const r = L.parsePoText(S.realPoLines.join('\n').replace('870      Oct', '900      Oct'));
  assert.ok(r.warnings.some(w => /2번 줄/.test(w)));                 // 120×7.25=870 ≠ 900
  assert.ok(r.warnings.some(w => /합계\(2000\)/.test(w)));           // 1100+900 = 2000 ≠ 1970
});
test('품목 요약: 첫 품번 외 n건', () => assert.equal(L.itemSummary(L.parsePoText(S.realPoLines.join('\n')).lines), 'EX11-10001 외 1건'));

console.log('항차 매뉴얼 규칙');
test('지역: U.S.A → 미국 60일, Germany → 유럽 90일, 중국 → 15일, 모름 → null', () => {
  assert.deepEqual(L.transitDays('U.S.A', ST), { region: '미국', days: 60 });
  assert.equal(L.transitDays('Germany', ST).days, 90);
  assert.equal(L.transitDays('중국', ST).days, 15);
  assert.equal(L.transitDays('Brazil', ST), null);
});
test('Delivery 2026-10-30 − 60일 = 2026-08-31, ETD 2026-09-10 + 60일 = 2026-11-09', () => {
  assert.equal(L.exwTarget('2026-10-30', 'USA', ST), '2026-08-31');
  assert.equal(L.etaFromEtd('2026-09-10', 'USA', ST), '2026-11-09');
});
test('L/C: 신청 2026-09-25(금) → 개설 09-29(화, 2영업일) → 최종선적 2027-03-29 → 유효 2027-04-19', () => {
  assert.deepEqual(L.lcDates('2026-09-25'), { open: '2026-09-29', lastShipment: '2027-03-29', expiry: '2027-04-19' });
  assert.equal(L.addMonths('2026-08-31', 6), '2027-02-28');       // 말일 보정
});
test('항차 체크리스트: 송부·OC·약속 EXW 가 있으면 자동 완료, L/C 는 선택 단계라 분모에서 뺌', () => {
  const p = L.cleanPo({ po_no: 'M1', sent_date: '2026-09-01', oc_date: '2026-09-03' }, []);
  const v0 = L.voyageProgress(p);
  assert.equal(v0.total, L.VOYAGE_STEPS.length - 1); assert.equal(v0.done, 2); assert.equal(v0.next.key, 'po_delivery');
  p.voyage.po_delivery = '2026-09-01'; p.exw_promised = '2026-10-20';
  assert.equal(L.voyageProgress(p).done, 4); assert.equal(L.voyageProgress(p).next.key, 'docs_download');
});
test('대장 가져오기: 빈 품목 줄·빈 체크리스트로 기존 값을 지우지 않음', () => {
  const lines = [{ part: 'A', qty: 1 }];
  const r = L.upsertPos([L.cleanPo({ po_no: 'M1', lines: lines, voyage: { ci_check: '2026-09-01' } }, [])], [L.cleanPo({ po_no: 'M1', note: 'x' }, [])]);
  assert.deepEqual(r.pos[0].lines, lines); assert.equal(r.pos[0].voyage.ci_check, '2026-09-01'); assert.equal(r.pos[0].note, 'x');
});

console.log('OC 회신 메일(.eml, 실물 구조)');
const ocB64 = Buffer.from('fake-xls').toString('base64');
const reply = L.parseEml(S.replyEml(TODAY, S.ocFiles.map(f => ({ name: f.name, b64: ocB64 }))), { tzOffsetMin: 540 });
test('multipart/mixed ⊃ alternative: 제목(RFC 2047 섞임)·참조 한글 이름·본문(base64 plain)', () => {
  assert.equal(reply.subject, 'RE: Purchase Order [EX-E05] : O261110502, M261110501 / Echo Lighting Inc. (예시)');
  assert.ok(reply.cc.startsWith('김예시(Kim, Example)/사원/생산관리팀 <buyer@'));
  assert.ok(reply.body.startsWith('Good afternoon,'));
});
test('받은 날: 전날 19:19 UTC → 한국 시간(+9)으로 오늘', () => assert.equal(reply.date, TODAY));
test('첨부 2개: 파일명·크기(base64 해독)', () => {
  assert.deepEqual(reply.attachments.map(a => [a.name, a.size, a.inline]), S.ocFiles.map(f => [f.name, 8, false]));
  assert.equal(new TextDecoder().decode(reply.attachments[0].bytes), 'fake-xls');
});
test('RFC 2231 파일명(filename*=utf-8\'\'…)과 quoted-printable 본문', () => {
  const raw = 'Subject: x\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>OC =EC=A0=91=EC=88=98</p>\r\n--b\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename*=utf-8\'\'OC%20%ED%99%95%EC%9D%B8.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERg==\r\n--b--\r\n';
  const m = L.parseEml(raw);
  assert.equal(m.body.trim(), 'OC 접수'); assert.equal(m.attachments[0].name, 'OC 확인.pdf');
});
test('파일 바이트(Uint8Array)로 읽으면 8비트 본문도 charset 대로', () => {
  const raw = 'Subject: t\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n오더 확인\r\n';
  assert.equal(L.parseEml(L.utf8(raw)).body.trim(), '오더 확인');
});

console.log('OC 회신 분류·OC 엑셀 대조');
function realDb() {
  const db = sampleDb();
  db.suppliers = L.mergeSuppliers(db.suppliers, L.importSuppliers(L.applyMapping([S.echoSupplier], L.guessMapping(Object.keys(S.echoSupplier), 'supplier'))).suppliers);
  db.pos = db.pos.concat(S.realLedger(TODAY).map(p => L.cleanPo(p, db.suppliers)));
  return db;
}
test('회신 메일 → Echo 업체, PO 2건, OC 첨부 2개, OC 수령일 후보 2건', () => {
  const c = L.classifyMail(reply, realDb());
  assert.equal(c.supplier_code, 'EX-E05'); assert.equal(c.supplier_via, 'email');
  assert.deepEqual(c.pos.sort(), ['M261110501', 'O261110502']);
  assert.deepEqual(c.ocFiles, S.ocFiles.map(f => f.name));
  assert.deepEqual(c.ocCandidates.sort(), ['M261110501', 'O261110502']);
  assert.ok(c.keywords.includes('order confirmation'));     // 본문은 복수형 'order confirmations'
});
test('발신 도메인이 마스터에 없어도 PO 번호가 한 업체 것이면 그 업체로(via po)', () => {
  const db = realDb();
  db.suppliers.forEach(s => { if (s.code === 'EX-E05') { s.to = 'x@other.example.com'; s.cc = ''; s.domains = 'other.example.com'; } });
  const c = L.classifyMail(reply, db);
  assert.equal(c.supplier_code, 'EX-E05'); assert.equal(c.supplier_via, 'po');
  assert.equal(c.ocCandidates.length, 2);
});
test('대장에 없는 PO 번호는 따로 알림', () => {
  const db = realDb(); db.pos = db.pos.filter(p => p.po_no !== 'O261110502');
  assert.deepEqual(L.classifyMail(reply, db).unknownPos, ['O261110502']);
});
test('OC 첨부 판정: 파일명 OC·확장자, 본문 속 그림(inline)은 제외', () => {
  assert.ok(L.isOcAttachment({ name: 'EX001 M261110501 OC 900101 10-20-26.xls' }));
  assert.ok(!L.isOcAttachment({ name: 'image008.png', inline: true }));
  assert.ok(!L.isOcAttachment({ name: 'DOCUMENT.xls' }));            // 'OC' 가 낱말 안에 있는 것은 아님
});
test('OC 파일명: OC 번호 900101, 날짜 10-20-26 → 2026-10-20(월-일-연), PO', () => {
  assert.deepEqual(L.parseOcFileName(S.ocFiles[0].name), { oc_no: '900101', date: '2026-10-20', pos: ['M261110501'] });
});
test('OC 엑셀(16행 머리글) 읽기', () => {
  const oc = L.parseOcGrid(S.ocGrid('M261110501'), S.ocFiles[0].name);
  assert.equal(oc.is_oc, true); assert.equal(oc.oc_no, '900101'); assert.equal(oc.doc_date, '2026-10-20');
  assert.deepEqual(oc.lines.map(l => [l.po, l.cust_part, l.sup_part, l.qty, l.price]), [['M261110501', 'EX11-10001', 'EC-2001', 200, 5.5], ['M261110501', 'EX11-10002', 'EC-2002', 100, 7.25]]);
});
test('파일명에 날짜가 없으면 서명란 날짜(엑셀 일련번호 46315 = 2026-10-20)', () => {
  assert.equal(L.parseOcGrid(S.ocGrid('M261110501'), 'oc.xls').doc_date, '2026-10-20');
});
test('OC ↔ PO 대조: 수량 다름(120/100) 1건, 나머지 일치', () => {
  const db = realDb();
  const c = L.compareOcToPo(db.pos.find(p => p.po_no === 'M261110501'), L.parseOcGrid(S.ocGrid('M261110501'), S.ocFiles[0].name));
  assert.equal(c.issues, 1); assert.equal(c.oc_date, '2026-10-20');
  assert.deepEqual(c.rows.map(r => r.notes.map(n => n.text).join('; ')), ['일치', '수량 다름(PO 120 / OC 100)']);
});
test('OC ↔ PO 대조: 공급사 품번 다름·납기보다 늦은 출하 예정일(10-15 → 10-20, 5일)', () => {
  const db = realDb();
  const c = L.compareOcToPo(db.pos.find(p => p.po_no === 'O261110502'), L.parseOcGrid(S.ocGrid('O261110502'), S.ocFiles[1].name));
  assert.deepEqual(c.rows[0].notes.map(n => n.text), ['공급사 품번 다름(PO Mfr EC-3001 / OC EC-3009)', 'OC 출하 예정일이 PO 납기보다 5일 늦음']);
});
test('OC 에 없는 PO 줄은 따로 표시', () => {
  const oc = L.parseOcGrid(S.ocGrid('M261110501'), S.ocFiles[0].name); oc.lines.pop();
  const c = L.compareOcToPo(realDb().pos.find(p => p.po_no === 'M261110501'), oc);
  assert.equal(c.rows[1].notes[0].text, 'OC 에 없는 PO 줄');
});
test('묶음 발주 메일: 한 업체 PO 2건을 한 통에', () => {
  const db = realDb();
  const s = db.suppliers.find(x => x.code === 'EX-E05');
  const d = L.poMailDraftGroup(db.pos.filter(p => p.supplier_code === 'EX-E05'), s, db, []);
  assert.equal(d.subject, 'Purchase Order [EX-E05] : M261110501, O261110502 / Echo Lighting Inc. (예시)');
  assert.ok(d.body.includes('PO NO: M261110501, O261110502'));
});

console.log('Weekly Order Status(실물 열 구성)');
const wm = L.guessMapping(S.WOS_HEAD, 'weekly');
test('열 짐작: Customer PO·Part No.·QTY·Promise Date·1OM#·SO#·Req Date·Status·Remarks', () => {
  assert.deepEqual(wm, { po: 'Customer PO', part: 'Part No.', qty: 'QTY', promise: 'Promise Date', om: '1OM#', so: 'SO#', req: 'Req Date', status: 'Status', remarks: 'Remarks' });
});
test('Promise Date 칸: cancelled / 10/5/2026=>9/28 / 엑셀 일련번호', () => {
  assert.equal(L.parsePromiseCell('cancelled').cancelled, true);
  const c = L.parsePromiseCell('10/5/2026=>9/28'); assert.equal(c.prev, '2026-10-05'); assert.equal(c.date, '2026-09-28');
  assert.equal(L.parsePromiseCell(46293).date, '2026-09-28');
  assert.equal(L.parsePromiseCell('12/20/2026=>1/10').date, '2027-01-10');   // 해를 넘김
});
test('두 주차 비교: 밀림 +14, 당김 −7, 취소 1, 신규 1, 빠짐 1, 같음 1 — 같은 PO·품번 두 줄은 SO# 로 구분', () => {
  const r = L.compareWeekly(L.applyMapping(S.weeklyWk37, wm), L.applyMapping(S.weeklyWk38, wm));
  assert.deepEqual(r.changed.map(c => [c.po, c.so, c.old, c.new, c.diffDays, c.dir]), [
    ['M261200011', '70001', '2026-09-30', '2026-10-14', 14, 'later'],
    ['O261200020', '70010', '2026-10-05', '2026-09-28', -7, 'earlier'],
    ['B261200030', '70020', '2026-10-20', 'cancelled', null, 'cancel']
  ].sort((a, b) => (b[4] || 0) - (a[4] || 0)));
  assert.deepEqual(r.added.map(x => x.po), ['M261200050']);
  assert.deepEqual(r.removed.map(x => x.po), ['M261200040']);
  assert.equal(r.same, 1);
  assert.equal(r.duplicates.length, 1);                                    // 같은 PO·품번 여러 행 알림
});
test('SO# 가 바뀌면 PO·품번 나온 순서로 다시 맞춤(빠짐·신규로 쪼개지지 않음)', () => {
  const a = [{ po: 'M1', part: 'P', so: '1', promise: '2026-10-01' }, { po: 'M1', part: 'P', so: '2', promise: '2026-10-05' }];
  const b = [{ po: 'M1', part: 'P', so: '', promise: '2026-10-01' }, { po: 'M1', part: 'P', so: '2', promise: '2026-10-09' }];
  const r = L.compareWeekly(a, b);
  assert.equal(r.added.length, 0); assert.equal(r.removed.length, 0);
  assert.deepEqual(r.changed.map(c => c.diffDays), [4]);
});
test('한 주 파일만: 칸 안 변경·Remarks 변경 기록(여러 번이면 처음→마지막)', () => {
  const x = L.weeklyInFileChanges(L.applyMapping(S.weeklyWk38, wm));
  assert.deepEqual(x.map(c => [c.po, c.source, c.old, c.new, c.diffDays]), [
    ['M261200011', 'Remarks', '2026-09-30', '2026-10-14', 14],
    ['O261200020', 'Promise Date 칸', '2026-10-05', '2026-09-28', -7],
    ['B261200030', 'Promise Date 칸', '', 'cancelled', null]]);
  const y = L.weeklyInFileChanges([{ po: 'M1', promise: '2026-07-21', remarks: 'Promise date 7/11=> 7/28 => 7/21' }]);
  assert.deepEqual([y[0].old, y[0].new, y[0].diffDays], ['2026-07-11', '2026-07-21', 10]);
});

console.log('중량 입력 양식');
test('붙여넣기(탭 구분, 머리글 있음) → 행', () => {
  const t = L.parseTsv('Invoice No\tPart No\tGross Weight (kg)\nINV-1\tA\t10.5\nINV-1\tB\t4,000');
  assert.deepEqual(t.headers, ['Invoice No', 'Part No', 'Gross Weight (kg)']);
  const tot = L.packingTotals(L.applyMapping(t.rows, L.guessMapping(t.headers, 'packing')), false);
  assert.equal(tot.groups[0].total, 4010.5);
});
test('머리글 없는 붙여넣기는 열1·열2…, lb → kg 환산 1000lb = 453.592kg', () => {
  assert.deepEqual(L.parseTsv('A  12.5\nB  3').headers, ['열1', '열2']);
  assert.equal(Math.round(1000 * L.LB_TO_KG * 1000) / 1000, 453.592);
});

console.log('Cummins 분석 시트 → 대장 EXW DATE (메일 추가 요청 2, 09-29 오후 늦게 답변 반영)');
const cg = S.cumGrid();
const crows = L.cumminsRows(cg.grid, cg.yellow);
const cpos = () => S.cumLedger(TODAY).map(p => L.cleanPo(p, []));
const COPT = { status: 'Undispatched', gubun: 'HCE', asOf: S.CUM_AS_OF };
const cplan = L.cumminsExwPlan(crows.rows, cpos(), COPT);
test('2행 머리글 찾기, 합계 줄(PO·품번 없음)은 뺌, 노란 줄 4개 표시, INV# 열 있음', () => {
  assert.equal(crows.headerRow, 2); assert.equal(crows.rows.length, 10);
  assert.equal(crows.rows.filter(r => r.yellow).length, 4); assert.equal(crows.hasInv, true);
});
test('Status 오늘 기준 재계산 = 파일 수식 IF(INV# 빔, IF(Promise<TODAY,Abnormal,Undispatched), Dispatched)', () => {
  const f = (inv, promise, promiseRaw) => L.cumminsStatusAsOf({ inv, promise, promiseRaw }, '2026-09-28');
  assert.equal(f('INV-1', '2026-01-01', ''), 'Dispatched');
  assert.equal(f('', '2026-09-27', ''), 'Abnormal');
  assert.equal(f('', '2026-09-28', ''), 'Undispatched');        // 같은 날은 < 가 아니므로 Undispatched
  assert.equal(f('', '', ''), 'Abnormal');                      // 빈 칸은 엑셀에서 0 으로 비교
  assert.equal(f('', '', 'cancelled'), 'Undispatched');         // 글자는 숫자보다 크게 비교
  assert.equal(L.cumminsStatusAsOf({ status: 'x', inv: '', promise: '2026-12-01' }, '2026-09-28'), 'x');   // 손으로 적은 값은 그대로
  assert.equal(L.cumminsStatusAsOf({ status: ' undispatched ', inv: '', promise: '2026-09-01' }, '2026-09-28'), 'Abnormal');
});
test('거르기(기본값): 오늘 기준 Undispatched · HCE → Abnormal 1줄 제외, 6줄 5묶음, HDX·Dispatched 제외', () => {
  assert.equal(cplan.counts.target, 6); assert.equal(cplan.counts.groups, 5); assert.equal(cplan.counts.restatus, 1);
  assert.ok(!cplan.target.some(r => r.po === 'M261300090'));                            // 저장값 Undispatched, 기준일 기준 Abnormal
  assert.ok(!cplan.groups.concat(cplan.notInLedger).some(g => g.po === 'M261300040'));   // HDX
  assert.equal(cplan.counts.yellow, 2);                                                 // 노란 줄 중 거른 뒤 남는 것(분할 2줄)
  assert.equal(L.cumminsExwPlan(crows.rows, cpos(), { status: 'Undispatched', gubun: 'HCE' }).counts.target, 7);  // 저장값 그대로면 7줄(대소문자·공백 무시)
});
test('분할 선적: 같은 PO·품번 두 날짜 10+6 = 16 = PO 수량 → 일치, 노란 줄·EXW 변경(10-07 → 10-14·10-28)', () => {
  const g = cplan.groups.find(x => x.po === 'M261300011');
  assert.deepEqual(g.schedule.map(x => [x.date, x.qty, x.yellow]), [['2026-10-14', 10, true], ['2026-10-28', 6, true]]);
  assert.equal(g.remainQty, 16); assert.equal(g.state, 'match'); assert.equal(g.yellow, true); assert.equal(g.changed, true);
});
test('수량 대조는 거른(미선적) 줄만: 남은 4 vs PO 8 → 부족 4(출고 2 는 참고), 12 vs OC 10 → 초과 2', () => {
  const a = cplan.groups.find(x => x.po === 'O261300020');
  assert.deepEqual([a.outsideQty, a.remainQty, a.state], [2, 4, 'check']);
  assert.deepEqual(a.issues, ['미선적 수량 합 4 ≠ PO 수량 8(부족 4)']);
  assert.deepEqual(cplan.groups.find(x => x.po === 'B261300030').issues, ['미선적 수량 합 12 ≠ OC 수량 10(초과 2)']);
});
test('날짜 형식: 엑셀 일련번호 46309 · 글자 11/2/2026 · Date 객체', () => {
  assert.equal(cplan.groups.find(x => x.po === 'M261300060').schedule[0].date, '2026-11-02');
  assert.equal(L.parsePromiseCell(46309).date, '2026-10-14');
  assert.equal(L.parsePromiseCell(new Date(2026, 9, 7)).date, '2026-10-07');
});
test('대장에 없는 PO(M261300050), 대장에만 있는 PO(M261300070)', () => {
  assert.deepEqual(cplan.notInLedger.map(g => g.po), ['M261300050']);
  assert.deepEqual(cplan.ledgerMissing.map(x => [x.po_no, x.part]), [['M261300070', 'EXE-7007']]);
});
test('반영: 일치 2건만 고르면 그 PO만 바뀜, 약속 EXW = 가장 이른 날, 품번별 일정 저장', () => {
  const keys = cplan.groups.filter(g => g.state === 'match').map(g => g.key);
  const r = L.applyCumminsExw(cpos(), cplan.groups, keys);
  assert.equal(r.changes.length, 2);
  const p = r.pos.find(x => x.po_no === 'M261300011');
  assert.equal(p.exw_promised, '2026-10-14');
  assert.deepEqual(p.exw_plan['EXE-1001'].map(x => [x.date, x.qty]), [['2026-10-14', 10], ['2026-10-28', 6]]);
  assert.equal(r.pos.find(x => x.po_no === 'O261300020').exw_promised, '');   // 불일치 건은 고르지 않으면 그대로
  assert.equal(r.changes[0].before_exw, '2026-10-07');
  assert.equal(L.exwPlanText(p), 'EXE-1001: 2026-10-14×10, 2026-10-28×6');
});
test('거르기 값을 비우면 전체(구분 HDX·출고·Abnormal 포함)', () => {
  assert.equal(L.cumminsExwPlan(crows.rows, cpos(), { status: '', gubun: '', asOf: S.CUM_AS_OF }).counts.target, 10);
});
test('SRM 입력 목록: 분할 선적은 건별 한 줄(1/2·2/2), 대장에 없는 PO 도 포함, cancelled 는 빠짐', () => {
  const e = L.exwEntries(cplan.groups.concat(cplan.notInLedger));
  assert.deepEqual(e.filter(x => x.po === 'M261300011').map(x => [x.seq, x.date, x.qty]), [['1/2', '2026-10-14', 10], ['2/2', '2026-10-28', 6]]);
  assert.equal(e.length, 6);
  assert.equal(e.find(x => x.po === 'M261300050').inLedger, false);
  assert.equal(L.exwEntries([{ po: 'X', part: 'P', state: 'match', schedule: [{ date: 'cancelled', qty: 1, rows: [1], week: [] }] }]).length, 0);
});

console.log('지난주 파일과 비교 → 달라진 줄 = 노란 표시 (09-29 오후 늦게 답변 4)');
const prev = L.cumminsRows(S.cumPrevGrid().grid, {}).rows;
const wd = L.cumminsWeekDiff(prev, crows.rows);
test('SO# 까지 키로 맞춤: 달라진 줄 2(날짜·수량 / 날짜), 새 줄 1(분할 추가), 빠진 줄 1', () => {
  assert.deepEqual([wd.counts.changed, wd.counts.added, wd.counts.removed], [2, 1, 1]);
  assert.deepEqual(wd.byRow[3].changes.map(c => [c.field, c.old, c.new]), [['Promise Date', '2026-10-07', '2026-10-14'], ['QTY', 16, 10]]);
  assert.equal(wd.byRow[4].added, true);                                               // 80002 — 지난주에 없던 분할
  assert.deepEqual(wd.byRow[6].changes.map(c => [c.old, c.new]), [['2026-09-28', '2026-10-05']]);
  assert.deepEqual(wd.removed.map(r => r.po), ['M261300070']);
});
test('Status 만 바뀐 줄(Undispatched → Dispatched, INV# 생김)은 「다름」이 아님', () => {
  assert.equal(wd.byRow[5], undefined);
  assert.equal(wd.byRow[12], undefined);   // 같은 값(저장 Status 도 같음)
});
test('SO# 가 지난주엔 비어 있던 줄도 PO·품번 나온 순서로 맞춤', () => {
  const p = [{ rowNo: 3, po: 'A1', part: 'P1', om: '', so: '', qty: 5, promise: '2026-10-01', promiseRaw: '' }];
  const c = [{ rowNo: 3, po: 'A1', part: 'P1', om: '1', so: '90', qty: 5, promise: '2026-10-01', promiseRaw: '' }];
  const d = L.cumminsWeekDiff(p, c);
  assert.deepEqual([d.counts.same, d.counts.added, d.counts.removed], [1, 0, 0]);
});
test('계획에 붙이기: 색 없는 밀림(O261300020)도 「다름」, 표시 대상 = 노란 칠 ∪ 지난주와 다름 = 3줄', () => {
  const pl = L.cumminsExwPlan(crows.rows, cpos(), Object.assign({ weekDiff: wd }, COPT));
  assert.deepEqual([pl.counts.yellow, pl.counts.weekChanged, pl.counts.marked], [2, 3, 3]);
  const o = pl.groups.find(x => x.po === 'O261300020');
  assert.equal(o.yellow, false); assert.equal(o.weekChanged, true);
  assert.deepEqual(o.schedule[0].week, ['Promise Date 2026-09-28 → 2026-10-05']);
  assert.equal(L.weekNoteText(wd.byRow[4]), '지난주 파일에 없던 줄');
  assert.equal(cplan.groups.find(x => x.po === 'O261300020').weekChanged, false);   // 지난주 파일을 안 올리면 판정 안 함
});

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패 있음' : ''));
