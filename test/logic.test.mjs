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
  assert.equal(f('', '2026-09-02', ''), 'Abnormal');
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

console.log('도착 통지(A/N) — 포워더 메일 읽기 · 항차등록 대기 · ETA 변경 (09-29 저녁 요청)');
function anDb() {
  const db = sampleDb();
  db.pos = S.ledger(TODAY).map(p => L.cleanPo(p, db.suppliers));
  return db;
}
function anRecs(db) {
  return S.anMails(TODAY).map(m => L.parseArrivalNotice(L.parseEml(L.utf8(m.text), { tzOffsetMin: 540 }), db, { file: m.name, now: '2026-09-28T09:00:00Z' }));
}
const adb = anDb(); const ar = anRecs(adb);
test('양식 ①(영문 「라벨 : 값」): B/L·Master B/L·선명/항차 한 칸·DD-MON-YYYY·컨테이너 크기·포장·중량·PO', () => {
  const f = ar[0].fields;
  assert.deepEqual([f.bl, f.mbl, f.vessel, f.voyage, f.etd, f.eta], ['ALGS2609001', 'EXMU000000000001', 'EXAMPLE STAR', '012E', '2026-09-26', '2026-10-24']);
  assert.deepEqual([f.pol, f.pod, f.containers, f.packages, f.weight, f.pos], ['HAMBURG, GERMANY', 'BUSAN, KOREA', 'EXMU1234565(40HC)', '6 PLTS', '2,480.50 KGS', 'EX4500010002']);
  assert.equal(f.forwarder, 'Alpha Logistics Import (sample)');     // 라벨이 없어 보낸 사람 이름
  assert.match(ar[0].src.eta, /^ETA\s+: 24-OCT-2026$/);                // 근거 원문 줄
  assert.match(ar[0].src.forwarder, /^From: /);
});
test('양식 ②(국문 HTML 표, base64): 칸 사이를 탭으로 읽어 한 줄의 여러 칸을 나눔, 2026.10.02 날짜, 발주번호(REF)', () => {
  const f = ar[1].fields;
  assert.deepEqual([f.bl, f.vessel, f.voyage, f.etd, f.eta, f.pol, f.pod], ['BTSH26090055', 'EXAMPLE OCEAN', '2609W', '2026-09-27', '2026-10-02', 'SHANGHAI, CHINA', '부산 신항']);
  assert.deepEqual([f.containers, f.packages, f.weight, f.pos, f.forwarder], ['EXGU7654326(20GP)', '35 CTNS', '812 KG', 'EX4500010005', '베타해운 수입팀(예시)']);
  assert.equal(ar[1].src.eta, '입항예정일 2026.10.02');                  // 표 한 줄에서 그 칸만
});
test('양식 ③(라벨 다음 줄에 값): Mon DD, YYYY, lb 중량 kg 환산, 컨테이너 2개, PO 번호 없음', () => {
  const f = ar[2].fields;
  assert.deepEqual([f.bl, f.vessel, f.voyage, f.etd, f.eta, f.pos], ['GMAO26090077', 'EXAMPLE PIONEER', 'V.031W', '2026-09-04', '2026-10-03', '']);
  assert.equal(f.containers, 'EXTU2223334(40HQ), EXTU5556660(40HQ)');
  assert.equal(L.weightKg(f.weight), 4499.64);                           // 9,920 lb × 0.45359237 = 4499.636… → 4499.64
  assert.equal(ar[2].src.bl, 'Bill of Lading No. ⏎ GMAO26090077');
});
test('수정 A/N(OLD/NEW ETA): NEW ETA 를 먼저 읽음, 문장 속 「the ETA has been changed」는 값이 아님', () => {
  assert.equal(ar[3].fields.eta, '2026-10-28');
  assert.match(ar[3].src.eta, /^NEW ETA/);
});
L.anAddMails(adb, ar);
const aq = L.anQueue(adb);
test('대장 연결: PO 번호 2건, 대장 B/L 로 1건(Gamma), 대장에 없는 A/N 0, ETA 빠른 순', () => {
  assert.deepEqual(aq.rows.map(r => [r.po_no, r.bl, r.via]), [['EX4500010005', 'BTSH26090055', 'PO 번호'], ['EX4500010003', 'GMAO26090077', 'B/L'], ['EX4500010002', 'ALGS2609001', 'PO 번호']]);
  assert.equal(aq.unmatched.length, 0);
  assert.equal(aq.pending.length, 3);
});
test('같은 B/L 의 새 A/N: 받은 순서로 ETA 변경 이전 → 이후, 두 통이 한 건', () => {
  const r = aq.rows.find(x => x.po_no === 'EX4500010002');
  assert.equal(r.anCount, 2); assert.equal(r.eta, '2026-10-28');
  assert.deepEqual(r.etaChanges.map(c => [c.from, c.to, c.days]), [['2026-10-24', '2026-10-28', 4]]);
  assert.equal(aq.etaChanged.length, 1);
  // 수정본을 먼저 올려도 받은 시각으로 정렬
  const g = L.anGroups([ar[3], ar[0]]);
  assert.deepEqual(g[0].etaChanges.map(c => c.from + '>' + c.to), ['2026-10-24>2026-10-28']);
});
test('같은 메일을 두 번 올리면 건너뜀', () => {
  const d = anDb(); L.anAddMails(d, anRecs(d));
  assert.deepEqual(L.anAddMails(d, anRecs(d)), { added: 0, skipped: 4 });
});
test('대장 반영: A/N 수신·B/L(빈 칸만)·최근 ETA·ETD(빈 칸만)', () => {
  const d = anDb(); L.anAddMails(d, anRecs(d));
  assert.equal(L.anSyncToPos(d), 3);
  const p2 = d.pos.find(p => p.po_no === 'EX4500010002');
  assert.deepEqual([p2.an_received, p2.bl_no, p2.eta, p2.etd], [true, 'ALGS2609001', '2026-10-28', '2026-09-26']);
  assert.equal(L.anSyncToPos(d), 0);                                     // 두 번째는 바뀔 것 없음
  assert.equal(L.ledgerRows(d, TODAY).find(r => r['PO 번호'] === 'EX4500010002')['B/L 번호'], 'ALGS2609001');
});
test('항차등록 완료·이력 → 등록 후 ETA 변경 표시 → 조정 ETA 반영 → 등록 취소', () => {
  const d = anDb(); const rs = anRecs(d);
  L.anAddMails(d, [rs[0], rs[1], rs[2]]);                               // 수정 A/N 은 아직 안 옴
  let q = L.anQueue(d);
  L.anRegister(d, q.pending.filter(r => r.po_no === 'EX4500010002'), '2026-09-28', 'T1');
  q = L.anQueue(d);
  assert.deepEqual([q.pending.length, q.done.length, q.done[0].reg.date, q.done[0].reg.eta], [2, 1, '2026-09-28', '2026-10-24']);
  assert.equal(L.anRegDateOf(d, 'EX4500010002'), '2026-09-28');
  L.anAddMails(d, [rs[3]]);                                              // 수정 A/N 도착
  q = L.anQueue(d);
  assert.deepEqual(q.done[0].etaAfterReg, { from: '2026-10-24', to: '2026-10-28' });
  assert.equal(q.pending.length, 2);                                     // 대기로 되돌리지 않고 완료 목록에서 빨간 표시
  assert.equal(L.anConfirmEta(d, q.done[0], 'T2'), true);
  q = L.anQueue(d);
  assert.equal(q.done[0].etaAfterReg, null);
  assert.equal(L.anUnregister(d, q.done[0], 'T3'), true);
  q = L.anQueue(d);
  assert.deepEqual([q.pending.length, q.done.length], [3, 0]);
  assert.deepEqual(d.an.history.map(e => e.action), ['register', 'eta_confirm', 'unregister']);
  assert.ok(L.anHistory(d).some(e => e.action === 'eta_change' && e.eta_from === '2026-10-24' && e.eta === '2026-10-28'));
  assert.equal(L.anHistoryRows(d).length, 4);
});
test('대장에 없는 PO 번호만 적힌 A/N 은 「붙지 않은 A/N」, 대장에서 A/N·B/L 을 손으로 적은 PO 는 대기에 포함', () => {
  const d = anDb();
  const rec = L.parseArrivalNotice({ subject: 'Arrival Notice', body: 'B/L NO : ZZZZ26000001\nETA : 2026-10-10\nPO NO : M269999999', from: 'x@fw.example.com', fromAddr: 'x@fw.example.com' }, d, {});
  L.anAddMails(d, [rec]);
  d.pos.find(p => p.po_no === 'EX4500010001').bl_no = 'HAND0000001';     // an_received 는 예시에서 이미 true
  const q = L.anQueue(d);
  assert.deepEqual(q.unmatched.map(u => u.unknown), [['M269999999']]);
  // 2026-09-29 밤: 메일에 적힌 B/L 은 대장에 PO 가 없어도 항차등록 대기에 올림(「대장 연결 없음」)
  assert.deepEqual(q.pending.map(r => [r.po_no, r.via]), [['M269999999', '대장 연결 없음'], ['EX4500010001', '대장'], ['EX4500010003', '대장']]);   // 03 은 예시 대장에 B/L·A/N 이 이미 있음
  assert.equal(rec.fields.forwarder, 'fw.example.com');                  // 이름 없는 주소면 도메인
});
test('라벨 규칙의 함정: POLAND·GWANGYANG 은 라벨 아님, 문장 속 vessel 은 값 아님, 「ETA BUSAN :」, 「ETD/ETA : a / b」, 「POL / POD」', () => {
  const t = [
    'We ship from POLAND via GWANGYANG port.',
    'The following vessel will arrive soon.',
    'ETD/ETA : 2026-09-01 / 2026-09-20',
    'ETA BUSAN : 22 Sep 2026',
    'POL / POD : ANTWERP / INCHEON',
    'Vessel : EXAMPLE WIND V.123E',
    'BL NO. EXBL26001234   GW 1,200 KGS'
  ].join('\n');
  const f = L.parseArrivalNotice({ subject: '', body: t }, L.emptyDb(), {}).fields;
  assert.deepEqual([f.etd, f.eta, f.pol, f.pod, f.vessel, f.bl, f.weight], ['2026-09-01', '2026-09-20', 'ANTWERP', 'INCHEON', 'EXAMPLE WIND V.123E', 'EXBL26001234', '1,200 KGS']);
});
test('날짜 모양: 일/월 헷갈리는 12/10/2026 은 설정 순서대로 읽고 확인 메모, 국문 연월일', () => {
  const a = L.parseArrivalNotice({ subject: '', body: 'ETA : 12/10/2026' }, L.emptyDb(), {});
  const b = L.parseArrivalNotice({ subject: '', body: 'ETA : 12/10/2026' }, L.emptyDb(), { dayFirst: true });
  assert.deepEqual([a.fields.eta, b.fields.eta], ['2026-12-10', '2026-10-12']);
  assert.equal(a.notes.length, 1);
  assert.equal(L.parseArrivalNotice({ subject: '', body: '입항예정일: 2026년 10월 8일' }, L.emptyDb(), {}).fields.eta, '2026-10-08');
  assert.deepEqual(L.datesIn('from 20-OCT-2026 to Oct 24, 2026').map(d => d.iso), ['2026-10-20', '2026-10-24']);
});
test('붙여넣은 글: 머리글이 있으면 메일 원문으로, 없으면 본문으로', () => {
  const m = L.anMailFromText(S.anMails(TODAY)[0].text);
  assert.equal(m.subject, 'ARRIVAL NOTICE / HBL: ALGS2609001 / PO EX4500010002');
  assert.equal(L.anMailFromText('HBL NO : X1\nETA : 2026-10-01').subject, '');
});
test('CSV: BOM, 쉼표·따옴표 칸은 따옴표로 / 대장 가져오기 열 짐작에 B/L 번호·ETA', () => {
  const c = L.toCsv([{ a: 'x,y', b: 'say "hi"' }, { a: 1, c: '' }]);
  assert.equal(c, '﻿a,b,c\r\n"x,y","say ""hi""",\r\n1,,\r\n');
  const m = L.guessMapping(['PO 번호', 'B/L 번호', 'ETA', '선적 예정일(ETD)'], 'ledger');
  assert.deepEqual([m.bl_no, m.eta, m.etd], ['B/L 번호', 'ETA', '선적 예정일(ETD)']);
});

