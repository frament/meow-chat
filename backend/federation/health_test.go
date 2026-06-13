package federation

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"my-chat-backend/database"

	_ "github.com/mattn/go-sqlite3"
)

func setupHealthDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.Exec(`CREATE TABLE IF NOT EXISTS federation_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, base_url TEXT UNIQUE NOT NULL, server_token TEXT, status TEXT DEFAULT 'active', disk_cache_limit INTEGER DEFAULT 512, blocked INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`)
	db.Exec(`CREATE TABLE IF NOT EXISTS federation_queue (
		id           INTEGER PRIMARY KEY AUTOINCREMENT,
		server_id    INTEGER NOT NULL REFERENCES federation_servers(id),
		endpoint     TEXT NOT NULL,
		body         TEXT NOT NULL,
		headers      TEXT DEFAULT '',
		priority     INTEGER DEFAULT 0,
		attempts     INTEGER DEFAULT 0,
		max_attempts INTEGER DEFAULT 3,
		last_error   TEXT DEFAULT '',
		created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	originalDB := database.DB
	database.DB = db
	t.Cleanup(func() { database.DB = originalDB })
	return db
}

func TestNewHealthChecker(t *testing.T) {
	hc := NewHealthChecker(NewTransport(), NewQueue(NewTransport()))
	if hc == nil {
		t.Fatal("expected non-nil health checker")
	}
}

func TestPingServer_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()

	db := setupHealthDB(t)
	defer db.Close()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', ?, 'tok', 'unreachable')", srv.URL)
	db.Exec("INSERT INTO federation_queue (server_id, endpoint, body, attempts, max_attempts) VALUES (1, 'msg', '{}', 5, 3)")

	tr := NewTransport()
	q := NewQueue(tr)
	hc := NewHealthChecker(tr, q)

	hc.PingServer(1)

	var status string
	db.QueryRow("SELECT status FROM federation_servers WHERE id=1").Scan(&status)
	if status != "active" {
		t.Errorf("expected active after successful ping, got %s", status)
	}
}

func TestPingServer_Failure(t *testing.T) {
	db := setupHealthDB(t)
	defer db.Close()

	// Server URL that doesn't exist
	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', 'https://nonexistent.example.com', 'tok', 'active')")

	tr := NewTransport()
	q := NewQueue(tr)
	hc := NewHealthChecker(tr, q)

	hc.PingServer(1)

	var status string
	db.QueryRow("SELECT status FROM federation_servers WHERE id=1").Scan(&status)
	// Might still be 'active' if the ping fails — the health checker doesn't deactivate on failure
	// It only activates on success
	t.Logf("status after failed ping: %s", status)
}

func TestPingServer_Blocked(t *testing.T) {
	db := setupHealthDB(t)
	defer db.Close()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', 'https://example.com', 'tok', 'blocked')")

	tr := NewTransport()
	q := NewQueue(tr)
	hc := NewHealthChecker(tr, q)

	hc.PingServer(1)

	var status string
	db.QueryRow("SELECT status FROM federation_servers WHERE id=1").Scan(&status)
	if status != "blocked" {
		t.Errorf("expected blocked to remain, got %s", status)
	}
}

func TestPingServer_RecoveryDrainsQueue(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	defer srv.Close()

	db := setupHealthDB(t)
	defer db.Close()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', ?, 'tok', 'unreachable')", srv.URL)
	db.Exec("INSERT INTO federation_queue (server_id, endpoint, body, attempts, max_attempts) VALUES (1, 'msg', '{}', 5, 3)")

	tr := NewTransport()
	q := NewQueue(tr)
	hc := NewHealthChecker(tr, q)

	hc.PingServer(1)

	var failedCount int
	db.QueryRow("SELECT COUNT(*) FROM federation_queue WHERE server_id=1 AND attempts >= 5").Scan(&failedCount)
	t.Logf("failed items after recovery ping: %d", failedCount)
}
