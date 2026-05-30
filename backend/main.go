package main

import (
	"log"
	"os"

	"my-chat-backend/auth"
	"my-chat-backend/database"
	"my-chat-backend/handlers"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
)

func main() {
	database.InitDB()

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

	api.Get("/pinned", h.GetPinned)
	api.Post("/pin/:id", h.PinUser)
	api.Delete("/pin/:id", h.UnpinUser)

	api.Post("/logout", h.Logout)
	api.Get("/users", h.GetUsers)

	api.Post("/posts", h.CreatePost)
	api.Get("/feed", h.GetFeed)

	api.Get("/messages", h.GetMessages)
	api.Post("/messages", h.SendMessage)

	api.Post("/upload-avatar", h.UploadAvatar)
	api.Put("/profile", h.UpdateProfile)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	log.Fatal(app.Listen(":" + port))
}
