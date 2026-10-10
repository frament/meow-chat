#!/usr/bin/env bash
# Two configs that were wrong in ways only a browser exposes.
#
# 1. ngsw.json's navigationUrls. Left unset, the service worker treats any path
#    without a dot as an app navigation and answers it with index.html - including
#    /api/health. Opening an API URL in the browser then looks like a redirect to
#    the root, and it hides the real behaviour of the API from anyone trying to
#    check it by hand.
#
# 2. nginx's Connection header. "upgrade" is for WebSocket and was being sent on
#    every /api request, which stops nginx reusing its connection to the backend.
#
# 3. nginx's compression, which was absent altogether. Without it a cold load on a
#    phone pulled 1.16 MB instead of ~508 KB - the full 762 KB of JS in the clear -
#    which on LTE was the whole difference between "loads" and "spins forever". The
#    same check guards the favicon, which was a 1024x1024 PNG: 259 KB that gzip
#    cannot touch, downloaded on every cold load.
#
# None of these show up in a unit test, and none failed loudly. This script is the
# only thing that would have caught them.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() { echo "✗ $1" >&2; exit 1; }

echo "▸ service worker does not swallow API navigations"
[ -f frontend/ngsw-config.json ] || fail "frontend/ngsw-config.json отсутствует"
python3 - <<'PY' || exit 1
import json, sys
cfg = json.load(open('frontend/ngsw-config.json', encoding='utf-8'))
urls = cfg.get('navigationUrls')
if not urls:
    print('✗ navigationUrls не заданы: ngsw сочтёт навигацией и /api/*, отдав index.html')
    sys.exit(1)
excluded = [u.lstrip('!').rstrip('*') for u in urls if u.startswith('!')]
for prefix in ('/api/', '/uploads/'):
    if not any(e == prefix or e.startswith(prefix) or prefix.startswith(e) for e in excluded):
        print(f'✗ {prefix} попадает под навигацию — прямой заход на API отдаст index.html')
        sys.exit(1)
print('  ✓ /api/** и /uploads/** исключены из навигаций')
PY

echo "▸ nginx asks for a connection upgrade only on the WebSocket path"
[ -f frontend/nginx.conf ] || fail "frontend/nginx.conf отсутствует"
python3 - <<'PY' || exit 1
import re, sys

conf = open('frontend/nginx.conf', encoding='utf-8').read()
# Blocks are taken by brace matching so a `location /api { ... }` is read as a
# whole, not as one line.
blocks = []
for m in re.finditer(r'location\s+(\S+)\s*\{', conf):
    depth, i = 0, m.end() - 1
    while i < len(conf):
        if conf[i] == '{': depth += 1
        elif conf[i] == '}':
            depth -= 1
            if depth == 0: break
        i += 1
    blocks.append((m.group(1), conf[m.end():i]))

upgrade_blocks = [
    path for path, body in blocks
    if re.search(r'Connection\s+"?upgrade"?', body, re.I)
]
if not upgrade_blocks:
    print('✗ ни один location не просит upgrade — WebSocket перестанет работать')
    sys.exit(1)
if upgrade_blocks != ['/api/ws']:
    print(f'✗ upgrade запрошен не только для /api/ws: {upgrade_blocks}')
    print('  на обычных /api это мешает nginx переиспользовать соединение с бэкендом')
    sys.exit(1)
print('  ✓ upgrade только на /api/ws')

# The API location must explicitly clear the header, otherwise it inherits
# nothing and nginx may still close each upstream connection.
api = dict(blocks).get('/api', '')
if not re.search(r'Connection\s+""', api):
    print('✗ в location /api нет Connection "" — соединение с бэкендом не переиспользуется')
    sys.exit(1)
print('  ✓ /api держит keep-alive до бэкенда')

# Anchored to a live directive: a commented-out one still contains the text, and
# an earlier version of this check passed with the whole thing disabled.
if not re.search(r'^\s*log_format\s+timed\b', conf, re.M):
    print('✗ нет активного log_format timed — «медленно только из одной сети» нечем разобрать')
    sys.exit(1)
if not re.search(r'^\s*access_log\s+\S+\s+timed\b', conf, re.M):
    print('✗ log_format есть, но access_log его не использует')
    sys.exit(1)
if '$upstream_response_time' not in conf:
    print('✗ в format нет $upstream_response_time — не видно, сколько думал бэкенд')
    sys.exit(1)
# Without a timestamp a log of repeated requests cannot be told apart from a log
# of one request a minute, which is the difference between a retry loop and normal
# traffic.
if '$time_iso8601' not in conf:
    print('✗ в format нет $time_iso8601 — не отличить цикл повторов от обычных запросов')
    sys.exit(1)
print('  ✓ тайминги пишутся в лог')
PY

echo "▸ service worker не тянет весь сайт при каждом обновлении"
python3 - <<'PY' || exit 1
import json, sys

cfg = json.load(open('frontend/ngsw-config.json', encoding='utf-8'))

