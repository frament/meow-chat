# Versioning, Update, and Distribution Strategy

**Date:** 2026-06-13
**Status:** Draft

## 1. Versioning Scheme

### 1.1 SemVer (Classic)

```
MAJOR.MINOR.PATCH    e.g., 1.0.0, 1.1.0, 2.0.0
```

| Component | When | Example |
|-----------|------|---------|
| **MAJOR** | Breaking changes: DB schema incompatibility, federation protocol changes, API contract breaking | `1.0.0` → `2.0.0` |
| **MINOR** | New features: new endpoints, new message types, new federation events (backward-compatible) | `1.0.0` → `1.1.0` |
| **PATCH** | Bugfixes, security patches, no contract changes | `1.0.0` → `1.0.1` |

### 1.2 Git Tags

Tags follow SemVer with optional build metadata:
```
v1.0.0
v1.1.0
v2.0.0
```

### 1.3 Service version endpoint

`GET /api/version` returns current version:
```json
{ "version": "1.0.0", "major": 1, "minor": 0, "patch": 0 }
```

### 1.4 Initial release

Current state → `v0.1.0` (pre-release). First stable → `v1.0.0`.

---

## 2. Update/Migration Strategy

### 2.1 Schema Version Table

Add `schema_version` table in SQLite (created by `InitDB()`):

```sql
CREATE TABLE IF NOT EXISTS schema_version (
    major INTEGER NOT NULL DEFAULT 1,
    minor INTEGER NOT NULL DEFAULT 0,
    patch INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

On first run, insert `(1, 0, 0)`. On subsequent runs, compare and migrate.

### 2.2 Startup Migration Flow

```
Start
├── InitDB() creates/migrates schema, stores current version
├── Compare expected version with actual
│   ├── MAJOR differs → FATAL: "Version mismatch: expected v2.x.x, have v1.x.x. Run backup first."
│   ├── MINOR/PATCH differs → auto-migrate (additive only)
│   └── Same → proceed
└── Start server
```

### 2.3 Migration Cases

| Type | DB Changes Allowed | Manual Backup |
|------|-------------------|---------------|
| **PATCH** | None | No |
| **MINOR** | Additive only (new tables, nullable columns) | No |
| **MAJOR** | Breaking (column drops, table renames, index changes) | Yes (via `make backup` or CLI) |

### 2.4 Docker Update Flow

```
make update    # → git pull && docker compose build && docker compose up -d
```

Under the hood:
1. `git fetch --tags`
2. Checkout new tag (or branch)
3. `docker compose build` (rebuild images)
4. `docker compose up -d` (restart containers)

For MAJOR: `BACKUP_BEFORE_UPGRADE=1 make update` (or prompt user).

### 2.5 VDS Direct Update Flow

```
git pull && make install
```

`make install` handles:
1. Stop service (systemctl stop my-chat)
2. Backup DB (optional)
3. Build & install binary
4. Run migrations
5. Restart service

---

## 3. Federation Compatibility

### 3.1 Version in Handshake

Add `version` field to `ServerInfo` struct (federation handshake):

```go
type ServerInfo struct {
    Name    string `json:"name"`
    Version string `json:"version"`   // "1.0.0"
    Major   int    `json:"major"`     // 1
    // ...
}
```

Sent during `HandleJoinInvite` / `AdminConnectFederation`.

### 3.2 Compatibility Check

On incoming federation connection (`HandleJoinInvite`):

```
Receive ServerInfo
├── Major == local Major → ACCEPT
└── Major != local Major → REJECT with error:
    "Incompatible version: server v2.x.x, expected v1.x.x"
