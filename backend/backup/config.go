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
