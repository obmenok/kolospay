/* Схема участков: масштаб, перетаскивание, выбор участка, поиск.
 *
 * Данные участков берутся из plots.js (window.PLOTS), геометрия лежит в scheme.html.
 *
 * Для будущих интерактивов (подсветка должников и т. п.) снаружи доступен объект Scheme:
 *   Scheme.mark(59, "debtor")        добавить участку CSS-класс
 *   Scheme.mark([59, 60], "debtor")  то же для нескольких участков
 *   Scheme.unmark(59, "debtor")      убрать класс у участка
 *   Scheme.clear("debtor")           убрать класс у всех участков
 *   Scheme.plot(59)                  SVG-элемент участка (или null)
 *   Scheme.numbers()                 номера всех участков схемы
 *   Scheme.select(59)                приблизить участок и показать его карточку
 *   Scheme.tipExtra = function (n, plot) { return "<div class='row'>…</div>"; }
 *                                    дополнительные строки в карточке участка (HTML)
 *   Scheme.onSelect = function (n, el) { … }
 * Цвета состояний задаются в css/scheme.css.
 * Страница открыта во фрейме того же сайта, поэтому из родительской страницы доступно
 * как frame.contentWindow.Scheme.
 */
(function () {
  "use strict";

  var view = document.getElementById("view");
  var svg = document.getElementById("scheme");
  var tip = document.getElementById("tip");
  if (!svg) return;

  var PLOTS = {};
  (window.PLOTS || []).forEach(function (p) { PLOTS[p.number] = p; });

  var vbAttr = svg.getAttribute("viewBox").split(" ");
  var W = parseFloat(vbAttr[2]), H = parseFloat(vbAttr[3]);
  var MIN_W = 40;                       // максимальное приближение: ширина кадра в единицах схемы
  var vb = { x: 0, y: 0, w: W, h: H };

  var byNumber = {};
  Array.prototype.forEach.call(svg.querySelectorAll(".plot"), function (el) {
    byNumber[el.getAttribute("data-n")] = el;
  });

  // ---------- масштаб и положение ----------
  function apply() {
    svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
  }
  function rect() { return view.getBoundingClientRect(); }

  function fit() {
    var r = rect();
    if (!r.width || !r.height) return;
    var k = Math.min(r.width / W, r.height / H);
    vb.w = r.width / k;
    vb.h = r.height / k;
    vb.x = (W - vb.w) / 2;
    vb.y = (H - vb.h) / 2;
    apply();
  }
  function clamp() {
    var r = rect();
    vb.w = Math.min(Math.max(vb.w, MIN_W), W * 1.3);
    vb.h = vb.w * r.height / r.width;
  }
  function zoomAt(px, py, factor) {       // точка (px, py) экрана остаётся на месте
    var r = rect();
    var sx = vb.x + px / r.width * vb.w, sy = vb.y + py / r.height * vb.h;
    vb.w *= factor;
    clamp();
    vb.x = sx - px / r.width * vb.w;
    vb.y = sy - py / r.height * vb.h;
    apply();
  }

  // ---------- перетаскивание, щипок, клик ----------
  var ptrs = {}, start = null, moved = 0;

  view.addEventListener("pointerdown", function (e) {
    ptrs[e.pointerId] = e;
    start = { x: e.clientX, y: e.clientY };
    moved = 0;
    try { view.setPointerCapture(e.pointerId); } catch (err) {}
  });
  view.addEventListener("pointermove", function (e) {
    var p = ptrs[e.pointerId];
    if (!p) return;
    var r = rect(), ids = Object.keys(ptrs);
    if (ids.length === 1) {
      vb.x -= (e.clientX - p.clientX) / r.width * vb.w;
      vb.y -= (e.clientY - p.clientY) / r.height * vb.h;
      apply();
      if (start) moved = Math.max(moved, Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y));
    } else if (ids.length === 2) {
      var o = ptrs[ids.filter(function (i) { return +i !== e.pointerId; })[0]];
      var d0 = Math.hypot(p.clientX - o.clientX, p.clientY - o.clientY);
      var d1 = Math.hypot(e.clientX - o.clientX, e.clientY - o.clientY);
      if (d0 > 0 && d1 > 0) {
        zoomAt((e.clientX + o.clientX) / 2 - r.left, (e.clientY + o.clientY) / 2 - r.top, d0 / d1);
      }
      moved = 999;
    }
    ptrs[e.pointerId] = e;
  });
  view.addEventListener("pointerup", function (e) {
    var wasClick = moved < 6 && Object.keys(ptrs).length === 1;
    delete ptrs[e.pointerId];
    if (wasClick) pick(e);
  });
  view.addEventListener("pointercancel", function (e) { delete ptrs[e.pointerId]; });
  view.addEventListener("wheel", function (e) {
    e.preventDefault();
    var r = rect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY > 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  function zoomCenter(f) { var r = rect(); zoomAt(r.width / 2, r.height / 2, f); }
  document.getElementById("zin").onclick = function () { zoomCenter(1 / 1.5); };
  document.getElementById("zout").onclick = function () { zoomCenter(1.5); };

  // ---------- карточка участка ----------
  var selected = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function row(label, value) {
    return '<div class="row"><span class="label">' + esc(label) + '</span><span class="value">' + esc(value) + "</span></div>";
  }

  function show(el, x, y) {
    if (selected) selected.classList.remove("sel");
    selected = el;
    if (!el) { tip.style.display = "none"; return; }
    el.classList.add("sel");
    var n = el.getAttribute("data-n"), p = PLOTS[n];
    var html = '<div class="head">Участок №' + esc(n) + "</div>" +
      row("Кадастровый №:", p ? p.cadastral : "—") +
      row("Площадь:", p ? p.area + " м²" : "—");
    if (typeof api.tipExtra === "function") {
      try { html += api.tipExtra(n, p) || ""; } catch (err) {}
    }
    tip.innerHTML = html;
    tip.style.display = "block";
    var r = rect();
    tip.style.left = Math.max(8, Math.min(x, r.width - tip.offsetWidth - 8)) + "px";
    tip.style.top = Math.max(8, Math.min(y + 14, r.height - tip.offsetHeight - 8)) + "px";
    if (typeof api.onSelect === "function") { try { api.onSelect(n, el); } catch (err) {} }
  }

  function pick(e) {
    // под захваченным указателем e.target — это #view, поэтому ищем элемент по координатам
    var t = document.elementFromPoint(e.clientX, e.clientY);
    var el = t && t.closest ? t.closest(".plot") : null;
    var r = rect();
    show(el, e.clientX - r.left, e.clientY - r.top);
  }

  // ---------- поиск ----------
  function select(n) {
    var el = byNumber[String(n).trim()];
    if (!el) return false;
    var b = el.getBBox(), r = rect();
    vb.w = Math.max(MIN_W, b.width * 5);
    vb.h = vb.w * r.height / r.width;
    vb.x = b.x + b.width / 2 - vb.w / 2;
    vb.y = b.y + b.height / 2 - vb.h / 2;
    clamp();
    apply();
    show(el, r.width / 2, r.height / 2 - 60);
    return true;
  }
  function find() {
    var q = document.getElementById("q").value.trim();
    if (!q) return;
    if (!select(q)) alert("Участок №" + q + " не найден!");
  }
  document.getElementById("go").onclick = find;
  document.getElementById("q").onkeydown = function (e) { if (e.key === "Enter") find(); };

  // ---------- интерфейс для будущих интерактивов ----------
  function each(numbers, fn) {
    [].concat(numbers).forEach(function (n) {
      var el = byNumber[String(n).trim()];
      if (el) fn(el);
    });
  }
  var api = window.Scheme = {
    plot: function (n) { return byNumber[String(n).trim()] || null; },
    numbers: function () { return Object.keys(byNumber); },
    mark: function (numbers, cls) { each(numbers, function (el) { el.classList.add(cls); }); },
    unmark: function (numbers, cls) { each(numbers, function (el) { el.classList.remove(cls); }); },
    clear: function (cls) {
      Array.prototype.forEach.call(svg.querySelectorAll(".plot." + cls), function (el) { el.classList.remove(cls); });
    },
    select: select,
    tipExtra: null,
    onSelect: null
  };

  window.addEventListener("resize", fit);
  fit();
})();
