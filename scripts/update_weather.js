// Запускается в GitHub Actions: берёт погоду у Open-Meteo и пишет weather.json рядом с сайтом.
// Использование: node scripts/update_weather.js <куда_писать>   (по умолчанию ./weather.json)
"use strict";
const fs = require("fs");
const path = require("path");
const Weather = require("../static/js/weather.js");

const LAT = 58.6035, LON = 49.668; // Киров
const URL = "https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON +
            "&current=temperature_2m,weather_code,is_day&timezone=auto";

async function build(fetchFn) {
  const res = await fetchFn(URL);
  if (!res.ok) throw new Error("Open-Meteo: HTTP " + res.status);
  const w = Weather.parse(await res.json());
  if (!w) throw new Error("Open-Meteo: неожиданный формат ответа");
  return { temperature: w.temperature, code: w.code, updated: new Date().toISOString() };
}

module.exports = { build };

if (require.main === module) {
  const out = path.resolve(process.argv[2] || "weather.json");
  build(fetch).then(function (data) {
    fs.writeFileSync(out, JSON.stringify(data) + "\n");
    console.log("weather.json:", JSON.stringify(data));
  }).catch(function (e) {
    // Сайт должен опубликоваться и без погоды: страница просто скроет блок.
    console.warn("Погоду получить не удалось:", e.message);
  });
}
