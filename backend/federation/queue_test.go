package federation

import (
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"my-chat-backend/database"

	_ "github.com/mattn/go-sqlite3"
)

func setupQueueDB(t *testing.T) *sql.DB {
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

// peer spins up an HTTP server standing in for the other household's server,
// registers it in federation_servers, and returns the server row id. The
// handler decides whether the peer is answering.
func peer(t *testing.T, db *sql.DB, id int64, status string, handler http.HandlerFunc) int64 {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	if _, err := db.Exec(
		"INSERT OR REPLACE INTO federation_servers (id, name, base_url, server_token, status) VALUES (?, 'peer', ?, 'tok', ?)",
		id, srv.URL, status,
	); err != nil {
		t.Fatalf("register peer: %v", err)
	}
	return id
}

func queueCount(t *testing.T, db *sql.DB, serverID int64) int {
	t.Helper()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM federation_queue WHERE server_id = ?", serverID).Scan(&n); err != nil {
		t.Fatalf("count queue: %v", err)
	}
	return n
}

// The bug this closes: SendMessage used to call Transport.Send and discard both
// return values, so a message to an unreachable peer was neither delivered nor
// stored, and the sender was told it went out.
func TestSendOrQueue_UnreachablePeerLandsInQueue(t *testing.T) {
	db := setupQueueDB(t)
	defer db.Close()

	// "unreachable" makes getServerToken refuse before any request is made,
	// which is exactly the state a peer is left in while it is down.
	peer(t, db, 1, "unreachable", func(w http.ResponseWriter, r *http.Request) {
		t.Error("a peer marked unreachable must not be contacted")
	})

	q := NewQueue(NewTransport())
	err := SendOrQueue(NewTransport(), q, FederationRequest{
		ServerID: 1,
		Endpoint: "/api/federation/v1/send-message",
		Method:   "POST",
		Body:     map[string]string{"content": "does not get lost"},
	})
	if err != nil {
		t.Fatalf("an unreachable peer must not fail the caller, got %v", err)
	}
	if n := queueCount(t, db, 1); n != 1 {
		t.Fatalf("expected the message to be queued, got %d queued items", n)
	}

	var body string
	db.QueryRow("SELECT body FROM federation_queue WHERE server_id = 1").Scan(&body)
	if !strings.Contains(body, "does not get lost") {
		t.Errorf("queued body lost the message: %s", body)
	}
}

func TestSendOrQueue_ReachablePeerIsNotQueued(t *testing.T) {
	db := setupQueueDB(t)
	defer db.Close()

	var got string
	peer(t, db, 1, "active", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got = string(b)
		w.WriteHeader(200)
	})

	q := NewQueue(NewTransport())
	if err := SendOrQueue(NewTransport(), q, FederationRequest{
		ServerID: 1, Endpoint: "/api/federation/v1/send-message", Method: "POST",
		Body: map[string]string{"content": "delivered now"},
	}); err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(got, "delivered now") {
		t.Errorf("peer did not receive the message, got body %q", got)
	}
	if n := queueCount(t, db, 1); n != 0 {
		t.Errorf("a delivered message must not be queued, got %d queued items", n)
	}
}

// A peer answering 500 is still a failed delivery, and the sender must not be
// left believing it arrived.
func TestSendOrQueue_ServerErrorQueues(t *testing.T) {
	db := setupQueueDB(t)
	defer db.Close()

	peer(t, db, 1, "active", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	})

	q := NewQueue(NewTransport())
	if err := SendOrQueue(NewTransport(), q, FederationRequest{
		ServerID: 1, Endpoint: "/api/federation/v1/send-message", Method: "POST",
		Body: map[string]string{"content": "peer blew up"},
	}); err != nil {
		t.Fatal(err)
	}
	if n := queueCount(t, db, 1); n != 1 {
		t.Fatalf("a 500 from the peer must fall back to the queue, got %d queued items", n)
	}
}

