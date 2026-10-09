package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strconv"
	"testing"
	"time"

	"my-chat-backend/database"
)

// Cover for the bugs reported on 2026-10-09, as far as the backend owns them.

// Bug #35: the author did not see their own sticker.
//
// The client renders a sticker bubble from sticker_url and its optimistic copy
// only ever held the sticker id in `content`; its own WS frame is discarded
// client-side as an echo. So the response has to carry the resolved URL - the
// sender has no other way to learn it.
func TestSendGroupMessage_ReturnsStickerURLToAuthor(t *testing.T) {
	app, _, userID := setupTestApp(t)

	mustExec(t, database.DB, "INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Test Group", userID)
	mustExec(t, database.DB, "INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)
	res, err := database.DB.Exec("INSERT INTO sticker_packs (name) VALUES ('Pack')")
	if err != nil {
		t.Fatal(err)
	}
	packID, _ := res.LastInsertId()
	res, err = database.DB.Exec("INSERT INTO stickers (pack_id, image_url, sort_order) VALUES (?, ?, 0)", packID, "/uploads/stickers/7.png")
	if err != nil {
		t.Fatal(err)
	}
	stickerID, _ := res.LastInsertId()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("group_chat_id", "1")
	w.WriteField("content", strconv.FormatInt(stickerID, 10))
	// The form field is "type"; "msg_type" is what the JSON uses. Sending the
	// wrong name silently falls back to a text message.
	w.WriteField("type", "sticker")
	w.Close()

	req, _ := http.NewRequest("POST", "/group-chat-messages", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		body := new(bytes.Buffer)
		body.ReadFrom(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, body.String())
	}

	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out["sticker_url"] != "/uploads/stickers/7.png" {
		t.Errorf("sticker_url = %v, want /uploads/stickers/7.png (the sender cannot learn it any other way)", out["sticker_url"])
	}
}

func TestSendMessage_ReturnsStickerURLToAuthor(t *testing.T) {
	app, _, userID := setupTestApp(t)

	res, err := database.DB.Exec("INSERT INTO sticker_packs (name) VALUES ('Pack')")
	if err != nil {
		t.Fatal(err)
	}
	packID, _ := res.LastInsertId()
	res, err = database.DB.Exec("INSERT INTO stickers (pack_id, image_url, sort_order) VALUES (?, ?, 0)", packID, "/uploads/stickers/9.png")
	if err != nil {
		t.Fatal(err)
	}
	stickerID, _ := res.LastInsertId()

	// A real recipient: friends.user_id/user_id have foreign keys, and the
	// handler checks the friendship.
	res, err = database.DB.Exec("INSERT INTO users (username, email, password) VALUES ('peer', 'p@x.com', 'x')")
	if err != nil {
		t.Fatal(err)
	}
	peerID, _ := res.LastInsertId()
	mustExec(t, database.DB, "INSERT INTO friends (user_id, friend_id) VALUES (?, ?)", userID, peerID)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("to_user_id", strconv.FormatInt(peerID, 10))
	w.WriteField("content", strconv.FormatInt(stickerID, 10))
	w.WriteField("type", "sticker")
	w.Close()

	req, _ := http.NewRequest("POST", "/messages", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		body := new(bytes.Buffer)
		body.ReadFrom(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, body.String())
	}

	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out["sticker_url"] != "/uploads/stickers/9.png" {
		t.Errorf("sticker_url = %v, want /uploads/stickers/9.png", out["sticker_url"])
	}
}

// A non-sticker message must not grow a sticker_url key - the field is written
// from the same variable the sticker lookup fills.
func TestSendGroupMessage_NoStickerURLForText(t *testing.T) {
	app, _, userID := setupTestApp(t)

	mustExec(t, database.DB, "INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Test Group", userID)
	mustExec(t, database.DB, "INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("group_chat_id", "1")
	w.WriteField("content", "привет")
	w.WriteField("type", "text")
	w.Close()

	req, _ := http.NewRequest("POST", "/group-chat-messages", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}

	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if _, ok := out["sticker_url"]; ok {
		t.Errorf("sticker_url present on a text message: %v", out["sticker_url"])
	}
}

// Bug #37: the author got a push for their own group message.
//
// The group broadcast looped over every member including the sender, and fell
// back to a push whenever a WS write failed - which happens to the author too
// (several tabs open, a socket that reconnects a moment later, a write error).
// Direct chats already skipped them; groups did not.
//
// Push is asserted through push_logs, because sendPushNotification records
// there on every path. A subscription row is inserted for both users so the
// "has_subs" bookkeeping cannot hide the difference.
func TestGroupBroadcastGroup_NoPushToAuthor(t *testing.T) {
	_, h, userID := setupTestApp(t)

	mustExec(t, database.DB, "INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "G", userID)
	mustExec(t, database.DB, "INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)
	res, err := database.DB.Exec("INSERT INTO users (username, email, password) VALUES ('member', 'm@x.com', 'x')")
	if err != nil {
		t.Fatal(err)
	}
	memberID, _ := res.LastInsertId()
	mustExec(t, database.DB, "INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, memberID)

	for _, uid := range []int64{userID, memberID} {
		mustExec(t, database.DB,
			"INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)",
			uid, "https://example.invalid/push/"+strconv.FormatInt(uid, 10), "p", "a")
	}

	// The author is the only connected client here, so their WS write succeeds;
	// the member is offline and must get a push. Neither has an open socket at
	// the moment the hub processes this, which is the case that used to notify
	// both.
	h.broadcastGroup <- wsMessage{
		messageID:  1,
		groupID:    1,
		from:       userID,
		fromName:   "author",
		content:    "привет всем",
		msgType:    "text",
		createdAt:  time.Now().Format(time.RFC3339),
		pushPreview: "привет всем",
	}

	// The hub goroutine picks this up asynchronously; wait for the member's
	// push to land rather than sleeping a fixed amount.
	waitFor := func(uid int64) int {
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			var n int
			database.DB.QueryRow(
				"SELECT COUNT(*) FROM push_logs WHERE user_id = ? AND kind IN ('send','error','no_subscription')", uid,
			).Scan(&n)
			if n > 0 {
				return n
			}
			time.Sleep(20 * time.Millisecond)
		}
		return 0
	}

	if waitFor(memberID) == 0 {
		t.Fatal("the offline member should have received a push")
	}

	var authorPushes int
	database.DB.QueryRow(
		"SELECT COUNT(*) FROM push_logs WHERE user_id = ? AND kind IN ('send','error','no_subscription')", userID,
	).Scan(&authorPushes)
	if authorPushes != 0 {
		t.Errorf("author received %d push log entries for their own message, want 0", authorPushes)
	}
}