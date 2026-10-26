/* Погода для шапки: OpenWeatherMap напрямую из браузера (как и раньше на сервере — тот же сервис).
   Ответ кэшируется в localStorage на 10 минут, поэтому на посетителя уходит не больше одного
   запроса в 10 минут. Если сервис недоступен, показываем последнее значение не старше 3 часов,
   а иначе блок погоды скрывается.

   ВАЖНО: ключ ниже виден всем посетителям (репозиторий публичный). Заведите отдельный
   бесплатный ключ только для сайта на https://home.openweathermap.org/api_keys */
(function (root) {
  "use strict";
  var API_KEY = "390c8911b10d0176aeceb068d00b6940";
  var LAT = 58.6035, LON = 49.668;        // Киров
  var CACHE_KEY = "kolos-weather-v2";
  var TTL_MS = 10 * 60 * 1000;            // обновляем не чаще раза в 10 минут
  var MAX_STALE_MS = 3 * 60 * 60 * 1000;  // при сбое показываем старое значение не дольше 3 часов
  var TIMEOUT_MS = 5000;

  function url() {
    return "https://api.openweathermap.org/data/2.5/weather?lat=" + LAT + "&lon=" + LON +
           "&units=metric&lang=ru&appid=" + encodeURIComponent(API_KEY);
  }

  /* ответ OpenWeatherMap -> {temperature, code}; code — имя иконки (01d, 10n …) из static/img/weather */
  function parse(json) {
    if (!json || !json.main || typeof json.main.temp !== "number") return null;
    var w = json.weather && json.weather[0];
    if (!w || !/^\d{2}[dn]$/.test(w.icon || "")) return null;
    return { temperature: Math.round(json.main.temp), code: w.icon };
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) { return null; }
  }
  function writeCache(w, now) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: now, w: w })); } catch (e) {}
  }

  function request() {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    return fetch(url(), ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(parse).catch(function () { return null; }).then(function (w) {
      if (timer) clearTimeout(timer);
      return w;
    });
  }

  function load() {
    var now = Date.now();
    var cached = readCache();
    if (cached && cached.w && now - cached.t >= 0 && now - cached.t < TTL_MS) return Promise.resolve(cached.w);
    if (!API_KEY || API_KEY.indexOf("ВСТАВЬТЕ") === 0) return Promise.resolve(null); // ключ не задан
    return request().then(function (w) {
      if (w) { writeCache(w, now); return w; }
      if (cached && cached.w && now - cached.t >= 0 && now - cached.t < MAX_STALE_MS) return cached.w;
      return null;
    });
  }

  var api = { parse: parse, load: load };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Weather = api;
})(typeof window !== "undefined" ? window : globalThis);
