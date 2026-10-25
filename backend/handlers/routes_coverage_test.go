package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"my-chat-backend/auth"
	"my-chat-backend/database"

	"github.com/gofiber/fiber/v2"
)

// These cover routes that had no harness registration at all, so no test for
// them could exist even in principle. Each one goes through the HTTP route that
// main.go serves rather than calling the handler directly, because the contract
// a client depends on is the method, the path and the status - and 16 tests in
// this package were found exercising paths production does not serve.

// jsonRequest builds a request with a JSON body and an auth token.
func jsonRequest(t *testing.T, method, path, body string, userID int64, admin bool) *http.Request {
	t.Helper()
	req, err := http.NewRequest(method, path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", bearerToken(t, userID, admin))
	return req
}

func doRequest(t *testing.T, app *fiber.App, req *http.Request) (*http.Response, map[string]any) {
	t.Helper()
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var decoded map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&decoded)
	return resp, decoded
}

// ---------------------------------------------------------------- pinned

func TestPinUnpinAndList(t *testing.T) {
	app, h, userID := setupTestApp(t)
	_ = h

	// A second user to pin.
	res, err := database.DB.Exec("INSERT INTO users (username, email, password) VALUES ('other', 'o@e.ml', 'x')")
	if err != nil {
		t.Fatal(err)
	}
	otherID, _ := res.LastInsertId()

	// Empty to begin with, and the shape of the answer matters: the client
	// reads pinned_user_ids and nothing else.
	resp, body := doRequest(t, app, jsonRequest(t, "GET", "/pinned", "", userID, false))
	if resp.StatusCode != 200 {
		t.Fatalf("list: expected 200, got %d", resp.StatusCode)
	}
	if ids, ok := body["pinned_user_ids"].([]any); !ok || len(ids) != 0 {
		t.Fatalf("expected an empty pinned_user_ids array, got %#v", body["pinned_user_ids"])
	}

	if resp, _ := doRequest(t, app, jsonRequest(t, "POST", "/pin/"+itoa(otherID), "", userID, false)); resp.StatusCode != 200 {
		t.Fatalf("pin: expected 200, got %d", resp.StatusCode)
	}

	var pinned int
	database.DB.QueryRow("SELECT COUNT(*) FROM pinned_users WHERE user_id=? AND pinned_user_id=?", userID, otherID).Scan(&pinned)
	if pinned != 1 {
		t.Errorf("expected the pin row to exist, got %d", pinned)
	}

	// Pinning twice is a no-op rather than an error: INSERT OR IGNORE, and the
	// client re-sends on a retry.
	if resp, _ := doRequest(t, app, jsonRequest(t, "POST", "/pin/"+itoa(otherID), "", userID, false)); resp.StatusCode != 200 {
		t.Errorf("pinning twice should stay 200, got %d", resp.StatusCode)
	}
	database.DB.QueryRow("SELECT COUNT(*) FROM pinned_users WHERE user_id=? AND pinned_user_id=?", userID, otherID).Scan(&pinned)
	if pinned != 1 {
		t.Errorf("pinning twice must not duplicate the row, got %d", pinned)
	}

	_, body = doRequest(t, app, jsonRequest(t, "GET", "/pinned", "", userID, false))
	ids, _ := body["pinned_user_ids"].([]any)
	if len(ids) != 1 {
		t.Fatalf("expected one pinned id, got %#v", body["pinned_user_ids"])
	}

	if resp, _ := doRequest(t, app, jsonRequest(t, "DELETE", "/pin/"+itoa(otherID), "", userID, false)); resp.StatusCode != 200 {
		t.Fatalf("unpin: expected 200, got %d", resp.StatusCode)
	}
	database.DB.QueryRow("SELECT COUNT(*) FROM pinned_users WHERE user_id=? AND pinned_user_id=?", userID, otherID).Scan(&pinned)
	if pinned != 0 {
		t.Errorf("expected the pin to be gone, got %d rows", pinned)
	}
}

