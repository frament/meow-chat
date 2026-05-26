package main

import (
	"log"
	"os"

	"my-chat-backend/database"
	"my-chat-backend/handlers"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
)

func main() {
	database.InitDB()

	h := handlers.NewHandler()

	app := fiber.New(fiber.Config{
		AppName: "MyChat",
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept, X-User-Id",
	}))

	api := app.Group("/api")

	api.Post("/register", h.Register)
	api.Post("/login", h.Login)

	api.Get("/users", h.GetUsers)

	api.Post("/posts/:userId", h.CreatePost)
	api.Get("/feed", h.GetFeed)

	api.Get("/messages", h.GetMessages)
	api.Post("/messages/:userId", h.SendMessage)

	api.Get("/ws/:userId", websocket.New(func(c *websocket.Conn) {
		c.Locals("userId", c.Params("userId"))
		h.HandleWebSocket(c)
	}))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	log.Fatal(app.Listen(":" + port))
}
