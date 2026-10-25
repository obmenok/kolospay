(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var cfg = {
    financeUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRkCRrOHBX2PvV2eAFaCvhRVxOJb7wPS50hK6XIDBlux0_NDQTrmzI4Z22r5yKpMncHvRF9qipVDnAe/pubhtml?gid=742271121&single=true&widget=true&headers=false",
    googleMapUrl: "https://www.google.com/maps/d/embed?mid=1Va23cJVcImyNFZfrASGqnYF-aqVdHzQ&ehbc=2E312F&noprof=1",
    yandexMapUrl: "https://yandex.ru/map-widget/v1/?um=constructor%3A8c78e07a751d5a9e657860e397d28e92a92ff8ebc0fb8a8ba7be72ea7417b931&source=constructor"
  };
  var P = window.Payments;
  var PLOTS = {};
  window.PLOTS.forEach(function (p) { PLOTS[p.number] = p; });

  // QR: байтовый режим, UTF-8 без ECI, уровень коррекции L, модуль 4 px, рамка 2 модуля — как в серверной версии
  function qrDataUri(text) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    var qr = qrcode(0, "L");
    qr.addData(text, "Byte");
    qr.make();
    var n = qr.getModuleCount(), cell = 4, border = 2, size = (n + 2 * border) * cell;
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, size, size);
    g.fillStyle = "#000";
    for (var y = 0; y < n; y++)
      for (var x = 0; x < n; x++)
        if (qr.isDark(y, x)) g.fillRect((x + border) * cell, (y + border) * cell, cell, cell);
    return c.toDataURL("image/png");
  }

  var el = {
    section: $("section"), plot: $("plot"),
    t1: $("t1"), t2: $("t2"), amount: $("amount"),
    inEl: $("inputs-electricity"), inArr: $("inputs-arrears"),
    text: $("result-text"), qr: $("qr"), plan: $("plan"),
    viewPlot: $("view-plot"), viewFinance: $("view-finance"),
    viewMap: $("view-map"), viewAbout: $("view-about")
  };

  var PAYMENT_SECTIONS = { fee: 1, electricity: 1, arrears: 1 };
  var timer = null;

  // ---------- вспомогательное ----------
  function clearResult() {
    el.text.textContent = "";
    el.text.classList.remove("error");
    el.qr.hidden = true; el.qr.removeAttribute("src");
    el.plan.hidden = true; el.plan.removeAttribute("src");
  }
  function showError(msg) {
    clearResult();
    el.text.textContent = msg;
    el.text.classList.add("error");
  }
  function addIframe(container, src) {
    if (container.firstChild) return; // создаём один раз, как в оригинале
    var f = document.createElement("iframe");
    f.src = src; f.loading = "lazy"; f.setAttribute("frameborder", "0");
    container.appendChild(f);
  }

  // ---------- расчёт по выбранному участку ----------
  function refresh() {
    var kind = el.section.value;
    var plot = el.plot.value;
    if (!plot) { clearResult(); return; }

    clearResult();
    var p = PLOTS[plot];
    try {
      if (kind === "info") {
        el.text.textContent = P.plotInfoLines(p).join("\n");
        el.plan.src = "static/img/plots/" + p.image; el.plan.hidden = false;
        return;
      }
      var opts = {};
      if (kind === "electricity") {
        if (el.t1.value === "" || el.t2.value === "") { showError("Введите показания"); return; }
        opts.t1 = el.t1.value; opts.t2 = el.t2.value;
      } else if (kind === "arrears") {
        if (el.amount.value === "") { showError("Введите сумму"); return; }
        opts.amount = el.amount.value;
      }
      var pay = P.buildPayment(kind, p, opts);
      el.text.textContent = pay.lines.join("\n");
      el.qr.src = qrDataUri(pay.payload); el.qr.hidden = false;
    } catch (e) {
      if (e instanceof P.PaymentError) showError(e.message);
      else { showError("Не удалось сформировать QR-код"); if (window.console) console.error(e); }
    }
  }
  function refreshDebounced() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 250);
  }

  // ---------- переключение разделов ----------
  function resetForm() {
    el.t1.value = ""; el.t2.value = ""; el.amount.value = "";
    el.plot.value = "";
    clearResult();
  }
  function onSection() {
    var s = el.section.value;
    resetForm();
    el.viewPlot.hidden = !(s in PAYMENT_SECTIONS || s === "info");
    el.viewFinance.hidden = s !== "finance";
    el.viewMap.hidden = s !== "map";
    el.viewAbout.hidden = s !== "about";
    el.inEl.hidden = s !== "electricity";
    el.inArr.hidden = s !== "arrears";

    if (s === "finance") addIframe(el.viewFinance, cfg.financeUrl);
    if (s === "map") showMapTab(currentMapTab);
    try { history.replaceState(null, "", "#" + s); } catch (e) {}
  }

  // ---------- вкладки «Схема / Google / Яндекс» ----------
  var currentMapTab = "scheme";
  function showMapTab(name) {
    currentMapTab = name;
    ["scheme", "google", "yandex"].forEach(function (n) { $("map-" + n).hidden = n !== name; });
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-map") === name);
    });
    var src = { scheme: "static/map.html", google: cfg.googleMapUrl, yandex: cfg.yandexMapUrl }[name];
    addIframe($("map-" + name), src);
  }

  // ---------- погода ----------
  function loadWeather() {
    if (!window.Weather) return;
    Weather.load().then(function (w) {
      if (!w) return;
      $("weather-temp").textContent = w.temperature + " °C";
      var icon = $("weather-icon");
      icon.src = "static/img/weather/" + encodeURIComponent(w.code) + ".png";
      icon.alt = "Погода";
      $("weather").hidden = false;
    }).catch(function () {});
  }

  // ---------- события ----------
  el.section.addEventListener("change", onSection);
  el.plot.addEventListener("change", refresh);
  [el.t1, el.t2, el.amount].forEach(function (i) {
    i.addEventListener("input", function () { if (el.plot.value) refreshDebounced(); });
  });
  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () { showMapTab(b.getAttribute("data-map")); });
  });

  // открытие по ссылке вида /#electricity
  var hash = (location.hash || "").slice(1);
  if (hash && Array.prototype.some.call(el.section.options, function (o) { return o.value === hash; })) {
    el.section.value = hash;
  }
  onSection();
  loadWeather();
})();
