package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"my-chat-backend/auth"
	"my-chat-backend/database"

	_ "github.com/mattn/go-sqlite3"

	fiberws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	fastws "github.com/fasthttp/websocket"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func setupWSDB(t *testing.T) (*sql.DB, int64) {
	t.Helper()

	// Let previous test's goroutines settle
	time.Sleep(50 * time.Millisecond)

	os.MkdirAll("./uploads/messages", 0755)

	f, err := os.CreateTemp("", "chat-ws-test-*.db")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	dbPath := f.Name()

	db, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	database.DB = db
	t.Cleanup(func() { db.Close(); os.Remove(dbPath) })

	migrations := []string{
		`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, avatar_url TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, is_banned INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, from_user_id INTEGER NOT NULL, to_user_id INTEGER NOT NULL, content TEXT NOT NULL, msg_type TEXT DEFAULT 'text', encrypted_content TEXT DEFAULT '', encrypted_iv TEXT DEFAULT '', server_id INTEGER DEFAULT NULL, sticker_url TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (from_user_id) REFERENCES users(id), FOREIGN KEY (to_user_id) REFERENCES users(id))`,
		`CREATE TABLE IF NOT EXISTS message_images (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, image_url TEXT NOT NULL, FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE)`,
		`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, content TEXT NOT NULL, is_public INTEGER DEFAULT 0, server_id INTEGER DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
		`CREATE TABLE IF NOT EXISTS refresh_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_id TEXT UNIQUE NOT NULL, expires_at DATETIME NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS friends (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, server_id INTEGER DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (friend_id) REFERENCES users(id), UNIQUE(user_id, friend_id))`,
		`CREATE TABLE IF NOT EXISTS push_copies (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, for_user_id INTEGER NOT NULL, server_encrypted_content TEXT NOT NULL, expires_at DATETIME NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
	}
	for _, q := range migrations {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("migration: %v", err)
		}
	}

	seed := func(username, email string, isAdmin bool) int64 {
		hash, err := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.DefaultCost)
		if err != nil {
			t.Fatal(err)
		}
		adminVal := 0
		if isAdmin {
			adminVal = 1
		}
		res, err := db.Exec("INSERT INTO users (username, email, password, is_admin) VALUES (?, ?, ?, ?)",
			username, email, string(hash), adminVal)
		if err != nil {
			t.Fatalf("seed %s: %v", username, err)
		}
		id, _ := res.LastInsertId()
		return id
	}

	a := seed("admin", "admin@ws.test", true)
	uid := seed("wsuser", "wsuser@test.com", false)
	o := seed("other", "other@test.com", false)

	// Make all users friends of each other for WS tests
	for _, pair := range [][2]int64{{a, uid}, {a, o}, {uid, o}} {
		database.DB.Exec("INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)", pair[0], pair[1])
	}

	if database.ServerEncryptionKey == nil {
		database.ServerEncryptionKey = []byte("test-server-key-1234567890abcdef")
	}

	return db, uid
}

func setupWSTest(t *testing.T) (*Handler, int64, string) {
	t.Helper()

	_, userID := setupWSDB(t)

	app := fiber.New()
	h := NewHandler()
	app.Get("/ws", func(c *fiber.Ctx) error {
		token := c.Query("token")
		if token == "" {
			return c.Status(401).JSON(fiber.Map{"error": "Missing token"})
		}
		claims, err := auth.ValidateAccessToken(token)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
		}
		c.Locals("userId", claims.UserID)
		return c.Next()
	}, fiberws.New(func(c *fiberws.Conn) {
		h.HandleWebSocket(c)
	}))

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	go app.Listener(listener)
	t.Cleanup(func() {
		h.Close()
		app.Shutdown()
		listener.Close()
	})

	return h, userID, fmt.Sprintf("ws://127.0.0.1:%d", port)
}

