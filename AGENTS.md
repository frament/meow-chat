# MyChat repo guide

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
