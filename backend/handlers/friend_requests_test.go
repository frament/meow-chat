package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"my-chat-backend/database"
	"my-chat-backend/models"
)

func seedAnotherUser(t *testing.T) int64 {
	database.DB.Exec("INSERT INTO users (username, email, password) VALUES ('otheruser', 'other@test.com', 'hash')")
	var id int64
	database.DB.QueryRow("SELECT id FROM users WHERE username='otheruser'").Scan(&id)
	return id
}

func TestSearchUsers_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)
	otherID := seedAnotherUser(t)

	req, _ := http.NewRequest("GET", "/users/search?q=other", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var users []models.User
	json.NewDecoder(resp.Body).Decode(&users)
	if len(users) != 1 {
		t.Fatalf("expected 1 user, got %d", len(users))
	}
	if users[0].ID != otherID {
		t.Errorf("expected user %d, got %d", otherID, users[0].ID)
	}
	if users[0].Username != "otheruser" {
		t.Errorf("expected username 'otheruser', got '%s'", users[0].Username)
	}
}

func TestSearchUsers_ExcludesSelf(t *testing.T) {
	app, _, userID := setupTestApp(t)
	_ = seedAnotherUser(t)

	req, _ := http.NewRequest("GET", "/users/search?q=test", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var users []models.User
	json.NewDecoder(resp.Body).Decode(&users)
	for _, u := range users {
		if u.ID == userID {
			t.Errorf("search should not include the requesting user")
		}
	}
}

func TestSearchUsers_ExcludesFriends(t *testing.T) {
	app, _, userID := setupTestApp(t)
	otherID := seedAnotherUser(t)

	// Make them friends
	database.DB.Exec("INSERT INTO friends (user_id, friend_id) VALUES (?, ?)", userID, otherID)

	req, _ := http.NewRequest("GET", "/users/search?q=other", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}

	var users []models.User
	json.NewDecoder(resp.Body).Decode(&users)
	if len(users) != 0 {
		t.Errorf("expected 0 results (already friends), got %d", len(users))
	}
}

func TestSearchUsers_ShortQuery(t *testing.T) {
	app, _, userID := setupTestApp(t)
	_ = seedAnotherUser(t)

	req, _ := http.NewRequest("GET", "/users/search?q=", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400 for empty query, got %d", resp.StatusCode)
	}
}

func TestSearchUsers_RequiresAuth(t *testing.T) {
	app, _, _ := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/users/search?q=test", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestSendFriendRequest_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)
	otherID := seedAnotherUser(t)

	req, _ := http.NewRequest("POST", "/friend-requests/"+itos(otherID), nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result struct {
		Message string `json:"message"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Message != "Запрос в друзья отправлен" {
		t.Errorf("unexpected message: %s", result.Message)
	}

	// Verify DB
	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM friend_requests WHERE from_user=? AND to_user=? AND status='pending'", userID, otherID).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 pending request, got %d", count)
	}
}

func TestSendFriendRequest_Self(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("POST", "/friend-requests/"+itos(userID), nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400 for self-request, got %d", resp.StatusCode)
	}
}

func TestSendFriendRequest_AlreadyFriends(t *testing.T) {
	app, _, userID := setupTestApp(t)
	otherID := seedAnotherUser(t)
	database.DB.Exec("INSERT INTO friends (user_id, friend_id) VALUES (?, ?)", userID, otherID)

	req, _ := http.NewRequest("POST", "/friend-requests/"+itos(otherID), nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400 for already friends, got %d", resp.StatusCode)
	}
}

func TestSendFriendRequest_Duplicate(t *testing.T) {
	app, _, userID := setupTestApp(t)
	otherID := seedAnotherUser(t)

	// Send first request
	database.DB.Exec("INSERT INTO friend_requests (from_user, to_user) VALUES (?, ?)", userID, otherID)

	// Try duplicate
	req, _ := http.NewRequest("POST", "/friend-requests/"+itos(otherID), nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400 for duplicate, got %d", resp.StatusCode)
	}

	var result struct {
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Error != "Запрос уже отправлен" {
		t.Errorf("unexpected error: %s", result.Error)
	}
}

func TestSendFriendRequest_AutoAccept(t *testing.T) {
	app, _, userID := setupTestApp(t)
	otherID := seedAnotherUser(t)

	// Other user sent a pending request first
	database.DB.Exec("INSERT INTO friend_requests (from_user, to_user) VALUES (?, ?)", otherID, userID)

	// Now current user sends a request — should auto-accept
	req, _ := http.NewRequest("POST", "/friend-requests/"+itos(otherID), nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var result struct {
		Message      string `json:"message"`
		AutoAccepted bool   `json:"auto_accepted"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if !result.AutoAccepted {
		t.Errorf("expected auto_accepted=true")
	}
	if result.Message != "Вы стали друзьями!" {
		t.Errorf("unexpected message: %s", result.Message)
	}

	// Verify friendship in DB
	var friendCount int
	database.DB.QueryRow("SELECT COUNT(*) FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)", userID, otherID, otherID, userID).Scan(&friendCount)
	if friendCount != 1 {
		t.Errorf("expected 1 friend row, got %d", friendCount)
	}

	// Verify request status
	var status string
	database.DB.QueryRow("SELECT status FROM friend_requests WHERE from_user=? AND to_user=?", otherID, userID).Scan(&status)
	if status != "accepted" {
		t.Errorf("expected status 'accepted', got '%s'", status)
	}
}

func TestGetFriendRequests_Empty(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/friend-requests", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var requests []interface{}
	json.NewDecoder(resp.Body).Decode(&requests)
	if len(requests) != 0 {
		t.Errorf("expected empty list, got %d items", len(requests))
	}
}

func TestGetFriendRequests_WithPending(t *testing.T) {
	app, _, userID := setupTestApp(t)
	otherID := seedAnotherUser(t)

	database.DB.Exec("INSERT INTO friend_requests (from_user, to_user) VALUES (?, ?)", otherID, userID)

	req, _ := http.NewRequest("GET", "/friend-requests", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var requests []struct {
		ID       int64  `json:"id"`
		FromUser int64  `json:"from_user"`
		Username string `json:"username"`
		Status   string `json:"status"`
	}
	json.NewDecoder(resp.Body).Decode(&requests)
	if len(requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(requests))
	}
	if requests[0].FromUser != otherID {
		t.Errorf("expected from_user %d, got %d", otherID, requests[0].FromUser)
	}
	if requests[0].Username != "otheruser" {
		t.Errorf("expected username 'otheruser', got '%s'", requests[0].Username)
	}
	if requests[0].Status != "pending" {
		t.Errorf("expected status 'pending', got '%s'", requests[0].Status)
	}
}

func TestAcceptFriendRequest_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)
	otherID := seedAnotherUser(t)

	// Insert friend request from other to current user
	database.DB.Exec("INSERT INTO friend_requests (from_user, to_user) VALUES (?, ?)", otherID, userID)

	var reqID int64
	database.DB.QueryRow("SELECT id FROM friend_requests WHERE from_user=? AND to_user=?", otherID, userID).Scan(&reqID)

	req, _ := http.NewRequest("POST", "/friend-requests/"+itos(reqID)+"/accept", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	// Verify friendship
	var friendCount int
	database.DB.QueryRow("SELECT COUNT(*) FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)", userID, otherID, otherID, userID).Scan(&friendCount)
	if friendCount != 1 {
		t.Errorf("expected 1 friend row, got %d", friendCount)
	}

	// Verify status updated
	var status string
	database.DB.QueryRow("SELECT status FROM friend_requests WHERE id=?", reqID).Scan(&status)
	if status != "accepted" {
		t.Errorf("expected status 'accepted', got '%s'", status)
	}
}

func TestAcceptFriendRequest_NotFound(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("POST", "/friend-requests/99999/accept", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestAcceptFriendRequest_WrongUser(t *testing.T) {
	app, _, userID := setupTestApp(t)
	otherID := seedAnotherUser(t)

	// Request sent to a different user
	database.DB.Exec("INSERT INTO friend_requests (from_user, to_user) VALUES (?, ?)", otherID, otherID)
	var reqID int64
	database.DB.QueryRow("SELECT id FROM friend_requests WHERE from_user=? AND to_user=?", otherID, otherID).Scan(&reqID)

	// Current user tries to accept (not the recipient)
	req, _ := http.NewRequest("POST", "/friend-requests/"+itos(reqID)+"/accept", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestRejectFriendRequest_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)
	otherID := seedAnotherUser(t)

	database.DB.Exec("INSERT INTO friend_requests (from_user, to_user) VALUES (?, ?)", otherID, userID)
	var reqID int64
	database.DB.QueryRow("SELECT id FROM friend_requests WHERE from_user=? AND to_user=?", otherID, userID).Scan(&reqID)

	req, _ := http.NewRequest("DELETE", "/friend-requests/"+itos(reqID), nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var status string
	database.DB.QueryRow("SELECT status FROM friend_requests WHERE id=?", reqID).Scan(&status)
	if status != "rejected" {
		t.Errorf("expected status 'rejected', got '%s'", status)
	}
}

func TestRejectFriendRequest_NotFound(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("DELETE", "/friend-requests/99999", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}
