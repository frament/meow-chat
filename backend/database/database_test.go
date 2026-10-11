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
		"federation_invites", "schema_version",
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

// push_copies is gone on purpose, so it must stay gone.
//
// It is listed here rather than only being deleted because of how it went
// missing once already: the writer and reader were removed in 186d751, but the
// CREATE TABLE was re-introduced by the single-schema refactor (5f4d301), and
// for weeks the code cleaned up rows in a table nothing had ever written. A
// table that exists without a writer looks like a feature to the next person
// reading the schema.
func TestPushCopiesTableIsGone(t *testing.T) {
	setupTestDB(t)

	var exists int
	if err := DB.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='push_copies'").Scan(&exists); err != nil {
		t.Fatalf("checking for push_copies: %v", err)
	}
	if exists != 0 {
		t.Error("push_copies exists again - it is a table with no writer and no reader")
	}
}

// The removals run as DROP, so a database that was created before this change
// loses the table on startup rather than keeping it around.
func TestApplySchemaDropsRemovedTablesOnExistingDatabase(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	// Stand in for a database created back when push_copies was still in the
	// schema list, complete with rows nobody can account for.
	if _, err := db.Exec(`CREATE TABLE push_copies (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id INTEGER NOT NULL,
		for_user_id INTEGER NOT NULL,
		server_encrypted_content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME NOT NULL)`); err != nil {
		t.Fatalf("create legacy table: %v", err)
	}
	if _, err := db.Exec(
		"INSERT INTO push_copies (message_id, for_user_id, server_encrypted_content, expires_at) VALUES (1, 1, 'x', '2026-01-01')",
	); err != nil {
		t.Fatalf("insert legacy row: %v", err)
	}

	if err := ApplySchema(db); err != nil {
		t.Fatalf("apply schema over an existing database: %v", err)
	}

	var exists int
	db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='push_copies'").Scan(&exists)
	if exists != 0 {
		t.Error("ApplySchema left push_copies behind on a pre-existing database")
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

func TestSchemaVersion(t *testing.T) {
	setupTestDB(t)
	sv, err := GetSchemaVersion()
	if err != nil {
		t.Fatal(err)
	}
	if sv.Major != CurrentMajor || sv.Minor != CurrentMinor || sv.Patch != CurrentPatch {
		t.Errorf("expected %d.%d.%d, got %d.%d.%d", CurrentMajor, CurrentMinor, CurrentPatch, sv.Major, sv.Minor, sv.Patch)
	}
}

func TestUpdateSchemaVersion(t *testing.T) {
	setupTestDB(t)
	if err := UpdateSchemaVersion(2, 0, 0); err != nil {
		t.Fatal(err)
	}
	sv, _ := GetSchemaVersion()
	if sv.Major != 2 {
		t.Errorf("expected major 2, got %d", sv.Major)
	}
	UpdateSchemaVersion(CurrentMajor, CurrentMinor, CurrentPatch)
}