func wsDial(t *testing.T, baseURL string, userID int64, isAdmin bool) *fastws.Conn {
	t.Helper()
	token, err := auth.GenerateAccessToken(userID, isAdmin)
	if err != nil {
		t.Fatal(err)
	}
	c, _, err := fastws.DefaultDialer.Dial(baseURL+"/ws?token="+token, nil)
	if err != nil {
		t.Fatal(err)
	}
	c.SetReadDeadline(time.Now().Add(10 * time.Second))
	t.Cleanup(func() { c.Close() })

	return c
}

// wsDialDrain connects AND drains the initial user_online message.
// Use only for the FIRST connection of a user (guaranteed to receive user_online).
func wsDialDrain(t *testing.T, baseURL string, userID int64, isAdmin bool) *fastws.Conn {
	t.Helper()
	c := wsDial(t, baseURL, userID, isAdmin)
	_, _, _ = c.ReadMessage()
	return c
}

func wsWrite(t *testing.T, c *fastws.Conn, msg map[string]interface{}) {
	t.Helper()
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	if err := c.WriteMessage(fastws.TextMessage, data); err != nil {
		t.Fatal(err)
	}
}

func wsRead(t *testing.T, c *fastws.Conn) map[string]interface{} {
	t.Helper()
	_, msg, err := c.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]interface{}
	if err := json.Unmarshal(msg, &data); err != nil {
		t.Fatal(err)
	}
	return data
}

func wsReadTimeout(t *testing.T, c *fastws.Conn, timeout time.Duration) (map[string]interface{}, error) {
	c.SetReadDeadline(time.Now().Add(timeout))
	_, msg, err := c.ReadMessage()
	if err != nil {
		return nil, err
	}
	var data map[string]interface{}
	if err := json.Unmarshal(msg, &data); err != nil {
		return nil, err
	}
	return data, nil
}

func wsDrain(t *testing.T, c *fastws.Conn) {
	t.Helper()
	for {
		c.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
		_, _, err := c.ReadMessage()
		if err != nil {
			break
		}
	}
	c.SetReadDeadline(time.Now().Add(10 * time.Second))
}

func expiredTestToken(userID int64) string {
	claims := jwt.MapClaims{
		"user_id": float64(userID),
		"type":    "access",
		"exp":     time.Now().Add(-1 * time.Hour).Unix(),
		"iat":     time.Now().Add(-2 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte("test-secret-for-testing"))
	return s
}

func mustAccessToken(t *testing.T, userID int64, isAdmin bool) string {
	t.Helper()
	token, err := auth.GenerateAccessToken(userID, isAdmin)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

// T1: WS handshake with valid/invalid/expired JWT
func TestWS_Handshake_JWT(t *testing.T) {
	_, _, baseURL := setupWSTest(t)

	t.Run("valid token", func(t *testing.T) {
		token, err := auth.GenerateAccessToken(1, false)
		if err != nil {
			t.Fatal(err)
		}
		c, _, err := fastws.DefaultDialer.Dial(baseURL+"/ws?token="+token, nil)
		if err != nil {
			t.Fatalf("expected handshake to succeed: %v", err)
		}
		c.Close()
	})

	t.Run("missing token", func(t *testing.T) {
		_, _, err := fastws.DefaultDialer.Dial(baseURL+"/ws", nil)
		if err == nil {
			t.Fatal("expected handshake to fail without token")
		}
	})

	t.Run("invalid token", func(t *testing.T) {
		_, _, err := fastws.DefaultDialer.Dial(baseURL+"/ws?token=invalid", nil)
		if err == nil {
			t.Fatal("expected handshake to fail with invalid token")
		}
	})

	t.Run("expired token", func(t *testing.T) {
		token := expiredTestToken(1)
		_, _, err := fastws.DefaultDialer.Dial(baseURL+"/ws?token="+token, nil)
		if err == nil {
			t.Fatal("expected handshake to fail with expired token")
		}
	})
}

// T2: Send message through WS -> verify messages table
func TestWS_SendMessage(t *testing.T) {
	_, userID, baseURL := setupWSTest(t)

	conn := wsDialDrain(t, baseURL, userID, false)

	msg := map[string]interface{}{"to": 2, "content": "Hello via WS!"}
	wsWrite(t, conn, msg)

	echo := wsRead(t, conn)
	if echo["type"] != "message" {
		t.Fatalf("expected type 'message', got %v", echo["type"])
	}
	if echo["content"] != "Hello via WS!" {
		t.Fatalf("expected content 'Hello via WS!', got %v", echo["content"])
	}
	msgID, ok := echo["id"].(float64)
	if !ok || msgID == 0 {
		t.Fatal("expected non-zero message id in echo")
	}

	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM messages WHERE id = ?", int64(msgID)).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 message in DB, got %d", count)
	}

	var content string
	database.DB.QueryRow("SELECT content FROM messages WHERE id = ?", int64(msgID)).Scan(&content)
	if content != "Hello via WS!" {
		t.Errorf("expected content 'Hello via WS!', got %s", content)
	}
}

