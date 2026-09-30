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
      { po_no: 'EX4500010003', supplier_code: 'EX-B02', item: 'Fuel injector', po_date: t(-50), sent_date: t(-50), oc_date: t(-49), exw_promised: t(-25), exw_actual: t(-30), etd: t(-24), an_received: true, docs_received: true, note: '', bl_no: 'GMAO26090077' },
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
  // 실물 구매발주서와 같은 배치의 예시 PDF(아래 realPoLines)는 poPdfs 뒤에 붙입니다.

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

  /* ── 2026-09-29 메일로 받은 실물 자료와 「같은 형식」의 예시 ───────────────
     실물(구매발주서 PDF·공급사 OC 엑셀·OC 회신 메일·Cummins 주간 오더 현황)의 배치만 따르고,
     업체·담당자·PO 번호 숫자·품번·단가는 모두 지어낸 값입니다. PO 번호 체계(영문 1자 + 숫자 9자리)만 같습니다. */
  var echoSupplier = { 'Vendor Code': 'EX-E05', 'Supplier Name': 'Echo Lighting Inc. (예시)', 'Contact': 'Emma Stone', 'E-mail': 'emma.stone@echo-group.example.com', 'CC': 'orders@echo-group.example.com', 'Tel': '+1-000-000-0005', 'Country': 'USA', 'Remarks': '' };

  // 구매발주서 PDF 를 pdftotext -layout 으로 읽은 것과 같은 줄 배치(값은 예시)
  var realPoLines = [
    'EXAMPLE BUYER CO.,LTD (SAMPLE)',
    'To       Echo Lighting Inc.                        Date          2026-09-01 (TUE)',
    'Fax                                                Our Ref.      M261110501',
    'Attn.    Emma Stone                                Prepared by   SAMPLE BUYER',
    'Subject: Purchase Order (M261110501)',
    'Seller\'s name : Echo Lighting Inc.',
    'Address : 100 Example Road, Sample City, USA',
    'Contract No. : M261110501',
    'Issued Date : SEP 01, 2026',
    '1. Scope of Supply and Specification',
    'SEQ   PART NO.     UNIT  Q\'ty  Currency  PRICE   AMOUNT   Contract Delivery Date  REMARK',
    'ITEM DESCRIPTION',
    '1     EX11-10001   EA    200   USD       5.50    1,100    Oct 30, 2026',
    'LAMP-EXAMPLE A [Mfr Part Number : EC-2001]',
    '2     EX11-10002   EA    120   USD       7.25    870      Oct 30, 2026',
    'LAMP-EXAMPLE B [Mfr Part Number : EC-2002]',
    '2. Contract Amount : USD 1,970 EXW Example Port, Incoterms 2010',
    '3. Payment Terms : Telegraphic Transfer within thirty (30) days after receiving shipping documents',
    '4. Country of Origin : U.S.A',
    'The country of origin stated above indicates the country of manufacture.'
  ];
  // PDF 뷰어에서 복사해 붙여넣으면 표가 열 단위로 끊겨 나오는 배치(실물에서 확인) — 두 번째 PO
  var realPoPaste = [
    'To', 'Fax', 'Attn.', 'Echo Lighting Inc.', 'Date', '2026-09-01 (TUE)', 'Emma Stone', 'Our Ref.', 'Prepared by', 'O261110502', 'SAMPLE BUYER',
    'Subject: Purchase Order (O261110502)', 'Seller\'s name : Echo Lighting Inc.', 'Address : 100 Example Road, Sample City, USA',
    'Contract No. : O261110502', 'Issued Date : SEP 01, 2026', '1. Scope of Supply and Specification', 'SEQ', 'PART', 'NO.', 'UNIT', 'Q\'ty', 'Currency',
    'ITEM DESCRIPTION', '1', 'EX22-20001', 'EA', '60', 'USD', 'LAMP-EXAMPLE C [Mfr Part Number : EC-3001]',
    'PRICE', 'Contract', 'Delivery', 'Date', 'AMOUNT', '12.00', '720', 'Oct 15, 2026', 'REMARK',
    '2. Contract Amount : USD 720 EXW Example Port, Incoterms 2010', '4. Country of Origin : U.S.A', 'The country of origin stated above.'
  ].join('\n');

  // 대장에 이미 송부한 것으로 들어 있는 두 PO(OC 회신 메일 예시와 짝)
  function realLedger(today) {
    return [
      { po_no: 'M261110501', supplier_code: 'EX-E05', po_date: shift(today, -8), sent_date: shift(today, -8), delivery_date: '2026-10-30',
        lines: [{ seq: 1, part: 'EX11-10001', unit: 'EA', qty: 200, currency: 'USD', price: 5.5, amount: 1100, delivery: '2026-10-30', desc: 'LAMP-EXAMPLE A', mfr_part: 'EC-2001' },
          { seq: 2, part: 'EX11-10002', unit: 'EA', qty: 120, currency: 'USD', price: 7.25, amount: 870, delivery: '2026-10-30', desc: 'LAMP-EXAMPLE B', mfr_part: 'EC-2002' }] },
      { po_no: 'O261110502', supplier_code: 'EX-E05', po_date: shift(today, -8), sent_date: shift(today, -8), delivery_date: '2026-10-15',
        lines: [{ seq: 1, part: 'EX22-20001', unit: 'EA', qty: 60, currency: 'USD', price: 12, amount: 720, delivery: '2026-10-15', desc: 'LAMP-EXAMPLE C', mfr_part: 'EC-3001' }] }
    ].map(function (p) { p.item = p.lines[0].part + (p.lines.length > 1 ? ' 외 ' + (p.lines.length - 1) + '건' : ''); return p; });
  }

  // 공급사 OC 엑셀 배치(실물: 제목 ORDER CONFIRMATION, 16행 머리글, 파일명 「<코드> <PO> OC <번호> <MM-DD-YY>」)
  // M261110501 은 두 번째 줄 수량을 일부러 다르게(120 → 100) 넣어 대조 기능을 보여 줍니다.
  function ocGrid(po) {
    var g = [];
    g[1] = ['', '', 'Echo Lighting Inc. (SAMPLE)', '', '', '', '', '', '', '', 'ORDER CONFIRMATION'];
    g[7] = ['Consignee', '', '', '', 'Billing Address', '', '', '', 'Shipment Information'];
    g[12] = ['Country:', 'REPUBLIC OF KOREA', '', '', '', '', '', '', '', 'Incoterms:', 'EXWORKS'];
    g[15] = ['Units', 'Echo Part #', 'Cust. Part #', 'PO #', 'INV #', 'Harmonized Code', 'Country of Origin', 'Description', '', '', '', '', 'Unit Value', 'Total Value'];
    if (po === 'M261110501') {
      g[16] = [200, 'EC-2001', 'EX11-10001', po, '900101', '0000.00', 'USA', 'LAMP-EXAMPLE A', '', '', '', '', 5.5, 1100];
      g[17] = [100, 'EC-2002', 'EX11-10002', po, '900101', '0000.00', 'USA', 'LAMP-EXAMPLE B', '', '', '', '', 7.25, 725];
    } else {
      g[16] = [60, 'EC-3009', 'EX22-20001', po, '900102', '0000.00', 'USA', 'LAMP-EXAMPLE C', '', '', '', '', 12, 720];
    }
    g[34] = ['', '', '', '', '', '', '', '', '', '', 'Customs Value Only in USD'];
    g[37] = ['', '', '', '', '', '', 'SAMPLE SIGNER', '', '', '', '', '', 46315];
    for (var i = 0; i < g.length; i++) if (!g[i]) g[i] = [];
    return g;
  }
  var ocFiles = [
    { po: 'M261110501', name: 'EX001 M261110501 OC 900101 10-20-26.xls' },
    { po: 'O261110502', name: 'EX001 O261110502 OC 900102 10-20-26.xls' }
  ];

  // OC 회신 메일(.eml) — 실물 구조: multipart/mixed ⊃ multipart/alternative(text/plain base64 + text/html QP) + 엑셀 첨부 2개,
  // 참조(CC)의 한글 이름은 RFC 2047 인코딩. atts: [{ name, b64 }]
  function b64utf8(s) {
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
    return btoa(unescape(encodeURIComponent(s)));
  }
  function wrap76(s) { return s.replace(/.{1,76}/g, '$&\r\n'); }
  function replyEml(today, atts) {
    var b1 = '_mixed_example_', b2 = '_alt_example_';
    var d = new Date(shift(today, -1) + 'T19:19:47Z').toUTCString().replace('GMT', '+0000');
    var plain = 'Good afternoon,\r\n\r\nAttached please find the order confirmations for your orders listed above.\r\nThank you.\r\n\r\nOrder Entry\r\nEcho Lighting Inc. (sample)\r\n\r\n' +
      'From: Sample Buyer\r\nSubject: Purchase Order [EX-E05] : O261110502, M261110501 / Echo Lighting Inc.\r\n\r\nPlease find attached the new P.O.\r\nWe would appreciate it if you could kindly provide the O.A/O.C within 7 days.\r\n';
    var html = '<p>Good afternoon,</p><p>Attached please find the order confirmations for your orders listed above.=\r\n Thank you.</p>';
    var parts = [
      'From: Order Entry <orders@echo-group.example.com>',
      'To: Emma Stone <emma.stone@echo-group.example.com>',
      'CC: =?utf-8?B?' + b64utf8('김예시(Kim, Example)/사원/생산관리팀') + '?=\r\n <buyer@our-company.example.com>',
      'Subject: RE: Purchase Order [EX-E05] : O261110502, M261110501 / =?utf-8?B?' + b64utf8('Echo Lighting Inc. (예시)') + '?=',
      'Date: ' + d,
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed;\r\n\tboundary="' + b1 + '"',
      '',
      '--' + b1,
      'Content-Type: multipart/alternative;\r\n\tboundary="' + b2 + '"',
      '',
      '--' + b2,
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(b64utf8(plain)),
      '--' + b2,
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      html,
      '',
      '--' + b2 + '--',
      ''
    ];
    (atts || []).forEach(function (a) {
      parts.push('--' + b1, 'Content-Type: application/vnd.ms-excel;\r\n\tname="' + a.name + '"', 'Content-Description: ' + a.name,
        'Content-Disposition: attachment;\r\n\tfilename="' + a.name + '"; size=' + Math.floor(a.b64.length * 3 / 4) + ';', 'Content-Transfer-Encoding: base64', '', wrap76(a.b64));
    });
    parts.push('--' + b1 + '--', '');
    return parts.join('\r\n');
  }

  // Cummins Integrated Order Status 와 같은 열 구성(실물 확인). 값은 모두 예시.
  // 같은 PO·품번이 SO# 만 달리 여러 행(분할 출고), Promise Date 칸의 'cancelled'·'a=>b', Remarks 의 'a->b' 를 넣었습니다.
  var WOS_HEAD = ['품목', '구분', 'Order Date', '1OM#', 'Customer PO', 'Plant', 'CSL#', 'Machine', 'Part No.', 'Engine', 'Part Description', 'SO#', 'QTY', 'Req Date', 'Promise Date', 'INV Date', 'INV#', 'Remarks', 'Shipping mode', 'Emission', 'Status'];
  function wosRow(v) { var o = {}; WOS_HEAD.forEach(function (k, i) { o[k] = v[i] == null ? '' : v[i]; }); return o; }
  var weeklyWk37 = [
    ['엔진', 'EX', '2026-05-02', 510001, 'M261200011', 'PLANT-A', 'EXE-1001', 'EX100', 'EXE-1001', 'ENG-A', 'Engine Assy', 70001, 10, '2026-08-20', '2026-09-30', '', '', '', 'OCEAN', 'Tier4', 'Undispatched'],
    ['엔진', 'EX', '2026-05-02', 510002, 'M261200011', 'PLANT-A', 'EXE-1001', 'EX100', 'EXE-1001', 'ENG-A', 'Engine Assy', 70002, 6, '2026-08-20', '2026-10-10', '', '', '', 'OCEAN', 'Tier4', 'Undispatched'],
    ['엔진', 'EX', '2026-05-10', 510010, 'O261200020', 'PLANT-B', 'EXE-2002', 'EX200', 'EXE-2002', 'ENG-B', 'Engine Assy', 70010, 4, '2026-09-01', '2026-10-05', '', '', '', 'OCEAN', 'StageV', 'Undispatched'],
    ['부품', 'EX', '2026-06-01', 510020, 'B261200030', 'PLANT-A', 'EXP-3003', 'EX300', 'EXP-3003', '', 'Turbo Kit', 70020, 12, '2026-09-15', '2026-10-20', '', '', '', 'AIR', '', 'Undispatched'],
    ['엔진', 'EX', '2026-04-11', 510030, 'M261200040', 'PLANT-B', 'EXE-4004', 'EX400', 'EXE-4004', 'ENG-C', 'Engine Assy', 70030, 2, '2026-08-01', '2026-09-12', '2026-09-10', 'INV-0001', '', 'OCEAN', 'Tier4', 'Dispatched']
  ].map(wosRow);
  var weeklyWk38 = [
    ['엔진', 'EX', '2026-05-02', 510001, 'M261200011', 'PLANT-A', 'EXE-1001', 'EX100', 'EXE-1001', 'ENG-A', 'Engine Assy', 70001, 10, '2026-08-20', '2026-10-14', '', '', '공급 일정 조정 9/30->10/14', 'OCEAN', 'Tier4', 'Undispatched'],
    ['엔진', 'EX', '2026-05-02', 510002, 'M261200011', 'PLANT-A', 'EXE-1001', 'EX100', 'EXE-1001', 'ENG-A', 'Engine Assy', 70002, 6, '2026-08-20', '2026-10-10', '', '', '', 'OCEAN', 'Tier4', 'Undispatched'],
    ['엔진', 'EX', '2026-05-10', 510010, 'O261200020', 'PLANT-B', 'EXE-2002', 'EX200', 'EXE-2002', 'ENG-B', 'Engine Assy', 70010, 4, '2026-09-01', '10/5/2026=>9/28', '', '', '일정 단축 요청', 'OCEAN', 'StageV', 'Undispatched'],
    ['부품', 'EX', '2026-06-01', 510020, 'B261200030', 'PLANT-A', 'EXP-3003', 'EX300', 'EXP-3003', '', 'Turbo Kit', 70020, 12, '2026-09-15', 'cancelled', '', '', '취소->PO 재송부 예정', 'AIR', '', 'Abnormal'],
    ['엔진', 'EX', '2026-06-20', 510040, 'M261200050', 'PLANT-A', 'EXE-5005', 'EX500', 'EXE-5005', 'ENG-A', 'Engine Assy', 70040, 3, '2026-10-01', '2026-11-02', '', '', '', 'OCEAN', 'Tier4', 'Undispatched']
  ].map(wosRow);

  poPdfs.push({ name: '예시데이터_PO_M261110501.pdf', lines: realPoLines });

  /* ── 「wk38 분석E」 시트 형식 예시(2026-09-29 메일 추가 요청 2) ───────────────
     실물처럼 1행 제목·2행 머리글, 노란 줄(EXW 변경 건)·분할 선적·수량 불일치·다른 구분(HDX)·대장에 없는 PO 를 넣었습니다. 값은 모두 지어낸 것. */
  var foxSupplier = { 'Vendor Code': 'EX-F06', 'Supplier Name': 'Foxtrot Engine Co. (예시)', 'Contact': 'Frank Lee', 'E-mail': 'frank.lee@foxtrot-engine.example.com', 'CC': '', 'Tel': '+1-000-000-0006', 'Country': 'USA', 'Remarks': '' };
  function cumLedger(today) {
    var L1 = function (part, qty) { return { seq: 1, part: part, unit: 'EA', qty: qty, currency: 'USD', price: null, amount: null, delivery: '', desc: 'Engine Assy', mfr_part: '' }; };
    return [
      { po_no: 'M261300011', supplier_code: 'EX-F06', sent_date: shift(today, -120), exw_promised: '2026-10-07', lines: [L1('EXE-1001', 16)] },           // 분할 선적 10+6 = 16 일치, 노란 줄
      { po_no: 'O261300020', supplier_code: 'EX-F06', sent_date: shift(today, -120), lines: [L1('EXE-2002', 8)] },                                        // 출고 2 + 남은 4 = 6 ≠ 8 (부족)
      { po_no: 'B261300030', supplier_code: 'EX-F06', sent_date: shift(today, -90), lines: [L1('EXP-3003', 12)], oc_lines: [{ part: 'EXP-3003', qty: 10 }] }, // PO 12 일치, OC 10 불일치
      { po_no: 'M261300060', supplier_code: 'EX-F06', sent_date: shift(today, -60), lines: [L1('EXE-6006', 5)] },                                         // 날짜가 글자('11/2/2026')
      { po_no: 'M261300070', supplier_code: 'EX-F06', sent_date: shift(today, -30), lines: [L1('EXE-7007', 4)] }                                          // 파일에 없음
    ].map(function (p) { p.item = p.lines[0].part; return p; });
  }
  var CUM_HEAD = ['품목', '구분', 'Order Date', '1OM#', 'Customer PO', 'Plant', 'CSL#', 'Machine', 'Part No.', 'Engine', 'Part Description', 'SO#', 'QTY', 'Req Date', 'Promise Date', 'INV Date', 'INV#', 'Remarks', 'Shipping mode', 'Emission', 'Status'];
  // [행 값들, 노란 줄 여부]. 날짜는 엑셀 일련번호(46302 = 2026-10-07)·글자 둘 다
  var cumData = [
    [['엔진', 'HCE', 46120, 520001, 'M261300011', 'PLANT-A', 'EXE-1001', 'EX100', 'EXE-1001', 'ENG-A', 'Engine Assy', 80001, 10, 46280, 46309, '', '', '일정 변경 10/7->10/14', 'OCEAN', 'Tier4', 'Undispatched'], true],
    [['엔진', 'HCE', 46120, 520002, 'M261300011', 'PLANT-A', 'EXE-1001', 'EX100', 'EXE-1001', 'ENG-A', 'Engine Assy', 80002, 6, 46280, 46323, '', '', '분할 선적', 'OCEAN', 'Tier4', 'undispatched '], true],
    [['엔진', 'HCE', 46130, 520010, 'O261300020', 'PLANT-B', 'EXE-2002', 'EX200', 'EXE-2002', 'ENG-B', 'Engine Assy', 80010, 2, 46270, 46275, 46274, 'INV-0101', '', 'OCEAN', 'StageV', 'Dispatched'], false],
    [['엔진', 'HCE', 46130, 520011, 'O261300020', 'PLANT-B', 'EXE-2002', 'EX200', 'EXE-2002', 'ENG-B', 'Engine Assy', 80011, 4, 46270, 46300, '', '', '', 'OCEAN', 'StageV', 'Undispatched'], false],
    [['부품', 'HCE', 46150, 520020, 'B261300030', 'PLANT-A', 'EXP-3003', 'EX300', 'EXP-3003', '', 'Turbo Kit', 80020, 12, 46290, 46315, '', '', '', 'AIR', '', 'Undispatched'], false],
    [['엔진', 'HDX', 46150, 520030, 'M261300040', 'PLANT-B', 'EXE-4004', 'EX400', 'EXE-4004', 'ENG-C', 'Engine Assy', 80030, 2, 46290, 46310, '', '', '', 'OCEAN', 'Tier4', 'Undispatched'], true],
    [['엔진', 'HCE', 46160, 520040, 'M261300050', 'PLANT-A', 'EXE-5005', 'EX500', 'EXE-5005', 'ENG-A', 'Engine Assy', 80040, 3, 46300, 46330, '', '', '', 'OCEAN', 'Tier4', 'Undispatched'], false],
    [['엔진', 'HCE', 46170, 520050, 'M261300060', 'PLANT-A', 'EXE-6006', 'EX600', 'EXE-6006', 'ENG-A', 'Engine Assy', 80050, 5, 46300, '11/2/2026', '', '', '', 'OCEAN', 'Tier4', 'Undispatched'], false],
    [['엔진', 'HCE', 46100, 520060, 'M261300080', 'PLANT-A', 'EXE-8008', 'EX800', 'EXE-8008', 'ENG-A', 'Engine Assy', 80060, 1, 46250, 46260, 46258, 'INV-0102', '', 'OCEAN', 'Tier4', 'Dispatched'], true],
    // 저장된 Status 는 Undispatched 지만 Promise Date(46285 = 2026-09-20)가 지났고 INV# 가 비어 → 오늘 기준으로는 Abnormal(제외 대상)
    [['엔진', 'HCE', 46100, 520070, 'M261300090', 'PLANT-A', 'EXE-9009', 'EX900', 'EXE-9009', 'ENG-A', 'Engine Assy', 80070, 2, 46270, 46285, '', '', '', 'OCEAN', 'Tier4', 'Undispatched'], false]
  ];
  var CUM_AS_OF = '2026-09-28';   // 예시 파일을 「저장한 날」 — 예시로 해 볼 때 Status 기준일
  // 지난주(wk37) 분석 시트 예시 — 이번 주(cumData)와 비교해 달라진 줄을 찾는 데 씁니다. 값은 모두 지어낸 것.
  //  · M261300011: 지난주엔 한 줄(16개, 10/07) → 이번 주 10개(10/14) + 6개(10/28, 새 SO#)로 분할
  //  · O261300020 남은 줄: 9/28 → 10/05 로 밀렸지만 이번 주 파일에 노란 칠이 없음(색만 보면 놓치는 줄)
  //  · O261300020 출고 줄: 지난주 Undispatched → 이번 주 Dispatched(Status 는 비교하지 않음)
  //  · M261300070: 지난주에 있었고 이번 주에 없음
  var cumPrevData = [
    ['엔진', 'HCE', 46120, 520001, 'M261300011', 'PLANT-A', 'EXE-1001', 'EX100', 'EXE-1001', 'ENG-A', 'Engine Assy', 80001, 16, 46280, 46302, '', '', '', 'OCEAN', 'Tier4', 'Undispatched'],
    ['엔진', 'HCE', 46130, 520010, 'O261300020', 'PLANT-B', 'EXE-2002', 'EX200', 'EXE-2002', 'ENG-B', 'Engine Assy', 80010, 2, 46270, 46275, '', '', '', 'OCEAN', 'StageV', 'Undispatched'],
    ['엔진', 'HCE', 46130, 520011, 'O261300020', 'PLANT-B', 'EXE-2002', 'EX200', 'EXE-2002', 'ENG-B', 'Engine Assy', 80011, 4, 46270, 46293, '', '', '', 'OCEAN', 'StageV', 'Undispatched'],
    ['부품', 'HCE', 46150, 520020, 'B261300030', 'PLANT-A', 'EXP-3003', 'EX300', 'EXP-3003', '', 'Turbo Kit', 80020, 12, 46290, 46315, '', '', '', 'AIR', '', 'Undispatched'],
    ['엔진', 'HDX', 46150, 520030, 'M261300040', 'PLANT-B', 'EXE-4004', 'EX400', 'EXE-4004', 'ENG-C', 'Engine Assy', 80030, 2, 46290, 46310, '', '', '', 'OCEAN', 'Tier4', 'Undispatched'],
    ['엔진', 'HCE', 46160, 520040, 'M261300050', 'PLANT-A', 'EXE-5005', 'EX500', 'EXE-5005', 'ENG-A', 'Engine Assy', 80040, 3, 46300, 46330, '', '', '', 'OCEAN', 'Tier4', 'Undispatched'],
    ['엔진', 'HCE', 46170, 520050, 'M261300060', 'PLANT-A', 'EXE-6006', 'EX600', 'EXE-6006', 'ENG-A', 'Engine Assy', 80050, 5, 46300, '11/2/2026', '', '', '', 'OCEAN', 'Tier4', 'Undispatched'],
    ['엔진', 'HCE', 46170, 520080, 'M261300070', 'PLANT-A', 'EXE-7007', 'EX700', 'EXE-7007', 'ENG-A', 'Engine Assy', 80080, 4, 46300, 46290, '', '', '', 'OCEAN', 'Tier4', 'Undispatched'],
    ['엔진', 'HCE', 46100, 520060, 'M261300080', 'PLANT-A', 'EXE-8008', 'EX800', 'EXE-8008', 'ENG-A', 'Engine Assy', 80060, 1, 46250, 46260, 46258, 'INV-0102', '', 'OCEAN', 'Tier4', 'Dispatched'],
    ['엔진', 'HCE', 46100, 520070, 'M261300090', 'PLANT-A', 'EXE-9009', 'EX900', 'EXE-9009', 'ENG-A', 'Engine Assy', 80070, 2, 46270, 46285, '', '', '', 'OCEAN', 'Tier4', 'Undispatched']
  ];
  function cumPrevGrid() {
    var grid = [['예시 Integrated Order Status wk37 분석 (지어낸 값)'], CUM_HEAD.slice()];
    cumPrevData.forEach(function (d) { grid.push(d.slice()); });
    return { grid: grid, yellow: {} };
  }
  // 엑셀 모양 그대로: 1행 제목, 2행 머리글, 3행부터 자료, 끝에 합계 줄. yellow = { 엑셀 행번호: true }
  function cumGrid() {
    var grid = [['예시 Integrated Order Status wk38 분석 (지어낸 값)'], CUM_HEAD.slice()];
    var yellow = {};
    cumData.forEach(function (d) { grid.push(d[0].slice()); if (d[1]) yellow[grid.length] = true; });
    grid.push(['', '', '', '', '', '', '', '', '', '', '', '', 45]);   // 합계 줄(PO·품번 없음)
    return { grid: grid, yellow: yellow };
  }


  /* ── 도착 통지(A/N) 예시 — 포워더 3곳의 서로 다른 양식(모두 지어낸 것, 실제 A/N 샘플을 받기 전의 가정) ─────
     ① Alpha Logistics: 영문 「라벨 : 값」 줄, 선명/항차 한 칸, 21-SEP-2026 날짜
     ② 베타해운: 국문 HTML 표(base64), 2026.10.08 날짜, B/L 은 제목과 표에
     ③ Gamma Air & Ocean: 라벨 다음 줄에 값(표를 줄 단위로 복사한 모양), Oct 25, 2026 날짜, lb 중량, PO 번호 없이 B/L 만
     ④ Alpha Logistics 수정 A/N: ①과 같은 B/L, ETA 변경(OLD/NEW) */
  function anMails(today) {
    var MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var MONL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function p(n) { return shift(today, n).split('-').map(Number); }
    function dmy(n) { var d = p(n); return (d[2] < 10 ? '0' : '') + d[2] + '-' + MON3[d[1] - 1] + '-' + d[0]; }
    function dot(n) { return shift(today, n).replace(/-/g, '.'); }
    function mdy(n) { var d = p(n); return MONL[d[1] - 1] + ' ' + (d[2] < 10 ? '0' : '') + d[2] + ', ' + d[0]; }
    function hdr(n, hh) { return new Date(shift(today, n) + 'T' + hh + ':00Z').toUTCString().replace('GMT', '+0000'); }
    function eml(from, subject, date, ctype, body, cte) {
      return 'From: ' + from + '\r\nTo: buyer@our-company.example.com\r\nSubject: ' + subject + '\r\nDate: ' + date +
        '\r\nMIME-Version: 1.0\r\nContent-Type: ' + ctype + (cte ? '\r\nContent-Transfer-Encoding: ' + cte : '') + '\r\n\r\n' + body + '\r\n';
    }
    var plain = 'text/plain; charset="UTF-8"';
    var an1 = [
      'ARRIVAL NOTICE  (SAMPLE - NOT A REAL SHIPMENT)',
      '',
      'Dear Customer,',
      'Please be advised that the following shipment will arrive as below.',
      '',
      'HBL NO.        : ALGS2609001',
      'MBL NO.        : EXMU000000000001',
      'VESSEL / VOY   : EXAMPLE STAR / 012E',
      'POL            : HAMBURG, GERMANY',
      'POD            : BUSAN, KOREA',
      'ETD            : ' + dmy(-2),
      'ETA            : ' + dmy(26),
      'CONTAINER      : EXMU1234565 / 40HC',
      'PACKAGES       : 6 PLTS',
      'GROSS WEIGHT   : 2,480.50 KGS',
      'SHIPPER        : ALPHA PRECISION GMBH (SAMPLE)',
      'CONSIGNEE      : EXAMPLE BUYER CO., LTD. (SAMPLE)',
      'PO NO.         : EX4500010002',
      '',
      'Please arrange customs clearance documents before arrival.',
      '',
      'Best regards,',
      'Import Team',
      'Alpha Logistics Co., Ltd. (sample)'
    ].join('\r\n');
    var an2html = '<p>' + '예시 고객사 담당자님, 아래 화물의 도착 예정을 알려 드립니다. (예시 — 실제 화물 아님)' + '</p>' +
      '<table border="1"><tr><th>B/L 번호</th><td>BTSH26090055</td><th>선명/항차</th><td>EXAMPLE OCEAN / 2609W</td></tr>' +
      '<tr><th>출항일</th><td>' + dot(-1) + '</td><th>입항예정일</th><td>' + dot(4) + '</td></tr>' +
      '<tr><th>선적항</th><td>SHANGHAI, CHINA</td><th>양하항</th><td>부산 신항</td></tr>' +
      '<tr><th>컨테이너 번호</th><td>EXGU7654326 (20GP)</td><th>포장수량</th><td>35 CTNS</td></tr>' +
      '<tr><th>총중량</th><td>812 KG</td><th>발주번호(REF)</th><td>EX4500010005</td></tr></table>' +
      '<p>도착 후 D/O 발급을 위해 운임 정산을 부탁드립니다.<br>베타해운 수입팀 (예시)</p>';
    var an3 = [
      'Gamma Air & Ocean (sample) - Arrival Notice',
      'This is a fictitious notice for testing.',
      '',
      'Bill of Lading No.',
      'GMAO26090077',
      'Vessel Name',
      'EXAMPLE PIONEER',
      'Voyage No.',
      'V.031W',
      'Port of Loading',
      'LOS ANGELES, CA',
      'Port of Discharge',
      'BUSAN, KOREA',
      'On Board Date',
      mdy(-24),
      'Estimated Arrival',
      mdy(5),
      'Container No.',
      'EXTU2223334 40HQ, EXTU5556660 40HQ',
      'No. of Packages',
      '18 CASES',
      'Gross Weight',
      '9,920 LBS',
      '',
      'Kind regards,',
      'Gamma Air & Ocean (sample)'
    ].join('\r\n');
    var an4 = [
      'REVISED ARRIVAL NOTICE  (SAMPLE - NOT A REAL SHIPMENT)',
      '',
      'Please note the ETA has been changed due to port congestion.',
      '',
      'HBL NO.        : ALGS2609001',
      'VESSEL / VOY   : EXAMPLE STAR / 012E',
      'OLD ETA        : ' + dmy(26),
      'NEW ETA        : ' + dmy(30),
      'PO NO.         : EX4500010002',
      '',
      'Best regards,',
      'Import Team',
      'Alpha Logistics Co., Ltd. (sample)'
    ].join('\r\n');
    return [
      { name: '예시데이터_AN1_Alpha_Logistics.eml', text: eml('Alpha Logistics Import (sample) <import@alpha-logistics.example.com>', 'ARRIVAL NOTICE / HBL: ALGS2609001 / PO EX4500010002', hdr(-2, '01:10'), plain, an1) },
      { name: '예시데이터_AN2_베타해운_국문.eml', text: eml('=?utf-8?B?' + b64utf8('베타해운 수입팀(예시)') + '?= <an@beta-shipping.example.com>', '=?utf-8?B?' + b64utf8('[화물도착통지] B/L BTSH26090055 / 선명 EXAMPLE OCEAN') + '?=', hdr(-1, '00:40'), 'text/html; charset="utf-8"', wrap76(b64utf8(an2html)).replace(/\r\n$/, ''), 'base64') },
      { name: '예시데이터_AN3_Gamma_AirOcean.eml', text: eml('"Gamma Air & Ocean (sample)" <notice@gamma-airocean.example.com>', 'Arrival Notice - B/L GMAO26090077', hdr(-1, '06:05'), plain, an3) },
      { name: '예시데이터_AN4_Alpha_Logistics_수정.eml', text: eml('Alpha Logistics Import (sample) <import@alpha-logistics.example.com>', 'REVISED ARRIVAL NOTICE / HBL: ALGS2609001 - ETA CHANGED', hdr(0, '00:20'), plain, an4) }
    ];
  }

  /* ── 실물 「도착일정통지」 양식을 본뜬 예시(2026-09-29 밤) — 구조만 같고 값은 모두 지어낸 것 ── */
  // 해상: 본문 HTML 표 14칸(신청번호 한 건 = 한 줄, PO LIST 에 전각 쉼표·붙은 번호·줄바꿈, 컨테이너 여럿이면
  //       화물형태·컨테이너번호·CONTAINER TYPE 이 줄을 바꿔 되풀이 — 나머지 칸은 rowspan) + 같은 내용의 엑셀(31칸, 컨테이너마다 한 줄)
  //       + House B/L 사본 PDF(칸 이름 없이 값만, 4쪽 = B/L 3장 + ATTACHED RIDER)
  // 항공: ks_c_5601-1987 제목·본문(quoted-printable HTML 표 16칸, HAWB 한 건 = 한 줄) + HAWB PDF(「HIPRO:」「PO:」)
  var EKR = {   // 한글 조각의 EUC-KR(CP949) 바이트(base64) — 실물 항공 메일과 같은 문자 집합으로 만들기 위함
    airSubj: 'W7W1wvjAz8GkxevB9l/H17D4XSC/ub3Dwd+w+L73KL+5vcMp',
    hello: 'vPa9xcDOIMGmwKcs',
    intro: 'x8+x4r/NILCwwMwgx6XBpiC8scD7ILDHILD8t8MgtbXC+MDPwaQgvsizuyC15biztM+02S4gKL+5vcMgLSC9x8GmIMitubAgvsa01Ck=',
    reqNo: 'vcXDu7n4yKM=',
    plant: 'v7m9w7vnvve6zg==',
    thanks: 'sKi758fVtM+02S4=',
    fromName: 'v7m9w8b3v/a09SDH17D4vPbA1MbA'
  };
  function b64bin(b) {   // base64 → 한 바이트 = 한 글자 문자열
    if (typeof Buffer !== 'undefined') return Buffer.from(b, 'base64').toString('latin1');
    return atob(b);
  }
  function binb64(s) {
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'latin1').toString('base64');
    return btoa(s);
  }
  function qp(bin) {   // quoted-printable(76자 줄, 끝 =)
    var out = '', line = '';
    for (var i = 0; i < bin.length; i++) {
      var c = bin.charCodeAt(i), t;
      if (bin[i] === '\n') { out += line + '\r\n'; line = ''; continue; }
      if (bin[i] === '\r') continue;
      t = (c >= 33 && c <= 126 && c !== 61) || c === 32 ? bin[i] : '=' + (c < 16 ? '0' : '') + c.toString(16).toUpperCase();
      if (line.length + t.length > 75) { out += line + '=\r\n'; line = ''; }
      line += t;
    }
    return out + line;
  }
  var AN_MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function blDate(today, n) { var d = shift(today, n).split('-'); return AN_MONS[+d[1] - 1] + '.' + d[2] + '.' + d[0]; }   // SEP.02.2026 모양
  var AN_SEA = [   // 해상 세 건 — 셋째 건은 PO 6개(붙은 번호·줄바꿈·전각 쉼표), 컨테이너 4개
    { req: 'EXM2610A0001', pos: 'EX4500010006', inc: 'FCA', ar: 'USD : 980.00', pol: 'SHA', loc: 'SHANGHAI , CHINA', ves: 'EXAMPLE BREEZE', voy: '2610E', shipper: 'EXAMPLE PUMP CO., LTD. (SAMPLE)',
      mbl: 'EXSH261001', hbl: 'EXSH261001', cargo: 'LCL', eta: 4, cntrs: [], item: 'AXIAL PUMP (SAMPLE)', qty: 3, wt: 510, cbm: 0.65, onboard: -3 },
    { req: 'EXM2610A0002', pos: 'EX4500010007，O261000002，O261000003', inc: 'EXW', ar: 'USD : 4,321.50', pol: 'SHA', loc: 'SHANGHAI , CHINA', ves: 'EXAMPLE OCEAN', voy: '2608E', shipper: 'EXAMPLE CHAIR MFG. CO. (SAMPLE)',
      mbl: 'EXMB0000000002', hbl: 'EXSH261002', cargo: 'F40', eta: 4, cntrs: [['EXAU1234560', '40DC', '40HC']], item: 'OPERATOR CHAIR (SAMPLE)', qty: 22, wt: 3900, cbm: 38.2, onboard: -4 },
    { req: 'EXM2610A0003', pos: 'O261000004O261000005O261000006O261000007\nO261000008，O261000009', inc: 'FOB', pdfInc: 'EXW', ar: 'USD : 3,210.00', pol: 'NGB', loc: 'NINGBO , CHINA', ves: 'EXAMPLE GALE', voy: '2610E', shipper: 'EXAMPLE CYLINDER CO., LTD (SAMPLE)',
      mbl: 'EXMB0000000003', hbl: 'EXZB261003', cargo: 'F40', eta: 4, cntrs: [['EXBU1000001', '40DC', '40HC'], ['EXCU2000002', '40DC', '40HC'], ['EXDU3000003', '40DC', '40HC'], ['EXEU4000004', '40DC', '40HC']],
      item: 'HYDRAULIC RAM (SAMPLE)', qty: 37, wt: 57400, cbm: 113.6, onboard: -2 }
  ];
  var AN_SEA_HEAD = ['신청번호', 'PO LIST', 'Incoterms', 'Local AR', '적재항', '도착항', '편명', 'SHIPPER', 'MBLNO', 'HBLNO', '화물형태', '입항일', '컨테이너번호', 'CONTAINER TYPE'];
  var AN_XLS_HEAD = ['신청번호', '적하목록번호', '품명', 'PO LIST', 'Incoterms', 'Local AR', 'LC NO', '적재항', '도착항', '편명', '부두', '장치장장소', '작업장소', '장치장이름', 'SHIPPER', 'CONSIGNEE', 'MBLNO', 'HBLNO',
    '화물형태', '입항일', '수량', '중량', '용적', '수량단위', '포워더', '선적지', '사업부', 'SUB사업부', '컨테이너번호', 'CONTAINER TYPE', '하역사'];
  function anSeaHtml(today) {
    var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'); };
    var td = function (v, rs) { return '<td' + (rs > 1 ? ' rowspan="' + rs + '"' : '') + ' style="border:1px solid #999">' + esc(v) + '</td>'; };
    var rows = AN_SEA.map(function (s) {
      var n = Math.max(1, s.cntrs.length), c0 = s.cntrs[0] || ['', ''];
      var first = '<tr>' + [s.req, s.pos, s.inc, s.ar, s.pol, 'PUS', s.ves, s.shipper, s.mbl, s.hbl].map(function (v) { return td(v, n); }).join('') +
        td(s.cargo, 1) + td(shift(today, s.eta), n) + td(c0[0], 1) + td(c0[1], 1) + '</tr>';
      return first + s.cntrs.slice(1).map(function (c) { return '<tr>' + td(s.cargo, 1) + td(c[0], 1) + td(c[1], 1) + '</tr>'; }).join('');
    }).join('');
    return '<html><head><meta charset="utf-8"><style>td{font-size:9pt}</style></head><body><p>예시 고객사 담당자님, 아래 화물의 부산항 도착 일정을 알려 드립니다. (예시 — 실제 화물 아님)</p>' +
      '<table style="border-collapse:collapse"><tr>' + AN_SEA_HEAD.map(function (h) { return '<th style="border:1px solid #999;background:#dde">' + h + '</th>'; }).join('') + '</tr>' + rows + '</table>' +
      '<p>감사합니다.<br>예시포워더 해상수입팀</p></body></html>';
  }
  function anSeaGrid(today) {
    var out = [AN_XLS_HEAD.slice()];
    AN_SEA.forEach(function (s, i) {
      (s.cntrs.length ? s.cntrs : [['', '']]).forEach(function (c) {
        out.push([s.req, s.cntrs.length ? 'EXMF26000' + (i + 1) : '', s.item, s.pos.replace(/\n/g, ''), s.inc, s.ar, '', s.pol, 'PUS', s.ves, '', s.cntrs.length ? '0300000' + i : '', '', '예시터미널', s.shipper,
          'EXAMPLE BUYER CO., LTD. (SAMPLE)', s.mbl, s.hbl, s.cargo, shift(today, s.eta), s.qty, s.wt, s.cbm, 'PKGS', '예시포워더', s.loc, 'M', '', c[0], c[1], '']);
      });
    });
    return out;
  }
  // B/L 사본 PDF 쪽 글 — 실물처럼 칸 이름(그림)은 없고 값만. B/L 번호는 쪽 위에 두 번, 컨테이너 4개 건은 RIDER 쪽
  function anSeaPdfPages(today) {
    var pages = AN_SEA.map(function (s) {
      var p = [s.hbl, s.hbl, s.shipper, 'NO.1 EXAMPLE ROAD, EXAMPLE CITY', 'EXAMPLE BUYER CO., LTD. (SAMPLE)', 'SAME AS CONSIGNEE', 'EXAMPLE FORWARDER CO., LTD.', s.loc,
        s.loc + '   BUSAN KOREA   BUSAN KOREA', s.ves + '   ' + s.voy, 'LOADED ON BOARD', '_____________________', blDate(today, s.onboard), 'CY/CY'];
      if (s.cntrs.length) p.push(s.cntrs.length + " X 40'HC");
      p.push('(' + s.qty + ' PACKAGES)   "SHIPPER`S LOAD & COUNT"', s.wt.toLocaleString('en-US') + '.00 KGS   ' + s.cbm + ' CBM');
      if (s.cntrs.length > 1) p.push('ATTACHED RIDER', 'ATTACHED RIDER');
      else {
        p.push(s.item, s.cntrs.length ? 'CONTRACT NO.:' : 'PO NO.:', s.pos, 'INCOTERMS:' + (s.pdfInc || s.inc), '"FREIGHT COLLECT"');
        s.cntrs.forEach(function (c) { p.push(c[0] + ' / 100001 / ' + c[2] + ' / ' + s.qty + ' PT / ' + s.wt + ' KG'); });
      }
      p.push('DESTINATION', 'ZERO / 0', blDate(today, s.onboard) + '   ' + s.loc, 'FREIGHT COLLECT   AS ARRANGED');
      return p;
    });
    var r = AN_SEA[2];
    var rider = ['H.B/L: ' + r.hbl + ' Vessel/Voy:' + r.ves + ' / ' + r.voy + '   BUSAN KOREA POD : POL : ' + r.loc, 'ATTACHED RIDER', 'Container No. & SealNo.'];
    r.cntrs.forEach(function (c, i) { rider.push(c[0] + ' / 20000' + i + ' /', c[2] + ' / 9 PKGS / 14,000 K', 'G / 28.0 CBM'); });
    rider.push(r.item);
    var ps = r.pos.split(/[\n，]/).join('').match(/[A-Z]\d{9}/g);
    rider.push('CONTRACT NO. :' + ps[0]); ps.slice(1).forEach(function (x) { rider.push(x); });
    rider.push('INCOTERMS' + r.pdfInc, '"FREIGHT COLLECT"');
    pages.push(rider);
    return pages;
  }
  var AN_AIR = [
    { no: 1, mawb: '18000000011', hawb: 'EXAW261001', flt: 'KE999', cnt: 4, wt: '1,950.00', req: 'EXM2610B0011', remark: 'DG CARGO' },
    { no: 2, mawb: '18000000012', hawb: 'EXAW261002', flt: 'KE999', cnt: 5, wt: '2,440.00', req: 'EXM2610B0012', remark: '' }
  ];
  function anAirPdfPages(today, a) {
    var d = shift(today, -1).split('-');
    return [['180 FRA   00000011   ' + a.hawb, "Shipper's Name and Address   Not Negotiable", 'EXAMPLE ENGINE GMBH (SAMPLE)', 'House Air Waybill', 'EXAMPLE BUYER CO., LTD. (SAMPLE)',
      a.cnt + '   ' + a.wt + ' KG Q   ' + a.wt + '   As Agreed   ENGINES', 'INV: 900000' + a.no, 'PO: EX4500010008', 'HIPRO: ' + a.req, 'EXW', 'Freight Collect',
      d[2] + '/' + AN_MONS[+d[1] - 1].charAt(0) + AN_MONS[+d[1] - 1].slice(1).toLowerCase() + '/' + d[0] + '   Frankfurt   dos#: ' + a.hawb, a.hawb],
      ['EXAMPLE ENGINE GMBH (SAMPLE)   INVOICE 900000' + a.no, 'Sample invoice page - not a real document']];
  }
  function anAirMail(today, atts) {
    var eta = shift(today, 4).replace(/-/g, ''), K = function (k) { return b64bin(EKR[k]); };
    var cells = function (arr, tag) { return arr.map(function (v) { return '<' + tag + ' style="border:1px solid #999">' + v + '</' + tag + '>'; }).join(''); };
    var html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=ks_c_5601-1987"></head><body><p>' + K('hello') + '</p><p>' + K('intro') + '</p>' +
      '<p><b>Arrival Notice</b></p><table style="border-collapse:collapse"><tr>' +
      cells(['No.', 'SHIPPER NAME', 'MAWB NO', 'HAWB NO', 'FLT', 'DEPA(POL)', 'DEST(POD)', 'ETA', 'TIME', 'CNT', 'W/T', K('reqNo'), 'P.O NO', 'Incoterms', 'PLANT', 'REMARK'], 'td') + '</tr>' +
      AN_AIR.map(function (a) { return '<tr>' + cells([a.no, 'EXAMPLE ENGINE GMBH (SAMPLE)', a.mawb, a.hawb, a.flt, 'FRA', 'ICN', eta, '16:15', a.cnt, a.wt, a.req, 'EX4500010008', 'EXW', K('plant'), a.remark], 'td') + '</tr>'; }).join('') +
      '</table><p>' + K('thanks') + '</p></body></html>';
    var mix = '_an_air_mixed_', alt = '_an_air_alt_';
    var head = 'From: =?ks_c_5601-1987?B?' + EKR.fromName + '?= <air-an@example-forwarder.example.com>\r\nTo: buyer@our-company.example.com\r\n' +
      'Subject: =?ks_c_5601-1987?B?' + binb64(K('airSubj') + ' / PO NO: EX4500010008 / FRA / ETA: ' + eta.slice(4, 6) + '.' + eta.slice(6)) + '?=\r\n' +
      'Date: ' + new Date(shift(today, -1) + 'T01:37:15Z').toUTCString().replace('GMT', '+0000') + '\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="' + mix + '"\r\n\r\n';
    var body = '--' + mix + '\r\nContent-Type: multipart/alternative; boundary="' + alt + '"\r\n\r\n' +
      '--' + alt + '\r\nContent-Type: text/plain; charset="ks_c_5601-1987"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
      wrap76(binb64(K('hello') + '\r\n\r\nArrival Notice\r\n\r\nNo.\r\n\r\nSHIPPER NAME\r\n\r\n(sample)\r\n')) +
      '--' + alt + '\r\nContent-Type: text/html; charset="ks_c_5601-1987"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n' + qp(html) + '\r\n--' + alt + '--\r\n';
    (atts || []).forEach(function (a) {
      body += '--' + mix + '\r\nContent-Type: application/pdf; name="' + a.name + '"\r\nContent-Disposition: attachment; filename="' + a.name + '"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap76(a.b64);
    });
    return head + body + '--' + mix + '--\r\n';
  }
  function anSeaMail(today, atts) {
    var mix = '_an_sea_mixed_';
    var head = 'From: =?utf-8?B?' + b64utf8('예시포워더 해상수입팀') + '?= <sea-an@example-forwarder.example.com>\r\nTo: buyer@our-company.example.com\r\n' +
      'Subject: =?utf-8?B?' + b64utf8('[도착일정통지_해상] 예시중공업(예시) A/N_부산 ' + shift(today, 2)) + '?=\r\n' +
      'Date: ' + new Date(shift(today, 0) + 'T00:30:00Z').toUTCString().replace('GMT', '+0000') + '\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="' + mix + '"\r\n\r\n';
    var body = '--' + mix + '\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap76(b64utf8(anSeaHtml(today)));
    (atts || []).forEach(function (a) {
      var nm = '=?utf-8?B?' + b64utf8(a.name) + '?=';   // 한글 파일 이름은 RFC 2047 로(Outlook 과 같은 방식)
      body += '--' + mix + '\r\nContent-Type: ' + a.type + '; name="' + nm + '"\r\nContent-Disposition: attachment; filename="' + nm + '"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap76(a.b64);
    });
    return head + body + '--' + mix + '--\r\n';
  }
  // 화면의 「예시 A/N으로 해 보기」용: 메일 글 + 첨부를 이미 읽은 모양(엑셀 칸·PDF 쪽 글)으로
  function anRealMails(today) {
    return [
      { name: '예시데이터_AN5_도착일정통지_해상.eml', text: anSeaMail(today, []), grids: [{ name: '예시_AN_부산.xls', rows: anSeaGrid(today) }],
        pdfs: [{ name: '예시_AN_부산.pdf', pages: anSeaPdfPages(today).map(function (p) { return p.join('\n'); }) }] },
      { name: '예시데이터_AN6_도착일정통지_항공.eml', text: anAirMail(today, []),
        pdfs: AN_AIR.map(function (a) { return { name: a.hawb + '.pdf', pages: anAirPdfPages(today, a).map(function (p) { return p.join('\n'); }) }; }) }
    ];
  }

  // 외자 부품 Invoice 예시 2가지 양식(2026-09-30 「Invoice PDF → 엑셀」) — 모두 지어낸 값. 실물 양식을 받으면 그 배치로 바꿉니다.
  //  A: 독일식(유럽 숫자 1.234,56 · 일.월.연), PO 는 위쪽에 한 번, 공급사 라벨 없음. Invoice 번호 9000001 = 항공 A/N 예시(HAWB EXAW261001)의 INV
  //  B: 중국식(미국 숫자), 줄마다 PO(Order No.) — 한 Invoice 에 PO 3건. 넷째 줄은 금액을 일부러 틀리게(4 × 310.00 ≠ 1,420.00) 적어 검산 표시를 봅니다.
  var invoicePdfs = [
    { name: '예시데이터_Invoice_A_독일식_9000001.pdf', lines: [
      'EXAMPLE ENGINE GMBH (SAMPLE)',
      'Musterstrasse 1, 60000 Frankfurt am Main, Germany',
      'COMMERCIAL INVOICE  (SAMPLE - NOT A REAL DOCUMENT)',
      '',
      'Invoice No.: 9000001          Invoice Date: 22.09.2026',
      'Buyer: EXAMPLE BUYER CO., LTD. (SAMPLE)',
      'Your Order: PO EX4500010008',
      'Currency: EUR          Terms of Delivery: EXW Frankfurt, Incoterms 2020',
      '',
      'Pos   Part No.      Description                 Qty  Unit    Unit Price       Amount',
      '10    EXE-8801-A    Fuel injector assy            4  PCS       1.234,50     4.938,00',
      '20    EXE-8802      Turbo gasket set             25  SET          12,40       310,00',
      '30    EXE-8803-C    Cylinder head bolt M12      120  PCS           0,85       102,00',
      '40    EXE-8804      Water pump                    2  PCS       2.480,00     4.960,00',
      '',
      '                                    Sub Total                              10.310,00',
      '                                    Freight                                     0,00',
      '                                    Total EUR                              10.310,00',
      '',
      'Country of origin: Germany. Sample document for training only.'
    ] },
    { name: '예시데이터_Invoice_B_줄마다PO_EXCI-2609-017.pdf', lines: [
      'COMMERCIAL INVOICE  (SAMPLE - NOT A REAL DOCUMENT)',
      'Shipper/Exporter: EXAMPLE CHAIR MFG. CO. (SAMPLE)',
      'Messrs: EXAMPLE BUYER CO., LTD. (SAMPLE)',
      'Invoice No: EXCI-2609-017',
      'Date: Sep 20, 2026',
      'Price Terms: EXW SHANGHAI          Currency: USD',
      '',
      'Item  Order No.      Part No.   Description            Q\'ty   Unit Price    Amount',
      '1     EX4500010007   EXC-5501   OPERATOR SEAT ASSY        10       185.00    1,850.00',
      '2     O261000002     EXC-5502   SEAT BELT KIT             10        42.50      425.00',
      '3     O261000002     EXC-5503   ARMREST LH                 2        64.00      128.00',
      '4     O261000003     EXC-5504   SUSPENSION UNIT            4       310.00    1,420.00',
      '',
      '                                          Sub Total              3,823.00',
      '                                          Total USD              3,823.00',
      '',
      'Sample document for training only.'
    ] }
  ];

  var api = { invoicePdfs: invoicePdfs, contactRows: contactRows, ledger: ledger, poPdfs: poPdfs, weeklyOld: weeklyOld, weeklyNew: weeklyNew, packingRows: packingRows, blWeights: blWeights, mails: mails, shift: shift,
    echoSupplier: echoSupplier, realPoLines: realPoLines, realPoPaste: realPoPaste, realLedger: realLedger, ocGrid: ocGrid, ocFiles: ocFiles, replyEml: replyEml,
    WOS_HEAD: WOS_HEAD, weeklyWk37: weeklyWk37, weeklyWk38: weeklyWk38,
    foxSupplier: foxSupplier, cumLedger: cumLedger, CUM_HEAD: CUM_HEAD, cumGrid: cumGrid, cumPrevGrid: cumPrevGrid, CUM_AS_OF: CUM_AS_OF, anMails: anMails,
    anRealMails: anRealMails, anSeaHtml: anSeaHtml, anSeaGrid: anSeaGrid, anSeaPdfPages: anSeaPdfPages, anAirPdfPages: anAirPdfPages, anAirMail: anAirMail, anSeaMail: anSeaMail, AN_SEA: AN_SEA, AN_AIR: AN_AIR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OMSample = api;
})(typeof window !== 'undefined' ? window : this);
