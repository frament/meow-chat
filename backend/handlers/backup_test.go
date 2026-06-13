package handlers

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackupSettings(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, true)
	oldDBPath := os.Getenv("DB_PATH")
	dbPath := filepath.Join(os.TempDir(), "test_backup_chat.db")
	os.Setenv("DB_PATH", dbPath)
	defer os.Setenv("DB_PATH", oldDBPath)
	defer os.Remove(dbPath)
	defer os.Remove(filepath.Join(os.TempDir(), "backup-config.json"))

	t.Run("get settings", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/admin/backup/settings", nil)
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d: %s", resp.StatusCode, string(body))
		}
	})

	t.Run("update settings", func(t *testing.T) {
		backupDir := filepath.Join(os.TempDir(), "test_backups")
		body := `{"backup_dir":"` + strings.ReplaceAll(backupDir, "\\", "\\\\") + `"}`
		req, _ := http.NewRequest("PUT", "/admin/backup/settings", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		respBody, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d: body=%s, DB_PATH=%s, backupDir=%s", resp.StatusCode, string(respBody), os.Getenv("DB_PATH"), backupDir)
		}
	})
}

func TestAdminListBackups_Empty(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, true)
	oldDBPath := os.Getenv("DB_PATH")
	dbPath := filepath.Join(os.TempDir(), "test_backup_chat2.db")
	os.Setenv("DB_PATH", dbPath)
	defer os.Setenv("DB_PATH", oldDBPath)
	defer os.Remove(dbPath)
	defer os.Remove(filepath.Join(os.TempDir(), "backup-config.json"))

	req, _ := http.NewRequest("GET", "/admin/backups", nil)
	req.Header.Set("Authorization", token)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestAdminDeleteBackup_NotFound(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, true)
	oldDBPath := os.Getenv("DB_PATH")
	dbPath := filepath.Join(os.TempDir(), "test_backup_chat3.db")
	os.Setenv("DB_PATH", dbPath)
	defer os.Setenv("DB_PATH", oldDBPath)
	defer os.Remove(dbPath)
	defer os.Remove(filepath.Join(os.TempDir(), "backup-config.json"))

	req, _ := http.NewRequest("DELETE", "/admin/backups/nonexistent.zip", nil)
	req.Header.Set("Authorization", token)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}