// T2b: Send message with encrypted fields through WS
func TestWS_SendMessage_Encrypted(t *testing.T) {
	_, userID, baseURL := setupWSTest(t)

	conn := wsDialDrain(t, baseURL, userID, false)

	msg := map[string]interface{}{
		"to":                2,
		"content":           "encrypted hello",
		"msg_type":          "text",
		"encrypted_content": "base64encrypted",
		"encrypted_iv":      "base64iv",
	}
	wsWrite(t, conn, msg)

	echo := wsRead(t, conn)
	if echo["encrypted_content"] != "base64encrypted" {
		t.Fatal("expected encrypted_content in echo")
	}
	if echo["encrypted_iv"] != "base64iv" {
		t.Fatal("expected encrypted_iv in echo")
	}
}

// T3: Ping/pong - connection stays alive through ping cycles
func TestWS_PingPong_Alive(t *testing.T) {
	_, userID, baseURL := setupWSTest(t)

	conn := wsDialDrain(t, baseURL, userID, false)

	msg1 := map[string]interface{}{"to": 2, "content": "msg1"}
	wsWrite(t, conn, msg1)
	wsRead(t, conn)

	time.Sleep(3 * time.Second)

	msg2 := map[string]interface{}{"to": 2, "content": "msg2"}
	wsWrite(t, conn, msg2)
	echo := wsRead(t, conn)
	if echo["content"] != "msg2" {
		t.Fatalf("expected 'msg2', got %v", echo["content"])
	}
}

// T4: Grace period - reconnect within 30s keeps user online
func TestWS_GracePeriod_Reconnect(t *testing.T) {
	h, userID, baseURL := setupWSTest(t)

	conn1 := wsDialDrain(t, baseURL, userID, false)

	if !h.onlineUsers[userID] {
		t.Fatal("expected user to be online after connect")
	}

	conn1.Close()
	time.Sleep(100 * time.Millisecond)

	conn2 := wsDial(t, baseURL, userID, false) // same user reconnecting, no user_online
	_ = conn2

	if !h.onlineUsers[userID] {
		t.Fatal("expected user to stay online after reconnect within grace period")
	}
}

// T5: Push copies created when recipient is offline
func TestWS_PushCopy_Offline(t *testing.T) {
	_, userID, baseURL := setupWSTest(t)
	_ = userID

	conn := wsDialDrain(t, baseURL, 1, false)

	msg := map[string]interface{}{"to": 3, "content": "offline msg"}
	wsWrite(t, conn, msg)

	echo := wsRead(t, conn)
	msgID := int64(echo["id"].(float64))

	time.Sleep(200 * time.Millisecond)

	var copyCount int
	database.DB.QueryRow("SELECT COUNT(*) FROM push_copies WHERE message_id = ?", msgID).Scan(&copyCount)
	if copyCount != 1 {
		t.Errorf("expected 1 push_copy for offline recipient, got %d", copyCount)
	}
}

