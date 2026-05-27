# MyChat repo guide

## Stack
- **Backend**: Go 1.22 + Fiber v2 + SQLite (via mattn/go-sqlite3, CGO) + bcrypt + WebSocket (gofiber/contrib/websocket)
- **Frontend**: Angular 20 (standalone components, new `@if`/`@for` control flow) + Tailwind v4 (`@import "tailwindcss"` in CSS) + PWA (`@angular/service-worker`)
- **Infra**: Docker Compose (primary run-and-go), nginx reverse-proxy in frontend container

## Project structure
```
backend/       # Go module: my-chat-backend
  main.go      # entrypoint, route registration
  database/    # SQLite init + auto-migration (3 tables: users, messages, posts)
  handlers/    # REST handlers + WebSocket hub (in-memory per-process)
  models/      # request/response structs
uploads/avatars/ # avatar images (auto-created on server start)
frontend/
  src/app/
    components/{login,register,feed,chat,layout}/  # standalone components
    services/api.service.ts                        # all API calls + WebSocket connect
  proxy.conf.js   # dev API proxy → localhost:8080, with WS support
  nginx.conf      # prod: /api → backend:8080, SPA fallback
  ngsw-config.json # service worker (production only)
```

## Commands
```sh
# Production (Docker Compose)
make build       # docker compose build
make up          # docker compose up -d
make down        # docker compose down

# Development (local)
make dev-backend   # cd backend && DB_PATH=./data/chat.db go run .
make dev-frontend  # cd frontend && npm run start  (proxies /api → :8080)

# Frontend build check
cd frontend && npm run build   # production build with service-worker
```

## Key quirks
- **CGO required**: Backend Dockerfile installs `gcc musl-dev` for sqlite3. Local dev needs `CGO_ENABLED=1` (default).
- **Auth**: No JWT. Frontend sends `X-User-Id` header, backend reads it from params/header. Login returns plain JSON saved to localStorage.
- **WebSocket**: In-memory hub per process. Does not scale beyond one instance. WS endpoint at `/api/ws/:userId`.
- **PWA**: Service worker registers only in production build (`!isDevMode()`). Dev mode has no SW.
- **Tailwind v4**: Configured via `@import "tailwindcss"` in `styles.css`. No `tailwind.config.js`. Requires `frontend/.postcssrc.json` with `{ "plugins": { "@tailwindcss/postcss": {} } }` — Angular's Vite builder does NOT auto-detect `@tailwindcss/postcss` without it.
- **No linter/formatter**: Neither backend nor frontend has lint/format config beyond Angular CLI defaults.
- **No tests beyond defaults**: Angular has Karma/Jasmine setup (`ng test`), backend has zero test files.
- **DB auto-migrates** on startup. Schema: `users`, `messages`, `posts` with foreign keys. SQLite WAL mode enabled.
- **Frontend uses Angular standalone components** and new `@if/@for` control flow. Do NOT add `CommonModule` imports.
- **Avatars**: Uploaded via `POST /api/upload-avatar/:userId` (multipart), stored in `./uploads/avatars/`, served via `/uploads/`. Profile update via `PUT /api/profile/:userId`. Users table has `avatar_url TEXT`. Login/GetUsers/GetFeed all return `avatar_url`.
- **Mobile responsive**: Layout has bottom nav on mobile (`sm:hidden`), top nav on desktop. Chat shows user list / chat view one at a time on mobile (`md:hidden` toggle). Feed/Login/Register use responsive padding.
- **Direct chat URL**: `/chat/:userId` opens chat with specific user. User list clicks navigate via router, not direct select.
- **WebSocket fix**: `c.Params("userId")` returns `string` — use `strconv.ParseInt` instead of `v.(float64)` type assertion.
