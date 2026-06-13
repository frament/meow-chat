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
