package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"my-chat-backend/database"
)

// setGiphyKey stores a key the way the admin route does, so the tests exercise
// the same path production reads.
func setGiphyKey(t *testing.T, key string) {
	t.Helper()
	if _, err := database.DB.Exec(
		"INSERT INTO server_settings (key, value) VALUES ('giphy_api_key', ?) "+
			"ON CONFLICT(key) DO UPDATE SET value=excluded.value", key,
	); err != nil {
		t.Fatalf("set giphy key: %v", err)
	}
}

// stubGiphy points the handler at a local server for the duration of one test
// and restores the real base afterwards.
func stubGiphy(t *testing.T, body string) *int {
	t.Helper()
	hits := new(int)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*hits++
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	prev := giphyAPIBase
	giphyAPIBase = srv.URL
	t.Cleanup(func() { giphyAPIBase = prev })
	return hits
}

const giphyFixture = `{"data":[{"id":"abc","images":{
	"original":{"url":"https://media/abc.gif","width":"100","height":"80"},
	"preview_gif":{"url":"https://media/abc-preview.gif"}}}]}`

func TestSearchGiphy_RequiresKey(t *testing.T) {
	app, _, userID := setupTestApp(t)
	setGiphyKey(t, "")

	resp, body := doRequest(t, app, jsonRequest(t, "GET", "/giphy/search?q=cats", "", userID, false))
	if resp.StatusCode != 400 {
		t.Fatalf("expected 400 with no key configured, got %d", resp.StatusCode)
	}
	if body["error"] != "Giphy API key not configured" {
		t.Errorf("expected the not-configured error, got %#v", body["error"])
	}
}

func TestTrendingGiphy_RequiresKey(t *testing.T) {
	app, _, userID := setupTestApp(t)
	setGiphyKey(t, "")

	resp, _ := doRequest(t, app, jsonRequest(t, "GET", "/giphy/trending", "", userID, false))
	if resp.StatusCode != 400 {
		t.Fatalf("expected 400 with no key configured, got %d", resp.StatusCode)
	}
}

// The proxy is tested against a stub, and the assertion is on the mapping, not
// on the transport: a handler that returned the raw body would pass a "status
// 200" check while the client got fields it cannot read.
func TestSearchGiphy_MapsResults(t *testing.T) {
	app, _, userID := setupTestApp(t)
	setGiphyKey(t, "test-key")
	hits := stubGiphy(t, giphyFixture)

	resp, body := doRequest(t, app, jsonRequest(t, "GET", "/giphy/search?q=cats&limit=5", "", userID, false))
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d (%#v)", resp.StatusCode, body)
	}
	if *hits != 1 {
		t.Errorf("expected one call to the upstream, got %d", *hits)
	}

	results, ok := body["results"].([]any)
	if !ok || len(results) != 1 {
		t.Fatalf("expected one mapped result, got %#v", body["results"])
	}
	first, _ := results[0].(map[string]any)
	if first["url"] != "https://media/abc.gif" {
		t.Errorf("expected the original url to be mapped, got %#v", first["url"])
	}
	if first["preview_url"] != "https://media/abc-preview.gif" {
		t.Errorf("expected the preview url to be mapped, got %#v", first["preview_url"])
	}
}

func TestTrendingGiphy_MapsResults(t *testing.T) {
	app, _, userID := setupTestApp(t)
	setGiphyKey(t, "test-key")
	stubGiphy(t, giphyFixture)

	resp, body := doRequest(t, app, jsonRequest(t, "GET", "/giphy/trending", "", userID, false))
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d (%#v)", resp.StatusCode, body)
	}
	if results, _ := body["results"].([]any); len(results) != 1 {
		t.Errorf("expected one mapped result, got %#v", body["results"])
	}
}

// A Giphy outage is not a client error, and the status the handler picks is the
// contract the app shows to the user.
func TestSearchGiphy_UpstreamFailureIs502(t *testing.T) {
	app, _, userID := setupTestApp(t)
	setGiphyKey(t, "test-key")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte("nope"))
	}))
	defer srv.Close()
	prev := giphyAPIBase
	giphyAPIBase = srv.URL
	defer func() { giphyAPIBase = prev }()

	resp, body := doRequest(t, app, jsonRequest(t, "GET", "/giphy/search?q=cats", "", userID, false))
	if resp.StatusCode != 502 {
		t.Errorf("expected 502 when Giphy answers with garbage, got %d (%#v)", resp.StatusCode, body)
	}
}