console.log('도착 통지(A/N) — 실물 양식(해상 본문 표·엑셀·B/L PDF, 항공 메일) · TMS NO · B/L 별 항차등록 (09-29 밤)');
test('PO 나누기: 전각 쉼표·줄바꿈·붙어 있는 10자리 번호·중복', () => {
  assert.deepEqual(L.anSplitPos('O261000001，O261000002，O261000003'), ['O261000001', 'O261000002', 'O261000003']);
  assert.deepEqual(L.anSplitPos('O261000004O261000005O261000006\nO261000007, O261000004'), ['O261000004', 'O261000005', 'O261000006', 'O261000007']);
  assert.deepEqual(L.anSplitPos('M266000001'), ['M266000001']);
  assert.deepEqual(L.anSplitPos('EX4500010007，O261000002'), ['EX4500010007', 'O261000002']);   // 사내 모양이 아닌 번호는 그대로
  assert.deepEqual(L.anSplitPos('45001234500099', '45\\d{5}'), ['4500123', '4500099']);          // 설정 정규식으로 붙은 번호 끊기
});
test('컨테이너: 번호 + 형식(「(40DC)」·「/ 봉인번호 / 40HC」), 같은 번호는 한 번', () => {
  assert.deepEqual(L.anContainerList('EXBU1000001 / 200000 /\n40HC / 9 PKGS, EXCU2000002(40DC), EXBU1000001'), [{ no: 'EXBU1000001', type: '40HC' }, { no: 'EXCU2000002', type: '40DC' }]);
  assert.equal(L.anContainerText([{ no: 'EXAU1234560', type: '40DC' }, { no: 'EXBU1000001', type: '' }]), 'EXAU1234560(40DC), EXBU1000001');
});
test('Local AR·Incoterms·날짜: 「USD : 4,321.50」 → USD 4321.5 / 「INCOTERMSEXW」 / SEP.02.2026 · 20261002', () => {
  assert.deepEqual(L.anMoney('USD : 4,321.50'), { ccy: 'USD', amount: 4321.5 });
  assert.equal(L.anMoney('별도'), null);
  assert.equal(L.anIncoterms('HYDRAULIC RAM INCOTERMSEXW "FREIGHT"').value, 'EXW');
  assert.equal(L.anIncoterms('INCOTERMS:FCA').value, 'FCA');
  assert.deepEqual(L.datesIn('LOADED ON BOARD SEP.02.2026').map(d => d.iso), ['2026-09-02']);
  assert.equal(L.toDate('20261002'), '2026-10-02');
});
const RT = '2026-09-28';
const seaHtmlGrid = L.anHtmlTables(S.anSeaHtml(RT));
test('해상 본문 표(HTML): 머리글 14칸, rowspan 을 펼쳐 넷째 건의 컨테이너 줄까지 같은 신청번호로', () => {
  assert.equal(seaHtmlGrid.length, 1);
  const g = seaHtmlGrid[0];
  assert.equal(g[0].length, 14);
  assert.equal(g.length, 1 + 1 + 1 + 4);                                   // 머리글 + LCL 1 + F40 1 + F40 컨테이너 4줄
  assert.deepEqual([g[4][0], g[4][10], g[4][11], g[4][12], g[4][13]], ['EXM2610A0003', 'F40', '2026-10-02', 'EXCU2000002', '40DC']);
  assert.equal(g[3][1], 'O261000004O261000005O261000006O261000007\nO261000008，O261000009');   // <br> 은 줄바꿈으로
});
test('해상 본문 표 → 3건: 셋째 건 PO 6개·컨테이너 4개(형식 40DC), 둘째 건 PO 3개(전각 쉼표), 첫째 건 LCL 컨테이너 없음', () => {
  const recs = L.anRecordsFromGrid(seaHtmlGrid[0], '본문 표', L.defaultSettings());
  assert.deepEqual(recs.map(r => [r.f.bl, r.pos.length, r.cntrs.length, r.cargo.join(',')]),
    [['EXSH261001', 1, 0, 'LCL'], ['EXSH261002', 3, 1, 'F40'], ['EXZB261003', 6, 4, 'F40']]);
  assert.deepEqual(recs[2].cntrs.map(c => c.type), ['40DC', '40DC', '40DC', '40DC']);
  assert.deepEqual([recs[0].f.req_no, recs[0].f.incoterms, recs[0].f.local_ar, recs[0].f.eta, recs[0].f.mbl], ['EXM2610A0001', 'FCA', 'USD : 980.00', '2026-10-02', 'EXSH261001']);
  assert.match(recs[2].src.pos, /^본문 표 4행 「PO LIST」/);
});
test('해상 엑셀(31칸, 컨테이너마다 한 줄 — 같은 신청번호 4줄) → 3건, 셋째 건 컨테이너 4개', () => {
  const recs = L.anRecordsFromGrid(S.anSeaGrid(RT), '엑셀', L.defaultSettings());
  assert.deepEqual(recs.map(r => [r.f.req_no, r.pos.length, r.cntrs.length, r.rows]), [['EXM2610A0001', 1, 0, 1], ['EXM2610A0002', 3, 1, 1], ['EXM2610A0003', 6, 4, 4]]);
  assert.deepEqual([recs[2].f.forwarder, recs[2].f.packages, recs[2].f.shipper], ['예시포워더', '37 PKGS', 'EXAMPLE CYLINDER CO., LTD (SAMPLE)']);
});
test('컨테이너 되풀이 다른 모양: 신청번호·B/L 이 빈 이어진 줄, 머리글보다 긴 줄의 「F40 / 번호 / 40DC」 되풀이', () => {
  const head = ['신청번호', 'PO LIST', 'HBLNO', '화물형태', '입항일', '컨테이너번호', 'CONTAINER TYPE'];
  const a = L.anRecordsFromGrid([head, ['EXM1', 'O261000001', 'EXHB0001', 'F40', '2026-10-01', 'EXAU1111111', '40DC'], ['', '', '', 'F40', '', 'EXAU2222222', '40DC'], ['', '', '', 'F40', '', 'EXAU3333333', '40HC']], 't', {});
  assert.deepEqual(a.map(r => r.cntrs.map(c => c.no + ':' + c.type)), [['EXAU1111111:40DC', 'EXAU2222222:40DC', 'EXAU3333333:40HC']]);
  const b = L.anRecordsFromGrid([head, ['EXM2', 'O261000002', 'EXHB0002', 'F40', '2026-10-01', 'EXAU4444444', '40DC', 'F40', 'EXAU5555555', '40DC']], 't', {});
  assert.deepEqual(b[0].cntrs.map(c => c.no), ['EXAU4444444', 'EXAU5555555']);
});
test('B/L 사본 PDF(칸 이름 없음): 쪽에 두 번 나오는 번호 = B/L, RIDER 쪽은 「H.B/L:」로 같은 건에 합침, 선명·항차·ON BOARD', () => {
  const db = L.emptyDb();
  const recs = L.anRecordsFromPages(S.anSeaPdfPages(RT).map(p => p.join('\n')), 'PDF', db);
  assert.deepEqual(recs.map(r => [r.f.bl, r.pos.length, r.cntrs.length, r.rows]), [['EXSH261001', 0, 0, 1], ['EXSH261002', 2, 1, 1], ['EXZB261003', 6, 4, 2]]);   // EX 모양 PO 는 대장에 있을 때만
  assert.deepEqual([recs[0].f.vessel, recs[0].f.voyage, recs[0].f.etd, recs[2].f.incoterms], ['EXAMPLE BREEZE', '2610E', '2026-09-25', 'EXW']);
  assert.deepEqual(recs[2].cntrs.map(c => c.type), ['40HC', '40HC', '40HC', '40HC']);
  db.pos = [{ po_no: 'EX4500010006' }];
  assert.equal(L.anRecordsFromPages(S.anSeaPdfPages(RT).map(p => p.join('\n')), 'PDF', db)[0].pos.join(), 'EX4500010006');
});
const seaMail = L.parseEml(L.utf8(S.anSeaMail(RT, [])), { tzOffsetMin: 540 });
const seaRecs = L.anParseAll(seaMail, anDb(), { file: 'sea', now: 'N' }, { grids: [{ name: '첨부 엑셀', rows: S.anSeaGrid(RT) }], pdfs: [{ name: '첨부 PDF', pages: S.anSeaPdfPages(RT).map(p => p.join('\n')) }] });
test('해상 메일 한 통(본문 표 + 엑셀 + PDF) → B/L 3건. 엑셀은 같은 건으로 합치고, PDF 로 항차·출항일을 채움', () => {
  assert.deepEqual(seaRecs.map(r => [r.fields.bl, L.anPoList(r.fields.pos).length, L.anContainerList(r.fields.containers).length, r.fields.voyage, r.fields.etd]),
    [['EXSH261001', 1, 0, '2610E', '2026-09-25'], ['EXSH261002', 3, 1, '2608E', '2026-09-24'], ['EXZB261003', 6, 4, '2610E', '2026-09-26']]);
  assert.deepEqual(seaRecs.map(r => r.fields.mode), ['해상', '해상', '해상']);
  assert.equal(seaRecs[0].fields.mbl, '');                                   // HBL 과 같은 MBL 은 한 번만
  assert.deepEqual(seaRecs[2].notes, []);                                   // 09-30 확정: Incoterms 는 비교하지 않음(기본)
  assert.deepEqual(seaRecs[2].info, []);
  assert.equal(new Set(seaRecs.map(r => r.id)).size, 3);
});
test('항공 메일(ks_c_5601-1987 제목·QP HTML 표, HAWB PDF 첨부) → HAWB 2건, 같은 PO, 신청번호 각각', () => {
  const pdfs = S.AN_AIR.map(a => ({ name: a.hawb + '.pdf', pages: S.anAirPdfPages(RT, a).map(p => p.join('\n')) }));
  const m = L.parseEml(L.utf8(S.anAirMail(RT, [])), { tzOffsetMin: 540 });
  assert.match(m.subject, /^\[도착일정통지_항공\] 예시중공업\(예시\) \/ PO NO: EX4500010008/);
  assert.equal(m.from.split(' <')[0], '예시포워더 항공수입팀');
  const recs = L.anParseAll(m, L.emptyDb(), { file: 'air', now: 'N' }, { pdfs });
  assert.deepEqual(recs.map(r => [r.fields.bl, r.fields.mbl, r.fields.req_no, r.fields.pos, r.fields.vessel, r.fields.eta, r.fields.mode]),
    [['EXAW261001', '18000000011', 'EXM2610B0011', 'EX4500010008', 'KE999', '2026-10-02', '항공'], ['EXAW261002', '18000000012', 'EXM2610B0012', 'EX4500010008', 'KE999', '2026-10-02', '항공']]);
  assert.match(recs[0].src.eta, /「ETA」 20261002 16:15$/);
  const alone = L.anParseAll({ subject: '', body: '' }, L.emptyDb(), { now: 'N' }, { pdfs });      // HAWB PDF 만 올려도 신청번호(HIPRO)
  assert.deepEqual(alone.map(r => [r.fields.bl, r.fields.req_no, r.fields.mode]), [['EXAW261001', 'EXM2610B0011', '항공'], ['EXAW261002', 'EXM2610B0012', '항공']]);
});
test('TMS NO: 기본(09-30 확정) = 신청번호 / 표에 「TMS NO」 칸이 있으면 읽음 / 설정에 「신청번호」를 적으면 신청번호를 TMS NO 로 / 글의 「TMS NO : …」', () => {
  assert.deepEqual(seaRecs.map(r => r.fields.tms), ['EXM2610A0001', 'EXM2610A0002', 'EXM2610A0003']);
  const head = ['TMS NO', '신청번호', 'PO LIST', 'HBLNO', '입항일'];
  const g = [head, ['T2610-0001', 'EXM1', 'O261000001', 'EXHB0001', '2026-10-01']];
  assert.equal(L.anRecordsFromGrid(g, 't', L.defaultSettings())[0].f.tms, 'T2610-0001');
  const st = Object.assign(L.defaultSettings(), { an_tms_labels: '신청번호' });
  const r2 = L.anRecordsFromGrid([head.slice(1), g[1].slice(1)], 't', st)[0].f;
  assert.deepEqual([r2.tms, r2.req_no], ['EXM1', 'EXM1']);
  const t = L.parseArrivalNotice({ subject: '', body: 'HBL NO : EXHB0009\nTMS NO : T2610-0099\nETA : 2026-10-05' }, L.emptyDb(), {});
  assert.equal(t.fields.tms, 'T2610-0099');
  assert.deepEqual(L.anTmsLabels({ an_tms_labels: 'TMS NO，운송관리번호' }), ['TMS NO', '운송관리번호']);
});
test('항차등록은 B/L 별: PO 6개 B/L 은 한 줄(PO 목록), 대장 PO 연결 유지, TMS NO·B/L 이 내보내기에', () => {
  const d = anDb(); d.settings.an_tms_labels = '신청번호';
  const recs = L.anParseAll(seaMail, d, { file: 'sea', now: 'N' }, { grids: [{ name: '첨부 엑셀', rows: S.anSeaGrid(RT) }] });
  L.anAddMails(d, recs);
  let q = L.anQueue(d);
  const mailRows = q.rows.filter(r => r.source === 'mail');                  // 예시 대장의 손 기록(GMAO…) 한 줄은 빼고
  assert.deepEqual(mailRows.map(r => [r.key, r.pos.length, r.containers.length]), [['EXSH261001', 1, 0], ['EXSH261002', 3, 1], ['EXZB261003', 6, 4]]);
  const r2 = mailRows[1];
  assert.deepEqual([r2.po_no, r2.via, r2.ledger.map(x => x.po_no), r2.unknownPos, r2.tms], ['EX4500010007, O261000002, O261000003', 'PO 번호', ['EX4500010007'], ['O261000002', 'O261000003'], 'EXM2610A0002']);
  assert.equal(L.anSyncToPos(d), 2);                                          // 대장에 있는 06·07 두 PO 에 B/L·ETA
  assert.equal(d.pos.find(p => p.po_no === 'EX4500010007').bl_no, 'EXSH261002');
  L.anRegister(d, [mailRows[2]], '2026-09-29', 'T1');
  q = L.anQueue(d);
  assert.deepEqual([q.pending.length, q.done.length, q.done[0].bl], [3, 1, 'EXZB261003']);
  assert.deepEqual(Object.keys(d.an.regs), ['EXZB261003']);
  assert.equal(d.an.regs.EXZB261003.pos.length, 6);
  assert.equal(L.anRegDateOf(d, 'O261000009'), '2026-09-29');
  const x = L.anQueueRows(q.done, d)[0];
  assert.deepEqual([x['B/L(HBL)'], x['MBL'], x['TMS NO'], x['PO 수'], x['컨테이너 수'], x['Local AR 통화'], x['Local AR 금액'], x['상태']],
    ['EXZB261003', 'EXMB0000000003', 'EXM2610A0003', 6, 4, 'USD', 3210, '등록 완료']);
  assert.equal(L.anHistoryRows(d)[0]['TMS NO'], 'EXM2610A0003');
  assert.equal(L.anMailRows(d)[2]['PO 수'], 6);
});
test('B/L 열쇠: HBL 이 없으면 MBL, MBL 만 적힌 A/N 뒤에 HBL+MBL A/N 이 오면 한 건, HBL 이 다르면 MBL 이 같아도 다른 건', () => {
  const mk = (body, t) => L.parseArrivalNotice({ subject: '', body, dateTime: t }, L.emptyDb(), {});
  const a = mk('MBL NO : EXMB0000000077\nETA : 2026-10-01', '2026-09-01T00:00:00Z');
  const b = mk('HBL NO : EXHB0000000071\nMBL NO : EXMB0000000077\nETA : 2026-10-03', '2026-09-02T00:00:00Z');
  const c = mk('HBL NO : EXHB0000000072\nMBL NO : EXMB0000000077\nETA : 2026-10-03', '2026-09-03T00:00:00Z');
  assert.deepEqual([a.fields.bl, a.blIsMaster], ['EXMB0000000077', true]);
  const g = L.anGroups([a, b, c]);
  assert.deepEqual(g.map(x => [x.key, x.recs.length]), [['EXHB0000000071', 2], ['EXHB0000000072', 1]]);
  assert.deepEqual(g[0].etaChanges.map(e => e.from + '>' + e.to), ['2026-10-01>2026-10-03']);
});
test('예전(PO|B/L 별) 등록 표시 → B/L 별로 옮김(먼저 등록한 날, PO 모음) — 두 번 돌려도 같음', () => {
  const d = L.emptyDb();
  d.an.regs = { 'EX1|EXHB1': { date: '2026-09-20', eta: '2026-10-01', at: 'a' }, 'EX2|EXHB1': { date: '2026-09-18', eta: '2026-10-02', at: 'b' }, 'EXHB2': { date: '2026-09-25', eta: '', pos: ['EX3'] } };
  assert.equal(L.anMigrateRegs(d), 2);
  assert.deepEqual(d.an.regs.EXHB1, { date: '2026-09-18', eta: '2026-10-02', at: 'a', pos: ['EX1', 'EX2'] });
  assert.equal(L.anMigrateRegs(d), 0);
  assert.equal(L.anRegDateOf(d, 'EX2'), '2026-09-18');
});
test('붙여넣은 표(탭으로 나뉜 칸) → 본문 표와 같이 읽음, 해상·항공 구분은 비어도 됨', () => {
  const txt = ['신청번호\tPO LIST\tHBLNO\t입항일', 'EXM9\tO261000001O261000002\tEXHB0009\t2026-10-09'].join('\n');
  const r = L.anParseAll(L.anMailFromText(txt), L.emptyDb(), { now: 'N' }, {});
  assert.deepEqual([r.length, r[0].fields.bl, r[0].fields.pos, r[0].fields.eta], [1, 'EXHB0009', 'O261000001, O261000002', '2026-10-09']);
});

