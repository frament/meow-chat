# MeowChat repo guide

## Stack
- **Backend**: Go 1.26 + Fiber v2 + SQLite (go-webauthn for biometric auth) (via mattn/go-sqlite3, CGO) + bcrypt + WebSocket (gofiber/contrib/websocket)
- **Frontend**: Angular 20 (standalone components, new `@if`/`@for` control flow) + Tailwind v4 (`@import "tailwindcss"` in CSS) + PWA (`@angular/service-worker`)
- **Infra**: Docker Compose (primary run-and-go), nginx reverse-proxy in frontend container (planned removal in `v2.0.0` — single binary serves the SPA; see `ROADMAP.md`)

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
- **Roadmap**: See `ROADMAP.md` for the versioned plan (milestones per release)
- **Dependencies move forward, not sideways.** A newer version of a tool or library is the default choice, and a breaking change in it is a task to do rather than a reason to stay put. Where taking the new version means the code has to be fixed, fix the code. Pinning something back to keep a diff small is a decision that has to be argued for out loud, not something to do quietly as a side effect of a `go get`.

## Positioning & roadmap
- **Product**: home chat server for a family — one instance ≈ one household, target scale **up to ~100 users**. Federation joins families into a mesh.
- **Priorities**: reliability → update simplicity → new features.
- **Non-goals**: horizontal scaling, multi-instance, Kubernetes, pub/sub (Redis/NATS) for WS/online status, SaaS/multi-tenant.

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
- **Versioning (three independent versions)**: App SemVer (`version/version.go` → `version.Version`) is the product release shown by `/api/version`. Schema version (`database.CurrentMajor`, currently `1`) gates DB startup — MAJOR mismatch is fatal. Federation handshake compares **schema MAJOR**, NOT the app version (`federation/handler.go`, `handlers/admin_federation.go`). Consequence: bumping the app MAJOR does not break federation unless the schema MAJOR changes.
- **Auth**: JWT access/refresh tokens. Login returns `{ access_token, refresh_token, user }`. Access token (15min) sent via `Authorization: Bearer` header. Refresh token (7 days) stored in localStorage, auto-refreshed via HTTP interceptor on 401. Backend enforces via `handlers.AuthRequired` middleware. Endpoints without auth: `/api/register`, `/api/login`, `/api/refresh`.
- **WebSocket**: In-memory hub per process. Does not scale beyond one instance. WS endpoint at `/api/ws?token=` (access token as query param).
- **PWA**: Service worker registers only in production build (`!isDevMode()`). Dev mode has no SW.
- **Tailwind v4**: Configured via `@import "tailwindcss"` in `styles.css`. No `tailwind.config.js`. Requires `frontend/.postcssrc.json` with `{ "plugins": { "@tailwindcss/postcss": {} } }` — Angular's Vite builder does NOT auto-detect `@tailwindcss/postcss` without it.
- **No linter/formatter**: Neither backend nor frontend has lint/format config beyond Angular CLI defaults.
- **Tests**: Angular has Karma/Jasmine setup (`ng test`); backend has a Go test suite (`make test-backend`). CGO + parallel compilation kills RAM on Intel Macs (16GB) — the Makefile flags limit parallelism.
- **Never run the two test suites at the same time.** One suite at a time, in the foreground, and only when a green run is actually needed. Running `go test ./...` and `ng test` concurrently (or in background) exhausts RAM and macOS starts killing apps — Finder, the editor — mid-run. The `-p=2 -parallel=2` flags only bound parallelism *within* one `go test`; they do nothing across two processes. `npm run build` and `go build` are heavy for the same reason — don't pair them either.
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
- **Image compression**: `backend/imageproc` (pure Go: `golang.org/x/image/draw` + stdlib `image/jpeg`, no CGO so it survives v2.0.0). Policy decided 2026-10-02: **JPEG only**, quality 82, long side ≤ 1920px, the smaller of the two files wins (5% threshold), original discarded. PNG/GIF/WebP pass through byte for byte. Measured on a real prod photo: 2 932 308 → 408 953 bytes (−86%).
  - All four upload paths (`CreatePost`, `SendMessage`, `UploadAvatar`, group `SendMessage`) go through `handlers.saveImage` → `imageproc.Store`, and so does `federation.cacheRemoteImage` — do not reintroduce `c.SaveFile` or a direct `os.WriteFile` for images. Stickers are deliberately left alone.
  - **The extension comes from the bytes** (`imageproc.Sniff`), not the client's filename: `app.Static` derives Content-Type from it, so a JPEG sent as `photo.png` used to be served as `image/png`. Filenames also pass through `safeStem`, which strips directory components.
  - **EXIF orientation is applied to the pixels before resizing.** Phone photos store pixels sideways with a tag saying how to turn them; browsers read the tag, Go's decoder does not, and the encoder never writes it. Without this, re-encoding turned upright photos sideways. `imageproc.exifOrientation` parses the tag itself — stdlib has no EXIF reader.
  - **Thumbnails**: 400px (`thumb_url`, chat bubbles) and 1200px (`preview_url`, feed), under `./uploads/thumbs/<dir>/<base>_<size>.jpg`. **Not in the database** — `imageproc.ThumbURLs(image_url)` derives the paths and stats them, so images predating the feature answer empty and the client falls back to `image_url` with no 404 and no migration. `thumbName` is the single place that naming is decided; `Store` writes it and `ThumbURLs` looks for it.
  - Known gaps, all in ROADMAP Backlog: WebP is never compressed or thumbnailed (no pure-Go WebP encoder exists), EXIF survives on images already small enough to keep, and PNG photos are not touched.