// Pinning yourself is a client bug, and the handler says so rather than storing
// a row that means nothing.
func TestPinUser_RejectsSelfPin(t *testing.T) {
	app, _, userID := setupTestApp(t)

	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/pin/"+itoa(userID), "", userID, false))
	if resp.StatusCode != 400 {
		t.Errorf("expected 400 pinning yourself, got %d", resp.StatusCode)
	}
	if body["error"] != "Cannot pin yourself" {
		t.Errorf("expected the self-pin error, got %#v", body["error"])
	}

	var n int
	database.DB.QueryRow("SELECT COUNT(*) FROM pinned_users WHERE pinned_user_id=?", userID).Scan(&n)
	if n != 0 {
		t.Errorf("self-pin must not be stored, got %d rows", n)
	}
}

// ---------------------------------------------------------------- invites

func TestCreateCheckDeleteInvite(t *testing.T) {
	app, _, userID := setupTestApp(t)

	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/invites", `{"max_uses":3}`, userID, false))
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		t.Fatalf("create invite: expected 200/201, got %d", resp.StatusCode)
	}
	token, _ := body["token"].(string)
	if token == "" {
		t.Fatalf("create invite returned no token: %#v", body)
	}

	// The token is stored, and max_uses survived the round trip.
	var maxUses, useCount int
	if err := database.DB.QueryRow(
		"SELECT max_uses, use_count FROM invite_tokens WHERE token=?", token,
	).Scan(&maxUses, &useCount); err != nil {
		t.Fatalf("invite row: %v", err)
	}
	if maxUses != 3 || useCount != 0 {
		t.Errorf("expected max_uses=3 use_count=0, got %d/%d", maxUses, useCount)
	}

	// Checking an invite does not need a session: the link is opened by someone
	// who has not registered yet.
	resp, body = doRequest(t, app, jsonRequest(t, "GET", "/invite/"+token, "", userID, false))
	if resp.StatusCode != 200 {
		t.Fatalf("check invite: expected 200, got %d", resp.StatusCode)
	}
	if valid, _ := body["valid"].(bool); !valid {
		t.Errorf("expected the fresh invite to be valid, got %#v", body)
	}

	if resp, body = doRequest(t, app, jsonRequest(t, "GET", "/invite/does-not-exist", "", userID, false)); resp.StatusCode != 404 {
		t.Errorf("expected 404 for an unknown invite, got %d (%#v)", resp.StatusCode, body)
	}

	var inviteID int64
	database.DB.QueryRow("SELECT id FROM invite_tokens WHERE token=?", token).Scan(&inviteID)

	if resp, _ = doRequest(t, app, jsonRequest(t, "DELETE", "/invites/"+itoa(inviteID), "", userID, false)); resp.StatusCode != 200 {
		t.Fatalf("delete invite: expected 200, got %d", resp.StatusCode)
	}
	var left int
	database.DB.QueryRow("SELECT COUNT(*) FROM invite_tokens WHERE token=?", token).Scan(&left)
	if left != 0 {
		t.Errorf("expected the invite to be gone, got %d rows", left)
	}
}

// Someone else's invite is not yours to delete, and the handler says 404 rather
// than 403 - the row is not observable to you at all.
func TestDeleteInvite_CannotDeleteAnotherUsersInvite(t *testing.T) {
	app, _, userID := setupTestApp(t)

	res, err := database.DB.Exec("INSERT INTO users (username, email, password) VALUES ('stranger', 's@e.ml', 'x')")
	if err != nil {
		t.Fatal(err)
	}
	strangerID, _ := res.LastInsertId()
	if _, err := database.DB.Exec(
		"INSERT INTO invite_tokens (token, created_by, max_uses) VALUES ('stranger-token', ?, 1)", strangerID,
	); err != nil {
		t.Fatal(err)
	}

	var id int64
	database.DB.QueryRow("SELECT id FROM invite_tokens WHERE token='stranger-token'").Scan(&id)

	if resp, _ := doRequest(t, app, jsonRequest(t, "DELETE", "/invites/"+itoa(id), "", userID, false)); resp.StatusCode != 404 {
		t.Fatalf("expected 404 deleting another user's invite, got %d", resp.StatusCode)
	}
	var left int
	database.DB.QueryRow("SELECT COUNT(*) FROM invite_tokens WHERE token='stranger-token'").Scan(&left)
	if left != 1 {
		t.Error("another user's invite was deleted")
	}
}

