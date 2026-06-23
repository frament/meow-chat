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

	"github.com/gofiber/fiber/v2"
)

func sendPollReq(app *fiber.App, token string, toUserID int64, question string, options []string, multiple bool) *http.Response {
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	w.WriteField("to_user_id", fmt.Sprintf("%d", toUserID))
	w.WriteField("content", question)
	w.WriteField("type", "poll")
	if multiple {
		w.WriteField("poll_multiple", "true")
	}
	for _, opt := range options {
		w.WriteField("poll_options[]", opt)
	}
	w.Close()

	req, _ := http.NewRequest("POST", "/messages", &b)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", token)
	resp, err := app.Test(req)
	if err != nil {
		panic(err)
	}
	return resp
}

func TestSendPollMessage(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	resp := sendPollReq(app, token, 2, "Best color?", []string{"Red", "Blue", "Green"}, false)

	if resp.StatusCode != 201 {
		buf := new(bytes.Buffer)
		buf.ReadFrom(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, buf.String())
	}

	var msgResp struct {
		ID   int64        `json:"id"`
		Poll *models.Poll `json:"poll"`
	}
	json.NewDecoder(resp.Body).Decode(&msgResp)
	if msgResp.Poll == nil {
		t.Fatal("expected poll data in response")
	}
	if msgResp.Poll.Question != "Best color?" {
		t.Errorf("expected question 'Best color?', got %s", msgResp.Poll.Question)
	}
	if msgResp.Poll.IsMultipleChoice {
		t.Error("expected single choice poll")
	}
	if len(msgResp.Poll.Options) != 3 {
		t.Errorf("expected 3 options, got %d", len(msgResp.Poll.Options))
	}

	var pollCount int
	database.DB.QueryRow("SELECT COUNT(*) FROM polls WHERE message_id = ?", msgResp.ID).Scan(&pollCount)
	if pollCount != 1 {
		t.Errorf("expected 1 poll, got %d", pollCount)
	}
}

func TestSendPollMessage_MissingOptions(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	resp := sendPollReq(app, token, 2, "Only one?", []string{"Option1"}, false)
	if resp.StatusCode != 400 {
		t.Errorf("expected 400 for <2 options, got %d", resp.StatusCode)
	}
}

func TestSendPollMessage_MultipleChoice(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	resp := sendPollReq(app, token, 2, "Pick all?", []string{"A", "B", "C"}, true)
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}

	var msgResp struct {
		Poll *models.Poll `json:"poll"`
	}
	json.NewDecoder(resp.Body).Decode(&msgResp)
	if !msgResp.Poll.IsMultipleChoice {
		t.Error("expected multiple choice poll")
	}
}

func TestCastVote_SingleChoice(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	resp := sendPollReq(app, token, 2, "Vote test?", []string{"Yes", "No"}, false)
	var msgResp struct {
		ID   int64        `json:"id"`
		Poll *models.Poll `json:"poll"`
	}
	json.NewDecoder(resp.Body).Decode(&msgResp)
	if msgResp.Poll == nil || len(msgResp.Poll.Options) == 0 {
		t.Fatal("no poll options")
	}

	optionID := msgResp.Poll.Options[0].ID
	body := fmt.Sprintf(`{"option_id":%d}`, optionID)
	req, _ := http.NewRequest("POST", fmt.Sprintf("/polls/%d/vote", msgResp.Poll.ID), strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	resp2, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp2.StatusCode)
	}

	var voteResp struct {
		Options []struct {
			ID        int64 `json:"id"`
			VoteCount int   `json:"vote_count"`
			Voted     bool  `json:"voted"`
		} `json:"options"`
	}
	json.NewDecoder(resp2.Body).Decode(&voteResp)
	if len(voteResp.Options) == 0 {
		t.Fatal("expected options in vote response")
	}
	if voteResp.Options[0].VoteCount != 1 {
		t.Errorf("expected vote_count=1, got %d", voteResp.Options[0].VoteCount)
	}
}

