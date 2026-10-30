#!/usr/bin/env python3
"""Сборка векторной схемы участков из PDF (КОМПАС-3D) в SVG, встроенный в static/scheme.html.

Использование:
    python tools/build_scheme.py схема.pdf static/scheme.html [--plots static/js/plots.js]

Что делает:
  1. Из PDF берёт ГЕОМЕТРИЮ: линии чертежа, текст (как контуры букв) и номера участков.
  2. Из линий строит замкнутые контуры и сопоставляет каждый номер участка с контуром,
     в который попала подпись.
  3. Цвет контура определяется по растеру PDF и превращается в CSS-класс (см. COLOR_CLASSES).
     Сами цвета в SVG НЕ записываются: они задаются в static/css/scheme.css.
  4. Результат вставляется в scheme.html между маркерами <!--SCHEME:BEGIN--> и <!--SCHEME:END-->.

Скрипт завершается с ошибкой (код 1), если проверки не прошли: подпись вне контура,
два номера в одном контуре, неизвестный цвет заливки. Тихих «почти получилось» нет.

Нужно: poppler-utils (pdftocairo, pdftotext), python-пакеты shapely и pillow.
"""
import argparse
import collections
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image
from shapely.geometry import LineString, Point
from shapely.ops import nearest_points, polygonize, unary_union
from shapely.strtree import STRtree

# ---------------------------------------------------------------------------
# Цвет заливки -> CSS-класс.
# Ключи — цвета так, как их видит скрипт при отрисовке PDF (они темнее, чем на сайте:
# это служебные значения для опознания области, а не цвета схемы!).
# Реальные цвета схемы задаются в static/css/scheme.css.
# ---------------------------------------------------------------------------
PLOT_CLASSES = {          # контуры, в которые попала подпись-номер
    "#bfb8b2": "plot",
    "#bfb2b2": "plot plot-pink",
}
AREA_CLASSES = {          # остальные области
    "#b8bfb2": "a-green",
    "#9db286": "a-park",
    "#8ca5bf": "a-water",
    "#bf9f7f": "a-orange",
}
COLOR_TOLERANCE = 4       # допуск по каждому каналу, 0..255

SNAP = 0.6                # pt: на столько «дотягиваем» оборванные концы линий до соседних
MIN_FACE_AREA = 20.0      # pt²: меньшие замкнутые области считаем мусором
DOT_LEN = 0.4             # pt: одиночные отрезки короче этого — случайные «точки»
RASTER_DPI = 288          # 4 пикселя на pt


