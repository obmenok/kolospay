/* Казначей: приём наличных. Пишет в лист «Касса» Google-таблицы через тот же скрипт, что и выписка. */
(function () {
  "use strict";
  var SCRIPT_URL = window.KOLOS_SCRIPT_URL || "";
  if (!SCRIPT_URL) return;
  var B = window.Bank, $ = function (id) { return document.getElementById(id); };
  var CODE_KEY = "kolos-treasurer-code-v1", st = { led: null }, touched = {};

  function code() { try { return localStorage.getItem(CODE_KEY) || ""; } catch (e) { return ""; } }
  function remote(p) {
    p.code = code(); p.book = "cash";
    return fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify(p) }).then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || "Ошибка скрипта."); return j; }, function () { throw new Error("Нет связи с таблицей."); });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(k) { return (k / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽"; }
  function todayIso() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function cap(s) { s = String(s || "").trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function kopOf(v) { var n = parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? Math.round(n * 100) : 0; }

  $("cash").hidden = false;
  $("c-cat").innerHTML = '<option value="">— выберите —</option>' + B.CATEGORIES.map(function (c) { return "<option>" + c + "</option>"; }).join("");
  $("c-date").value = todayIso();

  function load() {
    if (!code()) { $("cash-info").textContent = "Введите код казначея выше, чтобы загрузить кассу."; return Promise.resolve(); }
    $("cash-info").textContent = "Загружаю кассу…";
    return remote({ action: "ledger" }).then(function (j) {
      st.led = j.ledger; var l = j.ledger, real = l.rows.filter(function (r) { return r.doc !== "Н-0000"; }), last = real.slice(-5).reverse();
      $("cash-info").innerHTML = "Остаток кассы: <b>" + (l.endBalance === null ? "—" : money(l.endBalance)) + "</b>, записей: " + (l.rows.length - 1 > 0 ? l.rows.length - 1 : 0) +
        (last.length ? "<br><span class='drop-hint'>Последние: " + last.map(function (r) {
          return B.ruFromIso(r.date) + " " + esc(r.contr || r.comm) + " " + (r.credit ? "+" + money(r.credit) : "−" + money(r.debit));
        }).join("; ") + "</span>" : "");
      refresh();
    }).catch(function (e) { st.led = null; $("cash-info").textContent = "✗ " + e.message; });
  }

  function state() {
    var dir = $("c-dir").value, plot = parseInt($("c-plot").value, 10) || 0, cat = $("c-cat").value;
    return { dir: dir, plot: plot, cat: cat, date: $("c-date").value, kop: kopOf($("c-sum").value),
             prev: $("c-prev").value.trim() === "" ? null : +$("c-prev").value, cur: $("c-cur").value.trim() === "" ? null : +$("c-cur").value };
  }

  function refresh() {
    var s = state(), inc = s.dir === "in";
    $("c-plot-l").hidden = !inc; $("c-contr-l").hidden = inc;
    var elec = inc && s.cat === "ЭЛЕКТРОЭНЕРГИЯ" && s.plot > 0;
    $("c-rd-box").hidden = !elec;
    $("c-period-l").hidden = !(inc && s.cat === "ЧЛЕНСКИЙ ВЗНОС");
    var contr = "УЧАСТОК № " + s.plot, known = st.led && st.led.readings && st.led.readings[contr];
    if (elec) {
      if (!touched.prev) $("c-prev").value = known ? known.cur : "";
      $("c-rd-hint").textContent = known ? "Последнее известное: " + known.cur + " от " + B.ruFromIso(known.date) : "Показаний по этому участку в таблице ещё нет.";
    }
    var warns = [], comm = "";
    if (inc && s.plot && s.kop && s.date && (s.cat === "ЭЛЕКТРОЭНЕРГИЯ" || s.cat === "ЧЛЕНСКИЙ ВЗНОС")) {
      var purpose = (s.cat === "ЭЛЕКТРОЭНЕРГИЯ" ? "электроэнергия" : "членский взнос") + ", участок " + s.plot +
        (elec && s.prev !== null && s.cur !== null ? ", Т1=" + s.prev + ", Т2=" + s.cur : "");
      var c = B.classifyAll([{ date: s.date, credit: s.kop, debit: 0, purpose: purpose, corr: "" }], {}, st.led && st.led.readings)[0];
      warns = c.warns || []; comm = c.comm || "";
    }
    $("c-warn").innerHTML = warns.map(function (w) { return '<div class="warnt">⚠ ' + esc(cap(w.text)) + "</div>"; }).join("");
    if (!touched.comm) $("c-comm").value = comm;
    $("c-add").disabled = !st.led;
    return warns;
  }

  ["c-dir", "c-date", "c-plot", "c-contr", "c-cat", "c-sum", "c-prev", "c-cur", "c-period"].forEach(function (id) {
    $(id).addEventListener("input", function () { if (id === "c-prev") touched.prev = true; if (id === "c-plot") touched.prev = false; refresh(); });
    $(id).addEventListener("change", refresh);
  });
  $("c-comm").addEventListener("input", function () { touched.comm = true; });

  $("c-add").addEventListener("click", function () {
    var s = state(), warns = refresh(), inc = s.dir === "in", contr = inc ? "УЧАСТОК № " + s.plot : $("c-contr").value.trim().toUpperCase();
    var msg = $("c-msg"); msg.textContent = "";
    if (!s.date) return (msg.textContent = "Укажите дату.");
    if (!s.kop) return (msg.textContent = "Укажите сумму.");
    if (!s.cat) return (msg.textContent = "Выберите назначение.");
    if (inc && !s.plot) return (msg.textContent = "Укажите номер участка.");
    if (inc && window.PLOTS && !window.PLOTS.some(function (p) { return p.number === s.plot; })) return (msg.textContent = "Такого участка нет в списке.");
    if (!inc && !contr) return (msg.textContent = "Укажите контрагента.");
    if (warns.length && !confirm("Есть предупреждения:\n" + warns.map(function (w) { return "• " + cap(w.text); }).join("\n") + "\n\nВсё равно внести?")) return;
    if (!confirm((inc ? "Принять " : "Выдать ") + money(s.kop) + " (" + contr + ", " + s.cat + ") от " + B.ruFromIso(s.date) + "?")) return;
    var comm = cap($("c-comm").value), per = inc && s.cat === "ЧЛЕНСКИЙ ВЗНОС" ? $("c-period").value : "", yr = parseInt(s.date.slice(0, 4), 10);
    // пометка периода нужна таблице: по ней «Участки» отделяют аванс и долг от взносов текущего года
    if (per === "adv" && comm.indexOf("Аванс за") < 0) comm = ("Аванс за " + (yr + 1) + (comm ? ". " + comm : ""));
    if (per === "debt" && comm.indexOf("За " + (yr - 1)) < 0) comm = ("За " + (yr - 1) + " год" + (comm ? ". " + comm : ""));
    var row = { date: s.date, debit: inc ? 0 : s.kop, credit: inc ? s.kop : 0, cat: s.cat, contr: contr, comm: comm };
    if (inc && s.cat === "ЭЛЕКТРОЭНЕРГИЯ" && s.prev !== null && s.cur !== null) row.rd = { plot: s.plot, prev: s.prev, cur: s.cur, status: warns.length ? "уточнить" : "ок" };
    $("c-add").disabled = true; msg.textContent = "Записываю…";
    remote({ action: "append", expectLastRow: st.led.lastRow, rows: [row] }).then(function (j) {
      msg.textContent = "✓ Внесено: " + (j.docs && j.docs[0] || "");
      touched = {}; $("c-sum").value = $("c-prev").value = $("c-cur").value = $("c-comm").value = ""; $("c-plot").value = ""; $("c-period").value = "";
      return load();
    }).catch(function (e) { msg.textContent = "✗ " + e.message; $("c-add").disabled = false; });
  });

  var save = $("code-save");
  if (save) save.addEventListener("click", function () { setTimeout(load, 50); });
  load();
})();
