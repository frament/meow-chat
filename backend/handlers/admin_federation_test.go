package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"my-chat-backend/database"
)

func TestAdminFederationListServers_Empty(t *testing.T) {
	app, _, userID := setupTestApp(t)

	req, _ := http.NewRequest("GET", "/admin/federation/servers", nil)
	req.Header.Set("Authorization", bearerToken(t, userID, true))
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestAdminFederationCRUD(t *testing.T) {
	app, _, userID := setupTestApp(t)
	token := bearerToken(t, userID, true)

	database.DB.Exec(`INSERT INTO federation_servers (name, base_url, server_token, status) VALUES (?, ?, ?, 'active')`,
		"TestServer", "https://example.com", "tok123")

	t.Run("get server", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/admin/federation/servers/1", nil)
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
		var result struct {
			Name string `json:"name"`
		}
		json.NewDecoder(resp.Body).Decode(&result)
		if result.Name != "TestServer" {
			t.Errorf("expected TestServer, got %s", result.Name)
		}
	})

	t.Run("get server not found", func(t *testing.T) {
		req, _ := http.NewRequest("GET", "/admin/federation/servers/999", nil)
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 404 {
			t.Errorf("expected 404, got %d", resp.StatusCode)
		}
	})

	t.Run("update server", func(t *testing.T) {
		body := `{"name":"UpdatedServer"}`
		req, _ := http.NewRequest("PUT", "/admin/federation/servers/1", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
	})

	t.Run("block server", func(t *testing.T) {
		req, _ := http.NewRequest("POST", "/admin/federation/servers/1/block", nil)
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
		var status string
		database.DB.QueryRow("SELECT status FROM federation_servers WHERE id=1").Scan(&status)
		if status != "blocked" {
			t.Errorf("expected blocked, got %s", status)
		}
	})

	t.Run("unblock server", func(t *testing.T) {
		req, _ := http.NewRequest("POST", "/admin/federation/servers/1/unblock", nil)
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
		var status string
		database.DB.QueryRow("SELECT status FROM federation_servers WHERE id=1").Scan(&status)
		if status != "active" {
			t.Errorf("expected active, got %s", status)
		}
	})

	t.Run("delete server", func(t *testing.T) {
		req, _ := http.NewRequest("DELETE", "/admin/federation/servers/1", nil)
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
		var count int
		database.DB.QueryRow("SELECT COUNT(*) FROM federation_servers").Scan(&count)
		if count != 0 {
			t.Error("expected server deleted")
		}
	})

	t.Run("delete server not found", func(t *testing.T) {
		req, _ := http.NewRequest("DELETE", "/admin/federation/servers/999", nil)
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
	})

	t.Run("create invite", func(t *testing.T) {
		body := `{}`
		req, _ := http.NewRequest("POST", "/admin/federation/servers", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 201 {
			t.Fatalf("expected 201, got %d", resp.StatusCode)
		}
		var result struct {
			Token string `json:"token"`
		}
		json.NewDecoder(resp.Body).Decode(&result)
		if result.Token == "" {
			t.Error("expected non-empty token")
		}
	})

	t.Run("clear cache not found", func(t *testing.T) {
		req, _ := http.NewRequest("DELETE", "/admin/federation/cache/999", nil)
		req.Header.Set("Authorization", token)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
	})
}
