# Session 2026-06-06 — Admin role + admin panel

## Features

### Database
- Added `is_admin INTEGER DEFAULT 0` column to `users` table — `database/database.go`
- `SeedAdmin()` creates `admin`/`admin` on first launch — `database/database.go`

### Auth
- Added `IsAdmin` to Claims, `GenerateAccessToken` accepts `isAdmin` — `auth/jwt.go`
- `AdminRequired` middleware checks `c.Locals("isAdmin")` — `handlers/auth.go`

### Admin endpoints
- `GET /api/admin/users`, `POST /api/admin/users/:id/make-admin`, `POST /api/admin/users/:id/remove-admin`, `GET /api/admin/files` — `handlers/handlers.go`, `main.go`

### CLI
- `go run . admin add/remove/list/reset-password` — `main.go`

### Frontend
- Shield icon overlay on all user avatars when `is_admin === true` — `layout.ts`, `feed.ts`, `chat.ts`
- Admin panel page: `/admin` with two tabs (User Management + File Management), nav link visible only to admins — `admin.ts`, `app.routes.ts`, `layout.ts`
- Added `getAdminUsers()`, `adminMakeAdmin()`, `adminRemoveAdmin()`, `getAdminFiles()` — `api.service.ts`
