# Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backup/restore system to MeowChat — CLI commands, admin API endpoints, and frontend panel.

**Architecture:** Core backup logic lives in a new `backend/backup/` package (config, zip snapshot, process control). Admin HTTP handlers in `backend/handlers/backup.go`. CLI subcommands dispatch from `main.go`. Maintenance mode via a file marker checked in middleware. Frontend adds a "Бэкапы" tab in the admin panel + maintenance overlay in App component.

**Tech Stack:** Go stdlib `archive/zip`, SQLite `VACUUM INTO`, Angular standalone components, Fiber v2.

---

### Files to create
- `backend/backup/config.go` — BackupConfig struct + Load/Save helpers
- `backend/backup/backup.go` — CreateBackup (VACUUM INTO + zip), RestoreFromZip (extract + overwrite)
- `backend/backup/process.go` — platform helpers: FindProcessByPort, StopProcess, StartServer, PID file
- `backend/handlers/backup.go` — all AdminBackup* handler functions

### Files to modify
- `backend/main.go` — CLI backup/restore subcommands, startup restore handler, PID file write, maintenance middleware, route registration
- `docker-compose.yml` — add `./backups:/app/backups` volume
- `frontend/src/app/services/api.service.ts` — 8 backup API methods
- `frontend/src/app/components/admin/admin.ts` — backup tab with table + modals
- `frontend/src/app/app.ts` — maintenance poll + overlay

---

### Task 1: Backup config — Load/Save helpers

**Create:** `backend/backup/config.go`

```go
package backup

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type BackupConfig struct {
	BackupDir string `json:"backup_dir"`
}

func DefaultConfig() BackupConfig {
	return BackupConfig{BackupDir: "./backups"}
}

func ConfigPath(dbPath string) string {
	return filepath.Join(filepath.Dir(dbPath), "backup-config.json")
}

func LoadConfig(dbPath string) (BackupConfig, error) {
	path := ConfigPath(dbPath)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg := DefaultConfig()
			SaveConfig(dbPath, cfg)
			return cfg, nil
		}
		return BackupConfig{}, err
	}
	var cfg BackupConfig
	err = json.Unmarshal(data, &cfg)
	if cfg.BackupDir == "" {
		cfg.BackupDir = DefaultConfig().BackupDir
	}
	return cfg, err
}

func SaveConfig(dbPath string, cfg BackupConfig) error {
	path := ConfigPath(dbPath)
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
```

- [ ] Create `backend/backup/config.go`

---

### Task 2: Core backup/restore functions

**Create:** `backend/backup/backup.go`

