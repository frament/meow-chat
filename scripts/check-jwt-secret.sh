#!/usr/bin/env bash
# Guards the rule that started this: the backend must never serve with a secret it
# invented for itself.
#
# backend/auth used to fall back to a literal from the source. This repo is public,
# so that string was not a secret - anyone could mint a token for any user with
# is_admin: true. auth.RequireSecret now stops main() before it opens a database,
# and this script keeps all four parts of that from quietly regressing.
#
# The check lives in cmd/jwtprobe because RequireSecret uses log.Fatal, which would
# take a test binary down with it.
set -euo pipefail

cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
BIN="$TMP/jwtprobe"

fail() { echo "✗ $1" >&2; exit 1; }

echo "▸ main() refuses to serve without a secret"
( cd backend && go build -o "$BIN" ./cmd/jwtprobe )
grep -q 'auth.RequireSecret()' backend/main.go \
  || fail "main() не вызывает auth.RequireSecret()"
# Before the database, or a misconfigured start could still create files.
awk '/auth.RequireSecret\(\)/ { found = NR } /database.InitDB\(\)/ { exit }
     END { if (!found) exit 1 }' backend/main.go \
  || fail "auth.RequireSecret() вызывается после database.InitDB()"
echo "  ✓ RequireSecret() в main(), до InitDB()"

out=$(JWT_SECRET="" "$BIN" 2>&1) && fail "сервер стартовал с пустым JWT_SECRET"
echo "  ✓ отказ: $(echo "$out" | tail -1)"

out=$(JWT_SECRET="   " "$BIN" 2>&1) && fail "сервер стартовал с пробельным JWT_SECRET"
echo "  ✓ отказ и на пробельном значении"

JWT_SECRET="a-real-secret" "$BIN" >/dev/null || fail "сервер не стартует с настоящим секретом"
echo "  ✓ с настоящим секретом стартует"

echo "▸ отката к дефолту нет"
if grep -rn "my-chat-dev-secret" backend/ --include="*.go" | grep -v _test; then
  fail "в коде снова появился дефолтный секрет"
fi
echo "  ✓ дефолта в коде нет"

echo "▸ compose требует секрет и не подставляет значение"
grep -q 'JWT_SECRET=\${JWT_SECRET:?' docker-compose.yml \
  || fail "docker-compose.yml не требует JWT_SECRET — compose не откажется сам"
echo "  ✓ compose требует JWT_SECRET"

echo "▸ .env на сервере не попадает в git"
git check-ignore -q .env || fail ".env не в .gitignore"
git ls-files --error-unmatch .env >/dev/null 2>&1 \
  && fail ".env отслеживается git — секрет уедет в публичный репозиторий"
echo "  ✓ .env игнорируется и не отслеживается"

echo
echo "✓ JWT_SECRET обязателен: код, compose и эта проверка"