package handlers

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

type BackupEntry struct {
	Filename  string `json:"filename"`
	SizeBytes int64  `json:"size_bytes"`
	CreatedAt string `json:"created_at"`
}

func getBackupDir(dbPath string) (string, error) {
	cfg, err := backup.LoadConfig(dbPath)
	if err != nil {
		return "", err
	}
	return cfg.BackupDir, nil
}

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

	if err := os.MkdirAll(req.BackupDir, 0755); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Cannot create directory: " + err.Error()})
	}

	if err := backup.SaveConfig(dbPath, req); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message": "Saved"})
}

func (h *Handler) AdminListBackups(c *fiber.Ctx) error {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}

	backupDir, err := getBackupDir(dbPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return c.JSON(make([]BackupEntry, 0))
	}

	result := make([]BackupEntry, 0)
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".zip") {
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
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}

	backupDir, err := getBackupDir(dbPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	workingDir, _ := os.Getwd()
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
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}

	backupDir, err := getBackupDir(dbPath)
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
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}

	backupDir, err := getBackupDir(dbPath)
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
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}

	backupDir, err := getBackupDir(dbPath)
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
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}

	backupDir, err := getBackupDir(dbPath)
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

	workingDir, _ := os.Getwd()
	dataDir := filepath.Dir(dbPath)

	os.WriteFile(filepath.Join(dataDir, ".maintenance"), []byte{}, 0644)

	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer r.Close()

	for _, f := range r.File {
		var dest string
		switch {
		case f.Name == "chat.db":
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
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		rc, err := f.Open()
		if err != nil {
			out.Close()
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		io.Copy(out, rc)
		out.Close()
		rc.Close()
	}

	marker := map[string]string{"filename": filename}
	markerData, _ := json.Marshal(marker)
	os.WriteFile(filepath.Join(dataDir, ".restore-pending"), markerData, 0644)

	go func() {
		time.Sleep(500 * time.Millisecond)
		p, _ := os.FindProcess(1)
		if p != nil {
			p.Signal(syscall.SIGTERM)
		}
	}()

	return c.JSON(fiber.Map{"message": "Restore in progress — restarting server"})
}