```go
package backup

import (
	"archive/zip"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

func CreateBackup(db *sql.DB, dbPath, backupDir, workingDir string) (string, int64, error) {
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		return "", 0, fmt.Errorf("mkdir backup dir: %w", err)
	}

	tmpDB := filepath.Join(backupDir, "chat-backup.db")
	_, err := db.Exec(fmt.Sprintf("VACUUM INTO '%s'", tmpDB))
	if err != nil {
		return "", 0, fmt.Errorf("vacuum into: %w", err)
	}
	defer os.Remove(tmpDB)

	timestamp := time.Now().Format("2006-01-02T150405")
	zipPath := filepath.Join(backupDir, fmt.Sprintf("backup-%s.zip", timestamp))

	zipFile, err := os.Create(zipPath)
	if err != nil {
		return "", 0, fmt.Errorf("create zip: %w", err)
	}
	defer zipFile.Close()

	zw := zip.NewWriter(zipFile)

	addFile := func(src, dst string) error {
		f, err := os.Open(src)
		if err != nil {
			return err
		}
		defer f.Close()
		info, _ := f.Stat()
		hdr, _ := zip.FileInfoHeader(info)
		hdr.Name = dst
		hdr.Method = zip.Deflate
		w, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		_, err = io.Copy(w, f)
		return err
	}

	addDir := func(src, dstPrefix string) error {
		entries, err := os.ReadDir(src)
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			fullPath := filepath.Join(src, e.Name())
			if err := addFile(fullPath, dstPrefix+"/"+e.Name()); err != nil {
				return err
			}
		}
		return nil
	}

	if err := addFile(tmpDB, "chat.db"); err != nil {
		return "", 0, fmt.Errorf("add chat.db: %w", err)
	}

	keyPath := filepath.Join(filepath.Dir(dbPath), "server_key.bin")
	if _, err := os.Stat(keyPath); err == nil {
		addFile(keyPath, "server_key.bin")
	}

	vapidPath := filepath.Join(workingDir, "vapid_keys.json")
	if _, err := os.Stat(vapidPath); err == nil {
		addFile(vapidPath, "vapid_keys.json")
	}

	addDir(filepath.Join(workingDir, "uploads/avatars"), "avatars")
	addDir(filepath.Join(workingDir, "uploads/posts"), "posts")
	addDir(filepath.Join(workingDir, "uploads/messages"), "messages")

	if err := zw.Close(); err != nil {
		return "", 0, fmt.Errorf("close zip: %w", err)
	}

	info, _ := os.Stat(zipPath)
	return zipPath, info.Size(), nil
}

func RestoreFromZip(zipPath, dbPath, workingDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("open zip: %w", err)
	}
	defer r.Close()

	for _, f := range r.File {
		var dest string
		switch {
		case f.Name == "chat.db":
			dest = dbPath
		case f.Name == "server_key.bin":
			dest = filepath.Join(filepath.Dir(dbPath), "server_key.bin")
		case f.Name == "vapid_keys.json":
			dest = filepath.Join(workingDir, "vapid_keys.json")
		case len(f.Name) > 0 && f.Name[0] != '/':
			dest = filepath.Join(workingDir, "uploads", f.Name)
		default:
			continue
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(dest, 0755)
			continue
		}

		os.MkdirAll(filepath.Dir(dest), 0755)

		out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
		if err != nil {
			return fmt.Errorf("create %s: %w", dest, err)
		}

		rc, err := f.Open()
		if err != nil {
			out.Close()
			return fmt.Errorf("read %s from zip: %w", f.Name, err)
		}

		_, err = io.Copy(out, rc)
		out.Close()
		rc.Close()
		if err != nil {
			return fmt.Errorf("write %s: %w", dest, err)
		}
	}
	return nil
}
```

- [ ] Create `backend/backup/backup.go`

---

### Task 3: Process helpers — PID file, stop, start

**Create:** `backend/backup/process.go`

```go
//go:build !windows

package backup

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

func FindProcess(pidFile string) (*os.Process, error) {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return nil, err
	}
	pid, err := strconv.Atoi(string(data))
	if err != nil {
		return nil, err
	}
	return os.FindProcess(pid)
}

func StopProcess(proc *os.Process) error {
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		return err
	}
	done := make(chan bool, 1)
	go func() {
		proc.Wait()
		done <- true
	}()
	select {
	case <-done:
		return nil
	case <-time.After(10 * time.Second):
		return proc.Kill()
	}
}

func IsDocker() bool {
	_, err := os.Stat("/.dockerenv")
	return err == nil
}

func PIDFilePath(dbPath string) string {
	return filepath.Join(filepath.Dir(dbPath), "server.pid")
}

func WritePIDFile(dbPath string) error {
	path := PIDFilePath(dbPath)
	return os.WriteFile(path, []byte(fmt.Sprintf("%d", os.Getpid())), 0644)
}
```

- [ ] Create `backend/backup/process.go`

**Create:** `backend/backup/process_windows.go`

