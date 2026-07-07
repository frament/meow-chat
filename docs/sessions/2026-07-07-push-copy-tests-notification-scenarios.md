# Push notification loss analysis + backend tests

## Analysis: push notification loss scenarios

Identified 8 scenarios where push notifications can be silently lost:

| # | Scenario | Likelihood | Fix? |
|---|----------|------------|------|
| 1 | `silent: true` + missing `requireInteraction` → auto-dismiss after ~8s | ★★★★★ | pending |
| 2 | Push subscription invalidation → old endpoint 410 → all subs deleted | ★★★★☆ | pendingSub + vis change |
| 3 | Auth deadlock on re-subscribe → pushSubscribe skipped | ★★★☆☆ | already fixed |
| 4 | All subscriptions cleaned by 410 chain → push stops | ★★☆☆☆ | no |
| 5 | `messageID == 0` or empty E2EE preview → push not sent | ★☆☆☆☆ | no |
| 6 | Push TTL exceeded (24h) → push dropped | ★★☆☆☆ | no |
| 7 | Grace period miscount (safe — push sent via WS fallback) | ★☆☆☆☆ | safe |
| 8 | Broadcast channel full → message not delivered | ★☆☆☆☆ | no |

## Changes

### backend/handlers/ws_test.go (+108 lines)
- `TestWS_PushCopy_ReconnectWithinGrace`: recipient disconnect → reconnect within 30s grace → message via WS → 0 push_copies
- `TestWS_PushCopy_EncryptedPreview`: push_copy `server_encrypted_content` decrypts to `push_preview`
- `TestWS_PushCopy_NoPreviewNoCopy`: E2EE message with empty `content` + no `push_preview` → 0 push_copies
- All 5 push-copy tests pass (2 existing + 3 new)

### frontend/ changes (pre-push-fix work)
- **sw-push-handler.js**: `pendingSub` variable to defer subscription re-registration until client returns; `self.addEventListener('message', ...)` for PUSH_SUBSCRIBE event; `loadClientsAndSubscribe()` fallback
- **app.ts**: call `pushSubscribe()` on `visibilitychange` (document.visibilityState === 'visible')
- **api.service.ts**: `pushSubscribe()` returns promise, catches errors silently (no logout)
- **api.service.spec.ts** / **auth.interceptor.spec.ts**: updated test fixtures for new pushSubscribe signature

## Commands
```sh
cd backend && CGO_ENABLED=1 go test -run 'TestWS_PushCopy' -v -timeout 30s
```
