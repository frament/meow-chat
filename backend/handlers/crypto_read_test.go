package handlers

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"

	"my-chat-backend/database"
	"my-chat-backend/messagecrypto"
	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/curve25519"
)

// insertServerSchemeMessage stores a row exactly as SendMessage would, so the
// read path is exercised against the real shape of the data.
func insertServerSchemeMessage(t *testing.T, fromUserID, toUserID int64, text string) {
	t.Helper()
	blob, err := database.EncryptAtRest([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(
		`INSERT INTO messages (from_user_id, to_user_id, content, msg_type, encrypted_content, crypto_scheme)
		 VALUES (?, ?, '', 'text', ?, 'server')`,
		fromUserID, toUserID, base64.StdEncoding.EncodeToString(blob),
	); err != nil {
		t.Fatal(err)
	}
}

// readerKeyPair generates the account's key and registers its public half, the
// way a client would. The private half stays here to check what comes back.
func readerKeyPair(t *testing.T, app *fiber.App, userID int64) []byte {
	t.Helper()

	private := make([]byte, curve25519.ScalarSize)
	if _, err := rand.Read(private); err != nil {
		t.Fatal(err)
	}
	public, err := curve25519.X25519(private, curve25519.Basepoint)
	if err != nil {
		t.Fatal(err)
	}

	wrapped := bytes.Repeat([]byte{0x11}, 32+16)
	salt := bytes.Repeat([]byte{0x22}, 16)
	body := `{"public_key":"` + base64.StdEncoding.EncodeToString(public) +
		`","wrapped_private_key":"` + base64.StdEncoding.EncodeToString(wrapped) +
		`","kdf_salt":"` + base64.StdEncoding.EncodeToString(salt) + `"}`

	resp, respBody := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", body, userID, false))
	if resp.StatusCode != 201 {
		t.Fatalf("registering the reader key failed: %d (%#v)", resp.StatusCode, respBody)
	}
	return private
}

func getMessagesAs(t *testing.T, app *fiber.App, userID int64, url string) (int, []models.Message) {
	t.Helper()

	req := jsonRequest(t, "GET", url, "", userID, false)
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	var out []models.Message
	if resp.StatusCode == 200 {
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
	}
	return resp.StatusCode, out
}

func TestGetMessages_ServerSchemeArrivesWrappedForReader(t *testing.T) {
	app, _, userID := setupTestApp(t)
	setupServerCrypto(t)
	private := readerKeyPair(t, app, userID)

	const text = "текст, который должен приехать конвертом"
	insertServerSchemeMessage(t, userID, 1, text)

	status, messages := getMessagesAs(t, app, userID, "/messages?user1="+itoa(userID)+"&user2=1")
	if status != 200 {
		t.Fatalf("expected 200, got %d", status)
	}
	if len(messages) != 1 {
		t.Fatalf("expected one message, got %d", len(messages))
	}
	m := messages[0]

	if m.Content != "" {
		t.Fatalf("content must stay empty for the server scheme, got %q", m.Content)
	}
	if m.EncryptedContent != "" {
		t.Fatal("the at-rest blob was sent to the client; it can only be opened by the server")
	}
	if m.NeedsKey {
		t.Fatal("the reader has a key, so the message must not be reported as unreadable")
	}
	if m.ServerEnvelope == nil {
		t.Fatal("no envelope: the reader has a key and must receive one")
	}

	plaintext, err := messagecrypto.Open(m.ServerEnvelope, private)
	if err != nil {
		t.Fatalf("the envelope does not open with the reader's key: %v", err)
	}
	if string(plaintext) != text {
		t.Fatalf("decrypted text = %q, want %q", plaintext, text)
	}

	// The envelope must be addressed to this reader's key, not the server's:
	// otherwise the reader would need the server's private key to open it.
	if m.ServerEnvelope.Kid != database.KeyID(mustPublic(t, private)) {
		t.Errorf("envelope kid = %q, want the reader's key id", m.ServerEnvelope.Kid)
	}
}

// Without a key the message exists but cannot be wrapped. Saying so is the only
// honest option: plaintext would defeat the layer, the at-rest blob is useless to
// the client, and an empty bubble reads as deleted history.
func TestGetMessages_ServerSchemeWithoutKeyReportsNeedsKey(t *testing.T) {
	app, _, userID := setupTestApp(t)
	setupServerCrypto(t)

	insertServerSchemeMessage(t, userID, 1, "есть, но ключа нет")

	status, messages := getMessagesAs(t, app, userID, "/messages?user1="+itoa(userID)+"&user2=1")
	if status != 200 {
		t.Fatalf("a missing key must not fail the whole thread, got %d", status)
	}
	if len(messages) != 1 {
		t.Fatalf("expected one message, got %d", len(messages))
	}
	m := messages[0]

	if !m.NeedsKey {
		t.Error("needs_key must be set when the account has no receive key")
	}
	if m.ServerEnvelope != nil {
		t.Error("no envelope can exist without a key to wrap to")
	}
	if m.Content != "" {
		t.Fatalf("content leaked: %q", m.Content)
	}
	if m.EncryptedContent != "" {
		t.Error("the at-rest blob was sent to the client")
	}
}

// A row that does not open under the at-rest key means the key changed or the
// data is damaged. Returning a thread of empty bubbles would look like the
// messages were deleted, so this must fail loudly.
func TestGetMessages_CorruptAtRestIsLoud(t *testing.T) {
	app, _, userID := setupTestApp(t)
	setupServerCrypto(t)
	readerKeyPair(t, app, userID)

	// Valid base64, but not something the at-rest key produced.
	junk := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x01}, 48))
	if _, err := database.DB.Exec(
		`INSERT INTO messages (from_user_id, to_user_id, content, msg_type, encrypted_content, crypto_scheme)
		 VALUES (?, 1, '', 'text', ?, 'server')`,
		userID, junk,
	); err != nil {
		t.Fatal(err)
	}

	status, _ := getMessagesAs(t, app, userID, "/messages?user1="+itoa(userID)+"&user2=1")
	if status != 500 {
		t.Fatalf("expected 500 for unreadable stored content, got %d", status)
	}
}

// mustPublic derives the public half for assertions.
func mustPublic(t *testing.T, private []byte) []byte {
	t.Helper()
	public, err := curve25519.X25519(private, curve25519.Basepoint)
	if err != nil {
		t.Fatal(err)
	}
	return public
}