func TestCreateCheckAcceptFriendInvite(t *testing.T) {
	app, _, userID := setupTestApp(t)

	resp, body := doRequest(t, app, jsonRequest(t, "POST", "/friend-invites", "", userID, false))
	if resp.StatusCode != 201 {
		t.Fatalf("create friend invite: expected 201, got %d", resp.StatusCode)
	}
	token, _ := body["token"].(string)
	if token == "" {
		t.Fatalf("no token in %#v", body)
	}

	if resp, body = doRequest(t, app, jsonRequest(t, "GET", "/friend-invite/"+token, "", userID, false)); resp.StatusCode != 200 {
		t.Fatalf("check friend invite: expected 200, got %d (%#v)", resp.StatusCode, body)
	}
	if resp, _ = doRequest(t, app, jsonRequest(t, "GET", "/friend-invite/nope", "", userID, false)); resp.StatusCode != 404 {
		t.Errorf("expected 404 for an unknown friend invite, got %d", resp.StatusCode)
	}

	// Accept from a second account: the friendship is what the invite produces.
	res, err := database.DB.Exec("INSERT INTO users (username, email, password) VALUES ('friend', 'f@e.ml', 'x')")
	if err != nil {
		t.Fatal(err)
	}
	friendID, _ := res.LastInsertId()

	if resp, body = doRequest(t, app, jsonRequest(t, "POST", "/friend-invite/"+token+"/accept", "", friendID, false)); resp.StatusCode != 200 {
		t.Fatalf("accept friend invite: expected 200, got %d (%#v)", resp.StatusCode, body)
	}

	lo, hi := userID, friendID
	if lo > hi {
		lo, hi = hi, lo
	}
	var friends int
	database.DB.QueryRow("SELECT COUNT(*) FROM friends WHERE user_id=? AND friend_id=?", lo, hi).Scan(&friends)
	if friends != 1 {
		t.Errorf("expected the friendship row to exist, got %d", friends)
	}
}

func TestRemoveFriend(t *testing.T) {
	app, _, userID := setupTestApp(t)

	res, err := database.DB.Exec("INSERT INTO users (username, email, password) VALUES ('pal', 'p@e.ml', 'x')")
	if err != nil {
		t.Fatal(err)
	}
	palID, _ := res.LastInsertId()

	lo, hi := userID, palID
	if lo > hi {
		lo, hi = hi, lo
	}
	// The friends table stores a pair once, ordered by CHECK (user_id <
	// friend_id): the delete has to compute the same ordering rather than assume
	// the row is stored the way the caller thinks of the relationship.
	if _, err := database.DB.Exec("INSERT INTO friends (user_id, friend_id) VALUES (?, ?)", lo, hi); err != nil {
		t.Fatal(err)
	}

	if resp, _ := doRequest(t, app, jsonRequest(t, "DELETE", "/friends/"+itoa(palID), "", userID, false)); resp.StatusCode != 200 {
		t.Fatalf("remove friend: expected 200, got %d", resp.StatusCode)
	}

	var left int
	database.DB.QueryRow("SELECT COUNT(*) FROM friends WHERE user_id=? AND friend_id=?", lo, hi).Scan(&left)
	if left != 0 {
		t.Errorf("expected the friendship gone, got %d rows", left)
	}
}

// ---------------------------------------------------------------- keys