// T5b: No push copy when recipient is online and receives delivery
func TestWS_PushCopy_NoCopyWhenOnline(t *testing.T) {
	_, userID, baseURL := setupWSTest(t)
	_ = userID

	sender := wsDialDrain(t, baseURL, 1, false)
	recipient := wsDialDrain(t, baseURL, 3, false)

	// Drain user_online broadcast that recipient's registration sent to sender
	sender.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	_, _, _ = sender.ReadMessage()
	sender.SetReadDeadline(time.Now().Add(10 * time.Second))

	msg := map[string]interface{}{"to": 3, "content": "online delivery test"}
	wsWrite(t, sender, msg)

	echo := wsRead(t, sender)
	msgID, ok := echo["id"].(float64)
	if !ok {
		t.Fatalf("echo has no id, got: %+v", echo)
	}

	delivered := wsRead(t, recipient)
	if delivered["type"] != "message" {
		t.Fatalf("expected 'message' type for recipient, got %v", delivered["type"])
	}

	time.Sleep(200 * time.Millisecond)

	var copyCount int
	database.DB.QueryRow("SELECT COUNT(*) FROM push_copies WHERE message_id = ?", msgID).Scan(&copyCount)
	if copyCount != 0 {
		t.Errorf("expected 0 push_copies when recipient is online, got %d", copyCount)
	}
}

// T6: Multi-tab - two connections for same user both receive echo
func TestWS_MultiTab_Echo(t *testing.T) {
	_, userID, baseURL := setupWSTest(t)
	_ = userID

	tabA := wsDialDrain(t, baseURL, 1, false)
	tabB := wsDial(t, baseURL, 1, false) // same user, no user_online broadcast

	msg := map[string]interface{}{"to": 2, "content": "multi-tab test"}
	wsWrite(t, tabA, msg)

	// Tab A gets echo
	echoA := wsRead(t, tabA)
	if echoA["content"] != "multi-tab test" {
		t.Fatalf("tab A expected 'multi-tab test', got %v", echoA["content"])
	}

	// Tab B gets echo
	echoB := wsRead(t, tabB)
	if echoB["content"] != "multi-tab test" {
		t.Fatalf("tab B expected 'multi-tab test', got %v", echoB["content"])
	}
	if echoA["id"] != echoB["id"] {
		t.Fatal("both tabs should receive the same message id")
	}
}

// T9: Multi-tab - no duplicate messages per connection
func TestWS_MultiTab_NoDuplicate(t *testing.T) {
	_, userID, baseURL := setupWSTest(t)
	_ = userID

	tabA := wsDialDrain(t, baseURL, 1, false)

	msg := map[string]interface{}{"to": 2, "content": "dedup test"}
	wsWrite(t, tabA, msg)

	echo := wsRead(t, tabA)
	if echo["content"] != "dedup test" {
		t.Fatalf("expected 'dedup test', got %v", echo["content"])
	}

	_, err := wsReadTimeout(t, tabA, 2*time.Second)
	if err == nil {
		t.Fatal("expected no duplicate message")
	}
}

// T12: Mass disconnect - grace period still works
func TestWS_MassDisconnect_GracePeriod(t *testing.T) {
	h, userID, baseURL := setupWSTest(t)
	const numConns = 10

	var conns []*fastws.Conn
	for i := 0; i < numConns; i++ {
		if i == 0 {
			conns = append(conns, wsDialDrain(t, baseURL, userID, false))
		} else {
			conns = append(conns, wsDial(t, baseURL, userID, false))
		}
	}

	if !h.onlineUsers[userID] {
		t.Fatal("expected user to be online")
	}

	var wg sync.WaitGroup
	for _, c := range conns {
		wg.Add(1)
		go func(conn *fastws.Conn) {
			defer wg.Done()
			conn.Close()
		}(c)
	}
	wg.Wait()

	time.Sleep(200 * time.Millisecond)

	if !h.onlineUsers[userID] {
		t.Fatal("expected user to stay online during grace period after mass disconnect")
	}
}

