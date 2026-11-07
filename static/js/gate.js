/* Казначей: вход по коду и вкладки «Выписка банка» / «Наличные».
   Пока код не введён и не проверен, на странице виден только вход. */
(function () {
  "use strict";
  var SCRIPT_URL = window.KOLOS_SCRIPT_URL || "", CODE_KEY = "kolos-treasurer-code-v1", TAB_KEY = "kolos-treasurer-tab-v1";
  var $ = function (id) { return document.getElementById(id); }, body = document.body;
  function getCode() { try { return localStorage.getItem(CODE_KEY) || ""; } catch (e) { return ""; } }
  function clearCode() { try { localStorage.removeItem(CODE_KEY); } catch (e) {} }

  if (!SCRIPT_URL) { body.classList.remove("locked"); return; }   // без адреса скрипта страница работает как раньше

  // ---------- вкладки ----------
  function setTab(name) {
    body.classList.toggle("tab-bank", name === "bank");
    body.classList.toggle("tab-cash", name === "cash");
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === name); });
    try { localStorage.setItem(TAB_KEY, name); } catch (e) {}
  }
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
    b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
  });
  var saved = ""; try { saved = localStorage.getItem(TAB_KEY) || ""; } catch (e) {}
  setTab(saved === "cash" ? "cash" : "bank");

  // как только появляется список подтверждения или итог по выписке — показываем вкладку банка
  function showBank() { if (!body.classList.contains("tab-bank")) setTab("bank"); try { $("pane-bank").scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {} }
  $("f-stmt").addEventListener("change", function () { setTab("bank"); });
  ["summary", "review"].forEach(function (id) {
    new MutationObserver(function () { if (!$(id).hidden && !body.classList.contains("locked")) showBank(); }).observe($(id), { attributes: true, attributeFilter: ["hidden"] });
  });

  // ---------- вход ----------
  function check() {
    var code = getCode();
    if (!code) return Promise.resolve(false);
    return fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "ledger", code: code }) })
      .then(function (r) { return r.json(); }).then(function (j) { return !!j.ok; }, function () { return null; });
  }
  function lock(msg) {
    body.classList.add("locked"); $("code-box").hidden = false; $("tabs").hidden = true; $("logout").hidden = true;
    $("code-msg").textContent = msg || ""; try { $("code").focus(); } catch (e) {}
  }
  function unlock() {
    body.classList.remove("locked"); $("code-box").hidden = true; $("tabs").hidden = false; $("logout").hidden = false; $("code-msg").textContent = "";
    document.dispatchEvent(new Event("kolos-unlocked"));
  }
  function enter() {
    $("code-msg").textContent = "Проверяю…";
    check().then(function (ok) {
      if (ok) unlock();
      else if (ok === null) lock("Нет связи с таблицей. Проверьте интернет.");
      else { clearCode(); lock(getCode() ? "" : "Код не подошёл."); }
    });
  }
  $("code-save").addEventListener("click", function () { setTimeout(enter, 0); });   // код уже сохранил treasurer.js
  $("code").addEventListener("keydown", function (e) { if (e.key === "Enter") { $("code-save").click(); } });
  $("logout").addEventListener("click", function () { clearCode(); location.reload(); });

  $("code-box").hidden = false;
  if (getCode()) enter(); else lock("");
})();
