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

	// The fingerprint is the whole point: it is what the client compares with the
	// constant in the bundle. It must be SHA-256 over the raw key, not over the
	// base64 text, or a re-encoded key would look like a substitution.
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

// insertDevice registers a device row for the user and returns its device_id.
func insertDevice(t *testing.T, userID int64, deviceID string) {
	t.Helper()
	if _, err := database.DB.Exec(
		"INSERT INTO user_devices (user_id, device_name, device_public_key, device_id) VALUES (?, 'phone', 'ecdh-placeholder', ?)",
		userID, deviceID,
	); err != nil {
		t.Fatal(err)
	}
}

func receiveKeyBody(t *testing.T, deviceID string, key []byte) string {
	t.Helper()
	return `{"device_id":"` + deviceID + `","public_key":"` + base64.StdEncoding.EncodeToString(key) + `"}`
}

func TestRegisterReceiveKey_StoresKeyForOwnDevice(t *testing.T) {
	app, _, userID := setupTestApp(t)
	insertDevice(t, userID, "dev-1")

	key := bytes.Repeat([]byte{0x0a}, 32)
	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", receiveKeyBody(t, "dev-1", key), userID, false))
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d (%#v)", resp.StatusCode, body)
	}
	if body["kid"] != database.KeyID(key) {
		t.Errorf("kid = %v, want %q", body["kid"], database.KeyID(key))
	}

	var stored string
	if err := database.DB.QueryRow(`SELECT public_key FROM device_receive_keys WHERE kid = ?`, database.KeyID(key)).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != base64.StdEncoding.EncodeToString(key) {
		t.Errorf("stored key does not match what was sent")
	}
}

func TestRegisterReceiveKey_SecondRegistrationIsIdempotent(t *testing.T) {
	app, _, userID := setupTestApp(t)
	insertDevice(t, userID, "dev-1")

	key := bytes.Repeat([]byte{0x0b}, 32)
	for i := 0; i < 2; i++ {
		resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", receiveKeyBody(t, "dev-1", key), userID, false))
		if resp.StatusCode != 201 && resp.StatusCode != 200 {
			t.Fatalf("call %d: expected 200 or 201, got %d (%#v)", i+1, resp.StatusCode, body)
		}
	}

	// Two active keys would leave it ambiguous which one to wrap to, and a second
	// row at all means the guard was skipped and the old key was retired for
	// nothing - so the total matters, not just the active count.
	var total, active int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM device_receive_keys`).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if err := database.DB.QueryRow(
		`SELECT COUNT(*) FROM device_receive_keys WHERE retired_at IS NULL`,
	).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if total != 1 || active != 1 {
		t.Fatalf("expected exactly one row for a repeated registration, got %d rows (%d active)", total, active)
	}
}

func TestRegisterReceiveKey_RotatesByRetiringTheOldKey(t *testing.T) {
	app, _, userID := setupTestApp(t)
	insertDevice(t, userID, "dev-1")

	first := bytes.Repeat([]byte{0x0c}, 32)
	if resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", receiveKeyBody(t, "dev-1", first), userID, false)); resp.StatusCode != 201 {
		t.Fatalf("first registration failed: %d (%#v)", resp.StatusCode, body)
	}

	second := bytes.Repeat([]byte{0x0d}, 32)
	if resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key", receiveKeyBody(t, "dev-1", second), userID, false)); resp.StatusCode != 201 {
		t.Fatalf("second registration failed: %d (%#v)", resp.StatusCode, body)
	}

	// The old row stays: content wrapped under it has to remain readable.
	var active, retired int
	database.DB.QueryRow(`SELECT COUNT(*) FROM device_receive_keys WHERE retired_at IS NULL`).Scan(&active)
	database.DB.QueryRow(`SELECT COUNT(*) FROM device_receive_keys WHERE retired_at IS NOT NULL`).Scan(&retired)
	if active != 1 || retired != 1 {
		t.Fatalf("expected 1 active and 1 retired, got %d and %d", active, retired)
	}

	var activeKid string
	database.DB.QueryRow(`SELECT kid FROM device_receive_keys WHERE retired_at IS NULL`).Scan(&activeKid)
	if activeKid != database.KeyID(second) {
		t.Errorf("active key is %q, want the newly registered one", activeKid)
	}
}

// A token must not be able to attach a key to another account's device.
func TestRegisterReceiveKey_ForeignDeviceRejected(t *testing.T) {
	app, _, _ := setupTestApp(t)

	res, err := database.DB.Exec("INSERT INTO users (username, email, password) VALUES ('victim', 'v@e.ml', 'x')")
	if err != nil {
		t.Fatal(err)
	}
	victimID, _ := res.LastInsertId()
	insertDevice(t, victimID, "victim-phone")

	res, err = database.DB.Exec("INSERT INTO users (username, email, password) VALUES ('attacker', 'a@e.ml', 'x')")
	if err != nil {
		t.Fatal(err)
	}
	attackerID, _ := res.LastInsertId()

	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key",
		receiveKeyBody(t, "victim-phone", bytes.Repeat([]byte{0x0e}, 32)), attackerID, false))
	if resp.StatusCode != 404 {
		t.Fatalf("expected 404 for another user's device, got %d (%#v)", resp.StatusCode, body)
	}

	var stored int
	database.DB.QueryRow(`SELECT COUNT(*) FROM device_receive_keys`).Scan(&stored)
	if stored != 0 {
		t.Fatal("a key was stored against a device belonging to someone else")
	}
}

func TestRegisterReceiveKey_RejectsWrongKeySize(t *testing.T) {
	app, _, userID := setupTestApp(t)
	insertDevice(t, userID, "dev-1")

	// 16 bytes is a valid AES size, so a length check that only validates the
	// encoding would accept it and fail much later, on a message.
	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/crypto/receive-key",
		`{"device_id":"dev-1","public_key":"`+base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 16))+`"}`,
		userID, false))
	if resp.StatusCode != 400 {
		t.Fatalf("expected 400 for a 16-byte key, got %d (%#v)", resp.StatusCode, body)
	}
}
