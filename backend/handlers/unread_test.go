package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"my-chat-backend/database"
)

type unreadResponse struct {
	Users  []unreadEntry `json:"users"`
	Groups []unreadEntry `json:"groups"`
}

func TestGetUnread_DirectAndGroup(t *testing.T) {
	app, _, userID := setupTestApp(t)

	// Unread direct message from admin (id 2) + one read message that must not count
	database.DB.Exec("INSERT INTO messages (from_user_id, to_user_id, content, is_read) VALUES (?, ?, ?, 0)", 2, userID, "unread dm")
	database.DB.Exec("INSERT INTO messages (from_user_id, to_user_id, content, is_read) VALUES (?, ?, ?, 1)", 2, userID, "read dm")

	// Group with one unread message
	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "G", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)
	database.DB.Exec("INSERT INTO group_messages (group_chat_id, from_user_id, content) VALUES (?, ?, ?)", 1, 2, "unread group")

	req, _ := http.NewRequest("GET", "/unread", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var out unreadResponse
	json.NewDecoder(resp.Body).Decode(&out)

	if len(out.Users) != 1 || out.Users[0].ID != 2 || out.Users[0].Count != 1 {
		t.Fatalf("expected 1 unread dm from user 2, got %+v", out.Users)
	}
	if out.Users[0].FirstUnreadAt == "" {
		t.Error("expected direct first_unread_at to be set")
	}
	if len(out.Groups) != 1 || out.Groups[0].ID != 1 || out.Groups[0].Count != 1 {
		t.Fatalf("expected 1 unread group message in group 1, got %+v", out.Groups)
	}
	if out.Groups[0].FirstUnreadAt == "" {
		t.Error("expected group first_unread_at to be set")
	}
}

func TestMarkGroupRead_ClearsUnread(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "G", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)
	database.DB.Exec("INSERT INTO group_messages (group_chat_id, from_user_id, content) VALUES (?, ?, ?)", 1, 2, "hello")

	req, _ := http.NewRequest("POST", "/group-chats/1/read", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	req, _ = http.NewRequest("GET", "/unread", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, _ = app.Test(req)
	var out unreadResponse
	json.NewDecoder(resp.Body).Decode(&out)
	if len(out.Groups) != 0 {
		t.Fatalf("expected group unread to be cleared, got %+v", out.Groups)
	}
}

func TestMarkGroupRead_NotMember(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "G", 2)

	req, _ := http.NewRequest("POST", "/group-chats/1/read", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}
