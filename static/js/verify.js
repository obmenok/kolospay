/* Казначей: проверка счётчика по фото. Фото сжимается в браузере и отправляется в скрипт таблицы. */
(function () {
  "use strict";
  var SCRIPT_URL = window.KOLOS_SCRIPT_URL || "";
  if (!SCRIPT_URL) return;
  var $ = function (id) { return document.getElementById(id); }, CODE_KEY = "kolos-treasurer-code-v1";
  function code() { try { return localStorage.getItem(CODE_KEY) || ""; } catch (e) { return ""; } }
  function todayIso() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  $("v-date").value = todayIso();

  // уменьшаем фото до 1600 px по длинной стороне, JPEG ~70%
  function shrink(file) {
    return new Promise(function (ok, fail) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL("image/jpeg", 0.7).split(",")[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); fail(new Error("Не удалось прочитать фото.")); };
      img.src = url;
    });
  }
  function send(payload) {
    payload.code = code();
    return fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) }).then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || "Ошибка скрипта."); return j; }, function () { throw new Error("Нет связи с таблицей."); });
  }
  $("v-send").addEventListener("click", function () {
    var plot = parseInt($("v-plot").value, 10), reading = parseInt(String($("v-read").value).replace(/\s/g, ""), 10), date = $("v-date").value, f = $("v-file").files[0];
    if (!(plot > 0) || !(reading >= 0) || !date) { $("v-msg").textContent = "✗ Укажите участок, дату и показание."; return; }
    if (!f && !confirm("Фото не выбрано. Записать проверку без фото?")) return;
    var btn = $("v-send"); btn.disabled = true; $("v-msg").textContent = "Отправляю…";
    (f ? shrink(f) : Promise.resolve("")).then(function (b64) {
      return send({ action: "verifyReading", plot: plot, reading: reading, date: date, comm: $("v-comm").value.trim(), photo: b64 ? { data: b64, mime: "image/jpeg" } : null });
    }).then(function (j) {
      $("v-msg").textContent = "✓ Записано: " + j.result + (j.photo ? "" : " (без фото)");
      $("v-plot").value = ""; $("v-read").value = ""; $("v-comm").value = ""; $("v-file").value = "";
    }).catch(function (e) { $("v-msg").textContent = "✗ " + e.message; }).then(function () { btn.disabled = false; });
  });
})();
