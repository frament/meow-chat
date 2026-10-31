package database

import (
	"database/sql"
	"fmt"
	"time"
)

func SaveRefreshToken(userID int64, tokenID string, expiresAt time.Time) error {
	_, err := DB.Exec(
		"INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES (?, ?, ?)",
		userID, tokenID, expiresAt,
	)
	return err
}

// RefreshGrace is how long a token that has already been exchanged still works.
//
// Rotation used to delete the row the moment it was used. Two contexts that share
// one storage (a tab and the installed app, or a reload over a page that is still
// alive) then take the same token: the first gets a new pair, the second gets 401
// and signs the user out. On prod that looked like "сессия живёт меньше суток":
// one 401 on /api/refresh, then a manual login.
//
// Sixty seconds is long enough for a race and a lost response, short enough that
// a stolen token is not useful for long.
const RefreshGrace = 60 * time.Second

// ClaimRefreshToken resolves a refresh token and marks it as exchanged.
//
// Returns the token's user. A token already exchanged within RefreshGrace is
// accepted again - that is the whole point. Anything older is refused, so a
// replay after the window still fails.
func ClaimRefreshToken(tokenID string, grace time.Duration) (int64, error) {
	var userID int64
	var expiresAt time.Time
	var usedAt sql.NullTime

	err := DB.QueryRow(
		"SELECT user_id, expires_at, used_at FROM refresh_tokens WHERE token_id = ?",
		tokenID,
	).Scan(&userID, &expiresAt, &usedAt)
	if err != nil {
		return 0, err
	}

	if time.Now().After(expiresAt) {
		DeleteRefreshToken(tokenID)
		return 0, sql.ErrNoRows
	}

	if usedAt.Valid {
		if time.Since(usedAt.Time) > grace {
			// Released long ago: this is a replay, not a race.
			DeleteRefreshToken(tokenID)
			return 0, sql.ErrNoRows
		}
		return userID, nil
	}

	if _, err := DB.Exec(
		"UPDATE refresh_tokens SET used_at = datetime('now') WHERE token_id = ? AND used_at IS NULL",
		tokenID,
	); err != nil {
		return 0, err
	}
	return userID, nil
}

// PurgeReleasedRefreshTokens drops rows released longer ago than the grace
// window, and rows that have expired. Cheap, and it keeps the table from growing
// one row per refresh for ever.
func PurgeReleasedRefreshTokens(grace time.Duration) {
	DB.Exec(
		"DELETE FROM refresh_tokens WHERE (used_at IS NOT NULL AND used_at < datetime('now', ?)) OR expires_at < datetime('now')",
		fmt.Sprintf("-%d seconds", int(grace.Seconds())),
	)
}

func GetRefreshToken(tokenID string) (int64, error) {
	var userID int64
	var expiresAt time.Time
	err := DB.QueryRow(
		"SELECT user_id, expires_at FROM refresh_tokens WHERE token_id = ?",
		tokenID,
	).Scan(&userID, &expiresAt)
	if err != nil {
		return 0, err
	}
	if time.Now().After(expiresAt) {
		DeleteRefreshToken(tokenID)
		return 0, sql.ErrNoRows
	}
	return userID, nil
}

func DeleteRefreshToken(tokenID string) error {
	_, err := DB.Exec("DELETE FROM refresh_tokens WHERE token_id = ?", tokenID)
	return err
}

func DeleteUserRefreshTokens(userID int64) error {
	_, err := DB.Exec("DELETE FROM refresh_tokens WHERE user_id = ?", userID)
	return err
}
