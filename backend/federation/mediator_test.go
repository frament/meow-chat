package federation

import (
	"database/sql"
	"testing"

	"my-chat-backend/database"

	_ "github.com/mattn/go-sqlite3"
)

func setupFederationDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	execs := []string{
		`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, avatar_url TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, base_url TEXT UNIQUE NOT NULL, server_token TEXT, status TEXT DEFAULT 'active', disk_cache_limit INTEGER DEFAULT 512, blocked INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_users (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL REFERENCES federation_servers(id), remote_id INTEGER NOT NULL, username TEXT NOT NULL, avatar_url TEXT DEFAULT '', email TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(server_id, remote_id))`,
	}
	for _, q := range execs {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestIsRemoteUser_Local(t *testing.T) {
	db := setupFederationDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	_, err := db.Exec("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", "local", "local@test.com", "hash")
	if err != nil {
		t.Fatal(err)
	}

	isRemote, serverID := IsRemoteUser(1)
	if isRemote {
		t.Error("expected local user to not be remote")
	}
	if serverID != 0 {
		t.Errorf("expected serverID 0, got %d", serverID)
	}
}

func TestIsRemoteUser_Remote(t *testing.T) {
	db := setupFederationDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	db.Exec("INSERT INTO federation_servers (id, name, base_url) VALUES (1, 'remote', 'https://example.com')")
	db.Exec("INSERT INTO federation_users (server_id, remote_id, username, email) VALUES (1, 100, 'remoteuser', 'r@t.com')")

	isRemote, serverID := IsRemoteUser(100)
	if !isRemote {
		t.Error("expected user 100 to be remote")
	}
	if serverID != 1 {
		t.Errorf("expected serverID 1, got %d", serverID)
	}
}

func TestIsRemoteUser_NotFound(t *testing.T) {
	db := setupFederationDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	db.Exec("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", "user", "u@t.com", "hash")

	isRemote, serverID := IsRemoteUser(1)
	if isRemote {
		t.Error("expected not remote for user 1")
	}
	if serverID != 0 {
		t.Errorf("expected serverID 0, got %d", serverID)
	}
}

func TestGetLocalUserID(t *testing.T) {
	db := setupFederationDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	db.Exec("INSERT INTO federation_servers (id, name, base_url) VALUES (1, 'remote', 'https://example.com')")
	db.Exec("INSERT INTO federation_users (id, server_id, remote_id, username, email) VALUES (1, 1, 100, 'remoteuser', 'r@t.com')")

	localID, err := GetLocalUserID(1, 100)
	if err != nil {
		t.Fatal(err)
	}
	if localID != 1 {
		t.Errorf("expected localID 1, got %d", localID)
	}
}

func TestGetLocalUserID_NotFound(t *testing.T) {
	db := setupFederationDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	_, err := GetLocalUserID(999, 999)
	if err == nil {
		t.Error("expected error for nonexistent user")
	}
}

func TestResolveUserID(t *testing.T) {
	db := setupFederationDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	db.Exec("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", "local", "l@t.com", "hash")

	isLocal, serverID := ResolveUserID(1)
	if !isLocal {
		t.Error("expected user 1 to be local")
	}
	if serverID != 0 {
		t.Errorf("expected serverID 0, got %d", serverID)
	}
}

func TestResolveUserID_Remote(t *testing.T) {
	db := setupFederationDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	db.Exec("INSERT INTO federation_servers (id, name, base_url) VALUES (1, 'remote', 'https://example.com')")
	db.Exec("INSERT INTO federation_users (server_id, remote_id, username, email) VALUES (1, 100, 'remoteuser', 'r@t.com')")

	isLocal, serverID := ResolveUserID(100)
	if isLocal {
		t.Error("expected user 100 to be remote")
	}
	if serverID != 1 {
		t.Errorf("expected serverID 1, got %d", serverID)
	}
}