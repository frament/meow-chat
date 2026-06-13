package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"my-chat-backend/database"
	"my-chat-backend/models"
)

func TestAdminListUsers(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/admin/users", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}

	var users []models.User
	json.NewDecoder(resp.Body).Decode(&users)
	if len(users) < 2 {
		t.Errorf("expected at least 2 users, got %d", len(users))
	}
}

func TestAdminListUsers_NonAdmin(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/admin/users", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}

func TestAdminMakeAdmin(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("POST", "/admin/users/"+itos(userID)+"/make-admin", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	respBody := new(bytes.Buffer)
	respBody.ReadFrom(resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestAdminRemoveAdmin(t *testing.T) {
	app, _, userID := setupTestApp(t)

	// First make admin
	database.DB.Exec("UPDATE users SET is_admin=1 WHERE id=?", userID)
	req, _ := http.NewRequest("POST", "/admin/users/"+itos(userID)+"/remove-admin", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}

	var isAdmin int
	database.DB.QueryRow("SELECT is_admin FROM users WHERE id=?", userID).Scan(&isAdmin)
	if isAdmin != 0 {
		t.Error("expected is_admin=0")
	}
}

func TestAdminListFiles(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/admin/files", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestAdminListGroupChats(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Admin Group", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	req, _ := http.NewRequest("GET", "/admin/group-chats", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func itos(i int64) string {
	return strconv.FormatInt(i, 10)
}
