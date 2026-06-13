package federation

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"my-chat-backend/database"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

func setupHandlerDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	execs := []string{
		`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, avatar_url TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, from_user_id INTEGER NOT NULL, to_user_id INTEGER NOT NULL, content TEXT NOT NULL, msg_type TEXT DEFAULT 'text', encrypted_content TEXT DEFAULT '', encrypted_iv TEXT DEFAULT '', server_id INTEGER DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS message_images (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, image_url TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, content TEXT NOT NULL, is_public INTEGER DEFAULT 0, server_id INTEGER DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS post_images (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, image_url TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS user_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE, public_key TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, base_url TEXT UNIQUE NOT NULL, server_token TEXT, status TEXT DEFAULT 'active', disk_cache_limit INTEGER DEFAULT 512, blocked INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_users (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL REFERENCES federation_servers(id), remote_id INTEGER NOT NULL, username TEXT NOT NULL, avatar_url TEXT DEFAULT '', email TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(server_id, remote_id))`,
		`CREATE TABLE IF NOT EXISTS federation_invites (id INTEGER PRIMARY KEY AUTOINCREMENT, created_by INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, max_uses INTEGER DEFAULT 1, use_count INTEGER DEFAULT 0, expires_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_network (server_id INTEGER PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, known_by_server_id INTEGER NOT NULL, first_seen DATETIME DEFAULT CURRENT_TIMESTAMP)`,
	}
	for _, q := range execs {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func setupFiberApp(db *sql.DB, fh *FederationHandler) *fiber.App {
	app := fiber.New()
	fed := app.Group("/api/federation/v1")
	fed.Post("/join", fh.HandleJoinInvite)
	fed.Use(fh.AuthMiddleware)
	fed.Head("/ping", fh.HandlePing)
	fed.Post("/ping", fh.HandlePing)
	fed.Post("/send-message", fh.HandleSendMessage)
	fed.Post("/forward-post", fh.HandleForwardPost)
	fed.Post("/forward-key", fh.HandleForwardKey)
	fed.Get("/get-key/:remoteId", fh.HandleGetKey)
	fed.Get("/get-user/:remoteId", fh.HandleGetUser)
	fed.Post("/share-users", fh.HandleShareUsers)
	fed.Get("/bulk/users", fh.HandleBulkUsers)
	fed.Get("/bulk/messages", fh.HandleBulkMessages)
	fed.Get("/bulk/posts", fh.HandleBulkPosts)
	fed.Post("/introduce", fh.HandleIntroduce)
	fed.Post("/gossip/new-peer", fh.HandleGossipNewPeer)
	fed.Post("/recover-server", fh.HandleRecoverServer)
	return app
}

func withAuthToken(req *http.Request, token string) {
	req.Header.Set("X-Federation-Token", token)
}

func testRequest(t *testing.T, app *fiber.App, method, path, body string, token string) *http.Response {
	t.Helper()
	var reqBody io.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, path, reqBody)
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		withAuthToken(req, token)
	}
	resp, err := app.Test(req, 5000)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func readBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestHandlePing(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', 'https://example.com', 'test-token', 'active')")

	fh := NewFederationHandler(nil, nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "HEAD", "/api/federation/v1/ping", "", "test-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestHandlePing_POST(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'test', 'https://example.com', 'test-token', 'active')")

	fh := NewFederationHandler(nil, nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "POST", "/api/federation/v1/ping", "", "test-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	if result["status"] != "ok" {
		t.Errorf("expected ok, got %s", result["status"])
	}
}

