#!/usr/bin/env bash
# The app schema is defined once, in backend/database.ApplySchema, and test
# fixtures call it. This script keeps it that way.
#
# It has to be enforced rather than documented. The fixtures used to carry their
# own copies of the DDL and the copies drifted silently: users.last_seen was
# added to the real schema, the WS fixture kept the old one, and the write
# against it matched zero rows - a failure `go build` cannot see, showing up only
# as a mysteriously un-set column inside a test.
#
# Only tables that exist in the real schema are rejected. A test that builds a
# throwaway table for its own SQL (backup/backup_test.go creates `test` and `t`
# to exercise dump and restore) is fine and is left alone.
set -euo pipefail

cd "$(dirname "$0")/.."

# Table names the application actually has.
app_tables="$(grep -oE 'CREATE TABLE IF NOT EXISTS [a-z_]+' backend/database/database.go \
  | awk '{print $6}' | sort -u)"

if [ -z "$app_tables" ]; then
  echo "::error::Could not read the schema from backend/database/database.go"
  exit 1
fi

status=0
for table in $app_tables; do
  offenders="$(grep -rln "CREATE TABLE[^\"]*\b${table}\b" --include='*_test.go' backend/ || true)"
  for f in $offenders; do
    echo "::error file=$f::$f creates application table '$table'."
    echo "::error::Test files must use database.ApplySchema(db) instead of their own DDL."
    status=1
  done
done

if [ "$status" -ne 0 ]; then
  exit 1
fi

count="$(echo "$app_tables" | wc -l | tr -d ' ')"
echo "Schema has a single definition: database.ApplySchema ($count application tables checked)"
