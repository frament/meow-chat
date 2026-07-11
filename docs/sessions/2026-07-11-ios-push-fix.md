# iOS PWA Push Notifications Fix

**Date:** 2026-07-11

## Problem
iOS PWA push notifications returned `403 Forbidden` from Apple Push Service (APNs).

## Root Causes
1. **Stale push subscription in browser:** After VAPID keys were regenerated (first launch without persistence), the browser cached an old push subscription linked to the old VAPID public key. Apple verifies the VAPID JWT signature against the key used at subscription time — mismatch → 403.
2. **`bearerTransport` patching**: The custom `bearerTransport` rewrote `Authorization: WebPush <jwt>` → `Authorization: Bearer <jwt>`. Apple expects the standard `WebPush` auth scheme (per WebPush RFC). The `Bearer` scheme is non-standard and may have caused rejection.

## Fixes Applied

### Commit `bbb1cba` — VAPID subscriber change
- `backend/handlers/push.go`: Changed `Subscriber` from `admin@chat.frament.netcraze.link` to `admin@gmail.com`

### Commit `2c87b13` — Remove `bearerTransport`
- Deleted `bearerTransport` struct (18 lines)
- Changed `HTTPClient` to use bare `&http.Client{}` (default transport)
- Now uses standard `webpush.WebPush` auth scheme (no `Bearer` rewriting)

### Commit `626c1af` — VAPID keys persistence (previous session)
- VAPID keys saved to `/data/vapid_keys.json` so they survive container restarts

### Commit `5c22d96` — VAPID contact configurable
- Added `contactEmail()` helper, reads `VAPID_CONTACT` env var, fallback `admin@gmail.com`
- Added `VAPID_CONTACT=${VAPID_CONTACT:-admin@gmail.com}` to docker-compose.yml

### Commit `f8862d0` — GitHub check admin-only
- Wrapped "Проверить новые версии на GitHub" button in `@if (isAdmin)` in settings

### DB Cleanup
- Deleted all rows from `push_subscriptions` table to force fresh subscriptions with current VAPID keys

## Test Results
After fixes:
- `Message 182: Web Push sent to user 1, status 201` ✅
- `Message 183: Web Push sent to user 1, status 201` ✅
- User confirmed notifications received on iPhone

## Key Files
- `backend/handlers/push.go`: `sendPushNotification`, `SubscribePush`, `UnsubscribePush`, `LoadVAPIDKeys`
- `frontend/src/app/app.ts`: `tryReSubscribePush()` — PWA-side subscription logic
- `backend/cmd/push-test/main.go`: CLI tool for test cycles (register/friend/send)
- `/tmp/send_push.sh` on server: sends message from bob99 → frament

## User Steps to Fix Client
1. Clear Safari Website Data for `chat.frament.netcraze.link`
2. Delete PWA from Home Screen
3. Reinstall PWA, enable notifications
