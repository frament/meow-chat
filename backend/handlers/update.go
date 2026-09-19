package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"my-chat-backend/version"

	"github.com/gofiber/fiber/v2"
)

type updateCacheEntry struct {
	data      UpdateCheckResult
	expiresAt time.Time
}

var (
	updateCache   *updateCacheEntry
	updateCacheMu sync.Mutex
)

type GitHubRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

type UpdateCheckResult struct {
	UpdateAvailable bool   `json:"update_available"`
	CurrentVersion  string `json:"current_version"`
	LatestVersion   string `json:"latest_version"`
	DownloadURL     string `json:"download_url"`
	ReleaseNotesURL string `json:"release_notes_url"`
	Error           string `json:"error,omitempty"`
}

func (h *Handler) CheckUpdate(c *fiber.Ctx) error {
	updateCacheMu.Lock()
	cached := updateCache
	updateCacheMu.Unlock()

	if cached != nil && time.Now().Before(cached.expiresAt) {
		return c.JSON(cached.data)
	}

	result := fetchLatestRelease()

	if result.Error == "" {
		updateCacheMu.Lock()
		updateCache = &updateCacheEntry{
			data:      result,
			expiresAt: time.Now().Add(1 * time.Hour),
		}
		updateCacheMu.Unlock()
	}

	return c.JSON(result)
}

func fetchLatestRelease() UpdateCheckResult {
	url := fmt.Sprintf("%s/repos/%s/releases/latest", version.GitHubAPIBase, version.GitHubRepo)

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return UpdateCheckResult{
			CurrentVersion: version.Version,
			Error:          "Failed to create request",
		}
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "MeowChat/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return UpdateCheckResult{
			CurrentVersion: version.Version,
			Error:          fmt.Sprintf("GitHub unreachable: %v", err),
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return UpdateCheckResult{
			CurrentVersion: version.Version,
			Error:          "No releases found",
		}
	}
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return UpdateCheckResult{
			CurrentVersion: version.Version,
			Error:          fmt.Sprintf("GitHub API error %d: %s", resp.StatusCode, string(body)),
		}
	}

	var release GitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return UpdateCheckResult{
			CurrentVersion: version.Version,
			Error:          fmt.Sprintf("Failed to parse response: %v", err),
		}
	}

	updateAvailable := false
	if release.TagName != "" {
		// Compare ignores "v" prefix, pre-release suffixes and git-describe
		// metadata ("v1.1.1-7-gabc"), so this also handles dev builds correctly.
		updateAvailable = version.Compare(release.TagName, version.Version) > 0
	}

	return UpdateCheckResult{
		UpdateAvailable: updateAvailable,
		CurrentVersion:  version.Version,
		LatestVersion:   release.TagName,
		DownloadURL:     fmt.Sprintf("https://github.com/%s/releases/tag/%s", version.GitHubRepo, release.TagName),
		ReleaseNotesURL: release.HTMLURL,
	}
}