# `prefetch` means the worker downloads the whole group the moment it installs or
# updates - which is exactly while the page is trying to make its own requests. It
# was pulling 585 KB (the whole JS bundle plus every uploaded image) at the moment
# the app was blocked for 20 seconds with nothing reaching the server.
for group in cfg.get('assetGroups', []):
    prefetching = 'prefetch' in (group.get('installMode'), group.get('updateMode'))
    if not prefetching:
        continue
    name = group.get('name', '?')
    files = group.get('resources', {}).get('files', [])
    for pattern in files:
        # `/*.js` and `/*.css` are the bundles. A `/**` glob reaches /uploads, and
        # /uploads grows with every photo the family posts - it has no upper bound,
        # so prefetching it fills a phone's storage with a family's photo library
        # that can never be evicted.
        heavy = (
            pattern in ('/*.js', '/*.css')
            or pattern.startswith('/**')
            or pattern.startswith('/uploads/')
        )
        if heavy:
            print(f'✗ группа {name} в режиме prefetch тянет {pattern} — '
                  f'{len(files)} файлов на каждом обновлении SW')
            print('  это и есть источник тех 20 секунд, когда страница молчит')
            sys.exit(1)
    for excluded in group.get('resources', {}).get('exclude', []):
        if excluded.lstrip('!').rstrip('*') == '/uploads/':
            print(f'✗ группа {name} в режиме prefetch исключает {excluded} — '
                  'а exclude без glob означает, что группа всё равно его тянет')
            sys.exit(1)

# The bundles have to be cached somewhere, or an offline start finds no JS.
groups = {g.get('name') for g in cfg.get('assetGroups', [])}
if not any('/*.js' in g.get('resources', {}).get('files', []) for g in cfg.get('assetGroups', [])):
    print('✗ ни одна группа не кэширует *.js — офлайн-старт останется без кода')
    sys.exit(1)
print('  ✓ prefetch только у маленькой оболочки, бандлы и картинки — lazy')
PY

echo "▸ загруженные файлы кэшируются, а не перепроверяются каждый раз"
python3 - <<'PY2' || exit 1
import re, sys

conf = open('frontend/nginx.conf', encoding='utf-8').read()

blocks = []
for m in re.finditer(r'location\s+(\S+)\s*\{', conf):
    depth, i = 0, m.end() - 1
    while i < len(conf):
        if conf[i] == '{': depth += 1
        elif conf[i] == '}':
            depth -= 1
            if depth == 0: break
        i += 1
    blocks.append((m.group(1), conf[m.end():i]))

uploads = dict(blocks).get('/uploads', '')
if not uploads:
    print('✗ нет location /uploads')
    sys.exit(1)
if not re.search(r'Cache-Control[^;]*immutable', uploads):
    print('✗ /uploads без Cache-Control immutable — каждая аватарка перепроверяется')
    print('  при каждой загрузке страницы, через релей, который держит три соединения')
    sys.exit(1)
print('  ✓ /uploads отдаётся с immutable')
PY2

echo "▸ service worker ставится вовремя, а не через полминуты"
python3 - <<'PY2' || exit 1
import re, sys

src = open('frontend/src/app/app.config.ts', encoding='utf-8').read()
m = re.search(r"registerWhenStable:(\d+)", src)
if not m:
    if 'registerImmediately' in src:
        print('  ✓ регистрация немедленная')
        raise SystemExit(0)
    print('✗ не задана стратегия регистрации service worker')
    sys.exit(1)
delay = int(m.group(1))
# При тридцати секундах обычная перезагрузка случается раньше, чем worker
# зарегистрируется, и обновление не доходит вообще: страницу отдаёт старый
# worker из своего кеша. Проверено - приложение два дня работало на старом бандле.
if delay > 10000:
    print(f'✗ registerWhenStable:{delay} - перезагрузка случится раньше,')
    print('  и новая версия не установится никогда')
    sys.exit(1)
print(f'  ✓ регистрация через {delay} мс')
PY2

echo "▸ критический путь загрузки — два соединения, а не пять"
python3 - <<'PY2' || exit 1
import sys

src = open('frontend/scripts/inline-assets.mjs', encoding='utf-8').read()

# Релей держит три одновременных соединения, и теряет их нестабильно: один и тот
# же бандл в 17:36 загрузился целиком, а в 17:49 прошли только два запроса из
# пяти, и страница осталась пустой. На пути к запуску приложения должно остаться
# ровно два соединения - документ и код. Всё остальное едет внутри документа или
# подключается после старта.
required = {
    'CSS':            "findByPrefix('styles-', '.css')",
    'zone.js':        "findByPrefix('polyfills-', '.js')",
    'манифест — после старта': "m.rel = 'manifest'",
}
for what, needle in required.items():
    if needle not in src:
        print(f'\u2717 сборка больше не встраивает {what}')
        print('  на пути к запуску появится лишнее соединение')
        sys.exit(1)
