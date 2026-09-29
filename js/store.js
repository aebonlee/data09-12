/* 브라우저 저장소 — localStorage 를 쓰되, 막혀 있으면 메모리로만 동작합니다 */
(function (root) {
  'use strict';
  var KEY_DB = 'data09-12.db';
  var memory = {};
  var ok = true;
  function get(k) {
    try { return root.localStorage.getItem(k); } catch (e) { ok = false; return memory[k] == null ? null : memory[k]; }
  }
  function set(k, v) {
    try { root.localStorage.setItem(k, v); } catch (e) { ok = false; memory[k] = v; }
  }
  function del(k) {
    try { root.localStorage.removeItem(k); } catch (e) { ok = false; delete memory[k]; }
  }
  // 저장된 값과 기본값을 합칩니다(새 설정 항목이 생겨도 깨지지 않게)
  function normalize(p) {
    var L = root.OMLogic;
    var db = L.emptyDb();
    if (!p || typeof p !== 'object') return db;
    if (Array.isArray(p.suppliers)) db.suppliers = p.suppliers;
    if (Array.isArray(p.pos)) db.pos = p.pos;
    if (p.settings) Object.keys(db.settings).forEach(function (k) { if (p.settings[k] != null) db.settings[k] = p.settings[k]; });
    if (p.templates) Object.keys(db.templates).forEach(function (k) {
      var t = p.templates[k];
      if (t && typeof t.subject === 'string' && typeof t.body === 'string') db.templates[k] = { subject: t.subject, body: t.body };
    });
    db.mappings = p.mappings && typeof p.mappings === 'object' ? p.mappings : {};
    if (p.an && typeof p.an === 'object') db.an = {
      mails: Array.isArray(p.an.mails) ? p.an.mails : [],
      regs: p.an.regs && typeof p.an.regs === 'object' ? p.an.regs : {},
      history: Array.isArray(p.an.history) ? p.an.history : []
    };
    if (p._sample) db._sample = true;
    return db;
  }
  root.OMStore = {
    normalize: normalize,
    loadDb: function () {
      var raw = get(KEY_DB);
      if (!raw) return normalize(null);
      try { return normalize(JSON.parse(raw)); } catch (e) { return normalize(null); }
    },
    saveDb: function (db) { set(KEY_DB, JSON.stringify(db)); },
    clearDb: function () { del(KEY_DB); },
    available: function () { get(KEY_DB); return ok; }
  };
})(window);