console.log('수강생 답 반영 — TMS NO = HIPRO 신청번호 · Incoterms 비교 끔 · HBL 기준(MBL 만이면 표시) (09-30)');
test('TMS NO 기본값: 신청번호·HIPRO 포함(TMS NO 칸이 따로 있으면 그 칸 먼저), 표 머리글 「신청번호」 → TMS NO, HIPRO 라벨 글도, 설정을 바꾸면 따름', () => {
  assert.deepEqual(L.anTmsLabels(L.defaultSettings()).slice(-2), ['신청번호', 'HIPRO']);
  assert.equal(L.defaultSettings().an_tms_labels, L.AN_TMS_DEFAULT);
  const g = [['신청번호', 'PO LIST', 'HBLNO', '입항일'], ['EXM7', 'O261000001', 'EXHB0007', '2026-10-07']];
  const r = L.anParseAll(L.anMailFromText(g.map(x => x.join('\t')).join('\n')), L.emptyDb(), { now: 'N' }, {})[0];
  assert.deepEqual([r.fields.tms, r.fields.req_no], ['EXM7', 'EXM7']);
  assert.match(r.src.tms, /신청번호/);
  const t = L.parseArrivalNotice({ subject: '', body: 'HAWB NO : EXAW1\nHIPRO: EXM2610B0099\nETA : 2026-10-05' }, L.emptyDb(), {});
  assert.equal(t.fields.tms, 'EXM2610B0099');
  const g2 = [['신청 NO', 'PO LIST', 'HBLNO', '입항일'], ['EXM8', 'O261000001', 'EXHB0008', '2026-10-08']];   // 칸 이름이 달라도 신청번호로 읽힌 값이면
  const r2 = L.anParseAll(L.anMailFromText(g2.map(x => x.join('\t')).join('\n')), L.emptyDb(), { now: 'N' }, {})[0];
  assert.deepEqual([r2.fields.tms, r2.fields.req_no], ['EXM8', 'EXM8']);
  const d = L.emptyDb(); d.settings.an_tms_labels = 'TMS NO';                  // 바꿀 수 있음: 신청번호를 TMS 로 쓰지 않게
  assert.equal(L.anParseAll(L.anMailFromText(g.map(x => x.join('\t')).join('\n')), d, { now: 'N' }, {})[0].fields.tms, '');
});
test('예전 기본 TMS 칸 이름이 저장돼 있으면 새 기본값으로(사용자가 바꾼 값은 둠), 대기 목록은 예전 A/N 도 신청번호를 TMS NO 로', () => {
  const st = { an_tms_labels: L.AN_TMS_OLD_DEFAULT };
  assert.equal(L.migrateSettings(st), 1); assert.equal(st.an_tms_labels, L.AN_TMS_DEFAULT);
  assert.equal(L.migrateSettings(st), 0);
  const mine = { an_tms_labels: '운송관리번호' }; L.migrateSettings(mine); assert.equal(mine.an_tms_labels, '운송관리번호');
  const d = anDb();
  const recs = L.anParseAll(seaMail, d, { file: 'sea', now: 'N' }, {});
  recs.forEach(r => { r.fields.tms = ''; r.parsed.tms = ''; });               // 09-29 에 읽어 TMS 가 빈 채로 저장된 A/N
  L.anAddMails(d, recs);
  assert.deepEqual(L.anQueue(d).rows.filter(r => r.source === 'mail').map(r => r.tms), ['EXM2610A0001', 'EXM2610A0002', 'EXM2610A0003']);
});
test('Incoterms 비교: 기본 끔(메모 없음), 켜면 확인 메모가 아닌 「참고」만 / 컨테이너 형식은 표 값(40DC)', () => {
  const x = { grids: [{ name: '첨부 엑셀', rows: S.anSeaGrid(RT) }], pdfs: [{ name: '첨부 PDF', pages: S.anSeaPdfPages(RT).map(p => p.join('\n')) }] };
  const d = anDb(); d.settings.an_cmp_incoterms = true;
  const on = L.anParseAll(seaMail, d, { file: 'sea', now: 'N' }, x);
  assert.deepEqual([on[2].notes, on[2].info], [[], ['참고: Incoterms 「FOB」 · 첨부 PDF 「EXW」']]);
  assert.deepEqual(L.anContainerList(seaRecs[2].fields.containers).map(c => c.type), ['40DC', '40DC', '40DC', '40DC']);
  assert.equal(L.anMailRows(Object.assign(anDb(), { an: { mails: on, regs: {}, history: [] } }))[2]['참고'], '참고: Incoterms 「FOB」 · 첨부 PDF 「EXW」');
});
test('SRM 은 HBL 기준: MBL 만 온 B/L 은 MBL 로 대신 올리되 「HBL 없음」 표시·내보내기 「B/L 구분」, HBL 이 오면 표시가 사라짐, 손으로 고치면 사라짐', () => {
  const mk = (body, t) => L.parseArrivalNotice({ subject: '', body, dateTime: t }, L.emptyDb(), {});
  const a = mk('MBL NO : EXMB0000000088\nPO NO : EX4500010006\nETA : 2026-10-01', '2026-09-01T00:00:00Z');
  const d = anDb(); L.anAddMails(d, [a]);
  let row = L.anQueue(d).rows.find(r => r.key === 'EXMB0000000088');
  assert.equal(row.mblOnly, true);
  assert.equal(L.anQueueRows([row], d)[0]['B/L 구분'], 'MBL(HBL 없음 — 확인)');
  assert.equal(L.anMailRows(d).find(o => o['B/L 구분'] !== 'HBL')['B/L 구분'], 'MBL(HBL 없음 — 확인)');
  L.anAddMails(d, [mk('HBL NO : EXHB0000000081\nMBL NO : EXMB0000000088\nETA : 2026-10-02', '2026-09-02T00:00:00Z')]);
  row = L.anQueue(d).rows.find(r => r.key === 'EXHB0000000081');
  assert.deepEqual([row.mblOnly, L.anQueue(d).rows.some(r => r.key === 'EXMB0000000088')], [false, false]);
  const b = mk('MBL NO : EXMB0000000099\nETA : 2026-10-01', '2026-09-03T00:00:00Z');
  assert.equal(L.anIsMblOnly(b), true);
  b.fields.bl = 'EXHB0000000099'; b.fields.mbl = 'EXMB0000000099';             // 확인·고치기에서 HBL 을 넣음
  assert.equal(L.anIsMblOnly(b), false);
  assert.equal(L.anIsMblOnly(seaRecs[0]), false);
});

