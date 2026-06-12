# Backup & Restore System Design

## Overview

CLI and admin panel backup/restore system for MeowChat. Backup includes SQLite database, server encryption keys, VAPID keys, and uploads. Restore preserves federation identity so the server reconnects to the mesh without extra steps.

## Backup Contents

Zip archive with flat structure:

```
chat.db                 # SQLite — consistent snapshot via VACUUM INTO
server_key.bin          # AES-256-GCM key for push copies (data/server_key.bin)
vapid_keys.json         # Web Push VAPID key pair
avatars/                # uploads/avatars/* — all files
posts/                  # uploads/posts/* — all files
messages/               # uploads/messages/* — all files
```

Excluded (regenerated automatically):
- `uploads/federation_cache/` — lazy re-fetch from peers
- `federation_queue` rows — dropped on restore
- `federation_network` — rediscovered via gossip
- `federation_cache_entries` — rebuilt after restore

## Configuration

File: `data/backup-config.json`

```json
{"backup_dir": "./backups"}
```

Not stored in DB so it survives DB restore. API for read/write.

## Directory Structure

- `backup_dir` (default `./backups/`) — stores all `.zip` backup files
- `backup_dir` is configurable via API/CLI
- Created automatically on first backup

## Docker Compose Changes

Add volume mount to persist backup directory across container restarts:

```yaml
volumes:
  - ./backups:/app/backups
```

## CLI Commands

### `go run . admin backup [path]`

Creates a backup zip. If `path` is provided, uses it directly. If omitted, reads `backup_dir` from `data/backup-config.json`. Default: `./backups/`.

Steps:
1. Create `backup_dir` if not exists
2. `VACUUM INTO 'backup_dir/chat-backup.db'` — atomic SQLite snapshot without blocking
3. Build zip `backup_dir/backup-YYYY-MM-DDTHHmmss.zip`:
   - Rename `chat-backup.db` → `chat.db` inside zip
   - Copy `server_key.bin` (from `DB_PATH` dir, default `data/`)
   - Copy `vapid_keys.json` (from working directory)
   - Recursively add `uploads/avatars/`, `uploads/posts/`, `uploads/messages/`
4. Delete temporary `backup_dir/chat-backup.db`
5. Output filename to stdout

### `go run . admin restore <file.zip>`

Restores a backup. Requires absolute or relative path to zip.

Steps:
1. **Detect environment**: check existence of `/.dockerenv` file
2. **Stop server** (if running):
   - Non-Docker: find PID via TCP port (default 8080). On Windows: `netstat -ano | findstr :PORT`. On Linux: `lsof -ti :PORT`. Send `SIGTERM` (Win: `taskkill /PID`), wait 10s polling port, force kill if still alive (Win: `taskkill /F /PID`)
   - Docker: skip killing (will restart via `restart: unless-stopped` after extraction)
3. **Extract zip**:
   - `chat.db` → `data/chat.db` (from `DB_PATH` env or default)
   - `server_key.bin` → `data/server_key.bin`
   - `vapid_keys.json` → `./vapid_keys.json`
   - `avatars/*` → `uploads/avatars/`
   - `posts/*` → `uploads/posts/`
   - `messages/*` → `uploads/messages/`
4. **Restart server**:
   - Non-Docker: start binary with same env (`os.StartProcess` of `./server` or `go run .`)
   - Docker: `syscall.Kill(1, syscall.SIGTERM)` → Docker restart policy restarts container
5. If no running server found: extract only, print "Restored. Start the server manually."

## Admin API

### `/api/admin/backup-settings`

| Method | Description | Request | Response |
|--------|-------------|---------|----------|
| `GET` | Read current config | — | `{"backup_dir": "./backups"}` |
| `PUT` | Update config | `{"backup_dir": "/mnt/nfs/backups"}` | `{"message": "Saved"}` |

Validates directory is writable (creates test file).

