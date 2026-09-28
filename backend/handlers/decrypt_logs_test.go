package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"my-chat-backend/database"
)

func TestLogDecryptFailure(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"scope":"dm","peer_id":2,"msg_type":"text","detail":"decrypt_failed"}`
	req, _ := http.NewRequest("POST", "/e2ee/decrypt-failed", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var scope, detail string
	var peerID, gotUser int64
	database.DB.QueryRow(
		"SELECT user_id, scope, peer_id, detail FROM decrypt_failures ORDER BY id DESC LIMIT 1",
	).Scan(&gotUser, &scope, &peerID, &detail)
	if gotUser != userID || scope != "dm" || peerID != 2 || detail != "decrypt_failed" {
		t.Fatalf("unexpected row: user=%d scope=%q peer=%d detail=%q", gotUser, scope, peerID, detail)
	}
}

func TestLogDecryptFailure_InvalidScope(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"scope":"nope"}`
	req, _ := http.NewRequest("POST", "/e2ee/decrypt-failed", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestAdminDecryptFailures_Aggregates(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES ('G', ?)", userID)
	database.DB.Exec("INSERT INTO decrypt_failures (user_id, scope, peer_id, detail) VALUES (?, 'dm', 2, 'decrypt_failed')", userID)
	database.DB.Exec("INSERT INTO decrypt_failures (user_id, scope, group_id, detail) VALUES (?, 'group', 1, 'no_group_key')", userID)

	req, _ := http.NewRequest("GET", "/admin/decrypt-failures?limit=10", nil)
	req.Header.Set("Authorization", bearerToken(t, 2, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var out struct {
		Total      int `json:"total"`
		DMCount    int `json:"dm_count"`
		GroupCount int `json:"group_count"`
		Users      int `json:"users"`
		Groups     int `json:"groups"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if out.Total != 2 || out.DMCount != 1 || out.GroupCount != 1 || out.Users != 1 || out.Groups != 1 {
		t.Fatalf("unexpected aggregates: %+v", out)
	}
}

func TestAdminDecryptFailures_ForbiddenForNonAdmin(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/admin/decrypt-failures", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}
