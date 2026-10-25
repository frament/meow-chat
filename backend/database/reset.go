package database

import "fmt"

// ResetUserKeyAndSessions prepares an account for a password reset performed by
// the administrator.
//
// Two things have to happen together, and neither is optional.
//
// The receive key is wrapped with the old password, so after a reset it can no
// longer be opened by anyone. Leaving it active is worse than useless: the
// server would keep wrapping new messages to a key no device can unwrap, and the
// user would see "no key on this device" with a key that looks present.
//
// Refresh tokens are dropped because a device that stays signed in keeps the old
// key in memory and keeps sending messages nobody can read. Sign-in is the only
// moment the new password exists, so it is the only moment a new key can be made.
//
// History is not lost: content lives under the at-rest key, which does not change,
// so the first read after the reset is wrapped to the new key.
func ResetUserKeyAndSessions(userID int64) (keyRetired bool, sessions int64, err error) {
	tx, err := DB.Begin()
	if err != nil {
		return false, 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		"UPDATE user_receive_keys SET retired_at = datetime('now') WHERE user_id = ? AND retired_at IS NULL",
		userID,
	)
	if err != nil {
		return false, 0, fmt.Errorf("retiring receive key: %w", err)
	}
	affected, _ := res.RowsAffected()
	keyRetired = affected > 0

	// Access tokens are not touched: they are not stored server-side. They live
	// for minutes and cannot outlast a refresh cycle, which is why dropping the
	// refresh tokens is enough to force a sign-in.
	res, err = tx.Exec("DELETE FROM refresh_tokens WHERE user_id = ?", userID)
	if err != nil {
		return false, 0, fmt.Errorf("dropping refresh tokens: %w", err)
	}
	sessions, _ = res.RowsAffected()

	if err := tx.Commit(); err != nil {
		return false, 0, err
	}
	return keyRetired, sessions, nil
}