```

On outgoing connection (`AdminConnectFederation`):

```
Send ServerInfo
Receive peer ServerInfo
├── Peer Major == local Major → OK
└── Peer Major != local Major → fail with error message
```

### 3.3 Future Extension (not implemented now)

If needed, add feature flags / protocol capabilities:

```json
{
    "version": "1.2.0",
    "major": 1,
    "features": ["message_images", "group_chats", "e2ee", "reactions", "polls"]
}
```

Servers can negotiate a subset of supported features.

---

## 4. Distribution & Installation

### 4.1 Git as Single Source of Truth

No Docker Hub / GHCR. All distribution through Git tags.

### 4.2 Installation Methods

#### Method A: Docker Compose

```bash
git clone https://github.com/.../my-chat.git
cd my-chat
git checkout v1.0.0
make up
```

Uses existing `docker-compose.yml`, `Dockerfile`, `Makefile` targets.

#### Method B: Direct VDS Install (Linux)

```bash
git clone https://github.com/.../my-chat.git
cd my-chat
git checkout v1.0.0
sudo make install
```

`make install` does:
1. Creates user `my-chat` (if not exists)
2. Creates directories: `/var/lib/my-chat/data/`, `/var/lib/my-chat/uploads/{avatars,posts,messages,federation_cache}`
3. Builds backend: `cd backend && go build -o /usr/local/bin/my-chat-server .`
4. Builds frontend: `cd frontend && npm ci && npx ng build`
5. Copies frontend build to `/var/www/my-chat/`
6. Installs systemd unit: `/etc/systemd/system/my-chat.service`
7. Installs nginx config: `/etc/nginx/sites-available/my-chat`
8. Enables and starts services

**systemd unit:**
```
[Unit]
Description=MeowChat Server
After=network.target

[Service]
Type=simple
User=my-chat
WorkingDirectory=/var/lib/my-chat
ExecStart=/usr/local/bin/my-chat-server
Environment=DB_PATH=/var/lib/my-chat/data/chat.db
Environment=WEBAUTHN_RP_ID=example.com
Environment=WEBAUTHN_RP_ORIGIN=https://example.com
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**nginx reverse-proxy config:**
```nginx
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    location /api/ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:8080;
    }

    location / {
        root /var/www/my-chat;
        try_files $uri $uri/ /index.html;
    }
}
```

#### Method C: Windows (Direct)

`install.bat` in repo root:
- Build backend: `cd backend && go build -o my-chat-server.exe .`
- Build frontend: `cd frontend && npm ci && npx ng build`
- Suggests registering as Windows service via `nssm` or running as scheduled task
- Prints instructions for nginx / IIS reverse-proxy

### 4.3 Makefile Targets

| Target | Description |
|--------|-------------|
| `make install` | Full VDS install (Linux, needs sudo) |
| `make install-frontend` | Build + deploy frontend only |
| `make install-backend` | Build + deploy backend only |
| `make uninstall` | Remove service, binary, config |
| `make install-env` | Create `.env` from template |
| `make backup` | CLI backup (already exists) |

### 4.4 README Sections

- **Quick start (Docker)**: `git clone && make up`
- **VDS install**: `git clone && sudo make install`, then edit `/etc/my-chat.env`
- **VDS update**: `git pull && sudo make install`
- **Windows**: `git clone && install.bat`
- **Configuration**: environment variables table
- **Backup & Restore**: CLI and API methods
- **Version compatibility**: which versions can federate

---

## 5. README (already exists)

Update existing `README.md` with:
- Badge: `![version](https://img.shields.io/badge/version-1.0.0-blue)`
- Installation section with all 3 methods
- Update instructions
- Federation compatibility table

---

## 6. Implementation Order

1. Add `GET /api/version` endpoint (trivial, 10 min)
2. Add `schema_version` table + version check on startup (1-2 hrs)
3. Add `version` to federation `ServerInfo` + MAJOR check (1 hr)
4. Write `make install` target + systemd unit + nginx config (2-3 hrs)
5. Write `install.bat` for Windows (1 hr)
6. Update README with install/update docs (1 hr)
7. Tag `v1.0.0` and release

---

## 7. Open Questions (Future)

- Do we need automatic bump in CI on commit (semantic-release)?
- Do we need CHANGELOG.md?
- Do we support git hooks for pre-commit version checks?
- Pre-built binaries for Windows (no Go toolchain required)?
