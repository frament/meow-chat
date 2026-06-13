package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"my-chat-backend/database"
	"my-chat-backend/models"
)

func TestCreateGroupChat_Success(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"name":"Test Group"}`
	req, _ := http.NewRequest("POST", "/group-chats", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestCreateGroupChat_EmptyName(t *testing.T) {
	app, _, userID := setupTestApp(t)

	body := `{"name":""}`
	req, _ := http.NewRequest("POST", "/group-chats", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestGetGroupChats(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Group A", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	req, _ := http.NewRequest("GET", "/group-chats", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}

	var groups []models.GroupChat
	json.NewDecoder(resp.Body).Decode(&groups)
	if len(groups) != 1 {
		t.Errorf("expected 1 group, got %d", len(groups))
	}
}

func TestGetGroupChat(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Test Group", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	req, _ := http.NewRequest("GET", "/group-chats/1", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestAddRemoveMember(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Test Group", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	body := `{"username":"admin"}`
	req, _ := http.NewRequest("POST", "/group-chats/1/members", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("add member: expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}

	req, _ = http.NewRequest("DELETE", "/group-chats/1/members/2", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("remove member: expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestDeleteGroupChat(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Test Group", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	req, _ := http.NewRequest("DELETE", "/group-chats/1", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestDeleteGroupChat_NonCreator(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Test Group", int64(2))
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	req, _ := http.NewRequest("DELETE", "/group-chats/1", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 403, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestGroupInviteFlow(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Test Group", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	req, _ := http.NewRequest("POST", "/group-chats/1/invites", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	var createResp struct {
		Token string `json:"token"`
	}
	json.NewDecoder(resp.Body).Decode(&createResp)
	if resp.StatusCode != 201 {
		t.Fatalf("create invite: expected 201, got %d", resp.StatusCode)
	}
	if createResp.Token == "" {
		t.Fatal("expected invite token")
	}

	req, _ = http.NewRequest("GET", "/group-chat-invites/"+createResp.Token, nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("get invite: expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}

	// Join as user 2
	req, _ = http.NewRequest("POST", "/group-chat-invites/"+createResp.Token+"/join", nil)
	req.Header.Set("Authorization", bearerToken(t, int64(2), false))
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("join via invite: expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestSendGroupMessage(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Test Group", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("group_chat_id", "1")
	w.WriteField("content", "Hello group!")
	w.Close()

	req, _ := http.NewRequest("POST", "/group-chat-messages", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, respBody.String())
	}
}

func TestGetGroupMessages(t *testing.T) {
	app, _, userID := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Test Group", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)
	database.DB.Exec("INSERT INTO group_messages (group_chat_id, from_user_id, content) VALUES (?, ?, ?)", int64(1), userID, "Hello!")

	req, _ := http.NewRequest("GET", "/group-chat-messages/"+fmt.Sprintf("%d", 1), nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		respBody := new(bytes.Buffer)
		respBody.ReadFrom(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, respBody.String())
	}

	var msgs []models.Message
	json.NewDecoder(resp.Body).Decode(&msgs)
	if len(msgs) != 1 {
		t.Errorf("expected 1 message, got %d", len(msgs))
	}
}

func TestGetGroupMessages_NotMember(t *testing.T) {
	app, _, _ := setupTestApp(t)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Test Group", int64(2))

	req, _ := http.NewRequest("GET", "/group-chat-messages/1", nil)
	req.Header.Set("Authorization", bearerToken(t, int64(3), false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	respBody := new(bytes.Buffer)
	respBody.ReadFrom(resp.Body)
	t.Logf("response: %s", respBody.String())
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}
