package database

import (
	"database/sql"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func setupTestDB(t *testing.T) {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	DB = db
	migrate()
}

func TestInitDBCreatesTables(t *testing.T) {
	setupTestDB(t)
	tables := []string{
		"users", "messages", "posts", "post_images", "refresh_tokens",
		"message_images", "group_chats", "group_chat_members", "group_chat_invites",
		"group_messages", "group_message_images", "push_subscriptions",
		"webauthn_credentials", "friends", "friend_invites", "post_reactions",
		"pinned_users", "invite_tokens", "user_devices", "device_auth_requests",
		"user_keys_backup", "federation_servers", "federation_users",
		"federation_queue", "federation_cache_entries", "federation_network",
		"federation_invites",
	}
	for _, name := range tables {
		var exists int
		err := DB.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", name).Scan(&exists)
		if err != nil {
			t.Fatalf("checking table %s: %v", name, err)
		}
		if exists == 0 {
			t.Errorf("table %s not created", name)
		}
	}
}

func TestSeedAdmin(t *testing.T) {
	setupTestDB(t)
	SeedAdmin()

	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users WHERE username='admin' AND is_admin=1").Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("expected 1 admin, got %d", count)
	}

	SeedAdmin()
	err = DB.QueryRow("SELECT COUNT(*) FROM users WHERE username='admin'").Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("SeedAdmin should be idempotent, got %d admins", count)
	}
}

func TestCreateUserAndUniqueUsername(t *testing.T) {
	setupTestDB(t)

	hash, err := bcrypt.GenerateFromPassword([]byte("testpass"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	_, err = DB.Exec("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", "testuser", "test@example.com", string(hash))
	if err != nil {
		t.Fatalf("first insert failed: %v", err)
	}

	_, err = DB.Exec("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", "testuser", "other@example.com", string(hash))
	if err == nil {
		t.Fatal("expected error for duplicate username")
	}
}
