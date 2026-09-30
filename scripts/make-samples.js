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
// 외자 부품 Invoice 예시 2가지 양식(2026-09-30) — 지어낸 값
S.invoicePdfs.forEach(p => fs.writeFileSync(path.join(OUT, p.name), L.makeSimplePdf(p.lines)));
S.mails(BASE).forEach(m => fs.writeFileSync(path.join(OUT, m.name), m.text));
// 포워더 도착 통지(A/N) 예시 3가지 양식 + 같은 B/L 의 수정 A/N(ETA 변경) — 지어낸 것
S.anMails(BASE).forEach(m => fs.writeFileSync(path.join(OUT, m.name), m.text));

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

// ── 「wk38 분석E」 형식 예시(노란 채우기 포함) ──
// SheetJS 무료판은 셀 서식을 쓰지 못해, 노란 채우기가 든 xlsx 는 XML 을 직접 만들어 ZIP 으로 묶습니다.
{
  const g = S.cumGrid();
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = c => { let s = ''; c++; while (c) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  const rowsXml = g.grid.map((row, i) => {
    const rn = i + 1, st = g.yellow[rn] ? ' s="1"' : '';
    const cells = row.map((v, c) => {
      if (v === '' || v == null) return g.yellow[rn] ? '<c r="' + colName(c) + rn + '"' + st + '/>' : '';
      const ref = colName(c) + rn;
      return typeof v === 'number' ? '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>' : '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t>' + esc(v) + '</t></is></c>';
    }).join('');
    return '<row r="' + rn + '">' + cells + '</row>';
  }).join('');
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const files = [
    ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="wk38 분석(예시)" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', X + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', X + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rowsXml + '</sheetData></worksheet>']
  ];
  fs.writeFileSync(path.join(OUT, '예시데이터_Integrated_Order_Status_wk38_분석.xlsx'), L.makeZip(files.map(([name, text]) => ({ name, text }))));
}
// 지난주(wk37) 분석 시트 예시 — 「Cummins EXW」 화면의 「지난주 파일 선택」으로 이번 주와 비교합니다(칠 없음)
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(S.cumPrevGrid().grid), 'wk37 분석(예시)');
  fs.writeFileSync(path.join(OUT, '예시데이터_Integrated_Order_Status_wk37_분석.xlsx'), XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
}

// ── 2026-09-29 밤: 실물 「도착일정통지」 양식을 본뜬 A/N 예시(구조만 같고 값은 모두 지어낸 것) ──
// 해상: 본문 표 메일 + 같은 내용의 엑셀(.xls, 31칸) + House B/L 사본 PDF(4쪽) / 항공: ks_c_5601-1987 메일 + HAWB PDF 2개
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(S.anSeaGrid(BASE)), 'Sheet1');
  const xls = Buffer.from(XLSX.write(wb, { bookType: 'biff8', type: 'array' }));
  const pdf = Buffer.from(L.makeSimplePdf(S.anSeaPdfPages(BASE)));
  fs.writeFileSync(path.join(OUT, '예시데이터_AN_부산_해상.xls'), xls);
  fs.writeFileSync(path.join(OUT, '예시데이터_AN_부산_해상.pdf'), pdf);
  fs.writeFileSync(path.join(OUT, '예시데이터_AN5_도착일정통지_해상.eml'), S.anSeaMail(BASE, [
    { name: '예시_AN_부산.xls', type: 'application/vnd.ms-excel', b64: xls.toString('base64') },
    { name: '예시_AN_부산.pdf', type: 'application/pdf', b64: pdf.toString('base64') }]));
  const airAtts = S.AN_AIR.map(a => ({ name: a.hawb + '.pdf', b64: Buffer.from(L.makeSimplePdf(S.anAirPdfPages(BASE, a))).toString('base64') }));
  fs.writeFileSync(path.join(OUT, '예시데이터_AN6_도착일정통지_항공.eml'), S.anAirMail(BASE, airAtts));
}