// T10: 100 concurrent connections - no panic
func TestWS_100ConcurrentConnections(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping load test in short mode")
	}
	_, _, baseURL := setupWSTest(t)

	const numConns = 100
	var conns []*fastws.Conn
	for i := 0; i < numConns; i++ {
		c, _, err := fastws.DefaultDialer.Dial(baseURL+"/ws?token="+mustAccessToken(t, 1, false), nil)
		if err != nil {
			t.Fatalf("connection %d failed: %v", i, err)
		}
		conns = append(conns, c)
	}

	if len(conns) != numConns {
		t.Fatalf("expected %d connections, got %d", numConns, len(conns))
	}

	for _, c := range conns {
		c.Close()
	}
}

// S9: Friendship check - non-friend message is rejected
func TestWS_Friendship_Required(t *testing.T) {
	_, _, baseURL := setupWSTest(t)

	// Create user 4 (not friends with anyone)
	hash, err := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.DB.Exec("INSERT INTO users (id, username, email, password) VALUES (4, 'stranger', 'stranger@test.com', ?)", string(hash))
	if err != nil {
		t.Fatal(err)
	}

	token, err := auth.GenerateAccessToken(4, false)
	if err != nil {
		t.Fatal(err)
	}
	conn, _, err := fastws.DefaultDialer.Dial(baseURL+"/ws?token="+token, nil)
	if err != nil {
		t.Fatal(err)
	}
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	t.Cleanup(func() { conn.Close() })
	// Drain user_online for user 4
	_, _, _ = conn.ReadMessage()

	// user 4 (not friends with anyone) tries to send to user 1
	msg := map[string]interface{}{"to": 1, "content": "hello from stranger"}
	wsWrite(t, conn, msg)

	resp := wsRead(t, conn)
	if resp["type"] != "error" || resp["message"] != "not friends" {
		t.Fatalf("expected 'not friends' error, got: %+v", resp)
	}
}

// S7: Rate limiting - sending 10 messages/sec stays within limit
func TestWS_RateLimit_Allowed(t *testing.T) {
	_, userID, baseURL := setupWSTest(t)

	conn := wsDialDrain(t, baseURL, userID, false)

	// Send 10 messages spaced >100ms apart (well within 1/sec avg)
	for i := 0; i < 10; i++ {
		msg := map[string]interface{}{"to": 2, "content": fmt.Sprintf("msg %d", i)}
		wsWrite(t, conn, msg)
		time.Sleep(150 * time.Millisecond)
	}

	// All 10 should get an echo — connection remains open
	for i := 0; i < 10; i++ {
		echo := wsRead(t, conn)
		if echo["type"] != "message" {
			t.Fatalf("expected 'message' type, got %v at idx %d", echo["type"], i)
		}
	}

	// Connection should still be usable
	wsWrite(t, conn, map[string]interface{}{"to": 2, "content": "after rate limit"})
	echo := wsRead(t, conn)
	if echo["content"] != "after rate limit" {
		t.Fatalf("expected 'after rate limit', got %v", echo["content"])
	}
}

// S7: Rate limiting - sending >10 messages/sec closes the connection
func TestWS_RateLimit_Exceeded(t *testing.T) {
	_, userID, baseURL := setupWSTest(t)

	conn := wsDialDrain(t, baseURL, userID, false)

	// Send 11 messages as fast as possible (>10/sec)
	for i := 0; i < 11; i++ {
		msg := map[string]interface{}{"to": 2, "content": fmt.Sprintf("msg %d", i)}
		wsWrite(t, conn, msg)
	}

	time.Sleep(500 * time.Millisecond)

	// Drain any echo messages that were broadcast before the limit kicked in
	for {
		conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}

	// Now the connection should be closed — any read should return an error
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err := conn.ReadMessage()
	if err == nil {
		t.Fatal("expected connection to be closed after rate limit exceeded")
	}
}

// HTTP-level 401 when accessing WS endpoint without proper upgrade
func TestWS_HTTP401_NoToken(t *testing.T) {
	_, _, baseURL := setupWSTest(t)

	httpURL := "http://" + baseURL[len("ws://"):]
	resp, err := http.Get(httpURL + "/ws")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 401 {
		t.Errorf("expected 401 for WS without token, got %d", resp.StatusCode)
	}
}
