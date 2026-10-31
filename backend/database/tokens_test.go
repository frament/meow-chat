package database

import (
	"testing"
	"time"
)

// The grace window exists so a refresh race does not sign anybody out, but the
// table must not grow one dead row per refresh for ever.
func TestPurgeReleasedRefreshTokens(t *testing.T) {
	setupTestDB(t)

	SaveRefreshToken(1, "fresh", time.Now().Add(24*time.Hour))
	SaveRefreshToken(1, "old", time.Now().Add(24*time.Hour))

	if _, err := ClaimRefreshToken("fresh", RefreshGrace); err != nil {
		t.Fatalf("claim fresh: %v", err)
	}
	if _, err := ClaimRefreshToken("old", RefreshGrace); err != nil {
		t.Fatalf("claim old: %v", err)
	}
	// Age one of them beyond the window.
	DB.Exec("UPDATE refresh_tokens SET used_at = datetime('now', '-1 hour') WHERE token_id = 'old'")

	PurgeReleasedRefreshTokens(RefreshGrace)

	var count int
	DB.QueryRow("SELECT COUNT(*) FROM refresh_tokens WHERE token_id = 'fresh'").Scan(&count)
	if count != 1 {
		t.Errorf("a token released moments ago must survive the grace window, count=%d", count)
	}
	DB.QueryRow("SELECT COUNT(*) FROM refresh_tokens WHERE token_id = 'old'").Scan(&count)
	if count != 0 {
		t.Errorf("a token released an hour ago must be purged, count=%d", count)
	}
}
