package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"my-chat-backend/database"
)

// Push timestamps cross timezones before anyone reads them: the writer is the
// server, the reader is a phone in another zone, and the person comparing the
// two is usually reading the admin panel. So this is worth pinning down rather
// than assuming.
//
// The invariant, verified here rather than reasoned about: mattn/go-sqlite3
// converts the DATETIME column to time.Time, and scanning that into the
// adminPushLog.CreatedAt string yields RFC3339 **with the Z**. Angular's date
// pipe reads `2026-10-11T06:44:40Z` as UTC and renders it in the viewer's own
// zone, which is correct. Scanning into a raw string field gets you the same
// thing, because the driver does the conversion, not the query.
//
// This test exists because I "fixed" a timezone bug here that did not exist.
// The change re-parsed the value with the layout "2006-01-02 15:04:05" while
// the driver had already handed over "2026-10-11T06:44:40Z", every row failed
// to parse, and the admin panel returned an empty list. TestAdminPushEndpoints
// caught it - an existing test in this package - and this file is what makes
// the guarantee explicit rather than incidental.
func TestAdminPushLogs_CreatedAtIsZoned(t *testing.T) {
	app, _, userID := setupTestApp(t)

	// Inserted the way the app writes it: CURRENT_TIMESTAMP, which is UTC.
	if _, err := database.DB.Exec(
		"INSERT INTO push_logs (user_id, source, kind, title, status) VALUES (?, 'server', 'send', 'marker', '201')",
		userID,
	); err != nil {
		t.Fatalf("вставка в push_logs: %v", err)
	}

	req, _ := http.NewRequest("GET", "/admin/push/logs?limit=50", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("ожидался 200, получено %d", resp.StatusCode)
	}

	var logs []struct {
		Title     string `json:"title"`
		CreatedAt string `json:"created_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&logs); err != nil {
		t.Fatal(err)
	}

	var got string
	for _, l := range logs {
		if l.Title == "marker" {
			got = l.CreatedAt
			break
		}
	}
	if got == "" {
		t.Fatalf("записи с title=marker нет в ответе (строк: %d)", len(logs))
	}

	// A zone marker is the whole point: without it the browser reads the value
	// as local time and every row shifts by the reader's offset.
	if !strings.HasSuffix(got, "Z") {
		t.Errorf("created_at=%q без метки UTC — date pipe прочитает это как местное время", got)
	}
	if len(got) < 20 || got[10] != 'T' {
		t.Errorf("created_at=%q не похоже на RFC3339, ожидалось 2026-10-11T06:44:40Z", got)
	}
}

// The row must actually reach the client. The bad version of this handler parsed
// with the wrong layout, dropped every row on the floor, and returned `[]` -
// which is what made the mistake obvious in the first place.
func TestAdminPushLogs_RowsActuallyReachTheClient(t *testing.T) {
	app, _, userID := setupTestApp(t)

	for i, title := range []string{"one", "two", "three"} {
		if _, err := database.DB.Exec(
			"INSERT INTO push_logs (user_id, source, kind, title, status) VALUES (?, 'server', 'send', ?, '201')",
			userID, title,
		); err != nil {
			t.Fatalf("вставка %d: %v", i, err)
		}
	}

	req, _ := http.NewRequest("GET", "/admin/push/logs?limit=50", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}

	var logs []struct {
		Title     string `json:"title"`
		CreatedAt string `json:"created_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&logs); err != nil {
		t.Fatal(err)
	}

	if len(logs) != 3 {
		t.Fatalf("ожидались 3 строки, получено %d - эндпоинт их теряет", len(logs))
	}
	for _, l := range logs {
		if l.CreatedAt == "" {
			t.Errorf("у записи %q пустое created_at", l.Title)
		}
	}
}