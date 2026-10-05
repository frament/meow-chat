package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"my-chat-backend/database"
)

func TestPushClientLog(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"kind":"subscribe","endpoint":"https://example.push/x","detail":"ok"}`
	req, _ := http.NewRequest("POST", "/push/log", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var kind, source string
	database.DB.QueryRow("SELECT kind, source FROM push_logs ORDER BY id DESC LIMIT 1").Scan(&kind, &source)
	if kind != "subscribe" || source != "client" {
		t.Fatalf("expected client subscribe log, got kind=%q source=%q", kind, source)
	}
}

func TestPushAck(t *testing.T) {
	app, _, _ := setupTestApp(t)

	body := `{"ackId":"abc123","kind":"shown"}`
	req, _ := http.NewRequest("POST", "/push/ack", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var kind string
	database.DB.QueryRow("SELECT kind FROM push_logs ORDER BY id DESC LIMIT 1").Scan(&kind)
	if kind != "shown" {
		t.Fatalf("expected shown ack, got %q", kind)
	}
}

func TestAdminPushEndpoints(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, 'k', 'a')", userID, "https://example.push/s1")
	database.DB.Exec("INSERT INTO push_logs (user_id, source, kind, status) VALUES (?, 'server', 'send', '201')", userID)

	// status
	req, _ := http.NewRequest("GET", "/admin/push/status", nil)
	req.Header.Set("Authorization", bearerToken(t, 2, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var status struct {
		TotalSubscriptions int `json:"total_subscriptions"`
	}
	json.NewDecoder(resp.Body).Decode(&status)
	if status.TotalSubscriptions != 1 {
		t.Fatalf("expected 1 subscription, got %d", status.TotalSubscriptions)
	}

	// logs
	req, _ = http.NewRequest("GET", "/admin/push/logs?limit=10", nil)
	req.Header.Set("Authorization", bearerToken(t, 2, true))
	resp, _ = app.Test(req)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var logs []adminPushLog
	json.NewDecoder(resp.Body).Decode(&logs)
	if len(logs) != 1 || logs[0].Kind != "send" || logs[0].Status != "201" {
		t.Fatalf("unexpected logs: %+v", logs)
	}
}

func TestAdminPushEndpoints_ForbiddenForNonAdmin(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/admin/push/logs", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}

func TestGiphyStatus(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/giphy/status", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var res struct {
		HasKey bool `json:"has_key"`
	}
	json.NewDecoder(resp.Body).Decode(&res)
	if res.HasKey {
		t.Error("expected has_key=false when no giphy key configured")
	}
}

func TestBuildPushPreview(t *testing.T) {
	cases := []struct {
		msgType   string
		content   string
		preview   string
		hasImages bool
		want      string
	}{
		{"text", "", "hello", false, "hello"},
		{"text", "hello", "", false, "hello"},
		{"sticker", "42", "", false, "[Стикер]"},
		{"gif", "https://x/y.gif", "", false, "[GIF]"},
		{"poll", "Question?", "", false, "Question?"},
		{"image", "", "", true, "[Изображение]"},
		{"image", "caption", "", true, "caption"},
	}
	for _, c := range cases {
		got := buildPushPreview(c.msgType, c.content, c.preview, c.hasImages)
		if got != c.want {
			t.Errorf("buildPushPreview(%q,%q,%q,%v) = %q, want %q", c.msgType, c.content, c.preview, c.hasImages, got, c.want)
		}
	}
}

func TestTruncateRunes(t *testing.T) {
	if got := truncateRunes("hello", 10); got != "hello" {
		t.Errorf("expected unchanged, got %q", got)
	}
	if got := truncateRunes("приветмир", 6); got != "привет..." {
		t.Errorf("expected 'привет...', got %q", got)
	}
	// must not split emoji
	if got := truncateRunes("😀😀😀😀", 2); got != "😀😀..." {
		t.Errorf("expected '😀😀...', got %q", got)
	}
}

func TestPushClientLogBatch(t *testing.T) {
	app, _, userID := setupTestApp(t)

	// A subscribe run fires several of these in a row. One request each meant one
	// connection and one TLS handshake each, at the moment the app was trying to
	// appear - the thing that made the app slow to open on LTE.
	body := `{"entries":[
		{"kind":"permission_denied","detail":""},
		{"kind":"rotate","endpoint":"https://example.push/old","detail":""},
		{"kind":"subscribe","endpoint":"https://example.push/new","detail":"ok"}
	]}`
	req, _ := http.NewRequest("POST", "/push/log/batch", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var out struct {
		Written int `json:"written"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	written := out.Written
	if written != 3 {
		t.Fatalf("expected 3 written, got %d", written)
	}

	// Every entry has to land, not just the first - a batch that quietly wrote one
	// row would look identical from the client.
	rows, err := database.DB.Query(
		"SELECT kind FROM push_logs WHERE user_id = ? ORDER BY id ASC", userID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var kinds []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatal(err)
		}
		kinds = append(kinds, k)
	}
	want := []string{"permission_denied", "rotate", "subscribe"}
	if len(kinds) != len(want) {
		t.Fatalf("expected %d rows, got %v", len(want), kinds)
	}
	for i := range want {
		if kinds[i] != want[i] {
			t.Fatalf("row %d: expected %q, got %q", i, want[i], kinds[i])
		}
	}
}

func TestPushClientLogBatch_RejectsEmpty(t *testing.T) {
	app, _, userID := setupTestApp(t)

	for _, body := range []string{`{"entries":[]}`, `{}`} {
		req, _ := http.NewRequest("POST", "/push/log/batch", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", bearerToken(t, userID, false))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 400 {
			t.Fatalf("expected 400 for %s, got %d", body, resp.StatusCode)
		}
	}
}

// A malformed client must not be able to turn one request into thousands of
// writes. 50 is far above any real subscribe run.
func TestPushClientLogBatch_CapsEntries(t *testing.T) {
	app, _, userID := setupTestApp(t)

	entries := make([]map[string]string, 80)
	for i := range entries {
		entries[i] = map[string]string{"kind": "subscribe", "detail": "x"}
	}
	payload, _ := json.Marshal(map[string]any{"entries": entries})

	req, _ := http.NewRequest("POST", "/push/log/batch", strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var out struct {
		Written int `json:"written"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	written := out.Written
	if written != 50 {
		t.Fatalf("expected the batch capped at 50, got %d", written)
	}
}

func TestPushClientLogBatch_SkipsEntriesWithoutKind(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"entries":[{"kind":"subscribe"},{"endpoint":"https://example.push/x"},{"kind":"rotate"}]}`
	req, _ := http.NewRequest("POST", "/push/log/batch", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var out struct {
		Written int `json:"written"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	written := out.Written
	if written != 2 {
		t.Fatalf("expected 2 written, got %d", written)
	}
}
