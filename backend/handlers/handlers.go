package handlers

import (
	"database/sql"
	"log"

	"my-chat-backend/database"
	"my-chat-backend/models"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	clients    map[*websocket.Conn]int64
	register   chan *wsClient
	unregister chan *wsClient
	broadcast  chan wsMessage
}

type wsClient struct {
	conn *websocket.Conn
	uid  int64
}

type wsMessage struct {
	from    int64
	to      int64
	content string
}

func NewHandler() *Handler {
	h := &Handler{
		clients:    make(map[*websocket.Conn]int64),
		register:   make(chan *wsClient),
		unregister: make(chan *wsClient),
		broadcast:  make(chan wsMessage),
	}
	go h.runHub()
	return h
}

func (h *Handler) runHub() {
	for {
		select {
		case client := <-h.register:
			h.clients[client.conn] = client.uid
		case client := <-h.unregister:
			if _, ok := h.clients[client.conn]; ok {
				delete(h.clients, client.conn)
				client.conn.Close()
			}
		case msg := <-h.broadcast:
			for conn, uid := range h.clients {
				if uid == msg.to {
					err := conn.WriteJSON(fiber.Map{
						"type":    "message",
						"from":    msg.from,
						"content": msg.content,
					})
					if err != nil {
						log.Println("WebSocket write error:", err)
						conn.Close()
						delete(h.clients, conn)
					}
				}
			}
		}
	}
}

func (h *Handler) Register(c *fiber.Ctx) error {
	var req models.RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to hash password"})
	}

	result, err := database.DB.Exec(
		"INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
		req.Username, req.Email, string(hashedPassword),
	)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Username or email already exists"})
	}

	id, _ := result.LastInsertId()
	return c.Status(201).JSON(fiber.Map{"id": id, "message": "User created"})
}

func (h *Handler) Login(c *fiber.Ctx) error {
	var req models.LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	var user models.User
	err := database.DB.QueryRow(
		"SELECT id, username, email, password FROM users WHERE username = ?",
		req.Username,
	).Scan(&user.ID, &user.Username, &user.Email, &user.Password)

	if err == sql.ErrNoRows {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	return c.JSON(fiber.Map{
		"id":       user.ID,
		"username": user.Username,
		"email":    user.Email,
	})
}

func (h *Handler) GetUsers(c *fiber.Ctx) error {
	rows, err := database.DB.Query("SELECT id, username, email, created_at FROM users ORDER BY username")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.CreatedAt); err != nil {
			continue
		}
		users = append(users, u)
	}
	return c.JSON(users)
}

func (h *Handler) CreatePost(c *fiber.Ctx) error {
	userID, err := c.ParamsInt("userId")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	var req models.CreatePostRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	result, err := database.DB.Exec(
		"INSERT INTO posts (user_id, content) VALUES (?, ?)",
		userID, req.Content,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create post"})
	}

	id, _ := result.LastInsertId()
	return c.Status(201).JSON(fiber.Map{"id": id, "message": "Post created"})
}

func (h *Handler) GetFeed(c *fiber.Ctx) error {
	rows, err := database.DB.Query(`
		SELECT p.id, p.user_id, p.content, p.created_at, u.username
		FROM posts p
		JOIN users u ON p.user_id = u.id
		ORDER BY p.created_at DESC
		LIMIT 50
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch feed"})
	}
	defer rows.Close()

	var posts []models.Post
	for rows.Next() {
		var p models.Post
		if err := rows.Scan(&p.ID, &p.UserID, &p.Content, &p.CreatedAt, &p.Username); err != nil {
			continue
		}
		posts = append(posts, p)
	}
	return c.JSON(posts)
}

func (h *Handler) GetMessages(c *fiber.Ctx) error {
	userID1 := c.Query("user1")
	userID2 := c.Query("user2")

	rows, err := database.DB.Query(`
		SELECT m.id, m.from_user_id, m.to_user_id, m.content, m.created_at, u.username
		FROM messages m
		JOIN users u ON m.from_user_id = u.id
		WHERE (m.from_user_id = ? AND m.to_user_id = ?)
		   OR (m.from_user_id = ? AND m.to_user_id = ?)
		ORDER BY m.created_at ASC
		LIMIT 100
	`, userID1, userID2, userID2, userID1)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch messages"})
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(&m.ID, &m.FromUserID, &m.ToUserID, &m.Content, &m.CreatedAt, &m.FromUser); err != nil {
			continue
		}
		messages = append(messages, m)
	}
	return c.JSON(messages)
}

func (h *Handler) SendMessage(c *fiber.Ctx) error {
	fromUserID, err := c.ParamsInt("userId")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	var req models.CreateMessageRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	result, err := database.DB.Exec(
		"INSERT INTO messages (from_user_id, to_user_id, content) VALUES (?, ?, ?)",
		fromUserID, req.ToUserID, req.Content,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to send message"})
	}

	id, _ := result.LastInsertId()
	h.broadcast <- wsMessage{from: int64(fromUserID), to: req.ToUserID, content: req.Content}

	return c.Status(201).JSON(fiber.Map{"id": id, "message": "Message sent"})
}

func (h *Handler) HandleWebSocket(c *websocket.Conn) {
	v := c.Locals("userId")
	if v == nil {
		return
	}
	uid := int64(v.(float64))

	client := &wsClient{conn: c, uid: uid}
	h.register <- client

	defer func() {
		h.unregister <- client
	}()

	for {
		var msg map[string]interface{}
		if err := c.ReadJSON(&msg); err != nil {
			break
		}

		to, ok := msg["to"].(float64)
		if !ok {
			continue
		}
		content, ok := msg["content"].(string)
		if !ok {
			continue
		}

		_, err := database.DB.Exec(
			"INSERT INTO messages (from_user_id, to_user_id, content) VALUES (?, ?, ?)",
			uid, int64(to), content,
		)
		if err != nil {
			log.Println("Failed to save message:", err)
			continue
		}

		h.broadcast <- wsMessage{from: uid, to: int64(to), content: content}
	}
}
