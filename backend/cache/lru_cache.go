package cache

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"my-chat-backend/database"
)

func ntoa(i int64) string {
	return fmt.Sprintf("%d", i)
}

const cacheBaseDir = "./uploads/federation_cache"

func EnsureCacheDir() {
	if err := os.MkdirAll(cacheBaseDir, 0755); err != nil {
		log.Fatal("Failed to create federation cache directory:", err)
	}
}

func CacheFilePath(serverID int64, remotePath string) string {
	return filepath.Join(cacheBaseDir, ntoa(serverID), remotePath)
}

func StoreFile(serverID int64, cacheKey string, data []byte) error {
	cacheDir := filepath.Join(cacheBaseDir, ntoa(serverID))
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return err
	}

	localPath := filepath.Join(cacheDir, cacheKey)
	if err := os.WriteFile(localPath, data, 0644); err != nil {
		return err
	}

	database.DB.Exec(
		`INSERT OR REPLACE INTO federation_cache_entries (server_id, cache_key, data_type, size_bytes, accessed_at, created_at)
		 VALUES (?, ?, 'file', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		serverID, cacheKey, int64(len(data)),
	)

	EnforceLimit(serverID)
	return nil
}

func ReadFile(serverID int64, cacheKey string) []byte {
	localPath := filepath.Join(cacheBaseDir, ntoa(serverID), cacheKey)
	data, err := os.ReadFile(localPath)
	if err != nil {
		return nil
	}

	database.DB.Exec(
		"UPDATE federation_cache_entries SET accessed_at = CURRENT_TIMESTAMP WHERE server_id = ? AND cache_key = ?",
		serverID, cacheKey,
	)

	return data
}

func FileExists(serverID int64, cacheKey string) bool {
	localPath := filepath.Join(cacheBaseDir, ntoa(serverID), cacheKey)
	_, err := os.Stat(localPath)
	return err == nil
}

func EnforceLimit(serverID int64) {
	var limitMB int
	database.DB.QueryRow(
		"SELECT disk_cache_limit FROM federation_servers WHERE id = ?", serverID,
	).Scan(&limitMB)
	if limitMB <= 0 {
		return
	}

	limitBytes := int64(limitMB) * 1024 * 1024

	var totalBytes int64
	database.DB.QueryRow(
		"SELECT COALESCE(SUM(size_bytes), 0) FROM federation_cache_entries WHERE server_id = ?",
		serverID,
	).Scan(&totalBytes)

	for totalBytes > limitBytes {
		var entryID int64
		var cacheKey string
		var size int64
		err := database.DB.QueryRow(
			"SELECT id, cache_key, size_bytes FROM federation_cache_entries WHERE server_id = ? ORDER BY accessed_at ASC LIMIT 1",
			serverID,
		).Scan(&entryID, &cacheKey, &size)
		if err != nil {
			break
		}

		localPath := filepath.Join(cacheBaseDir, ntoa(serverID), cacheKey)
		os.Remove(localPath)

		database.DB.Exec("DELETE FROM federation_cache_entries WHERE id = ?", entryID)
		totalBytes -= size
	}
}

func GetStats(serverID int64) (totalBytes int64, fileCount int) {
	database.DB.QueryRow(
		"SELECT COALESCE(SUM(size_bytes), 0), COUNT(*) FROM federation_cache_entries WHERE server_id = ?",
		serverID,
	).Scan(&totalBytes, &fileCount)
	return
}

func ClearServerCache(serverID int64) error {
	cacheDir := filepath.Join(cacheBaseDir, ntoa(serverID))
	if err := os.RemoveAll(cacheDir); err != nil {
		return err
	}
	_, err := database.DB.Exec("DELETE FROM federation_cache_entries WHERE server_id = ?", serverID)
	return err
}
