/* 엑셀·CSV 파일 확인 — 읽기 전에 파일 머리(앞 몇 바이트)로 형식을 가립니다 (브라우저·Node 공용, DOM 사용 안 함)
   2026-10-01 패들릿 「D드라이브 엑셀 첨부가 되지 않습니다」 대응.
   회사 문서보안(DRM)으로 암호화된 엑셀은 ZIP(xlsx)도 OLE(xls)도 아닌 다른 겉모양이라, 엑셀 라이브러리에 그대로 넣으면
   오류가 나거나 깨진 글자를 표로 돌려줍니다. 그래서 먼저 머리로 가린 뒤, 읽을 수 있는 것만 넘깁니다.
   테스트: node test/logic.test.mjs */
(function (root) {
  'use strict';

  var MSG = {
    drm: '이 파일은 회사 문서보안(DRM)으로 암호화되어 브라우저에서 읽을 수 없습니다. ① 엑셀에서 열어 \'다른 이름으로 저장 → CSV(쉼표로 분리)\' 로 저장해 올리거나 ② 문서보안 해제(반출 승인) 후 올려 주세요.',
    encrypted: '이 파일은 열기 암호(또는 정보 보호 레이블)가 걸려 있어 브라우저에서 읽을 수 없습니다. 엑셀에서 열어 암호를 지운 뒤(파일 → 정보 → 통합 문서 보호 → 암호 설정에서 비우고 저장) 다시 올리거나, \'다른 이름으로 저장 → CSV(쉼표로 분리)\' 로 저장해 올려 주세요.',
    notSheet: '이 파일 안에 엑셀 시트가 없습니다(다른 Office 문서이거나 문서보안 처리된 파일). 엑셀에서 열어 \'다른 이름으로 저장 → CSV(쉼표로 분리)\' 로 저장해 올려 주세요.',
    empty: '빈 파일(0바이트)입니다. 원본을 다시 저장해 올려 주세요.',
    broken: '엑셀 파일을 읽지 못했습니다(파일이 손상됐거나 문서보안 처리된 파일일 수 있습니다). 엑셀에서 열어 \'다른 이름으로 저장 → CSV(쉼표로 분리)\' 로 저장해 올려 주세요.'
  };
  var TITLE = { drm: '문서보안(DRM) 파일', encrypted: '암호가 걸린 파일', notSheet: '엑셀 시트 없음', empty: '빈 파일', broken: '읽을 수 없는 파일' };

  function u8(bytes) { return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); }
  function startsWith(b, sig) { if (b.length < sig.length) return false; for (var i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false; return true; }

  // OLE 복합 문서(CFB, 옛 .xls·.doc·암호 걸린 Office) 안의 항목 이름들.
  // 디렉터리 항목은 128바이트이고 섹터(512·4096바이트) 경계에 놓이므로, 512 뒤 128바이트 간격으로 훑어 이름 칸을 읽습니다.
  function cfbNames(b) {
    var names = {}, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (var off = 512; off + 128 <= b.length; off += 128) {
      var len = dv.getUint16(off + 64, true), type = b[off + 66];
      if (len < 4 || len > 64 || len % 2 || (type !== 1 && type !== 2 && type !== 5)) continue;
      var s = '', ok = true;
      for (var i = 0; i < len / 2 - 1; i++) {
        var c = dv.getUint16(off + i * 2, true);
        if (c === 0 || c > 0xFFFF) { ok = false; break; }
        s += String.fromCharCode(c);
      }
      if (ok && dv.getUint16(off + len - 2, true) === 0 && s) names[s] = true;
    }
    return Object.keys(names);
  }

  // 글 파일(CSV·TSV·HTML·XML 로 저장한 엑셀)로 보이는가 — 앞 8KB 에 NUL·제어 문자가 거의 없으면 글
  function looksText(b) {
    var n = Math.min(b.length, 8192), bad = 0;
    if (startsWith(b, [0xFF, 0xFE]) || startsWith(b, [0xFE, 0xFF])) return true;   // UTF-16 글(엑셀 「유니코드 텍스트」)
    for (var i = 0; i < n; i++) {
      var c = b[i];
      if (c === 0) return false;
      if (c < 0x09 || (c > 0x0D && c < 0x20) || c === 0x7F) bad++;
    }
    return n > 0 && bad / n < 0.01;
  }

  /* 형식 가리기: { kind, ok, code?, message?, names? }
     kind — zip(xlsx·xlsm) · cfb(xls) · text(csv·html·xml) · encrypted · notSheet · drm · empty */
  function classify(bytes) {
    var b = u8(bytes);
    if (!b.length) return { kind: 'empty', ok: false, code: 'empty', message: MSG.empty };
    if (startsWith(b, [0x50, 0x4B, 0x03, 0x04])) return { kind: 'zip', ok: true };
    if (startsWith(b, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])) {
      var names = cfbNames(b), has = function (n) { return names.some(function (x) { return x.toLowerCase() === n.toLowerCase(); }); };
      if (has('EncryptedPackage') || has('EncryptionInfo')) return { kind: 'encrypted', ok: false, code: 'encrypted', message: MSG.encrypted, names: names };
      if (has('Workbook') || has('Book')) return { kind: 'cfb', ok: true, names: names };
      return { kind: 'notSheet', ok: false, code: 'notSheet', message: MSG.notSheet, names: names };
    }
    if (looksText(b)) return { kind: 'text', ok: true };
    return { kind: 'drm', ok: false, code: 'drm', message: MSG.drm };
  }

  /* 글 바이트 → 문자열. BOM(UTF-8·UTF-16)을 먼저 보고, UTF-8 로 풀어 깨진 글자(U+FFFD)가 나오면 CP949(EUC-KR)로 다시 풉니다.
     한국어 윈도 엑셀의 「CSV(쉼표로 분리)」는 CP949, 「CSV UTF-8」은 BOM 붙은 UTF-8 입니다. */
  function decodeText(bytes) {
    var b = u8(bytes);
    if (startsWith(b, [0xEF, 0xBB, 0xBF])) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8' };
    if (startsWith(b, [0xFF, 0xFE])) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
    if (startsWith(b, [0xFE, 0xFF])) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'utf-16be' };
    var t = new TextDecoder('utf-8').decode(b);
    if (t.indexOf('\uFFFD') < 0) return { text: t, encoding: 'utf-8' };
    try { return { text: new TextDecoder('euc-kr').decode(b), encoding: 'cp949' }; }
    catch (e) { return { text: t, encoding: 'utf-8' }; }
  }

  function fileError(code, name, detail) {
    var e = new Error(MSG[code] || MSG.broken);
    e.code = code; e.fileName = name || ''; e.title = TITLE[code] || TITLE.broken; e.detail = detail || '';
    return e;
  }
  function isFileError(e) { return !!(e && e.code && MSG[e.code]); }

  /* 엑셀·CSV 바이트 → SheetJS 통합 문서. 못 읽으면 code 가 붙은 오류를 던집니다(drm·encrypted·notSheet·empty·broken).
     opts 는 XLSX.read 에 그대로 넘깁니다(cellStyles 등). 돌려주는 wb 에 _om = { kind, encoding } 을 붙입니다. */
  function readSheet(XLSX, bytes, name, opts) {
    var b = u8(bytes), c = classify(b);
    if (!c.ok) throw fileError(c.code, name);
    var o = Object.assign({ cellDates: false }, opts || {}), wb, enc = '';
    try {
      if (c.kind === 'text') { var d = decodeText(b); enc = d.encoding; o.type = 'string'; wb = XLSX.read(d.text, o); }
      else { o.type = 'array'; wb = XLSX.read(b, o); }
    } catch (e) {
      var m = String(e && e.message || e);
      if (/password|encrypt|protected/i.test(m)) throw fileError('encrypted', name, m);   // 옛 .xls 의 열기 암호(FILEPASS)
      throw fileError('broken', name, m);
    }
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) throw fileError('broken', name, '시트 없음');
    wb._om = { kind: c.kind, encoding: enc };
    return wb;
  }

  var api = { classify: classify, decodeText: decodeText, readSheet: readSheet, fileError: fileError, isFileError: isFileError, cfbNames: cfbNames, MSG: MSG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OMFile = api;
})(typeof window !== 'undefined' ? window : this);
