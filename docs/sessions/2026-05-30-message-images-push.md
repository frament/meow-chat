# Session 2026-05-30 — Message images + Push notifications

## Features implemented

### Message images
- Added `message_images` table + uploads dir — `database/database.go`
- Rewrote `SendMessage` to `multipart/form-data` with image validation + save — `handlers/handlers.go`
- Updated `GetMessages` to fetch images via IN query — `handlers/handlers.go`
- Updated `wsMessage` struct + WS broadcast to include `images` — `handlers/handlers.go`
- Frontend: `Message` interface gains `images`, `sendMessage` accepts `File[]` as FormData — `api.service.ts`
- Frontend: image picker button, preview strip with remove, inline image rendering in bubbles, mobile + desktop — `chat.ts`

### Gitignore & Makefile
- Added root `.gitignore` (`data/`, `uploads/`, `_ref/`, `.idea/`, etc.)
- Added `make update` target (git pull → docker compose build → up -d) — `Makefile`
- Added `my-chat-backend.exe` to `.gitignore`

### PWA update
- Added PWA update check: `SwUpdate.versionUpdates` listener, 30min interval + `window:focus` trigger, update banner with "Обновить" button in `app.ts`

### Push notifications
- Backend: `push_subscriptions` table + VAPID key generation — `database/database.go`, `handlers/push.go`
- Backend: push subscription endpoints (`GET /api/push/vapid-public-key`, `POST/DELETE /api/push/subscribe`) — `main.go`, `handlers/push.go`
- Backend: push trigger in `SendMessage` when recipient offline — `handlers/handlers.go`
- Frontend: custom `sw-push-handler.js` SW with `push`/`notificationclick` handlers
- Frontend: register custom SW (`sw-push-handler.js` imports `ngsw-worker.js`) — `app.config.ts`, `angular.json`, `ngsw-config.json`
- Frontend: `SwPush` subscription lifecycle (subscribe on init, VAPID key fetch) — `app.ts`, `api.service.ts`
- Frontend: "Проверить обновления" button in settings — `settings.ts`

### Fixes
- Fixed default theme from `system` to `light` — `theme.service.ts`
- Fixed `ThemeService` not applied on startup (injected in `App` component) — `app.ts`
- Fixed FOUC — added inline `<script>` in `index.html` to apply theme before Angular loads
- Fixed auth interceptor: don't logout on network/server errors (5xx) during token refresh — `auth.interceptor.ts`
- Fixed root `/` route: redirect to `/feed` if logged in, `/login` otherwise — `app.routes.ts`
