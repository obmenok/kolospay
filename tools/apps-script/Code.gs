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
    CUR = req.book === 'cash' ? 'cash' : null;
    var code = PropertiesService.getScriptProperties().getProperty('TREASURER_CODE');
    if (!code || String(req.code || '') !== code) return out({ ok: false, error: 'Неверный код казначея.' });
    if (req.action === 'ledger') return out({ ok: true, ledger: readLedger() });
    if (req.action === 'append') return out(append(req));
    if (req.action === 'setDocs') return out(setDocs(req));
    if (req.action === 'addReadings') return out(addReadings(req));
    return out({ ok: false, error: 'Неизвестное действие.' });
  } catch (err) {
    return out({ ok: false, error: 'Ошибка скрипта: ' + err.message });
  }
}
function doGet() { return out({ ok: true, hint: 'Колос-1: скрипт работает.' }); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

var CASH_NAME = 'Касса';
var CUR = null;   // 'cash' — работаем с листом «Касса» вместо банковского
function sheet() {
  if (CUR === 'cash') {
    var cs = SpreadsheetApp.getActive().getSheetByName(CASH_NAME);
    if (!cs) throw new Error('Нет листа «Касса»: запустите функцию setupSheets.');
    return cs;
  }
  return SpreadsheetApp.getActive().getSheets()[SHEET_INDEX];
}
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
  var rd = readReadings();
  return { rows: rows, lastRow: last, endBalance: end, lastDate: lastDate, contrs: Object.keys(contrs),
           readings: rd.last, readingDocs: rd.docs };
}

// ---------- журнал показаний ----------
var RD_NEED = ['ДАТА', 'УЧАСТОК', 'ПРЕДЫДУЩЕЕ', 'ТЕКУЩЕЕ', 'КВТ·Ч', 'СУММА', 'ИСТОЧНИК', 'ДОКУМЕНТ', 'СТАТУС', 'КОММЕНТАРИЙ'];
function rdSheet() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Показания');
  if (!sh) throw new Error('Нет листа «Показания»: запустите функцию setupSheets.');
  return sh;
}
function rdColumns(sh) {
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], c = {};
  h.forEach(function (x, i) { var k = String(x).trim().toUpperCase(); if (k && c[k] === undefined) c[k] = i; });
  var miss = RD_NEED.filter(function (k) { return c[k] === undefined; });
  if (miss.length) throw new Error('В листе «Показания» не найдены столбцы: ' + miss.join(', '));
  return c;
}
/** -> {last: {"УЧАСТОК № 32": {cur, date}}, docs: [номера документов]} ; последнее = наибольшее текущее показание */
function readReadings() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Показания');
  if (!sh || sh.getLastRow() < 2) return { last: {}, docs: [] };
  var c = rdColumns(sh), v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues(), last = {}, docs = [];
  v.forEach(function (r) {
    var d = iso(r[c['ДАТА']]), plot = r[c['УЧАСТОК']], cur = r[c['ТЕКУЩЕЕ']];
    if (r[c['ДОКУМЕНТ']]) docs.push(String(r[c['ДОКУМЕНТ']]).trim());
    if (!d || !plot || typeof cur !== 'number') return;
    var k = 'УЧАСТОК № ' + plot;
    if (!last[k] || cur > last[k].cur || (cur === last[k].cur && d > last[k].date)) last[k] = { cur: cur, date: d };
  });
  return { last: last, docs: docs };
}
/** Добавляет строки в «Показания» (без дублей по номеру документа). Вызывать под блокировкой. */
function addReadingRows(items) {
  var sh = rdSheet(), c = rdColumns(sh), have = {};
  readReadings().docs.forEach(function (d) { have[d] = 1; });
  var fresh = items.filter(function (x) { return !(x.doc && have[String(x.doc)]); });
  if (!fresh.length) return 0;
  var w = sh.getLastColumn(), first = sh.getLastRow() + 1;
  var vals = fresh.map(function (x) {
    var row = []; for (var k = 0; k < w; k++) row.push('');
    row[c['ДАТА']] = Utilities.parseDate(x.date, tz(), 'yyyy-MM-dd');
    row[c['УЧАСТОК']] = Number(x.plot); row[c['ПРЕДЫДУЩЕЕ']] = Number(x.prev); row[c['ТЕКУЩЕЕ']] = Number(x.cur);
    row[c['КВТ·Ч']] = Number(x.cur) - Number(x.prev); row[c['СУММА']] = Number(x.amount);
    row[c['ИСТОЧНИК']] = String(x.source || 'банк'); row[c['ДОКУМЕНТ']] = String(x.doc || '');
    row[c['СТАТУС']] = String(x.status || 'ок'); row[c['КОММЕНТАРИЙ']] = String(x.comm || '');
    return row;
  });
  sh.getRange(first, 1, fresh.length, w).setValues(vals);
  try { sh.getRange(first, c['ДАТА'] + 1, fresh.length, 1).setNumberFormat('dd.MM.yyyy'); } catch (e) {}
  return fresh.length;
}
function addReadings(req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'Таблица занята, повторите через минуту.' };
  try {
    var n = addReadingRows(req.rows || []);
    SpreadsheetApp.flush();
    return { ok: true, added: n, skipped: (req.rows || []).length - n };
  } finally { lock.releaseLock(); }
}

