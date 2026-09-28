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
  assert.equal(d.subject, '[PO EX4500010011] Purchase Order from Our Co.');
  assert.ok(d.body.includes('Dear Anna Keller'));
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

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패 있음' : ''));
