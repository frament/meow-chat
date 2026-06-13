# Versioning Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement SemVer versioning, startup migration checks, federation compatibility, and multi-platform installation scripts.

**Architecture:** Backend version constant → `/api/version` endpoint + `schema_version` DB table with startup MAJOR check → federation handshake MAJOR validation → `make install` (Linux) + `install.bat` (Windows) for VDS deployment.

**Tech Stack:** Go 1.23, Fiber v2, SQLite, systemd, nginx, Make, Windows Batch

---

### Task 1: Version package + API endpoint

**Files:**
- Create: `backend/version/version.go`
- Create: `backend/handlers/version.go`
- Modify: `backend/main.go`
- Test: `backend/handlers/version_test.go`

- [ ] **Step 1: Create version package**

Create `backend/version/version.go`:
```go
package version

const Version = "0.1.0-dev"
```

- [ ] **Step 2: Create version handler**

Create `backend/handlers/version.go`:
```go
package handlers

import (
	"my-chat-backend/version"
	"github.com/gofiber/fiber/v2"
)

func (h *Handler) GetVersion(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"version": version.Version})
}
```

- [ ] **Step 3: Register route in main.go**

In `backend/main.go`, add after other public routes:
```go
app.Get("/api/version", h.GetVersion)
```

- [ ] **Step 4: Write test**

Create `backend/handlers/version_test.go`:
```go
package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"my-chat-backend/version"
)

func TestGetVersion(t *testing.T) {
	app, h, _ := setupTestApp(t)
	app.Get("/api/version", h.GetVersion)

	req := httptest.NewRequest("GET", "/api/version", nil)
	resp, _ := app.Test(req)

	var body map[string]string
	json.NewDecoder(resp.Body).Decode(&body)

	if body["version"] != version.Version {
		t.Errorf("expected %s, got %s", version.Version, body["version"])
	}
}
```

- [ ] **Step 5: Run tests**

Run: `cd backend && go test ./handlers/ -run TestGetVersion -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/version/ backend/handlers/version.go backend/handlers/version_test.go backend/main.go
git commit -m "feat: add /api/version endpoint and version package"
```

---

### Task 2: schema_version table + startup MAJOR check

**Files:**
- Modify: `backend/database/database.go`
- Modify: `backend/main.go`
- Test: `backend/database/database_test.go`

- [ ] **Step 1: Add schema_version table creation and helpers**

In `backend/database/database.go`, add at the end:
```go
type SchemaVersion struct {
	Major int
	Minor int
	Patch int
}

const CurrentMajor = 1
const CurrentMinor = 0
const CurrentPatch = 0

func InitSchemaVersion() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS schema_version (
		major INTEGER NOT NULL,
		minor INTEGER NOT NULL,
		patch INTEGER NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return err
	}

	var count int
	DB.QueryRow("SELECT COUNT(*) FROM schema_version").Scan(&count)
	if count == 0 {
		_, err = DB.Exec("INSERT INTO schema_version (major, minor, patch) VALUES (?, ?, ?)",
			CurrentMajor, CurrentMinor, CurrentPatch)
	}
	return err
}

func GetSchemaVersion() (*SchemaVersion, error) {
	var sv SchemaVersion
	err := DB.QueryRow("SELECT major, minor, patch FROM schema_version LIMIT 1").Scan(&sv.Major, &sv.Minor, &sv.Patch)
	if err != nil {
		return nil, err
	}
	return &sv, nil
}

func UpdateSchemaVersion(major, minor, patch int) error {
	_, err := DB.Exec("UPDATE schema_version SET major = ?, minor = ?, patch = ?, updated_at = CURRENT_TIMESTAMP", major, minor, patch)
	return err
}
```

Add `InitSchemaVersion()` call inside `InitDB()` after all table migrations, before the seed:
```go
if err := InitSchemaVersion(); err != nil {
	return err
}
```

- [ ] **Step 2: Add version check on startup**

