package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strconv"
	"testing"

	"my-chat-backend/database"
	"my-chat-backend/models"
)

func TestSendMessage_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("to_user_id", "1")
	w.WriteField("content", "Hello!")
	w.Close()

	req, _ := http.NewRequest("POST", "/messages", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		var body bytes.Buffer
		body.ReadFrom(resp.Body)
		t.Errorf("expected 201, got %d: %s", resp.StatusCode, body.String())
	}
}

func TestGetMessages_Empty(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/messages?user1=1&user2="+strconv.FormatInt(userID, 10), nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var msgs []models.Message
	json.NewDecoder(resp.Body).Decode(&msgs)
	if len(msgs) != 0 {
		t.Errorf("expected empty messages, got %d", len(msgs))
	}
}

func TestGetMessages_WithMessages(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO messages (from_user_id, to_user_id, content, msg_type) VALUES (?, ?, ?, ?)", userID, 1, "Hi!", "text")
	database.DB.Exec("INSERT INTO messages (from_user_id, to_user_id, content, msg_type) VALUES (?, ?, ?, ?)", 1, userID, "Hey!", "text")

	req, _ := http.NewRequest("GET", "/messages?user1="+strconv.FormatInt(userID, 10)+"&user2=1", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var msgs []models.Message
	json.NewDecoder(resp.Body).Decode(&msgs)
	if len(msgs) != 2 {
		t.Errorf("expected 2 messages, got %d", len(msgs))
	}
}

func TestGetMessages_AccessDenied(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/messages?user1=999&user2=888", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}
