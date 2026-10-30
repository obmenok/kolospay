/* Разбор банковской выписки, распознавание платежей и сверка с таблицей учёта.
 * Чистые функции без интерфейса: их можно тестировать отдельно от страницы казначея.
 * Все суммы внутри — в копейках (целые числа), чтобы не накапливать ошибки округления.
 */
(function (root) {
  "use strict";

  var CATEGORIES = ["ЭЛЕКТРОЭНЕРГИЯ", "ЧЛЕНСКИЙ ВЗНОС", "ВЫВОЗ ТБО", "СПЕЦТЕХНИКА", "МАТЕРИАЛЫ",
                    "СТРОИТЕЛЬНЫЕ РАБОТЫ", "КОМИССИЯ"];
  var SS_NS = "urn:schemas-microsoft-com:office:spreadsheet";

  // ---------- мелочи ----------
  function toKop(s) {
    var n = parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
    return isNaN(n) ? 0 : Math.round(n * 100);
  }
  function normCat(s) { return String(s || "").replace(/\s+/g, " ").trim().toUpperCase(); }
  function normContr(s) { return String(s || "").replace(/\s+/g, " ").trim().toUpperCase(); }
  function isoFromRu(s) { return s.slice(6, 10) + "-" + s.slice(3, 5) + "-" + s.slice(0, 2); }
  function ruFromIso(s) { return s.slice(8, 10) + "." + s.slice(5, 7) + "." + s.slice(0, 4); }
  function dayNum(iso) { return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000); }
  function kopText(k) {                 // 150000 -> "1500", 160590 -> "1605,90"
    var neg = k < 0; k = Math.abs(k);
    var r = Math.floor(k / 100), c = k % 100;
    return (neg ? "-" : "") + r + (c ? "," + (c < 10 ? "0" : "") + c : "");
  }

  // ---------- банковская выписка (Excel 2003 XML, как выгружает банк) ----------
  function gridFromXml(text) {
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Файл не похож на выписку банка (не удалось разобрать XML).");
    var rows = doc.getElementsByTagNameNS(SS_NS, "Row"), grid = [];
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].getElementsByTagNameNS(SS_NS, "Cell"), row = {}, col = 0;
      for (var j = 0; j < cells.length; j++) {
        var idx = cells[j].getAttributeNS(SS_NS, "Index");
        if (idx) col = parseInt(idx, 10) - 1;
        var d = cells[j].getElementsByTagNameNS(SS_NS, "Data")[0];
        row[col] = d ? (d.textContent || "").replace(/\s+/g, " ").trim() : "";
        col++;
      }
      grid.push(row);
    }
    return grid;
  }

  function parseStatement(text) {
    if (!/<Workbook[\s>]/.test(text.slice(0, 2000))) {
      throw new Error("Это не выписка в формате банка. Скачайте выписку из личного кабинета банка (формат Excel).");
    }
    var grid = gridFromXml(text), ops = [], opening = null, closing = null, totals = null, account = "";
    var reDate = /^\d{2}\.\d{2}\.\d{4}$/;
    grid.forEach(function (row) {
      var c0 = row[0] || "", c1 = row[1] || "";
      if (/^Выписка по счету/.test(c0)) account = c0;
      if (/^Входящий остаток/.test(c1)) {
        var m = /([\d.,]+)\s+на\s+(\d{2}\.\d{2}\.\d{4})/.exec(row[2] || "");
        if (m) opening = { kop: toKop(m[1]), date: isoFromRu(m[2]) };
      } else if (/^Исходящий остаток/.test(c1)) {
        var m2 = /([\d.,]+)\s+на\s+(\d{2}\.\d{2}\.\d{4})/.exec(row[2] || "");
        if (m2) closing = { kop: toKop(m2[1]), date: isoFromRu(m2[2]) };
      } else if (/^ИТОГО/.test(c0)) {
        totals = { debit: toKop(row[1]), credit: toKop(row[2]) };
      } else if (c0 && reDate.test(c1) && (row[8] !== undefined || row[9] !== undefined)) {
        ops.push({
          doc: c0, date: isoFromRu(c1), corr: row[2] || "",
          balBefore: row[7] ? toKop(row[7]) : null,
          debit: row[8] ? toKop(row[8]) : 0, credit: row[9] ? toKop(row[9]) : 0,
          purpose: row[10] || ""
        });
      }
    });
    if (!ops.length) throw new Error("В выписке не найдено ни одной операции.");
    if (!opening || !closing) throw new Error("В выписке не найдены входящий и исходящий остатки.");
    var sd = 0, sc = 0;
    ops.forEach(function (o) { sd += o.debit; sc += o.credit; });
    if (totals && (totals.debit !== sd || totals.credit !== sc)) {
      throw new Error("Итоги выписки не сходятся с суммой операций: файл прочитан не полностью.");
    }
    if (opening.kop + sc - sd !== closing.kop) {
      throw new Error("Входящий остаток плюс обороты не равен исходящему остатку: выписка повреждена или неполная.");
    }
    return {
      ops: ops, opening: opening, closing: closing, account: account,
      from: ops[0].date, to: ops[ops.length - 1].date
    };
  }

  // ---------- таблица учёта (xlsx/csv, скачанная из Google) ----------
  function cellDateIso(XLSX, c) {
    if (!c || c.v === undefined || c.v === null || c.v === "") return null;
    if (c.t === "d" && c.v instanceof Date) {
      var d = c.v; return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    }
    if (c.t === "n") {
      var p = XLSX.SSF.parse_date_code(c.v);
      if (!p || p.y < 2000) return null;
      return p.y + "-" + ("0" + p.m).slice(-2) + "-" + ("0" + p.d).slice(-2);
    }
    var s = String(c.v).trim(), m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    return m ? m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2) : null;
  }

  function readLedger(XLSX, buffer) {
    var head = new Uint8Array(buffer.slice(0, 8)), zip = head[0] === 0x50 && head[1] === 0x4b, xls = head[0] === 0xd0 && head[1] === 0xcf;
    if (!zip && !xls) {
      var txt = new TextDecoder("utf-8").decode(buffer.slice(0, 300));
      throw new Error(/<Workbook|<\?xml/.test(txt)
        ? "Это выписка банка, а здесь нужна таблица учёта: в Google Таблицах выберите Файл → Скачать → Microsoft Excel (.xlsx)."
        : "Не удалось распознать файл. Нужна таблица учёта в формате Excel (.xlsx): Файл → Скачать → Microsoft Excel (.xlsx).");
    }
    var wb;
    try { wb = XLSX.read(buffer, { type: "array" }); }
    catch (e) { throw new Error("Не удалось прочитать таблицу. Скачайте её из Google заново в формате .xlsx."); }
    var ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws || !ws["!ref"]) throw new Error("Таблица пустая.");
    var range = XLSX.utils.decode_range(ws["!ref"]);
    var cols = {}, headerRow = -1;
    for (var r = range.s.r; r <= Math.min(range.e.r, range.s.r + 5) && headerRow < 0; r++) {
      var found = {};
      for (var c = range.s.c; c <= range.e.c; c++) {
        var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
        if (cell && cell.v !== undefined) found[String(cell.v).trim().toUpperCase()] = c;
      }
      if (found["ДАТА"] !== undefined && found["ПРИХОД"] !== undefined && found["РАСХОД"] !== undefined) { cols = found; headerRow = r; }
    }
    if (headerRow < 0) throw new Error("В таблице не найдены столбцы ДАТА, РАСХОД, ПРИХОД. Это точно таблица учёта?");
    var get = function (r, name) { return cols[name] === undefined ? undefined : ws[XLSX.utils.encode_cell({ r: r, c: cols[name] })]; };
    var num = function (cell) { return cell && typeof cell.v === "number" ? Math.round(cell.v * 100) : (cell && cell.v ? toKop(cell.v) : 0); };
    var str = function (cell) { return cell && cell.v !== undefined && cell.v !== null ? String(cell.v).trim() : ""; };
    var rows = [], openBal = null, commentKey = cols["КОММЕНТАРИЙ"] !== undefined ? "КОММЕНТАРИЙ" : null;
    for (var rr = headerRow + 1; rr <= range.e.r; rr++) {
      var date = cellDateIso(XLSX, get(rr, "ДАТА"));
      if (!date) continue;
      var row = {
        date: date, debit: num(get(rr, "РАСХОД")), credit: num(get(rr, "ПРИХОД")),
        cat: normCat(str(get(rr, "НАЗНАЧЕНИЕ"))), contr: normContr(str(get(rr, "КОНТРАГЕНТ"))),
        comm: commentKey ? str(get(rr, commentKey)) : "", rowNum: rr + 1
      };
      if (openBal === null) {
        var b = get(rr, "ОСТАТОК");
        openBal = b && typeof b.v === "number" ? Math.round(b.v * 100) : null;
      }
      rows.push(row);
    }
    if (!rows.length) throw new Error("В таблице нет ни одной строки с датой.");
    var end = openBal;
    if (end !== null) rows.forEach(function (x) { end += x.credit - x.debit; });
    return {
      rows: rows, lastRow: rows[rows.length - 1].rowNum, endBalance: end,
      lastDate: rows.reduce(function (a, x) { return x.date > a ? x.date : a; }, "0000-00-00"),
      contrs: Object.keys(rows.reduce(function (a, x) { if (x.contr) a[x.contr] = 1; return a; }, {}))
    };
  }

  // ---------- распознавание платежа ----------
  var RE_PLOT = /(?:участ[а-яё]*|уч)\.?\s*(?:№|#|n|no)?\s*(\d{1,3})(?!\d)/i;
  var RE_ELEC = /электр|эл\/эн|эл\.эн|квт|показани|показ\.|(?:^|[^а-яёa-z0-9])т\s*[12](?![а-яёa-z0-9])/i;
  var RE_FEE = /членск|ч[лн]\.?\s*взнос|взнос|прошлые периоды/i;

  function readings(p) {
    var t1 = /т\s*1\s*[=\-:]?\s*(\d+)/i.exec(p), t2 = /т\s*2\s*[=\-:]?\s*(\d+)/i.exec(p);
    if (t1 || t2) return { kind: "t12", t1: t1 ? +t1[1] : null, t2: t2 ? +t2[1] : null };
    var m = /пред[а-яё]*\.?\s*(\d+)\D+(?:текущ[а-яё]*|тек[а-яё]*)\.?\s*(\d[\d ]*\d|\d)/i.exec(p);
    if (m) return { kind: "prevcur", prev: +m[1], cur: +m[2].replace(/ /g, "") };
    return null;
  }

  function normKey(corr) {            // ключ «запомненного» получателя: без цифр и знаков, верхний регистр
    return String(corr || "").toUpperCase().replace(/[0-9\/\\№#"«»().,;:_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function suggestPayee(corr) {
    var s = String(corr || "").replace(/\/\/.*$/, "").trim();
    var ip = /\(\s*ИП\s*\)/i.test(s) || /^ИП\s/i.test(s);
    var quoted = /["«]([^"»]+)["»]/.exec(s);
    if (ip) { var w = s.replace(/\(\s*ИП\s*\)/i, "").replace(/^ИП\s/i, "").trim().split(/\s+/)[0] || s; return "ИП " + w.toUpperCase(); }
    if (quoted) return quoted[1].trim().toUpperCase();
    return s.toUpperCase().slice(0, 40);
  }

  /* -> { cat, contr, status: "high"|"check"|"none", readings, note } */
  function classify(op, rules) {
    var p = op.purpose || "", pl = p.toLowerCase(), corr = (op.corr || "").toUpperCase(), corrL = corr.toLowerCase();
    var res = function (cat, contr, status, rd, note) { return { cat: cat, contr: contr, status: status, readings: rd || null, note: note || "" }; };
    var rule = rules && rules[normKey(op.corr)];
    if (op.debit) {
      if (rule) return res(rule.cat, rule.contr, "high", null, "по вашему прошлому выбору");
      if (corr.indexOf("ЭНЕРГОСБЫТ") >= 0) return res("ЭЛЕКТРОЭНЕРГИЯ", "ЭНЕРГОСБЫТ ПЛЮС", "high");
      if (corr.indexOf("КДУ") >= 0) return res("ВЫВОЗ ТБО", "КДУ-3", "high");
      if (corr.indexOf("СОБОЛЕВ") >= 0) return res("СПЕЦТЕХНИКА", "ИП СОБОЛЕВ", "high");
      if (corr.indexOf("КАЗНАЧЕЙСТВО") >= 0 || corr.indexOf("ФНС") >= 0) return res("КОМИССИЯ", "ФНС", "check");
      if (corr.indexOf("ХЛЫНОВ") >= 0 || corrL.indexOf("комисси") >= 0 || pl.indexOf("комисси") >= 0 || corrL.indexOf("доходы банка") >= 0)
        return res("КОМИССИЯ", "ХЛЫНОВ", "high");
      return res("", suggestPayee(op.corr), "none", null, "новый получатель: выберите назначение");
    }
    if (corr.indexOf("КОЛОС-3") >= 0 || corr.indexOf("КОЛОС 3") >= 0)
      return res("ЭЛЕКТРОЭНЕРГИЯ", "КОЛОС-3", pl.indexOf("электро") >= 0 ? "high" : "check");
    var m = RE_PLOT.exec(p);
    var el = RE_ELEC.test(pl), fee = RE_FEE.test(pl);
    if (!m) {
      if (rule) return res(rule.cat, rule.contr, "high", null, "по вашему прошлому выбору");
      if (corr.indexOf("ХЛЫНОВ") >= 0 && fee) return res("ЧЛЕНСКИЙ ВЗНОС", "КОЛОС-1", "check", null, "наличные через банк, без номера участка");
      return res("", "", "none", null, "не найден номер участка");
    }
    var contr = "УЧАСТОК № " + parseInt(m[1], 10);
    if (el && fee) return res("ЭЛЕКТРОЭНЕРГИЯ", contr, "check", readings(p), "в назначении и взнос, и электроэнергия");
    if (el) return res("ЭЛЕКТРОЭНЕРГИЯ", contr, "high", readings(p));
    if (fee) return res("ЧЛЕНСКИЙ ВЗНОС", contr, "high");
    return res("", contr, "none", null, "не понятно, за что платёж");
  }

  // ---------- сверка с таблицей: какие операции уже внесены ----------
  /* Возвращает для каждой операции индекс строки таблицы или -1 (новая операция).
   * Допускаем сдвиг даты до 7 дней: часть платежей внесена датой платежа, а не датой операции в банке. */
  function matchLedger(ops, rows, contrOf) {
    var free = rows.map(function () { return true; }), idx = {}, matched = ops.map(function () { return -1; });
    rows.forEach(function (r, i) { var k = (r.debit ? "o" : "i") + (r.debit || r.credit); (idx[k] = idx[k] || []).push(i); });
    [{ tol: 0, contr: true }, { tol: 0, contr: false }, { tol: 7, contr: true }, { tol: 7, contr: false }].forEach(function (pass) {
      ops.forEach(function (op, oi) {
        if (matched[oi] >= 0) return;
        var cand = idx[(op.debit ? "o" : "i") + (op.debit || op.credit)] || [], best = null, want = contrOf(oi);
        cand.forEach(function (i) {
          if (!free[i]) return;
          var d = Math.abs(dayNum(rows[i].date) - dayNum(op.date));
          if (d > pass.tol) return;
          if (pass.contr && (!want || rows[i].contr !== normContr(want))) return;
          if (!best || d < best.d) best = { i: i, d: d };
        });
        if (best) { matched[oi] = best.i; free[best.i] = false; }
      });
    });
    return matched;
  }

  // ---------- вывод ----------
  /* rows: [{date, debit, credit, cat, contr, comm}], firstRow — номер строки листа для первой новой строки.
   * Столбец ОСТАТОК — формула «остаток предыдущей строки + приход − расход», как у вас в таблице. */
  function buildOutput(rows, firstRow) {
    var clean = function (s) { return String(s || "").replace(/[\t\r\n]+/g, " ").trim(); };
    var lines = rows.map(function (r, i) {
      var n = firstRow + i, p = n - 1;
      return [ruFromIso(r.date), "=B" + p + "+D" + p + "-C" + p, r.debit ? kopText(r.debit) : "", r.credit ? kopText(r.credit) : "",
              clean(r.cat), clean(r.contr), clean(r.comm)].join("\t");
    });
    return lines.join("\n");
  }

  root.Bank = {
    CATEGORIES: CATEGORIES, parseStatement: parseStatement, readLedger: readLedger, classify: classify,
    matchLedger: matchLedger, buildOutput: buildOutput, normKey: normKey, suggestPayee: suggestPayee,
    ruFromIso: ruFromIso, kopText: kopText, normContr: normContr, normCat: normCat, dayNum: dayNum
  };
})(window);
