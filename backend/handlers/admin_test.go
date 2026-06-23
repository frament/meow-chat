package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
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

func TestAdminBlockUser(t *testing.T) {
	app, _, userID := setupTestApp(t)
	var targetID int64
	database.DB.QueryRow("SELECT id FROM users WHERE username='admin'").Scan(&targetID)

	req, _ := http.NewRequest("POST", "/admin/users/"+itos(targetID)+"/block", nil)
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

	var isBanned int
	database.DB.QueryRow("SELECT is_banned FROM users WHERE id=?", targetID).Scan(&isBanned)
	if isBanned != 1 {
		t.Error("expected is_banned=1")
	}
}

func TestAdminBlockUser_Self(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("POST", "/admin/users/"+itos(userID)+"/block", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 400, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestAdminUnblockUser(t *testing.T) {
	app, _, userID := setupTestApp(t)
	var targetID int64
	database.DB.QueryRow("SELECT id FROM users WHERE username='admin'").Scan(&targetID)
	database.DB.Exec("UPDATE users SET is_banned=1 WHERE id=?", targetID)

	req, _ := http.NewRequest("POST", "/admin/users/"+itos(targetID)+"/unblock", nil)
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

	var isBanned int
	database.DB.QueryRow("SELECT is_banned FROM users WHERE id=?", targetID).Scan(&isBanned)
	if isBanned != 0 {
		t.Error("expected is_banned=0")
	}
}

func TestAdminDeleteUser(t *testing.T) {
	app, _, userID := setupTestApp(t)
	var targetID int64
	database.DB.QueryRow("SELECT id FROM users WHERE username='admin'").Scan(&targetID)

	req, _ := http.NewRequest("DELETE", "/admin/users/"+itos(targetID), nil)
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

	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM users WHERE id=?", targetID).Scan(&count)
	if count != 0 {
		t.Error("expected user to be deleted")
	}
}

func TestAdminDeleteUser_Self(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("DELETE", "/admin/users/"+itos(userID), nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 400, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestAdminDeleteFile(t *testing.T) {
	app, _, userID := setupTestApp(t)

	tmpFile := "./uploads/messages/test-delete.txt"
	os.WriteFile(tmpFile, []byte("test"), 0644)
	defer os.Remove(tmpFile)

	var reqBody bytes.Buffer
	json.NewEncoder(&reqBody).Encode(map[string]string{"path": "/uploads/messages/test-delete.txt"})

	req, _ := http.NewRequest("DELETE", "/admin/files", &reqBody)
	req.Header.Set("Content-Type", "application/json")
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

	if _, err := os.Stat(tmpFile); !os.IsNotExist(err) {
		t.Error("expected file to be deleted")
	}
}

func TestLogin_Banned(t *testing.T) {
	app, _, _ := setupTestApp(t)

	var userID int64
	database.DB.QueryRow("SELECT id FROM users WHERE username='testuser'").Scan(&userID)
	database.DB.Exec("UPDATE users SET is_banned=1 WHERE id=?", userID)

	reqBody := bytes.NewBufferString(`{"username":"testuser","password":"password"}`)
	req, _ := http.NewRequest("POST", "/login", reqBody)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 403, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func itos(i int64) string {
	return strconv.FormatInt(i, 10)
}
