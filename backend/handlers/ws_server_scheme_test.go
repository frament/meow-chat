package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net"
	"strconv"
	"testing"
	"time"

	fiberws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/curve25519"

	"my-chat-backend/auth"
	"my-chat-backend/database"
	"my-chat-backend/messagecrypto"
)

// setupWebSocketWithSend is setupWSTest plus the send route, because the defect
// these tests cover lives on the way from "message stored" to "message on the
// socket": a test that posts straight into h.broadcast would skip exactly the
// half where the plaintext can get lost.
func setupWebSocketWithSend(t *testing.T) (*fiber.App, *Handler, string, int64) {
	t.Helper()

	_, recipientID := setupWSDB(t)

	app := fiber.New()
	h := NewHandler()
	app.Post("/messages", AuthRequired, h.SendMessage)
	app.Get("/ws", func(c *fiber.Ctx) error {
		claims, err := auth.ValidateAccessToken(c.Query("token"))
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
		}
		c.Locals("userId", claims.UserID)
		return c.Next()
	}, fiberws.New(func(c *fiberws.Conn) {
		h.HandleWebSocket(c)
	}))

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	go app.Listener(listener)
	t.Cleanup(func() {
		h.Close()
		app.Shutdown()
		listener.Close()
	})

	return app, h, "ws://127.0.0.1:" + strconv.Itoa(port), recipientID
}

// registerRecipientKey stores the account key the way POST /crypto/receive-key
// does, and hands back the private half so a test can open what the server wraps.
func registerRecipientKey(t *testing.T, userID int64) []byte {
	t.Helper()

	private := make([]byte, curve25519.ScalarSize)
	if _, err := rand.Read(private); err != nil {
		t.Fatal(err)
	}
	public, err := curve25519.X25519(private, curve25519.Basepoint)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := database.DB.Exec(
		`INSERT INTO user_receive_keys (user_id, kid, public_key, wrapped_private_key, kdf_salt)
		 VALUES (?, ?, ?, ?, ?)`,
		userID,
		database.KeyID(public),
		base64.StdEncoding.EncodeToString(public),
		// The wrapped private half is the client's business; the server only
		// stores and returns it, so any well-formed blob will do here.
		base64.StdEncoding.EncodeToString(make([]byte, 48)),
		base64.StdEncoding.EncodeToString(make([]byte, 16)),
	); err != nil {
		t.Fatal(err)
	}
	return private
}

func firstOtherUserID(t *testing.T, notThis int64) int64 {
	t.Helper()
	var id int64
	if err := database.DB.QueryRow(
		"SELECT id FROM users WHERE id != ? ORDER BY id LIMIT 1", notThis,
	).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// envelopeFromFrame turns the decoded JSON back into the wire type, so the test
// opens exactly what the client would receive rather than a re-encoded copy.
func envelopeFromFrame(raw any) (*messagecrypto.Envelope, error) {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var envelope messagecrypto.Envelope
	if err := json.Unmarshal(encoded, &envelope); err != nil {
		return nil, err
	}
	return &envelope, nil
}

// sendSealed sends one text message the way a pinned client does: the text
// travels only inside an envelope wrapped to the server's key.
func sendSealed(t *testing.T, app *fiber.App, senderID, recipientID int64, serverPublic []byte, text string) {
	t.Helper()

	env, err := messagecrypto.Seal([]byte(text), serverPublic, database.KeyID(serverPublic))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}

	resp, body := sendMultipart(t, app, senderID, map[string]string{
		"to_user_id":      strconv.FormatInt(recipientID, 10),
		"server_envelope": string(raw),
	})
	if resp.StatusCode != 201 {
		t.Fatalf("sending failed: %d (%#v)", resp.StatusCode, body)
	}
}

// A message sent under the server scheme must reach the recipient live, over the
// socket, readable.
//
// The row keeps `content` empty - the text lives under the at-rest key - so the
// only thing that can make the text readable on the client is an envelope
// wrapped to the reader's own key. The frame carried none, and the client has no
// other source for one, so the bubble appeared empty until the thread was
// reloaded from GET /messages, which does the wrapping. Reported from prod on
// 2026-10-25, right after the pin was switched on.
func TestWebSocket_ServerSchemeMessageArrivesReadable(t *testing.T) {
	app, h, baseURL, recipientID := setupWebSocketWithSend(t)
	_ = h
	serverPublic := setupServerCrypto(t)
	const text = "текст под ключом сервера"
	private := registerRecipientKey(t, recipientID)
	senderID := firstOtherUserID(t, recipientID)

	conn := wsDialDrain(t, baseURL, recipientID, false)

	sendSealed(t, app, senderID, recipientID, serverPublic, text)

	frame, err := wsReadTimeout(t, conn, 5*time.Second)
	if err != nil {
		t.Fatalf("no frame arrived: %v", err)
	}

	if got := frame["content"]; got != "" {
		t.Fatalf("content = %v, want empty: the text must not travel unwrapped", got)
	}

	rawEnvelope, ok := frame["server_envelope"]
	if !ok {
		t.Fatal("the frame carries no envelope: a live thread shows an empty bubble " +
			"and only a reload produces text")
	}
	if frame["needs_key"] == true {
		t.Error("the recipient has a key, so the message must not be reported as unreadable")
	}
	if _, present := frame["encrypted_content"]; present {
		t.Error("the at-rest blob was sent over the socket; it can only be opened by the server")
	}

	envelope, err := envelopeFromFrame(rawEnvelope)
	if err != nil {
		t.Fatalf("envelope in frame is not an envelope: %v", err)
	}
	plaintext, err := messagecrypto.Open(envelope, private)
	if err != nil {
		t.Fatalf("the envelope does not open with the recipient's key: %v", err)
	}
	if string(plaintext) != text {
		t.Fatalf("decrypted text = %q, want %q", plaintext, text)
	}
	if envelope.Kid != database.KeyID(mustPublic(t, private)) {
		t.Errorf("envelope kid = %q, want the recipient's key id", envelope.Kid)
	}
}

// Without a key nothing can be wrapped, and the only honest frame is the one that
// says so - the same answer the read path gives. An empty bubble reads as deleted
// history.
func TestWebSocket_ServerSchemeWithoutKeySaysSo(t *testing.T) {
	app, _, baseURL, recipientID := setupWebSocketWithSend(t)
	serverPublic := setupServerCrypto(t)
	senderID := firstOtherUserID(t, recipientID)

	conn := wsDialDrain(t, baseURL, recipientID, false)

	sendSealed(t, app, senderID, recipientID, serverPublic, "есть, но ключа нет")

	frame, err := wsReadTimeout(t, conn, 5*time.Second)
	if err != nil {
		t.Fatalf("no frame arrived: %v", err)
	}
	if frame["needs_key"] != true {
		t.Errorf("needs_key = %v, want true: an account without a key must be told", frame["needs_key"])
	}
	if _, present := frame["server_envelope"]; present {
		t.Error("no envelope can exist without a key to wrap to")
	}
	if _, present := frame["encrypted_content"]; present {
		t.Error("the at-rest blob was sent over the socket")
	}
}
