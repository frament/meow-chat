# MeowChat repo guide

## Stack
- **Backend**: Go 1.22 + Fiber v2 + SQLite (via mattn/go-sqlite3, CGO) + bcrypt + WebSocket (gofiber/contrib/websocket)
- **Frontend**: Angular 20 (standalone components, new `@if`/`@for` control flow) + Tailwind v4 (`@import "tailwindcss"` in CSS) + PWA (`@angular/service-worker`)
- **Infra**: Docker Compose (primary run-and-go), nginx reverse-proxy in frontend container

## Project structure
```
backend/       # Go module: my-chat-backend
  main.go      # entrypoint, route registration
  database/    # SQLite init + auto-migration (4 tables: users, messages, posts, post_images)
  handlers/    # REST handlers + WebSocket hub (in-memory per-process)
  models/      # request/response structs
uploads/avatars/ # avatar images (auto-created on server start)
uploads/posts/   # post images (auto-created on server start)
frontend/
  src/app/
    components/{login,register,feed,chat,layout}/  # standalone components
    services/api.service.ts                        # all API calls + WebSocket connect
  proxy.conf.js   # dev API proxy → localhost:8080, with WS support
  nginx.conf      # prod: /api → backend:8080, SPA fallback
  ngsw-config.json # service worker (production only)
```

## Preferences
- **Execution style**: Inline (execute tasks in current session, not subagent-driven)

## Commands
```sh
# Production (Docker Compose)
make build       # docker compose build
make up          # docker compose up -d
make down        # docker compose down
make restart-backend  # docker compose build backend && docker compose up -d --no-deps backend
make update          # git pull && docker compose build && docker compose up -d

# Development (local)
make dev-backend      # bash: cd backend && DB_PATH=./data/chat.db go run .
make dev-backend-win  # Windows (cmd.exe): cd backend && set DB_PATH=./data/chat.db && go run .
make dev-frontend     # cd frontend && npm run start  (proxies /api + /uploads → :8080)

# Frontend build check
cd frontend && npm run build   # production build with service-worker
```

## Key quirks
- **CGO required**: Backend Dockerfile installs `gcc musl-dev` for sqlite3. Local dev needs `CGO_ENABLED=1` (default).
- **Auth**: JWT access/refresh tokens. Login returns `{ access_token, refresh_token, user }`. Access token (15min) sent via `Authorization: Bearer` header. Refresh token (7 days) stored in localStorage, auto-refreshed via HTTP interceptor on 401. Backend enforces via `handlers.AuthRequired` middleware. Endpoints without auth: `/api/register`, `/api/login`, `/api/refresh`.
- **WebSocket**: In-memory hub per process. Does not scale beyond one instance. WS endpoint at `/api/ws?token=` (access token as query param).
- **PWA**: Service worker registers only in production build (`!isDevMode()`). Dev mode has no SW.
- **Tailwind v4**: Configured via `@import "tailwindcss"` in `styles.css`. No `tailwind.config.js`. Requires `frontend/.postcssrc.json` with `{ "plugins": { "@tailwindcss/postcss": {} } }` — Angular's Vite builder does NOT auto-detect `@tailwindcss/postcss` without it.
- **No linter/formatter**: Neither backend nor frontend has lint/format config beyond Angular CLI defaults.
- **No tests beyond defaults**: Angular has Karma/Jasmine setup (`ng test`), backend has zero test files.
- **DB auto-migrates** on startup. Schema: `users`, `messages`, `posts`, `post_images` with foreign keys. SQLite WAL mode enabled.
- **Frontend uses Angular standalone components** and new `@if/@for` control flow. Do NOT add `CommonModule` imports.
- **Avatars**: Uploaded via `POST /api/upload-avatar` (multipart), stored in `./uploads/avatars/`, served via `/uploads/`. Profile update via `PUT /api/profile`. Users table has `avatar_url TEXT`. Login/GetUsers/GetFeed all return `avatar_url`.
- **Mobile responsive**: Layout has bottom nav on mobile (`sm:hidden`), top nav on desktop. Chat shows user list / chat view one at a time on mobile (`md:hidden` toggle). Feed/Login/Register use responsive padding.
- **Direct chat URL**: `/chat/:userId` opens chat with specific user. User list clicks navigate via router, not direct select.
- **WebSocket fix**: `c.Locals("userId")` returns `int64` from JWT token validation — use type assertion `v.(int64)`.
- **WebSocket route order**: `/api/ws` must be registered BEFORE `api.Use(handlers.AuthRequired)` in `main.go`. WS passes token via `?token=` query param, not `Authorization: Bearer` header, so `AuthRequired` rejects it.
- **iOS auto-zoom fix**: Viewport meta has `maximum-scale=1` to prevent iOS Safari zoom on input focus (inputs use 13-14px font, which triggers iOS auto-zoom).
- **Chat mobile layout**: Desktop user list uses `hidden md:block` without `[class.hidden]` binding — the binding conflicted with Tailwind's static `hidden` class, making both lists visible on mobile.
- **Post images**: `POST /api/posts` accepts `multipart/form-data` with `content` field + `images` (multiple files, max 10, max 10MB each, jpg/png/gif/webp). Images saved to `./uploads/posts/`, references in `post_images` table. `GET /api/feed` returns `images[]` per post. Nginx and dev proxy both forward `/uploads/` to backend.
- **Design system**: CSS custom properties theming with `.theme-light`/`.theme-dark` classes on `<html>`. `ThemeService` (`frontend/src/app/services/theme.service.ts`) manages light/dark/system modes, persists to localStorage, listens to `prefers-color-scheme`. Settings page has theme selector with 3 options (☀️🌙💻). Font: Plus Jakarta Sans.
- **Online status**: Backend tracks online users via WebSocket hub (`onlineUsers map[int64]bool`). 30s grace period on disconnect via `time.AfterFunc` — reconnect cancels timer. `GET /api/users` returns `is_online`. WS broadcasts `user_online`/`user_offline` events. Frontend caches users in `cachedUsers` localStorage.
- **Pinned users**: `pinned_users` DB table (`user_id`, `pinned_user_id`). API: `GET /api/pinned`, `POST /api/pin/:id`, `DELETE /api/pin/:id`. Frontend stores pins in `cachedPins` localStorage, sorted into separate "📌 Закреплённые" section above "Все пользователи". Each item has pin toggle button.
- **Mobile user list items**: Each user in mobile chat list is a standalone `.card` with `space-y-2` gap — no container background, individual cards per user.
- **Message images**: `message_images` DB table (`id`, `message_id`, `image_url`). `POST /api/messages` accepts `multipart/form-data` with `content` + `images` (max 10, jpg/png/gif/webp, 10MB each). Images saved to `./uploads/messages/`. `GET /api/messages` returns `images[]` per message. WS broadcasts `images: string[]`. Frontend has image picker button, preview strip, renders images inside bubbles (clickable to open in new tab).

