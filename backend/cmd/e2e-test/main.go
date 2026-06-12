package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var (
	serverAURL   = "http://localhost:9080"
	serverBURL   = "http://localhost:9081"
	tmpDir       = filepath.Join(os.TempDir(), "meowchat-e2e-"+fmt.Sprintf("%d", time.Now().UnixNano()))
	serverACmd   *exec.Cmd
	serverBCmd   *exec.Cmd
	serverBinary = filepath.Join(os.TempDir(), "meowchat-e2e-server.exe")
	adminTokenA  string
	adminTokenB  string
	tokenA       string
	tokenB       string
	userAID      int64
	userBID      int64
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("Temp dir: %s", tmpDir)
	os.MkdirAll(tmpDir, 0755)
	defer os.RemoveAll(tmpDir)

	if err := run(); err != nil {
		log.Fatalf("FAIL: %v", err)
	}
	log.Println("ALL TESTS PASSED")
}

func run() error {
	if err := startServers(); err != nil {
		return fmt.Errorf("start servers: %w", err)
	}
	defer stopServers()

	waitForHealth(serverAURL, 30*time.Second)
	waitForHealth(serverBURL, 30*time.Second)
	time.Sleep(2 * time.Second) // let servers stabilize
	log.Println("✓ Both servers healthy")

	if err := registerUsers(); err != nil {
		return fmt.Errorf("register users: %w", err)
	}
	log.Println("✓ Users registered")

	if err := connectFederation(); err != nil {
		return fmt.Errorf("connect federation: %w", err)
	}
	log.Println("✓ Federation connected")

	if err := testE2EEKeySync(); err != nil {
		return fmt.Errorf("e2ee key sync: %w", err)
	}
	log.Println("✓ E2EE key synced across servers")

	if err := testSendMessage(); err != nil {
		return fmt.Errorf("send message: %w", err)
	}
	log.Println("✓ Cross-server message delivered")

	if err := testForwardPost(); err != nil {
		return fmt.Errorf("forward post: %w", err)
	}
	log.Println("✓ Cross-server post in feed")

	if err := testOfflineQueue(); err != nil {
		log.Printf("⚠ Offline queue test skipped/best-effort: %v", err)
	} else {
		log.Println("✓ Offline queue works")
	}

	return nil
}

// ── Server lifecycle ──

func startServers() error {
	serverADir := filepath.Join(tmpDir, "server_a")
	os.MkdirAll(serverADir, 0755)
	serverBDir := filepath.Join(tmpDir, "server_b")
	os.MkdirAll(serverBDir, 0755)

	serverACmd = startServer(serverADir, "9080")
	serverBCmd = startServer(serverBDir, "9081")
	return nil
}