```go
//go:build windows

package backup

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

func FindProcess(pidFile string) (*os.Process, error) {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return nil, err
	}
	pid, err := strconv.Atoi(string(data))
	if err != nil {
		return nil, err
	}
	return os.FindProcess(pid)
}

func StopProcess(proc *os.Process) error {
	cmd := exec.Command("taskkill", "/PID", fmt.Sprintf("%d", proc.Pid))
	if err := cmd.Run(); err != nil {
		cmd = exec.Command("taskkill", "/F", "/PID", fmt.Sprintf("%d", proc.Pid))
		return cmd.Run()
	}
	time.Sleep(2 * time.Second)
	cmd2 := exec.Command("taskkill", "/F", "/PID", fmt.Sprintf("%d", proc.Pid))
	cmd2.Run()
	return nil
}

func IsDocker() bool {
	return false
}

func PIDFilePath(dbPath string) string {
	return filepath.Join(filepath.Dir(dbPath), "server.pid")
}

func WritePIDFile(dbPath string) error {
	path := PIDFilePath(dbPath)
	return os.WriteFile(path, []byte(fmt.Sprintf("%d", os.Getpid())), 0644)
}
```

- [ ] Create `backend/backup/process_windows.go`

---

### Task 4: Main.go — PID file write + startup restore handler

**Modify:** `backend/main.go`

Add import for `"my-chat-backend/backup"` and `"path/filepath"` (check if already imported).

After `database.InitDB()`, add:
```go
database.InitDB()
database.SeedAdmin()

// Check for pending restore
if database.DB != nil {
    dbPath := os.Getenv("DB_PATH")
    if dbPath == "" {
        dbPath = "./data/chat.db"
    }
    dataDir := filepath.Dir(dbPath)
    restoredDB := filepath.Join(dataDir, "chat-restored.db")
    if _, err := os.Stat(restoredDB); err == nil {
        log.Println("Found pending restore — applying...")
        if err := os.Rename(restoredDB, dbPath); err != nil {
            log.Fatalf("Failed to apply restore: %v", err)
        }
        os.Remove(filepath.Join(dataDir, ".maintenance"))
        os.Remove(filepath.Join(dataDir, ".restore-pending"))
        log.Println("Restore applied successfully")
    }
}
```

And after `database.SeedAdmin()`, add PID file write:
```go
if len(os.Args) <= 1 || os.Args[1] != "admin" {
    dbPath := os.Getenv("DB_PATH")
    if dbPath == "" {
        dbPath = "./data/chat.db"
    }
    backup.WritePIDFile(dbPath)
}
```

- [ ] Edit `backend/main.go` — add imports, startup restore handler, PID file write

---

### Task 5: Main.go — CLI backup + restore subcommands

**Modify:** `backend/main.go` — expand CLI usage and switch cases.

In the usage block (after existing federation lines), add:
```go
fmt.Println("  go run . admin backup [path]          — Create backup")
fmt.Println("  go run . admin restore <file.zip>      — Restore from backup")
```

Before the `switch action` line, add `dbPath` and `workingDir` vars:
```go
dbPath := os.Getenv("DB_PATH")
if dbPath == "" {
    dbPath = "./data/chat.db"
}
workingDir, _ := os.Getwd()
```

Add cases in the switch:
```go
case "backup":
    backupDir := ""
    if len(os.Args) >= 4 {
        backupDir = os.Args[3]
    } else {
        cfg, err := backup.LoadConfig(dbPath)
        if err != nil {
            fmt.Printf("Error loading config: %v\n", err)
            return
        }
        backupDir = cfg.BackupDir
    }
    zipPath, size, err := backup.CreateBackup(database.DB, dbPath, backupDir, workingDir)
    if err != nil {
        fmt.Printf("Error creating backup: %v\n", err)
        return
    }
    fmt.Printf("Backup created: %s (%d bytes)\n", zipPath, size)

case "restore":
    if len(os.Args) < 4 {
        fmt.Println("Usage: go run . admin restore <file.zip>")
        return
    }
    zipPath := os.Args[3]

    // Stop running server
    pidFile := backup.PIDFilePath(dbPath)
    if proc, err := backup.FindProcess(pidFile); err == nil && proc != nil {
        fmt.Println("Stopping server...")
        if err := backup.StopProcess(proc); err != nil {
            fmt.Printf("Warning: stop error (ignoring): %v\n", err)
        }
        time.Sleep(1 * time.Second)
    }

    if backup.IsDocker() {
        // In Docker: restore files, then kill PID 1 to trigger restart
        if err := backup.RestoreFromZip(zipPath, dbPath, workingDir); err != nil {
            fmt.Printf("Error restoring: %v\n", err)
            return
        }
        fmt.Println("Restore complete. Restarting container...")
        syscall.Kill(1, syscall.SIGTERM)
    } else {
        if err := backup.RestoreFromZip(zipPath, dbPath, workingDir); err != nil {
            fmt.Printf("Error restoring: %v\n", err)
            return
        }
        fmt.Println("Restore complete. Starting server...")
        cmd := exec.Command(os.Args[0], os.Args[1:]...)
        cmd.Stdout = os.Stdout
        cmd.Stderr = os.Stderr
        cmd.Stdin = os.Stdin
        cmd.Env = os.Environ()
        cmd.Start()
    }
```