/* ── 2026-09-30 새 요청: Invoice → 엑셀 · Invoice → B/L → 항차 · Cummins 구분 HCE · 원산지증명서 요청 ── */
const I = require('../js/invoice.js');
const C = require('../js/co.js');
const AI = require('../js/ai.js');

console.log('\nInvoice 숫자·날짜 읽기 (09-30)');
test('미국식 1,234.56 · 유럽식 1.234,56 은 하나로 확정', () => {
  assert.deepEqual(I.amountCandidates('1,234.56'), [1234.56]);
  assert.deepEqual(I.amountCandidates('1.234,56'), [1234.56]);
  assert.deepEqual(I.amountCandidates('EUR 12,40'), [12.4]);          // 뒤가 두 자리 → 소수점
  assert.deepEqual(I.amountCandidates('1,234,567'), [1234567]);       // 세 자리씩 여러 번 → 천단위
  assert.deepEqual(I.amountCandidates('(50.00)'), [-50]);
});
test('뒤가 정확히 세 자리(2.480 · 1,234)는 둘 다 후보 — 고르는 것은 계산', () => {
  assert.deepEqual(I.amountCandidates('2.480'), [2480, 2.48]);
  assert.deepEqual(I.amountCandidates('0,850'), [0.85]);              // 앞이 0 이면 천단위일 수 없음
});
test('숫자 칸: 품번·PO·날짜 속 숫자는 칸이 아님', () => {
  const cells = I.numberCells('10  DIN-912-M8  M261110501  2026-09-20  4  12.50  50.00');
  assert.deepEqual(cells.map(c => c.tok), ['10', '4', '12.50', '50.00']);
});
test('수량 × 단가 = 금액 — 열 순서가 달라도(단가·수량·금액)', () => {
  const s = I.solveLine(I.numberCells('Scheibe   0,85   500   425,00'));
  assert.deepEqual([s.qty, s.unit, s.amount], [500, 0.85, 425]);
});
test('반올림 허용: 7 × 14.29 = 100.03 ≈ 100.00, 3 × 0.33 = 0.99 ≈ 1.00, 하지만 1.20 은 아님', () => {
  assert.ok(I.solveLine(I.numberCells('A  7  14.29  100.00')));
  assert.ok(I.solveLine(I.numberCells('A  3  0.33  1.00')));
  assert.equal(I.solveLine(I.numberCells('A  3  0.33  1.20')), null);
});
test('날짜: 22.09.2026 · Sep 20, 2026 · 03/04/2026(애매 — 다른 해석 함께)', () => {
  assert.equal(I.readDate('22.09.2026').iso, '2026-09-22');
  assert.equal(I.readDate('Sep 20, 2026').iso, '2026-09-20');
  const d = I.readDate('03/04/2026');
  assert.deepEqual([d.iso, d.ambiguous, d.alt], ['2026-03-04', true, '2026-04-03']);
  assert.equal(I.readDate('2026-02-30'), null);
});

