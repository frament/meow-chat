package federation

import (
	"database/sql"
	"testing"

	"my-chat-backend/database"

	_ "github.com/mattn/go-sqlite3"
)

func setupQueueDB(t *testing.T) *sql.DB {
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

func TestNewQueue(t *testing.T) {
	q := NewQueue(NewTransport())
	if q == nil {
		t.Fatal("expected non-nil queue")
	}
}

func TestEnqueue(t *testing.T) {
	db := setupQueueDB(t)
	defer db.Close()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', 'https://example.com', 'tok', 'active')")

	q := NewQueue(NewTransport())
	err := q.Enqueue(1, "/api/federation/v1/send-message", map[string]string{"content": "hello"})
	if err != nil {
		t.Fatal(err)
	}

	var count int
	db.QueryRow("SELECT COUNT(*) FROM federation_queue WHERE server_id=1").Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 queued item, got %d", count)
	}

	var endpoint string
	var body string
	db.QueryRow("SELECT endpoint, body FROM federation_queue WHERE server_id=1").Scan(&endpoint, &body)
	if endpoint != "/api/federation/v1/send-message" {
		t.Errorf("expected /api/federation/v1/send-message, got %s", endpoint)
	}
	if body == "" {
		t.Error("expected non-empty body")
	}
}

func TestDrainFailed(t *testing.T) {
	db := setupQueueDB(t)
	defer db.Close()

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', 'https://example.com', 'tok', 'active')")
	db.Exec("INSERT INTO federation_queue (server_id, endpoint, body, attempts, max_attempts) VALUES (1, 'test', '{}', 5, 3)")
	db.Exec("INSERT INTO federation_queue (server_id, endpoint, body, attempts, max_attempts) VALUES (1, 'test2', '{}', 3, 5)")

	q := NewQueue(NewTransport())
	q.DrainFailed(1)

	// Item 1: attempts=5, max_attempts=3 → 5 >= 3 → reset attempts to 0
	var attempts1 int
	db.QueryRow("SELECT attempts FROM federation_queue WHERE id=1").Scan(&attempts1)
	if attempts1 != 0 {
		t.Errorf("expected attempts reset to 0, got %d", attempts1)
	}

	// Item 2: attempts=3, max_attempts=5 → 3 < 5 → not affected
	var attempts2 int
	db.QueryRow("SELECT attempts FROM federation_queue WHERE id=2").Scan(&attempts2)
	if attempts2 != 3 {
		t.Errorf("expected attempts unchanged (3), got %d", attempts2)
	}
}

func TestEnqueueToNonexistentServer(t *testing.T) {
	db := setupQueueDB(t)
	defer db.Close()

	q := NewQueue(NewTransport())

	// No FK enforcement by default in SQLite, so this succeeds
	err := q.Enqueue(999, "/test", "{}")
	if err != nil {
		t.Fatal(err)
	}

	var count int
	db.QueryRow("SELECT COUNT(*) FROM federation_queue").Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 queued item despite nonexistent server, got %d", count)
	}
}
