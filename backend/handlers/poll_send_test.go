package handlers

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"testing"

	"my-chat-backend/database"
)

// A multipart form with arbitrary fields, including repeated ones: the poll
// options arrive as poll_options[] and the handler reads them as a slice.
func multipartFields(t *testing.T, path string, fields [][2]string, userID int64) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, f := range fields {
		if err := mw.WriteField(f[0], f[1]); err != nil {
			t.Fatal(err)
		}
	}
	mw.Close()

	req, err := http.NewRequest("POST", path, &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	return req
}

// The poll branch of SendMessage had never been executed by any test: the UI had
// no send button for polls, so nothing ever reached this code with
// type=poll. Fixing the button makes this path reachable for the first time,
// which is exactly when it is worth checking rather than assuming.
func TestSendMessage_CreatesPoll(t *testing.T) {
	app, h, userID := setupTestApp(t)
	_ = h

	res, err := database.DB.Exec("INSERT INTO users (username, email, password) VALUES ('voter', 'v@e.ml', 'x')")
	if err != nil {
		t.Fatal(err)
	}
	recipientID, _ := res.LastInsertId()

	req := multipartFields(t, "/messages", [][2]string{
		{"to_user_id", itoa(recipientID)},
		{"content", "Куда идём?"},
		{"type", "poll"},
		{"poll_options[]", "Парк"},
		{"poll_options[]", "Кино"},
		{"poll_multiple", "true"},
	}, userID)

	resp, body := doRequest(t, app, req)
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d (%#v)", resp.StatusCode, body)
	}

	// The poll row exists and keeps the question and the multiple-choice flag.
	var pollID int64
	var question string
	var multiple int
	if err := database.DB.QueryRow(
		"SELECT id, question, is_multiple_choice FROM polls ORDER BY id DESC LIMIT 1",
	).Scan(&pollID, &question, &multiple); err != nil {
		t.Fatalf("no poll row was created: %v", err)
	}
	if question != "Куда идём?" {
		t.Errorf("expected the question to be stored, got %q", question)
	}
	if multiple != 1 {
		t.Errorf("expected is_multiple_choice=1, got %d", multiple)
	}

	// Both options are there, in order. A loop that inserted only the first
	// would leave a poll a user cannot answer.
	rows, err := database.DB.Query("SELECT text FROM poll_options WHERE poll_id = ? ORDER BY id", pollID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var options []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		options = append(options, s)
	}
	if len(options) != 2 || options[0] != "Парк" || options[1] != "Кино" {
		t.Errorf("expected the two options in order, got %#v", options)
	}

	// And the poll is attached to the message that carries it, or the client
	// has a poll it cannot render next to a bubble.
	var messageID int64
	database.DB.QueryRow("SELECT message_id FROM polls WHERE id = ?", pollID).Scan(&messageID)
	if messageID == 0 {
		t.Error("the poll is not attached to any message")
	}
}
