package database

import (
	"database/sql"
	"testing"
)

// setupOldDB stands up a database as it looked before crypto_scheme existed:
// the tables are there, the column is not, and rows of both kinds are present.
func setupOldDB(t *testing.T) {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	DB = db

	stmts := []string{
		`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, encrypted_content TEXT DEFAULT '')`,
		`CREATE TABLE group_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, encrypted_content TEXT DEFAULT '')`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
}

func TestCryptoScheme_BackfillsExistingRows(t *testing.T) {
	setupOldDB(t)

	// One E2EE message, one plain one, in each table.
	DB.Exec(`INSERT INTO messages (content, encrypted_content) VALUES ('', 'ciphertext')`)
	DB.Exec(`INSERT INTO messages (content, encrypted_content) VALUES ('открытым текстом', '')`)
	DB.Exec(`INSERT INTO group_messages (content, encrypted_content) VALUES ('', 'group-ciphertext')`)

	migrate()

	var scheme string
	if err := DB.QueryRow(`SELECT crypto_scheme FROM messages WHERE encrypted_content = 'ciphertext'`).Scan(&scheme); err != nil {
		t.Fatal(err)
	}
	if scheme != "e2ee" {
		t.Errorf("a message with E2EE ciphertext must be labelled e2ee, got %q", scheme)
	}

	if err := DB.QueryRow(`SELECT crypto_scheme FROM messages WHERE content = 'открытым текстом'`).Scan(&scheme); err != nil {
		t.Fatal(err)
	}
	if scheme != "plain" {
		t.Errorf("a message with no ciphertext must stay plain, got %q - labelling it e2ee would make the reader try a key that was never used", scheme)
	}

	if err := DB.QueryRow(`SELECT crypto_scheme FROM group_messages WHERE encrypted_content = 'group-ciphertext'`).Scan(&scheme); err != nil {
		t.Fatal(err)
	}
	if scheme != "e2ee" {
		t.Errorf("group messages are backfilled by the same rule, got %q", scheme)
	}
}

// The backfill must run exactly once, when the column is created.
//
// Once v1.8.0 writes 'server' rows, they also carry ciphertext in
// encrypted_content. A backfill that runs on every start would relabel them as
// 'e2ee', and the reader would then try the E2EE path on content that is not
// E2EE - unreadable, with no error to point at the cause.
func TestCryptoScheme_SecondStartDoesNotRelabel(t *testing.T) {
	setupOldDB(t)
	migrate()

	if _, err := DB.Exec(
		`INSERT INTO messages (content, encrypted_content, crypto_scheme) VALUES ('', 'server-ciphertext', 'server')`,
	); err != nil {
		t.Fatal(err)
	}

	// A restart.
	migrate()

	var scheme string
	if err := DB.QueryRow(`SELECT crypto_scheme FROM messages WHERE encrypted_content = 'server-ciphertext'`).Scan(&scheme); err != nil {
		t.Fatal(err)
	}
	if scheme != "server" {
		t.Fatalf("a server-scheme row was relabelled to %q on restart", scheme)
	}
}

func TestCryptoScheme_ColumnExists(t *testing.T) {
	setupTestDB(t)

	for _, table := range []string{"messages", "group_messages"} {
		var count int
		if err := DB.QueryRow(
			"SELECT COUNT(*) FROM pragma_table_info('" + table + "') WHERE name='crypto_scheme'",
		).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Errorf("%s has no crypto_scheme column", table)
		}
	}
}
