package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strconv"
	"testing"

	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
)

func TestCreatePost_TextOnly(t *testing.T) {
	app, _, userID := setupTestApp(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("content", "Hello world!")
	w.Close()

	req, _ := http.NewRequest("POST", "/posts", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Errorf("expected 201, got %d", resp.StatusCode)
	}
}

func TestCreatePost_EmptyContent(t *testing.T) {
	app, _, userID := setupTestApp(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.Close()

	req, _ := http.NewRequest("POST", "/posts", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Errorf("expected 201, got %d", resp.StatusCode)
	}
}

func TestCreatePost_Public(t *testing.T) {
	app, _, userID := setupTestApp(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("content", "Public post!")
	w.WriteField("is_public", "true")
	w.Close()

	req, _ := http.NewRequest("POST", "/posts", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Errorf("expected 201, got %d", resp.StatusCode)
	}
}

func TestGetFeed_Empty(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/feed", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var posts []models.Post
	json.NewDecoder(resp.Body).Decode(&posts)
	if len(posts) != 0 {
		t.Errorf("expected empty feed, got %d", len(posts))
	}
}

func TestGetFeed_WithPosts(t *testing.T) {
	app, _, userID := setupTestApp(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("content", "My post!")
	w.Close()

	req, _ := http.NewRequest("POST", "/posts", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Fatalf("create post: expected 201, got %d", resp.StatusCode)
	}

	req, _ = http.NewRequest("GET", "/feed", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	var posts []models.Post
	json.NewDecoder(resp.Body).Decode(&posts)
	if len(posts) != 1 {
		t.Errorf("expected 1 post, got %d", len(posts))
	}
	if posts[0].Content != "My post!" {
		t.Errorf("expected content 'My post!', got '%s'", posts[0].Content)
	}
}

func createPostForTest(t *testing.T, app *fiber.App, token string, content string) int64 {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("content", content)
	w.Close()
	req, _ := http.NewRequest("POST", "/posts", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", token)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Fatalf("create post: expected 201, got %d", resp.StatusCode)
	}
	var result struct {
		ID int64 `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return result.ID
}

func TestDeletePost_OwnPost(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	postID := createPostForTest(t, app, token, "Delete me")

	req, _ := http.NewRequest("DELETE", "/posts/"+strconv.FormatInt(postID, 10), nil)
	req.Header.Set("Authorization", token)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	req, _ = http.NewRequest("GET", "/feed", nil)
	req.Header.Set("Authorization", token)
	resp, _ = app.Test(req)
	var posts []models.Post
	json.NewDecoder(resp.Body).Decode(&posts)
	if len(posts) != 0 {
		t.Errorf("expected empty feed after delete, got %d posts", len(posts))
	}
}

func TestDeletePost_AdminDeletesOtherPost(t *testing.T) {
	app, _, userID := setupTestApp(t)
	userToken := bearerToken(t, userID, false)
	adminToken := bearerToken(t, 999, true)

	postID := createPostForTest(t, app, userToken, "Admin will delete this")

	req, _ := http.NewRequest("DELETE", "/posts/"+strconv.FormatInt(postID, 10), nil)
	req.Header.Set("Authorization", adminToken)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestDeletePost_NotOwner(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)
	otherToken := bearerToken(t, 42, false)

	postID := createPostForTest(t, app, token, "Not for you")

	req, _ := http.NewRequest("DELETE", "/posts/"+strconv.FormatInt(postID, 10), nil)
	req.Header.Set("Authorization", otherToken)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}

func TestDeletePost_NotFound(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, false)

	req, _ := http.NewRequest("DELETE", "/posts/99999", nil)
	req.Header.Set("Authorization", token)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestToggleReaction(t *testing.T) {
	app, _, userID := setupTestApp(t)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("content", "React to me!")
	w.Close()

	req, _ := http.NewRequest("POST", "/posts", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 201 {
		t.Fatalf("create post: expected 201, got %d", resp.StatusCode)
	}

	body := `{"emoji":"\u2764"}`
	req, _ = http.NewRequest("POST", "/posts/1/react", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearerToken(t, userID, false))
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	var respBody bytes.Buffer
	respBody.ReadFrom(resp.Body)
	if resp.StatusCode != 201 && resp.StatusCode != 200 {
		t.Errorf("expected 200/201, got %d: %s", resp.StatusCode, respBody.String())
	}
}
