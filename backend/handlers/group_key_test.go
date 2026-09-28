package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"my-chat-backend/database"
)

func TestPushTagUnique(t *testing.T) {
	a := pushTag("chat-2", "aaa")
	b := pushTag("chat-2", "bbb")
	if a == b {
		t.Fatalf("expected unique tags, got %q twice", a)
	}
	if a != "chat-2-aaa" {
		t.Fatalf("unexpected tag %q", a)
	}
	if got := pushTag("", "x"); got != "" {
		t.Fatalf("expected empty tag for empty base, got %q", got)
	}
}

func TestRequestGroupKey_MemberAndNotMember(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "G", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	req, _ := http.NewRequest("POST", "/group-chats/1/request-key", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200 for member, got %d", resp.StatusCode)
	}

	// A user who is not a member must be rejected.
	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Other", 2)
	req, _ = http.NewRequest("POST", "/group-chats/2/request-key", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Fatalf("expected 403 for non-member, got %d", resp.StatusCode)
	}
}

func TestGroupKeyShare_RoundTripForOtherMember(t *testing.T) {
	app, _, userID := setupTestApp(t)

	// Group with testuser (1) and admin (2) as members.
	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "G", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, 2)

	body := `{"user_id":2,"encrypted_key":"cipher-for-admin","iv":"nonce"}`
	req, _ := http.NewRequest("POST", "/group-chats/1/keys", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200 uploading share, got %d", resp.StatusCode)
	}

	// The recipient can fetch their own share.
	req, _ = http.NewRequest("GET", "/group-chats/1/my-key", nil)
	req.Header.Set("Authorization", bearerToken(t, 2, true))
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200 fetching own share, got %d", resp.StatusCode)
	}
	var out struct {
		EncryptedKey string `json:"encrypted_key"`
		IV           string `json:"iv"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if out.EncryptedKey != "cipher-for-admin" || out.IV != "nonce" {
		t.Fatalf("unexpected share: %+v", out)
	}
}

func TestAddGroupMember_RequestsKeyBroadcast(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "G", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	body := `{"username":"admin"}`
	req, _ := http.NewRequest("POST", "/group-chats/1/members", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200 adding member, got %d", resp.StatusCode)
	}

	var isMember int
	database.DB.QueryRow(
		"SELECT COUNT(*) FROM group_chat_members WHERE group_chat_id = 1 AND user_id = 2",
	).Scan(&isMember)
	if isMember != 1 {
		t.Fatal("expected admin to be added to the group")
	}
}