// Head-of-line blocking: the old batch query took 50 rows regardless of peer
// state, so one dead peer filled the whole batch and every other peer's
// messages waited behind it indefinitely.
func TestProcessPending_DeadPeerDoesNotStarveOthers(t *testing.T) {
	db := setupQueueDB(t)
	defer db.Close()

	var healthyHits int
	peer(t, db, 1, "unreachable", func(w http.ResponseWriter, r *http.Request) {
		t.Error("dead peer must not be contacted")
	})
	peer(t, db, 2, "active", func(w http.ResponseWriter, r *http.Request) {
		healthyHits++
		w.WriteHeader(200)
	})

	// Fifty items for the dead peer, one for the healthy one. The old LIMIT 50
	// would have been entirely consumed by the dead peer.
	for i := 0; i < 50; i++ {
		db.Exec("INSERT INTO federation_queue (server_id, endpoint, body) VALUES (1, '/e', '{}')")
	}
	db.Exec("INSERT INTO federation_queue (server_id, endpoint, body) VALUES (2, '/e', '{}')")

	NewQueue(NewTransport()).processPending()

	if healthyHits == 0 {
		t.Error("the healthy peer's message was starved behind the dead peer's backlog")
	}
	if n := queueCount(t, db, 2); n != 0 {
		t.Errorf("healthy peer's message was not delivered, %d still queued", n)
	}
	if n := queueCount(t, db, 1); n != 50 {
		t.Errorf("dead peer's items should stay queued untouched, got %d", n)
	}
}

// Recovery used to depend entirely on catching an unreachable -> active
// transition. A peer that flapped and came back between two health pings never
// produced that transition, so its exhausted items were never re-armed and the
// message sat there forever.
func TestProcessPending_RearmsExhaustedItemsForActivePeer(t *testing.T) {
	db := setupQueueDB(t)
	defer db.Close()

	var hits int
	peer(t, db, 1, "active", func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(200)
	})

	db.Exec("INSERT INTO federation_queue (server_id, endpoint, body, attempts, max_attempts) VALUES (1, '/e', '{}', 3, 3)")

	NewQueue(NewTransport()).processPending()

	if hits != 1 {
		t.Errorf("expected the re-armed item to be delivered once, got %d deliveries", hits)
	}
	if n := queueCount(t, db, 1); n != 0 {
		t.Errorf("expected the queue to be empty after delivery, got %d", n)
	}
}

// processItem used to go through SendWithRetry, which sleeps 1s+5s+15s per item
// even when the send fails instantly. Against a batch that is the difference
// between milliseconds and seventeen minutes of the drain goroutine asleep.
func TestProcessPending_DoesNotSleepRetryPerItem(t *testing.T) {
	db := setupQueueDB(t)
	defer db.Close()

	peer(t, db, 1, "active", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
	})

	for i := 0; i < 5; i++ {
		db.Exec("INSERT INTO federation_queue (server_id, endpoint, body) VALUES (1, '/e', '{}')")
	}

	q := NewQueue(NewTransport())
	start := time.Now()
	q.processPending()
	elapsed := time.Since(start)

	if elapsed > 5*time.Second {
		t.Errorf("draining 5 failing items took %v - it is sleeping between retries", elapsed)
	}

	var attempts int
	db.QueryRow("SELECT attempts FROM federation_queue WHERE server_id = 1 LIMIT 1").Scan(&attempts)
	if attempts != 1 {
		t.Errorf("expected one attempt counted per drain tick, got %d", attempts)
	}
}

func TestHealthInterval_FastWhenPeerDownOrQueueStuck(t *testing.T) {
	db := setupQueueDB(t)
	defer db.Close()

	hc := NewHealthChecker(NewTransport(), NewQueue(NewTransport()))

	if got := hc.interval(); got != healthIntervalSlow {
		t.Errorf("healthy and idle server should ping slowly, got %v", got)
	}

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'p', 'http://x', 't', 'unreachable')")
	if got := hc.interval(); got != healthIntervalFast {
		t.Errorf("an unreachable peer should be pinged fast so recovery is noticed, got %v", got)
	}

	db.Exec("UPDATE federation_servers SET status = 'active'")
	db.Exec("INSERT INTO federation_queue (server_id, endpoint, body, attempts) VALUES (1, '/e', '{}', 1)")
	if got := hc.interval(); got != healthIntervalFast {
		t.Errorf("stuck queue items should keep the fast cadence, got %v", got)
	}
}
