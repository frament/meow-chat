package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"testing"

	"my-chat-backend/models"
)

func TestSendMessage_WithEnvelopes(t *testing.T) {
	app, _, userID := setupTestApp(t)

	envs := `[{"device_id":"devA","wrapped_key":"wk1","iv":"iv1"},{"device_id":"devB","wrapped_key":"wk2","iv":"iv2"}]`
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("to_user_id", "2")
	w.WriteField("content", "")
	w.WriteField("encrypted_content", "legacy-c")
	w.WriteField("encrypted_iv", "legacy-iv")
	w.WriteField("env_content", "env-c")
	w.WriteField("env_iv", "env-iv")
	w.WriteField("envelopes", envs)
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
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, body.String())
	}

	req, _ = http.NewRequest("GET", "/messages?user1=1&user2=2", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	var msgs []models.Message
	json.NewDecoder(resp.Body).Decode(&msgs)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	m := msgs[0]
	if m.EnvContent != "env-c" || m.EnvIV != "env-iv" {
		t.Fatalf("env fields missing: %+v", m)
	}
	if len(m.Envelopes) != 2 || m.Envelopes[0].DeviceID != "devA" || m.Envelopes[1].WrappedKey != "wk2" {
		t.Fatalf("envelopes missing: %+v", m.Envelopes)
	}
	// Legacy fields must still be present for old clients.
	if m.EncryptedContent != "legacy-c" {
		t.Fatalf("legacy content lost: %+v", m)
	}
}
