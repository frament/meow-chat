package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"my-chat-backend/database"
	"my-chat-backend/federation"
)

// withFedTransport installs a transport for the duration of a test. The admin
// federation routes were unreachable from tests because nothing initialised the
// package globals, so any call that touched the network answered 502 from a nil
// pointer rather than doing its job.
func withFedTransport(t *testing.T) {
	t.Helper()
	prevTransport, prevHealth := fedTransport, fedHealth
	fedTransport = federation.NewTransport()
	// Without a health checker the ping route silently does nothing - it guards
	// on `fedHealth != nil` - so a test that left it nil would assert on a
	// button that was never pressed.
	fedHealth = federation.NewHealthChecker(fedTransport, federation.NewQueue(fedTransport))
	t.Cleanup(func() { fedTransport, fedHealth = prevTransport, prevHealth })
}

func TestAdminPingFederationServer_ReportsStoredStatus(t *testing.T) {
	app, _, adminID := setupTestApp(t)

	res, err := database.DB.Exec(
		"INSERT INTO federation_servers (name, base_url, server_token, status) VALUES ('peer', 'http://127.0.0.1:1', 'tok', 'unreachable')",
	)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()

	resp, body := doRequest(t, app, jsonRequest(t, "POST", fmt.Sprintf("/admin/federation/servers/%d/ping", id), "", adminID, true))
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d (%#v)", resp.StatusCode, body)
	}
	if body["status"] != "unreachable" {
		t.Errorf("expected the stored status to be reported, got %#v", body["status"])
	}

	if resp, _ := doRequest(t, app, jsonRequest(t, "POST", "/admin/federation/servers/not-a-number/ping", "", adminID, true)); resp.StatusCode != 400 {
		t.Errorf("expected 400 for a malformed id, got %d", resp.StatusCode)
	}
}

// A ping that actually reaches a peer flips it to active - that is the whole
// point of the button, and a test that only reads the stored status back would
// pass with the ping removed entirely.
func TestAdminPingFederationServer_ReachesPeer(t *testing.T) {
	app, _, adminID := setupTestApp(t)
	withFedTransport(t)

	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "HEAD" && r.Method != "POST" {
			t.Errorf("unexpected method %s for a ping", r.Method)
		}
		w.WriteHeader(200)
	}))
	defer peer.Close()

	res, err := database.DB.Exec(
		"INSERT INTO federation_servers (name, base_url, server_token, status) VALUES ('peer', ?, 'tok', 'unreachable')", peer.URL,
	)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()

	if resp, _ := doRequest(t, app, jsonRequest(t, "POST", fmt.Sprintf("/admin/federation/servers/%d/ping", id), "", adminID, true)); resp.StatusCode != 200 {
		t.Fatalf("ping: expected 200, got %d", resp.StatusCode)
	}

	var status string
	if err := database.DB.QueryRow("SELECT status FROM federation_servers WHERE id = ?", id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "active" {
		t.Errorf("a reachable peer should be marked active after a ping, got %q", status)
	}
}

func TestAdminRestoreFederation_RequiresPeerURL(t *testing.T) {
	app, _, adminID := setupTestApp(t)

	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/admin/federation/restore", `{}`, adminID, true))
	if resp.StatusCode != 400 {
		t.Fatalf("expected 400 with no peer_url, got %d (%#v)", resp.StatusCode, body)
	}
	if body["error"] != "peer_url required" {
		t.Errorf("expected the peer_url error, got %#v", body["error"])
	}
}

func TestAdminRestoreFederation_AdoptsPeerIdentity(t *testing.T) {
	app, _, adminID := setupTestApp(t)
	withFedTransport(t)

	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/recover" || r.URL.Path == "/" || r.URL.Path == "" {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"server_id":4242,"server_name":"restored","base_url":"http://restored.example","new_token":"fresh-token","known_peers":[]}`)
			return
		}
		// The background sync fires immediately after the row is inserted; give
		// it an answer it can stop on rather than letting it hang.
		w.WriteHeader(404)
	}))
	defer peer.Close()

	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/admin/federation/restore",
		fmt.Sprintf(`{"peer_url":%q}`, peer.URL), adminID, true))
	if resp.StatusCode != 200 {
		t.Fatalf("restore: expected 200, got %d (%#v)", resp.StatusCode, body)
	}

	// The recovered identity must be stored with the token the peer handed out:
	// keeping the old one would restore a server nothing can talk to.
	var name, baseURL, token string
	if err := database.DB.QueryRow(
		"SELECT name, base_url, server_token FROM federation_servers ORDER BY id DESC LIMIT 1",
	).Scan(&name, &baseURL, &token); err != nil {
		t.Fatalf("read restored server: %v", err)
	}
	if name != "restored" || baseURL != "http://restored.example" || token != "fresh-token" {
		t.Errorf("expected the peer's identity to be adopted, got name=%q base=%q token=%q", name, baseURL, token)
	}
}

