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
# Neither shows up in a unit test, and neither failed loudly. This script is the
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

echo
echo "✓ конфиги прокси в порядке"
