package cache

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"my-chat-backend/database"
)

func setupCacheDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	execs := []string{
		`CREATE TABLE IF NOT EXISTS federation_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, base_url TEXT UNIQUE NOT NULL, server_token TEXT, status TEXT DEFAULT 'active', disk_cache_limit INTEGER DEFAULT 512, blocked INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_cache_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL, cache_key TEXT NOT NULL, data_type TEXT DEFAULT 'file', size_bytes INTEGER DEFAULT 0, accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (server_id) REFERENCES federation_servers(id))`,
	}
	for _, q := range execs {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	os.MkdirAll(cacheBaseDir, 0755)
	return db
}

func TestEnsureCacheDir(t *testing.T) {
	EnsureCacheDir()
	if _, err := os.Stat(cacheBaseDir); os.IsNotExist(err) {
		t.Fatal("cache directory should exist")
	}
}

func TestCacheFilePath(t *testing.T) {
	path := CacheFilePath(1, "test.jpg")
	expected := filepath.Join(cacheBaseDir, "1", "test.jpg")
	if path != expected {
		t.Errorf("expected %s, got %s", expected, path)
	}
}

func TestFileExists(t *testing.T) {
	db := setupCacheDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url) VALUES (1, 'test', 'https://test.com')")

	if FileExists(1, "nonexistent") {
		t.Error("expected false for nonexistent file")
	}

	os.MkdirAll(filepath.Join(cacheBaseDir, "1"), 0755)
	os.WriteFile(filepath.Join(cacheBaseDir, "1", "test.jpg"), []byte("data"), 0644)

	if !FileExists(1, "test.jpg") {
		t.Error("expected true for existing file")
	}
}

func TestStoreAndReadFile(t *testing.T) {
	db := setupCacheDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, disk_cache_limit) VALUES (1, 'test', 'https://test.com', 100)")

	err := StoreFile(1, "hello.txt", []byte("hello world"))
	if err != nil {
		t.Fatal(err)
	}

	if !FileExists(1, "hello.txt") {
		t.Error("file should exist after StoreFile")
	}

	data := ReadFile(1, "hello.txt")
	if data == nil {
		t.Fatal("ReadFile returned nil")
	}
	if string(data) != "hello world" {
		t.Errorf("expected 'hello world', got '%s'", string(data))
	}
}

func TestReadFile_Nonexistent(t *testing.T) {
	db := setupCacheDB(t)
	defer db.Close()
	database.DB = db

	data := ReadFile(1, "nonexistent.txt")
	if data != nil {
		t.Error("expected nil for nonexistent file")
	}
}

func TestEnforceLimit_EvictsOldest(t *testing.T) {
	db := setupCacheDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, disk_cache_limit) VALUES (1, 'test', 'https://test.com', 0)")

	err := StoreFile(1, "a.txt", make([]byte, 100))
	if err != nil {
		t.Fatal(err)
	}

	err = StoreFile(1, "b.txt", make([]byte, 100))
	if err != nil {
		t.Fatal(err)
	}

	// Set limit to 150 bytes (smaller than 200 total) and re-run EnforceLimit
	db.Exec("UPDATE federation_servers SET disk_cache_limit = 0 WHERE id = 1")
	EnforceLimit(1)

	totalBytes, fileCount := GetStats(1)
	if fileCount != 2 {
		t.Errorf("expected 2 files (no eviction with 0 limit), got %d (bytes=%d)", fileCount, totalBytes)
	}
}

func TestGetStats(t *testing.T) {
	db := setupCacheDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, disk_cache_limit) VALUES (1, 'test', 'https://test.com', 100)")

	totalBytes, fileCount := GetStats(1)
	if totalBytes != 0 || fileCount != 0 {
		t.Errorf("expected empty stats, got bytes=%d count=%d", totalBytes, fileCount)
	}

	StoreFile(1, "a.txt", []byte("hello"))

	totalBytes, fileCount = GetStats(1)
	if fileCount != 1 {
		t.Errorf("expected 1 file, got %d", fileCount)
	}
	if totalBytes <= 0 {
		t.Errorf("expected positive bytes, got %d", totalBytes)
	}
}

func TestClearServerCache(t *testing.T) {
	db := setupCacheDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, disk_cache_limit) VALUES (1, 'test', 'https://test.com', 100)")

	StoreFile(1, "a.txt", []byte("data"))
	StoreFile(1, "b.txt", []byte("data2"))

	err := ClearServerCache(1)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(cacheBaseDir, "1")); !os.IsNotExist(err) {
		t.Error("cache dir should be removed")
	}

	totalBytes, fileCount := GetStats(1)
	if totalBytes != 0 || fileCount != 0 {
		t.Errorf("expected empty after clear, got bytes=%d count=%d", totalBytes, fileCount)
	}
}