### `/api/admin/backups`

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/api/admin/backups` | List backups | `[{"filename": "backup-...zip", "size_bytes": 12345, "created_at": "..."}]` |
| `POST` | `/api/admin/backup` | Create new backup | `{"filename": "backup-...zip", "size_bytes": 12345}` |
| `GET` | `/api/admin/backups/:filename` | Download backup | Binary zip stream |
| `POST` | `/api/admin/backups/upload` | Upload backup | `{"filename": "backup-...zip"}` |
| `DELETE` | `/api/admin/backups/:filename` | Delete backup | `{"message": "Deleted"}` |
| `POST` | `/api/admin/backups/:filename/restore` | Restore from backup | `{"message": "Restore in progress — restarting server"}` |

### Restore Flow (Admin API)

1. Admin clicks "Restore" on a backup in the UI
2. `POST /api/admin/backups/:filename/restore`
3. Backend:
   a. Creates `data/.maintenance` file
   b. Extracts everything EXCEPT `chat.db` to live paths:
      - `server_key.bin` → `data/server_key.bin`
      - `vapid_keys.json` → `./vapid_keys.json`
      - `uploads/*` → `uploads/`
   c. Extracts `chat.db` → `data/chat-restored.db` (temporary name)
   d. Creates `data/.restore-pending` JSON: `{"filename": "backup-xxx.zip"}`
   e. Responds `200`
4. Backend sends `SIGTERM` to PID 1 (graceful shutdown)
5. Docker restarts container via `restart: unless-stopped`
6. On startup (before `migrate()`):
   a. Check if `data/chat-restored.db` exists
   b. If yes: rename `chat-restored.db` → `chat.db`
   c. Delete `data/.maintenance` and `data/.restore-pending`
   d. Run normal startup (migrate, health checker, etc.)

### Maintenance Mode

- File marker: `data/.maintenance` (empty file)
- All endpoints (except `/api/health`) check for file existence → return `503 {"error": "Server is in maintenance mode"}`
- `/api/health` returns `{"status": "maintenance"}` instead of `{"status": "ok"}`
- Middleware checks maintenance BEFORE auth

## Frontend Admin Panel

New section "Бэкапы" in admin panel with tabs: Backup / Settings.

### Backup tab
- Table with columns: Filename, Size, Date, Actions
- Action buttons per row: Download, Restore, Delete
- "Создать бэкап" button above table → creates and refreshes list
- "Загрузить бэкап" button → file picker → upload → refreshes list
- Confirm dialog on Restore and Delete

### Settings tab
- Input field for backup directory path
- "Сохранить" button

### Maintenance Overlay

- App component polls `/api/health` every 3 seconds
- Response `{"status": "maintenance"}` → full-screen overlay "Сервер восстанавливается..."
- Response `{"status": "ok"}` → `location.reload()` (removes overlay, Angular reinitializes)
- Overlay uses CSS custom properties for theme consistency

### API Methods

```
getBackupSettings()     // GET /api/admin/backup-settings
updateBackupSettings()  // PUT /api/admin/backup-settings
getBackups()            // GET /api/admin/backups
createBackup()          // POST /api/admin/backup
downloadBackup()        // GET /api/admin/backups/:filename (blob)
uploadBackup(file)      // POST /api/admin/backups/upload (FormData)
deleteBackup(filename)  // DELETE /api/admin/backups/:filename
restoreBackup(filename) // POST /api/admin/backups/:filename/restore
```

## Federation Reconnection

After restore:
- Database has `federation_servers` entries with all peer tokens intact
- `server_key.bin` is restored — push copies remain decryptable
- `vapid_keys.json` is restored — existing push subscriptions remain valid
- Health checker pings all peers (60min ticker + initial 30s delay)
- Peers recognize our token (unchanged) → status stays `active`
- Queue drains any pending items
- No extra steps needed — federation resumes automatically

## Implementation Order

1. Backup config (`data/backup-config.json`): read/write helper
2. `admin backup` CLI command
3. `admin restore` CLI command (auto-stop/start)
4. Maintenance mode middleware (503 check)
5. Admin API: backup-settings + backups (list/create/download/upload/delete)
6. Admin API: restore endpoint (extract + restart)
7. Docker compose volume mount for backups
8. Startup handler (check chat-restored.db → rename)
9. Frontend: backup section + API methods
10. Frontend: maintenance overlay in App component
