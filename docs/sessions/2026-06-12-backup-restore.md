# Session 2026-06-12 — Backup & Restore + Windows build fix + SQLite fix

## Backup & Restore system
- **Spec & plan**: Written to `docs/superpowers/specs/2026-06-12-backup-restore-design.md` and `docs/superpowers/plans/2026-06-12-backup-restore-plan.md`
- **Config**: `data/backup-config.json` with `backup_dir` (default `./backups/`), editable via API `GET/PUT /api/admin/backup/settings` — `backend/backup/config.go`
- **Core backup**: `CreateBackup()` uses SQLite `VACUUM INTO` for atomic snapshot, zips DB + `server_key.bin` + `vapid_keys.json` + uploads — `backend/backup/backup.go`
- **Core restore**: `RestoreFromZip()` extracts all files to correct paths — `backend/backup/backup.go`
- **Process helpers**: PID file, `FindProcess()`, `StopProcess()`, `IsDocker()`, `ShutdownContainer()`, `SendRestartSignal()` — cross-platform via build tags — `backend/backup/process.go`, `process_windows.go`
- **CLI**: `go run . admin backup [path]` and `go run . admin restore <file.zip>` — `backend/main.go`
- **Startup handler**: Checks `data/chat-restored.db` → renames to `chat.db`, removes markers — `backend/main.go`
- **PID file**: Server writes PID on startup for CLI to find/kill — `backend/main.go`
- **Admin API**: 8 endpoints — list, create, download, upload, delete backups + restore endpoint — `backend/handlers/backup.go`
- **Health endpoint**: `GET /api/health` → `{"status":"ok"}` or `{"status":"maintenance"}` — `backend/main.go`
- **Maintenance mode**: File marker `data/.maintenance` → all endpoints return 503 (except `/api/health`) — `backend/handlers/backup.go`
- **Docker**: Added `./backups:/app/backups` volume — `docker-compose.yml`
- **Frontend API**: 9 methods — `api.service.ts`
- **Frontend admin**: "Бэкапы" tab in admin panel — `admin.ts`
- **Frontend maintenance**: Poll `/api/health` every 3s, full-screen overlay on maintenance — `app.ts`

## Bugfixes
- **Windows build fix**: Extracted `syscall.Statfs` behind `//go:build !windows` — `handlers/disk_unix.go`, `handlers/disk_windows.go`
- **Windows `syscall.Kill` fix**: Moved to `backup.SendRestartSignal()` / `backup.ShutdownContainer()` with platform build tags — `backend/backup/process.go`, `process_windows.go`
- **SQLite UNION ORDER BY fix**: Fixed `ORDER BY created_at DESC` → `ORDER BY 4 DESC` in `GetFeed`, `ORDER BY username` → `ORDER BY 2` in `GetUsers` — `handlers/handlers.go`
- **Feed error logging**: Added `log.Printf` to `GetFeed` query error — `handlers/handlers.go`

## UI fixes
- **Admin federation tab**: Changed from separate route to in-page tab — `admin.ts`
- **Chat `+` button alignment**: Replaced text `+` with SVG icon — `chat.ts`
- **Chat label**: Renamed "Все пользователи" to "Друзья" — `chat.ts`