- [ ] Edit `backend/main.go` — add backup/restore CLI commands

---

### Task 6: Maintenance middleware

**Create:** `backend/handlers/backup.go` — part 1: maintenance middleware + config handlers

```go
package handlers

import (
	"my-chat-backend/backup"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) MaintenanceMode(c *fiber.Ctx) error {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}
	maintenanceFile := filepath.Join(filepath.Dir(dbPath), ".maintenance")
	if _, err := os.Stat(maintenanceFile); err == nil {
		return c.Status(503).JSON(fiber.Map{"error": "Server is in maintenance mode"})
	}
	return c.Next()
}

func (h *Handler) GetBackupSettings(c *fiber.Ctx) error {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}
	cfg, err := backup.LoadConfig(dbPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(cfg)
}

func (h *Handler) UpdateBackupSettings(c *fiber.Ctx) error {
	var req backup.BackupConfig
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}

	// Validate: try to create directory
	if err := os.MkdirAll(req.BackupDir, 0755); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Cannot create directory: " + err.Error()})
	}

	if err := backup.SaveConfig(dbPath, req); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Saved"})
}
```

- [ ] Create `backend/handlers/backup.go` with maintenance middleware and settings handlers

---

### Task 7: Admin backup API handlers

**Modify:** `backend/handlers/backup.go` — add all backup CRUD handlers

