# СНТ «Колос-1» — генератор QR-кодов (статическая версия)

Чистый HTML/CSS/JS, сервер не нужен. QR-коды и расчёты считаются в браузере, погода — из Open-Meteo.
Работает на любом статическом хостинге, в том числе на GitHub Pages.

## Публикация на GitHub Pages
1. Создайте репозиторий (например `kolospay`) и загрузите в его корень всё содержимое этой папки
   (включая файл `.nojekyll`).
2. Settings → Pages → Source: `Deploy from a branch`, ветка `main`, папка `/ (root)` → Save.
3. Через минуту сайт откроется по адресу `https://<ваш-логин>.github.io/kolospay/`.
   Все пути в проекте относительные, поэтому подкаталог `/kolospay/` не мешает.

### Свой домен позже
Settings → Pages → Custom domain: `kolospay.ru`; у регистратора — A-записи на IP GitHub Pages
(185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153; актуальные — в документации GitHub)
и CNAME `www` → `<логин>.github.io`. Затем включить Enforce HTTPS.

## Что где
- `index.html` — страница, текст «Общая информация» внутри неё.
- `static/js/payments.js` — расчёты и формат платёжной строки ST00012 (реквизиты и тарифы — в начале файла).
- `static/js/plots.js` — данные участков.
- `static/js/weather.js` — погода (координаты Кирова вверху файла).
- `static/js/app.js` — интерфейс, ссылки на Google-таблицу и карты Google/Яндекс.
- `static/scheme.html` — интерактивная векторная схема участков (SVG встроен между маркерами `SCHEME:BEGIN/END`).
- `static/css/scheme.css` — **все цвета схемы** и состояния участков; правятся без пересборки.
- `static/js/scheme.js` — масштаб, поиск, карточка участка и объект `Scheme` для будущих интерактивов (подсветка участков и т. п.).
- `tools/build_scheme.py` + `tools/source/scheme.pdf` — сборка SVG из PDF. Нужна только при изменении самого чертежа:
  `python tools/build_scheme.py tools/source/scheme.pdf static/scheme.html --plots static/js/plots.js`
  (нужны poppler-utils, `pip install shapely pillow`). Скрипт сам проверяет, что каждый номер попал ровно в один контур.
- `static/vendor/qrcode.js` — библиотека QR (qrcode-generator, MIT).
