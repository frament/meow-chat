package handlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"testing"

	"my-chat-backend/database"
)

func setServerKey(t *testing.T) []byte {
	t.Helper()
	public := bytes.Repeat([]byte{0x33}, 32)
	database.ServerX25519Public = public
	t.Cleanup(func() { database.ServerX25519Public = nil })
	return public
}

func TestGetServerKey_ReturnsPinnableMaterial(t *testing.T) {
	app, _, _ := setupTestApp(t)
	public := setServerKey(t)

	req, err := http.NewRequest("GET", "/crypto/server-key", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, body := doRequest(t, app, req)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200 without a token, got %d (%#v)", resp.StatusCode, body)
	}

	// The fingerprint is what the client compares with the constant in the
	// bundle. It must be SHA-256 over the raw key, not over the base64 text.
	sum := sha256.Sum256(public)
	want := base64.StdEncoding.EncodeToString(sum[:])
	if body["fingerprint"] != want {
		t.Errorf("fingerprint = %v, want %q", body["fingerprint"], want)
	}
	if body["public_key"] != base64.StdEncoding.EncodeToString(public) {
		t.Errorf("public_key = %v", body["public_key"])
	}
	if body["kid"] != database.KeyID(public) {
		t.Errorf("kid = %v, want %q", body["kid"], database.KeyID(public))
	}
}

// receiveKeyBody builds a registration request. The wrapped key is not real
// ciphertext - the server checks its shape, not its contents, because it cannot
// open it and must not pretend to.
func receiveKeyBody(publicKey []byte) string {
	wrapped := bytes.Repeat([]byte{0x77}, 32+16)
	salt := bytes.Repeat([]byte{0x22}, 16)
	return `{"public_key":"` + base64.StdEncoding.EncodeToString(publicKey) +
		`","wrapped_private_key":"` + base64.StdEncoding.EncodeToString(wrapped) +
		`","kdf_salt":"` + base64.StdEncoding.EncodeToString(salt) + `"}`
}

func TestRegisterReceiveKey_StoresForUser(t *testing.T) {
	app, _, userID := setupTestApp(t)

	key := bytes.Repeat([]byte{0x0a}, 32)
	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", receiveKeyBody(key), userID, false))
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d (%#v)", resp.StatusCode, body)
	}
	if body["kid"] != database.KeyID(key) {
		t.Errorf("kid = %v, want %q", body["kid"], database.KeyID(key))
	}

	var storedUser int64
	if err := database.DB.QueryRow(
		`SELECT user_id FROM user_receive_keys WHERE kid = ?`, database.KeyID(key),
	).Scan(&storedUser); err != nil {
		t.Fatal(err)
	}
	if storedUser != userID {
		t.Errorf("key stored for user %d, expected %d", storedUser, userID)
	}
}

// A second device must receive the same key material, otherwise the user is back
// to moving keys between devices - the problem this design exists to remove.
func TestGetReceiveKey_SecondDeviceGetsTheSameKey(t *testing.T) {
	app, _, userID := setupTestApp(t)

	key := bytes.Repeat([]byte{0x1a}, 32)
	want := receiveKeyBody(key)
	if resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", want, userID, false)); resp.StatusCode != 201 {
		t.Fatalf("registration failed: %d (%#v)", resp.StatusCode, body)
	}

	// The "second device" is just another call with the same credentials: there
	// is no device identity anywhere in this exchange.
	resp, body := doRequest(t, app, jsonRequest(t, "GET", "/crypto/receive-key", "", userID, false))
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d (%#v)", resp.StatusCode, body)
	}
	if body["public_key"] != base64.StdEncoding.EncodeToString(key) {
		t.Errorf("public_key = %v", body["public_key"])
	}

	wrapped := bytes.Repeat([]byte{0x77}, 32+16)
	if body["wrapped_private_key"] != base64.StdEncoding.EncodeToString(wrapped) {
		t.Error("the second device did not get the stored wrapped private key")
	}
	if body["kdf_salt"] == "" {
		t.Error("kdf_salt missing: the key cannot be unwrapped without it")
	}
}

func TestGetReceiveKey_404BeforeSetup(t *testing.T) {
	app, _, userID := setupTestApp(t)

	resp, body := doRequest(t, app, jsonRequest(t, "GET", "/crypto/receive-key", "", userID, false))
	if resp.StatusCode != 404 {
		t.Fatalf("expected 404 when nothing is set up, got %d (%#v)", resp.StatusCode, body)
	}
}

// The load-bearing rule of the whole design: a token alone must not be able to
// redirect the key. Otherwise the attacker registers their own public key and the
// server wraps the entire history for them, which is exactly the hole a per-user
// key was supposed to close.
func TestRegisterReceiveKey_RefusesSilentReplacement(t *testing.T) {
	app, _, userID := setupTestApp(t)

	first := bytes.Repeat([]byte{0x2b}, 32)
	if resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", receiveKeyBody(first), userID, false)); resp.StatusCode != 201 {
		t.Fatalf("first registration failed: %d (%#v)", resp.StatusCode, body)
	}

	attacker := bytes.Repeat([]byte{0x2c}, 32)
	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", receiveKeyBody(attacker), userID, false))
	if resp.StatusCode != 409 {
		t.Fatalf("expected 409 for replacing the key without the password, got %d (%#v)", resp.StatusCode, body)
	}

	var stored string
	if err := database.DB.QueryRow(
		`SELECT public_key FROM user_receive_keys WHERE retired_at IS NULL`,
	).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != base64.StdEncoding.EncodeToString(first) {
		t.Fatal("the stored key changed; a token alone was able to redirect the account's key")
	}
}

func TestRegisterReceiveKey_SameKeyIsIdempotent(t *testing.T) {
	app, _, userID := setupTestApp(t)

	key := bytes.Repeat([]byte{0x3d}, 32)
	for i := 0; i < 2; i++ {
		resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", receiveKeyBody(key), userID, false))
		if resp.StatusCode != 201 && resp.StatusCode != 200 {
			t.Fatalf("call %d: expected 200 or 201, got %d (%#v)", i+1, resp.StatusCode, body)
		}
	}

	// A second row would leave two active keys and make "which one" ambiguous.
	var total int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM user_receive_keys`).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Fatalf("expected exactly one row after two identical registrations, got %d", total)
	}
}

func TestRegisterReceiveKey_RejectsBadSizes(t *testing.T) {
	app, _, userID := setupTestApp(t)

	goodPublic := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))
	goodWrapped := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 48))
	goodSalt := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 16))

	tests := map[string]string{
		// 31 bytes: a valid base64 string, but not an X25519 point.
		"short public key": `{"public_key":"` + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 31)) +
			`","wrapped_private_key":"` + goodWrapped + `","kdf_salt":"` + goodSalt + `"}`,
		// Without the tag the wrapped blob cannot be authenticated on the way out.
		"short wrapped key": `{"public_key":"` + goodPublic +
			`","wrapped_private_key":"` + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 31)) +
			`","kdf_salt":"` + goodSalt + `"}`,
		"short salt": `{"public_key":"` + goodPublic +
			`","wrapped_private_key":"` + goodWrapped +
			`","kdf_salt":"` + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 8)) + `"}`,
		"missing field": `{"public_key":"` + goodPublic + `"}`,
	}

	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			resp, respBody := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", body, userID, false))
			if resp.StatusCode != 400 {
				t.Fatalf("expected 400, got %d (%#v)", resp.StatusCode, respBody)
			}
		})
	}
}
