// 예시 파일 만들기: node scripts/make-samples.js
// samples/ 에 예시 엑셀·PDF·메일(.eml) 을 만듭니다. 모두 지어낸 예시 데이터입니다.
'use strict';
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const S = require('../js/sample-data.js');

const OUT = path.join(__dirname, '..', 'samples');
const BASE = '2026-09-28'; // 예시 대장·메일 날짜의 기준일
fs.mkdirSync(OUT, { recursive: true });

function xlsx(name, sheets) {
  const wb = XLSX.utils.book_new();
  Object.keys(sheets).forEach(n => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheets[n]), n));
  fs.writeFileSync(path.join(OUT, name), XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
}
xlsx('예시데이터_Weekly_Order_Status_이전주차.xlsx', { 'Order Status': S.weeklyOld });
xlsx('예시데이터_Weekly_Order_Status_이번주차.xlsx', { 'Order Status': S.weeklyNew });
xlsx('예시데이터_PackingList.xlsx', { 'Packing List': S.packingRows });
const db = L.emptyDb();
db.suppliers = L.importSuppliers(L.applyMapping(S.contactRows, L.guessMapping(Object.keys(S.contactRows[0]), 'supplier'))).suppliers;
db.pos = S.ledger(BASE).map(p => L.cleanPo(p, db.suppliers));
xlsx('예시데이터_관리대장.xlsx', { '관리대장': L.ledgerRows(db, BASE) });
S.poPdfs.forEach(p => fs.writeFileSync(path.join(OUT, p.name), L.makeSimplePdf(p.lines)));
S.mails(BASE).forEach(m => fs.writeFileSync(path.join(OUT, m.name), m.text));

// ── 2026-09-29 실물 자료와 같은 형식의 예시(값은 모두 지어낸 것) ──
xlsx('예시데이터_ContactList.xlsx', { 'Contact List': S.contactRows.concat([S.echoSupplier]) });
// 공급사 OC 엑셀(구형 .xls) 2개와, 그것을 첨부한 OC 회신 메일
const ocAtts = S.ocFiles.map(f => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(S.ocGrid(f.po)), 'Sheet1');
  const buf = Buffer.from(XLSX.write(wb, { bookType: 'biff8', type: 'array' }));
  fs.writeFileSync(path.join(OUT, '예시데이터_' + f.name), buf);
  return { name: f.name, b64: buf.toString('base64') };
});
fs.writeFileSync(path.join(OUT, '예시데이터_메일5_Echo_OC회신.eml'), S.replyEml(BASE, ocAtts));
// PDF 뷰어에서 복사한 글(열 단위로 끊긴 배치)
fs.writeFileSync(path.join(OUT, '예시데이터_PO_붙여넣기_O261110502.txt'), S.realPoPaste + '\n');
// Cummins Integrated Order Status 와 같은 열·시트 구성(한 파일 두 주차 시트, 머리글 위 제목 줄)
{
  const wb = XLSX.utils.book_new();
  [['wk37', S.weeklyWk37], ['wk38', S.weeklyWk38]].forEach(([n, rows]) => {
    const aoa = [['예시 Integrated Order Status (지어낸 값)']].concat([S.WOS_HEAD], rows.map(r => S.WOS_HEAD.map(k => r[k])));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n);
  });
  fs.writeFileSync(path.join(OUT, '예시데이터_Integrated_Order_Status_wk37_wk38.xlsx'), XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
}
console.log(fs.readdirSync(OUT).join('\n'));
