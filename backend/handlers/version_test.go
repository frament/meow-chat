package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"my-chat-backend/version"
)

func TestGetVersion(t *testing.T) {
	app, h, _ := setupTestApp(t)
	app.Get("/version", h.GetVersion)

	req := httptest.NewRequest("GET", "/version", nil)
	resp, _ := app.Test(req)

	var body map[string]string
	json.NewDecoder(resp.Body).Decode(&body)

	if body["version"] != version.Version {
		t.Errorf("expected %s, got %s", version.Version, body["version"])
	}
}