```go
type BackupEntry struct {
	Filename  string `json:"filename"`
	SizeBytes int64  `json:"size_bytes"`
	CreatedAt string `json:"created_at"`
}

func getBackupDir(c *fiber.Ctx) (string, error) {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}
	cfg, err := backup.LoadConfig(dbPath)
	if err != nil {
		return "", err
	}
	return cfg.BackupDir, nil
}

func (h *Handler) AdminListBackups(c *fiber.Ctx) error {
	backupDir, err := getBackupDir(c)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return c.JSON(make([]BackupEntry, 0))
	}

	result := make([]BackupEntry, 0)
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".zip" {
			continue
		}
		info, _ := e.Info()
		result = append(result, BackupEntry{
			Filename:  e.Name(),
			SizeBytes: info.Size(),
			CreatedAt: info.ModTime().Format(time.RFC3339),
		})
	}
	return c.JSON(result)
}

func (h *Handler) AdminCreateBackup(c *fiber.Ctx) error {
	backupDir, err := getBackupDir(c)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	workingDir, _ := os.Getwd()
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}

	zipPath, size, err := backup.CreateBackup(database.DB, dbPath, backupDir, workingDir)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(BackupEntry{
		Filename:  filepath.Base(zipPath),
		SizeBytes: size,
		CreatedAt: time.Now().Format(time.RFC3339),
	})
}

func (h *Handler) AdminDownloadBackup(c *fiber.Ctx) error {
	backupDir, err := getBackupDir(c)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	filename := c.Params("filename")
	if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid filename"})
	}

	filePath := filepath.Join(backupDir, filename)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{"error": "Backup not found"})
	}

	c.Attachment(filePath)
	return c.SendFile(filePath)
}

func (h *Handler) AdminUploadBackup(c *fiber.Ctx) error {
	backupDir, err := getBackupDir(c)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Missing file"})
	}

	if !strings.HasSuffix(strings.ToLower(file.Filename), ".zip") {
		return c.Status(400).JSON(fiber.Map{"error": "Only .zip files allowed"})
	}

	dest := filepath.Join(backupDir, file.Filename)
	if err := c.SaveFile(file, dest); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"filename": file.Filename})
}

func (h *Handler) AdminDeleteBackup(c *fiber.Ctx) error {
	backupDir, err := getBackupDir(c)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	filename := c.Params("filename")
	if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid filename"})
	}

	filePath := filepath.Join(backupDir, filename)
	if err := os.Remove(filePath); err != nil {
		if os.IsNotExist(err) {
			return c.Status(404).JSON(fiber.Map{"error": "Backup not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Deleted"})
}

func (h *Handler) AdminRestoreBackup(c *fiber.Ctx) error {
	backupDir, err := getBackupDir(c)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	filename := c.Params("filename")
	if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid filename"})
	}

	zipPath := filepath.Join(backupDir, filename)
	if _, err := os.Stat(zipPath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{"error": "Backup not found"})
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}
	workingDir, _ := os.Getwd()
	dataDir := filepath.Dir(dbPath)

	// Write maintenance file
	os.WriteFile(filepath.Join(dataDir, ".maintenance"), []byte{}, 0644)

	// Extract everything except chat.db to live paths
	tmpDir, _ := os.MkdirTemp("", "restore")
	defer os.RemoveAll(tmpDir)

	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	for _, f := range r.File {
		var dest string
		switch {
		case f.Name == "chat.db":
			// Extract to temp, will be renamed on restart
			dest = filepath.Join(dataDir, "chat-restored.db")
		case f.Name == "server_key.bin":
			dest = filepath.Join(dataDir, "server_key.bin")
		case f.Name == "vapid_keys.json":
			dest = filepath.Join(workingDir, "vapid_keys.json")
		case len(f.Name) > 0 && f.Name[0] != '/':
			dest = filepath.Join(workingDir, "uploads", f.Name)
		default:
			continue
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(dest, 0755)
			continue
		}
		os.MkdirAll(filepath.Dir(dest), 0755)

		out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
		if err != nil {
			r.Close()
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		rc, _ := f.Open()
		io.Copy(out, rc)
		out.Close()
		rc.Close()
	}
	r.Close()

	// Write restore pending marker
	marker := map[string]string{"filename": filename}
	markerData, _ := json.Marshal(marker)
	os.WriteFile(filepath.Join(dataDir, ".restore-pending"), markerData, 0644)

	// Respond before restart
	go func() {
		time.Sleep(500 * time.Millisecond)
		p, _ := os.FindProcess(1)
		if p != nil {
			p.Signal(syscall.SIGTERM)
		}
	}()

	return c.JSON(fiber.Map{"message": "Restore in progress — restarting server"})
}
```

Need additional imports for this file:
```go
import (
    "archive/zip"
    "encoding/json"
    "io"
    "my-chat-backend/backup"
    "my-chat-backend/database"
    "os"
    "path/filepath"
    "strings"
    "syscall"
    "time"

    "github.com/gofiber/fiber/v2"
)
```

- [ ] Edit `backend/handlers/backup.go` — add backup CRUD handlers + imports

---

### Task 8: Route registration in main.go

**Modify:** `backend/main.go` — add backup routes + maintenance middleware

After the closing `}` of the `admin` group, add:
```go
	// Backup & restore routes (no auth required for health check)
	api.Get("/health", func(c *fiber.Ctx) error {
		dbPath := os.Getenv("DB_PATH")
		if dbPath == "" {
			dbPath = "./data/chat.db"
		}
		if _, err := os.Stat(filepath.Join(filepath.Dir(dbPath), ".maintenance")); err == nil {
			return c.JSON(fiber.Map{"status": "maintenance"})
		}
		return c.JSON(fiber.Map{"status": "ok"})
	})

	// Backup admin routes (behind AdminRequired, before maintenance check)
	bak := api.Group("/admin/backup", handlers.AdminRequired)
	bak.Get("/settings", h.GetBackupSettings)
	bak.Put("/settings", h.UpdateBackupSettings)
	bak.Get("/backups", h.AdminListBackups)
	bak.Post("/backup", h.AdminCreateBackup)
	bak.Post("/backups/upload", h.AdminUploadBackup)
	bak.Get("/backups/:filename", h.AdminDownloadBackup)
	bak.Delete("/backups/:filename", h.AdminDeleteBackup)
	bak.Post("/backups/:filename/restore", h.AdminRestoreBackup)
```

