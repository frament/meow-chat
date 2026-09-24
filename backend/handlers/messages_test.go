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

func TestSendMessage_Encrypted(t *testing.T) {
	app, _, userID := setupTestApp(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("to_user_id", "1")
	w.WriteField("content", "")
	w.WriteField("encrypted_content", "some-encrypted-content")
	w.WriteField("encrypted_iv", "some-iv")
	w.Close()

	req, _ := http.NewRequest("POST", "/messages", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Errorf("expected 201, got %d", resp.StatusCode)
	}

	var msg models.Message
	database.DB.QueryRow(
		"SELECT encrypted_content, encrypted_iv FROM messages WHERE from_user_id=? ORDER BY id DESC LIMIT 1",
		userID,
	).Scan(&msg.EncryptedContent, &msg.EncryptedIV)
	if msg.EncryptedContent != "some-encrypted-content" || msg.EncryptedIV != "some-iv" {
		t.Errorf("encrypted content/iv not persisted correctly")
	}
}

func TestSendMessage_EncryptedStoresNoPlaintext(t *testing.T) {
	app, _, userID := setupTestApp(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("to_user_id", "1")
	w.WriteField("content", "")
	w.WriteField("encrypted_content", "cipher-blob")
	w.WriteField("encrypted_iv", "iv-blob")
	w.WriteField("push_preview", "hello preview")
	w.Close()

	req, _ := http.NewRequest("POST", "/messages", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}

	var content, enc string
	database.DB.QueryRow(
		"SELECT content, encrypted_content FROM messages WHERE from_user_id=? ORDER BY id DESC LIMIT 1",
		userID,
	).Scan(&content, &enc)
	if content != "" {
		t.Errorf("expected empty plaintext content, got %q", content)
	}
	if enc != "cipher-blob" {
		t.Errorf("expected ciphertext stored, got %q", enc)
	}
}

func TestSendMessage_Sticker(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO sticker_packs (id, name) VALUES (1, 'Test Pack')")
	database.DB.Exec("INSERT INTO stickers (id, pack_id, image_url, sort_order) VALUES (1, 1, '/test.png', 0)")

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("to_user_id", "1")
	w.WriteField("content", "1")
	w.WriteField("type", "sticker")
	w.Close()

	req, _ := http.NewRequest("POST", "/messages", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Errorf("expected 201, got %d", resp.StatusCode)
	}

	var stickerURL string
	database.DB.QueryRow(
		"SELECT sticker_url FROM messages WHERE from_user_id=? ORDER BY id DESC LIMIT 1",
		userID,
	).Scan(&stickerURL)
	if stickerURL != "/test.png" {
		t.Errorf("expected /test.png, got %s", stickerURL)
	}
}

func TestSendMessage_Poll(t *testing.T) {
	app, _, userID := setupTestApp(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("to_user_id", "1")
	w.WriteField("content", "Favorite color?")
	w.WriteField("type", "poll")
	w.WriteField("poll_options[]", "Red")
	w.WriteField("poll_options[]", "Blue")
	w.WriteField("poll_options[]", "Green")
	w.WriteField("poll_multiple", "true")
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

	var pollID int64
	database.DB.QueryRow("SELECT id FROM polls ORDER BY id DESC LIMIT 1").Scan(&pollID)
	if pollID == 0 {
		t.Error("expected poll to be created")
	}

	var optCount int
	database.DB.QueryRow("SELECT COUNT(*) FROM poll_options WHERE poll_id=?", pollID).Scan(&optCount)
	if optCount != 3 {
		t.Errorf("expected 3 poll options, got %d", optCount)
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


