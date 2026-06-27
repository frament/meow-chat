package database

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"io"
	"log"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var DB *sql.DB

// ServerEncryptionKey is the AES-256-GCM key used for L1 (push copies).
// Generated once on first start, stored in data/server_key.bin.
var ServerEncryptionKey []byte

func loadOrGenerateServerKey() {
	keyPath := filepath.Join(filepath.Dir(os.Getenv("DB_PATH")), "server_key.bin")
	if os.Getenv("DB_PATH") == "" {
		keyPath = "./data/server_key.bin"
	}
	if data, err := os.ReadFile(keyPath); err == nil && len(data) == 32 {
		ServerEncryptionKey = data
		log.Println("Server encryption key loaded")
		return
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		log.Fatal("Failed to generate server encryption key:", err)
	}
	if err := os.MkdirAll(filepath.Dir(keyPath), 0700); err != nil {
		log.Fatal("Failed to create data directory for server key:", err)
	}
	if err := os.WriteFile(keyPath, key, 0600); err != nil {
		log.Fatal("Failed to write server encryption key:", err)
	}
	ServerEncryptionKey = key
	log.Println("Server encryption key generated")
}

// ServerEncrypt encrypts plaintext with the server's AES-256-GCM key.
// Returns base64(iv + ciphertext).
func ServerEncrypt(plaintext []byte) (string, error) {
	block, err := aes.NewCipher(ServerEncryptionKey)
	if err != nil {
		return "", err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	iv := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", err
	}
	ciphertext := aesGCM.Seal(nil, iv, plaintext, nil)
	combined := append(iv, ciphertext...)
	return base64.StdEncoding.EncodeToString(combined), nil
}

// ServerDecrypt decrypts data previously encrypted with ServerEncrypt.
func ServerDecrypt(encoded string) ([]byte, error) {
	combined, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(ServerEncryptionKey)
	if err != nil {
		return nil, err
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	ivSize := aesGCM.NonceSize()
	if len(combined) < ivSize {
		return nil, io.ErrUnexpectedEOF
	}
	iv := combined[:ivSize]
	ciphertext := combined[ivSize:]
	plaintext, err := aesGCM.Open(nil, iv, ciphertext, nil)
	if err != nil {
		return nil, err
	}
	return plaintext, nil
}

func InitDB() {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}

	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Fatal("Failed to create data directory:", err)
	}

	loadOrGenerateServerKey()

	var err error
	DB, err = sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	if err = DB.Ping(); err != nil {
		log.Fatal("Failed to ping database:", err)
	}

	migrate()
}

