/* Погода для шапки: Open-Meteo (без ключа, работает из браузера).
   Коды WMO переводятся в имена иконок OpenWeather, которые лежат в static/img/weather. */
(function (root) {
  "use strict";
  var LAT = 58.6035, LON = 49.668;           // Киров
  var URL = "https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON +
            "&current=temperature_2m,weather_code,is_day&timezone=auto";
  var CACHE_KEY = "kolos-weather", TTL_MS = 10 * 60 * 1000;

  function iconFor(wmo, isDay) {
    var d = isDay ? "d" : "n", base;
    if (wmo === 0) base = "01";
    else if (wmo === 1) base = "02";
    else if (wmo === 2) base = "03";
    else if (wmo === 3) base = "04";
    else if (wmo === 45 || wmo === 48) base = "50";
    else if (wmo >= 51 && wmo <= 57) base = "09";
    else if (wmo >= 61 && wmo <= 67) base = "10";
    else if (wmo >= 71 && wmo <= 77) base = "13";
    else if (wmo >= 80 && wmo <= 82) base = "09";
    else if (wmo === 85 || wmo === 86) base = "13";
    else if (wmo >= 95) base = "11";
    else base = "04";
    return base + d;
  }

  function parse(json) {
    var c = json && json.current;
    if (!c || typeof c.temperature_2m !== "number") return null;
    return { temperature: Math.round(c.temperature_2m), code: iconFor(c.weather_code, c.is_day === 1) };
  }

  function load() {
    try {
      var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached && Date.now() - cached.t < TTL_MS) return Promise.resolve(cached.w);
    } catch (e) {}
    return fetch(URL).then(function (r) { return r.json(); }).then(function (j) {
      var w = parse(j);
      if (w) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), w: w })); } catch (e) {} }
      return w;
    });
  }

  var api = { iconFor: iconFor, parse: parse, load: load };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Weather = api;
})(typeof window !== "undefined" ? window : globalThis);
