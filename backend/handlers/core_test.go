package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"my-chat-backend/auth"
	"my-chat-backend/database"
)

func TestRegister_Success(t *testing.T) {
	app, _, _ := setupTestApp(t)

	database.DB.Exec("INSERT INTO invite_tokens (created_by, token, max_uses) VALUES (1, 'valid-token', 10)")

	body := `{"username":"newuser","email":"new@example.com","password":"secret123","invite_token":"valid-token"}`
	req, _ := http.NewRequest("POST", "/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Errorf("expected 201, got %d", resp.StatusCode)
	}

	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM users WHERE username='newuser'").Scan(&count)
	if count != 1 {
		t.Errorf("expected user to exist")
	}
}

func TestRegister_MissingInvite(t *testing.T) {
	app, _, _ := setupTestApp(t)

	body := `{"username":"newuser","email":"new@example.com","password":"secret123"}`
	req, _ := http.NewRequest("POST", "/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestRegister_InvalidInvite(t *testing.T) {
	app, _, _ := setupTestApp(t)

	body := `{"username":"newuser","email":"new@example.com","password":"secret123","invite_token":"nonexistent"}`
	req, _ := http.NewRequest("POST", "/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestRegister_AutoFriend(t *testing.T) {
	app, _, _ := setupTestApp(t)

	database.DB.Exec("INSERT INTO invite_tokens (created_by, token, max_uses) VALUES (1, 'friend-token', 10)")

	body := `{"username":"frienduser","email":"friend@example.com","password":"secret123","invite_token":"friend-token"}`
	req, _ := http.NewRequest("POST", "/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}

	var friendCount int
	err = database.DB.QueryRow(
		"SELECT COUNT(*) FROM friends WHERE (user_id=1 AND friend_id=3) OR (user_id=3 AND friend_id=1)",
	).Scan(&friendCount)
	if err != nil {
		t.Fatal(err)
	}
	if friendCount != 1 {
		t.Errorf("expected friend relationship between inviter (1) and new user (3), got %d rows", friendCount)
	}
}

func TestRegister_AutoFriend_NoDuplicate(t *testing.T) {
	app, _, _ := setupTestApp(t)

	database.DB.Exec("INSERT INTO invite_tokens (created_by, token, max_uses) VALUES (1, 'dup-token', 10)")
	database.DB.Exec("INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (1, 3)")

	body := `{"username":"dupuser","email":"dup@example.com","password":"secret123","invite_token":"dup-token"}`
	req, _ := http.NewRequest("POST", "/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}

	var friendCount int
	database.DB.QueryRow(
		"SELECT COUNT(*) FROM friends WHERE (user_id=1 AND friend_id=3) OR (user_id=3 AND friend_id=1)",
	).Scan(&friendCount)
	if friendCount != 1 {
		t.Errorf("expected exactly 1 friend row, got %d", friendCount)
	}
}

func TestRegister_ExhaustedInvite(t *testing.T) {
	app, _, _ := setupTestApp(t)

	database.DB.Exec("INSERT INTO invite_tokens (created_by, token, max_uses, use_count) VALUES (1, 'exhausted', 1, 1)")

	body := `{"username":"newuser","email":"new@example.com","password":"secret123","invite_token":"exhausted"}`
	req, _ := http.NewRequest("POST", "/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestLogin_Success(t *testing.T) {
	app, _, _ := setupTestApp(t)

	body := `{"username":"testuser","password":"password"}`
	req, _ := http.NewRequest("POST", "/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var authResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	json.NewDecoder(resp.Body).Decode(&authResp)
	if authResp.AccessToken == "" {
		t.Error("expected access_token")
	}
	if authResp.RefreshToken == "" {
		t.Error("expected refresh_token")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	app, _, _ := setupTestApp(t)

	body := `{"username":"testuser","password":"wrongpass"}`
	req, _ := http.NewRequest("POST", "/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestLogin_NonExistentUser(t *testing.T) {
	app, _, _ := setupTestApp(t)

	body := `{"username":"nobody","password":"password"}`
	req, _ := http.NewRequest("POST", "/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestRefresh_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)

	refreshToken, tokenID, err := auth.GenerateRefreshToken(userID)
	if err != nil {
		t.Fatal(err)
	}
	database.SaveRefreshToken(userID, tokenID, time.Now().Add(7*24*time.Hour))

	body := `{"refresh_token":"` + refreshToken + `"}`
	req, _ := http.NewRequest("POST", "/refresh", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestUpdateProfile_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"username":"updateduser","email":"updated@example.com"}`
	req, _ := http.NewRequest("PUT", "/profile", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))

	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var username string
	database.DB.QueryRow("SELECT username FROM users WHERE id=?", userID).Scan(&username)
	if username != "updateduser" {
		t.Errorf("expected username updateduser, got %s", username)
	}
}