console.log('\nInvoice 예시 두 양식 (09-30)');
const LEDGER_POS = S.ledger(TODAY).map(p => p.po_no);
const INV_A = I.readInvoice(S.invoicePdfs[0].lines.join('\n'), { ledgerPos: LEDGER_POS });
const INV_B = I.readInvoice(S.invoicePdfs[1].lines.join('\n'), { ledgerPos: LEDGER_POS });
test('A(독일식): 헤더 — Invoice 9000001 · 2026-09-22 · EUR · EXW Frankfurt · PO EX4500010008 · 공급사는 위쪽 회사명(추정 메모)', () => {
  const h = INV_A.header;
  assert.deepEqual([h.invoiceNo, h.date, h.currency, h.incoterms, h.incotermsPlace, h.poNo], ['9000001', '2026-09-22', 'EUR', 'EXW', 'Frankfurt', 'EX4500010008']);
  assert.match(h.supplier, /EXAMPLE ENGINE GMBH/);
  assert.ok(INV_A.notes.some(n => /공급사 라벨/.test(n)));
});
test('A: 부품 4줄 — 유럽식 숫자, 2 × 2.480,00 은 표의 자리로 수량 2 · 단가 2480(뒤바뀌지 않음)', () => {
  assert.deepEqual(INV_A.items.map(i => [i.partNo, i.qty, i.unitPrice, i.amount]),
    [['EXE-8801-A', 4, 1234.5, 4938], ['EXE-8802', 25, 12.4, 310], ['EXE-8803-C', 120, 0.85, 102], ['EXE-8804', 2, 2480, 4960]]);
  assert.ok(INV_A.items.every(i => i.poNo === 'EX4500010008' && i.poFrom === '헤더'));
  assert.equal(INV_A.items[0].desc, 'Fuel injector assy');                // 항번 10 은 품명에 섞이지 않음
});
test('A: 합계 줄(Sub Total·Freight·Total)은 부품이 아니고, 금액 합 10,310 = Sub Total', () => {
  const s = I.docSummary(INV_A);
  assert.deepEqual([s.lines, s.sum, s.stated, s.totalOk, s.bad], [4, 10310, 10310, true, 0]);
  assert.equal(INV_A.totals.charges[0].label, 'Freight');
});
test('B(줄마다 PO): PO 3건 — 대장 번호 EX4500010007 과 사내 모양 O261000002·O261000003, 헤더 PO 는 비움', () => {
  assert.deepEqual(INV_B.items.map(i => i.poNo), ['EX4500010007', 'O261000002', 'O261000002', 'O261000003']);
  assert.ok(INV_B.items.every(i => i.poFrom === '줄'));
  assert.equal(INV_B.header.poNo, '');
  assert.deepEqual(I.invoicePos(INV_B), ['EX4500010007', 'O261000002', 'O261000003']);
  assert.deepEqual(INV_B.items.map(i => i.partNo), ['EXC-5501', 'EXC-5502', 'EXC-5503', 'EXC-5504']);   // PO 가 품번으로 잡히지 않음
});
test('B: 넷째 줄 4 × 310.00 ≠ 1,420.00 — 버리지 않고 짐작으로 넣고 검산 실패 표시(합계는 적힌 대로라 일치)', () => {
  const it = INV_B.items[3];
  assert.deepEqual([it.qty, it.unitPrice, it.amount, it.guessed], [4, 310, 1420, true]);
  const c = I.checkItem(it);
  assert.deepEqual([c.ok, c.expected, c.diff], [false, 1240, 180]);
  const s = I.docSummary(INV_B);
  assert.deepEqual([s.bad, s.totalOk], [1, true]);   // 합계만 보면 놓치는 줄 — 줄마다 검산이 필요한 이유
});
test('단가가 수량보다 앞인 표: 2.480,00 × 2 도 표의 다른 줄이 정한 자리(단가·수량·금액)로 — 수량 2', () => {
  const r = I.readInvoice(['Pos  Artikel  Preis  Menge  Betrag', '1  DIN-912-M8  Schraube  1.234,56  10  12.345,60', '2  DIN-125-A8  Scheibe  0,85  500  425,00', '3  HYD-4471  Pumpe  2.480,00  2  4.960,00'].join('\n'));
  assert.deepEqual(r.pattern, [-2, -3, -1]);   // [수량, 단가, 금액] 자리(뒤에서 센 번호): 수량 = 뒤에서 둘째, 단가 = 셋째
  assert.deepEqual(r.items.map(i => [i.qty, i.unitPrice]), [[10, 1234.56], [500, 0.85], [2, 2480]]);
});
test('PO 구역: 「PO No. …」 줄 아래 부품은 그 PO', () => {
  const r = I.readInvoice(['Invoice No: T-1', 'PO No. M261110501', '1  AB-100  Bolt  10  2.00  20.00', 'PO No. M261110502', '2  AB-200  Nut  5  1.00  5.00'].join('\n'));
  assert.deepEqual(r.items.map(i => [i.poNo, i.poFrom]), [['M261110501', '헤더'], ['M261110502', 'PO 구역']]);
});
test('주소·전화 줄은 부품으로 만들지 않음', () => {
  const r = I.readInvoice('Musterstrasse 1-2-3, 60000 Frankfurt\nTel: 069 1234 5678   Fax: 069 1234 5679');
  assert.equal(r.items.length, 0);
});
test('ERP 표: 부품 한 줄마다 헤더 반복 · PO No 칸 · 검산 표시', () => {
  const rows = I.erpRows([Object.assign({ file: 'a.pdf', engine: '전자 PDF' }, INV_A), Object.assign({ file: 'b.pdf', engine: '전자 PDF' }, INV_B)]);
  assert.equal(rows.length, 8);
  assert.deepEqual([rows[0]['Invoice No'], rows[7]['Invoice No'], rows[7]['PO No'], rows[7]['검산'], rows[0]['Incoterms']], ['9000001', 'EXCI-2609-017', 'O261000003', '확인 필요', 'EXW Frankfurt']);
});
test('PDF 글 조각 → 줄: 같은 높이는 한 줄, 칸 사이가 넓으면 공백 세 칸', () => {
  const t = (s, x, y, w) => ({ str: s, transform: [10, 0, 0, 10, x, y], width: w });
  const txt = I.itemsToLines([t('Qty', 300, 700, 15), t('Part', 50, 700, 20), t('EX-1', 50, 680, 20), t('4', 300, 681, 5)]);
  assert.equal(txt, 'Part   Qty\nEX-1   4');
});
test('AI 답(JSON) 읽기 — 울타리·설명이 섞여도, 유럽식 글자 숫자도', () => {
  const r = I.parseAiAnswer('여기 결과입니다\n```json\n{"invoice_no":"S-1","invoice_date":"2026-09-01","currency":"eur","po_no":"M261110501","sub_total":"1.234,50","lines":[{"part_no":"P-1","description":"Pump","qty":1,"unit_price":"1.234,50","amount":1234.5}]}\n```');
  assert.deepEqual([r.header.invoiceNo, r.header.currency, r.items[0].unitPrice, r.items[0].poNo, r.items[0].poFrom, r.totals.sub], ['S-1', 'EUR', 1234.5, 'M261110501', '헤더', 1234.5]);
  assert.throws(() => I.parseAiAnswer('죄송합니다'), /JSON/);
  assert.match(I.aiPrompt('x.pdf'), /PO 번호/);
});