// ---------------------------------------------------------------- admin key

func TestGiphyKey_AdminGetAndUpdate(t *testing.T) {
	app, _, userID := setupTestApp(t)

	resp, body := doRequest(t, app, jsonRequest(t, "GET", "/admin/settings/giphy-key", "", userID, true))
	if resp.StatusCode != 200 {
		t.Fatalf("get key: expected 200, got %d", resp.StatusCode)
	}
	if _, ok := body["has_key"]; !ok {
		t.Errorf("expected has_key in the answer, got %#v", body)
	}

	if resp, body = doRequest(t, app, jsonRequest(t, "PUT", "/admin/settings/giphy-key", `{"key":"abc123"}`, userID, true)); resp.StatusCode != 200 {
		t.Fatalf("set key: expected 200, got %d (%#v)", resp.StatusCode, body)
	}

	var stored string
	if err := database.DB.QueryRow("SELECT value FROM server_settings WHERE key='giphy_api_key'").Scan(&stored); err != nil {
		t.Fatalf("read stored key: %v", err)
	}
	if stored != "abc123" {
		t.Errorf("expected the key to be stored, got %q", stored)
	}

	// The status endpoint is the user-facing one, and it must agree.
	var statusBody map[string]any
	resp, statusBody = doRequest(t, app, jsonRequest(t, "GET", "/giphy/status", "", userID, false))
	if resp.StatusCode != 200 || statusBody["has_key"] != true {
		t.Errorf("expected /giphy/status to report a configured key, got %d %#v", resp.StatusCode, statusBody)
	}
}

// Only an admin may read or change the key: it is a shared secret and the
// endpoint is the one place it can be exfiltrated through the API.
func TestGiphyKey_RejectsNonAdmin(t *testing.T) {
	app, _, userID := setupTestApp(t)

	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/admin/settings/giphy-key", ""},
		{"PUT", "/admin/settings/giphy-key", `{"key":"stolen"}`},
	} {
		req := jsonRequest(t, tc.method, tc.path, tc.body, userID, false)
		resp, err := app.Test(req, -1)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Errorf("%s %s: expected 403 for a non-admin, got %d", tc.method, tc.path, resp.StatusCode)
		}
	}

	var stored *string
	_ = database.DB.QueryRow("SELECT value FROM server_settings WHERE key='giphy_api_key'").Scan(&stored)
	if stored != nil && *stored == "stolen" {
		t.Error("a non-admin changed the Giphy key")
	}
}

// ---------------------------------------------------------------- webauthn

// The finish endpoints cannot be driven end to end without a virtual
// authenticator, but everything before the ceremony is real code the app shows
// errors from: a missing body, and a session that was never started or already
// used. Those are the paths a client hits on a retry, and neither had a test.
func TestWebAuthnFinish_RejectsBadRequests(t *testing.T) {
	app, _, userID := setupTestApp(t)

	for _, tc := range []struct {
		name, path, body, want string
	}{
		{"login without body", "/webauthn/finish-login", `{}`, "Invalid request"},
		{"login with unknown session", "/webauthn/finish-login", `{"session_id":"never-existed","credential":{"id":"x"}}`, "Session expired or invalid"},
		{"registration without body", "/webauthn/finish-registration", `{}`, "Invalid request"},
		{"registration with unknown session", "/webauthn/finish-registration", `{"session_id":"never-existed","credential":{"id":"x"}}`, "Session expired or invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp, body := doRequest(t, app, jsonRequest(t, "POST", tc.path, tc.body, userID, false))
			if resp.StatusCode != 400 {
				t.Fatalf("expected 400, got %d (%#v)", resp.StatusCode, body)
			}
			if body["error"] != tc.want {
				t.Errorf("expected %q, got %#v", tc.want, body["error"])
			}
		})
	}
}
