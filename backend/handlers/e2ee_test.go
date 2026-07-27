package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"my-chat-backend/database"
)

func TestPutKey_Success(t *testing.T) {
	app, h, userID := setupTestApp(t)
	app.Put("/e2ee/key", AuthRequired, h.PutKey)

	body := `{"public_key":"test-pub-key-123"}`
	req, _ := http.NewRequest("PUT", "/e2ee/key", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var key string
	database.DB.QueryRow("SELECT public_key FROM user_keys WHERE user_id=?", userID).Scan(&key)
	if key != "test-pub-key-123" {
		t.Errorf("expected test-pub-key-123, got %s", key)
	}
}

func TestPutKey_MissingPublicKey(t *testing.T) {
	app, h, userID := setupTestApp(t)
	app.Put("/e2ee/key", AuthRequired, h.PutKey)

	body := `{"public_key":""}`
	req, _ := http.NewRequest("PUT", "/e2ee/key", strings.NewReader(body))
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

func TestPutKey_UpdatesExisting(t *testing.T) {
	app, h, userID := setupTestApp(t)
	app.Put("/e2ee/key", AuthRequired, h.PutKey)

	database.DB.Exec("INSERT INTO user_keys (user_id, public_key) VALUES (?, ?)", userID, "old-key")

	body := `{"public_key":"new-key-456"}`
	req, _ := http.NewRequest("PUT", "/e2ee/key", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var key string
	database.DB.QueryRow("SELECT public_key FROM user_keys WHERE user_id=?", userID).Scan(&key)
	if key != "new-key-456" {
		t.Errorf("expected new-key-456, got %s", key)
	}
}

func TestGetKey_Success(t *testing.T) {
	app, h, userID := setupTestApp(t)
	app.Get("/e2ee/key/:userId", AuthRequired, h.GetKey)

	database.DB.Exec("INSERT INTO users (id, username, email, password) VALUES (10, 'peer', 'peer@test.com', 'hash')")
	database.DB.Exec("INSERT INTO user_keys (user_id, public_key) VALUES (10, 'peer-pub-key')")

	req, _ := http.NewRequest("GET", "/e2ee/key/10", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	if result["public_key"] != "peer-pub-key" {
		t.Errorf("expected peer-pub-key, got %s", result["public_key"])
	}
}

func TestGetKey_NotFound(t *testing.T) {
	app, h, userID := setupTestApp(t)
	app.Get("/e2ee/key/:userId", AuthRequired, h.GetKey)

	req, _ := http.NewRequest("GET", "/e2ee/key/999", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestGetKey_InvalidUserID(t *testing.T) {
	app, h, userID := setupTestApp(t)
	app.Get("/e2ee/key/:userId", AuthRequired, h.GetKey)

	req, _ := http.NewRequest("GET", "/e2ee/key/abc", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestUploadGroupKeyShare_Success(t *testing.T) {
	app, h, groupCreatorID := setupTestApp(t)
	database.DB.Exec("INSERT INTO users (id, username, email, password) VALUES (11, 'member', 'm@test.com', 'hash')")
	database.DB.Exec("INSERT INTO group_chats (id, name, created_by) VALUES (1, 'Secret Group', ?)", groupCreatorID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (1, ?)", groupCreatorID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (1, 11)")

	app.Post("/e2ee/groups/:id/key-share", AuthRequired, h.UploadGroupKeyShare)

	body := `{"user_id":11,"encrypted_key":"ek","iv":"iv"}`
	req, _ := http.NewRequest("POST", "/e2ee/groups/1/key-share", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, groupCreatorID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		var buf bytes.Buffer
		buf.ReadFrom(resp.Body)
		t.Errorf("expected 200, got %d: %s", resp.StatusCode, buf.String())
	}

	var encrypted, iv string
	database.DB.QueryRow(
		"SELECT encrypted_key, iv FROM group_key_shares WHERE group_chat_id=1 AND user_id=11",
	).Scan(&encrypted, &iv)
	if encrypted != "ek" || iv != "iv" {
		t.Errorf("key share not persisted correctly")
	}
}

func TestUploadGroupKeyShare_NotMember(t *testing.T) {
	app, h, userID := setupTestApp(t)
	database.DB.Exec("INSERT INTO users (id, username, email, password) VALUES (12, 'outsider', 'out@test.com', 'hash')")
	database.DB.Exec("INSERT INTO group_chats (id, name, created_by) VALUES (2, 'Private', ?)", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (2, ?)", userID)

	app.Post("/e2ee/groups/:id/key-share", AuthRequired, h.UploadGroupKeyShare)

	outsiderToken := bearerToken(t, 12, false)
	body := `{"user_id":1,"encrypted_key":"ek","iv":"iv"}`
	req, _ := http.NewRequest("POST", "/e2ee/groups/2/key-share", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", outsiderToken)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}

func TestGetMyGroupKeyShare_Success(t *testing.T) {
	app, h, userID := setupTestApp(t)
	database.DB.Exec("INSERT INTO group_chats (id, name, created_by) VALUES (3, 'G3', ?)", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (3, ?)", userID)
	database.DB.Exec("INSERT INTO group_key_shares (group_chat_id, user_id, encrypted_key, iv) VALUES (3, ?, 'enc-key', 'iv-val')", userID)

	app.Get("/e2ee/groups/:id/key-share", AuthRequired, h.GetMyGroupKeyShare)

	req, _ := http.NewRequest("GET", "/e2ee/groups/"+strconv.FormatInt(3, 10)+"/key-share", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	if result["encrypted_key"] != "enc-key" || result["iv"] != "iv-val" {
		t.Errorf("wrong key share data: %v", result)
	}
}

func TestGetMyGroupKeyShare_NotFound(t *testing.T) {
	app, h, userID := setupTestApp(t)
	database.DB.Exec("INSERT INTO group_chats (id, name, created_by) VALUES (4, 'G4', ?)", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (4, ?)", userID)

	app.Get("/e2ee/groups/:id/key-share", AuthRequired, h.GetMyGroupKeyShare)

	req, _ := http.NewRequest("GET", "/e2ee/groups/4/key-share", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}
