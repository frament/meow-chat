# MeowChat repo guide

## Stack
- **Backend**: Go 1.23 + Fiber v2 + SQLite (go-webauthn for biometric auth) (via mattn/go-sqlite3, CGO) + bcrypt + WebSocket (gofiber/contrib/websocket)
- **Frontend**: Angular 20 (standalone components, new `@if`/`@for` control flow) + Tailwind v4 (`@import "tailwindcss"` in CSS) + PWA (`@angular/service-worker`)
- **Infra**: Docker Compose (primary run-and-go), nginx reverse-proxy in frontend container

## Project structure
```
backend/       # Go module: my-chat-backend (repo: meow-chat)
  main.go      # entrypoint, route registration
  database/    # SQLite init + auto-migration (federation tables included)
  handlers/    # REST handlers + WebSocket hub (in-memory per-process)
    groups.go  # group chat CRUD + invites + messages (2026-06-07)
    admin_federation.go  # admin federation API endpoints (2026-06-12)
    federation_globals.go  # federation package globals bridge (2026-06-12)
  federation/  # Federation/hive package (transport, queue, health, handlers, route, mediator)
  cache/       # LRU disk cache for federation
  models/      # request/response structs
uploads/avatars/ # avatar images (auto-created on server start)
uploads/posts/   # post images (auto-created on server start)
uploads/federation_cache/ # cached files from federated peers (created on server start)
frontend/
  src/app/
      components/{login,register,feed,chat,layout,admin,join-group,admin-federation,device-auth}/  # standalone components
    services/api.service.ts                        # all API calls + WebSocket connect
  proxy.conf.js   # dev API proxy → localhost:8080, with WS support
  nginx.conf      # prod: /api → backend:8080, SPA fallback
  ngsw-config.json # service worker (production only)
```

## Preferences
- **Execution style**: Inline (execute tasks in current session, not subagent-driven)
- **TODO**: See `TODO.md` in repo root for remaining tasks

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
- **Pinned users**: `pinned_users` DB table (`user_id`, `pinned_user_id`). API: `GET /api/pinned`, `POST /api/pin/:id`, `DELETE /api/pin/:id`. Frontend stores pins in `cachedPins` localStorage, sorted into separate "Закреплённые" section above "Все пользователи". Each item has pin toggle button.
- **Mobile user list items**: Each user in mobile chat list is a standalone `.card` with `space-y-2` gap — no container background, individual cards per user.
- **Message images**: `message_images` DB table (`id`, `message_id`, `image_url`). `POST /api/messages` accepts `multipart/form-data` with `content` + `images` (max 10, jpg/png/gif/webp, 10MB each). Images saved to `./uploads/messages/`. `GET /api/messages` returns `images[]` per message. WS broadcasts `images: string[]`. Frontend has image picker button, preview strip, renders images inside bubbles (clickable to open in new tab).
- **Monochrome icons**: All UI icons (buttons, indicators, labels) must use monochrome SVGs with `currentColor`, never colorful emoji. The only exception is reaction emojis on posts. Settings theme selector uses inline SVGs, not ☀️🌙💻 emoji.

## Sessions
Session history is documented in `docs/sessions/` (one file per session).
Use `leankg` to query the knowledge graph:
```sh
leankg status                    # index stats
leankg query "federation" --kind file  # search session docs
```

## TBD (Future work)

- **Multi-device encryption**: Currently E2EE keys are stored in IndexedDB per-device. No key sync between devices. Solution: export/import key via QR code or password-encrypted backup, or use WebAuthn credential ID as a key wrapping mechanism.
- **Multi-server collaboration**: The WebSocket hub is in-memory per-process. Horizontal scaling requires a pub/sub layer (Redis/NATS) for WebSocket events, push state, and online status across instances.
- **Federation `AdminConnectFederation`**: Handler currently returns stub — needs full invite token validation + server-to-server handshake.
- **Federation `HandleForwardPostImages`**: Not yet implemented — needed for image proxying to federated peers.
- **UI fixes**: Various UI polish items — PWA install prompt, chat list virtualization for large groups, optimistic message sending with proper rollback, image upload progress indicators.
