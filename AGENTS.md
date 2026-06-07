# MeowChat repo guide

## Stack
- **Backend**: Go 1.23 + Fiber v2 + SQLite (go-webauthn for biometric auth) (via mattn/go-sqlite3, CGO) + bcrypt + WebSocket (gofiber/contrib/websocket)
- **Frontend**: Angular 20 (standalone components, new `@if`/`@for` control flow) + Tailwind v4 (`@import "tailwindcss"` in CSS) + PWA (`@angular/service-worker`)
- **Infra**: Docker Compose (primary run-and-go), nginx reverse-proxy in frontend container

## Project structure
```
backend/       # Go module: my-chat-backend
  main.go      # entrypoint, route registration
  database/    # SQLite init + auto-migration (4 tables: users, messages, posts, post_images)
  handlers/    # REST handlers + WebSocket hub (in-memory per-process)
    groups.go  # group chat CRUD + invites + messages (2026-06-07)
  models/      # request/response structs
uploads/avatars/ # avatar images (auto-created on server start)
uploads/posts/   # post images (auto-created on server start)
frontend/
  src/app/
     components/{login,register,feed,chat,layout,admin,join-group}/  # standalone components
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
- Fixed favicon transparency for dark theme — `favicon.png`
- **Badging API**: `navigator.setAppBadge()` unread count on PWA icon, cleared on focus/chat navigation — `app.ts`
- **WS connection fix**: Moved `connectWebSocket()` from `ApiService` constructor to `App.ngOnInit()`, added 3s auto-reconnect on close — `api.service.ts`, `app.ts`

## Session (2026-05-31) — Push notifications + WS reconnect + badges
- **Push fix**: Moved push trigger from `SendMessage` HTTP handler to hub broadcast handler. Push sent when `!delivered` (no WS client received the message) instead of `!onlineUsers[toUserID]` — eliminates iOS background message loss during 30s grace period — `handlers/handlers.go`
- **Early permission request**: `this.#notif.requestPermission()` in `App.ngOnInit()` regardless of SW state — `app.ts`
- **Persistent WS reconnect**: Reconnect timer moved into `onclose` handler so it fires on EVERY disconnect — `api.service.ts`
- **Token refresh before WS reconnect**: `isJwtExpired()` check, refresh via `refreshToken()` if expired, prevents infinite reconnect loop with stale token — `api.service.ts`
- **Auto-scroll chat**: `data-scroll-container` attribute + `document.querySelectorAll` + double `requestAnimationFrame` for reliable scroll-to-bottom — `chat.ts`
- **Update banner safe area**: `padding: calc(10px + env(safe-area-inset-top, 0px))` — `app.ts`
- **Unread badges**: `unreadCounts` signal + `totalUnread` computed in `ApiService`, badges on nav links (`.badge-nav`/`.badge-nav-sm`) and user list items (`.badge-user`), cleared on `selectUser()` and `/chat/:id` route — `api.service.ts`, `app.ts`, `layout.ts`, `chat.ts`, `styles.css`

## Session (2026-05-31) — Unread message divider
- **Unread divider**: Visual separator between read and unread messages in chat — `chat.ts`, `chat.html`
- **Backend `created_at`**: Added `createdAt` to `wsMessage` struct + WS broadcast payload for boundary tracking — `handlers/handlers.go`
- **`unreadBoundaries` signal**: Tracks first unread message timestamp per user in `ApiService`, set via `incrementUnread(createdAt)` — `api.service.ts`
- **30s boundary timeout**: Divider stays visible for 30s after opening chat (survives duplicate `selectUser` calls from `route.paramMap` + `resolvePendingChat`), then clears — `chat.ts`
- **Separated clear**: `clearUnread` no longer clears boundary; new `clearUnreadBoundary` for explicit boundary cleanup — `api.service.ts`
- **Divider CSS**: `.unread-divider` with accent horizontal lines + "Новые сообщения" label — `styles.css`