Add imports: `"path/filepath"` and `"my-chat-backend/backup"`.

Remove the old API health endpoint that might exist (none seems to).

- [ ] Edit `backend/main.go` — add routes + health endpoint

---

### Task 9: Docker compose volume

**Modify:** `docker-compose.yml`

Add `./backups:/app/backups` to the backend volumes:
```yaml
    volumes:
      - chat-data:/data
      - ./uploads:/app/uploads
      - ./backups:/app/backups
```

- [ ] Edit `docker-compose.yml` — add backups volume

---

### Task 10: Frontend — API methods

**Modify:** `frontend/src/app/services/api.service.ts`

Add after `adminDeleteGroupChat` / `deleteGroupChat`:

```typescript
  // ── Backup & Restore ──

  getBackupSettings() {
    return this.http.get<{ backup_dir: string }>(`${this.baseUrl}/admin/backup/settings`);
  }

  updateBackupSettings(backupDir: string) {
    return this.http.put<{ message: string }>(`${this.baseUrl}/admin/backup/settings`, { backup_dir: backupDir });
  }

  getBackups() {
    return this.http.get<{ filename: string; size_bytes: number; created_at: string }[]>(
      `${this.baseUrl}/admin/backup/backups`
    );
  }

  createBackup() {
    return this.http.post<{ filename: string; size_bytes: number; created_at: string }>(
      `${this.baseUrl}/admin/backup/backup`, {}
    );
  }

  downloadBackupUrl(filename: string): string {
    return `${this.baseUrl}/admin/backup/backups/${filename}`;
  }

  uploadBackup(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ filename: string }>(`${this.baseUrl}/admin/backup/backups/upload`, fd);
  }

  deleteBackup(filename: string) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/admin/backup/backups/${filename}`);
  }

  restoreBackup(filename: string) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/admin/backup/backups/${filename}/restore`, {});
  }
```

- [ ] Edit `api.service.ts` — add backup methods

---

### Task 11: Frontend — admin backup tab

**Modify:** `frontend/src/app/components/admin/admin.ts` — add backup tab

Add to the tab buttons:
```html
<button (click)="activeTab = 'backups'; loadBackups()"
  [style.background]="activeTab === 'backups' ? 'var(--accent-light)' : 'transparent'"
  style="padding:8px 16px;border-radius:8px 8px 0 0;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);transition:all 0.2s;">
  Бэкапы
</button>
```

