package backup

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.BackupDir != "./backups" {
		t.Errorf("expected ./backups, got %s", cfg.BackupDir)
	}
}

func TestConfigPath(t *testing.T) {
	path := ConfigPath("/data/chat.db")
	expected := filepath.Join("/data", "backup-config.json")
	if path != expected {
		t.Errorf("expected %s, got %s", expected, path)
	}
}

func TestLoadConfig_CreatesDefault(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "chat.db")

	cfg, err := LoadConfig(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BackupDir != "./backups" {
		t.Errorf("expected ./backups, got %s", cfg.BackupDir)
	}

	if _, err := os.Stat(filepath.Join(dir, "backup-config.json")); os.IsNotExist(err) {
		t.Error("backup-config.json should exist after LoadConfig")
	}
}

func TestLoadConfig_ReadsExisting(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "chat.db")

	if err := SaveConfig(dbPath, BackupConfig{BackupDir: "/custom/backups"}); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadConfig(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BackupDir != "/custom/backups" {
		t.Errorf("expected /custom/backups, got %s", cfg.BackupDir)
	}
}

func TestSaveConfig(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "chat.db")
	cfg := BackupConfig{BackupDir: "/custom/backups"}

	err := SaveConfig(dbPath, cfg)
	if err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(dir, "backup-config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 {
		t.Error("config file should not be empty")
	}
}

func TestLoadConfig_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "chat.db")

	SaveConfig(dbPath, BackupConfig{BackupDir: ""})

	cfg, err := LoadConfig(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BackupDir != "./backups" {
		t.Errorf("expected ./backups default, got %s", cfg.BackupDir)
	}
}