## Session (2026-06-06) — Admin role + admin panel
- **Admin role**: Added `is_admin INTEGER DEFAULT 0` column to `users` table — `database/database.go`
- **Seed admin**: `SeedAdmin()` creates `admin`/`admin` on first launch — `database/database.go`
- **JWT**: Added `IsAdmin` to Claims, `GenerateAccessToken` accepts `isAdmin` — `auth/jwt.go`
- **Middleware**: `AdminRequired` checks `c.Locals("isAdmin")` — `handlers/auth.go`
- **Admin endpoints**: `GET /api/admin/users`, `POST /api/admin/users/:id/make-admin`, `POST /api/admin/users/:id/remove-admin`, `GET /api/admin/files` — `handlers/handlers.go`, `main.go`
- **CLI**: `go run . admin add/remove/list/reset-password` — `main.go`
- **Admin badge**: Shield icon overlay on all user avatars when `is_admin === true` — `layout.ts`, `feed.ts`, `chat.ts`
- **Admin panel page**: `/admin` with two tabs (User Management + File Management), nav link visible only to admins — `admin.ts`, `app.routes.ts`, `layout.ts`
- **Frontend API**: Added `getAdminUsers()`, `adminMakeAdmin()`, `adminRemoveAdmin()`, `getAdminFiles()` — `api.service.ts`
- **Project structure**: Added `components/admin/` to project tree — `AGENTS.md`

## Session (2026-06-06) — Friends system + reactions + local fonts + image grid
- **Friends system**: `friends` + `friend_invites` tables — `database/database.go`
- **Friend endpoints**: `POST /api/friend-invites`, `GET /api/friend-invite/:token`, `POST /api/friend-invite/:token/accept`, `GET /api/friends`, `DELETE /api/friends/:id` — `handlers/handlers.go`, `main.go`
- **Feed filtered**: `GET /api/feed` shows only friends' + own + public posts — `handlers/handlers.go`
- **Users filtered**: `GET /api/users` returns only friends — `handlers/handlers.go`
- **Fix nil slice → null JSON**: Changed `var x []T` to `make([]T, 0)` in GetUsers, GetFriends, GetFeed, GetMessages, GetPinned, GetMyInvites, AdminListFiles, AdminListUsers — `handlers/handlers.go`
- **Frontend friends**: `FriendInvite` interface, API methods, friends section in settings with link + QR creation, `AddFriendComponent` at `/add-friend?token=` for accepting — `api.service.ts`, `settings.ts`, `add-friend.ts`, `app.routes.ts`
- **Login redirect**: Login supports `?redirect=` param, returns to `/add-friend?token=` after auth — `login.ts`
- **Public posts**: `is_public` column on `posts`, checkbox "Показать всем" in post creator — `database/database.go`, `handlers/handlers.go`, `feed.ts`, `api.service.ts`
- **Admin disk info**: `syscall.Statfs` in `AdminListFiles`, disk usage bar in admin panel — `handlers/handlers.go`, `admin.ts`, `api.service.ts`
- **Post reactions**: `post_reactions` table, `POST /api/posts/:id/react` toggle, reactions in `GET /api/feed` — `database/database.go`, `handlers/handlers.go`, `models/models.go`, `main.go`, `feed.ts`, `api.service.ts`
- **Local fonts**: Downloaded Plus Jakarta Sans woff2, stored in `public/fonts/`, `@font-face` with variable weight 400-700 replaces Google Fonts import — `styles.css`, `public/fonts/`
- **Smart image grid**: 1/2/3/4+ layout, 5+ shows first 4 with +N overlay, fullscreen viewer with prev/next nav + counter — `styles.css`, `feed.ts`
- **Auth interceptor fix**: Excluded `/logout` from 401 refresh loop; `logout()` skips HTTP call if no token — `auth.interceptor.ts`, `api.service.ts`