# Отдельная ссылка на шрифт вредна: @font-face уже в документе, и второй <link>
# на тот же woff2 добавлял соединение на пути к запуску.
# Beasties кладёт в документ критические стили — подмножество того же файла.
# Раз полный CSS уезжает следом, оба блока нужны только для дублирования байтов.
# Именно вызов, а не упоминание переменной: проверка на слово "stripped" проходила
# и когда замены в коде уже не было.
if 'head.replace(/<style>' not in src:
    print('\u2717 сборка не вычищает дублирующий блок <style> от Beasties')
    print('  критические стили попадут в документ вторым блоком')
    sys.exit(1)
if "f.rel = 'stylesheet'" in src:
    print('\u2717 шрифт подключается отдельной ссылкой — @font-face уже в документе,')
    print('  а лишний запрос на тот же woff2 занимает соединение')
    sys.exit(1)
print('  \u2713 на пути к запуску только документ и main-*.js')
PY2

echo "▸ nginx сжимает то, что стоит сжать"
python3 - <<'PY' || exit 1
import re, sys

conf = open('frontend/nginx.conf', encoding='utf-8').read()

# Anchored to live directives for the same reason as log_format above: a
# commented-out line still matches a loose search.
if not re.search(r'^\s*gzip\s+on\s*;', conf, re.M):
    print('✗ нет активного gzip on — телефон тянет 762 КБ JS вместо 194 КБ')
    sys.exit(1)

level = re.search(r'^\s*gzip_comp_level\s+(\d+)\s*;', conf, re.M)
if not level:
    print('✗ нет gzip_comp_level — nginx по умолчанию жмёт на уровне 1,')
    print('  это почти исходный размер; нужен 6')
    sys.exit(1)
if int(level.group(1)) < 5:
    print(f"✗ gzip_comp_level {level.group(1)} — слишком слабо, нужен хотя бы 5")
    sys.exit(1)

m = re.search(r'^\s*gzip_types\s*((?:[^;]|\n)*);', conf, re.M)
if not m:
    print('✗ нет gzip_types — сжимается только text/html, а JS и CSS проходят мимо')
    sys.exit(1)
types = {t.strip().lower() for t in m.group(1).split() if t.strip()}
for required in ('application/javascript', 'text/css', 'application/json'):
    if required not in types:
        print(f'✗ {required} не в gzip_types — самый тяжёлый трафик не сжимается')
        sys.exit(1)

# Formats that are already compressed. Gzipping these burns CPU and produces a
# slightly larger body; the favicon was 259 KB of exactly this.
for wasted in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'font/woff2'):
    if wasted in types:
        print(f'✗ {wasted} в gzip_types — формат уже сжат, gzip только испортит')
        sys.exit(1)

# `off` would switch gzip off for any request the router forwards.
if re.search(r'^\s*gzip_proxied\s+off\s*;', conf, re.M):
    print('✗ gzip_proxied off — роутер добавляет Via, и gzip выключится')
    sys.exit(1)

print('  ✓ gzip включён, уровень 6, сжимаются только сжимаемые типы')
PY

echo "▸ фавиконка не весит полмегабайта"
python3 - <<'PY' || exit 1
import os, sys

# 259 KB for a 1024x1024 PNG. PNG does not compress, so nothing on the server can
# claw it back - the only fix is a smaller file, fetched on every cold load.
path = 'frontend/public/favicon.png'
if not os.path.exists(path):
    print(f'✗ {path} отсутствует')
    sys.exit(1)
size = os.path.getsize(path)
limit = 64 * 1024
if size > limit:
    print(f'✗ фавиконка {size} байт (предел {limit}) — это чистая трата холодной загрузки')
    sys.exit(1)
print(f'  ✓ фавиконка {size} байт')
PY

echo "▸ иконка в push уведомлении указывает на существующий файл"
python3 - <<'PY' || exit 1
import os, re, sys

# Путь к иконке зашит в backend/handlers/push.go, а файл лежит во frontend/public
# и отдаётся nginx'ом. Юнит-тест этого не видит: он проверяет отправку, а не то,
# что адрес в теле уведомления куда-то ведёт. Расхождение молча давало 404 на
# каждом уведомлении - на iOS незаметно (там своя иконка приложения), на
# Android и в браузере битая картинка.
src = open('backend/handlers/push.go').read()
m = re.search(r'"icon":\s*"([^"]+)"', src)
if not m:
    print('✗ не нашёл поле icon в push.go - проверь вручную')
    sys.exit(1)

icon = m.group(1)
path = os.path.join('frontend/public', icon.lstrip('/'))
if not os.path.exists(path):
    print(f'✗ push отдаёт иконку {icon}, но файла frontend/public/{icon.lstrip("/")} нет')
    print('  Каждый пуш получит 404 на иконку.')
    sys.exit(1)
print(f'  ✓ иконка пуша {icon} существует')
PY

echo
echo "✓ конфиги прокси в порядке"