console.log('\nInvoice 번호 → B/L → 항차등록 (09-30)');
function anDb30() {
  const d = sampleDb();
  let recs = S.anMails(TODAY).map(m => L.parseArrivalNotice(L.parseEml(L.utf8(m.text)), d, { file: m.name, today: TODAY }));
  S.anRealMails(TODAY).forEach(m => { recs = recs.concat(L.anParseAll(L.parseEml(L.utf8(m.text)), d, { file: m.name, today: TODAY }, { grids: (m.grids || []).map(g => ({ name: g.name, rows: g.rows })), pdfs: (m.pdfs || []).map(x => ({ name: x.name, pages: x.pages })) })); });
  L.anAddMails(d, recs);
  return d;
}
test('A/N 에서 Invoice 번호를 읽음: 항공 HAWB 사본 「INV: 9000001」, 라벨 「Invoice No.」, 표 칸 「Invoice No」', () => {
  const d = anDb30(), rows = L.anQueue(d).rows;
  assert.deepEqual(rows.find(r => r.key === 'EXAW261001').invs, ['9000001']);
  assert.deepEqual(rows.find(r => r.key === 'EXAW261002').invs, ['9000002']);
  const one = L.parseArrivalNotice({ subject: 'A/N', body: 'HBL NO : EXHB000111\nCommercial Invoice No. : CI-7788\nETA : 2026-10-01' }, d, {});
  assert.equal(one.fields.inv_no, 'CI-7788');
  const g = L.anRecordsFromGrid([['HBL NO', 'PO LIST', 'Invoice No', '입항일'], ['EXHB0001', 'M261110501', 'inv-01, INV-02', '2026-10-01']], 't', {});
  assert.equal(g[0].f.inv_no, 'INV-01, INV-02');
  assert.deepEqual(L.anInvList(g[0].f.inv_no), ['INV-01', 'INV-02']);
  const sentence = L.parseArrivalNotice({ subject: 'A/N', body: 'Please send Commercial Invoice, Packing List.\nHBL NO : EXHB000112' }, d, {});
  assert.equal(sentence.fields.inv_no, '');                                 // 번호 표시 없는 문장은 안 잡힘
});
test('Invoice A(9000001): PO 로는 B/L 2건(분할)이지만 A/N 의 Invoice 번호로 EXAW261001 하나로 좁힘 → 항차등록 대기', () => {
  const d = anDb30(), doc = { header: INV_A.header, items: INV_A.items };
  const lk = I.invoiceLink(doc, d, L);
  assert.deepEqual([lk.bls.map(b => b.bl), lk.byInvoiceNo, lk.state], [['EXAW261001'], true, 'pending']);
  assert.ok(lk.bls[0].via.includes('A/N 의 Invoice 번호'));
  const po = I.invoiceLink({ header: { invoiceNo: 'NONE-1', poNo: 'EX4500010008' }, items: [] }, d, L);
  assert.deepEqual([po.bls.map(b => b.bl).sort(), po.multi], [['EXAW261001', 'EXAW261002'], true]);
});
test('항차등록 완료 표시 후 → 「항차등록 완료 날짜」, 등록 후 ETA 가 바뀌면 SRM 조정 필요', () => {
  const d = anDb30(), q = L.anQueue(d);
  L.anRegister(d, q.rows.filter(r => r.key === 'EXAW261001'), '2026-09-29', '2026-09-29T01:00:00Z');
  let lk = I.invoiceLink({ header: INV_A.header, items: INV_A.items }, d, L);
  assert.deepEqual([lk.state, lk.bls[0].label], ['registered', '항차등록 완료 2026-09-29']);
  d.an.regs.EXAW261001.eta = '2000-01-01';
  lk = I.invoiceLink({ header: INV_A.header, items: INV_A.items }, d, L);
  assert.equal(lk.bls[0].state, 'reg_eta');
});
test('Invoice B(줄마다 PO): PO 3건이 한 B/L(EXSH261002), 대장에 없는 PO 는 표시', () => {
  const d = anDb30(), lk = I.invoiceLink({ header: INV_B.header, items: INV_B.items }, d, L);
  assert.deepEqual(lk.bls.map(b => b.bl), ['EXSH261002']);
  assert.deepEqual(lk.pos.map(p => [p.po_no, p.inLedger]), [['EX4500010007', true], ['O261000002', false], ['O261000003', false]]);
});
test('B/L 을 못 찾으면 no_bl, 번호로만 찾기(PO 번호)', () => {
  const d = anDb30();
  assert.equal(I.invoiceLink({ header: { invoiceNo: 'X', poNo: 'Z999999999' }, items: [] }, d, L).state, 'no_bl');
  const r = I.lookupByNumber('9000002', d, L, []);
  assert.deepEqual([r.kind, r.link.bls.map(b => b.bl)], ['Invoice 번호(A/N)', ['EXAW261002']]);
  assert.equal(I.lookupByNumber('EX4500010006', d, L, []).link.bls[0].bl, 'EXSH261001');
});

