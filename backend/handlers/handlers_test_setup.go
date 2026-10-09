package handlers

import (
	"database/sql"
	"os"
	"sync"
	"testing"

	"my-chat-backend/auth"
	"my-chat-backend/database"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

// setupTestAppWithBroadcasts is setupTestApp plus a record of every targeted
// broadcast, which is the only way to assert on one: the harness above drains
// the channel in the background.
func setupTestAppWithBroadcasts(t *testing.T) (*fiber.App, *Handler, int64, *BroadcastLog) {
	t.Helper()
	app, h, userID := setupTestApp(t)

	log := &BroadcastLog{}
	h.onSendToUser = func(id int64, data fiber.Map) {
		log.add(id, data)
	}
	t.Cleanup(func() { h.onSendToUser = nil })

	return app, h, userID, log
}

// BroadcastLog collects targeted broadcasts so a test can assert on them.
type BroadcastLog struct {
	mu   sync.Mutex
	sent []userMessage
}

func (b *BroadcastLog) add(userID int64, data fiber.Map) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sent = append(b.sent, userMessage{userID: userID, data: data})
}

// Of returns the broadcasts addressed to one user.
func (b *BroadcastLog) Of(userID int64) []fiber.Map {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []fiber.Map
	for _, m := range b.sent {
		if m.userID == userID {
			out = append(out, m.data)
		}
	}
	return out
}

// OfType returns the broadcasts of one event type, addressed to anyone.
func (b *BroadcastLog) OfType(event string) []fiber.Map {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []fiber.Map
	for _, m := range b.sent {
		if t, _ := m.data["type"].(string); t == event {
			out = append(out, m.data)
		}
	}
	return out
}

