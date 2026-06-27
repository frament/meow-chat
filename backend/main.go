package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"os/exec"
		"path/filepath"
	"strconv"
	"time"

	"my-chat-backend/auth"
	"my-chat-backend/backup"
	"my-chat-backend/cache"
	"my-chat-backend/database"
	"my-chat-backend/federation"
	"my-chat-backend/handlers"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"golang.org/x/crypto/bcrypt"
)

func cleanupExpiredPushCopies() {
	database.DB.Exec("DELETE FROM push_copies WHERE expires_at < datetime('now')")
}

func main() {
	database.InitDB()
	database.SeedAdmin()

	sv, err := database.GetSchemaVersion()
	if err != nil {
		log.Fatalf("Failed to read schema version: %v", err)
	}
	if sv.Major != database.CurrentMajor {
		log.Fatalf("MAJOR version mismatch: database is v%d.x.x, server expects v%d.x.x. Run backup and migrate.", sv.Major, database.CurrentMajor)
	}
	if sv.Minor != database.CurrentMinor || sv.Patch != database.CurrentPatch {
		if err := database.UpdateSchemaVersion(database.CurrentMajor, database.CurrentMinor, database.CurrentPatch); err != nil {
			log.Fatalf("Failed to update schema version: %v", err)
		}
		log.Printf("Schema updated: v%d.%d.%d → v%d.%d.%d", sv.Major, sv.Minor, sv.Patch, database.CurrentMajor, database.CurrentMinor, database.CurrentPatch)
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}
	dataDir := filepath.Dir(dbPath)
	restoredDB := filepath.Join(dataDir, "chat-restored.db")
	if _, err := os.Stat(restoredDB); err == nil {
		log.Println("Found pending restore — applying...")
		if err := os.Rename(restoredDB, dbPath); err != nil {
			log.Fatalf("Failed to apply restore: %v", err)
		}
		os.Remove(filepath.Join(dataDir, ".maintenance"))
		os.Remove(filepath.Join(dataDir, ".restore-pending"))
		log.Println("Restore applied successfully")
	}

	cleanupExpiredPushCopies()

	// Periodic cleanup of expired push copies (every hour)
	go func() {
		for {
			time.Sleep(1 * time.Hour)
			cleanupExpiredPushCopies()
		}
	}()

	if len(os.Args) > 1 && os.Args[1] == "admin" {
		runAdminCLI()
		return
	}

	h := handlers.NewHandler()
	if err := h.LoadVAPIDKeys(); err != nil {
		log.Fatal("Failed to init VAPID keys:", err)
	}

	fedTransport := federation.NewTransport()
	fedQueue := federation.NewQueue(fedTransport)
	fedHealth := federation.NewHealthChecker(fedTransport, fedQueue)
	fedHandler := federation.NewFederationHandler(fedTransport, fedQueue, fedHealth)
	fedHandler.OnIncomingMessage = func(fromUserID, toUserID int64, content, msgType string, createdAt string, images []string) {
		var senderName string
		database.DB.QueryRow("SELECT username FROM federation_users WHERE remote_id = ?", fromUserID).Scan(&senderName)
		h.SendToUser(toUserID, fiber.Map{
			"type":       "message",
			"from":       fromUserID,
			"to":         toUserID,
			"from_name":  senderName,
			"content":    content,
			"msg_type":   msgType,
			"images":     images,
			"created_at": createdAt,
		})
	}
	handlers.InitFederationGlobals(fedTransport, fedQueue, fedHealth)
	cache.EnsureCacheDir()
	fedQueue.Start()
	fedHealth.Start()

	app := fiber.New(fiber.Config{
		AppName: "MyChat",
	})

	app.Static("/uploads", "./uploads")

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept, Authorization",
		AllowMethods: "GET,POST,PUT,DELETE",
	}))

	api := app.Group("/api")

	api.Post("/register", h.Register)
	api.Post("/login", h.Login)
	api.Post("/refresh", h.Refresh)
	api.Get("/version", h.GetVersion)
	api.Get("/check-update", h.CheckUpdate)
	api.Get("/push/vapid-public-key", h.VAPIDPublicKey)
	api.Get("/invite/:token", h.CheckInvite)
	api.Get("/friend-invite/:token", h.CheckFriendInvite)

	api.Post("/webauthn/begin-login", h.WebAuthnBeginLogin)
	api.Post("/webauthn/finish-login", h.WebAuthnFinishLogin)
	api.Post("/webauthn/has-credentials", h.WebAuthnHasCredentials)

	api.Get("/ws", func(c *fiber.Ctx) error {
		token := c.Query("token")
		if token == "" {
			return c.Status(401).JSON(fiber.Map{"error": "Missing token"})
		}
		claims, err := auth.ValidateAccessToken(token)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
		}
		c.Locals("userId", claims.UserID)
		return c.Next()
	}, websocket.New(func(c *websocket.Conn) {
		h.HandleWebSocket(c)
	}))

	api.Get("/keys/:userId", h.GetKey)

	fed := api.Group("/federation/v1")
	fed.Post("/join", fedHandler.HandleJoinInvite)
	fed.Use(fedHandler.AuthMiddleware)
	fed.Head("/ping", fedHandler.HandlePing)
	fed.Post("/ping", fedHandler.HandlePing)
	fed.Post("/send-message", fedHandler.HandleSendMessage)
	fed.Post("/forward-post", fedHandler.HandleForwardPost)
	fed.Post("/forward-key", fedHandler.HandleForwardKey)
	fed.Get("/get-key/:remoteId", fedHandler.HandleGetKey)
	fed.Get("/get-user/:remoteId", fedHandler.HandleGetUser)
	fed.Post("/share-users", fedHandler.HandleShareUsers)
	fed.Get("/bulk/users", fedHandler.HandleBulkUsers)
	fed.Get("/bulk/messages", fedHandler.HandleBulkMessages)
	fed.Get("/bulk/posts", fedHandler.HandleBulkPosts)
	fed.Post("/introduce", fedHandler.HandleIntroduce)
	fed.Post("/gossip/new-peer", fedHandler.HandleGossipNewPeer)
	fed.Post("/recover-server", fedHandler.HandleRecoverServer)

	api.Get("/health", func(c *fiber.Ctx) error {
		dbPath := os.Getenv("DB_PATH")
		if dbPath == "" {
			dbPath = "./data/chat.db"
		}
		if _, err := os.Stat(filepath.Join(filepath.Dir(dbPath), ".maintenance")); err == nil {
			return c.JSON(fiber.Map{"status": "maintenance"})
		}
		return c.JSON(fiber.Map{"status": "ok"})
	})

	api.Use(handlers.AuthRequired)

	dev := api.Group("/devices")
	dev.Post("/register", h.RegisterDevice)
	dev.Get("/", h.ListDevices)
	dev.Delete("/:deviceId", h.RemoveDevice)
	dev.Post("/auth-request", h.CreateAuthRequest)
	dev.Get("/auth-requests", h.ListAuthRequests)
	dev.Get("/auth/:id", h.GetAuthRequest)
	dev.Post("/auth/:id/approve", h.ApproveAuthRequest)
	dev.Delete("/auth/:id", h.DenyAuthRequest)
	dev.Post("/backup-keys", h.UploadKeyBackup)
	dev.Post("/recover", h.RecoverKeys)
	dev.Post("/recovery-phrase", h.GenerateRecoveryPhrase)
	dev.Post("/recovery-phrase/set", h.SetRecoveryPhraseBackup)
	dev.Get("/recovery-phrase", h.GetRecoveryPhraseStatus)

	api.Put("/keys", h.PutKey)

	api.Post("/push/subscribe", h.SubscribePush)
	api.Delete("/push/subscribe", h.UnsubscribePush)

	api.Post("/webauthn/begin-registration", h.WebAuthnBeginRegistration)
	api.Post("/webauthn/finish-registration", h.WebAuthnFinishRegistration)
	api.Get("/webauthn/credentials", h.WebAuthnListCredentials)
	api.Delete("/webauthn/credentials/:id", h.WebAuthnRemoveCredential)

	api.Get("/pinned", h.GetPinned)
	api.Post("/pin/:id", h.PinUser)
	api.Delete("/pin/:id", h.UnpinUser)

	api.Post("/logout", h.Logout)
	api.Get("/users", h.GetUsers)

	api.Post("/invites", h.CreateInvite)
	api.Get("/invites", h.GetMyInvites)
	api.Delete("/invites/:id", h.DeleteInvite)

	api.Post("/friend-invites", h.CreateFriendInvite)
	api.Get("/friends", h.GetFriends)
	api.Delete("/friends/:id", h.RemoveFriend)
	api.Post("/friend-invite/:token/accept", h.AcceptFriendInvite)

	api.Get("/users/search", h.SearchUsers)
	api.Post("/friend-requests/:id", h.SendFriendRequest)
	api.Get("/friend-requests", h.GetFriendRequests)
	api.Post("/friend-requests/:id/accept", h.AcceptFriendRequest)
	api.Delete("/friend-requests/:id", h.RejectFriendRequest)

	api.Post("/posts", h.CreatePost)
	api.Delete("/posts/:id", h.DeletePost)
	api.Post("/posts/:id/react", h.ToggleReaction)
	api.Get("/feed", h.GetFeed)

	api.Get("/messages", h.GetMessages)
	api.Post("/messages", h.SendMessage)

	api.Post("/group-chats", h.CreateGroupChat)
	api.Get("/group-chats", h.GetGroupChats)
	api.Get("/group-chats/:id", h.GetGroupChat)
	api.Post("/group-chats/:id/members", h.AddGroupMember)
	api.Delete("/group-chats/:id/members/:userId", h.RemoveGroupMember)
	api.Delete("/group-chats/:id", h.DeleteGroupChat)
	api.Post("/group-chats/:id/invites", h.CreateGroupInvite)
	api.Post("/group-chats/:id/keys", h.UploadGroupKeyShare)
	api.Get("/group-chats/:id/my-key", h.GetMyGroupKeyShare)
	api.Get("/group-chat-invites/:token", h.GetGroupInvite)
	api.Post("/group-chat-invites/:token/join", h.JoinGroupViaInvite)
	api.Get("/group-chat-messages/:groupId", h.GetGroupMessages)
	api.Post("/group-chat-messages", h.SendGroupMessage)

	api.Post("/polls/:id/vote", h.CastVote)

	api.Post("/upload-avatar", h.UploadAvatar)
	api.Put("/profile", h.UpdateProfile)

	admin := api.Group("/admin", handlers.AdminRequired)
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
	admin.Post("/federation/invites", h.AdminCreateFederationInvite)
	admin.Post("/federation/connect", h.AdminConnectFederation)
	admin.Put("/federation/servers/:id", h.AdminUpdateFederationServer)
	admin.Post("/federation/servers/:id/ping", h.AdminPingFederationServer)
	admin.Post("/federation/servers/:id/block", h.AdminBlockFederationServer)
	admin.Post("/federation/servers/:id/unblock", h.AdminUnblockFederationServer)
	admin.Delete("/federation/servers/:id", h.AdminDeleteFederationServer)
	admin.Delete("/federation/cache/:serverId", h.AdminClearFederationCache)
	admin.Post("/federation/restore", h.AdminRestoreFederation)
	admin.Get("/settings/giphy-key", h.GetGiphyKey)
	admin.Put("/settings/giphy-key", h.UpdateGiphyKey)

	api.Get("/sticker-packs", h.GetStickerPacks)

	admin.Post("/sticker-packs", h.AdminCreateStickerPack)
	admin.Put("/sticker-packs/:id", h.AdminRenameStickerPack)
	admin.Delete("/sticker-packs/:id", h.AdminDeleteStickerPack)
	admin.Post("/sticker-packs/:id/stickers", h.AdminUploadSticker)
	admin.Delete("/sticker-packs/:id/stickers/:stickerId", h.AdminDeleteSticker)

	giphy := api.Group("/giphy", handlers.AuthRequired)
	giphy.Get("/search", h.SearchGiphy)
	giphy.Get("/trending", h.TrendingGiphy)

	bak := api.Group("/admin/backup", handlers.AdminRequired)
	bak.Get("/settings", h.GetBackupSettings)
	bak.Put("/settings", h.UpdateBackupSettings)
	bak.Get("/backups", h.AdminListBackups)
	bak.Post("/backup", h.AdminCreateBackup)
	bak.Post("/backups/upload", h.AdminUploadBackup)
	bak.Get("/backups/:filename", h.AdminDownloadBackup)
	bak.Delete("/backups/:filename", h.AdminDeleteBackup)
	bak.Post("/backups/:filename/restore", h.AdminRestoreBackup)

	backup.WritePIDFile(dbPath)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	log.Fatal(app.Listen(":" + port))
}