function append(req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'Таблица занята, повторите через минуту.' };
  try {
    var sh = sheet(), c = columns(sh), led = readLedger(), items = req.rows || [], w = sh.getLastColumn();
    if (!items.length) return { ok: false, error: 'Нет строк для внесения.' };
    if (Number(req.expectLastRow) !== led.lastRow)
      return { ok: false, error: 'Таблица изменилась после загрузки (последняя строка теперь ' + led.lastRow + '). Загрузите выписку заново.' };
    if (CUR === 'cash') {   // номера документов налички: Н-ГГГГ-NNNN, нумерует скрипт
      var maxN = {};
      led.rows.forEach(function (r) { var m = /^Н-(\d{4})-(\d+)$/.exec(r.doc); if (m) maxN[m[1]] = Math.max(maxN[m[1]] || 0, Number(m[2])); });
      items.forEach(function (x) {
        if (x.doc) return;
        var y = x.date.slice(0, 4); maxN[y] = (maxN[y] || 0) + 1;
        x.doc = 'Н-' + y + '-' + ('000' + maxN[y]).slice(-4);
      });
    }
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
    var rds = fresh.filter(function (x) { return x.rd; }).map(function (x) {
      return { date: x.date, plot: x.rd.plot, prev: x.rd.prev, cur: x.rd.cur, amount: x.credit / 100, source: CUR === 'cash' ? 'касса' : 'банк', doc: x.doc, status: x.rd.status, comm: x.comm };
    });
    var rdAdded = rds.length ? addReadingRows(rds) : 0;
    SpreadsheetApp.flush();
    return { ok: true, added: fresh.length, skipped: skipped, readings: rdAdded, docs: fresh.map(function (x) { return x.doc; }), firstRow: first, lastRow: first + fresh.length - 1 };
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


// ---------- РАЗОВАЯ настройка: листы «Показания» и «Участки» ----------
var PLOTS = "2,43:40:032706:2,877;3,43:40:032706:3,635;4,43:40:032706:4,649;5,43:40:032706:5,837;6,43:40:032706:6,990;7,43:40:032706:7,395;8,43:40:032706:8,416;9,43:40:032706:9,836;10,43:40:032706:10,432;11,43:40:032706:11,429;12,43:40:032706:12,779;13,43:40:032706:13,554;14,43:40:032706:14,529;15,43:40:032706:15,660;16,43:40:032706:16,839;17,43:40:032706:17,365;18,43:40:032706:18,386;19,43:40:032706:19,421;20,43:40:032706:20,404;21,43:40:032706:21,492;22,43:40:032706:22,457;23,43:40:032706:23,369;24,43:40:032706:24,411;25,43:40:032706:25,369;26,43:40:032706:26,380;27,43:40:032706:27,395;28,43:40:032706:28,409;29,43:40:032706:29,691;30,43:40:032706:30,542;31,43:40:032706:31,432;32,43:40:032706:32,398;33,43:40:032706:33,400;34,43:40:032706:34,413;35,43:40:032706:35,406;36,43:40:032706:36,399;37,43:40:032706:37,418;38,43:40:032706:38,439;39,43:40:032706:39,360;40,43:40:032706:40,378;41,43:40:032706:41,381;42,43:40:032706:42,397;43,43:40:032706:43,398;44,43:40:032706:44,405;45,43:40:032706:45,408;46,43:40:032706:46,438;47,43:40:032706:47,702;48,43:40:032706:48,469;49,43:40:032706:49,418;50,43:40:032706:50,401;51,43:40:032706:51,773;52,43:40:032706:52,381;53,43:40:032706:53,372;54,43:40:032706:54,379;55,43:40:032706:55,373;56,43:40:032706:56,372;57,43:40:032706:57,449;58,43:40:032706:58,391;59,43:40:032706:59,403;60,43:40:032706:60,394;61,43:40:032706:61,398;62,43:40:032706:62,408;63,43:40:032706:63,384;64,43:40:032706:64,399;65,43:40:032706:65,908;66,43:40:032706:66,537;67,43:40:032706:67,887;68,43:40:032706:68,426;69,43:40:032706:69,390;70,43:40:032706:70,388;71,43:40:032706:71,370;72,43:40:032706:72,396;73,43:40:032706:73,397;74,43:40:032706:74,379;75,43:40:032706:75,497;76,43:40:032706:76,661;77,43:40:032706:77,411;78,43:40:032706:78,571;79,43:40:032706:79,432;80,43:40:032706:80,402;81,43:40:032706:81,576;82,43:40:032706:82,495;83,43:40:032706:83,1068;84,43:40:032706:84,389;85,43:40:032706:85,411;86,43:40:032706:86,401;87,43:40:032706:87,463;88,43:40:032706:88,700;89,43:40:032706:89,393;90,43:40:032706:90,815;91,43:40:032706:91,818;92,43:40:032706:92,398;93,43:40:032706:93,475;94,43:40:032706:94,436;95,43:40:032706:95,811;96,43:40:032706:96,419;97,43:40:032706:97,369;100,43:40:032706:100,717;101,43:40:032706:101,489;102,43:40:032706:102,606;103,43:40:032706:103,699;104,43:40:032706:104,565;105,43:40:032706:105,684;106,43:40:032706:106,1169;107,43:40:032706:107,853;108,43:40:032706:108,520;109,43:40:032706:109,497;110,43:40:032706:110,774;111,43:40:032706:111,651;112,43:40:032706:112,492;113,43:40:032706:113,955;114,43:40:032706:114,1243;115,43:40:032706:115,1203;116,43:40:032706:116,1037;117,43:40:032706:117,516;118,43:40:032706:118,783;119,43:40:032706:119,753;120,43:40:032706:120,857;121,43:40:032706:121,852;122,43:40:032706:122,790;123,43:40:032706:123,695;124,43:40:032706:124,862;125,43:40:032706:125,771;126,43:40:032706:126,934;128,43:40:032706:128,872;129,43:40:032706:129,866;130,43:40:032706:130,790;131,43:40:032706:131,844;132,43:40:032706:132,828;133,43:40:032706:133,837;134,43:40:032706:134,753;135,43:40:032706:135,830;136,43:40:032706:136,833;137,43:40:032706:137,812;138,43:40:032706:138,788;139,43:40:032706:139,513;140,43:40:032706:140,405;141,43:40:032706:141,826;142,43:40:032706:142,671;143,43:40:032706:143,868;144,43:40:032706:144,743;145,43:40:032706:145,800;146,43:40:032706:146,748;147,43:40:032706:147,755;148,43:40:032706:148,703;149,43:40:032706:149,756;150,43:40:032706:150,743;151,43:40:032706:151,785;152,43:40:032706:152,843;153,43:40:032706:153,823;154,43:40:032706:154,1528;155,43:40:032706:155,766;156,43:40:032706:156,783;157,43:40:032706:157,782;158,43:40:032706:158,760;159,43:40:032706:159,745;170,43:40:052706:8,929;171,43:40:052706:7,940;172,43:40:052706:6,1042;173,43:40:052706:5,1078;174,43:40:052706:4,1088;175,43:40:052706:3,1078;176,43:40:052706:2,1123;282,43:40:032706:282,860;283,43:40:032706:283,802;287,43:40:032706:287,793";

function setupCash() {
  var ss = SpreadsheetApp.getActive(), bank = ss.getSheets()[SHEET_INDEX], bc = columns(bank);
  var cs = ss.getSheetByName(CASH_NAME) || ss.insertSheet(CASH_NAME);
  if (cs.getLastRow() === 0) {
    cs.getRange(1, 1, 1, 8).setValues([['ДАТА', 'ДОКУМЕНТ', 'ОСТАТОК', 'РАСХОД', 'ПРИХОД', 'НАЗНАЧЕНИЕ', 'КОНТРАГЕНТ', 'Комментарий']])
      .setFontWeight('bold').setBackground('#1b5e4b').setFontColor('#ffffff');
    cs.setFrozenRows(1);
    // строка 2 — начальный остаток кассы: впишите сумму наличных на руках в столбец ОСТАТОК и дату начала учёта
    cs.getRange(2, 1, 1, 8).setValues([[Utilities.parseDate('2026-01-01', tz(), 'yyyy-MM-dd'), 'Н-0000', 0, '', '', '', '', 'Начальный остаток кассы']]);
    cs.getRange(2, 1, 500, 1).setNumberFormat('dd.MM.yyyy');
    cs.getRange(2, 2, 500, 1).setNumberFormat('@');
    cs.getRange(2, 3, 500, 3).setNumberFormat('#,##0.00 [$₽]');
    cs.setColumnWidths(1, 8, 120); cs.setColumnWidth(2, 140); cs.setColumnWidth(6, 200); cs.setColumnWidth(7, 180); cs.setColumnWidth(8, 360);
    try { bank.getRange(2, bc['НАЗНАЧЕНИЕ'] + 1).copyTo(cs.getRange(2, 6, 500, 1), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false); } catch (e) {}
  }
}

function setupSheets() {
  setupCash();
  CUR = null;
  var ss = SpreadsheetApp.getActive(), led = sheet(), c = columns(led);
  CUR = 'cash'; var cc = columns(sheet()); CUR = null;
  var cq = "'" + CASH_NAME + "'!";
  var q = "'" + led.getName() + "'!";
  var A = q + '$' + colL(c['ДАТА']) + ':$' + colL(c['ДАТА']), E = q + '$' + colL(c['ПРИХОД']) + ':$' + colL(c['ПРИХОД']),
      F = q + '$' + colL(c['НАЗНАЧЕНИЕ']) + ':$' + colL(c['НАЗНАЧЕНИЕ']), G = q + '$' + colL(c['КОНТРАГЕНТ']) + ':$' + colL(c['КОНТРАГЕНТ']);

  // Показания
  var rd = ss.getSheetByName('Показания') || ss.insertSheet('Показания');
  if (rd.getLastRow() === 0) {
    rd.getRange(1, 1, 1, RD_NEED.length).setValues([['ДАТА', 'УЧАСТОК', 'ПРЕДЫДУЩЕЕ', 'ТЕКУЩЕЕ', 'КВТ·Ч', 'СУММА', 'ИСТОЧНИК', 'ДОКУМЕНТ', 'СТАТУС', 'КОММЕНТАРИЙ']])
      .setFontWeight('bold').setBackground('#1b5e4b').setFontColor('#ffffff');
    rd.setFrozenRows(1);
    rd.getRange(2, 1, 2000, 1).setNumberFormat('dd.MM.yyyy');
    rd.getRange(2, 8, 2000, 1).setNumberFormat('@');
    rd.setColumnWidth(8, 220); rd.setColumnWidth(10, 360);
  }
  var R = "Показания!";

  // Участки
  var pl = ss.getSheetByName('Участки') || ss.insertSheet('Участки');
  var head = ['УЧАСТОК', 'КАДАСТРОВЫЙ НОМЕР', 'ПЛОЩАДЬ', 'ПОСЛЕДНЕЕ ПОКАЗАНИЕ', 'ДАТА ПОКАЗАНИЯ', 'ИСТОЧНИК', 'СТАТУС',
              'ЭЛЕКТРОЭНЕРГИЯ 2025', 'ЭЛЕКТРОЭНЕРГИЯ 2026', 'ВЗНОСЫ 2025', 'ВЗНОСЫ 2026'];
  if (pl.getLastRow() < 2) {
    pl.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1b5e4b').setFontColor('#ffffff').setWrap(true);
    pl.setFrozenRows(1);
    var list = PLOTS.split(';').map(function (s) { var p = s.split(','); return [Number(p[0]), p[1], Number(p[2])]; });
    pl.getRange(2, 1, list.length, 3).setValues(list);
    pl.setColumnWidths(1, 11, 120); pl.setColumnWidth(2, 150);
  }
  // Формулы пишутся заново при каждом запуске (запуск безопасен и исправляет формулы).
  // Разделитель аргументов зависит от языка таблицы: в русской — «;», в английской — «,».
  var loc = String(ss.getSpreadsheetLocale()), sep = /^(en|ja|zh|ko|he|th)/i.test(loc) ? ',' : ';';
  var n = pl.getLastRow() - 1, f = [];
  var fx = function (t) { return t.replace(/\|/g, sep); };   // в шаблонах разделитель записан как «|»
  for (var i2 = 0; i2 < n; i2++) {
    var r = i2 + 2;
    var sum1 = function (Er, Gr, Fr, Ar, cat, y) {
      return 'SUMIFS(' + Er + '|' + Gr + '|"УЧАСТОК № "&$A' + r + '|' + Fr + '|"' + cat + '"|' + Ar + '|">="&DATE(' + y + '|1|1)|' + Ar + '|"<="&DATE(' + y + '|12|31))';
    };
    var sum = function (cat, y) {   // безнал + наличка
      var cl = function (n) { return cq + '$' + colL(cc[n]) + ':$' + colL(cc[n]); };
      return fx('=' + sum1(E, G, F, A, cat, y) + '+' + sum1(cl('ПРИХОД'), cl('КОНТРАГЕНТ'), cl('НАЗНАЧЕНИЕ'), cl('ДАТА'), cat, y));
    };
    f.push([
      fx('=IFERROR(MAXIFS(' + R + '$D:$D|' + R + '$B:$B|$A' + r + ')|"")'),
      fx('=IF($D' + r + '=""|""|MAXIFS(' + R + '$A:$A|' + R + '$B:$B|$A' + r + '|' + R + '$D:$D|$D' + r + '))'),
      fx('=IF($D' + r + '=""|""|IFERROR(INDEX(FILTER(' + R + '$G:$G|(' + R + '$B:$B=$A' + r + ')*(' + R + '$D:$D=$D' + r + '))|1)|""))'),
      fx('=IF(COUNTIFS(' + R + '$B:$B|$A' + r + '|' + R + '$I:$I|"уточнить")>0|"уточнить"|IF($D' + r + '=""|"нет показаний"|"ок"))'),
      sum('ЭЛЕКТРОЭНЕРГИЯ', 2025), sum('ЭЛЕКТРОЭНЕРГИЯ', 2026), sum('ЧЛЕНСКИЙ ВЗНОС', 2025), sum('ЧЛЕНСКИЙ ВЗНОС', 2026)
    ]);
  }
  pl.getRange(2, 4, n, 8).setFormulas(f);
  pl.getRange(2, 5, n, 1).setNumberFormat('dd.MM.yyyy');
  pl.getRange(2, 8, n, 4).setNumberFormat('#,##0.00 [$₽]');
}
