package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"my-chat-backend/database"
)

func TestGetKeyBackupStatus(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/devices/backup-status", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		HasPassword bool `json:"has_password_backup"`
		HasPhrase   bool `json:"has_recovery_phrase"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if out.HasPassword || out.HasPhrase {
		t.Fatalf("expected no backups, got %+v", out)
	}

	database.DB.Exec(
		"INSERT INTO user_keys_backup (user_id, encrypted_key, iv, salt, recovery_phrase_encrypted, recovery_phrase_iv, recovery_phrase_salt) VALUES (?, 'ek', 'iv', 's', 'pe', 'piv', 'ps')",
		userID,
	)
	req, _ = http.NewRequest("GET", "/devices/backup-status", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if !out.HasPassword || !out.HasPhrase {
		t.Fatalf("expected both backups, got %+v", out)
	}
}

func TestGetUserDeviceKeys(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO user_devices (user_id, device_name, device_public_key, device_id) VALUES (?, ?, ?, ?)", userID, "Phone", "pk1", "d1")
	database.DB.Exec("INSERT INTO user_devices (user_id, device_name, device_public_key, device_id) VALUES (?, ?, ?, ?)", userID, "PC", "pk2", "d2")

	req, _ := http.NewRequest("GET", fmt.Sprintf("/users/%d/device-keys", userID), nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var keys []struct {
		DeviceID  string `json:"device_id"`
		PublicKey string `json:"device_public_key"`
	}
	json.NewDecoder(resp.Body).Decode(&keys)
	if len(keys) != 2 || keys[0].PublicKey != "pk1" {
		t.Fatalf("unexpected device keys: %+v", keys)
	}
}

func TestRegisterDevice_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"device_name":"TestPhone","device_public_key":"abc123","device_id":"dev1"}`
	req, _ := http.NewRequest("POST", "/devices/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}

	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM user_devices WHERE user_id=?", userID).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 device, got %d", count)
	}
}

func TestRegisterDevice_MissingFields(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"device_name":"TestPhone"}`
	req, _ := http.NewRequest("POST", "/devices/register", strings.NewReader(body))
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

func TestListDevices_Empty(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/devices/", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var devices []struct{}
	json.NewDecoder(resp.Body).Decode(&devices)
	if len(devices) != 0 {
		t.Errorf("expected empty list, got %d items", len(devices))
	}
}

func TestListDevices_WithDevice(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO user_devices (user_id, device_name, device_public_key, device_id) VALUES (?, ?, ?, ?)",
		userID, "Phone", "key123", "dev1")

	req, _ := http.NewRequest("GET", "/devices/", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}

	var devices []struct {
		DeviceName string `json:"device_name"`
	}
	json.NewDecoder(resp.Body).Decode(&devices)
	if len(devices) != 1 || devices[0].DeviceName != "Phone" {
		t.Errorf("expected 1 device named Phone, got %+v", devices)
	}
}

func TestRemoveDevice_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO user_devices (user_id, device_name, device_public_key, device_id) VALUES (?, ?, ?, ?)",
		userID, "Phone", "key123", "dev1")

	req, _ := http.NewRequest("DELETE", "/devices/dev1", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM user_devices WHERE user_id=?", userID).Scan(&count)
	if count != 0 {
		t.Error("expected device to be deleted")
	}
}

func TestRemoveDevice_NotFound(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("DELETE", "/devices/nonexistent", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestCreateAuthRequest_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"device_name":"NewPhone","device_public_key":"key456","device_id":"dev2"}`
	req, _ := http.NewRequest("POST", "/devices/auth-request", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
}