In `backend/main.go`, after `database.InitDB()` succeeds, add:
```go
sv, err := database.GetSchemaVersion()
if err != nil {
	log.Fatalf("Failed to read schema version: %v", err)
}

if sv.Major != database.CurrentMajor {
	log.Fatalf("MAJOR version mismatch: database is v%d.x.x, server expects v%d.x.x. Run backup and migrate.", sv.Major, database.CurrentMajor)
}

if sv.Minor != database.CurrentMinor || sv.Patch != database.CurrentPatch {
	if err := database.UpdateSchemaVersion(database.CurrentMajor, database.CurrentMinor, database.CurrentPatch); err != nil {
		log.Fatalf("Failed to update schema version: %v", err)
	}
	log.Printf("Schema updated: v%d.%d.%d → v%d.%d.%d", sv.Major, sv.Minor, sv.Patch, database.CurrentMajor, database.CurrentMinor, database.CurrentPatch)
}
```

- [ ] **Step 3: Write tests**

In `backend/database/database_test.go`, add:
```go
func TestSchemaVersion(t *testing.T) {
	sv, err := GetSchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if sv.Major != CurrentMajor || sv.Minor != CurrentMinor || sv.Patch != CurrentPatch {
		t.Errorf("expected %d.%d.%d, got %d.%d.%d", CurrentMajor, CurrentMinor, CurrentPatch, sv.Major, sv.Minor, sv.Patch)
	}
}

func TestUpdateSchemaVersion(t *testing.T) {
	if err := UpdateSchemaVersion(2, 0, 0); err != nil {
		t.Fatal(err)
	}
	sv, _ := GetSchemaVersion()
	if sv.Major != 2 {
		t.Errorf("expected major 2, got %d", sv.Major)
	}
	// reset
	UpdateSchemaVersion(CurrentMajor, CurrentMinor, CurrentPatch)
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && go test ./database/ -v`
Expected: PASS (all existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add backend/database/database.go backend/database/database_test.go backend/main.go
git commit -m "feat: add schema_version table with startup MAJOR check"
```

---

### Task 3: Federation version compatibility

**Files:**
- Modify: `backend/models/federation.go`
- Modify: `backend/federation/handler.go`
- Modify: `backend/handlers/admin_federation.go`
- Test: `backend/federation/handler_test.go`

- [ ] **Step 1: Add version to ServerInfo**

In `backend/models/federation.go`, add to `ServerInfo` struct:
```go
// existing fields...
Version string `json:"version"`
Major   int    `json:"major"`
```

- [ ] **Step 2: Populate version in handshake**

In `backend/handlers/admin_federation.go`, in `AdminConnectFederation` (or wherever ServerInfo is sent to peer during join), set:
```go
ServerInfo: models.ServerInfo{
    // existing fields...
    Version: version.Version,
    Major:   database.CurrentMajor,
}
```

Also in `backend/federation/handler.go`, in `HandleJoinInvite` where the server sends back its ServerInfo:
```go
resp.ServerInfo.Version = version.Version
resp.ServerInfo.Major = database.CurrentMajor
```

- [ ] **Step 3: Add MAJOR check on incoming federation connection**

In `backend/federation/handler.go`, in `HandleJoinInvite`, after parsing peer's ServerInfo, add:
```go
import "my-chat-backend/database"

// After decoding peerInfo from request body
if peerInfo.Major != database.CurrentMajor {
    return c.Status(http.StatusConflict).JSON(fiber.Map{
        "error": fmt.Sprintf("Incompatible version: server v%d.x.x, expected v%d.x.x", peerInfo.Major, database.CurrentMajor),
    })
}
```

- [ ] **Step 4: Add MAJOR check on outgoing federation connection**

In `backend/handlers/admin_federation.go`, in `AdminConnectFederation`, after receiving peer response containing ServerInfo:
```go
if peerInfo.Major != database.CurrentMajor {
    return c.Status(http.StatusConflict).JSON(fiber.Map{
        "error": fmt.Sprintf("Peer incompatible: server v%d.x.x, expected v%d.x.x", peerInfo.Major, database.CurrentMajor),
    })
}
```

- [ ] **Step 5: Add version to federation test**

In `backend/federation/handler_test.go`, update `TestHandleJoinInvite` (or existing relevant test) to include version in the request:
```go
"version": "1.0.0",
"major": 1,
```

- [ ] **Step 6: Run tests**

Run: `cd backend && go test ./... -count=1 -v 2>&1 | grep -E "(PASS|FAIL|---)"`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add backend/models/federation.go backend/federation/handler.go backend/handlers/admin_federation.go backend/federation/handler_test.go
git commit -m "feat: add MAJOR version check to federation handshake"
```

---

### Task 4: make install for Linux VDS

**Files:**
- Create: `contrib/systemd/my-chat.service`
- Create: `contrib/nginx/my-chat.conf`
- Create: `contrib/env.template`
- Modify: `Makefile`

- [ ] **Step 1: Create systemd unit**

Create `contrib/systemd/my-chat.service`:
```ini
[Unit]
Description=MeowChat Server
After=network.target

[Service]
Type=simple
User=my-chat
WorkingDirectory=/var/lib/my-chat
EnvironmentFile=-/etc/my-chat.env
ExecStart=/usr/local/bin/my-chat-server
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Create nginx config**

Create `contrib/nginx/my-chat.conf`:
```nginx
server {
    listen 80;
    server_name _;
    client_max_body_size 50M;
    root /var/www/my-chat;

    location /api/ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 3: Create env template**

Create `contrib/env.template`:
```
DB_PATH=/var/lib/my-chat/data/chat.db
JWT_SECRET=change-me-to-random-string
WEBAUTHN_RP_ID=example.com
WEBAUTHN_RP_ORIGIN=https://example.com
```

- [ ] **Step 4: Add install target to Makefile**

Add to `Makefile`:
```makefile
PREFIX ?= /usr/local
BINDIR ?= $(PREFIX)/bin
LIBDIR ?= /var/lib/my-chat
WWWDIR ?= /var/www/my-chat
SYSTEMD_DIR ?= /etc/systemd/system
NGINX_DIR ?= /etc/nginx/sites-available
MY_CHAT_USER ?= my-chat

install: install-backend install-frontend install-systemd install-nginx

install-backend:
	cd backend && CGO_ENABLED=1 go build -ldflags="-X my-chat-backend/version.Version=$(shell git describe --tags --always --dirty 2>/dev/null || echo dev)" -o $(BINDIR)/my-chat-server .

install-frontend:
	cd frontend && npm ci --omit=dev 2>/dev/null || true
	cd frontend && npx ng build --configuration production --output-path $(WWWDIR)

install-systemd:
	install -d -m 755 $(LIBDIR)/data $(LIBDIR)/uploads/avatars $(LIBDIR)/uploads/posts $(LIBDIR)/uploads/messages $(LIBDIR)/uploads/federation_cache
	install -d -m 755 /etc/my-chat
	install -m 644 contrib/env.template /etc/my-chat/env.template
	[ -f /etc/my-chat.env ] || cp contrib/env.template /etc/my-chat.env
	install -m 644 contrib/systemd/my-chat.service $(SYSTEMD_DIR)/my-chat.service
	systemctl daemon-reload
	systemctl enable my-chat
	chown -R $(MY_CHAT_USER):$(MY_CHAT_USER) $(LIBDIR) 2>/dev/null || true

install-nginx:
	install -m 644 contrib/nginx/my-chat.conf $(NGINX_DIR)/my-chat.conf
	[ -L /etc/nginx/sites-enabled/my-chat ] || ln -s $(NGINX_DIR)/my-chat.conf /etc/nginx/sites-enabled/
	nginx -t && systemctl reload nginx || true

uninstall:
	systemctl stop my-chat 2>/dev/null || true
	systemctl disable my-chat 2>/dev/null || true
	rm -f $(SYSTEMD_DIR)/my-chat.service
	rm -f $(BINDIR)/my-chat-server
	rm -f $(NGINX_DIR)/my-chat.conf
	rm -f /etc/nginx/sites-enabled/my-chat
	rm -rf $(WWWDIR)
	systemctl daemon-reload

.PHONY: install install-backend install-frontend install-systemd install-nginx uninstall
```

- [ ] **Step 5: Verify Makefile syntax**

Run: `make -n install` (won't actually run without sudo, but tests syntax)
Expected: prints what would execute (works even without sudo due to `-n`)

- [ ] **Step 6: Commit**

```bash
git add contrib/ Makefile
git commit -m "feat: add make install for Linux VDS deployment"
```

---

### Task 5: install.bat for Windows

**Files:**
- Create: `install.bat`

- [ ] **Step 1: Create install.bat**

Create `install.bat`:
```bat
@echo off
setlocal enabledelayedexpansion

echo ===== MeowChat Windows Install =====

:: Find Go
where go >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Go not found. Install Go from https://go.dev/dl/
    exit /b 1
)

:: Find Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Install from https://nodejs.org/
    exit /b 1
)

:: Build backend
echo.
echo [1/3] Building backend...
cd backend
set CGO_ENABLED=1
for /f "tokens=*" %%i in ('git describe --tags --always --dirty 2^>nul') do set GIT_VERSION=%%i
if "!GIT_VERSION!"=="" set GIT_VERSION=dev
go build -ldflags="-X my-chat-backend/version.Version=!GIT_VERSION!" -o my-chat-server.exe .
if %errorlevel% neq 0 (
    echo ERROR: Backend build failed
    exit /b 1
)
cd ..

:: Build frontend
echo.
echo [2/3] Building frontend...
cd frontend
call npm ci 2>nul || echo npm ci skipped, continuing
call npx ng build --configuration production
if %errorlevel% neq 0 (
    echo ERROR: Frontend build failed
    exit /b 1
)
cd ..

:: Create directories
echo.
echo [3/3] Creating directories...
if not exist "data" mkdir data
if not exist "uploads\avatars" mkdir uploads\avatars
if not exist "uploads\posts" mkdir uploads\posts
if not exist "uploads\messages" mkdir uploads\messages
if not exist "uploads\federation_cache" mkdir uploads\federation_cache

:: Copy binaries
copy /Y backend\my-chat-server.exe my-chat-server.exe >nul

echo.
echo ===== Install complete =====
echo.
echo To run: set DB_PATH=./data/chat.db ^&^& my-chat-server.exe
echo.
echo Or register as Windows service using nssm:
echo   nssm install MeowChat "C:\path\to\my-chat-server.exe"
echo   nssm set MeowChat AppDirectory "C:\path\to\project"
echo   nssm set MeowChat AppEnvironmentExtra "DB_PATH=./data/chat.db"
echo   nssm start MeowChat
echo.
echo Frontend build is in frontend/dist/frontend/
echo Configure nginx or IIS to serve it as SPA.
```

- [ ] **Step 2: Test syntax**

Run: `cmd.exe /c "install.bat"` from a clean checkout directory
Expected: fails with "Go not found" (expected — we just verify batch syntax is valid)

- [ ] **Step 3: Commit**

```bash
git add install.bat
git commit -m "feat: add install.bat for Windows deployment"
```

---

### Task 6: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add installation section**

In `README.md`, add or update with:

````markdown
## 🚀 Installation

### Docker (recommended)
```bash
git clone https://github.com/.../my-chat.git
cd my-chat
make up
```

### Linux (VDS)
```bash
git clone https://github.com/.../my-chat.git
cd my-chat
sudo make install
# Edit /etc/my-chat.env with your settings
sudo systemctl start my-chat
sudo systemctl enable my-chat
```

### Windows
```cmd
git clone https://github.com/.../my-chat.git
cd my-chat
install.bat
```

## 🔄 Updating

### Docker
```bash
make update
```

### Linux (VDS)
```bash
git pull
sudo make install
sudo systemctl restart my-chat
```

## 🔗 Federation Compatibility

| Server A | Server B | Compatible? |
|----------|----------|-------------|
| v1.0.x | v1.x.x | ✅ Same MAJOR |
| v1.x.x | v2.x.x | ❌ Different MAJOR |

Federation handshake validates MAJOR version. Servers with different MAJOR versions cannot connect.
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add installation and update instructions"
```

---

### Task 7: Tag first release

**Files:**
- None

- [ ] **Step 1: Tag and push**

```bash
git tag -a v1.0.0 -m "v1.0.0 — First stable release"
git push origin v1.0.0
```

---

## Spec Coverage Check

| Spec Section | Task |
|-------------|------|
| 1.1 SemVer scheme | Task 1 (version constant) |
| 1.2 Git tags | Task 7 |
| 1.3 `/api/version` endpoint | Task 1 |
| 2.1 schema_version table | Task 2 |
| 2.2 Startup migration flow | Task 2 |
| 2.3 Migration cases | Task 2 (implicit in startup logic) |
| 2.4 Docker update flow | Already exists as `make update` |
| 2.5 VDS direct update flow | Task 4 + README |
| 3.1 Version in handshake | Task 3 |
| 3.2 Compatibility check | Task 3 |
| 4.2 Method A: Docker | README update (Task 6) |
| 4.2 Method B: VDS install | Task 4 + Task 6 |
| 4.2 Method C: Windows | Task 5 + Task 6 |
| 4.3 Makefile targets | Task 4 |
| 4.4 README sections | Task 6 |
