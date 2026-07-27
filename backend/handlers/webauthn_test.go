package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestWebAuthnHasCredentials_ExistingUserNoCreds(t *testing.T) {
	t.Setenv("WEBAUTHN_RP_ID", "localhost")
	t.Setenv("WEBAUTHN_RP_ORIGIN", "http://localhost:4200")

	app, h, _ := setupTestApp(t)
	app.Post("/webauthn/has-credentials", h.WebAuthnHasCredentials)

	body := `{"username":"testuser"}`
	req := httptest.NewRequest("POST", "/webauthn/has-credentials", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, 3000)
	if err != nil {
		t.Fatal(err)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}

	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	has, ok := result["has_credentials"]
	if !ok {
		t.Fatal("missing has_credentials field")
	}
	if has != false {
		t.Errorf("expected has_credentials=false, got %v", has)
	}
}

func TestWebAuthnHasCredentials_NonexistentUser(t *testing.T) {
	t.Setenv("WEBAUTHN_RP_ID", "localhost")
	t.Setenv("WEBAUTHN_RP_ORIGIN", "http://localhost:4200")

	app, h, _ := setupTestApp(t)
	app.Post("/webauthn/has-credentials", h.WebAuthnHasCredentials)

	body := `{"username":"nobody"}`
	req := httptest.NewRequest("POST", "/webauthn/has-credentials", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, 3000)
	if err != nil {
		t.Fatal(err)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}

	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	has, ok := result["has_credentials"]
	if !ok {
		t.Fatal("missing has_credentials field")
	}
	if has != false {
		t.Errorf("expected has_credentials=false, got %v", has)
	}
}

func TestWebAuthnHasCredentials_EmptyBody(t *testing.T) {
	t.Setenv("WEBAUTHN_RP_ID", "localhost")
	t.Setenv("WEBAUTHN_RP_ORIGIN", "http://localhost:4200")

	app, h, _ := setupTestApp(t)
	app.Post("/webauthn/has-credentials", h.WebAuthnHasCredentials)

	req := httptest.NewRequest("POST", "/webauthn/has-credentials", nil)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, 3000)
	if err != nil {
		t.Fatal(err)
	}

	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestWebAuthnListCredentials_ReturnsEmptyList(t *testing.T) {
	t.Setenv("WEBAUTHN_RP_ID", "localhost")
	t.Setenv("WEBAUTHN_RP_ORIGIN", "http://localhost:4200")

	app, h, testUserID := setupTestApp(t)
	wa := app.Group("/webauthn")
	wa.Use(AuthRequired)
	wa.Get("/credentials", h.WebAuthnListCredentials)

	req := httptest.NewRequest("GET", "/webauthn/credentials", nil)
	req.Header.Set("Authorization", bearerToken(t, testUserID, false))
	resp, err := app.Test(req, 3000)
	if err != nil {
		t.Fatal(err)
	}

	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var result []interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty list, got %d items", len(result))
	}
}

func TestWebAuthnBeginRegistration_Success(t *testing.T) {
	t.Setenv("WEBAUTHN_RP_ID", "localhost")
	t.Setenv("WEBAUTHN_RP_ORIGIN", "http://localhost:4200")
	t.Setenv("WEBAUTHN_RP_DISPLAY_NAME", "MeowChat")

	app, h, testUserID := setupTestApp(t)
	wa := app.Group("/webauthn")
	wa.Use(AuthRequired)
	wa.Post("/begin-registration", h.WebAuthnBeginRegistration)

	req := httptest.NewRequest("POST", "/webauthn/begin-registration", nil)
	req.Header.Set("Authorization", bearerToken(t, testUserID, false))
	resp, err := app.Test(req, 3000)
	if err != nil {
		t.Fatal(err)
	}

	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result["session_id"] == nil || result["session_id"] == "" {
		t.Error("expected session_id in response")
	}
	if result["options"] == nil {
		t.Error("expected options in response")
	}
}

func TestWebAuthnBeginLogin_NoCredentials(t *testing.T) {
	t.Setenv("WEBAUTHN_RP_ID", "localhost")
	t.Setenv("WEBAUTHN_RP_ORIGIN", "http://localhost:4200")
	t.Setenv("WEBAUTHN_RP_DISPLAY_NAME", "MeowChat")

	app, h, _ := setupTestApp(t)

	body := `{"username":"testuser"}`
	req := httptest.NewRequest("POST", "/webauthn/begin-login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	app.Post("/webauthn/begin-login", h.WebAuthnBeginLogin)

	resp, err := app.Test(req, 3000)
	if err != nil {
		t.Fatal(err)
	}

	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("expected 400 (no credentials), got %d", resp.StatusCode)
	}
}

func TestWebAuthnBeginLogin_EmptyBody(t *testing.T) {
	t.Setenv("WEBAUTHN_RP_ID", "localhost")
	t.Setenv("WEBAUTHN_RP_ORIGIN", "http://localhost:4200")

	app, h, _ := setupTestApp(t)
	app.Post("/webauthn/begin-login", h.WebAuthnBeginLogin)

	req := httptest.NewRequest("POST", "/webauthn/begin-login", nil)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, 3000)
	if err != nil {
		t.Fatal(err)
	}

	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestWebAuthnRemoveCredential_NotFound(t *testing.T) {
	t.Setenv("WEBAUTHN_RP_ID", "localhost")
	t.Setenv("WEBAUTHN_RP_ORIGIN", "http://localhost:4200")

	app, h, testUserID := setupTestApp(t)
	wa := app.Group("/webauthn")
	wa.Use(AuthRequired)
	wa.Delete("/credentials/:id", h.WebAuthnRemoveCredential)

	req := httptest.NewRequest("DELETE", "/webauthn/credentials/999", nil)
	req.Header.Set("Authorization", bearerToken(t, testUserID, false))
	resp, err := app.Test(req, 3000)
	if err != nil {
		t.Fatal(err)
	}

	if resp.StatusCode != fiber.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}
