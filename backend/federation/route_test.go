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

// mustExec fails the test on error. A bare db.Exec on a fixture insert is how a
// schema mismatch hides: the INSERT is rejected, the row never appears, and the
// test fails somewhere else with a message that points nowhere near the cause.
func mustExec(t *testing.T, db *sql.DB, query string) {
	t.Helper()
	if _, err := db.Exec(query); err != nil {
		t.Fatalf("exec: %v\n  query: %s", err, query)
	}
}

func TestFindRoute_DirectActive(t *testing.T) {
	db := setupRouteDB(t)
	defer db.Close()
	originalDB := database.DB
	database.DB = db
	defer func() { database.DB = originalDB }()

	mustExec(t, db, "INSERT INTO federation_servers (id, name, base_url, status, server_token) VALUES (1, 'peer', 'https://peer.example.com', 'active', 'tok')")

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

	mustExec(t, db, "INSERT INTO federation_servers (id, name, base_url, status, server_token) VALUES (1, 'blocked', 'https://blocked.com', 'blocked', 'tok')")

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

	mustExec(t, db, "INSERT INTO federation_servers (id, name, base_url, status, server_token) VALUES (1, 'a', 'https://a.com', 'active', 'tok')")
	mustExec(t, db, "INSERT INTO federation_servers (id, name, base_url, status, server_token) VALUES (2, 'b', 'https://b.com', 'active', 'tok')")
	mustExec(t, db, "INSERT INTO federation_servers (id, name, base_url, status, server_token) VALUES (3, 'c', 'https://c.com', 'active', 'tok')")

	// federation_network is "peers we know about": server_id is the peer and
	// known_by_server_id is us. The fixture used to insert server_a_id /
	// server_b_id / hop_count - columns the application has never had, so this
	// test had been passing against a schema that does not exist.
	mustExec(t, db, "INSERT INTO federation_network (server_id, name, base_url, known_by_server_id) VALUES (1, 'a', 'https://a.com', 1)")
	mustExec(t, db, "INSERT INTO federation_network (server_id, name, base_url, known_by_server_id) VALUES (2, 'b', 'https://b.com', 1)")
	mustExec(t, db, "INSERT INTO federation_network (server_id, name, base_url, known_by_server_id) VALUES (3, 'c', 'https://c.com', 2)")

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

	mustExec(t, db, "INSERT INTO federation_servers (id, name, base_url, status, server_token) VALUES (1, 'a', 'https://a.com', 'active', 'tok')")
	mustExec(t, db, "INSERT INTO federation_servers (id, name, base_url, status, server_token) VALUES (2, 'b', 'https://b.com', 'active', 'tok')")

	// No network connections — B should be unreachable from A
	// But direct check first: server 2 is active, so FindRoute(2) should find it
	route := FindRoute(2)
	if route == nil {
		t.Fatal("expected direct route to active server 2")
	}
}
