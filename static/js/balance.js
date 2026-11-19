/* Остаток на счёте СНТ на главной странице.
 * Источник — лист «Остаток по дням», опубликованный в интернете как CSV (Файл → Поделиться → Опубликовать в интернете).
 * Последнее значение запоминается в браузере и показывается сразу, свежее подтягивается в фоне. */
(function () {
  var CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRkCRrOHBX2PvV2eAFaCvhRVxOJb7wPS50hK6XIDBlux0_NDQTrmzI4Z22r5yKpMncHvRF9qipVDnAe/pub?gid=1561458250&single=true&output=csv';   // вставьте сюда ссылку публикации листа «Остаток по дням» (формат CSV)
  var KEY = 'kolos-balance-v1';
  var el = document.getElementById('balance');
  if (!el || !CSV_URL) return;

  function parseCsv(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function num(s) {
    s = String(s).replace(/[\s  ₽р.]+$/i, '').replace(/[\s  ]/g, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (s.indexOf(',') >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    return Number(s);
  }
  function date(s) {
    var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s) || null;
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    var m2 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);   // m/d/yyyy
    return m2 ? new Date(+m2[3], +m2[1] - 1, +m2[2]) : null;
  }
  function pick(text) {
    var best = null;
    parseCsv(text).forEach(function (r) {
      var d = date(String(r[0] || '').trim()), v = num(r[2] || '');
      if (d && isFinite(v) && (!best || d >= best.d)) best = { d: d, v: v };
    });
    return best;
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function show(b) {
    var s = b.v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var d = (typeof b.d === 'string' ? new Date(b.d) : b.d);
    el.textContent = 'Остаток на счёте: ' + s + ' ₽ (обновлено ' + two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear() + ')';
    el.hidden = false;
  }
  try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && isFinite(c.v)) show(c); } catch (e) {}
  fetch(CSV_URL, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : Promise.reject(); }).then(function (t) {
    var b = pick(t); if (!b) return;
    show(b);
    try { localStorage.setItem(KEY, JSON.stringify({ v: b.v, d: b.d.toISOString() })); } catch (e) {}
  }).catch(function () {});
})();