func TestCastVote_SingleChoice_TwoVotes(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	resp := sendPollReq(app, token, 2, "Only one?", []string{"Opt1", "Opt2"}, false)
	var msgResp struct {
		ID   int64        `json:"id"`
		Poll *models.Poll `json:"poll"`
	}
	json.NewDecoder(resp.Body).Decode(&msgResp)

	opt1ID := msgResp.Poll.Options[0].ID
	opt2ID := msgResp.Poll.Options[1].ID

	body1 := fmt.Sprintf(`{"option_id":%d}`, opt1ID)
	req1, _ := http.NewRequest("POST", fmt.Sprintf("/polls/%d/vote", msgResp.Poll.ID), strings.NewReader(body1))
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("Authorization", token)
	app.Test(req1)

	body2 := fmt.Sprintf(`{"option_id":%d}`, opt2ID)
	req2, _ := http.NewRequest("POST", fmt.Sprintf("/polls/%d/vote", msgResp.Poll.ID), strings.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", token)
	resp2, err := app.Test(req2)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 400 {
		t.Errorf("expected 400 (already voted), got %d", resp2.StatusCode)
	}
}

func TestCastVote_MultipleChoice(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	resp := sendPollReq(app, token, 2, "Pick any?", []string{"A", "B", "C"}, true)
	var msgResp struct {
		Poll *models.Poll `json:"poll"`
	}
	json.NewDecoder(resp.Body).Decode(&msgResp)

	opt0ID := msgResp.Poll.Options[0].ID
	opt1ID := msgResp.Poll.Options[1].ID

	body1 := fmt.Sprintf(`{"option_id":%d}`, opt0ID)
	req1, _ := http.NewRequest("POST", fmt.Sprintf("/polls/%d/vote", msgResp.Poll.ID), strings.NewReader(body1))
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("Authorization", token)
	resp1, _ := app.Test(req1)
	if resp1.StatusCode != 200 {
		t.Fatalf("first vote: expected 200, got %d", resp1.StatusCode)
	}

	body2 := fmt.Sprintf(`{"option_id":%d}`, opt1ID)
	req2, _ := http.NewRequest("POST", fmt.Sprintf("/polls/%d/vote", msgResp.Poll.ID), strings.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", token)
	resp2, err := app.Test(req2)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 200 {
		t.Errorf("second vote in multi-choice: expected 200, got %d", resp2.StatusCode)
	}
}

func TestCastVote_Unauthenticated(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	resp := sendPollReq(app, token, 2, "Auth?", []string{"A", "B"}, false)
	var msgResp struct {
		Poll *models.Poll `json:"poll"`
	}
	json.NewDecoder(resp.Body).Decode(&msgResp)

	body := fmt.Sprintf(`{"option_id":%d}`, msgResp.Poll.Options[0].ID)
	req, _ := http.NewRequest("POST", fmt.Sprintf("/polls/%d/vote", msgResp.Poll.ID), strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp2, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp2.StatusCode)
	}
}

func TestGetMessages_WithPoll(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	sendPollReq(app, token, 2, "Question?", []string{"A", "B"}, false)

	req, _ := http.NewRequest("GET", "/messages?user1=1&user2=2", nil)
	req.Header.Set("Authorization", token)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}

	var msgs []models.Message
	json.NewDecoder(resp.Body).Decode(&msgs)
	if len(msgs) == 0 {
		t.Fatal("expected messages")
	}

	found := false
	for _, m := range msgs {
		if m.Type == "poll" && m.Poll != nil {
			found = true
			if m.Poll.Question != "Question?" {
				t.Errorf("expected question 'Question?', got %s", m.Poll.Question)
			}
			if len(m.Poll.Options) != 2 {
				t.Errorf("expected 2 options, got %d", len(m.Poll.Options))
			}
			break
		}
	}
	if !found {
		t.Error("expected a poll message with poll data")
	}
}

// Validation tests

func TestSendPollMessage_EmptyQuestion(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	resp := sendPollReq(app, token, 2, "", []string{"A", "B"}, false)
	if resp.StatusCode != 400 {
		t.Errorf("expected 400 for empty question, got %d", resp.StatusCode)
	}
}

func TestSendPollMessage_TooManyOptions(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	opts := make([]string, 21)
	for i := range opts {
		opts[i] = fmt.Sprintf("Opt %d", i+1)
	}

	resp := sendPollReq(app, token, 2, "Too many?", opts, false)
	if resp.StatusCode != 400 {
		t.Errorf("expected 400 for >20 options, got %d", resp.StatusCode)
	}
}