func runAdminCLI() {
	if len(os.Args) < 3 {
		fmt.Println("Usage:")
		fmt.Println("  go run . admin add <username>           — Make user an admin")
		fmt.Println("  go run . admin remove <username>        — Remove admin role")
		fmt.Println("  go run . admin list                     — List all admins")
		fmt.Println("  go run . admin reset-password <username> <password> — Reset user password")
		fmt.Println("  go run . admin federation list          — List federation servers")
		fmt.Println("  go run . admin federation invite [n]    — Create federation invite")
		fmt.Println("  go run . admin backup [path]            — Create backup")
		fmt.Println("  go run . admin restore <file.zip>       — Restore from backup")
		return
	}

	action := os.Args[2]
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data/chat.db"
	}
	workingDir, _ := os.Getwd()

	switch action {
	case "add":
		if len(os.Args) < 4 {
			fmt.Println("Usage: go run . admin add <username>")
			return
		}
		username := os.Args[3]
		result, err := database.DB.Exec("UPDATE users SET is_admin = 1 WHERE username = ?", username)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			fmt.Printf("User '%s' not found\n", username)
			return
		}
		fmt.Printf("User '%s' is now an admin\n", username)

	case "remove":
		if len(os.Args) < 4 {
			fmt.Println("Usage: go run . admin remove <username>")
			return
		}
		username := os.Args[3]
		result, err := database.DB.Exec("UPDATE users SET is_admin = 0 WHERE username = ?", username)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			fmt.Printf("User '%s' not found\n", username)
			return
		}
		fmt.Printf("Admin rights removed from '%s'\n", username)

	case "list":
		rows, err := database.DB.Query("SELECT id, username, email, created_at FROM users WHERE is_admin = 1 ORDER BY username")
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		defer rows.Close()

		fmt.Println("Administrators:")
		for rows.Next() {
			var id int64
			var username, email, createdAt string
			if err := rows.Scan(&id, &username, &email, &createdAt); err != nil {
				continue
			}
			fmt.Printf("  #%d  %s  (%s)  since %s\n", id, username, email, createdAt)
		}

	case "reset-password":
		if len(os.Args) < 5 {
			fmt.Println("Usage: go run . admin reset-password <username> <password>")
			return
		}
		username := os.Args[3]
		password := os.Args[4]
		hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		result, err := database.DB.Exec("UPDATE users SET password = ? WHERE username = ?", string(hash), username)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			fmt.Printf("User '%s' not found\n", username)
			return
		}
		fmt.Printf("Password for '%s' has been reset\n", username)

	case "federation":
		if len(os.Args) < 4 {
			fmt.Println("Usage:")
			fmt.Println("  go run . admin federation list")
			fmt.Println("  go run . admin federation invite [max_uses]")
			return
		}
		fedAction := os.Args[3]
		switch fedAction {
		case "list":
			rows, err := database.DB.Query("SELECT id, name, base_url, status, disk_cache_limit FROM federation_servers ORDER BY name")
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			defer rows.Close()
			fmt.Println("Federation servers:")
			for rows.Next() {
				var id, limit int64
				var name, baseURL, status string
				if err := rows.Scan(&id, &name, &baseURL, &status, &limit); err != nil {
					continue
				}
				fmt.Printf("  #%d  %s  %s  [%s]  cache: %dMB\n", id, name, baseURL, status, limit)
			}
		case "invite":
			maxUses := 1
			if len(os.Args) >= 5 {
				maxUses, _ = strconv.Atoi(os.Args[4])
			}
			b := make([]byte, 32)
			rand.Read(b)
			token := hex.EncodeToString(b)
			_, err := database.DB.Exec(
				"INSERT INTO federation_invites (created_by, token, max_uses) VALUES (?, ?, ?)",
				1, token, maxUses,
			)
			if err != nil {
				fmt.Printf("Error: %v\n", err)
				return
			}
			fmt.Printf("Invite token: %s\n", token)
		default:
			fmt.Printf("Unknown federation action: %s\n", fedAction)
		}

	case "backup":
		backupDir := ""
		if len(os.Args) >= 4 {
			backupDir = os.Args[3]
		} else {
			cfg, err := backup.LoadConfig(dbPath)
			if err != nil {
				fmt.Printf("Error loading config: %v\n", err)
				return
			}
			backupDir = cfg.BackupDir
		}
		zipPath, size, err := backup.CreateBackup(database.DB, dbPath, backupDir, workingDir)
		if err != nil {
			fmt.Printf("Error creating backup: %v\n", err)
			return
		}
		fmt.Printf("Backup created: %s (%d bytes)\n", zipPath, size)

	case "restore":
		if len(os.Args) < 4 {
			fmt.Println("Usage: go run . admin restore <file.zip>")
			return
		}
		zipPath := os.Args[3]

		pidFile := backup.PIDFilePath(dbPath)
		if proc, err := backup.FindProcess(pidFile); err == nil && proc != nil {
			fmt.Println("Stopping server...")
			if err := backup.StopProcess(proc); err != nil {
				fmt.Printf("Warning: stop error (ignoring): %v\n", err)
			}
			time.Sleep(1 * time.Second)
		}

		if err := backup.RestoreFromZip(zipPath, dbPath, workingDir); err != nil {
			fmt.Printf("Error restoring: %v\n", err)
			return
		}

		if backup.IsDocker() {
			fmt.Println("Restore complete. Restarting container...")
			backup.ShutdownContainer()
		} else {
			fmt.Println("Restore complete. Starting server...")
			cmd := exec.Command(os.Args[0])
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			cmd.Stdin = os.Stdin
			cmd.Env = os.Environ()
			cmd.Start()
		}

	default:
		fmt.Printf("Unknown action: %s\n", action)
		fmt.Println("Use: add <username>, remove <username>, list, reset-password <username> <password>, federation <list|invite>, backup [path], or restore <file.zip>")
	}
}