console.log('\nCummins EXW — 구분 HCE 만 (09-30 요청)');
test('기본은 HCE 만(설정 cum_gubun_only 켜짐) — HDX 줄 숨김, 끄면 전체', () => {
  const r = L.cumminsRows(S.cumGrid().grid, {});
  assert.equal(r.hasGubun, true);
  const st = L.defaultSettings();
  let v = L.cumminsGubunView(r.rows, st, r);
  assert.deepEqual([v.on, v.rows.length, v.hidden, v.others], [true, 9, 1, { HDX: 1 }]);
  assert.ok(v.rows.every(x => x.gubun === 'HCE'));
  st.cum_gubun_only = false;
  v = L.cumminsGubunView(r.rows, st, r);
  assert.deepEqual([v.on, v.rows.length, v.gubun], [false, 10, '']);
});
test('구분 열이 없는 파일은 거르지 않고 missing 으로 알림, 「구분(HCE/HDX)」 같은 머리글도 잡음', () => {
  const g = S.cumGrid().grid.map(r => r.slice());
  const hi = g.findIndex(r => r.includes('구분'));
  g[hi][g[hi].indexOf('구분')] = '구분(HCE/HDX)';
  assert.equal(L.cumminsRows(g, {}).hasGubun, true);
  g[hi][g[hi].indexOf('구분(HCE/HDX)')] = 'Type';
  const r = L.cumminsRows(g, {});
  const v = L.cumminsGubunView(r.rows, L.defaultSettings(), r);
  assert.deepEqual([r.hasGubun, v.missing, v.on, v.rows.length], [false, true, false, 10]);
});
test('HCE 로 거른 줄로 계획하면 HDX 의 M261300040 은 「대장에 없음」에도 나오지 않음', () => {
  const r = L.cumminsRows(S.cumGrid().grid, {});
  const v = L.cumminsGubunView(r.rows, L.defaultSettings(), r);
  const plan = L.cumminsExwPlan(v.rows, [], { status: 'Undispatched', gubun: '', asOf: S.CUM_AS_OF });
  assert.ok(!plan.notInLedger.some(g => g.po === 'M261300040'));
  const all = L.cumminsExwPlan(r.rows, [], { status: 'Undispatched', gubun: '', asOf: S.CUM_AS_OF });
  assert.ok(all.notInLedger.some(g => g.po === 'M261300040'));
});

