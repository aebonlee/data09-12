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

  var api = { contactRows: contactRows, ledger: ledger, poPdfs: poPdfs, weeklyOld: weeklyOld, weeklyNew: weeklyNew, packingRows: packingRows, blWeights: blWeights, mails: mails, shift: shift,
    echoSupplier: echoSupplier, realPoLines: realPoLines, realPoPaste: realPoPaste, realLedger: realLedger, ocGrid: ocGrid, ocFiles: ocFiles, replyEml: replyEml,
    WOS_HEAD: WOS_HEAD, weeklyWk37: weeklyWk37, weeklyWk38: weeklyWk38,
    foxSupplier: foxSupplier, cumLedger: cumLedger, CUM_HEAD: CUM_HEAD, cumGrid: cumGrid, cumPrevGrid: cumPrevGrid, CUM_AS_OF: CUM_AS_OF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OMSample = api;
})(typeof window !== 'undefined' ? window : this);