Add after the `@if (activeTab === 'files')` block:
```html
@if (activeTab === 'backups') {
  <div style="display:flex;gap:8px;margin-bottom:16px;">
    <button (click)="createBackup()" [disabled]="backupLoading"
      style="padding:8px 16px;border-radius:8px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:14px;font-weight:500;">
      {{ backupLoading ? '...' : 'Создать бэкап' }}
    </button>
    <label style="padding:8px 16px;border-radius:8px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);display:inline-flex;align-items:center;">
      Загрузить бэкап
      <input type="file" accept=".zip" (change)="uploadBackup($event)" style="display:none;">
    </label>
  </div>

  @if (backupMsg) {
    <p style="font-size:13px;margin-bottom:12px;" [style.color]="backupOk ? '#27ae60' : '#e74c3c'">{{ backupMsg }}</p>
  }

  @if (backupsLoading) {
    <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
  } @else if (backups.length === 0) {
    <p style="color:var(--text-tertiary);font-size:14px;">Бэкапы не найдены</p>
  } @else {
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="color:var(--text-secondary);border-bottom:1px solid var(--divider);">
            <th style="text-align:left;padding:8px 12px;font-weight:500;">Файл</th>
            <th style="text-align:left;padding:8px 12px;font-weight:500;">Размер</th>
            <th style="text-align:left;padding:8px 12px;font-weight:500;">Дата</th>
            <th style="text-align:right;padding:8px 12px;font-weight:500;">Действия</th>
          </tr>
        </thead>
        <tbody>
          @for (b of backups; track b.filename) {
            <tr style="border-bottom:1px solid var(--divider);">
              <td style="padding:10px 12px;color:var(--text-primary);font-weight:500;">{{ b.filename }}</td>
              <td style="padding:10px 12px;color:var(--text-secondary);">{{ formatSize(b.size_bytes) }}</td>
              <td style="padding:10px 12px;color:var(--text-tertiary);font-size:13px;">{{ b.created_at | date:'dd.MM.yyyy HH:mm' }}</td>
              <td style="padding:10px 12px;text-align:right;">
                <div style="display:flex;gap:6px;justify-content:flex-end;">
                  <a [href]="api.downloadBackupUrl(b.filename)" target="_blank"
                    style="padding:4px 10px;border-radius:6px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:12px;color:var(--text-secondary);text-decoration:none;">
                    Скачать
                  </a>
                  <button (click)="restoreBackup(b)" [disabled]="restoring === b.filename"
                    style="padding:4px 10px;border-radius:6px;border:1px solid #e67e22;background:transparent;cursor:pointer;font-size:12px;color:#e67e22;">
                    {{ restoring === b.filename ? '...' : 'Восстановить' }}
                  </button>
                  <button (click)="deleteBackup(b)"
                    style="padding:4px 10px;border-radius:6px;border:1px solid #e74c3c;background:transparent;cursor:pointer;font-size:12px;color:#e74c3c;">
                    Удалить
                  </button>
                </div>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  }
}
```

Add fields and methods to the component class:
```typescript
interface BackupEntry {
  filename: string;
  size_bytes: number;
  created_at: string;
}

// In AdminComponent class:
backups: BackupEntry[] = [];
backupsLoading = false;
backupLoading = false;
restoring: string | null = null;
backupMsg = '';
backupOk = false;
backupDir = '';
backupSettingsLoaded = false;

loadBackups() {
  this.backupsLoading = true;
  this.api.getBackups().subscribe({
    next: (list) => { this.backups = list; this.backupsLoading = false; },
    error: () => this.backupsLoading = false,
  });
}

createBackup() {
  this.backupLoading = true;
  this.backupMsg = '';
  this.api.createBackup().subscribe({
    next: (res) => {
      this.backupLoading = false;
      this.backupMsg = `Бэкап создан: ${res.filename}`;
      this.backupOk = true;
      this.loadBackups();
      setTimeout(() => this.backupMsg = '', 3000);
    },
    error: () => {
      this.backupLoading = false;
      this.backupMsg = 'Ошибка создания бэкапа';
      this.backupOk = false;
      setTimeout(() => this.backupMsg = '', 3000);
    },
  });
}

uploadBackup(event: any) {
  const file = event.target?.files?.[0];
  if (!file) return;
  this.backupLoading = true;
  this.backupMsg = '';
  this.api.uploadBackup(file).subscribe({
    next: () => {
      this.backupLoading = false;
      this.backupMsg = 'Бэкап загружен';
      this.backupOk = true;
      this.loadBackups();
      setTimeout(() => this.backupMsg = '', 3000);
    },
    error: () => {
      this.backupLoading = false;
      this.backupMsg = 'Ошибка загрузки';
      this.backupOk = false;
      setTimeout(() => this.backupMsg = '', 3000);
    },
  });
  event.target.value = '';
}

restoreBackup(b: BackupEntry) {
  if (!confirm(`Восстановить сервер из бэкапа "${b.filename}"? Сервер будет перезапущен.`)) return;
  this.restoring = b.filename;
  this.api.restoreBackup(b.filename).subscribe({
    next: () => {
      this.restoring = null;
      this.backupMsg = 'Сервер восстанавливается...';
      this.backupOk = true;
    },
    error: () => {
      this.restoring = null;
      this.backupMsg = 'Ошибка восстановления';
      this.backupOk = false;
      setTimeout(() => this.backupMsg = '', 3000);
    },
  });
}

deleteBackup(b: BackupEntry) {
  if (!confirm(`Удалить бэкап "${b.filename}"?`)) return;
  this.api.deleteBackup(b.filename).subscribe({
    next: () => {
      this.backups = this.backups.filter(x => x.filename !== b.filename);
    },
    error: () => {
      this.backupMsg = 'Ошибка удаления';
      this.backupOk = false;
      setTimeout(() => this.backupMsg = '', 3000);
    },
  });
}
```

