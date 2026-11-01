/**
 * Колос-1: приём строк от страницы казначея в таблицу «Колос_финансы».
 * Расширения → Apps Script. Секретный код — в Свойствах скрипта (TREASURER_CODE).
 * Столбцы ищутся по заголовкам первой строки: ДАТА, ДОКУМЕНТ, ОСТАТОК, РАСХОД, ПРИХОД,
 * НАЗНАЧЕНИЕ, КОНТРАГЕНТ, Комментарий — порядок можно менять.
 */
var SHEET_INDEX = 0;   // первая вкладка «Движения по счету»
var NEED = ['ДАТА', 'ДОКУМЕНТ', 'ОСТАТОК', 'РАСХОД', 'ПРИХОД', 'НАЗНАЧЕНИЕ', 'КОНТРАГЕНТ', 'КОММЕНТАРИЙ'];

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var code = PropertiesService.getScriptProperties().getProperty('TREASURER_CODE');
    if (!code || String(req.code || '') !== code) return out({ ok: false, error: 'Неверный код казначея.' });
    if (req.action === 'ledger') return out({ ok: true, ledger: readLedger() });
    if (req.action === 'append') return out(append(req));
    if (req.action === 'setDocs') return out(setDocs(req));
    return out({ ok: false, error: 'Неизвестное действие.' });
  } catch (err) {
    return out({ ok: false, error: 'Ошибка скрипта: ' + err.message });
  }
}
function doGet() { return out({ ok: true, hint: 'Колос-1: скрипт работает.' }); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet() { return SpreadsheetApp.getActive().getSheets()[SHEET_INDEX]; }
function tz() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone(); }
function kop(v) { return typeof v === 'number' ? Math.round(v * 100) : 0; }
function iso(v) { return v instanceof Date ? Utilities.formatDate(v, tz(), 'yyyy-MM-dd') : null; }
function colL(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

/** Находит столбцы по заголовкам. Возвращает {имя: индекс с 0}. */
function columns(sh) {
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], c = {};
  h.forEach(function (x, i) { var k = String(x).trim().toUpperCase(); if (k && c[k] === undefined) c[k] = i; });
  var miss = NEED.filter(function (k) { return c[k] === undefined; });
  if (miss.length) throw new Error('В первой строке не найдены столбцы: ' + miss.join(', '));
  return c;
}

function readLedger() {
  var sh = sheet(), c = columns(sh), n = sh.getLastRow(), w = sh.getLastColumn();
  var v = sh.getRange(1, 1, n, w).getValues();
  var rows = [], open = null, contrs = {}, last = 0, lastDate = '0000-00-00';
  for (var i = 1; i < v.length; i++) {
    var d = iso(v[i][c['ДАТА']]);
    if (!d) continue;
    var b = v[i][c['ОСТАТОК']];
    if (open === null && typeof b === 'number') open = Math.round(b * 100);
    var r = { date: d, debit: kop(v[i][c['РАСХОД']]), credit: kop(v[i][c['ПРИХОД']]),
              cat: String(v[i][c['НАЗНАЧЕНИЕ']]).trim(), contr: String(v[i][c['КОНТРАГЕНТ']]).trim(),
              comm: String(v[i][c['КОММЕНТАРИЙ']]).trim(), doc: String(v[i][c['ДОКУМЕНТ']]).trim(), rowNum: i + 1 };
    rows.push(r); last = i + 1; if (d > lastDate) lastDate = d;
    if (r.contr) contrs[r.contr] = 1;
  }
  var end = open;
  if (end !== null) rows.forEach(function (r) { end += r.credit - r.debit; });
  return { rows: rows, lastRow: last, endBalance: end, lastDate: lastDate, contrs: Object.keys(contrs) };
}

