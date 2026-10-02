package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"my-chat-backend/database"
)

func TestVAPIDPublicKey(t *testing.T) {
	app, _, _ := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/push/vapid-public-key", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result struct {
		PublicKey string `json:"publicKey"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.PublicKey == "" {
		t.Error("expected non-empty publicKey")
	}
}

func TestSubscribePush(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"endpoint":"https://example.com/push","p256dh":"abc123","auth":"def456"}`
	req, _ := http.NewRequest("POST", "/push/subscribe", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM push_subscriptions WHERE user_id=?", userID).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 subscription, got %d", count)
	}
}

func TestSubscribePush_MissingFields(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"endpoint":"https://example.com/push"}`
	req, _ := http.NewRequest("POST", "/push/subscribe", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestUnsubscribePush(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)",
		userID, "https://example.com/push", "abc", "def")

	body := `{"endpoint":"https://example.com/push"}`
	req, _ := http.NewRequest("POST", "/push/unsubscribe", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM push_subscriptions WHERE user_id=?", userID).Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 subscriptions, got %d", count)
	}
}

func TestUnsubscribePush_NoEndpoint(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{}`
	req, _ := http.NewRequest("POST", "/push/unsubscribe", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestSendWelcomePush(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("POST", "/push/welcome", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result struct {
		Sent bool `json:"sent"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if !result.Sent {
		t.Error("expected sent=true on the first welcome push")
	}
}

// The endpoint has no subscription to deliver to in a test environment, so the
// send is recorded as no_subscription rather than send. That must not count as
// "already sent" - a delivery that never happened must stay retryable.
func TestSendWelcomePush_FailedSendStaysRetryable(t *testing.T) {
	app, _, userID := setupTestApp(t)

	call := func() bool {
		req, _ := http.NewRequest("POST", "/push/welcome", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", bearerToken(t, userID, false))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
		var result struct {
			Sent bool `json:"sent"`
		}
		json.NewDecoder(resp.Body).Decode(&result)
		return result.Sent
	}

	if !call() {
		t.Error("expected the first call to be accepted")
	}
	if !call() {
		t.Error("expected the second call to be accepted again: nothing was delivered, so it must stay retryable")
	}
}

func TestSendWelcomePush_DedupesAfterSuccessfulSend(t *testing.T) {
	app, _, userID := setupTestApp(t)

	// Stand in for a delivered welcome push: only kind='send' marks it as done,
	// which is what the handler counts.
	database.DB.Exec(
		"INSERT INTO push_logs (user_id, source, kind, endpoint, title, body, status) VALUES (?, 'welcome', 'send', 'https://example.com/push', 'MeowChat установлен', '...', '201')",
		userID,
	)

	req, _ := http.NewRequest("POST", "/push/welcome", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result struct {
		Sent   bool   `json:"sent"`
		Reason string `json:"reason"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Sent {
		t.Error("expected sent=false once a welcome push was already delivered")
	}
	if result.Reason != "already_sent" {
		t.Errorf("expected reason=already_sent, got %q", result.Reason)
	}
}