Make `api` public in constructor: `constructor(public api: ApiService) {}` (or add `readonly`).

- [ ] Edit `admin.ts` — add backup tab UI + logic
- [ ] Edit `admin.ts` — change constructor to public api

---

### Task 12: Frontend — maintenance overlay

**Modify:** `frontend/src/app/app.ts`

Add imports:
```typescript
import { interval, filter, map, Subscription } from 'rxjs';
```

Add fields:
```typescript
readonly maintenanceMode = signal(false);
#maintenanceSub: Subscription | null = null;
```

Add to `ngOnInit()` after the existing subscriptions:
```typescript
this.#maintenanceSub = interval(3000)
  .pipe(
    filter(() => this.#api.currentUser() !== null),
    switchMap(() => this.#api.http.get<{ status: string }>(`${this.#api['baseUrl']}/health`)),
    map(res => res.status === 'maintenance')
  )
  .subscribe(isMaintenance => {
    if (isMaintenance && !this.maintenanceMode()) {
      this.maintenanceMode.set(true);
    } else if (!isMaintenance && this.maintenanceMode()) {
      this.maintenanceMode.set(false);
      location.reload();
    }
  });
```

Wait, `baseUrl` is likely private in ApiService. Let me check...

Actually, looking at the service, I need to check if `baseUrl` is accessible. Let me use the public method pattern instead. Let me check how other parts access the HTTP client... The cleanest way is to add a `checkHealth()` method to the ApiService.

Actually, let me just use the health check via a simple fetch in App. Or better, add a public `checkHealth()` method to ApiService:

In `api.service.ts`, add:
```typescript
checkHealth() {
  return this.http.get<{ status: string }>(`${this.baseUrl}/health`);
}
```

Then in `app.ts`:
```typescript
this.#maintenanceSub = interval(3000)
  .pipe(
    filter(() => this.#api.currentUser() !== null),
    switchMap(() => this.#api.checkHealth()),
    map(res => res.status === 'maintenance')
  )
  .subscribe(isMaintenance => {
    if (isMaintenance && !this.maintenanceMode()) {
      this.maintenanceMode.set(true);
    } else if (!isMaintenance && this.maintenanceMode()) {
      location.reload();
    }
  });
```

Add to template (before `<router-outlet />`):
```html
@if (maintenanceMode()) {
  <div style="position:fixed;inset:0;z-index:99999;background:var(--bg-body);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;">
    <div style="width:48px;height:48px;border:4px solid var(--border-default);border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite;"></div>
    <p style="font-size:18px;font-weight:600;color:var(--text-primary);">Сервер восстанавливается...</p>
    <p style="font-size:14px;color:var(--text-secondary);">Это может занять несколько минут</p>
  </div>
}

@keyframes spin { to { transform: rotate(360deg); } }
```

Add `OnDestroy` cleaning:
```typescript
ngOnDestroy() {
  this.#sub.unsubscribe();
  this.#maintenanceSub?.unsubscribe();
}
```

Add imports: `switchMap` from 'rxjs'.

- [ ] Edit `api.service.ts` — add `checkHealth()` method
- [ ] Edit `app.ts` — add maintenance poll + overlay, import switchMap

---

### Task 13: Commit everything + push

```bash
git add -A
git commit -m "feat: add backup/restore system with CLI, admin API, and frontend"
git push
```

- [ ] Commit and push
