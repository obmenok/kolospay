/* Страница казначея: выписка банка + таблица учёта -> новые операции -> построчное подтверждение -> строки для таблицы.
 * Файлы читаются только в браузере. Логика разбора лежит в bank.js.
 */
(function () {
  "use strict";
  var B = window.Bank, XLSX = window.XLSX;
  var $ = function (id) { return document.getElementById(id); };
  var RULES_KEY = "kolos-treasurer-rules-v1";
  var state = { stmt: null, ledger: null, rows: [], filter: "all", rules: loadRules() };

  // ---------- мелочи ----------
  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function money(kop) {
    return (kop / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
  }
  function loadRules() { try { return JSON.parse(localStorage.getItem(RULES_KEY)) || {}; } catch (e) { return {}; } }
  function saveRules() { try { localStorage.setItem(RULES_KEY, JSON.stringify(state.rules)); } catch (e) {} }
  function readFile(file, as) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error("Не удалось прочитать файл.")); };
      if (as === "text") fr.readAsText(file, "utf-8"); else fr.readAsArrayBuffer(file);
    });
  }
  function setStatus(boxId, dropId, ok, text) {
    $(boxId).textContent = text;
    $(dropId).className = "drop " + (ok === null ? "" : ok ? "ok" : "bad");
  }
  function plural(n, a, b, c) {
    var m = n % 100, d = n % 10;
    return m >= 11 && m <= 14 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c;
  }

  // ---------- загрузка файлов ----------
  $("f-stmt").addEventListener("change", function (e) {
    var f = e.target.files[0]; if (!f) return;
    readFile(f, "text").then(function (text) {
      state.stmt = B.parseStatement(text);
      var s = state.stmt;
      setStatus("st-stmt", "drop-stmt", true, "✓ " + f.name + ": " + s.ops.length + " " + plural(s.ops.length, "операция", "операции", "операций") +
        ", " + B.ruFromIso(s.from) + " – " + B.ruFromIso(s.to));
    }).catch(function (err) {
      state.stmt = null; setStatus("st-stmt", "drop-stmt", false, "✗ " + err.message);
    }).then(analyze);
  });
  $("f-led").addEventListener("change", function (e) {
    var f = e.target.files[0]; if (!f) return;
    readFile(f, "buffer").then(function (buf) {
      state.ledger = B.readLedger(XLSX, buf);
      var l = state.ledger;
      setStatus("st-led", "drop-led", true, "✓ " + f.name + ": " + l.rows.length + " " + plural(l.rows.length, "строка", "строки", "строк") +
        ", последняя " + B.ruFromIso(l.lastDate));
    }).catch(function (err) {
      state.ledger = null; setStatus("st-led", "drop-led", false, "✗ " + (err && err.message || "Не удалось прочитать таблицу."));
    }).then(analyze);
  });
  ["drop-stmt", "drop-led"].forEach(function (id) {
    var d = $(id);
    d.addEventListener("dragenter", function () { d.classList.add("over"); });
    d.addEventListener("dragleave", function () { d.classList.remove("over"); });
    d.addEventListener("drop", function () { d.classList.remove("over"); });
  });

  // ---------- анализ ----------
  function analyze() {
    var st = state.stmt, led = state.ledger;
    $("summary").hidden = $("review").hidden = $("output").hidden = true;
    state.rows = [];
    if (!st || !led) return;

    var cl = st.ops.map(function (o) { return B.classify(o, state.rules); });
    var matched = B.matchLedger(st.ops, led.rows, function (i) { return cl[i].contr; });
    var used = {}; matched.forEach(function (m) { if (m >= 0) used[m] = 1; });
    var plots = {}; (window.PLOTS || []).forEach(function (p) { plots[p.number] = 1; });
    var lateLimit = B.dayNum(led.lastDate) - 7;

    st.ops.forEach(function (o, i) {
      if (matched[i] >= 0) return;
      var c = cl[i];
      state.rows.push({
        id: state.rows.length, doc: o.doc, date: o.date, debit: o.debit, credit: o.credit, corr: o.corr, purpose: o.purpose,
        cat: c.cat, contr: c.contr, comm: "", status: c.status, readings: c.readings, note: c.note,
        late: B.dayNum(o.date) < lateLimit, state: "pending"
      });
    });
    state.unmatchedLedger = led.rows.filter(function (r, i) { return !used[i]; });
    state.plots = plots;

    // подсказки для поля «Контрагент»
    var opts = {}; led.contrs.forEach(function (c) { opts[c] = 1; });
    (window.PLOTS || []).forEach(function (p) { opts["УЧАСТОК № " + p.number] = 1; });
    ["КОЛОС-1", "КОЛОС-3", "ЭНЕРГОСБЫТ ПЛЮС", "КДУ-3", "ИП СОБОЛЕВ", "ХЛЫНОВ", "ФНС"].forEach(function (c) { opts[c] = 1; });
    $("contrs").innerHTML = Object.keys(opts).map(function (c) { return '<option value="' + esc(c) + '">'; }).join("");

    renderSummary();
    $("summary").hidden = false;
    if (state.rows.length) { $("review").hidden = false; renderList(); }
    updateOutput();
  }

  function renderSummary() {
    var st = state.stmt, led = state.ledger, rows = state.rows, html = "";
    var inK = 0, outK = 0; rows.forEach(function (r) { inK += r.credit; outK += r.debit; });
    html += "<p>Выписка: <b>" + st.ops.length + "</b> " + plural(st.ops.length, "операция", "операции", "операций") + " за " + B.ruFromIso(st.from) + " – " + B.ruFromIso(st.to) +
      ". Остаток в банке на " + B.ruFromIso(st.closing.date) + ": <b>" + money(st.closing.kop) + "</b>.</p>";
    html += "<p>Таблица: <b>" + led.rows.length + "</b> " + plural(led.rows.length, "строка", "строки", "строк") + ", последняя от " + B.ruFromIso(led.lastDate) +
      " (строка №" + led.lastRow + ")" + (led.endBalance !== null ? ", остаток по таблице: <b>" + money(led.endBalance) + "</b>" : "") + ".</p>";
    if (!rows.length) html += '<p class="good"><b>Новых операций нет: таблица актуальна ✓</b></p>';
    else html += "<p><b>Новых операций: " + rows.length + "</b> (приход " + money(inK) + ", расход " + money(outK) + ").</p>";
    if (led.endBalance !== null) {
      var after = led.endBalance + inK - outK, diff = st.closing.kop - after;
      html += diff === 0
        ? '<p class="good">Остаток таблицы с новыми операциями (' + money(after) + ") совпадает с банком ✓</p>"
        : '<p class="badt">Остаток таблицы с новыми операциями (' + money(after) + ") не совпадает с банком (" + money(st.closing.kop) + "), разница " + money(diff) +
          ". Проверьте строки таблицы, которых нет в выписке, и возможные ручные правки.</p>";
    }
    var lost = state.unmatchedLedger;
    if (lost.length) {
      html += '<p class="warnt">В таблице есть ' + lost.length + " " + plural(lost.length, "строка", "строки", "строк") + ", которых не нашлось в выписке: " +
        lost.slice(0, 5).map(function (r) { return B.ruFromIso(r.date) + " " + money(r.credit || r.debit) + " " + esc(r.contr); }).join("; ") + (lost.length > 5 ? "…" : "") + "</p>";
    }
    var late = rows.filter(function (r) { return r.late; }).length;
    if (late) html += '<p class="warnt">' + late + " " + plural(late, "операция датирована", "операции датированы", "операций датировано") +
      " заметно раньше последней строки таблицы: они будут добавлены в конец, проверьте порядок.</p>";
    $("summary").innerHTML = html;
  }

  // ---------- список операций ----------
  function eligibleBulk() {
    return state.rows.filter(function (r) { return r.state === "pending" && r.status === "high" && r.cat && r.contr; });
  }
  function rowHtml(r) {
    var amount = r.credit ? '<span class="sum in">+' + money(r.credit) + "</span>" : '<span class="sum out">−' + money(r.debit) + "</span>";
    var chip = { high: "Уверенно", check: "Проверьте", none: "Нужно выбрать" }[r.status];
    var rd = "";
    if (r.readings) {
      rd = r.readings.kind === "t12"
        ? "показания: Т1 " + (r.readings.t1 === null ? "—" : r.readings.t1) + " · Т2 " + (r.readings.t2 === null ? "—" : r.readings.t2)
        : "показания: было " + r.readings.prev + " → стало " + r.readings.cur;
    }
    var catOpts = '<option value="">— выберите —</option>' + B.CATEGORIES.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === r.cat ? " selected" : "") + ">" + esc(c) + "</option>";
    }).join("");
    var notes = [];
    if (r.note) notes.push(r.note);
    var m = /^УЧАСТОК № (\d+)$/.exec(r.contr);
    if (m && state.plots && !state.plots[+m[1]]) notes.push("участка №" + m[1] + " нет в списке участков: проверьте номер");
    if (r.late) notes.push("дата заметно раньше последней строки таблицы");
    var actions;
    if (r.state === "ok") actions = '<span class="okmark">✓ Подтверждено</span><button type="button" class="btn" data-a="edit">Изменить</button>';
    else if (r.state === "skip") actions = '<span class="meta">Не вносить</span><button type="button" class="btn" data-a="edit">Вернуть</button>';
    else actions = '<button type="button" class="btn primary" data-a="ok">Подтвердить</button><button type="button" class="btn" data-a="skip">Не вносить</button>';
    var dis = r.state !== "pending" ? " disabled" : "";
    return '<article class="row s-' + r.state + " st-" + r.status + '" data-id="' + r.id + '">' +
      '<div class="head"><span class="date">' + B.ruFromIso(r.date) + "</span>" + amount + '<span class="chip ' + r.status + '">' + chip + "</span>" +
      (rd ? '<span class="meta">' + esc(rd) + "</span>" : "") + '<span class="meta">' + esc(r.doc) + "</span></div>" +
      '<div class="raw"><span class="lbl">Из выписки:</span> ' + esc(r.corr.split("//").slice(0, 2).join(" · ").trim() || "—") +
      '<br><span class="lbl">Назначение платежа:</span> ' + esc(r.purpose) + "</div>" +
      '<div class="clean">' +
      '<label>Назначение<select data-f="cat"' + dis + ">" + catOpts + "</select></label>" +
      '<label>Контрагент<input data-f="contr" list="contrs" value="' + esc(r.contr) + '"' + dis + "></label>" +
      '<label>Комментарий<input data-f="comm" value="' + esc(r.comm) + '"' + dis + "></label>" +
      '<div class="actions">' + actions + "</div></div>" +
      (notes.length ? '<div class="note">' + esc(notes.join("; ")) + "</div>" : "") + "</article>";
  }
  function visible(r) {
    if (state.filter === "pending") return r.state === "pending";
    if (state.filter === "check") return r.state === "pending" && r.status !== "high";
    return true;
  }
  function renderList() {
    $("list").innerHTML = state.rows.filter(visible).map(rowHtml).join("") ||
      '<p class="meta">В этом списке ничего нет.</p>';
    var n = eligibleBulk().length;
    $("bulk").textContent = "Подтвердить все уверенные (" + n + ")";
    $("bulk").disabled = n === 0;
  }
  function refreshRow(r) {
    var node = $("list").querySelector('[data-id="' + r.id + '"]');
    if (node) node.outerHTML = rowHtml(r);
    var n = eligibleBulk().length;
    $("bulk").textContent = "Подтвердить все уверенные (" + n + ")";
    $("bulk").disabled = n === 0;
    updateOutput();
  }

  $("bulk").addEventListener("click", function () {
    eligibleBulk().forEach(function (r) { r.state = "ok"; });
    renderList(); updateOutput();
  });
  document.querySelectorAll("[data-filter]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.filter = b.getAttribute("data-filter");
      document.querySelectorAll("[data-filter]").forEach(function (x) { x.classList.toggle("active", x === b); });
      renderList();
    });
  });
  $("list").addEventListener("input", function (e) {
    var f = e.target.getAttribute("data-f"); if (!f) return;
    var r = state.rows[+e.target.closest(".row").getAttribute("data-id")];
    r[f] = e.target.value;
    e.target.classList.remove("invalid");
    updateOutput();
  });
  $("list").addEventListener("click", function (e) {
    var a = e.target.getAttribute("data-a"); if (!a) return;
    var row = e.target.closest(".row"), r = state.rows[+row.getAttribute("data-id")];
    if (a === "ok") {
      var bad = false;
      if (!r.cat) { row.querySelector('[data-f="cat"]').classList.add("invalid"); bad = true; }
      if (!String(r.contr).trim()) { row.querySelector('[data-f="contr"]').classList.add("invalid"); bad = true; }
      if (bad) return;
      r.contr = B.normContr(r.contr); r.state = "ok";
    } else if (a === "skip") r.state = "skip";
    else if (a === "edit") r.state = "pending";
    refreshRow(r);
  });

  // ---------- итог: что внести ----------
  function okRows() { return state.rows.filter(function (r) { return r.state === "ok"; }); }
  function updateOutput() {
    var rows = state.rows, led = state.ledger, st = state.stmt;
    if (!rows.length || !led) { $("output").hidden = true; return; }
    var ok = okRows(), pending = rows.filter(function (r) { return r.state === "pending"; }).length, skip = rows.filter(function (r) { return r.state === "skip"; }).length;
    $("output").hidden = false;
    var msg = "Подтверждено <b>" + ok.length + "</b> из " + rows.length + (skip ? ", не вносить: " + skip : "") + (pending ? ", осталось проверить: <b>" + pending + "</b>" : "") + ".";
    var bal = led.endBalance, th = "<tr><th>ДАТА</th><th>ОСТАТОК</th><th>РАСХОД</th><th>ПРИХОД</th><th>НАЗНАЧЕНИЕ</th><th>КОНТРАГЕНТ</th><th>Комментарий</th></tr>", body = "";
    ok.forEach(function (r) {
      body += "<tr><td>" + B.ruFromIso(r.date) + '</td><td class="num">' + (bal === null ? "—" : money(bal)) + '</td><td class="num">' + (r.debit ? money(r.debit) : "") +
        '</td><td class="num">' + (r.credit ? money(r.credit) : "") + "</td><td>" + esc(r.cat) + "</td><td>" + esc(r.contr) + "</td><td>" + esc(r.comm) + "</td></tr>";
      if (bal !== null) bal += r.credit - r.debit;
    });
    $("out-table").innerHTML = th + body;
    if (bal !== null && !pending) {
      var diff = st.closing.kop - bal;
      msg += diff === 0 ? ' <span class="good">Остаток после внесения ' + money(bal) + " совпадает с банком ✓</span>"
        : ' <span class="warnt">Остаток после внесения ' + money(bal) + ", в банке " + money(st.closing.kop) + " (разница " + money(diff) + ").</span>";
    }
    $("out-status").innerHTML = msg;
    $("copy").disabled = $("download").disabled = ok.length === 0;
    $("out-help").innerHTML = "Вставьте скопированные строки в таблицу Google в ячейку <b>A" + (led.lastRow + 1) +
      "</b> (первая пустая строка после последней). Остаток в столбце ОСТАТОК посчитается формулой, как в остальных строках.";
  }

  function rememberRules() {
    okRows().forEach(function (r) {
      if (/^УЧАСТОК № \d+$/.test(r.contr)) return;
      var k = B.normKey(r.corr);
      if (k) state.rules[k] = { cat: r.cat, contr: r.contr };
    });
    saveRules(); updateRulesButton();
  }
  function flash(text) { $("out-msg").textContent = text; setTimeout(function () { $("out-msg").textContent = ""; }, 4000); }

  $("copy").addEventListener("click", function () {
    var rows = okRows(), tsv = B.buildOutput(rows, state.ledger.lastRow + 1);
    function done() { rememberRules(); flash("Скопировано строк: " + rows.length + ". Вставьте в таблицу."); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = tsv; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { flash("Не удалось скопировать: используйте «Скачать .xlsx»."); }
      document.body.removeChild(ta);
    }
  });

  $("download").addEventListener("click", function () {
    var rows = okRows(), led = state.ledger, ws = {};
    var put = function (r, c, cell) { ws[XLSX.utils.encode_cell({ r: r, c: c })] = cell; };
    ["ДАТА", "ОСТАТОК", "РАСХОД", "ПРИХОД", "НАЗНАЧЕНИЕ", "КОНТРАГЕНТ", "Комментарий"].forEach(function (h, c) { put(0, c, { t: "s", v: h }); });
    var bal = led.endBalance;
    rows.forEach(function (x, i) {
      var r = i + 1;
      put(r, 0, { t: "n", v: B.dayNum(x.date) + 25569, z: "dd.mm.yyyy" });
      if (bal !== null) put(r, 1, i === 0 ? { t: "n", v: bal / 100, z: "#,##0.00" } : { t: "n", f: "B" + r + "+D" + r + "-C" + r, v: bal / 100, z: "#,##0.00" });
      if (x.debit) put(r, 2, { t: "n", v: x.debit / 100, z: "#,##0.00" });
      if (x.credit) put(r, 3, { t: "n", v: x.credit / 100, z: "#,##0.00" });
      put(r, 4, { t: "s", v: x.cat }); put(r, 5, { t: "s", v: x.contr }); if (x.comm) put(r, 6, { t: "s", v: x.comm });
      if (bal !== null) bal += x.credit - x.debit;
    });
    ws["!ref"] = "A1:G" + (rows.length + 1);
    ws["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 20 }, { wch: 24 }];
    var wb = { SheetNames: ["Новые строки"], Sheets: { "Новые строки": ws } };
    var out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    var url = URL.createObjectURL(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    var a = document.createElement("a"); a.href = url; a.download = "kolos_novye_stroki_" + new Date().toISOString().slice(0, 10) + ".xlsx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    rememberRules(); flash("Файл скачан. Скопируйте строки из него в таблицу.");
  });

  function updateRulesButton() {
    var n = Object.keys(state.rules).length;
    $("reset-rules").textContent = n ? "Забыть запомненных получателей (" + n + ")" : "";
    $("reset-rules").hidden = !n;
  }
  $("reset-rules").addEventListener("click", function () {
    state.rules = {}; saveRules(); updateRulesButton(); analyze();
  });
  updateRulesButton();
})();