## Session (2026-06-07) — WebAuthn biometric auth (Face ID / Touch ID)
- **WebAuthn**: Added `go-webauthn/webauthn` library for WebAuthn — `handlers/webauthn.go`
- **Database**: `webauthn_credentials` table (credential_id, public_key, attestation_type, aaguid, sign_count) — `database/database.go`
- **API endpoints**: `POST /api/webauthn/begin-registration`, `POST /api/webauthn/finish-registration`, `POST /api/webauthn/begin-login`, `POST /api/webauthn/finish-login`, `GET /api/webauthn/credentials`, `DELETE /api/webauthn/credentials/:id`, `POST /api/webauthn/has-credentials`
- **Login page**: Biometric login button appears when user has registered credentials — `login.ts`
- **Settings**: Biometric management section — register/remove Face ID / Touch ID — `settings.ts`
- **Dockerfile**: Updated to `golang:1.23-alpine` (webauthn deps require Go 1.23+)
- **Env vars**: `WEBAUTHN_RP_ID` (default `localhost`), `WEBAUTHN_RP_ORIGIN` (default `http://localhost:4200`)
- **WebAuthn binary fields fix**: Added `prepareWebAuthnOptions()` helper that converts base64url strings → `Uint8Array` for `challenge`, `user.id`, and credential ids before passing to `navigator.credentials.create()`/`.get()` — `login.ts`, `settings.ts`
- **Auth page cleanup**: Removed registration link from login page — `login.ts`
- **localStorage parse fix**: Guard against `"undefined"` string in `currentUser` — `api.service.ts`

## Session (2026-06-07) — Message types + Group chats
- **Message types**: Added `msg_type` field to messages model (text/image/sticker/gif/poll) — `backend/models/models.go`, `database/database.go`
- **Backend**: `wsMessage` struct gains `msgType`, `SendMessage` reads `type` from form, hub broadcasts `msg_type` in WS payload — `handlers/handlers.go`
- **Frontend**: `MsgType` type, `msg_type` in `Message`/`WsMessage`, type selector row (5 types) in chat input, rendering switches on `msg_type` — `chat.ts`, `api.service.ts`, `app.ts`
- **Group chats**: `group_chats`, `group_chat_members`, `group_chat_invites`, `group_messages`, `group_message_images` tables — `database/database.go`
- **Group endpoints**: CRUD groups, add/remove members, invite tokens (link + QR), send/receive group messages — `handlers/groups.go`
- **WebSocket group broadcast**: `broadcastGroup` channel, distributes to all online group members, push to offline — `handlers/handlers.go`
- **Frontend group UI**: Group section in chat sidebar, create group modal, group info (members + invites), sender names in group messages, WS handling for `group_message` events — `chat.ts`
- **Join group page**: `/join-group?token=` with invite validation + accept button — `join-group.ts`, `app.routes.ts`
- **All modals use inline styles** (no external CSS dependencies)

## Session (2026-06-06) — Invite-only registration + notification fixes
- **Push sound fix**: Reused Audio element, handled `play()` promise rejection, added `silent: true` to Notification to suppress system sound — `notification.service.ts`
- **SW push fix**: Added `silent: true` to `showNotification()` in SW — `sw-push-handler.js`
- **Sound caching**: Added `.mp3` to `ngsw-config.json` asset patterns — `ngsw-config.json`
- **Invite tokens**: Added `invite_tokens` table (id, created_by, token, max_uses, use_count, expires_at) — `database/database.go`
- **Invite API**: `POST/GET/DELETE /api/invites`, `GET /api/invite/:token` — `handlers/handlers.go`, `main.go`
- **Registration**: Now requires `invite_token`, validated before user creation — `handlers/handlers.go`, `models/models.go`
- **Frontend invite API**: `InviteToken` interface, `createInvite/getMyInvites/deleteInvite/checkInvite` — `api.service.ts`
- **Register page**: Reads `?invite=TOKEN` from URL or shows manual input — `register.ts`
- **Settings — Invites**: Section to create, copy link, fullscreen QR overlay, revoke invites — `settings.ts`
- **QR code**: `qrcode` npm package, fullscreen overlay with copy button — `settings.ts`, `package.json`