// Connect is the handshake the admin button drives. The interesting part is not
// that it stores a row but how it reads the peer's answer: 404 and 410 mean the
// invite is dead, 409 means already connected, a schema-MAJOR mismatch means the
// two servers cannot talk. Each has its own message, and all of them were
// unreachable from tests before.
func TestAdminConnectFederation_ValidatesInviteURL(t *testing.T) {
	app, _, adminID := setupTestApp(t)

	for _, tc := range []struct{ body, want string }{
		{`{}`, "invite_url required"},
		{`{"invite_url":"http://peer.example/join"}`, "No token in invite URL"},
	} {
		resp, body := doRequest(t, app, jsonRequest(t, "POST", "/admin/federation/connect", tc.body, adminID, true))
		if resp.StatusCode != 400 {
			t.Errorf("%s: expected 400, got %d (%#v)", tc.body, resp.StatusCode, body)
			continue
		}
		if body["error"] != tc.want {
			t.Errorf("%s: expected %q, got %#v", tc.body, tc.want, body["error"])
		}
	}
}

func TestAdminConnectFederation_PeerAnswers(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		body       string
		wantStatus int
	}{
		{"expired invite", 410, `{}`, 400},
		{"unknown invite", 404, `{}`, 400},
		{"already connected", 409, `{}`, 409},
		{"peer refused", 500, `boom`, 502},
		{"incompatible schema", 201, `{"name":"peer","base_url":"http://peer.example","server_token":"t","major":99}`, 409},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, _, adminID := setupTestApp(t)
			withFedTransport(t)

			peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer peer.Close()

			resp, body := doRequest(t, app, jsonRequest(t, "POST", "/admin/federation/connect",
				fmt.Sprintf(`{"invite_url":%q}`, peer.URL+"/join?token=abc"), adminID, true))
			if resp.StatusCode != tc.wantStatus {
				t.Fatalf("expected %d, got %d (%#v)", tc.wantStatus, resp.StatusCode, body)
			}

			// Nothing may be stored when the handshake did not complete: a row
			// with a peer that refused would show as a connected server.
			var n int
			database.DB.QueryRow("SELECT COUNT(*) FROM federation_servers").Scan(&n)
			if n != 0 {
				t.Errorf("expected no server row after a failed handshake, got %d", n)
			}
		})
	}
}

func TestAdminConnectFederation_StoresPeer(t *testing.T) {
	app, _, adminID := setupTestApp(t)
	withFedTransport(t)

	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/federation/v1/join" {
			w.WriteHeader(201)
			fmt.Fprintf(w, `{"server_id":7,"name":"neighbour","base_url":%q,"server_token":"peer-token","major":%d}`,
				"http://neighbour.example", database.CurrentMajor)
			return
		}
		// The share-users follow-up is best-effort; answer it so the handler does
		// not wait on a timeout.
		w.WriteHeader(404)
	}))
	defer peer.Close()

	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/admin/federation/connect",
		fmt.Sprintf(`{"invite_url":%q}`, peer.URL+"/join?token=abc"), adminID, true))
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d (%#v)", resp.StatusCode, body)
	}

	var name, baseURL, token, status string
	if err := database.DB.QueryRow(
		"SELECT name, base_url, server_token, status FROM federation_servers ORDER BY id DESC LIMIT 1",
	).Scan(&name, &baseURL, &token, &status); err != nil {
		t.Fatalf("read connected server: %v", err)
	}
	if name != "neighbour" || baseURL != "http://neighbour.example" || token != "peer-token" || status != "active" {
		t.Errorf("unexpected stored server: name=%q base=%q token=%q status=%q", name, baseURL, token, status)
	}
}
