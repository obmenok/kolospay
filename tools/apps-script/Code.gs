/**
 * Колос-1: приём строк от страницы казначея в таблицу «Колос_финансы».
 * Размещается в самой таблице: Расширения → Apps Script. Инструкция — в README рядом.
 *
 * Принимает POST (text/plain, JSON): {action: "ledger"|"append", code: "...", ...}
 * Секретный код хранится в Свойствах скрипта (TREASURER_CODE), в код не вписывается.
 */
var SHEET_INDEX = 0;          // первая вкладка «Движения по счету»
var DOC_HEADER = '№ док.';    // столбец H: номер банковского документа (защита от дублей)
var COLS = 8;                 // A..H

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var code = PropertiesService.getScriptProperties().getProperty('TREASURER_CODE');
    if (!code || String(req.code || '') !== code) return out({ ok: false, error: 'Неверный код казначея.' });
    if (req.action === 'ledger') return out({ ok: true, ledger: readLedger() });
    if (req.action === 'append') return out(append(req));
    return out({ ok: false, error: 'Неизвестное действие.' });
  } catch (err) {
    return out({ ok: false, error: 'Ошибка скрипта: ' + err.message });
  }
}
function doGet() { return out({ ok: true, hint: 'Колос-1: скрипт работает. Используйте со страницы казначея.' }); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet() { return SpreadsheetApp.getActive().getSheets()[SHEET_INDEX]; }

function kop(v) { return typeof v === 'number' ? Math.round(v * 100) : 0; }
function iso(v, tz) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : null; }

function ensureHeader(sh) {
  var c = sh.getRange(1, 8);
  if (String(c.getValue()).trim() !== DOC_HEADER) {
    c.setValue(DOC_HEADER);
    sh.getRange(1, 7).copyTo(c, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
}

function readLedger() {
  var sh = sheet(), tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  ensureHeader(sh);
  var n = sh.getLastRow();
  var v = sh.getRange(1, 1, n, COLS).getValues();
  var rows = [], open = null, contrs = {}, last = 0, lastDate = '0000-00-00';
  for (var i = 1; i < v.length; i++) {
    var d = iso(v[i][0], tz);
    if (!d) continue;
    if (open === null && typeof v[i][1] === 'number') open = Math.round(v[i][1] * 100);
    var r = { date: d, debit: kop(v[i][2]), credit: kop(v[i][3]), cat: String(v[i][4]).trim(),
              contr: String(v[i][5]).trim(), comm: String(v[i][6]).trim(), doc: String(v[i][7]).trim(), rowNum: i + 1 };
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
    var sh = sheet(), led = readLedger(), items = req.rows || [];
    if (!items.length) return { ok: false, error: 'Нет строк для внесения.' };
    if (Number(req.expectLastRow) !== led.lastRow)
      return { ok: false, error: 'Таблица изменилась после загрузки (последняя строка теперь ' + led.lastRow + '). Загрузите выписку заново.' };
    var docs = {}; led.rows.forEach(function (r) { if (r.doc) docs[r.doc] = 1; });
    var fresh = items.filter(function (x) { return !(x.doc && docs[x.doc]); });
    var skipped = items.length - fresh.length;
    if (!fresh.length) return { ok: true, added: 0, skipped: skipped };

    var first = led.lastRow + 1, last = first + fresh.length - 1, tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    var vals = fresh.map(function (x, i) {
      var p = first + i - 1, p3 = x.date.split('-');
      return [new Date(Number(p3[0]), Number(p3[1]) - 1, Number(p3[2])),
              '=B' + p + '+D' + p + '-C' + p,
              x.debit ? x.debit / 100 : '', x.credit ? x.credit / 100 : '',
              String(x.cat || ''), String(x.contr || ''), String(x.comm || ''), String(x.doc || '')];
    });
    var target = sh.getRange(first, 1, fresh.length, COLS);
    // формат, выпадающие списки и т.п. берём у последней заполненной строки
    sh.getRange(led.lastRow, 1, 1, COLS).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sh.getRange(led.lastRow, 1, 1, COLS).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    target.setValues(vals);
    sh.getRange(first, 1, fresh.length, 1).setNumberFormat('dd.MM.yyyy');
    SpreadsheetApp.flush();
    return { ok: true, added: fresh.length, skipped: skipped, firstRow: first, lastRow: last };
  } finally {
    lock.releaseLock();
  }
}

/** Один раз запустить вручную: задать секретный код (поменяйте текст в кавычках) */
function setCode() {
  PropertiesService.getScriptProperties().setProperty('TREASURER_CODE', 'ЗАМЕНИТЕ-НА-СВОЙ-КОД');
}
