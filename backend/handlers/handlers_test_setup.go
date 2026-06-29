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

	tmpFile, err := os.CreateTemp("", "chat-test-*.db")
	if err != nil {
		t.Fatal(err)
	}
	tmpFile.Close()
	dbPath := tmpFile.Name()

	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(2)
	database.DB = db
	t.Cleanup(func() { db.Close(); os.Remove(dbPath) })

	execs := []string{
		`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, avatar_url TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, is_banned INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, from_user_id INTEGER NOT NULL, to_user_id INTEGER NOT NULL, content TEXT NOT NULL, msg_type TEXT DEFAULT 'text', encrypted_content TEXT DEFAULT '', encrypted_iv TEXT DEFAULT '', server_id INTEGER DEFAULT NULL, sticker_url TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (from_user_id) REFERENCES users(id), FOREIGN KEY (to_user_id) REFERENCES users(id))`,
		`CREATE TABLE IF NOT EXISTS message_images (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, image_url TEXT NOT NULL, FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE)`,
		`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, content TEXT NOT NULL, is_public INTEGER DEFAULT 0, server_id INTEGER DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
		`CREATE TABLE IF NOT EXISTS post_images (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, image_url TEXT NOT NULL, FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE)`,
		`CREATE TABLE IF NOT EXISTS post_reactions (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id), UNIQUE(post_id, user_id, emoji))`,
		`CREATE TABLE IF NOT EXISTS push_copies (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, for_user_id INTEGER NOT NULL REFERENCES users(id), server_encrypted_content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS refresh_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_id TEXT UNIQUE NOT NULL, expires_at DATETIME NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
		`CREATE TABLE IF NOT EXISTS group_chats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS group_chat_members (group_chat_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (group_chat_id, user_id))`,
		`CREATE TABLE IF NOT EXISTS group_chat_invites (id INTEGER PRIMARY KEY AUTOINCREMENT, group_chat_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE, token TEXT UNIQUE NOT NULL, max_uses INTEGER DEFAULT 0, use_count INTEGER DEFAULT 0, expires_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS group_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_chat_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE, from_user_id INTEGER NOT NULL REFERENCES users(id), content TEXT NOT NULL, msg_type TEXT DEFAULT 'text', encrypted_content TEXT DEFAULT '', encrypted_iv TEXT DEFAULT '', sticker_url TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS group_message_images (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, image_url TEXT NOT NULL, FOREIGN KEY (message_id) REFERENCES group_messages(id) ON DELETE CASCADE)`,
		`CREATE TABLE IF NOT EXISTS invite_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, created_by INTEGER NOT NULL REFERENCES users(id), token TEXT UNIQUE NOT NULL, max_uses INTEGER DEFAULT 1, use_count INTEGER DEFAULT 0, expires_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS friends (user_id INTEGER NOT NULL REFERENCES users(id), friend_id INTEGER NOT NULL REFERENCES users(id), server_id INTEGER DEFAULT NULL REFERENCES federation_servers(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, friend_id), CHECK (user_id < friend_id))`,
		`CREATE TABLE IF NOT EXISTS friend_invites (id INTEGER PRIMARY KEY AUTOINCREMENT, created_by INTEGER NOT NULL REFERENCES users(id), used_by INTEGER REFERENCES users(id), token TEXT UNIQUE NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS friend_requests (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			from_user   INTEGER NOT NULL REFERENCES users(id),
			to_user     INTEGER NOT NULL REFERENCES users(id),
			status      TEXT NOT NULL DEFAULT 'pending',
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(from_user, to_user)
		)`,
		`CREATE TABLE IF NOT EXISTS pinned_users (user_id INTEGER NOT NULL, pinned_user_id INTEGER NOT NULL, PRIMARY KEY (user_id, pinned_user_id), FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (pinned_user_id) REFERENCES users(id))`,
		`CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, UNIQUE(user_id, endpoint))`,
		`CREATE TABLE IF NOT EXISTS webauthn_credentials (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, credential_id BLOB NOT NULL UNIQUE, public_key BLOB NOT NULL, attestation_type TEXT NOT NULL, aaguid BLOB NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS user_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_name TEXT NOT NULL, device_public_key TEXT NOT NULL, device_id TEXT NOT NULL UNIQUE, last_seen DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS device_auth_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_name TEXT NOT NULL, device_public_key TEXT NOT NULL, device_id TEXT NOT NULL, status TEXT DEFAULT 'pending', encrypted_key TEXT, iv TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME DEFAULT (datetime('now', '+15 minutes')))`,
		`CREATE TABLE IF NOT EXISTS user_keys_backup (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, encrypted_key TEXT NOT NULL, iv TEXT NOT NULL, salt TEXT NOT NULL, hash_iterations INTEGER DEFAULT 100000, recovery_phrase_encrypted TEXT, recovery_phrase_salt TEXT, recovery_phrase_iv TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS group_key_shares (id INTEGER PRIMARY KEY AUTOINCREMENT, group_chat_id INTEGER NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), encrypted_key TEXT NOT NULL, iv TEXT NOT NULL, key_creator_id INTEGER DEFAULT NULL REFERENCES users(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(group_chat_id, user_id))`,
		`CREATE TABLE IF NOT EXISTS federation_servers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, base_url TEXT NOT NULL UNIQUE, server_token TEXT NOT NULL, status TEXT DEFAULT 'active', disk_cache_limit INTEGER DEFAULT 512, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_users (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL REFERENCES federation_servers(id), remote_id INTEGER NOT NULL, username TEXT NOT NULL, avatar_url TEXT DEFAULT '', email TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(server_id, remote_id))`,
		`CREATE TABLE IF NOT EXISTS federation_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL REFERENCES federation_servers(id), endpoint TEXT NOT NULL, body TEXT NOT NULL, headers TEXT DEFAULT '', priority INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3, last_error TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_cache_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL REFERENCES federation_servers(id), cache_key TEXT NOT NULL, data_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(server_id, cache_key))`,
		`CREATE TABLE IF NOT EXISTS federation_network (server_id INTEGER PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, known_by_server_id INTEGER NOT NULL, first_seen DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS federation_invites (id INTEGER PRIMARY KEY AUTOINCREMENT, created_by INTEGER NOT NULL REFERENCES users(id), token TEXT UNIQUE NOT NULL, max_uses INTEGER DEFAULT 1, use_count INTEGER DEFAULT 0, expires_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS polls (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE, group_message_id INTEGER REFERENCES group_messages(id) ON DELETE CASCADE, question TEXT NOT NULL, is_multiple_choice INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, CHECK ((message_id IS NOT NULL AND group_message_id IS NULL) OR (message_id IS NULL AND group_message_id IS NOT NULL)))`,
		`CREATE TABLE IF NOT EXISTS poll_options (id INTEGER PRIMARY KEY AUTOINCREMENT, poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE, text TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS poll_votes (id INTEGER PRIMARY KEY AUTOINCREMENT, poll_option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(poll_option_id, user_id))`,
		`CREATE TABLE IF NOT EXISTS sticker_packs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, server_id INTEGER DEFAULT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS stickers (id INTEGER PRIMARY KEY AUTOINCREMENT, pack_id INTEGER NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE, image_url TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
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
	app.Delete("/posts/:id", AuthRequired, h.DeletePost)
	app.Post("/posts/:id/react", AuthRequired, h.ToggleReaction)
	app.Get("/feed", AuthRequired, h.GetFeed)

	app.Post("/group-chats", AuthRequired, h.CreateGroupChat)
	app.Get("/group-chats", AuthRequired, h.GetGroupChats)
	app.Get("/group-chats/:id", AuthRequired, h.GetGroupChat)
	app.Post("/group-chats/:id/members", AuthRequired, h.AddGroupMember)
	app.Delete("/group-chats/:id/members/:userId", AuthRequired, h.RemoveGroupMember)
	app.Delete("/group-chats/:id", AuthRequired, h.DeleteGroupChat)
	app.Post("/group-chats/:id/invites", AuthRequired, h.CreateGroupInvite)
	app.Get("/group-chat-invites/:token", AuthRequired, h.GetGroupInvite)
	app.Post("/group-chat-invites/:token/join", AuthRequired, h.JoinGroupViaInvite)
	app.Get("/group-chat-messages/:groupId", AuthRequired, h.GetGroupMessages)
	app.Post("/group-chat-messages", AuthRequired, h.SendGroupMessage)

	admin := app.Group("/admin")
	admin.Use(AuthRequired)
	admin.Use(AdminRequired)
	admin.Get("/users", h.AdminListUsers)
	admin.Post("/users/:id/make-admin", h.MakeAdmin)
	admin.Post("/users/:id/remove-admin", h.RemoveAdmin)
	admin.Post("/users/:id/block", h.AdminBlockUser)
	admin.Post("/users/:id/unblock", h.AdminUnblockUser)
	admin.Delete("/users/:id", h.AdminDeleteUser)
	admin.Get("/files", h.AdminListFiles)
	admin.Delete("/files", h.AdminDeleteFile)
	admin.Get("/group-chats", h.AdminListGroupChats)
	admin.Delete("/group-chats/:id", h.AdminDeleteGroupChat)
	admin.Get("/federation/servers", h.AdminListFederationServers)
	admin.Get("/federation/servers/:id", h.AdminGetFederationServer)
	admin.Put("/federation/servers/:id", h.AdminUpdateFederationServer)
	admin.Post("/federation/servers", h.AdminCreateFederationInvite)
	admin.Post("/federation/servers/:id/block", h.AdminBlockFederationServer)
	admin.Post("/federation/servers/:id/unblock", h.AdminUnblockFederationServer)
	admin.Delete("/federation/servers/:id", h.AdminDeleteFederationServer)
	admin.Delete("/federation/cache/:serverId", h.AdminClearFederationCache)
	admin.Post("/federation/servers/:id/sync-stickers", h.AdminSyncStickerPacks)
	admin.Get("/backup/settings", h.GetBackupSettings)
	admin.Put("/backup/settings", h.UpdateBackupSettings)
	admin.Get("/backups", h.AdminListBackups)
	admin.Post("/backups", h.AdminCreateBackup)
	admin.Get("/backups/:filename/download", h.AdminDownloadBackup)
	admin.Post("/backups/upload", h.AdminUploadBackup)
	admin.Delete("/backups/:filename", h.AdminDeleteBackup)
	admin.Post("/backups/:filename/restore", h.AdminRestoreBackup)

	_ = adminID

	app.Get("/users/search", AuthRequired, h.SearchUsers)
	app.Post("/friend-requests/:id", AuthRequired, h.SendFriendRequest)
	app.Get("/friend-requests", AuthRequired, h.GetFriendRequests)
	app.Post("/friend-requests/:id/accept", AuthRequired, h.AcceptFriendRequest)
	app.Delete("/friend-requests/:id", AuthRequired, h.RejectFriendRequest)

	app.Post("/polls/:id/vote", AuthRequired, h.CastVote)

	// Push routes
	h.LoadVAPIDKeys()
	app.Get("/push/vapid-public-key", h.VAPIDPublicKey)
	app.Post("/push/subscribe", AuthRequired, h.SubscribePush)
	app.Post("/push/unsubscribe", AuthRequired, h.UnsubscribePush)

	// Device routes
	devices := app.Group("/devices")
	devices.Use(AuthRequired)
	devices.Post("/register", h.RegisterDevice)
	devices.Get("/", h.ListDevices)
	devices.Delete("/:deviceId", h.RemoveDevice)
	devices.Post("/auth-request", h.CreateAuthRequest)
	devices.Get("/auth-requests", h.ListAuthRequests)
	devices.Get("/auth-requests/:id", h.GetAuthRequest)
	devices.Post("/auth-requests/:id/deny", h.DenyAuthRequest)
	devices.Post("/auth-requests/:id/approve", h.ApproveAuthRequest)
	devices.Post("/keys/backup", h.UploadKeyBackup)
	devices.Post("/keys/recover", h.RecoverKeys)
	devices.Post("/recovery/generate", h.GenerateRecoveryPhrase)
	devices.Post("/recovery/set", h.SetRecoveryPhraseBackup)
	devices.Get("/recovery/status", h.GetRecoveryPhraseStatus)

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