func TestPutAndGetKey(t *testing.T) {
	app, _, userID := setupTestApp(t)

	if resp, body := doRequest(t, app, jsonRequest(t, "PUT", "/keys", `{"public_key":"pk-1"}`, userID, false)); resp.StatusCode != 200 {
		t.Fatalf("put key: expected 200, got %d (%#v)", resp.StatusCode, body)
	}

	resp, body := doRequest(t, app, jsonRequest(t, "GET", "/keys/"+itoa(userID), "", userID, false))
	if resp.StatusCode != 200 {
		t.Fatalf("get key: expected 200, got %d", resp.StatusCode)
	}
	if body["public_key"] != "pk-1" {
		t.Errorf("expected pk-1, got %#v", body["public_key"])
	}

	// A second PUT with a different key is refused, not applied: the account key
	// is created once. Replacing it silently is what orphaned a window of real
	// messages on prod - every message encrypted to the previous key became
	// unreadable on both sides. Rotation has to be explicit.
	if resp, _ := doRequest(t, app, jsonRequest(t, "PUT", "/keys", `{"public_key":"pk-2"}`, userID, false)); resp.StatusCode != 409 {
		t.Fatalf("replace key: expected 409, got %d", resp.StatusCode)
	}
	_, body = doRequest(t, app, jsonRequest(t, "GET", "/keys/"+itoa(userID), "", userID, false))
	if body["public_key"] != "pk-1" {
		t.Errorf("the account key must stay untouched, got %#v", body["public_key"])
	}

	if resp, _ := doRequest(t, app, jsonRequest(t, "GET", "/keys/99999", "", userID, false)); resp.StatusCode != 404 {
		t.Errorf("expected 404 for a user with no key, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------- session

// Logging out drops every refresh token for the account, not just the one the
// caller used: a logout that leaves a sibling device able to refresh has not
// logged anybody out.
func TestLogout_RevokesRefreshTokens(t *testing.T) {
	app, _, userID := setupTestApp(t)

	for _, id := range []string{"tok-a", "tok-b"} {
		if _, err := database.DB.Exec(
			"INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))",
			userID, id,
		); err != nil {
			t.Fatal(err)
		}
	}

	if resp, _ := doRequest(t, app, jsonRequest(t, "POST", "/logout", "", userID, false)); resp.StatusCode != 200 {
		t.Fatalf("logout: expected 200, got %d", resp.StatusCode)
	}

	var left int
	database.DB.QueryRow("SELECT COUNT(*) FROM refresh_tokens WHERE user_id=?", userID).Scan(&left)
	if left != 0 {
		t.Errorf("expected every refresh token gone, %d left", left)
	}
}

// GoOffline's effect is that the user's sockets are closed, and that is only
// observable with a live connection: the handler itself only signals the hub,
// so asserting 200 would prove nothing. The hub runs in these fixtures and
// consumes the signal before a test could, which is what the first version of
// this test discovered the hard way.
// WSHealth reports the hub's counters. The assertion that means something is
// that a live connection moves the counter: a handler that returned a constant
// map would pass a shape-only check.
func TestWSHealth_ReportsLiveCounters(t *testing.T) {
	h, userID, baseURL := setupWSTest(t)

	conn := wsDialDrain(t, baseURL, userID, false)
	defer conn.Close()

	waitFor(t, func() bool { return h.activeConnsFor(userID) > 0 })

	httpBase := strings.Replace(baseURL, "ws://", "http://", 1)
	resp, err := http.Get(httpBase + "/ws-health")
	if err != nil {
		t.Fatalf("ws-health: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode ws-health: %v", err)
	}

	connections, _ := body["connections"].(float64)
	if connections < 1 {
		t.Errorf("expected at least one connection reported, got %#v", body["connections"])
	}
	if maxPerUser, _ := body["max_per_user"].(float64); int(maxPerUser) != h.MaxConnsPerUser {
		t.Errorf("expected max_per_user %d, got %#v", h.MaxConnsPerUser, body["max_per_user"])
	}
}

func TestGoOffline_ClosesSockets(t *testing.T) {
	h, userID, baseURL := setupWSTest(t)

	conn := wsDialDrain(t, baseURL, userID, false)
	defer conn.Close()

	// The hub registers connections on its own goroutine, so the dial returning
	// does not mean the socket is counted yet.
	waitFor(t, func() bool { return h.activeConnsFor(userID) > 0 })
	if h.activeConnsFor(userID) == 0 {
		t.Fatal("the dial returned but the hub never registered the socket")
	}

	token, err := auth.GenerateAccessToken(userID, false)
	if err != nil {
		t.Fatal(err)
	}
	httpBase := strings.Replace(baseURL, "ws://", "http://", 1)
	req, _ := http.NewRequest("POST", httpBase+"/offline", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("offline request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	// The connection count is the observable that does not depend on how the
	// client library reports a closed socket. Reading for the close was tried
	// first and produced a test that passed with the signal removed: a read
	// deadline marks the connection failed, and the next read panics, which
	// looked exactly like a clean close.
	waitFor(t, func() bool { return h.activeConnsFor(userID) == 0 })
	if n := h.activeConnsFor(userID); n != 0 {
		t.Errorf("the socket stayed open after the user asked to go offline: %d still active", n)
	}
}