func TestCreateAuthRequest_MissingFields(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"device_name":"NewPhone"}`
	req, _ := http.NewRequest("POST", "/devices/auth-request", strings.NewReader(body))
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

func TestCreateAuthRequest_RelinkAfterRegister(t *testing.T) {
	app, _, userID := setupTestApp(t)

	// The app registers the device before starting the linking flow.
	regBody := `{"device_name":"Laptop","device_public_key":"pk-laptop","device_id":"devL"}`
	req, _ := http.NewRequest("POST", "/devices/register", strings.NewReader(regBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	if resp, err := app.Test(req); err != nil || resp.StatusCode != 201 {
		t.Fatalf("register: status=%v err=%v", resp.StatusCode, err)
	}

	authBody := `{"device_name":"Laptop","device_public_key":"pk-laptop","device_id":"devL"}`
	for attempt := 0; attempt < 2; attempt++ {
		req, _ := http.NewRequest("POST", "/devices/auth-request", strings.NewReader(authBody))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", bearerToken(t, userID, false))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 201 {
			t.Fatalf("attempt %d: expected 201, got %d", attempt, resp.StatusCode)
		}
	}

	// No duplicate pending requests, and the device registration is preserved.
	var pending int
	database.DB.QueryRow(
		"SELECT COUNT(*) FROM device_auth_requests WHERE user_id=? AND device_id='devL' AND status='pending'", userID,
	).Scan(&pending)
	if pending != 1 {
		t.Fatalf("expected 1 pending request, got %d", pending)
	}
	var devices int
	database.DB.QueryRow("SELECT COUNT(*) FROM user_devices WHERE user_id=? AND device_id='devL'", userID).Scan(&devices)
	if devices != 1 {
		t.Fatalf("expected device to remain registered, got %d", devices)
	}
	var pk string
	database.DB.QueryRow(
		"SELECT device_public_key FROM device_auth_requests WHERE user_id=? AND device_id='devL'", userID,
	).Scan(&pk)
	if pk != "pk-laptop" {
		t.Fatalf("expected public key stored, got %q", pk)
	}
}

func TestListAuthRequests_Empty(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/devices/auth-requests", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestApproveDenyAuthRequest(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec(`INSERT INTO device_auth_requests (user_id, device_name, device_public_key, device_id, status)
		VALUES (?, ?, ?, ?, 'pending')`, userID, "NewPhone", "key456", "dev2")

	t.Run("approve", func(t *testing.T) {
		body := `{"encrypted_key":"encrypted123","iv":"iv123"}`
		req, _ := http.NewRequest("POST", "/devices/auth-requests/1/approve", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", bearerToken(t, userID, false))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("approve: expected 200, got %d", resp.StatusCode)
		}
	})

	t.Run("deny", func(t *testing.T) {
		database.DB.Exec(`INSERT INTO device_auth_requests (user_id, device_name, device_public_key, device_id, status)
			VALUES (?, ?, ?, ?, 'pending')`, userID, "OtherPhone", "key789", "dev3")
		req, _ := http.NewRequest("POST", "/devices/auth-requests/2/deny", nil)
		req.Header.Set("Authorization", bearerToken(t, userID, false))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("deny: expected 200, got %d", resp.StatusCode)
		}
	})

	t.Run("get approved", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/devices/auth-requests/1", nil)
		req.Header.Set("Authorization", bearerToken(t, userID, false))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Status string `json:"status"`
		}
		json.NewDecoder(resp.Body).Decode(&result)
		if result.Status != "approved" {
			t.Errorf("expected approved, got %s", result.Status)
		}
	})

	t.Run("get not found", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/devices/auth-requests/999", nil)
		req.Header.Set("Authorization", bearerToken(t, userID, false))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 404 {
			t.Errorf("expected 404, got %d", resp.StatusCode)
		}
	})
}

func TestUploadKeyBackup_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"encrypted_key":"ek123","iv":"iv123","salt":"salt123"}`
	req, _ := http.NewRequest("POST", "/devices/keys/backup", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestUploadKeyBackup_MissingFields(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"encrypted_key":"ek123"}`
	req, _ := http.NewRequest("POST", "/devices/keys/backup", strings.NewReader(body))
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

func TestGenerateRecoveryPhrase(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("POST", "/devices/recovery/generate", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result struct {
		Phrase string `json:"phrase"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Phrase == "" {
		t.Error("expected non-empty phrase")
	}
}

func TestRecoveryPhraseStatus(t *testing.T) {
	app, _, userID := setupTestApp(t)

	t.Run("no phrase", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/devices/recovery/status", nil)
		req.Header.Set("Authorization", bearerToken(t, userID, false))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			HasPhrase bool `json:"has_recovery_phrase"`
		}
		json.NewDecoder(resp.Body).Decode(&result)
		if result.HasPhrase {
			t.Error("expected no phrase")
		}
	})

	t.Run("set phrase backup", func(t *testing.T) {
		body := `{"encrypted_key":"ek","iv":"iv","salt":"salt"}`
		req, _ := http.NewRequest("POST", "/devices/recovery/set", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", bearerToken(t, userID, false))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("set phrase: expected 200, got %d", resp.StatusCode)
		}
	})
}
