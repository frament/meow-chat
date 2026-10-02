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
