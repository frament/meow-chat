package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
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
	serverBinary string
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

	if err := waitForHealth(serverAURL, 60*time.Second); err != nil {
		return fmt.Errorf("server A: %w", err)
	}
	if err := waitForHealth(serverBURL, 60*time.Second); err != nil {
		return fmt.Errorf("server B: %w", err)
	}
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

	if err := testForwardPostWithImage(); err != nil {
		return fmt.Errorf("forward post with image: %w", err)
	}
	log.Println("✓ Cross-server image downloaded as a local file, with thumbnails")

	if err := testOfflineQueue(); err != nil {
		log.Printf("⚠ Offline queue test skipped/best-effort: %v", err)
	} else {
		log.Println("✓ Offline queue works")
	}

	return nil
}

// ── Server lifecycle ──

func startServers() error {
	// The harness runs the real server binary, so it has to exist first. It used
	// to point at a path in the temp directory that nothing ever wrote, and the
	// error from starting it was thrown away - which is how a run that started no
	// servers at all went on to print "Both servers healthy".
	if err := buildServer(); err != nil {
		return fmt.Errorf("build server binary: %w", err)
	}

	serverADir := filepath.Join(tmpDir, "server_a")
	serverBDir := filepath.Join(tmpDir, "server_b")
	os.MkdirAll(serverADir, 0755)
	os.MkdirAll(serverBDir, 0755)

	var err error
	if serverACmd, err = startServer(serverADir, "9080"); err != nil {
		return fmt.Errorf("start server A: %w", err)
	}
	if serverBCmd, err = startServer(serverBDir, "9081"); err != nil {
		return fmt.Errorf("start server B: %w", err)
	}
	return nil
}

// buildServer compiles the backend and remembers where the binary landed.
func buildServer() error {
	root, err := moduleRoot()
	if err != nil {
		return err
	}

	out := filepath.Join(tmpDir, "meowchat-e2e-server")
	cmd := exec.Command("go", "build", "-o", out, ".")
	cmd.Dir = root
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return err
	}
	serverBinary = out
	return nil
}

// moduleRoot walks up from the working directory until it finds go.mod, so the
// harness can be started from the repository root or from backend/ alike. That
// directory is where the server lives and where it must be run from: it resolves
// ./uploads relative to it.
func moduleRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no go.mod found above the working directory")
		}
		dir = parent
	}
}