func TestHandlePing_NoAuth(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	fh := NewFederationHandler(nil, nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "GET", "/api/federation/v1/ping", "", "")
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestHandleJoinInvite_Success(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_invites (id, created_by, token, max_uses, use_count) VALUES (1, 1, 'invite-token', 5, 0)")
	db.Exec("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", "local", "l@t.com", "hash")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	body := `{"token":"invite-token","name":"RemoteServer","base_url":"https://remote.example.com","version":"1.0.0","major":1}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/join", body, "")
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	if result["name"] == "" {
		t.Error("expected server name in response")
	}
}

func TestHandleJoinInvite_InvalidToken(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	body := `{"token":"bogus","name":"Remote","base_url":"https://remote.com"}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/join", body, "")
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestHandleJoinInvite_Exhausted(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_invites (id, created_by, token, max_uses, use_count) VALUES (1, 1, 'exhausted', 3, 3)")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	body := `{"token":"exhausted","name":"Remote","base_url":"https://remote.com"}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/join", body, "")
	if resp.StatusCode != 410 {
		t.Errorf("expected 410, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestHandleJoinInvite_MissingFields(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "POST", "/api/federation/v1/join", `{"token":"x"}`, "")
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestHandleSendMessage(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")
	db.Exec("INSERT INTO messages (from_user_id, to_user_id, content, created_at) VALUES (99, 100, 'old', '2025-01-01')")

	called := false
	fh := NewFederationHandler(NewTransport(), nil, nil)
	fh.OnIncomingMessage = func(from, to int64, content, msgType, createdAt string, images []string) {
		called = true
		if from != 1 {
			t.Errorf("expected from=1, got %d", from)
		}
		if content != "hello" {
			t.Errorf("expected content=hello, got %s", content)
		}
	}
	app := setupFiberApp(db, fh)

	body := `{"from_user_id":1,"to_user_id":2,"content":"hello","msg_type":"text","created_at":"2025-01-01T00:00:00Z"}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/send-message", body, "srv-token")
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	if !called {
		t.Error("OnIncomingMessage was not called")
	}

	var count int
	db.QueryRow("SELECT COUNT(*) FROM messages WHERE server_id=1").Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 federated message, got %d", count)
	}
}

func TestHandleSendMessage_WithImages(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	body := `{"from_user_id":1,"to_user_id":2,"content":"with img","msg_type":"image","created_at":"2025-01-01T00:00:00Z","images":["https://example.com/img.jpg"]}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/send-message", body, "srv-token")
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var imgCount int
	db.QueryRow("SELECT COUNT(*) FROM message_images").Scan(&imgCount)
	if imgCount != 1 {
		t.Errorf("expected 1 message image, got %d", imgCount)
	}
}

func TestHandleForwardKey(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	body := `{"user_id":42,"public_key":"abc123key"}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/forward-key", body, "srv-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var pk string
	err := db.QueryRow("SELECT public_key FROM user_keys WHERE user_id=42").Scan(&pk)
	if err != nil {
		t.Fatal("key not saved:", err)
	}
	if pk != "abc123key" {
		t.Errorf("expected abc123key, got %s", pk)
	}
}

func TestHandleGetKey(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")
	db.Exec("INSERT INTO user_keys (user_id, public_key) VALUES (42, 'stored-key')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "GET", "/api/federation/v1/get-key/42", "", "srv-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	if result["public_key"] != "stored-key" {
		t.Errorf("expected stored-key, got %s", result["public_key"])
	}
}

func TestHandleGetKey_NotFound(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "GET", "/api/federation/v1/get-key/999", "", "srv-token")
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestHandleGetUser(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")
	db.Exec("INSERT INTO users (id, username, email, password) VALUES (1, 'testuser', 'test@t.com', 'hash')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "GET", "/api/federation/v1/get-user/1", "", "srv-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	if result["username"] != "testuser" {
		t.Errorf("expected testuser, got %s", result["username"])
	}
}

func TestHandleGetUser_NotFound(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "GET", "/api/federation/v1/get-user/999", "", "srv-token")
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestHandleShareUsers(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")
	db.Exec("INSERT INTO users (id, username, email, password, avatar_url) VALUES (1, 'user1', 'u1@t.com', 'hash', '')")
	db.Exec("INSERT INTO users (id, username, email, password, avatar_url) VALUES (2, 'user2', 'u2@t.com', 'hash', '')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "POST", "/api/federation/v1/share-users", "", "srv-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var users []struct {
		RemoteID int64  `json:"remote_id"`
		Username string `json:"username"`
	}
	json.NewDecoder(resp.Body).Decode(&users)
	if len(users) != 2 {
		t.Errorf("expected 2 users, got %d", len(users))
	}
}

func TestHandleBulkUsers(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")
	db.Exec("INSERT INTO users (id, username, email, password) VALUES (1, 'a', 'a@t.com', 'h')")
	db.Exec("INSERT INTO users (id, username, email, password) VALUES (2, 'b', 'b@t.com', 'h')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "GET", "/api/federation/v1/bulk/users?offset=0&limit=10", "", "srv-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var users []struct {
		RemoteID int64 `json:"remote_id"`
	}
	json.NewDecoder(resp.Body).Decode(&users)
	if len(users) != 2 {
		t.Errorf("expected 2 users, got %d", len(users))
	}
}

func TestHandleBulkMessages(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")
	db.Exec("INSERT INTO messages (from_user_id, to_user_id, content, created_at) VALUES (1, 2, 'hello', '2025-01-01')")
	// Federated message (has server_id) — should NOT appear in bulk
	db.Exec("INSERT INTO messages (from_user_id, to_user_id, content, server_id, created_at) VALUES (3, 4, 'fed', 1, '2025-01-01')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "GET", "/api/federation/v1/bulk/messages?offset=0&limit=10", "", "srv-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var msgs []struct {
		Content string `json:"content"`
	}
	json.NewDecoder(resp.Body).Decode(&msgs)
	if len(msgs) != 1 {
		t.Errorf("expected 1 local message, got %d", len(msgs))
	}
	if len(msgs) > 0 && msgs[0].Content != "hello" {
		t.Errorf("expected 'hello', got %s", msgs[0].Content)
	}
}

func TestHandleBulkPosts(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")
	db.Exec("INSERT INTO posts (user_id, content, is_public, created_at) VALUES (1, 'local post', 1, '2025-01-01')")
	db.Exec("INSERT INTO posts (user_id, content, is_public, server_id, created_at) VALUES (1, 'fed post', 1, 1, '2025-01-01')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "GET", "/api/federation/v1/bulk/posts?offset=0&limit=10", "", "srv-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var posts []struct {
		Content string `json:"content"`
	}
	json.NewDecoder(resp.Body).Decode(&posts)
	if len(posts) != 1 {
		t.Errorf("expected 1 local post, got %d", len(posts))
	}
	if len(posts) > 0 && posts[0].Content != "local post" {
		t.Errorf("expected 'local post', got %s", posts[0].Content)
	}
}

func TestHandleIntroduce(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'local', 'https://local.com', 'my-token', 'active')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	body := `{"server_id":2,"name":"Peer","base_url":"https://peer.com"}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/introduce", body, "my-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var count int
	db.QueryRow("SELECT COUNT(*) FROM federation_network").Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 network entry, got %d", count)
	}
}

func TestHandleRecoverServer(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'recovering', 'https://recover.com', 'old-recovery-token', 'pending')")
	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (2, 'auth', 'https://auth.com', 'auth-token', 'active')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	body := `{"recovery_token":"old-recovery-token"}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/recover-server", body, "auth-token")
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	if result["new_token"] == "" {
		t.Error("expected new_token in response")
	}

	var status string
	db.QueryRow("SELECT status FROM federation_servers WHERE id=1").Scan(&status)
	if status != "active" {
		t.Errorf("expected active, got %s", status)
	}
}

func TestHandleRecoverServer_NoAuth(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	resp := testRequest(t, app, "POST", "/api/federation/v1/recover-server", `{"recovery_token":"x"}`, "")
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestHandleRecoverServer_InvalidToken(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'auth', 'https://auth.com', 'auth-token', 'active')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	body := `{"recovery_token":"bogus"}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/recover-server", body, "auth-token")
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestHandleForwardPost(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")
	db.Exec("INSERT INTO users (id, username, email, password) VALUES (1, 'u', 'u@t.com', 'h')")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	body := `{"user_id":1,"content":"fed post","is_public":true,"created_at":"2025-01-01T00:00:00Z"}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/forward-post", body, "srv-token")
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var count int
	db.QueryRow("SELECT COUNT(*) FROM posts WHERE server_id=1").Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 federated post, got %d", count)
	}
}

func TestHandleForwardPost_WithImageDownload(t *testing.T) {
	db := setupHandlerDB(t)
	defer db.Close()
	database.DB = db

	db.Exec("INSERT INTO federation_servers (id, name, base_url, server_token, status) VALUES (1, 'remote', 'https://remote.com', 'srv-token', 'active')")
	db.Exec("INSERT INTO users (id, username, email, password) VALUES (1, 'u', 'u@t.com', 'h')")

	// Our transport tries to download from the remote URL, but we can mock it via transport
	// For simplicity, just test the local image path is unchanged
	os.MkdirAll("./uploads/posts", 0755)
	defer os.RemoveAll("./uploads/posts")

	fh := NewFederationHandler(NewTransport(), nil, nil)
	app := setupFiberApp(db, fh)

	body := `{"user_id":1,"content":"post with imgs","is_public":true,"created_at":"2025-01-01T00:00:00Z","images":["/uploads/local.jpg"]}`
	resp := testRequest(t, app, "POST", "/api/federation/v1/forward-post", body, "srv-token")
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var imgCount int
	db.QueryRow("SELECT COUNT(*) FROM post_images").Scan(&imgCount)
	if imgCount != 1 {
		t.Errorf("expected 1 post image, got %d", imgCount)
	}
}

// Test unused import silence

