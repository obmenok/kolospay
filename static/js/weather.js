/* Погода для шапки. Данные раз в 30 минут кладёт в weather.json задача GitHub Actions
   (scripts/update_weather.js), поэтому браузер посетителя ходит только на свой домен.
   Коды WMO переводятся в имена иконок OpenWeather из static/img/weather. */
(function (root) {
  "use strict";
  var MAX_AGE_MS = 3 * 60 * 60 * 1000; // старше 3 часов — не показываем

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

  /* ответ Open-Meteo -> {temperature, code} */
  function parse(json) {
    var c = json && json.current;
    if (!c || typeof c.temperature_2m !== "number") return null;
    return { temperature: Math.round(c.temperature_2m), code: iconFor(c.weather_code, c.is_day === 1) };
  }

  /* содержимое weather.json -> {temperature, code} или null, если данные устарели/некорректны */
  function fresh(data, now) {
    if (!data || typeof data.temperature !== "number" || !data.code || !data.updated) return null;
    var age = (now || Date.now()) - Date.parse(data.updated);
    if (!(age >= -5 * 60 * 1000 && age <= MAX_AGE_MS)) return null;
    return { temperature: data.temperature, code: data.code };
  }

  function load() {
    return fetch("weather.json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (j) { return fresh(j); });
  }

  var api = { iconFor: iconFor, parse: parse, fresh: fresh, load: load };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Weather = api;
})(typeof window !== "undefined" ? window : globalThis);