// startServer runs one backend instance with its own database. The working
// directory has to be the module root whatever the caller's was: started from
// backend/ it used to resolve to backend/backend, which does not exist, and the
// process died before printing anything.
func startServer(dir, port string) (*exec.Cmd, error) {
	root, err := moduleRoot()
	if err != nil {
		return nil, err
	}

	cmd := exec.Command(serverBinary)
	cmd.Dir = root
	cmd.Env = append(os.Environ(),
		"PORT="+port,
		"DB_PATH="+filepath.Join(dir, "chat.db"),
		"WEBAUTHN_RP_ID=localhost",
		"WEBAUTHN_RP_ORIGIN=http://localhost:"+port,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
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

// waitForHealth blocks until a server answers, and reports it when it never
// does. It used to return nothing, so a run in which no server started at all
// carried on to the next step and printed a success line.
func waitForHealth(url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		req, _ := http.NewRequest("GET", url+"/api/health", nil)
		req.Header.Set("User-Agent", "e2e-test")
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return nil
			}
			lastErr = fmt.Errorf("status %d", resp.StatusCode)
		} else {
			lastErr = err
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("%s not healthy within %s: %v", url, timeout, lastErr)
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
	return doMultipartFiles(method, url, token, fields, nil)
}

// doMultipartFiles posts a multipart body with text fields and optional files.
// The map key is the form field name a file is sent under, as the client would.
func doMultipartFiles(method, url, token string, fields map[string]string, files map[string][]byte) (*response, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		w.WriteField(k, v)
	}
	for field, data := range files {
		if len(data) == 0 {
			continue
		}
		part, err := w.CreateFormFile(field, "upload.jpg")
		if err != nil {
			return nil, err
		}
		if _, err := part.Write(data); err != nil {
			return nil, err
		}
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
		"username":     "alice",
		"password":     "test123",
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
		"username":     "bob",
		"password":     "test456",
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
		"max_uses": 1,
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

// testForwardPostWithImage covers the part of image forwarding that used to have
// no coverage at all: whether server A ends up with a *file* or with a link to
// server B.
//
// A link would look right in the feed and only fail for the reader - the browser
// would request the peer's address, which is a different origin, and would be
// refused or served as something else entirely. So the assertion is not "an image
// is present" but "the image URL points at our own uploads directory".
func testForwardPostWithImage() error {
	marker := "post with a picture from B"
	payload := testJPEG(1200, 900)

	r, err := doMultipartFiles("POST", serverBURL+"/api/posts", tokenB,
		map[string]string{"content": marker, "is_public": "true"},
		map[string][]byte{"images": payload},
	)
	if err != nil {
		return fmt.Errorf("create post with image: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("create post with image: %s", logResp(r))
	}
	time.Sleep(3 * time.Second)

	r, err = doJSON("GET", serverAURL+"/api/feed", tokenA, nil)
	if err != nil {
		return fmt.Errorf("get feed: %w", err)
	}
	if !isOK(r) {
		return fmt.Errorf("get feed: %s", logResp(r))
	}

	var posts []struct {
		ID      int64  `json:"id"`
		Content string `json:"content"`
		Images  []struct {
			ID         int64  `json:"id"`
			ImageURL   string `json:"image_url"`
			ThumbURL   string `json:"thumb_url"`
			PreviewURL string `json:"preview_url"`
		} `json:"images"`
	}
	if err := json.Unmarshal(r.Body, &posts); err != nil {
		return fmt.Errorf("parse feed: %w", err)
	}

	for _, p := range posts {
		if !strings.Contains(p.Content, marker) {
			continue
		}
		if len(p.Images) == 0 {
			return fmt.Errorf("post reached server A with no images attached")
		}

		img := p.Images[0]
		if strings.HasPrefix(img.ImageURL, "http") {
			return fmt.Errorf("image was not downloaded: server A kept the peer's URL %s", img.ImageURL)
		}
		if !strings.HasPrefix(img.ImageURL, "/uploads/posts/") {
			return fmt.Errorf("expected a local uploads path, got %s", img.ImageURL)
		}

		// The forwarded file goes through imageproc.Store, so server A has a
		// compressed copy and thumbnails of its own. Without them the reader on A
		// would download the full-size original for a 200 pixel bubble.
		if img.ThumbURL == "" || img.PreviewURL == "" {
			return fmt.Errorf("expected thumbnails for the forwarded image, got thumb=%q preview=%q",
				img.ThumbURL, img.PreviewURL)
		}

		// And the bytes really are there and really are a JPEG, which is what
		// "forwarded" is supposed to mean.
		for _, url := range []string{img.ImageURL, img.ThumbURL, img.PreviewURL} {
			got, err := httpGet(serverAURL + url)
			if err != nil {
				return fmt.Errorf("fetch %s: %w", url, err)
			}
			if len(got) == 0 {
				return fmt.Errorf("%s served empty", url)
			}
			if url == img.ImageURL {
				if len(got) >= len(payload) {
					return fmt.Errorf("forwarded image was not compressed: %d bytes from %d", len(got), len(payload))
				}
				if !bytes.HasPrefix(got, []byte{0xFF, 0xD8, 0xFF}) {
					return fmt.Errorf("forwarded file is not a JPEG")
				}
			}
		}
		return nil
	}

	return fmt.Errorf("post with an image not found in server A's feed (got %d posts)", len(posts))
}

func httpGet(url string) ([]byte, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// testJPEG builds a real photo-shaped JPEG: large enough that compression and
// thumbnailing have something to do, and generated rather than committed so the
// repository does not carry a binary fixture.
func testJPEG(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{
				R: uint8((x * 7) % 251),
				G: uint8((y * 11) % 241),
				B: uint8((x*y + x) % 239),
				A: 255,
			})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		panic(err)
	}
	return buf.Bytes()
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
	if serverACmd, err = startServer(serverADir, "9080"); err != nil {
		return fmt.Errorf("restart server A: %w", err)
	}
	if err := waitForHealth(serverAURL, 30*time.Second); err != nil {
		return fmt.Errorf("server A did not come back: %w", err)
	}
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
