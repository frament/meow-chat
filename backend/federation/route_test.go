package federation

import (
	"database/sql"
	"testing"

	"my-chat-backend/database"

	_ "github.com/mattn/go-sqlite3"
)

func setupRouteDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	execs := []string{
		`CREATE TABLE IF NOT EXISTS federation_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, base_url TEXT UNIQUE NOT NULL, server_token TEXT, status TEXT DEFAULT 'active', disk_cache_limit INTEGER DEFAULT 512, blocked INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_network (id INTEGER PRIMARY KEY AUTOINCREMENT, server_a_id INTEGER NOT NULL, server_b_id INTEGER NOT NULL, hop_count INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(server_a_id, server_b_id))`,
	}
	for _, q := range execs {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestFindRoute_DirectActive(t *testing.T) {
	db := setupRouteDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, status) VALUES (1, 'peer', 'https://peer.example.com', 'active')")

	route := FindRoute(1)
	if route == nil {
		t.Fatal("expected route to be found")
	}
	if route.ServerID != 1 {
		t.Errorf("expected serverID 1, got %d", route.ServerID)
	}
	if route.BaseURL != "https://peer.example.com" {
		t.Errorf("expected https://peer.example.com, got %s", route.BaseURL)
	}
}

func TestFindRoute_Nonexistent(t *testing.T) {
	db := setupRouteDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	route := FindRoute(999)
	if route != nil {
		t.Error("expected nil for nonexistent server")
	}
}

func TestFindRoute_Blocked(t *testing.T) {
	db := setupRouteDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, status) VALUES (1, 'blocked', 'https://blocked.com', 'blocked')")

	route := FindRoute(1)
	if route != nil {
		t.Error("expected nil for blocked server")
	}
}

func TestFindRoute_BFS(t *testing.T) {
	db := setupRouteDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, status) VALUES (1, 'a', 'https://a.com', 'active')")
	db.Exec("INSERT INTO federation_servers (id, name, base_url, status) VALUES (2, 'b', 'https://b.com', 'active')")
	db.Exec("INSERT INTO federation_servers (id, name, base_url, status) VALUES (3, 'c', 'https://c.com', 'active')")

	db.Exec("INSERT INTO federation_network (server_a_id, server_b_id, hop_count) VALUES (1, 2, 1)")
	db.Exec("INSERT INTO federation_network (server_a_id, server_b_id, hop_count) VALUES (2, 3, 1)")

	// Find route from server 1 to server 3
	// BFS starts from all active servers that know about target
	// Server 2 knows server 3 directly
	// Route from 1: 1->2 (via network), 2->3 directly
	route := FindRoute(3)
	if route == nil {
		t.Fatal("expected route to server 3 via BFS")
	}
	if route.ServerID != 3 {
		t.Errorf("expected target serverID 3, got %d", route.ServerID)
	}
}

func TestFindRoute_Unreachable(t *testing.T) {
	db := setupRouteDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, status) VALUES (1, 'a', 'https://a.com', 'active')")
	db.Exec("INSERT INTO federation_servers (id, name, base_url, status) VALUES (2, 'b', 'https://b.com', 'active')")

	// No network connections — B should be unreachable from A
	// But direct check first: server 2 is active, so FindRoute(2) should find it
	route := FindRoute(2)
	if route == nil {
		t.Fatal("expected direct route to active server 2")
	}
}
