#!/bin/sh
# One generation back, on startup.
#
# These files exist so that an incident from before the last deploy still has
# evidence. Docker deletes its own logs when a container is recreated, and this
# server is redeployed often - that is how a lost session on 2026-10-25 ended
# with "cause not established".
#
# Kept simple on purpose: the point is survival and a bound, not an archive.
# 20 MB is weeks of a family server; when it is exceeded the previous file is
# moved aside once and a fresh one starts.
LIMIT=20971520
for f in /var/log/nginx/access.log /var/log/nginx/error.log; do
  [ -f "$f" ] || continue
  size=$(wc -c < "$f" 2>/dev/null || echo 0)
  if [ "$size" -gt "$LIMIT" ]; then
    mv "$f" "$f.1"
  fi
done
