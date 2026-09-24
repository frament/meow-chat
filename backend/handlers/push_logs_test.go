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
