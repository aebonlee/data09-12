/* 예시 데이터 — 모두 지어낸 값입니다(업체·PO·중량·메일). 실제 업체·거래와 관계없습니다.
   메일 주소는 예시용 도메인(example.com 하위)만 씁니다. */
(function (root) {
  'use strict';
  function shift(today, n) {
    var d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // Contact List 엑셀을 흉내 낸 표(열 이름도 예시)
  var contactRows = [
    { 'Vendor Code': 'EX-A01', 'Supplier Name': 'Alpha Precision GmbH (예시)', 'Contact': 'Anna Keller', 'E-mail': 'anna.keller@alpha-precision.example.com', 'CC': 'sales@alpha-precision.example.com', 'Tel': '+49-000-0000-001', 'Country': 'Germany', 'Remarks': 'OC 에 EXW DATE 기재 요청; Packing List 에 Gross Weight 기재 확인' },
    { 'Vendor Code': 'EX-B02', 'Supplier Name': 'Bravo Engine Parts Inc. (예시)', 'Contact': 'Brian Moore', 'E-mail': 'brian.moore@bravo-parts.example.com', 'CC': '', 'Tel': '+1-000-000-0002', 'Country': 'USA', 'Remarks': 'Weekly Order Status 매주 수신; Promise Date 변경 시 사유 확인' },
    { 'Vendor Code': 'EX-C03', 'Supplier Name': 'Charlie Hydraulics Co., Ltd. (예시)', 'Contact': 'Chen Li', 'E-mail': 'chen.li@charlie-hyd.example.com', 'CC': 'export@charlie-hyd.example.com', 'Tel': '+86-000-0000-003', 'Country': 'China', 'Remarks': '선적서류 원본 별도 송부' },
    { 'Vendor Code': 'EX-D04', 'Supplier Name': 'Delta Castings S.p.A. (예시)', 'Contact': 'Davide Rossi', 'E-mail': 'd.rossi@delta-cast.example.com', 'CC': '', 'Tel': '+39-000-000-004', 'Country': 'Italy', 'Remarks': '' }
  ];

  // 대장 예시. 날짜는 오늘 기준 상대값이라, 언제 열어도 여러 상태가 섞여 보입니다.
  function ledger(today) {
    var t = function (n) { return shift(today, n); };
    return [
      { po_no: 'EX4500010001', supplier_code: 'EX-A01', item: 'Bearing housing', po_date: t(-60), sent_date: t(-60), oc_date: t(-57), exw_promised: t(-20), exw_actual: t(-20), etd: t(-15), an_received: true, docs_received: true, note: '' },
      { po_no: 'EX4500010002', supplier_code: 'EX-A01', item: 'Shaft seal kit', po_date: t(-45), sent_date: t(-45), oc_date: t(-44), exw_promised: t(-10), exw_actual: t(-6), etd: t(-2), an_received: false, docs_received: true, note: '' },
      { po_no: 'EX4500010003', supplier_code: 'EX-B02', item: 'Fuel injector', po_date: t(-50), sent_date: t(-50), oc_date: t(-49), exw_promised: t(-25), exw_actual: t(-30), etd: t(-24), an_received: true, docs_received: true, note: '' },
      { po_no: 'EX4500010004', supplier_code: 'EX-B02', item: 'Turbocharger', po_date: t(-30), sent_date: t(-30), oc_date: t(-26), exw_promised: t(-3), exw_actual: '', etd: t(4), an_received: false, docs_received: false, note: '' },
      { po_no: 'EX4500010005', supplier_code: 'EX-C03', item: 'Hydraulic pump', po_date: t(-40), sent_date: t(-40), oc_date: t(-35), exw_promised: t(-12), exw_actual: t(-2), etd: t(3), an_received: false, docs_received: false, note: '' },
      { po_no: 'EX4500010006', supplier_code: 'EX-C03', item: 'Control valve', po_date: t(-9), sent_date: t(-9), oc_date: '', exw_promised: '', exw_actual: '', etd: '', an_received: false, docs_received: false, note: '' },
      { po_no: 'EX4500010007', supplier_code: 'EX-D04', item: 'Cast bracket', po_date: t(-12), sent_date: t(-12), oc_date: '', exw_promised: '', exw_actual: '', etd: '', an_received: false, docs_received: false, note: '' },
      { po_no: 'EX4500010008', supplier_code: 'EX-D04', item: 'Flywheel housing', po_date: t(-6), sent_date: t(-6), oc_date: '', exw_promised: '', exw_actual: '', etd: '', an_received: false, docs_received: false, note: '' },
      { po_no: 'EX4500010009', supplier_code: 'EX-A01', item: 'Gear set', po_date: t(-20), sent_date: t(-20), oc_date: t(-18), exw_promised: t(5), exw_actual: '', etd: '', an_received: false, docs_received: false, note: '' },
      { po_no: 'EX4500010010', supplier_code: 'EX-B02', item: 'Oil cooler', po_date: t(-1), sent_date: t(-1), oc_date: '', exw_promised: '', exw_actual: '', etd: '', an_received: false, docs_received: false, note: '' }
    ];
  }

  // 발주 메일 초안 연습용 PO PDF 내용(영문 단순 양식, 예시)
  var poPdfs = [
    { name: '예시데이터_PO_EX4500010011_Alpha.pdf', lines: ['SAMPLE PURCHASE ORDER (EXAMPLE DATA)', 'PO No.: EX4500010011', 'Supplier: Alpha Precision GmbH', 'Item: Bearing housing  Qty: 20 EA', 'Requested EXW: see Order Confirmation'] },
    { name: '예시데이터_PO_EX4500010012.pdf', lines: ['SAMPLE PURCHASE ORDER (EXAMPLE DATA)', 'PO No.: EX4500010012', 'Supplier: Charlie Hydraulics Co., Ltd.', 'Item: Hydraulic pump  Qty: 4 EA'] },
    { name: '예시데이터_발주서_3.pdf', lines: ['SAMPLE PURCHASE ORDER (EXAMPLE DATA)', 'Purchase Order Number: EX4500010013', 'Vendor: Unknown Trading (not in contact list)', 'Item: Spare filter  Qty: 100 EA'] }
  ];

  // Weekly Order Status 두 주차(열 이름은 예시 — 실제 파일 열은 수강생 확인 필요)
  var weeklyOld = [
    { 'PO Number': 'EX4500010003', 'Line': 1, 'Part Number': 'EX-FI-100', 'Order Qty': 12, 'Promise Date': '2026-10-05' },
    { 'PO Number': 'EX4500010004', 'Line': 1, 'Part Number': 'EX-TC-220', 'Order Qty': 2, 'Promise Date': '2026-10-12' },
    { 'PO Number': 'EX4500010004', 'Line': 2, 'Part Number': 'EX-TC-221', 'Order Qty': 2, 'Promise Date': '2026-10-12' },
    { 'PO Number': 'EX4500010010', 'Line': 1, 'Part Number': 'EX-OC-310', 'Order Qty': 6, 'Promise Date': '2026-11-02' },
    { 'PO Number': 'EX4500010014', 'Line': 1, 'Part Number': 'EX-GS-005', 'Order Qty': 30, 'Promise Date': '2026-10-20' }
  ];
  var weeklyNew = [
    { 'PO Number': 'EX4500010003', 'Line': 1, 'Part Number': 'EX-FI-100', 'Order Qty': 12, 'Promise Date': '2026-10-05' },
    { 'PO Number': 'EX4500010004', 'Line': 1, 'Part Number': 'EX-TC-220', 'Order Qty': 2, 'Promise Date': '2026-10-19' },
    { 'PO Number': 'EX4500010004', 'Line': 2, 'Part Number': 'EX-TC-221', 'Order Qty': 2, 'Promise Date': '2026-10-12' },
    { 'PO Number': 'EX4500010010', 'Line': 1, 'Part Number': 'EX-OC-310', 'Order Qty': 6, 'Promise Date': '2026-10-28' },
    { 'PO Number': 'EX4500010015', 'Line': 1, 'Part Number': 'EX-VL-410', 'Order Qty': 8, 'Promise Date': '2026-11-09' }
  ];

  // Packing List(예시). 행 중량 = 그 행의 총중량(kg) 이라고 가정
  var packingRows = [
    { 'Invoice No': 'EX-INV-001', 'Part No': 'EX-FI-100', 'Q\'ty': 12, 'Gross Weight (kg)': 36.5 },
    { 'Invoice No': 'EX-INV-001', 'Part No': 'EX-TC-220', 'Q\'ty': 2, 'Gross Weight (kg)': 58.2 },
    { 'Invoice No': 'EX-INV-001', 'Part No': 'EX-TC-221', 'Q\'ty': 2, 'Gross Weight (kg)': 57.9 },
    { 'Invoice No': 'EX-INV-001', 'Part No': 'TOTAL', 'Q\'ty': 16, 'Gross Weight (kg)': 152.6 },
    { 'Invoice No': 'EX-INV-002', 'Part No': 'EX-HP-500', 'Q\'ty': 4, 'Gross Weight (kg)': 210 },
    { 'Invoice No': 'EX-INV-002', 'Part No': 'EX-CV-510', 'Q\'ty': 10, 'Gross Weight (kg)': 45.5 }
  ];
  var blWeights = { 'EX-INV-001': 152.6, 'EX-INV-002': 262 };

  // 받은 메일 예시(.eml 원문). 날짜는 오늘 기준
  function mails(today) {
    function eml(from, subject, body, date) {
      return 'From: ' + from + '\r\nTo: buyer@our-company.example.com\r\nSubject: ' + subject + '\r\nDate: ' + date +
        '\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n' + body + '\r\n';
    }
    function d(n) {
      var x = new Date(shift(today, n) + 'T09:30:00Z');
      return x.toUTCString().replace('GMT', '+0000');
    }
    return [
      { name: '예시데이터_메일1_Charlie_OC.eml', text: eml('Chen Li <chen.li@charlie-hyd.example.com>', 'Order Confirmation - PO EX4500010006', 'Dear buyer,\r\nPlease find our order confirmation for PO EX4500010006.\r\nEXW date: ' + shift(today, 21) + '\r\nBest regards', d(0)) },
      { name: '예시데이터_메일2_Delta_문의.eml', text: eml('Davide Rossi <d.rossi@delta-cast.example.com>', 'Question on drawing revision', 'Dear buyer,\r\nCould you confirm the drawing revision for PO EX4500010007?\r\nRegards', d(-1)) },
      { name: '예시데이터_메일3_Bravo_WOS.eml', text: eml('Brian Moore <brian.moore@bravo-parts.example.com>', 'Weekly Order Status', 'Hello,\r\nAttached is this week\'s order status.\r\nThanks', d(-2)) },
      { name: '예시데이터_메일4_미등록.eml', text: eml('info@unknown-forwarder.example.com', 'Arrival Notice', 'Arrival notice for shipment EX-INV-002.', d(-1)) }
    ];
  }

  var api = { contactRows: contactRows, ledger: ledger, poPdfs: poPdfs, weeklyOld: weeklyOld, weeklyNew: weeklyNew, packingRows: packingRows, blWeights: blWeights, mails: mails, shift: shift };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OMSample = api;
})(typeof window !== 'undefined' ? window : this);
