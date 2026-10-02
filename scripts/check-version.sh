#!/usr/bin/env bash
# Guards the places where the release number appears as prose, so they cannot
# drift from backend/version/VERSION the way the test-count badges did: README
# said 374 while the tree had 308 declared tests, and nobody noticed because
# nothing compared the two.
#
# backend/version/VERSION is the only place the number is written. Everything
# else is a copy that has to match.
set -euo pipefail

cd "$(dirname "$0")/.."

version="$(tr -d '[:space:]' < backend/version/VERSION)"
status=0

check() {
  local file="$1" pattern="$2" label="$3"
  if ! grep -q "$pattern" "$file"; then
    echo "::error file=$file::$label '$version' is missing from $file"
    status=1
  fi
}

check README.md "badge/version-${version}-blue" "version badge"
check ROADMAP.md "Текущая версия — \*\*v${version}\*\*" "current version line"
check CHANGELOG.md "^## \[${version}\]" "changelog section"

if [ "$status" -ne 0 ]; then
  echo "::error::Version markers do not match backend/version/VERSION ($version)"
  exit 1
fi

echo "Version markers agree with backend/version/VERSION: $version"
