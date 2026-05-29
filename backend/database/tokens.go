package database

import (
	"database/sql"
	"time"
)

func SaveRefreshToken(userID int64, tokenID string, expiresAt time.Time) error {
	_, err := DB.Exec(
		"INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES (?, ?, ?)",
		userID, tokenID, expiresAt,
	)
	return err
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
