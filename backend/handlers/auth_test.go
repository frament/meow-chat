package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestAuthRequired_NoHeader(t *testing.T) {
	app, _, _ := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/test-auth", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestAuthRequired_InvalidFormat(t *testing.T) {
	app, _, _ := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/test-auth", nil)
	req.Header.Set("Authorization", "InvalidFormat token")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestAuthRequired_InvalidToken(t *testing.T) {
	app, _, _ := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/test-auth", nil)
	req.Header.Set("Authorization", "Bearer invalid.jwt.token")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestAuthRequired_ValidToken(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/test-auth", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestAdminRequired_NonAdmin(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/test-admin", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}

func TestAdminRequired_Admin(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/test-admin", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestRefreshToken_Success(t *testing.T) {
	app, _, _ := setupTestApp(t)

	loginBody := `{"username":"testuser","password":"password"}`
	req, _ := http.NewRequest("POST", "/login", strings.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("login failed: %d", resp.StatusCode)
	}

	var loginResult map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&loginResult)
	refreshToken := loginResult["refresh_token"].(string)
	if refreshToken == "" {
		t.Fatal("no refresh token returned")
	}

	refreshBody, _ := json.Marshal(map[string]string{"refresh_token": refreshToken})
	req2, _ := http.NewRequest("POST", "/refresh", bytes.NewReader(refreshBody))
	req2.Header.Set("Content-Type", "application/json")
	resp2, err := app.Test(req2)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 200 {
		var body bytes.Buffer
		body.ReadFrom(resp2.Body)
		t.Errorf("expected 200, got %d: %s", resp2.StatusCode, body.String())
	}

	var refreshResult map[string]interface{}
	json.NewDecoder(resp2.Body).Decode(&refreshResult)
	if refreshResult["access_token"] == nil || refreshResult["access_token"] == "" {
		t.Error("expected new access_token")
	}
	if refreshResult["refresh_token"] == nil || refreshResult["refresh_token"] == "" {
		t.Error("expected new refresh_token")
	}
}

func TestRefresh_InvalidToken(t *testing.T) {
	app, _, _ := setupTestApp(t)

	body, _ := json.Marshal(map[string]string{"refresh_token": "invalid.token.here"})
	req, _ := http.NewRequest("POST", "/refresh", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestRefresh_MissingToken(t *testing.T) {
	app, _, _ := setupTestApp(t)

	body := `{"refresh_token":""}`
	req, _ := http.NewRequest("POST", "/refresh", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestRefresh_ReuseRevokedToken(t *testing.T) {
	app, _, _ := setupTestApp(t)

	loginBody := `{"username":"testuser","password":"password"}`
	req, _ := http.NewRequest("POST", "/login", strings.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	resp, _ := app.Test(req)

	var loginResult map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&loginResult)
	refreshToken := loginResult["refresh_token"].(string)

	refreshBody, _ := json.Marshal(map[string]string{"refresh_token": refreshToken})
	req2, _ := http.NewRequest("POST", "/refresh", bytes.NewReader(refreshBody))
	req2.Header.Set("Content-Type", "application/json")
	app.Test(req2)

	req3, _ := http.NewRequest("POST", "/refresh", bytes.NewReader(refreshBody))
	req3.Header.Set("Content-Type", "application/json")
	resp3, err := app.Test(req3)
	if err != nil {
		t.Fatal(err)
	}
	if resp3.StatusCode != 401 {
		t.Errorf("expected 401 for reused token, got %d", resp3.StatusCode)
	}
}