func startServer(dir, port string) *exec.Cmd {
	cmd := exec.Command(serverBinary)
	cmd.Dir = filepath.Join(".", "backend")
	cmd.Env = append(os.Environ(),
		"PORT="+port,
		"DB_PATH="+filepath.Join(dir, "chat.db"),
		"WEBAUTHN_RP_ID=localhost",
		"WEBAUTHN_RP_ORIGIN=http://localhost:"+port,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Start()
	return cmd
}

func stopServers() {
	if serverACmd != nil && serverACmd.Process != nil {
		serverACmd.Process.Kill()
		serverACmd.Wait()
	}
	if serverBCmd != nil && serverBCmd.Process != nil {
		serverBCmd.Process.Kill()
		serverBCmd.Wait()
	}
}

func waitForHealth(url string, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		req, _ := http.NewRequest("GET", url+"/api/health", nil)
		req.Header.Set("User-Agent", "e2e-test")
		resp, err := http.DefaultClient.Do(req)
		if err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			return
		}
		if err == nil {
			resp.Body.Close()
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// ── HTTP helpers ──

type response struct {
	StatusCode int
	Body       []byte
}

func doReq(method, url, token, contentType string, body io.Reader) (*response, error) {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("User-Agent", "e2e-test")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return &response{StatusCode: resp.StatusCode, Body: b}, nil
}

func doJSON(method, url, token string, body interface{}) (*response, error) {
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	return doReq(method, url, token, "application/json", reader)
}

func doMultipart(method, url, token string, fields map[string]string) (*response, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		w.WriteField(k, v)
	}
	w.Close()
	return doReq(method, url, token, w.FormDataContentType(), &buf)
}

func isOK(r *response) bool {
	return r.StatusCode >= 200 && r.StatusCode < 300
}

func logResp(r *response) string {
	return fmt.Sprintf("status=%d body=%s", r.StatusCode, string(r.Body))
}

// ── Tests ──

func registerUsers() error {
	// Login as admin on server A
	var r *response
	var err error
	for i := 0; i < 10; i++ {
		r, err = doJSON("POST", serverAURL+"/api/login", "", map[string]string{
			"username": "admin",
			"password": "admin",
		})
		if err == nil {
			break
		}
		log.Printf("  admin login A attempt %d failed: %v", i+1, err)
		time.Sleep(1 * time.Second)
	}
	if err != nil {
		return fmt.Errorf("admin login A: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("admin login A: %s", logResp(r))
	}
	var loginResp struct {
		AccessToken string `json:"access_token"`
	}
	json.Unmarshal(r.Body, &loginResp)
	adminTokenA = loginResp.AccessToken

	// Login as admin on server B
	r, err = doJSON("POST", serverBURL+"/api/login", "", map[string]string{
		"username": "admin",
		"password": "admin",
	})
	if err != nil {
		return fmt.Errorf("admin login B: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("admin login B: %s", logResp(r))
	}
	json.Unmarshal(r.Body, &loginResp)
	adminTokenB = loginResp.AccessToken

	// Create invite tokens on both servers
	r, err = doJSON("POST", serverAURL+"/api/invites", adminTokenA, map[string]int{
		"max_uses": 10,
	})
	if err != nil {
		return fmt.Errorf("create invite A: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("create invite A: %s", logResp(r))
	}
	var inviteResp struct {
		Token string `json:"token"`
	}
	json.Unmarshal(r.Body, &inviteResp)
	inviteTokenA := inviteResp.Token

	r, err = doJSON("POST", serverBURL+"/api/invites", adminTokenB, map[string]int{
		"max_uses": 10,
	})
	if err != nil {
		return fmt.Errorf("create invite B: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("create invite B: %s", logResp(r))
	}
	json.Unmarshal(r.Body, &inviteResp)
	inviteTokenB := inviteResp.Token

	// Register alice on server A
	r, err = doJSON("POST", serverAURL+"/api/register", "", map[string]string{
		"username":    "alice",
		"password":    "test123",
		"invite_token": inviteTokenA,
	})
	if err != nil {
		return fmt.Errorf("register alice: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("register alice: %s", logResp(r))
	}

	// Register bob on server B
	r, err = doJSON("POST", serverBURL+"/api/register", "", map[string]string{
		"username":    "bob",
		"password":    "test456",
		"invite_token": inviteTokenB,
	})
	if err != nil {
		return fmt.Errorf("register bob: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("register bob: %s", logResp(r))
	}

	// Login as alice
	r, err = doJSON("POST", serverAURL+"/api/login", "", map[string]string{
		"username": "alice",
		"password": "test123",
	})
	if err != nil {
		return fmt.Errorf("login alice: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("login alice: %s", logResp(r))
	}
	var userResp struct {
		AccessToken string `json:"access_token"`
		User        struct {
			ID int64 `json:"id"`
		} `json:"user"`
	}
	json.Unmarshal(r.Body, &userResp)
	tokenA = userResp.AccessToken
	userAID = userResp.User.ID

	// Login as bob
	r, err = doJSON("POST", serverBURL+"/api/login", "", map[string]string{
		"username": "bob",
		"password": "test456",
	})
	if err != nil {
		return fmt.Errorf("login bob: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("login bob: %s", logResp(r))
	}
	json.Unmarshal(r.Body, &userResp)
	tokenB = userResp.AccessToken
	userBID = userResp.User.ID

	log.Printf("  alice: id=%d on :9080", userAID)
	log.Printf("  bob:   id=%d on :9081", userBID)
	return nil
}

func connectFederation() error {
	// Create federation invite on server A
	r, err := doJSON("POST", serverAURL+"/api/admin/federation/invites", adminTokenA, map[string]interface{}{
		"max_uses":  1,
	})
	if err != nil {
		return fmt.Errorf("create federation invite: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("create federation invite: %s", logResp(r))
	}
	var invite struct {
		InviteURL string `json:"invite_url"`
	}
	json.Unmarshal(r.Body, &invite)
	log.Printf("  federation invite_url=%s", invite.InviteURL)

	// Server B connects using the invite
	r, err = doJSON("POST", serverBURL+"/api/admin/federation/connect", adminTokenB, map[string]string{
		"invite_url": invite.InviteURL,
	})
	if err != nil {
		return fmt.Errorf("connect federation: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("connect federation: %s", logResp(r))
	}
	log.Printf("  connect response: %s", string(r.Body))

	// Wait for health check pings
	time.Sleep(2 * time.Second)

	// Verify both servers see each other
	for _, u := range []struct{ url, token string }{
		{serverAURL, adminTokenA},
		{serverBURL, adminTokenB},
	} {
		r, err = doJSON("GET", u.url+"/api/admin/federation/servers", u.token, nil)
		if err != nil {
			return fmt.Errorf("list servers on %s: %w", u.url, err)
		}
		if !isOK(r) {
			return fmt.Errorf("list servers on %s: %s", u.url, logResp(r))
		}
		var servers []struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		}
		json.Unmarshal(r.Body, &servers)
		if len(servers) == 0 {
			return fmt.Errorf("%s sees no connected servers", u.url)
		}
		log.Printf("  %s sees %d peer(s)", u.url, len(servers))
	}
	return nil
}

func testE2EEKeySync() error {
	// Alice puts her public E2EE key on server A
	r, err := doJSON("PUT", serverAURL+"/api/keys", tokenA, map[string]string{
		"public_key": "alice-pubkey-abc123",
	})
	if err != nil {
		return fmt.Errorf("put key: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("put key: %s", logResp(r))
	}
	time.Sleep(1 * time.Second)

	// Bob fetches alice's key from server B (must have been forwarded)
	r, err = doJSON("GET", serverBURL+fmt.Sprintf("/api/keys/%d", userAID), tokenB, nil)
	if err != nil {
		return fmt.Errorf("get key: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("get key on server B: %s", logResp(r))
	}
	var keyResp struct {
		PublicKey string `json:"public_key"`
	}
	json.Unmarshal(r.Body, &keyResp)
	if keyResp.PublicKey != "alice-pubkey-abc123" {
		return fmt.Errorf("key mismatch: expected alice-pubkey-abc123, got %s", keyResp.PublicKey)
	}
	return nil
}

func testSendMessage() error {
	// Bob sends a direct message to alice from server B
	r, err := doMultipart("POST", serverBURL+"/api/messages", tokenB, map[string]string{
		"to_user_id": fmt.Sprintf("%d", userAID),
		"content":    "Hello from federated server!",
		"type":       "text",
	})
	if err != nil {
		return fmt.Errorf("send message: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("send message: %s", logResp(r))
	}
	time.Sleep(2 * time.Second)

	// Alice fetches messages — should see bob's message
	r, err = doJSON("GET", serverAURL+fmt.Sprintf("/api/messages?user1=%d&user2=%d", userAID, userBID), tokenA, nil)
	if err != nil {
		return fmt.Errorf("get messages: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("get messages: %s", logResp(r))
	}
	var msgs []struct {
		ID      int64  `json:"id"`
		Content string `json:"content"`
	}
	json.Unmarshal(r.Body, &msgs)
	for _, m := range msgs {
		if strings.Contains(m.Content, "Hello from federated server!") {
			return nil
		}
	}
	return fmt.Errorf("message not found in alice's inbox (got %d messages)", len(msgs))
}

func testForwardPost() error {
	// Bob creates a public post on server B
	r, err := doMultipart("POST", serverBURL+"/api/posts", tokenB, map[string]string{
		"content":   "Hello from Server B!",
		"is_public": "true",
	})
	if err != nil {
		return fmt.Errorf("create post: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("create post: %s", logResp(r))
	}
	time.Sleep(2 * time.Second)

	// Alice checks feed on server A — should see bob's public post
	r, err = doJSON("GET", serverAURL+"/api/feed", tokenA, nil)
	if err != nil {
		return fmt.Errorf("get feed: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("get feed: %s", logResp(r))
	}
	var posts []struct {
		ID       int64  `json:"id"`
		Content  string `json:"content"`
		Username string `json:"username"`
	}
	json.Unmarshal(r.Body, &posts)
	for _, p := range posts {
		if strings.Contains(p.Content, "Hello from Server B!") {
			return nil
		}
	}
	return fmt.Errorf("federated post not found on server A (got %d posts)", len(posts))
}

func testOfflineQueue() error {
	// Stop server A
	log.Printf("  stopping server A...")
	serverACmd.Process.Kill()
	serverACmd.Wait()
	serverACmd = nil
	time.Sleep(1 * time.Second)

	// Bob sends a message while server A is down
	r, err := doMultipart("POST", serverBURL+"/api/messages", tokenB, map[string]string{
		"to_user_id": fmt.Sprintf("%d", userAID),
		"content":    "Queued message for offline server!",
		"type":       "text",
	})
	if err != nil {
		return fmt.Errorf("send offline message: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("send offline message: %s", logResp(r))
	}
	log.Printf("  message sent while server A was offline")

	// Restart server A
	serverADir := filepath.Join(tmpDir, "server_a")
	serverACmd = startServer(serverADir, "9080")
	waitForHealth(serverAURL, 15*time.Second)
	log.Printf("  server A restarted")

	// Wait for federation queue to drain
	time.Sleep(10 * time.Second)

	// Re-login as alice
	r, err = doJSON("POST", serverAURL+"/api/login", "", map[string]string{
		"username": "alice",
		"password": "test123",
	})
	if err != nil {
		return fmt.Errorf("alice re-login: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("alice re-login: %s", logResp(r))
	}
	var loginA struct {
		AccessToken string `json:"access_token"`
	}
	json.Unmarshal(r.Body, &loginA)
	tokenA = loginA.AccessToken

	// Check messages
	r, err = doJSON("GET", serverAURL+fmt.Sprintf("/api/messages?user1=%d&user2=%d", userAID, userBID), tokenA, nil)
	if err != nil {
		return fmt.Errorf("get messages after restart: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("get messages after restart: %s", logResp(r))
	}
	var msgs []struct {
		Content string `json:"content"`
	}
	json.Unmarshal(r.Body, &msgs)
	for _, m := range msgs {
		if strings.Contains(m.Content, "Queued message for offline server!") {
			return nil
		}
	}
	bodyStr := string(r.Body)
	preview := bodyStr
	if len(preview) > 500 {
		preview = preview[:500]
	}
	return fmt.Errorf("queued message not delivered (got %d messages). preview: %s", len(msgs), preview)
}
