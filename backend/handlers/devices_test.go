package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"my-chat-backend/database"
)

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

	var devices []struct{ DeviceName string `json:"device_name"` }
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
