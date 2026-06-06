package database

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var DB *sql.DB

func InitDB() {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}

	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Fatal("Failed to create data directory:", err)
	}

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
	DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('posts') WHERE name='is_public'").Scan(&count)
	if count == 0 {
		DB.Exec("ALTER TABLE posts ADD COLUMN is_public INTEGER DEFAULT 0")
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

	log.Println("Database migrated successfully")
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