func TestCastVote_NonExistentPoll(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	body := fmt.Sprintf(`{"option_id":%d}`, 999)
	req, _ := http.NewRequest("POST", "/polls/99999/vote", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestCastVote_SameOptionTwice_MultipleChoice(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	resp := sendPollReq(app, token, 2, "Multi?", []string{"A", "B"}, true)
	var msgResp struct {
		Poll *models.Poll `json:"poll"`
	}
	json.NewDecoder(resp.Body).Decode(&msgResp)

	optID := msgResp.Poll.Options[0].ID

	body := fmt.Sprintf(`{"option_id":%d}`, optID)
	req1, _ := http.NewRequest("POST", fmt.Sprintf("/polls/%d/vote", msgResp.Poll.ID), strings.NewReader(body))
	req1.Header.Set("Content-Type", "application/json")
	req1.Header.Set("Authorization", token)
	resp1, _ := app.Test(req1)
	if resp1.StatusCode != 200 {
		t.Fatalf("first vote: expected 200, got %d", resp1.StatusCode)
	}

	req2, _ := http.NewRequest("POST", fmt.Sprintf("/polls/%d/vote", msgResp.Poll.ID), strings.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", token)
	resp2, err := app.Test(req2)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 400 {
		t.Errorf("duplicate vote on same option: expected 400, got %d", resp2.StatusCode)
	}
}

// Group poll tests

func sendGroupPollReq(app *fiber.App, token string, groupID int64, question string, options []string, multiple bool) *http.Response {
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	w.WriteField("group_chat_id", fmt.Sprintf("%d", groupID))
	w.WriteField("content", question)
	w.WriteField("type", "poll")
	if multiple {
		w.WriteField("poll_multiple", "true")
	}
	for _, opt := range options {
		w.WriteField("poll_options[]", opt)
	}
	w.Close()

	req, _ := http.NewRequest("POST", "/group-chat-messages", &b)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", token)
	resp, err := app.Test(req)
	if err != nil {
		panic(err)
	}
	return resp
}

func TestSendPollMessage_GroupChat(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Poll Group", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	resp := sendGroupPollReq(app, token, 1, "Group poll?", []string{"Option A", "Option B", "Option C"}, false)
	if resp.StatusCode != 201 {
		buf := new(bytes.Buffer)
		buf.ReadFrom(resp.Body)
		t.Fatalf("expected 201, got %d: %s", resp.StatusCode, buf.String())
	}

	var msgResp struct {
		ID   int64        `json:"id"`
		Poll *models.Poll `json:"poll"`
	}
	json.NewDecoder(resp.Body).Decode(&msgResp)
	if msgResp.Poll == nil {
		t.Fatal("expected poll data in group message response")
	}
	if msgResp.Poll.Question != "Group poll?" {
		t.Errorf("expected question 'Group poll?', got %s", msgResp.Poll.Question)
	}
	if len(msgResp.Poll.Options) != 3 {
		t.Errorf("expected 3 options, got %d", len(msgResp.Poll.Options))
	}
	if msgResp.Poll.IsMultipleChoice {
		t.Error("expected single choice poll")
	}

	var pollCount int
	database.DB.QueryRow("SELECT COUNT(*) FROM polls WHERE group_message_id = ?", msgResp.ID).Scan(&pollCount)
	if pollCount != 1 {
		t.Errorf("expected 1 poll, got %d", pollCount)
	}
}

func TestGetGroupMessages_WithPoll(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Poll Group", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)

	sendGroupPollReq(app, token, 1, "Group Q?", []string{"A", "B"}, false)

	req, _ := http.NewRequest("GET", "/group-chat-messages/1", nil)
	req.Header.Set("Authorization", token)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var msgs []models.Message
	json.NewDecoder(resp.Body).Decode(&msgs)
	found := false
	for _, m := range msgs {
		if m.Type == "poll" && m.Poll != nil {
			found = true
			if m.Poll.Question != "Group Q?" {
				t.Errorf("expected question 'Group Q?', got %s", m.Poll.Question)
			}
			if len(m.Poll.Options) != 2 {
				t.Errorf("expected 2 options, got %d", len(m.Poll.Options))
			}
			break
		}
	}
	if !found {
		t.Error("expected a group poll message with poll data")
	}
}

func TestCastVote_GroupPoll(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)
	otherUserID := int64(3)

	database.DB.Exec("INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)", otherUserID, "other", "other@example.com", "password")
	database.DB.Exec("INSERT INTO group_chats (name, created_by) VALUES (?, ?)", "Poll Group", userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, userID)
	database.DB.Exec("INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)", 1, otherUserID)

	resp := sendGroupPollReq(app, token, 1, "Vote?", []string{"Yes", "No"}, false)
	if resp.StatusCode != 201 {
		buf := new(bytes.Buffer)
		buf.ReadFrom(resp.Body)
		t.Fatalf("sendGroupPollReq: expected 201, got %d: %s", resp.StatusCode, buf.String())
	}
	var msgResp struct {
		ID   int64        `json:"id"`
		Poll *models.Poll `json:"poll"`
	}
	json.NewDecoder(resp.Body).Decode(&msgResp)

	optID := msgResp.Poll.Options[0].ID
	body := fmt.Sprintf(`{"option_id":%d}`, optID)
	req, _ := http.NewRequest("POST", fmt.Sprintf("/polls/%d/vote", msgResp.Poll.ID), strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	resp2, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 200 {
		buf := new(bytes.Buffer)
		buf.ReadFrom(resp2.Body)
		t.Fatalf("expected 200, got %d: %s", resp2.StatusCode, buf.String())
	}

	var voteResp struct {
		Options []struct {
			ID        int64 `json:"id"`
			VoteCount int   `json:"vote_count"`
			Voted     bool  `json:"voted"`
		} `json:"options"`
	}
	json.NewDecoder(resp2.Body).Decode(&voteResp)
	if voteResp.Options[0].VoteCount != 1 {
		t.Errorf("expected vote_count=1, got %d", voteResp.Options[0].VoteCount)
	}

	// Other user votes
	otherToken := bearerToken(t, otherUserID, false)
	body2 := fmt.Sprintf(`{"option_id":%d}`, msgResp.Poll.Options[1].ID)
	req2, _ := http.NewRequest("POST", fmt.Sprintf("/polls/%d/vote", msgResp.Poll.ID), strings.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", otherToken)
	resp3, _ := app.Test(req2)
	if resp3.StatusCode != 200 {
		t.Errorf("second user vote: expected 200, got %d", resp3.StatusCode)
	}
}
