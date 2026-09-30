/* 선택 기능 — AI 자동 보내기(OpenAI 호환 Chat Completions)
   기본은 반자동입니다: 프롬프트를 복사해 ChatGPT 등에 Invoice 파일과 함께 넣고, 받은 답(JSON)을 붙여넣습니다.
   자동 보내기는 사용자가 주소(Base URL)·모델·키를 넣었을 때만 씁니다.
   · 키는 코드·리포에 없습니다. 「이 브라우저에 기억」을 고른 경우에만 localStorage('data09-12.ai')에 둡니다.
   · 스캔본은 쪽 그림(JPEG)을 image_url 로 함께 보냅니다 — 그림을 읽는 모델이어야 합니다.
   · 외부 서비스로 보내면 Invoice(단가·거래처)가 회사 밖으로 나갑니다. 사내 보안 기준을 먼저 확인해 주세요.
   테스트: node test/logic.test.mjs */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OMAi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KEY = 'data09-12.ai';
  function str(v) { return v == null ? '' : String(v).trim(); }
  function defaults() { return { baseUrl: '', model: '', apiKey: '', remember: false }; }
  function baseOf(url) { return str(url).replace(/\s+/g, '').replace(/\/+$/, '').replace(/\/chat\/completions$/i, ''); }
  function ready(c) { return !!(c && baseOf(c.baseUrl) && str(c.model)); }

  // 보내기 전 점검. pageProtocol = location.protocol
  function check(c, pageProtocol) {
    var errors = [], warnings = [], b = baseOf(c && c.baseUrl);
    var m = /^(https?):\/\/([^\/:?#]+)(:\d+)?(\/[^?#]*)?$/i.exec(b);
    if (!b) errors.push('주소(Base URL)를 적어 주세요. 예: https://api.openai.com/v1');
    else if (!m) errors.push('주소는 http:// 또는 https:// 로 시작해야 합니다.');
    if (!str(c && c.model)) errors.push('모델 이름을 적어 주세요(그림을 읽는 모델이어야 스캔본을 읽습니다).');
    if (m && m[1].toLowerCase() === 'http' && pageProtocol === 'https:') errors.push('https 페이지에서는 http 주소로 보낼 수 없습니다(브라우저가 막음). index.html 을 내 PC 에서 열어 쓰거나 https 주소를 써 주세요.');
    if (m && /api\.openai\.com$/i.test(m[2])) warnings.push('외부 서비스입니다. Invoice 내용(단가·거래처)이 회사 밖으로 나갑니다. 보내도 되는지 먼저 확인해 주세요.');
    return { errors: errors, warnings: warnings };
  }
  // images: ['data:image/jpeg;base64,…'] — 있으면 글과 그림을 함께 보냅니다
  function buildRequest(c, prompt, images) {
    var headers = { 'Content-Type': 'application/json' };
    if (str(c.apiKey)) headers.Authorization = 'Bearer ' + str(c.apiKey);
    var content = images && images.length
      ? [{ type: 'text', text: String(prompt) }].concat(images.map(function (u) { return { type: 'image_url', image_url: { url: u } }; }))
      : String(prompt);
    return { url: baseOf(c.baseUrl) + '/chat/completions', init: { method: 'POST', headers: headers, body: JSON.stringify({ model: str(c.model), temperature: 0, messages: [{ role: 'user', content: content }] }) } };
  }
  function readAnswer(j) {
    if (!j || typeof j !== 'object') throw new Error('AI 서버 응답이 JSON 이 아닙니다.');
    if (j.error) throw new Error('AI 서버 오류: ' + (j.error.message || JSON.stringify(j.error)));
    var ch = j.choices && j.choices[0], t = ch && (ch.message ? ch.message.content : ch.text);
    if (Array.isArray(t)) t = t.map(function (p) { return p && (p.text || ''); }).join('');
    if (typeof t !== 'string' || !t.trim()) throw new Error('AI 서버 응답에 답 글이 없습니다.');
    return t;
  }
  function send(c, prompt, images, fetchImpl) {
    var f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.reject(new Error('이 환경에서는 보낼 수 없습니다.'));
    var r = buildRequest(c, prompt, images);
    return f(r.url, r.init).then(function (res) {
      return res.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) { /* 아래 */ }
        if (!res.ok) throw new Error('AI 서버가 ' + res.status + ' 로 답했습니다. ' + (j && j.error ? j.error.message || '' : t.slice(0, 200)));
        return readAnswer(j);
      });
    }, function (e) { throw new Error('AI 서버에 연결하지 못했습니다(주소·사내망·CORS 확인): ' + (e && e.message || e)); });
  }
  var sessionKey = '';
  function load() {
    var c = defaults();
    try { var p = JSON.parse(localStorage.getItem(KEY) || 'null'); if (p) { c.baseUrl = baseOf(p.baseUrl); c.model = str(p.model); c.apiKey = str(p.apiKey); c.remember = !!p.remember; } } catch (e) { /* 막힌 저장소 */ }
    if (!c.apiKey && sessionKey) c.apiKey = sessionKey;
    return c;
  }
  function save(c) {
    sessionKey = str(c.apiKey);
    var s = { baseUrl: baseOf(c.baseUrl), model: str(c.model), apiKey: c.remember ? str(c.apiKey) : '', remember: !!c.remember };
    try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }
  return { KEY: KEY, defaults: defaults, baseOf: baseOf, ready: ready, check: check, buildRequest: buildRequest, readAnswer: readAnswer, send: send, load: load, save: save };
});