- **Federation offline queue is not wired up.** `Queue.Enqueue` has no callers outside its own tests, and `handlers.SendMessage` calls `fedTransport.Send` while discarding both return values — so a message to an unreachable peer is lost, not queued. Separately, `HealthChecker` pings once at 30s and then every 60 minutes, and `DrainFailed` only fires on the `unreachable` → `active` transition, so even a connected queue would deliver an hour late and never after a brief blip. Recorded in ROADMAP v1.6.0 as open. `cmd/e2e-test`'s offline-queue step is best-effort and does fail for this reason.
- **`cmd/e2e-test` builds its own server binary** (`go build` into the temp dir, `moduleRoot()` walks up for `go.mod`) and `waitForHealth` returns an error. Both were broken before: nothing built the binary, `cmd.Start()`'s error was discarded, `waitForHealth` returned nothing, so a run that started no servers at all printed "✓ Both servers healthy" and carried on. Run it from either the repo root or `backend/`.
- **Relative time**: `LastSeenPipe` is pure and takes the current time as an **argument** (`| lastSeen: clock.now()`), fed by `ClockService` — a root-provided signal ticking once a minute. Do not move the `Date.now()` read back inside `transform`: a pure pipe only re-runs when an argument changes, so that is what would freeze the text on screen. Do not make the pipe impure either — that rebuilds every row on every change detection pass. Six call sites, in `chat.ts` (4) and `admin.ts` (2).

## Sessions
Session history is documented in `docs/sessions/` (one file per session).
Use `leankg` to query the knowledge graph:
```sh
leankg status                    # index stats
leankg query "federation" --kind file  # search session docs
```

## TBD (Future work)

See `ROADMAP.md` for the versioned plan (milestones per release). Highlights:

- **Multi-device E2EE** (ROADMAP v1.7.0): implemented — per-device key registry, per-device message envelopes, group key shares scoped to device + epoch, revocation. Key backup/restore by account password or recovery phrase (`/devices/backup-keys`, `/devices/recover`) + UI in settings and `device-auth`. **Residual limitation:** a revoked device still holds valid account credentials and can re-register itself; cryptographic revocation only prevents reading *new* messages without re-approval. Details: `docs/plans/per-device-e2ee.md`, section 12.
- **Multi-server collaboration**: The WebSocket hub is in-memory per-process. Horizontal scaling would need a pub/sub layer — but this is an **explicit non-goal** (target scale: one household, ≤100 users).
- **Federation `AdminConnectFederation`** (ROADMAP v1.6.0): implemented — full handshake with invite-token validation, 404/410/409 handling, schema-MAJOR check. Was long listed as a stub; it isn't.
- **Federation post image proxying** (ROADMAP v1.6.0): implemented as `HandleForwardPost` → `cacheRemoteImage` (downloads the peer's file into `uploads/posts/`, stores the local URL, falls back to the remote URL on failure). There is no function named `HandleForwardPostImages` — earlier notes referred to one.
- **UI fixes**: PWA install prompt (open, ROADMAP v1.5.0). Done: optimistic send with rollback, message image upload progress, post-install welcome push. Chat list virtualization was dropped (2026-10-02) — `@angular/cdk` is installed but unused, and there is nothing to virtualize while both message feeds are capped at `LIMIT 100` server-side.