func migrate() {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			email TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			is_admin INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			from_user_id INTEGER NOT NULL,
			to_user_id INTEGER NOT NULL,
			content TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (from_user_id) REFERENCES users(id),
			FOREIGN KEY (to_user_id) REFERENCES users(id)
		)`,
		`CREATE TABLE IF NOT EXISTS posts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			content TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)`,
		`CREATE TABLE IF NOT EXISTS post_images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			post_id INTEGER NOT NULL,
			image_url TEXT NOT NULL,
			FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS refresh_tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			token_id TEXT UNIQUE NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)`,
		`CREATE TABLE IF NOT EXISTS pinned_users (
			user_id INTEGER NOT NULL,
			pinned_user_id INTEGER NOT NULL,
			PRIMARY KEY (user_id, pinned_user_id),
			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (pinned_user_id) REFERENCES users(id)
		)`,
		`CREATE TABLE IF NOT EXISTS message_images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER NOT NULL,
			image_url TEXT NOT NULL,
			FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS push_subscriptions (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			endpoint    TEXT    NOT NULL,
			p256dh      TEXT    NOT NULL,
			auth        TEXT    NOT NULL,
			UNIQUE(user_id, endpoint)
		)`,
		`CREATE TABLE IF NOT EXISTS invite_tokens (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			created_by  INTEGER NOT NULL REFERENCES users(id),
			token       TEXT UNIQUE NOT NULL,
			max_uses    INTEGER DEFAULT 1,
			use_count   INTEGER DEFAULT 0,
			expires_at  DATETIME,
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS friends (
			user_id     INTEGER NOT NULL REFERENCES users(id),
			friend_id   INTEGER NOT NULL REFERENCES users(id),
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (user_id, friend_id),
			CHECK (user_id < friend_id)
		)`,
		`CREATE TABLE IF NOT EXISTS friend_requests (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			from_user   INTEGER NOT NULL REFERENCES users(id),
			to_user     INTEGER NOT NULL REFERENCES users(id),
			status      TEXT NOT NULL DEFAULT 'pending',
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(from_user, to_user)
		)`,
		`CREATE TABLE IF NOT EXISTS friend_invites (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			created_by  INTEGER NOT NULL REFERENCES users(id),
			token       TEXT UNIQUE NOT NULL,
			used_by     INTEGER REFERENCES users(id),
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS post_reactions (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
			user_id     INTEGER NOT NULL REFERENCES users(id),
			emoji       TEXT NOT NULL,
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(post_id, user_id, emoji)
		)`,
		`CREATE TABLE IF NOT EXISTS webauthn_credentials (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			credential_id   BLOB NOT NULL UNIQUE,
			public_key      BLOB NOT NULL,
			attestation_type TEXT NOT NULL,
			aaguid          BLOB NOT NULL,
			sign_count      INTEGER NOT NULL DEFAULT 0,
			created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS group_chats (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			name        TEXT NOT NULL,
			created_by  INTEGER NOT NULL REFERENCES users(id),
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS group_chat_members (
			group_chat_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
			user_id       INTEGER NOT NULL REFERENCES users(id),
			joined_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (group_chat_id, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS group_chat_invites (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			group_chat_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
			token         TEXT UNIQUE NOT NULL,
			max_uses      INTEGER DEFAULT 0,
			use_count     INTEGER DEFAULT 0,
			expires_at    DATETIME,
			created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS group_messages (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			group_chat_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
			from_user_id  INTEGER NOT NULL REFERENCES users(id),
			content       TEXT NOT NULL,
			msg_type      TEXT DEFAULT 'text',
			created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS group_message_images (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
			image_url  TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS user_keys (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
			public_key TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS push_copies (
			id                       INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id               INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
			for_user_id              INTEGER NOT NULL REFERENCES users(id),
			server_encrypted_content TEXT NOT NULL,
			created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
			expires_at               DATETIME NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS polls (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
			group_message_id INTEGER REFERENCES group_messages(id) ON DELETE CASCADE,
			question TEXT NOT NULL,
			is_multiple_choice INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			CHECK (
				(message_id IS NOT NULL AND group_message_id IS NULL) OR
				(message_id IS NULL AND group_message_id IS NOT NULL)
			)
		)`,
		`CREATE TABLE IF NOT EXISTS poll_options (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
			text TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS poll_votes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			poll_option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
			user_id INTEGER NOT NULL REFERENCES users(id),
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(poll_option_id, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS group_key_shares (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			group_chat_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
			user_id       INTEGER NOT NULL REFERENCES users(id),
			encrypted_key TEXT NOT NULL,
			iv            TEXT NOT NULL,
			created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(group_chat_id, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS federation_servers (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			name            TEXT NOT NULL,
			base_url        TEXT NOT NULL UNIQUE,
			server_token    TEXT NOT NULL,
			status          TEXT DEFAULT 'active',
			disk_cache_limit INTEGER DEFAULT 512,
			created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS federation_users (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id    INTEGER NOT NULL REFERENCES federation_servers(id),
			remote_id    INTEGER NOT NULL,
			username     TEXT NOT NULL,
			avatar_url   TEXT DEFAULT '',
			email        TEXT DEFAULT '',
			is_admin     INTEGER DEFAULT 0,
			created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(server_id, remote_id)
		)`,
		`CREATE TABLE IF NOT EXISTS federation_queue (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id    INTEGER NOT NULL REFERENCES federation_servers(id),
			endpoint     TEXT NOT NULL,
			body         TEXT NOT NULL,
			headers      TEXT DEFAULT '',
			priority     INTEGER DEFAULT 0,
			attempts     INTEGER DEFAULT 0,
			max_attempts INTEGER DEFAULT 3,
			last_error   TEXT DEFAULT '',
			created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS federation_cache_entries (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id   INTEGER NOT NULL REFERENCES federation_servers(id),
			cache_key   TEXT NOT NULL,
			data_type   TEXT NOT NULL,
			size_bytes  INTEGER NOT NULL,
			accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(server_id, cache_key)
		)`,
		`CREATE TABLE IF NOT EXISTS federation_network (
			server_id          INTEGER PRIMARY KEY,
			name               TEXT NOT NULL,
			base_url           TEXT NOT NULL,
			known_by_server_id INTEGER NOT NULL,
			first_seen         DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS federation_invites (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			created_by   INTEGER NOT NULL REFERENCES users(id),
			token        TEXT UNIQUE NOT NULL,
			max_uses     INTEGER DEFAULT 1,
			use_count    INTEGER DEFAULT 0,
			expires_at   DATETIME,
			created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS user_devices (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			device_name       TEXT NOT NULL,
			device_public_key TEXT NOT NULL,
			device_id         TEXT NOT NULL UNIQUE,
			last_seen         DATETIME,
			created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS device_auth_requests (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			device_name       TEXT NOT NULL,
			device_public_key TEXT NOT NULL,
			device_id         TEXT NOT NULL,
			status            TEXT DEFAULT 'pending',
			encrypted_key     TEXT,
			iv                TEXT,
			created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
			expires_at        DATETIME DEFAULT (datetime('now', '+15 minutes'))
		)`,
		`CREATE TABLE IF NOT EXISTS user_keys_backup (
			user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			encrypted_key      TEXT NOT NULL,
			iv                 TEXT NOT NULL,
			salt               TEXT NOT NULL,
			hash_iterations    INTEGER DEFAULT 100000,
			recovery_phrase_encrypted TEXT,
			recovery_phrase_salt     TEXT,
			recovery_phrase_iv       TEXT,
			updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS server_settings (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT ''
		)`,
	}

	for _, q := range queries {
		if _, err := DB.Exec(q); err != nil {
			log.Fatal("Migration failed:", err)
		}
	}

	var count int
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='avatar_url'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''")
	}
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='is_admin'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0")
	}
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='is_banned'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0")
	}
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('posts') WHERE name='is_public'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE posts ADD COLUMN is_public INTEGER DEFAULT 0")
	}
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name='msg_type'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE messages ADD COLUMN msg_type TEXT DEFAULT 'text'")
	}
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name='encrypted_content'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE messages ADD COLUMN encrypted_content TEXT DEFAULT ''")
	}
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name='encrypted_iv'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE messages ADD COLUMN encrypted_iv TEXT DEFAULT ''")
	}
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('group_messages') WHERE name='encrypted_content'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE group_messages ADD COLUMN encrypted_content TEXT DEFAULT ''")
	}
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('group_messages') WHERE name='encrypted_iv'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE group_messages ADD COLUMN encrypted_iv TEXT DEFAULT ''")
	}

	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('friends') WHERE name='server_id'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE friends ADD COLUMN server_id INTEGER DEFAULT NULL REFERENCES federation_servers(id)")
	}
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name='server_id'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE messages ADD COLUMN server_id INTEGER DEFAULT NULL REFERENCES federation_servers(id)")
	}
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('posts') WHERE name='server_id'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE posts ADD COLUMN server_id INTEGER DEFAULT NULL REFERENCES federation_servers(id)")
	}

	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('group_key_shares') WHERE name='key_creator_id'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE group_key_shares ADD COLUMN key_creator_id INTEGER DEFAULT NULL REFERENCES users(id)")
	}

	if err := os.MkdirAll("./uploads/avatars", 0755); err != nil {
		log.Fatal("Failed to create uploads directory:", err)
	}
	if err := os.MkdirAll("./uploads/posts", 0755); err != nil {
		log.Fatal("Failed to create posts uploads directory:", err)
	}
	if err := os.MkdirAll("./uploads/messages", 0755); err != nil {
		log.Fatal("Failed to create messages uploads directory:", err)
	}

	if err := InitSchemaVersion(); err != nil {
		log.Fatal("Schema version init failed:", err)
	}

	log.Println("Database migrated successfully")
}

func GetSetting(key string) (string, error) {
	var value string
	err := DB.QueryRow("SELECT value FROM server_settings WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func SetSetting(key, value string) error {
	_, err := DB.Exec("INSERT OR REPLACE INTO server_settings (key, value) VALUES (?, ?)", key, value)
	return err
}

func GetWebAuthnCredentials(userID int64) ([]WebAuthnCredentialRow, error) {
	rows, err := DB.Query(
		"SELECT id, user_id, credential_id, public_key, attestation_type, aaguid, sign_count, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at ASC",
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var creds []WebAuthnCredentialRow
	for rows.Next() {
		var c WebAuthnCredentialRow
		if err := rows.Scan(&c.ID, &c.UserID, &c.CredentialID, &c.PublicKey, &c.AttestationType, &c.AAGUID, &c.SignCount, &c.CreatedAt); err != nil {
			continue
		}
		creds = append(creds, c)
	}
	return creds, nil
}

func SaveWebAuthnCredential(userID int64, credentialID, publicKey, aaguid []byte, attestationType string, signCount uint32) error {
	_, err := DB.Exec(
		"INSERT INTO webauthn_credentials (user_id, credential_id, public_key, attestation_type, aaguid, sign_count) VALUES (?, ?, ?, ?, ?, ?)",
		userID, credentialID, publicKey, attestationType, aaguid, signCount,
	)
	return err
}

func DeleteWebAuthnCredential(id int64, userID int64) error {
	result, err := DB.Exec("DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?", id, userID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func CountWebAuthnCredentials(userID int64) (int, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = ?", userID).Scan(&count)
	return count, err
}

type WebAuthnCredentialRow struct {
	ID              int64
	UserID          int64
	CredentialID    []byte
	PublicKey       []byte
	AttestationType string
	AAGUID          []byte
	SignCount       uint32
	CreatedAt       string
}

type SchemaVersion struct {
	Major int
	Minor int
	Patch int
}

const CurrentMajor = 1
const CurrentMinor = 0
const CurrentPatch = 0

func InitSchemaVersion() error {
	_, err := DB.Exec(`CREATE TABLE IF NOT EXISTS schema_version (
		major INTEGER NOT NULL,
		minor INTEGER NOT NULL,
		patch INTEGER NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return err
	}

	var count int
	DB.QueryRow("SELECT COUNT(*) FROM schema_version").Scan(&count)
	if count == 0 {
		_, err = DB.Exec("INSERT INTO schema_version (major, minor, patch) VALUES (?, ?, ?)",
			CurrentMajor, CurrentMinor, CurrentPatch)
	}
	return err
}

func GetSchemaVersion() (*SchemaVersion, error) {
	var sv SchemaVersion
	err := DB.QueryRow("SELECT major, minor, patch FROM schema_version LIMIT 1").Scan(&sv.Major, &sv.Minor, &sv.Patch)
	if err != nil {
		return nil, err
	}
	return &sv, nil
}

func UpdateSchemaVersion(major, minor, patch int) error {
	_, err := DB.Exec("UPDATE schema_version SET major = ?, minor = ?, patch = ?, updated_at = CURRENT_TIMESTAMP", major, minor, patch)
	return err
}

func SeedAdmin() {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users WHERE is_admin = 1").Scan(&count)
	if err != nil {
		log.Println("Failed to check admin count:", err)
		return
	}
	if count > 0 {
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
	if err != nil {
		log.Println("Failed to hash admin password:", err)
		return
	}
	_, err = DB.Exec(
		"INSERT OR IGNORE INTO users (username, email, password, is_admin) VALUES (?, ?, ?, 1)",
		"admin", "admin@meowchat.local", string(hash),
	)
	if err != nil {
		log.Println("Failed to seed admin user:", err)
		return
	}
	log.Println("Default admin user created (admin/admin)")
}
