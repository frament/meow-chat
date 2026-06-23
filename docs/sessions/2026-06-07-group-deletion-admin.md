# Session 2026-06-07 — Group deletion + admin chat management

## Backend
- `DELETE /api/group-chats/:id` (creator only) — `handlers/groups.go`, `main.go`
- `GET /api/admin/group-chats` (all groups) + `DELETE /api/admin/group-chats/:id` — `handlers/handlers.go`, `main.go`

## Frontend
- Delete group button in group info modal (visible only to creator) — `chat.ts`
- Admin panel "Чаты" tab with table and delete action — `admin.ts`
- Added `deleteGroupChat`, `getAdminGroupChats`, `adminDeleteGroupChat` API methods — `api.service.ts`

## AGENTS.md
- Added `TBD (Future work)` section
