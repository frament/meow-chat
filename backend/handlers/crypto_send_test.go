package handlers

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"testing"

	"my-chat-backend/database"
	"my-chat-backend/messagecrypto"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/curve25519"
)

// setupServerCrypto installs a server key pair and an at-rest key for one test.
func setupServerCrypto(t *testing.T) []byte {
	t.Helper()

	private := make([]byte, curve25519.ScalarSize)
	if _, err := rand.Read(private); err != nil {
		t.Fatal(err)
	}
	public, err := curve25519.X25519(private, curve25519.Basepoint)
	if err != nil {
		t.Fatal(err)
	}

	previousPrivate, previousPublic, previousAtRest :=
		database.ServerX25519Private, database.ServerX25519Public, database.AtRestKey
	database.ServerX25519Private = private
	database.ServerX25519Public = public
	database.AtRestKey = bytes.Repeat([]byte{0x5a}, 32)
	t.Cleanup(func() {
		database.ServerX25519Private, database.ServerX25519Public = previousPrivate, previousPublic
		database.AtRestKey = previousAtRest
	})
	return public
}

func sendMultipart(t *testing.T, app *fiber.App, userID int64, fields map[string]string) (*http.Response, map[string]any) {
	t.Helper()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	w.Close()

	req, err := http.NewRequest("POST", "/messages", &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	return doRequest(t, app, req)
}

func TestSendMessage_ServerSchemeStoresCiphertextOnly(t *testing.T) {
	app, _, userID := setupTestApp(t)
	public := setupServerCrypto(t)
	const text = "секретный текст сообщения"

	env, err := messagecrypto.Seal([]byte(text), public, database.KeyID(public))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}

	resp, body := sendMultipart(t, app, userID, map[string]string{
		"to_user_id":      "1",
		"server_envelope": string(raw),
	})
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d (%#v)", resp.StatusCode, body)
	}

	var content, scheme, stored string
	if err := database.DB.QueryRow(
		`SELECT content, crypto_scheme, encrypted_content FROM messages ORDER BY id DESC LIMIT 1`,
	).Scan(&content, &scheme, &stored); err != nil {
		t.Fatal(err)
	}

	// The row must not carry the text in the clear: that is the property the
	// whole layer is for, and a message that keeps `content` filled would look
	// encrypted while being readable in every backup.
	if content != "" {
		t.Fatalf("plaintext column is not empty: %q", content)
	}
	if scheme != "server" {
		t.Fatalf("crypto_scheme = %q, want server", scheme)
	}

	blob, err := base64.StdEncoding.DecodeString(stored)
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := database.DecryptAtRest(blob)
	if err != nil {
		t.Fatalf("stored blob does not open under the at-rest key: %v", err)
	}
	if string(plaintext) != text {
		t.Fatalf("stored text = %q, want %q", plaintext, text)
	}
}

// A sender addressing a key this server does not hold must be told, not silently
// accepted: the row would then be unreadable for everyone, forever.
func TestSendMessage_ServerEnvelopeWrongKid(t *testing.T) {
	app, _, userID := setupTestApp(t)
	setupServerCrypto(t)

	otherPrivate := make([]byte, curve25519.ScalarSize)
	otherPublic, err := curve25519.X25519(otherPrivate, curve25519.Basepoint)
	if err != nil {
		t.Fatal(err)
	}
	env, err := messagecrypto.Seal([]byte("x"), otherPublic, database.KeyID(otherPublic))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(env)

	resp, body := sendMultipart(t, app, userID, map[string]string{
		"to_user_id":      "1",
		"server_envelope": string(raw),
	})
	if resp.StatusCode != 409 {
		t.Fatalf("expected 409, got %d (%#v)", resp.StatusCode, body)
	}

	var count int
	database.DB.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&count)
	if count != 0 {
		t.Fatal("a message was stored although its envelope could not be opened")
	}
}

func TestSendMessage_ServerEnvelopeTamperedIsRejected(t *testing.T) {
	app, _, userID := setupTestApp(t)
	public := setupServerCrypto(t)

	env, err := messagecrypto.Seal([]byte("x"), public, database.KeyID(public))
	if err != nil {
		t.Fatal(err)
	}
	ct, _ := base64.StdEncoding.DecodeString(env.Ciphertext)
	ct[0] ^= 0xff
	env.Ciphertext = base64.StdEncoding.EncodeToString(ct)
	raw, _ := json.Marshal(env)

	resp, body := sendMultipart(t, app, userID, map[string]string{
		"to_user_id":      "1",
		"server_envelope": string(raw),
	})
	if resp.StatusCode != 400 {
		t.Fatalf("expected 400 for a tampered envelope, got %d (%#v)", resp.StatusCode, body)
	}

	var count int
	database.DB.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&count)
	if count != 0 {
		t.Fatal("a tampered message was stored")
	}
}

// The column must not lie about the schemes that already existed, otherwise
// every new E2EE message would be labelled plain and the reader would take the
// wrong path.
func TestSendMessage_SchemeColumnMatchesWhatWasStored(t *testing.T) {
	app, _, userID := setupTestApp(t)
	setupServerCrypto(t)

	cases := []struct {
		name   string
		fields map[string]string
		want   string
	}{
		{
			name:   "e2ee",
			fields: map[string]string{"to_user_id": "1", "encrypted_content": "cipher", "encrypted_iv": "iv"},
			want:   "e2ee",
		},
		{
			name:   "plain",
			fields: map[string]string{"to_user_id": "1", "content": "открытым текстом"},
			want:   "plain",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, body := sendMultipart(t, app, userID, tc.fields)
			if resp.StatusCode != 201 {
				t.Fatalf("expected 201, got %d (%#v)", resp.StatusCode, body)
			}
			var scheme string
			if err := database.DB.QueryRow(
				`SELECT crypto_scheme FROM messages ORDER BY id DESC LIMIT 1`,
			).Scan(&scheme); err != nil {
				t.Fatal(err)
			}
			if scheme != tc.want {
				t.Fatalf("crypto_scheme = %q, want %q", scheme, tc.want)
			}
		})
	}
}