func setupTestApp(t *testing.T) (*fiber.App, *Handler, int64) {
	t.Helper()
	// All four, matching what database.migrate creates in production. Only
	// "messages" was here, so a sticker upload failed with a 500 from c.SaveFile
	// while the production directory existed the whole time - the fixture hid a
	// path the handler depends on.
	for _, dir := range []string{"avatars", "posts", "messages", "stickers"} {
		os.MkdirAll("./uploads/"+dir, 0755)
	}

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

	// One schema, defined once in database.ApplySchema. This file used to carry
	// its own copy of the DDL, and the copies drifted: a column added to the real
	// schema was missing here, so a write against it matched zero rows and the
	// failure showed up only in tests.
	if err := database.ApplySchema(db); err != nil {
		t.Fatalf("schema: %v", err)
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
	app.Post("/messages/read", AuthRequired, h.MarkMessagesRead)
	app.Get("/unread", AuthRequired, h.GetUnread)
	app.Post("/posts", AuthRequired, h.CreatePost)
	app.Delete("/posts/:id", AuthRequired, h.DeletePost)
	app.Post("/posts/:id/react", AuthRequired, h.ToggleReaction)
	app.Get("/feed", AuthRequired, h.GetFeed)
	app.Get("/giphy/status", AuthRequired, h.GiphyStatus)
	app.Post("/push/log", AuthRequired, h.PushClientLog)
	app.Post("/push/log/batch", AuthRequired, h.PushClientLogBatch)
	app.Post("/push/ack", h.PushAck)
	app.Post("/e2ee/decrypt-failed", AuthRequired, h.LogDecryptFailure)

	app.Post("/group-chats", AuthRequired, h.CreateGroupChat)
	app.Get("/group-chats", AuthRequired, h.GetGroupChats)
	app.Get("/group-chats/:id", AuthRequired, h.GetGroupChat)
	app.Post("/group-chats/:id/members", AuthRequired, h.AddGroupMember)
	app.Delete("/group-chats/:id/members/:userId", AuthRequired, h.RemoveGroupMember)
	app.Delete("/group-chats/:id", AuthRequired, h.DeleteGroupChat)
	app.Post("/group-chats/:id/invites", AuthRequired, h.CreateGroupInvite)
	app.Post("/group-chats/:id/keys", AuthRequired, h.UploadGroupKeyShare)
	app.Get("/group-chats/:id/my-key", AuthRequired, h.GetMyGroupKeyShare)
	app.Post("/group-chats/:id/device-keys", AuthRequired, h.UploadGroupDeviceKeyShare)
	app.Get("/group-chats/:id/my-device-key", AuthRequired, h.GetMyGroupDeviceKeyShare)
	app.Get("/group-chats/:id/key-epoch", AuthRequired, h.GetGroupKeyEpoch)
	app.Post("/group-chats/:id/request-key", AuthRequired, h.RequestGroupKey)
	app.Get("/group-chat-invites/:token", AuthRequired, h.GetGroupInvite)
	app.Post("/group-chat-invites/:token/join", AuthRequired, h.JoinGroupViaInvite)
	app.Get("/group-chat-messages/:groupId", AuthRequired, h.GetGroupMessages)
	app.Post("/group-chat-messages", AuthRequired, h.SendGroupMessage)
	app.Post("/group-chats/:groupId/read", AuthRequired, h.MarkGroupRead)

	admin := app.Group("/admin")
	admin.Use(AuthRequired)
	admin.Use(AdminRequired)
	admin.Get("/users", h.AdminListUsers)
	app.Get("/users", AuthRequired, h.GetUsers)
	app.Get("/friends", AuthRequired, h.GetFriends)
	admin.Post("/users/:id/make-admin", h.MakeAdmin)
	admin.Post("/users/:id/remove-admin", h.RemoveAdmin)
	admin.Post("/users/:id/block", h.AdminBlockUser)
	admin.Post("/users/:id/unblock", h.AdminUnblockUser)
	admin.Delete("/users/:id", h.AdminDeleteUser)
	admin.Get("/files", h.AdminListFiles)
	admin.Delete("/files", h.AdminDeleteFile)
	admin.Get("/group-chats", h.AdminListGroupChats)
	admin.Delete("/group-chats/:id", h.AdminDeleteGroupChat)
	admin.Get("/push/logs", h.AdminPushLogs)
	admin.Get("/decrypt-failures", h.AdminDecryptFailures)
	admin.Get("/push/status", h.AdminPushStatus)
	admin.Get("/federation/servers", h.AdminListFederationServers)
	admin.Get("/federation/servers/:id", h.AdminGetFederationServer)
	admin.Put("/federation/servers/:id", h.AdminUpdateFederationServer)
	admin.Post("/federation/servers", h.AdminCreateFederationInvite)
	admin.Post("/federation/servers/:id/block", h.AdminBlockFederationServer)
	admin.Post("/federation/servers/:id/unblock", h.AdminUnblockFederationServer)
	admin.Delete("/federation/servers/:id", h.AdminDeleteFederationServer)
	admin.Delete("/federation/cache/:serverId", h.AdminClearFederationCache)
	admin.Post("/federation/servers/:id/sync-stickers", h.AdminSyncStickerPacks)

	// Sticker packs. Registered here because AdminRenameStickerPack and
	// AdminUploadSticker had no route in the harness at all - the exact
	// "endpoint exists in main.go, test forgot it" case the Backlog describes
	// under «Таблица маршрутов дублируется».
	app.Get("/sticker-packs", h.GetStickerPacks)
	admin.Post("/sticker-packs", h.AdminCreateStickerPack)
	admin.Put("/sticker-packs/:id", h.AdminRenameStickerPack)
	admin.Delete("/sticker-packs/:id", h.AdminDeleteStickerPack)
	admin.Post("/sticker-packs/:id/stickers", h.AdminUploadSticker)
	admin.Delete("/sticker-packs/:id/stickers/:stickerId", h.AdminDeleteSticker)
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
	app.Post("/push/welcome", AuthRequired, h.SendWelcomePush)
	app.Get("/invites", AuthRequired, h.GetMyInvites)

	// Device routes
	devices := app.Group("/devices")
	devices.Use(AuthRequired)
	devices.Post("/register", h.RegisterDevice)
	devices.Get("/", h.ListDevices)
	devices.Delete("/:deviceId", h.RemoveDevice)
	app.Get("/users/:userId/device-keys", AuthRequired, h.GetUserDeviceKeys)
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
	devices.Get("/backup-status", h.GetKeyBackupStatus)

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
	// auth.init() runs first and now stays silent when the variable is missing,
	// so tests can install their own secret. JWT_SECRET may still arrive from the
	// environment (CI does that); SetJWTSecret is idempotent and this only decides
	// who wins, and "the test value" always losing would be the surprising part.
	if os.Getenv("JWT_SECRET") == "" {
		auth.SetJWTSecret("test-secret-for-testing")
	}
}

// mustExec runs a statement and fails the test on error. A bare db.Exec on a
// fixture insert hides a schema mismatch: the row is silently absent and the
// assertion that follows fails somewhere else, pointing nowhere near the cause.
func mustExec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatalf("exec: %v\n  query: %s", err, query)
	}
}
