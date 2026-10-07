#!/usr/bin/env bash
# Заглушка для проверки пути «телефон → оператор → интернет → релей».
# Поднимается вне docker-compose: чтобы docker compose down её не задевал и
# чтобы её не приняли за часть прода. Описание и разбор результатов — в README.md
# этого каталога.
set -euo pipefail

NAME=lte-probe
PORT=8090
DIR="$(cd "$(dirname "$0")" && pwd)"

stop() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    docker rm -f "$NAME" >/dev/null
    echo "✓ $NAME убран"
  else
    echo "  $NAME не был запущен"
  fi
}

case "${1:-start}" in
  start)
    stop
    docker run -d --name "$NAME" \
      --restart unless-stopped \
      -p "127.0.0.1:$PORT:8090" \
      -p "$PORT:8090" \
      -v "$DIR/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
      -v "$DIR/index.html:/usr/share/nginx/html/index.html:ro" \
      nginx:alpine >/dev/null
    sleep 1
    # Проверка с самого хоста: если заглушка не отвечает здесь, до телефона
    # дело вообще не дойдёт и проверка будет бессмысленной.
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/" || echo 000)
    if [ "$code" != "200" ]; then
      echo "✗ заглушка не ответила: HTTP $code" >&2
      docker logs "$NAME" >&2 || true
      exit 1
    fi
    size=$(wc -c < "$DIR/index.html" | tr -d ' ')
    echo "✓ $NAME поднят на порту $PORT, страница $size Б"
    echo "  в панели релея: probe.frament.netcraze.link → 192.168.1.41:$PORT"
    ;;
  stop) stop ;;
  check)
    echo "── заглушка с самого хоста ──"
    curl -sS -o /dev/null -D - --max-time 5 "http://127.0.0.1:$PORT/" \
      | grep -iE '^HTTP|^x-probe|^content-length' | sed 's/^/  /'
    echo "── заглушка по локальному адресу хоста ──"
    curl -sS -o /dev/null -w '  HTTP %{http_code}, %{size_download} Б за %{time_total}s\n' \
      --max-time 5 "http://192.168.1.41:$PORT/" || echo "  не отвечает"
    ;;
  *) echo "Использование: $0 {start|stop|check}" >&2; exit 2 ;;
esac
