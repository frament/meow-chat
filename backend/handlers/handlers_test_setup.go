package handlers

import (
	"database/sql"
	"os"
	"testing"

	"my-chat-backend/auth"
	"my-chat-backend/database"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

func setupTestApp(t *testing.T) (*fiber.App, *Handler, int64) {
	t.Helper()

	os.MkdirAll("./uploads/messages", 0755)

	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	database.DB = db

	execs := []string{
		`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, avatar_url TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, from_user_id INTEGER NOT NULL, to_user_id INTEGER NOT NULL, content TEXT NOT NULL, msg_type TEXT DEFAULT 'text', encrypted_content TEXT DEFAULT '', encrypted_iv TEXT DEFAULT '', server_id INTEGER DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (from_user_id) REFERENCES users(id), FOREIGN KEY (to_user_id) REFERENCES users(id))`,
		`CREATE TABLE IF NOT EXISTS message_images (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, image_url TEXT NOT NULL, FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE)`,
		`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, content TEXT NOT NULL, is_public INTEGER DEFAULT 0, server_id INTEGER DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
		`CREATE TABLE IF NOT EXISTS post_images (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, image_url TEXT NOT NULL, FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE)`,
		`CREATE TABLE IF NOT EXISTS post_reactions (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE(post_id, user_id, emoji))`,
		`CREATE TABLE IF NOT EXISTS refresh_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_id TEXT UNIQUE NOT NULL, expires_at DATETIME NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS group_chats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, creator_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS group_chat_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, user_id INTEGER NOT NULL, FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE(group_id, user_id))`,
		`CREATE TABLE IF NOT EXISTS group_chat_invites (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, created_by INTEGER NOT NULL, expires_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE)`,
		`CREATE TABLE IF NOT EXISTS group_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, sender_id INTEGER NOT NULL, content TEXT NOT NULL, msg_type TEXT DEFAULT 'text', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE, FOREIGN KEY (sender_id) REFERENCES users(id))`,
		`CREATE TABLE IF NOT EXISTS group_message_images (id INTEGER PRIMARY KEY AUTOINCREMENT, group_message_id INTEGER NOT NULL, image_url TEXT NOT NULL, FOREIGN KEY (group_message_id) REFERENCES group_messages(id) ON DELETE CASCADE)`,
		`CREATE TABLE IF NOT EXISTS invite_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, created_by INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, max_uses INTEGER DEFAULT 1, use_count INTEGER DEFAULT 0, expires_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS friends (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, server_id INTEGER DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (friend_id) REFERENCES users(id), UNIQUE(user_id, friend_id))`,
		`CREATE TABLE IF NOT EXISTS friend_invites (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS pinned_users (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, pinned_user_id INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (pinned_user_id) REFERENCES users(id), UNIQUE(user_id, pinned_user_id))`,
		`CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS webauthn_credentials (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, credential_id BLOB NOT NULL UNIQUE, public_key BLOB NOT NULL, attestation_type TEXT, aaguid BLOB, sign_count INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS user_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, device_name TEXT NOT NULL, device_public_key TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS device_auth_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, requester_device_id INTEGER NOT NULL, device_public_key TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS user_keys_backup (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE, encrypted_identity_key TEXT NOT NULL, backup_salt TEXT NOT NULL, recovery_phrase_hash TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, server_url TEXT UNIQUE NOT NULL, server_name TEXT, token TEXT, status TEXT DEFAULT 'active', blocked INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_users (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL REFERENCES federation_servers(id), remote_id INTEGER NOT NULL, username TEXT NOT NULL, avatar_url TEXT DEFAULT '', email TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(server_id, remote_id))`,
		`CREATE TABLE IF NOT EXISTS federation_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL, event_type TEXT NOT NULL, payload TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (server_id) REFERENCES federation_servers(id))`,
		`CREATE TABLE IF NOT EXISTS federation_cache_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL, cache_key TEXT NOT NULL, cache_value TEXT, accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (server_id) REFERENCES federation_servers(id))`,
		`CREATE TABLE IF NOT EXISTS federation_network (id INTEGER PRIMARY KEY AUTOINCREMENT, server_a_id INTEGER NOT NULL, server_b_id INTEGER NOT NULL, hop_count INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(server_a_id, server_b_id))`,
		`CREATE TABLE IF NOT EXISTS federation_invites (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (server_id) REFERENCES federation_servers(id))`,
		`CREATE TABLE IF NOT EXISTS federation_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL, remote_post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, content TEXT NOT NULL, is_public INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (server_id) REFERENCES federation_servers(id))`,
	}
	for _, q := range execs {
		if _, err := database.DB.Exec(q); err != nil {
			t.Fatalf("migration: %v", err)
		}
	}

	seedUser := func(username, email string, isAdmin bool) int64 {
		hash, err := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.DefaultCost)
		if err != nil {
			t.Fatal(err)
		}
		adminVal := 0
		if isAdmin {
			adminVal = 1
		}
		res, err := database.DB.Exec("INSERT INTO users (username, email, password, is_admin) VALUES (?, ?, ?, ?)", username, email, string(hash), adminVal)
		if err != nil {
			t.Fatalf("seed user %s: %v", username, err)
		}
		id, _ := res.LastInsertId()
		return id
	}

	userID := seedUser("testuser", "test@example.com", false)
	adminID := seedUser("admin", "admin@localhost", true)

	app := fiber.New()
	h := NewHandler()
	// Drain broadcast channels in background for tests
	go func() {
		for {
			select {
			case <-h.broadcast:
			case <-h.broadcastGroup:
			case <-h.broadcastAll:
			case <-h.broadcastToUser:
			case <-h.register:
			case <-h.unregister:
			case <-h.graceExpired:
			}
		}
	}()
	app.Get("/test-auth", AuthRequired, func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"userId": c.Locals("userId"), "isAdmin": c.Locals("isAdmin")})
	})
	app.Get("/test-admin", AuthRequired, AdminRequired, func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"ok": true})
	})

	app.Post("/register", h.Register)
	app.Post("/login", h.Login)
	app.Post("/refresh", h.Refresh)
	app.Put("/profile", AuthRequired, h.UpdateProfile)
	app.Get("/messages", AuthRequired, h.GetMessages)
	app.Post("/messages", AuthRequired, h.SendMessage)
	app.Post("/posts", AuthRequired, h.CreatePost)
	app.Post("/posts/:id/react", AuthRequired, h.ToggleReaction)
	app.Get("/feed", AuthRequired, h.GetFeed)

	_ = adminID
	return app, h, userID
}

func bearerToken(t *testing.T, userID int64, isAdmin bool) string {
	t.Helper()
	token, err := auth.GenerateAccessToken(userID, isAdmin)
	if err != nil {
		t.Fatal(err)
	}
	return "Bearer " + token
}

func init() {
	os.Setenv("JWT_SECRET", "test-secret-for-testing")
}