## Session (2026-05-30)
- Implemented message images feature end-to-end
- Added `message_images` table + uploads dir — `database/database.go`
- Rewrote `SendMessage` to `multipart/form-data` with image validation + save — `handlers/handlers.go`
- Updated `GetMessages` to fetch images via IN query — `handlers/handlers.go`
- Updated `wsMessage` struct + WS broadcast to include `images` — `handlers/handlers.go`
- Frontend: `Message` interface gains `images`, `sendMessage` accepts `File[]` as FormData — `api.service.ts`
- Frontend: image picker button, preview strip with remove, inline image rendering in bubbles, mobile + desktop — `chat.ts`
- Added root `.gitignore` (`data/`, `uploads/`, `_ref/`, `.idea/`, etc.)
- Added `make update` target (git pull → docker compose build → up -d) — `Makefile`
- Added PWA update check: `SwUpdate.versionUpdates` listener, 30min interval + `window:focus` trigger, update banner with "Обновить" button in `app.ts`
- Added `my-chat-backend.exe` to `.gitignore`
- Added push notifications via Web Push API
- Backend: `push_subscriptions` table + VAPID key generation — `database/database.go`, `handlers/push.go`
- Backend: push subscription endpoints (`GET /api/push/vapid-public-key`, `POST/DELETE /api/push/subscribe`) — `main.go`, `handlers/push.go`
- Backend: push trigger in `SendMessage` when recipient offline — `handlers/handlers.go`
- Frontend: custom `sw-push-handler.js` SW with `push`/`notificationclick` handlers
- Frontend: register custom SW (`sw-push-handler.js` imports `ngsw-worker.js`) — `app.config.ts`, `angular.json`, `ngsw-config.json`
- Frontend: `SwPush` subscription lifecycle (subscribe on init, VAPID key fetch) — `app.ts`, `api.service.ts`
- Frontend: "Проверить обновления" button in settings — `settings.ts`
- Fixed default theme from `system` to `light` — `theme.service.ts`
- Fixed `ThemeService` not applied on startup (injected in `App` component) — `app.ts`
- Fixed FOUC — added inline `<script>` in `index.html` to apply theme before Angular loads
- Fixed auth interceptor: don't logout on network/server errors (5xx) during token refresh — `auth.interceptor.ts`
- Fixed root `/` route: redirect to `/feed` if logged in, `/login` otherwise — `app.routes.ts`

## Session (2026-05-31)
- **System notifications**: Added `from_name` to backend WS message struct + broadcast payload — `handlers/handlers.go`
- **NotificationService**: New service managing `Notification` API permission, `show()`, tab visibility tracking (`document.visibilitychange` + `blur`/`focus`) — `notification.service.ts`
- **Global WebSocket**: Refactored WS from chat component to `ApiService` singleton — persists across pages, auto-connect on auth, auto-disconnect on logout — `api.service.ts`
- **Notification logic**: `App` component subscribes to `wsMessages$`, shows browser notification when tab is hidden OR user is not on the correct chat route; click navigates to `/chat/:senderId` — `app.ts`
- **Chat component cleanup**: Removed local WS management, subscribes to `api.wsMessages$` instead, uses `data.from_name` from server — `chat.ts`
- WS connection lifecycle: constructor → `connectWebSocket()` if saved token, `storeAuth()` → `connectWebSocket()`, `logout()` → `disconnectWebSocket()`
- Fixed notification permission request: moved from `App.ngOnInit()` to `LoginComponent.onSubmit()` (user gesture required) — `login.ts`, `notification.service.ts`
- Fixed `uploads/` not persisting in Docker: added volume to `docker-compose.yml`
- Fixed iOS safe area: added `viewport-fit=cover`, `env(safe-area-inset-bottom)` padding for bottom nav and mobile chat — `index.html`, `layout.ts`, `chat.ts`
- Rebranded to MeowChat: updated title, manifest, nav logo text — `index.html`, `layout.ts`, `manifest.webmanifest`
- Added SVG logo + favicon concepts in `design-mockups/`
- Replaced favicon with PNG favicon — `index.html`, `favicon.png`
- Fixed iOS safe area top padding for notch/status bar — `layout.ts`
- Fixed mobile chat height to account for both top and bottom nav with safe areas — `chat.ts`
- Added notification chime via Web Audio API, then replaced with custom `notification.mp3` — `notification.service.ts`
