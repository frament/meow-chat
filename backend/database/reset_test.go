package database

import "testing"

// A password reset must leave the account in a state where the next sign-in can
// work. Half of it - password changed, key still active - produces messages
// wrapped to a key no device can open.
func TestResetUserKeyAndSessions(t *testing.T) {
	setupTestDB(t)

	res, err := DB.Exec("INSERT INTO users (username, email, password) VALUES ('u', 'u@e.ml', 'x')")
	if err != nil {
		t.Fatal(err)
	}
	userID, _ := res.LastInsertId()

	if _, err := DB.Exec(
		`INSERT INTO user_receive_keys (user_id, kid, public_key, wrapped_private_key, kdf_salt)
		 VALUES (?, 'k1', 'pub', 'wrapped', 'salt')`, userID,
	); err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{"t1", "t2"} {
		if _, err := DB.Exec(
			"INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))",
			userID, token,
		); err != nil {
			t.Fatal(err)
		}
	}

	keyRetired, sessions, err := ResetUserKeyAndSessions(userID)
	if err != nil {
		t.Fatal(err)
	}
	if !keyRetired {
		t.Error("the active receive key must be retired: it is wrapped with the password that just changed")
	}
	if sessions != 2 {
		t.Errorf("expected 2 sessions dropped, got %d", sessions)
	}

	var active int
	DB.QueryRow(`SELECT COUNT(*) FROM user_receive_keys WHERE user_id = ? AND retired_at IS NULL`, userID).Scan(&active)
	if active != 0 {
		t.Errorf("an active key survived the reset (%d rows)", active)
	}

	var tokens int
	DB.QueryRow(`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ?`, userID).Scan(&tokens)
	if tokens != 0 {
		t.Errorf("%d refresh tokens survived the reset", tokens)
	}

	// After the reset the account is in "no key" state, which is exactly the
	// state that lets the next sign-in create a new one.
	var total int
	DB.QueryRow(`SELECT COUNT(*) FROM user_receive_keys WHERE user_id = ?`, userID).Scan(&total)
	if total != 1 {
		t.Errorf("the retired row must stay, so old wrapped content keeps its kid: got %d rows", total)
	}
}

// The reset is per user: one account's reset must not sign anyone else out.
func TestResetUserKeyAndSessions_DoesNotTouchOtherUsers(t *testing.T) {
	setupTestDB(t)

	ids := make([]int64, 2)
	for i, name := range []string{"a", "b"} {
		res, err := DB.Exec("INSERT INTO users (username, email, password) VALUES (?, ?, 'x')", name, name+"@e.ml")
		if err != nil {
			t.Fatal(err)
		}
		ids[i], _ = res.LastInsertId()
		DB.Exec("INSERT INTO refresh_tokens (user_id, token_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))", ids[i], name+"-token")
	}

	if _, _, err := ResetUserKeyAndSessions(ids[0]); err != nil {
		t.Fatal(err)
	}

	var remaining int
	DB.QueryRow(`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ?`, ids[1]).Scan(&remaining)
	if remaining != 1 {
		t.Error("resetting one account signed another one out")
	}
}
