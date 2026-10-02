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
	// ":memory:" gives every pooled connection its own private database, so the
	// schema created on one connection is invisible to the next statement. Pin the
	// pool to a single connection - the same trap the pure-Go migration in
	// ROADMAP v2.0.0 (0.1) has to keep in mind.
	db.SetMaxOpenConns(1)
	// Single schema from database.ApplySchema; this file used to carry its own
	// DDL copy, and the copies drifted silently.
	if err := database.ApplySchema(db); err != nil {
		t.Fatalf("schema: %v", err)
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