function append(req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'Таблица занята, повторите через минуту.' };
  try {
    var sh = sheet(), c = columns(sh), led = readLedger(), items = req.rows || [], w = sh.getLastColumn();
    if (!items.length) return { ok: false, error: 'Нет строк для внесения.' };
    if (Number(req.expectLastRow) !== led.lastRow)
      return { ok: false, error: 'Таблица изменилась после загрузки (последняя строка теперь ' + led.lastRow + '). Загрузите выписку заново.' };
    var docs = {}; led.rows.forEach(function (r) { if (r.doc) docs[r.doc] = 1; });
    var fresh = items.filter(function (x) { return !(x.doc && docs[x.doc]); });
    var skipped = items.length - fresh.length;
    if (!fresh.length) return { ok: true, added: 0, skipped: skipped };

    var first = led.lastRow + 1, target = sh.getRange(first, 1, fresh.length, w);
    var src = sh.getRange(led.lastRow, 1, 1, w);
    src.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    src.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    var B = colL(c['ОСТАТОК']), D = colL(c['РАСХОД']), P = colL(c['ПРИХОД']);
    var vals = fresh.map(function (x, i) {
      var p = first + i - 1, row = [];
      for (var k = 0; k < w; k++) row.push('');
      row[c['ДАТА']] = Utilities.parseDate(x.date, tz(), 'yyyy-MM-dd');   // в часовом поясе таблицы
      row[c['ДОКУМЕНТ']] = String(x.doc || '');
      row[c['ОСТАТОК']] = '=' + B + p + '+' + P + p + '-' + D + p;
      row[c['РАСХОД']] = x.debit ? x.debit / 100 : '';
      row[c['ПРИХОД']] = x.credit ? x.credit / 100 : '';
      row[c['НАЗНАЧЕНИЕ']] = String(x.cat || '');
      row[c['КОНТРАГЕНТ']] = String(x.contr || '');
      row[c['КОММЕНТАРИЙ']] = String(x.comm || '');
      return row;
    });
    try { sh.getRange(first, c['ДОКУМЕНТ'] + 1, fresh.length, 1).setNumberFormat('@'); } catch (e) {}
    target.setValues(vals);
    SpreadsheetApp.flush();
    return { ok: true, added: fresh.length, skipped: skipped, firstRow: first, lastRow: first + fresh.length - 1 };
  } finally { lock.releaseLock(); }
}

/** Разовая проставка номеров документов в старые строки. Пишет только в пустые ячейки ДОКУМЕНТ
 *  и только если дата и суммы строки совпадают с присланными. */
function setDocs(req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'Таблица занята, повторите через минуту.' };
  try {
    var sh = sheet(), c = columns(sh), n = sh.getLastRow(), col = c['ДОКУМЕНТ'] + 1;
    var v = sh.getRange(1, 1, n, sh.getLastColumn()).getValues();
    var docCol = sh.getRange(1, col, n, 1).getValues();
    var set = 0, skipped = 0;
    (req.items || []).forEach(function (it) {
      var i = Number(it.rowNum) - 1;
      if (i < 1 || i >= n) { skipped++; return; }
      var ok = iso(v[i][c['ДАТА']]) === it.date && kop(v[i][c['РАСХОД']]) === it.debit && kop(v[i][c['ПРИХОД']]) === it.credit;
      if (!ok || String(docCol[i][0]).trim() !== '') { skipped++; return; }
      docCol[i][0] = String(it.doc); set++;
    });
    var rng = sh.getRange(1, col, n, 1);
    try { rng.setNumberFormat('@'); } catch (e) {}
    rng.setValues(docCol);
    SpreadsheetApp.flush();
    return { ok: true, set: set, skipped: skipped };
  } finally { lock.releaseLock(); }
}

/** РАЗОВО: исправить даты строк, внесённых первой версией скрипта (сдвиг на −1 день).
 *  Запустите функцию один раз вручную. Диапазон строк задайте ниже. */
function fixShiftedDates() {
  var FIRST = 405, LAST = 445;   // строки, внесённые со страницы казначея
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DATES_FIXED')) throw new Error('Уже исправлено. Повторный запуск сдвинул бы даты ещё раз.');
  var sh = sheet(), c = columns(sh), rng = sh.getRange(FIRST, c['ДАТА'] + 1, LAST - FIRST + 1, 1);
  var v = rng.getValues().map(function (r) { return [r[0] instanceof Date ? new Date(r[0].getTime() + 86400000) : r[0]]; });
  rng.setValues(v);
  props.setProperty('DATES_FIXED', '1');
}
