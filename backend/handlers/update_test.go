package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"my-chat-backend/version"
)

func TestCheckUpdate_NoReleases(t *testing.T) {
	updateCacheMu.Lock()
	updateCache = nil
	updateCacheMu.Unlock()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		fmt.Fprint(w, `{"message": "Not Found"}`)
	}))
	defer ts.Close()

	origRepo := version.GitHubRepo
	origBase := version.GitHubAPIBase
	version.GitHubRepo = "test/repo"
	version.GitHubAPIBase = ts.URL
	defer func() {
		version.GitHubRepo = origRepo
		version.GitHubAPIBase = origBase
	}()

	app, h, _ := setupTestApp(t)
	app.Get("/check-update", h.CheckUpdate)

	req := httptest.NewRequest("GET", "/check-update", nil)
	resp, _ := app.Test(req)

	var result UpdateCheckResult
	json.NewDecoder(resp.Body).Decode(&result)

	if result.CurrentVersion != version.Version {
		t.Errorf("expected current %s, got %s", version.Version, result.CurrentVersion)
	}
	if result.Error == "" {
		t.Error("expected error for 404")
	}
}

func TestCheckUpdate_NewVersionAvailable(t *testing.T) {
	updateCacheMu.Lock()
	updateCache = nil
	updateCacheMu.Unlock()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]string{
			"tag_name": "v99.0.0",
			"html_url": "https://github.com/frament/my-chat/releases/tag/v99.0.0",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	origRepo := version.GitHubRepo
	origBase := version.GitHubAPIBase
	version.GitHubRepo = "test/repo"
	version.GitHubAPIBase = ts.URL
	defer func() {
		version.GitHubRepo = origRepo
		version.GitHubAPIBase = origBase
	}()

	app, h, _ := setupTestApp(t)
	app.Get("/check-update", h.CheckUpdate)

	req := httptest.NewRequest("GET", "/check-update", nil)
	resp, _ := app.Test(req)

	var result UpdateCheckResult
	json.NewDecoder(resp.Body).Decode(&result)

	if !result.UpdateAvailable {
		t.Error("expected update_available to be true (99.0.0 > 0.1.0-dev)")
	}
	if result.LatestVersion != "v99.0.0" {
		t.Errorf("expected latest v99.0.0, got %s", result.LatestVersion)
	}
	if result.Error != "" {
		t.Errorf("unexpected error: %s", result.Error)
	}
}

func TestCheckUpdate_UpToDate(t *testing.T) {
	updateCacheMu.Lock()
	updateCache = nil
	updateCacheMu.Unlock()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]string{
			"tag_name": "v0.0.1",
			"html_url": "https://github.com/frament/my-chat/releases/tag/v0.0.1",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	origRepo := version.GitHubRepo
	origBase := version.GitHubAPIBase
	version.GitHubRepo = "test/repo"
	version.GitHubAPIBase = ts.URL
	defer func() {
		version.GitHubRepo = origRepo
		version.GitHubAPIBase = origBase
	}()

	app, h, _ := setupTestApp(t)
	app.Get("/check-update", h.CheckUpdate)

	req := httptest.NewRequest("GET", "/check-update", nil)
	resp, _ := app.Test(req)

	var result UpdateCheckResult
	json.NewDecoder(resp.Body).Decode(&result)

	if result.UpdateAvailable {
		t.Errorf("expected no update (0.0.1 < 0.1.0-dev), got update_available=true")
	}
}

func TestCheckUpdate_SameVersion_Dev(t *testing.T) {
	updateCacheMu.Lock()
	updateCache = nil
	updateCacheMu.Unlock()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]string{
			"tag_name": "v0.1.0",
			"html_url": "https://github.com/frament/my-chat/releases/tag/v0.1.0",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	origRepo := version.GitHubRepo
	origBase := version.GitHubAPIBase
	version.GitHubRepo = "test/repo"
	version.GitHubAPIBase = ts.URL
	defer func() {
		version.GitHubRepo = origRepo
		version.GitHubAPIBase = origBase
	}()

	app, h, _ := setupTestApp(t)
	app.Get("/check-update", h.CheckUpdate)

	req := httptest.NewRequest("GET", "/check-update", nil)
	resp, _ := app.Test(req)

	var result UpdateCheckResult
	json.NewDecoder(resp.Body).Decode(&result)

	// 0.1.0-dev should be notified about 0.1.0 release
	if !result.UpdateAvailable {
		t.Error("expected update_available=true (dev should update to release)")
	}
}

func TestCheckUpdate_GitHubUnreachable(t *testing.T) {
	updateCacheMu.Lock()
	updateCache = nil
	updateCacheMu.Unlock()

	origRepo := version.GitHubRepo
	origBase := version.GitHubAPIBase
	version.GitHubRepo = "test/repo"
	version.GitHubAPIBase = "http://127.0.0.1:1"
	defer func() {
		version.GitHubRepo = origRepo
		version.GitHubAPIBase = origBase
	}()

	app, h, _ := setupTestApp(t)
	app.Get("/check-update", h.CheckUpdate)

	req := httptest.NewRequest("GET", "/check-update", nil)
	resp, _ := app.Test(req)

	var result UpdateCheckResult
	json.NewDecoder(resp.Body).Decode(&result)

	if result.Error == "" {
		t.Error("expected error when GitHub unreachable")
	}
}

func TestCheckUpdate_CacheUsed(t *testing.T) {
	callCount := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		resp := map[string]string{
			"tag_name": "v1.0.0",
			"html_url": "https://github.com/frament/my-chat/releases/tag/v1.0.0",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	origRepo := version.GitHubRepo
	origBase := version.GitHubAPIBase
	version.GitHubRepo = "test/repo"
	version.GitHubAPIBase = ts.URL
	defer func() {
		version.GitHubRepo = origRepo
		version.GitHubAPIBase = origBase
	}()

	// Prime cache with a result
	updateCacheMu.Lock()
	updateCache = &updateCacheEntry{
		data: UpdateCheckResult{
			UpdateAvailable: true,
			CurrentVersion:  version.Version,
			LatestVersion:   "v1.0.0",
			DownloadURL:     "https://github.com/frament/my-chat/releases/tag/v1.0.0",
		},
		expiresAt: time.Now().Add(1 * time.Hour),
	}
	updateCacheMu.Unlock()

	app, h, _ := setupTestApp(t)
	app.Get("/check-update", h.CheckUpdate)

	req := httptest.NewRequest("GET", "/check-update", nil)
	resp, _ := app.Test(req)

	var result UpdateCheckResult
	json.NewDecoder(resp.Body).Decode(&result)

	if !result.UpdateAvailable {
		t.Error("expected update_available from cache")
	}
	if callCount > 0 {
		t.Error("expected no HTTP calls when cache is fresh")
	}
}