console.log('\n원산지증명서 요청 관리 (09-30)');
test('요청 등록 → 메일 작성 → 업체에 요청 → 수령 → 통관팀 전달, 이력은 순서대로 쌓임', () => {
  const d = L.emptyDb();
  const r = C.coAdd(d, { requested_on: '2026-09-28', invoice_no: '9000001', bl_no: 'exaw261001', co_type: 'FTA 원산지증명서', due_date: '2026-10-02' }, '2026-09-28T01:00:00Z');
  assert.deepEqual([r.status, r.bl_no], ['requested', 'EXAW261001']);
  assert.equal(C.coSetStatus(d, r.id, 'drafted', '2026-09-28', '2026-09-28T02:00:00Z'), true);
  assert.equal(C.coSetStatus(d, r.id, 'drafted', '2026-09-28', '2026-09-28T02:00:01Z'), false);   // 같은 상태는 기록 안 함
  C.coSetStatus(d, r.id, 'sent', '2026-09-29', '2026-09-29T01:00:00Z');
  C.coSetStatus(d, r.id, 'received', '2026-10-01', '2026-10-01T01:00:00Z');
  C.coSetStatus(d, r.id, 'forwarded', '2026-10-01', '2026-10-01T02:00:00Z', '통관팀 메일로 전달');
  assert.deepEqual([r.sent_on, r.received_on, r.forwarded_on], ['2026-09-29', '2026-10-01', '2026-10-01']);
  assert.deepEqual(d.co.history.map(e => e.to), ['requested', 'drafted', 'sent', 'received', 'forwarded']);
  assert.equal(C.coHistoryRows(d)[0]['메모'], '통관팀 메일로 전달');                     // 최근 것부터
  assert.throws(() => C.coAdd(d, { co_type: 'x' }, '2026-09-28T03:00:00Z'), /하나는/);
});
test('기한 판정: 지남 · 임박 · 업체 미요청 2일 초과 · 수령 후 전달 전', () => {
  const r = { status: 'requested', requested_on: '2026-09-20', due_date: '2026-09-27', supplier_code: 'X' };
  assert.deepEqual(C.coFlags(r, TODAY).map(f => f.code), ['overdue', 'unsent']);
  assert.deepEqual(C.coFlags(Object.assign({}, r, { status: 'sent', due_date: '2026-09-30' }), TODAY).map(f => f.label), ['기한 2일 남음']);
  assert.deepEqual(C.coFlags(Object.assign({}, r, { status: 'received' }), TODAY).map(f => f.code), ['toforward']);
  assert.deepEqual(C.coFlags(Object.assign({}, r, { status: 'forwarded' }), TODAY), []);
});
test('번호로 채우기: Invoice 번호 → A/N B/L·PO → 대장 업체', () => {
  const d = anDb30();
  const s = C.coSuggest(d, { invoice_no: '9000002' }, L, I);
  assert.deepEqual([s.bl_no, s.po_no, s.supplier_code], ['EXAW261002', 'EX4500010008', 'EX-D04']);
  const p = C.coSuggest(d, { po_no: 'EX4500010006' }, L, I);
  assert.deepEqual([p.bl_no, p.supplier_code], ['EXSH261001', 'EX-C03']);
});
test('메일 초안: 영문 본문(대상 목록·C/O 종류·기한 영문 날짜) + 국문 요약은 기본 화면에만, mailto 주소', () => {
  const d = sampleDb();
  d.settings.sender_name = 'Buyer A';
  const sup = L.supplierByCode(d.suppliers, 'EX-A01');
  const reqs = [C.coAdd(d, { invoice_no: 'INV-1', bl_no: 'BL1', po_no: 'EX4500010002', co_type: 'FTA 원산지증명서', due_date: '2026-10-05' }, '2026-09-30T00:00:00Z')];
  let m = C.coDraft(reqs, sup, d);
  assert.equal(m.subject, '[Request] Certificate of Origin - Invoice INV-1');
  assert.match(m.body, /Dear Anna Keller/);
  assert.match(m.body, /Certificate of Origin \(FTA Certificate of Origin\)/);
  assert.match(m.body, /- Invoice No: INV-1 \/ B\/L No: BL1 \/ PO No: EX4500010002/);
  assert.match(m.body, /by October 5, 2026/);
  assert.doesNotMatch(m.body, /국문 요약/);
  assert.match(m.noteKo, /원산지증명서\(FTA 원산지증명서\)/);
  assert.match(m.mailto, /^mailto:anna\.keller@alpha-precision\.example\.com\?cc=sales%40alpha-precision\.example\.com&subject=%5BRequest%5D/);
  assert.match(decodeURIComponent(m.mailto.split('body=')[1]), /Best regards,\r\nBuyer A/);
  m = C.coDraft(reqs, sup, d, { includeKo: true });
  assert.match(m.body, /----\n\[국문 요약\]/);
  const noDue = C.coDraft([Object.assign({}, reqs[0], { due_date: '' })], sup, d);
  assert.match(noDue.body, /send it at your earliest convenience/);
  assert.equal(C.typeEn('한-아세안 서식'), 'Certificate of Origin — 한-아세안 서식');
});
test('설정 템플릿에 C/O 요청 문안 추가(설정 화면에서 바꿀 수 있음)', () => {
  assert.ok(L.TEMPLATE_KEYS.some(t => t.key === 'co_request'));
  assert.match(L.defaultTemplates().co_request.body, /\{CO_LIST\}/);
  assert.deepEqual(L.emptyDb().co, { reqs: [], history: [] });
});

console.log('\nAI 자동 보내기(선택) 요청 모양 (09-30)');
test('키가 있으면 Bearer, 그림이 있으면 image_url 로 함께, 주소 끝 /chat/completions 정리', () => {
  const r = AI.buildRequest({ baseUrl: 'https://llm.example.com/v1/chat/completions/', model: 'm', apiKey: 'k' }, 'P', ['data:image/jpeg;base64,AA']);
  assert.equal(r.url, 'https://llm.example.com/v1/chat/completions');
  assert.equal(r.init.headers.Authorization, 'Bearer k');
  const b = JSON.parse(r.init.body);
  assert.deepEqual(b.messages[0].content.map(c => c.type), ['text', 'image_url']);
  assert.equal(AI.buildRequest({ baseUrl: 'http://x/v1', model: 'm' }, 'P').init.headers.Authorization, undefined);
  assert.equal(AI.check({ baseUrl: 'http://10.0.0.5/v1', model: 'm' }, 'https:').errors.length, 1);
  assert.equal(AI.readAnswer({ choices: [{ message: { content: '{"a":1}' } }] }), '{"a":1}');
});

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패 있음' : ''));
