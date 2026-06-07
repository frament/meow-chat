package main

import (
	"fmt"
	"log"
	"os"

	"my-chat-backend/auth"
	"my-chat-backend/database"
	"my-chat-backend/handlers"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	database.InitDB()
	database.SeedAdmin()

	if len(os.Args) > 1 && os.Args[1] == "admin" {
		runAdminCLI()
		return
	}

	h := handlers.NewHandler()
	if err := h.LoadVAPIDKeys(); err != nil {
		log.Fatal("Failed to init VAPID keys:", err)
	}

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

	api.Use(handlers.AuthRequired)

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

	api.Post("/posts", h.CreatePost)
	api.Post("/posts/:id/react", h.ToggleReaction)
	api.Get("/feed", h.GetFeed)

	api.Get("/messages", h.GetMessages)
	api.Post("/messages", h.SendMessage)

	api.Post("/upload-avatar", h.UploadAvatar)
	api.Put("/profile", h.UpdateProfile)

	admin := api.Group("/admin", handlers.AdminRequired)
	admin.Get("/users", h.AdminListUsers)
	admin.Post("/users/:id/make-admin", h.MakeAdmin)
	admin.Post("/users/:id/remove-admin", h.RemoveAdmin)
	admin.Get("/files", h.AdminListFiles)

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
		return
	}

	action := os.Args[2]

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

	default:
		fmt.Printf("Unknown action: %s\n", action)
		fmt.Println("Use: add <username>, remove <username>, list, or reset-password <username> <password>")
	}
}
