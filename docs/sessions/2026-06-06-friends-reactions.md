# Session 2026-06-06 — Friends system + reactions + local fonts + image grid

## Features

### Friends system
- `friends` + `friend_invites` tables — `database/database.go`
- Friend endpoints: `POST /api/friend-invites`, `GET /api/friend-invite/:token`, `POST /api/friend-invite/:token/accept`, `GET /api/friends`, `DELETE /api/friends/:id` — `handlers/handlers.go`, `main.go`
- Feed filtered: `GET /api/feed` shows only friends' + own + public posts — `handlers/handlers.go`
- Users filtered: `GET /api/users` returns only friends — `handlers/handlers.go`
- Frontend friends: `FriendInvite` interface, API methods, friends section in settings with link + QR creation, `AddFriendComponent` at `/add-friend?token=` — `api.service.ts`, `settings.ts`, `add-friend.ts`, `app.routes.ts`
- Login redirect: supports `?redirect=` param, returns to `/add-friend?token=` after auth — `login.ts`

### Fix nil slice → null JSON
- Changed `var x []T` to `make([]T, 0)` in GetUsers, GetFriends, GetFeed, GetMessages, GetPinned, GetMyInvites, AdminListFiles, AdminListUsers — `handlers/handlers.go`

### Public posts
- `is_public` column on `posts`, checkbox "Показать всем" in post creator — `database/database.go`, `handlers/handlers.go`, `feed.ts`, `api.service.ts`

### Admin disk info
- `syscall.Statfs` in `AdminListFiles`, disk usage bar in admin panel — `handlers/handlers.go`, `admin.ts`, `api.service.ts`

### Post reactions
- `post_reactions` table, `POST /api/posts/:id/react` toggle, reactions in `GET /api/feed` — `database/database.go`, `handlers/handlers.go`, `models/models.go`, `main.go`, `feed.ts`, `api.service.ts`

### Local fonts
- Downloaded Plus Jakarta Sans woff2, stored in `public/fonts/`, `@font-face` with variable weight 400-700 replaces Google Fonts import — `styles.css`, `public/fonts/`

### Smart image grid
- 1/2/3/4+ layout, 5+ shows first 4 with +N overlay, fullscreen viewer with prev/next nav + counter — `styles.css`, `feed.ts`

### Auth interceptor fix
- Excluded `/logout` from 401 refresh loop; `logout()` skips HTTP call if no token — `auth.interceptor.ts`, `api.service.ts`