def run(*cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def fail(msg):
    print("ОШИБКА: " + msg, file=sys.stderr)
    sys.exit(1)


def f2(v):
    return ("%.2f" % v).rstrip("0").rstrip(".")


def hexc(c):
    return "#%02x%02x%02x" % c


def classify(color, table):
    """Ближайший по цвету класс из таблицы (не дальше COLOR_TOLERANCE по каждому каналу)."""
    best = None
    for h, cls in table.items():
        ref = tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
        d = max(abs(a - b) for a, b in zip(color, ref))
        if d <= COLOR_TOLERANCE and (best is None or d < best[0]):
            best = (d, cls)
    return best[1] if best else None


# ---------------------------------------------------------------------------
# 1. Чтение PDF
# ---------------------------------------------------------------------------
def read_segments(svg_text):
    body = svg_text[svg_text.index("</defs>"):]
    segs = []
    for a in re.findall(r"<path ([^>]*?)/>", body):
        if 'stroke="rgb(0%, 0%, 0%)"' not in a:
            continue
        d = re.search(r' d="([^"]*)"', a) or re.search(r'^d="([^"]*)"', a)
        m = re.search(r"matrix\(([^)]*)\)", a)
        if not d or not m:
            continue
        nums = [float(x) for x in re.findall(r"-?\d+\.?\d*", d.group(1))]
        k = [float(x) for x in m.group(1).split(",")]
        pts = [(k[0] * nums[i] + k[4], k[3] * nums[i + 1] + k[5])
               for i in range(0, len(nums) - 1, 2)][:2]
        if len(pts) == 2 and pts[0] != pts[1]:
            segs.append(LineString(pts))
    return segs


def read_numbers(bbox_html):
    words = re.findall(
        r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', bbox_html)
    return [(float(a), float(b), float(c), float(d), t)
            for a, b, c, d, t in words if re.fullmatch(r"\d{1,3}", t)]


def read_text_glyphs(svg_text):
    i = svg_text.index("</defs>")
    defs, body = svg_text[:i], svg_text[i:]
    uses = re.findall(r'<use xlink:href="#(glyph-\d+-\d+)" x="([\d.]+)" y="([\d.]+)"/>', body)
    used = {n for n, _, _ in uses}
    glyphs = re.findall(r'<g id="(glyph-\d+-\d+)">\s*<path d="([^"]*)"/>\s*</g>', defs)
    gdefs = "".join('<path id="%s" d="%s"/>' % (n, re.sub(r"\s+", " ", d).strip())
                    for n, d in glyphs if n in used)
    guses = "".join('<use href="#%s" x="%s" y="%s"/>' % (n, f2(float(x)), f2(float(y)))
                    for n, x, y in uses)
    return gdefs, guses, len(used)


# ---------------------------------------------------------------------------
# 2. Контуры
# ---------------------------------------------------------------------------
def drop_dots(segs):
    """Одиночные очень короткие отрезки, не связанные с другими линиями, — «точки-мусор»."""
    r = lambda p: (round(p[0], 1), round(p[1], 1))
    deg = collections.Counter()
    for g in segs:
        a, b = map(r, g.coords)
        deg[a] += 1
        deg[b] += 1
    keep, dots = [], 0
    for g in segs:
        a, b = map(r, g.coords)
        if g.length < DOT_LEN and deg[a] == 1 and deg[b] == 1:
            dots += 1
        else:
            keep.append(g)
    return keep, dots


def build_faces(segs):
    r = lambda p: (round(p[0], 1), round(p[1], 1))
    deg = collections.Counter()
    for g in segs:
        a, b = map(r, g.coords)
        deg[a] += 1
        deg[b] += 1
    tree = STRtree(segs)
    extra = []
    for g in segs:
        for p in g.coords:
            if deg[r(p)] != 1:
                continue
            pt = Point(p)
            best = None
            for i in tree.query(pt.buffer(SNAP + 0.1)):
                if segs[i] is g:
                    continue
                d = segs[i].distance(pt)
                if best is None or d < best[0]:
                    best = (d, i)
            if best and best[0] <= SNAP:
                q = nearest_points(segs[best[1]], pt)[0]
                if q.distance(pt) > 1e-9:
                    extra.append(LineString([p, (q.x, q.y)]))
    faces = [f for f in polygonize(unary_union(segs + extra)) if f.area > MIN_FACE_AREA]
    return faces


def match_labels(faces, nums):
    per = collections.defaultdict(list)
    orphans = []
    for x0, y0, x1, y1, t in nums:
        c = Point((x0 + x1) / 2, (y0 + y1) / 2)
        for i, f in enumerate(faces):
            if f.contains(c):
                per[i].append(t)
                break
        else:
            orphans.append(t)
    return per, orphans


def sample_color(face, png, k):
    import random
    rnd = random.Random(1)
    pts = [face.representative_point()]
    minx, miny, maxx, maxy = face.bounds
    for _ in range(40):
        p = Point(rnd.uniform(minx, maxx), rnd.uniform(miny, maxy))
        if face.contains(p) and face.exterior.distance(p) > 1.5:
            pts.append(p)
    w, h = png.size
    cols = [png.getpixel((min(w - 1, int(p.x * k)), min(h - 1, int(p.y * k)))) for p in pts]
    return collections.Counter(cols).most_common(1)[0][0]


def path_d(face):
    return "M" + "L".join("%s %s" % (f2(x), f2(y)) for x, y in list(face.exterior.coords)[:-1]) + "Z"


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("html", help="scheme.html с маркерами <!--SCHEME:BEGIN--> / <!--SCHEME:END-->")
    ap.add_argument("--plots", help="plots.js: сверить номера участков со схемой")
    args = ap.parse_args()

    pdf, html_path = Path(args.pdf), Path(args.html)
    if not pdf.exists():
        fail("нет файла " + str(pdf))
    html = html_path.read_text(encoding="utf-8")
    if "<!--SCHEME:BEGIN-->" not in html or "<!--SCHEME:END-->" not in html:
        fail("в %s нет маркеров <!--SCHEME:BEGIN--> и <!--SCHEME:END-->" % html_path)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        try:
            run("pdftocairo", "-svg", str(pdf), str(tmp / "s.svg"))
            run("pdftotext", "-bbox", str(pdf), str(tmp / "b.html"))
            run("pdftocairo", "-png", "-r", str(RASTER_DPI), "-singlefile", str(pdf), str(tmp / "r"))
        except (OSError, subprocess.CalledProcessError) as e:
            fail("не удалось запустить poppler (pdftocairo/pdftotext): %s" % e)
        svg_text = (tmp / "s.svg").read_text(encoding="utf-8")
        bbox_html = (tmp / "b.html").read_text(encoding="utf-8")
        png = Image.open(tmp / "r.png").convert("RGB")
        png.load()

    vb = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg_text)
    if not vb:
        fail("не найден viewBox в SVG из PDF")
    W, H = vb.group(1), vb.group(2)
    k = RASTER_DPI / 72.0
    if abs(png.size[0] - float(W) * k) > 2 or abs(png.size[1] - float(H) * k) > 2:
        fail("размер растра %s не соответствует странице %sx%s pt" % (png.size, W, H))

    segs = read_segments(svg_text)
    segs, dots = drop_dots(segs)
    nums = read_numbers(bbox_html)
    faces = build_faces(segs)
    per, orphans = match_labels(faces, nums)

    # ---- проверки ----
    problems = []
    if orphans:
        problems.append("подписи вне замкнутых контуров (разорван чертёж?): " + ", ".join(sorted(set(orphans), key=int)))
    multi = {i: v for i, v in per.items() if len(v) > 1}
    for i, v in multi.items():
        problems.append("в одном контуре несколько номеров: %s (площадь %.0f pt²)" % (", ".join(v), faces[i].area))
    lab = {}
    for i, v in per.items():
        if len(v) == 1:
            if v[0] in lab:
                problems.append("номер %s найден в двух разных контурах" % v[0])
            lab[v[0]] = i
    plot_idx = set(lab.values())

    cls = {}
    unknown = collections.defaultdict(list)
    for i, f in enumerate(faces):
        col = sample_color(f, png, k)
        c = classify(col, PLOT_CLASSES if i in plot_idx else AREA_CLASSES)
        if c is None:
            n = next((n for n, j in lab.items() if j == i), None)
            unknown[(hexc(col), "участок" if n else "область")].append(n or "площадь %.0f pt²" % f.area)
        cls[i] = c
    for (col, kind), items in unknown.items():
        problems.append("неизвестный цвет %s у %s (%d шт.: %s). Добавьте его в таблицы цветов в начале скрипта"
                        % (col, kind, len(items), ", ".join(items[:6]) + (" …" if len(items) > 6 else "")))
    for n, i in lab.items():
        if faces[i].interiors:
            print("предупреждение: у участка %s есть «дыра» внутри контура" % n)

    if args.plots:
        text = Path(args.plots).read_text(encoding="utf-8")
        data = set(re.findall(r'"number":(\d+)', text))
        scheme = set(lab)
        if data - scheme:
            print("предупреждение: в plots.js есть, на схеме нет: " + ", ".join(sorted(data - scheme, key=int)))
        if scheme - data:
            print("предупреждение: на схеме есть, в plots.js нет: " + ", ".join(sorted(scheme - data, key=int)))

    if problems:
        for p in problems:
            print("ОШИБКА: " + p, file=sys.stderr)
        sys.exit(1)

    # ---- сборка SVG ----
    gdefs, guses, nglyphs = read_text_glyphs(svg_text)
    areas = "".join('<path class="%s" d="%s"/>' % (cls[i], path_d(faces[i]))
                    for i in sorted(range(len(faces)), key=lambda i: -faces[i].area) if i not in plot_idx)
    plots = "".join('<path class="%s" data-n="%s" d="%s"/>' % (cls[lab[n]], n, path_d(faces[lab[n]]))
                    for n in sorted(lab, key=int))
    lines = "".join("M%s %sL%s %s" % (f2(g.coords[0][0]), f2(g.coords[0][1]), f2(g.coords[1][0]), f2(g.coords[1][1]))
                    for g in segs)
    svg = ('<svg id="scheme" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" height="%s">'
           '<defs>%s</defs><rect class="bg" width="%s" height="%s"/>'
           '<g id="areas">%s</g><g id="plots">%s</g>'
           '<path id="lines" d="%s" fill="none" stroke="#000" stroke-width="0.3" stroke-linecap="round"/>'
           '<g id="text">%s</g></svg>') % (W, H, W, H, gdefs, W, H, areas, plots, lines, guses)

    new = re.sub(r"(<!--SCHEME:BEGIN-->).*?(<!--SCHEME:END-->)",
                 lambda m: m.group(1) + "\n" + svg + "\n" + m.group(2), html, flags=re.S)
    html_path.write_text(new, encoding="utf-8")

    stat = collections.Counter(cls[i] for i in range(len(faces)))
    print("готово: участков %d, прочих областей %d, отрезков линий %d, глифов %d, отброшено точек-мусора %d"
          % (len(lab), len(faces) - len(lab), len(segs), nglyphs, dots))
    print("классы:", ", ".join("%s=%d" % (c, n) for c, n in sorted(stat.items())))
    print("записано: %s (%d КБ)" % (html_path, len(new.encode()) // 1024))


if __name__ == "__main__":
    main()
