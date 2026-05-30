package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"my-chat-backend/auth"
	"my-chat-backend/database"
	"my-chat-backend/models"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	clients      map[*websocket.Conn]int64
	register     chan *wsClient
	unregister   chan *wsClient
	broadcast    chan wsMessage
	broadcastAll chan fiber.Map
	graceExpired chan int64
	onlineUsers  map[int64]bool
	graceTimers  map[int64]*time.Timer
}

type wsClient struct {
	conn *websocket.Conn
	uid  int64
}

type wsMessage struct {
	from    int64
	to      int64
	content string
	images  []string
}

func NewHandler() *Handler {
	h := &Handler{
		clients:      make(map[*websocket.Conn]int64),
		register:     make(chan *wsClient),
		unregister:   make(chan *wsClient),
		broadcast:    make(chan wsMessage),
		broadcastAll: make(chan fiber.Map),
		graceExpired: make(chan int64),
		onlineUsers:  make(map[int64]bool),
		graceTimers:  make(map[int64]*time.Timer),
	}
	go h.runHub()
	return h
}

func (h *Handler) runHub() {
	for {
		select {
		case client := <-h.register:
			h.clients[client.conn] = client.uid
			// Cancel any existing grace timer (reconnect within grace period)
			if t, ok := h.graceTimers[client.uid]; ok {
				t.Stop()
				delete(h.graceTimers, client.uid)
			}
			if !h.onlineUsers[client.uid] {
				h.onlineUsers[client.uid] = true
				for conn := range h.clients {
					conn.WriteJSON(fiber.Map{"type": "user_online", "user_id": client.uid})
				}
			}

		case client := <-h.unregister:
			if _, ok := h.clients[client.conn]; ok {
				delete(h.clients, client.conn)
				client.conn.Close()
			}
			hasOthers := false
			for _, uid := range h.clients {
				if uid == client.uid {
					hasOthers = true
					break
				}
			}
			if !hasOthers && h.onlineUsers[client.uid] {
				h.graceTimers[client.uid] = time.AfterFunc(30*time.Second, func() {
					h.graceExpired <- client.uid
				})
			}

		case uid := <-h.graceExpired:
			delete(h.graceTimers, uid)
			// Verify user hasn't reconnected while timer was pending
			stillOffline := true
			for _, cu := range h.clients {
				if cu == uid {
					stillOffline = false
					break
				}
			}
			if stillOffline && h.onlineUsers[uid] {
				h.onlineUsers[uid] = false
				for conn := range h.clients {
					conn.WriteJSON(fiber.Map{"type": "user_offline", "user_id": uid})
				}
			}

		case msg := <-h.broadcast:
			for conn, uid := range h.clients {
				if uid == msg.to {
					payload := fiber.Map{
						"type":    "message",
						"from":    msg.from,
						"content": msg.content,
					}
					if len(msg.images) > 0 {
						payload["images"] = msg.images
					}
					err := conn.WriteJSON(payload)
					if err != nil {
						log.Println("WebSocket write error:", err)
						conn.Close()
						delete(h.clients, conn)
					}
				}
			}

		case msg := <-h.broadcastAll:
			for conn := range h.clients {
				if err := conn.WriteJSON(msg); err != nil {
					log.Println("WebSocket broadcastAll write error:", err)
					conn.Close()
					delete(h.clients, conn)
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
		"SELECT id, username, email, password, avatar_url FROM users WHERE username = ?",
		req.Username,
	).Scan(&user.ID, &user.Username, &user.Email, &user.Password, &user.AvatarURL)

	if err == sql.ErrNoRows {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	accessToken, err := auth.GenerateAccessToken(user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
	}

	refreshToken, tokenID, err := auth.GenerateRefreshToken(user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to generate refresh token"})
	}

	database.SaveRefreshToken(user.ID, tokenID, time.Now().Add(7*24*time.Hour))

	return c.JSON(models.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User: models.LoginResponse{
			ID:        user.ID,
			Username:  user.Username,
			Email:     user.Email,
			AvatarURL: user.AvatarURL,
		},
	})
}

func (h *Handler) GetUsers(c *fiber.Ctx) error {
	rows, err := database.DB.Query("SELECT id, username, email, avatar_url, created_at FROM users ORDER BY username")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.AvatarURL, &u.CreatedAt); err != nil {
			continue
		}
		u.IsOnline = h.onlineUsers[u.ID]
		users = append(users, u)
	}
	return c.JSON(users)
}

func (h *Handler) CreatePost(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid form data"})
	}

	content := ""
	if vals, ok := form.Value["content"]; ok && len(vals) > 0 {
		content = vals[0]
	}

	files := form.File["images"]
	if len(files) > 10 {
		return c.Status(400).JSON(fiber.Map{"error": "Maximum 10 images allowed"})
	}

	tx, err := database.DB.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create post"})
	}
	defer tx.Rollback()

	result, err := tx.Exec(
		"INSERT INTO posts (user_id, content) VALUES (?, ?)",
		userID, content,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create post"})
	}

	postID, _ := result.LastInsertId()

	var savedImages []string
	for _, file := range files {
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".gif" && ext != ".webp" {
			continue
		}
		if file.Size > 10*1024*1024 {
			continue
		}

		filename := fmt.Sprintf("%d_%d%s", postID, time.Now().UnixMilli(), ext)
		savePath := filepath.Join("./uploads/posts", filename)

		if err := c.SaveFile(file, savePath); err != nil {
			continue
		}

		imageURL := "/uploads/posts/" + filename
		_, err := tx.Exec(
			"INSERT INTO post_images (post_id, image_url) VALUES (?, ?)",
			postID, imageURL,
		)
		if err != nil {
			os.Remove(savePath)
			continue
		}

		savedImages = append(savedImages, imageURL)
	}

	if err := tx.Commit(); err != nil {
		for _, img := range savedImages {
			os.Remove("." + img)
		}
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create post"})
	}

	return c.Status(201).JSON(fiber.Map{"id": postID, "message": "Post created"})
}

func (h *Handler) GetFeed(c *fiber.Ctx) error {
	rows, err := database.DB.Query(`
		SELECT p.id, p.user_id, p.content, p.created_at, u.username, u.avatar_url
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
		if err := rows.Scan(&p.ID, &p.UserID, &p.Content, &p.CreatedAt, &p.Username, &p.AvatarURL); err != nil {
			continue
		}

		imgRows, err := database.DB.Query(
			"SELECT id, post_id, image_url FROM post_images WHERE post_id = ? ORDER BY id",
			p.ID,
		)
		if err == nil {
			for imgRows.Next() {
				var img models.PostImage
				if err := imgRows.Scan(&img.ID, &img.PostID, &img.ImageURL); err == nil {
					p.Images = append(p.Images, img)
				}
			}
			imgRows.Close()
		}

		posts = append(posts, p)
	}
	return c.JSON(posts)
}

func (h *Handler) GetMessages(c *fiber.Ctx) error {
	authUserID := c.Locals("userId").(int64)
	userID1 := c.Query("user1")
	userID2 := c.Query("user2")

	id1, _ := strconv.ParseInt(userID1, 10, 64)
	id2, _ := strconv.ParseInt(userID2, 10, 64)
	if id1 != authUserID && id2 != authUserID {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}

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
	fromUserID := c.Locals("userId").(int64)

	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid form data"})
	}

	toUserID, err := strconv.ParseInt(form.Value["to_user_id"][0], 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid recipient"})
	}

	content := ""
	if vals, ok := form.Value["content"]; ok && len(vals) > 0 {
		content = vals[0]
	}

	files := form.File["images"]
	if len(files) > 10 {
		return c.Status(400).JSON(fiber.Map{"error": "Maximum 10 images allowed"})
	}

	tx, err := database.DB.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to send message"})
	}
	defer tx.Rollback()

	result, err := tx.Exec(
		"INSERT INTO messages (from_user_id, to_user_id, content) VALUES (?, ?, ?)",
		fromUserID, toUserID, content,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to send message"})
	}

	messageID, _ := result.LastInsertId()

	var images []string
	for _, file := range files {
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".gif" && ext != ".webp" {
			continue
		}
		if file.Size > 10*1024*1024 {
			continue
		}

		filename := fmt.Sprintf("%d_%s", messageID, file.Filename)
		savePath := filepath.Join("./uploads/messages", filename)
		if err := c.SaveFile(file, savePath); err != nil {
			continue
		}
		imageURL := "/uploads/messages/" + filename
		images = append(images, imageURL)

		tx.Exec("INSERT INTO message_images (message_id, image_url) VALUES (?, ?)", messageID, imageURL)
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save message"})
	}

	h.broadcast <- wsMessage{
		from:    fromUserID,
		to:      toUserID,
		content: content,
		images:  images,
	}

	return c.Status(201).JSON(fiber.Map{"id": messageID, "message": "Message sent"})
}

func (h *Handler) UploadAvatar(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	file, err := c.FormFile("avatar")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "No file provided"})
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".gif" && ext != ".webp" {
		return c.Status(400).JSON(fiber.Map{"error": "Only image files (jpg, png, gif, webp) are allowed"})
	}

	if file.Size > 5*1024*1024 {
		return c.Status(400).JSON(fiber.Map{"error": "File too large (max 5MB)"})
	}

	filename := fmt.Sprintf("%d_%d%s", userID, time.Now().UnixMilli(), ext)
	savePath := filepath.Join("./uploads/avatars", filename)

	if err := c.SaveFile(file, savePath); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save file"})
	}

	avatarURL := "/uploads/avatars/" + filename
	_, err = database.DB.Exec("UPDATE users SET avatar_url = ? WHERE id = ?", avatarURL, userID)
	if err != nil {
		os.Remove(savePath)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update avatar"})
	}

	return c.JSON(fiber.Map{"avatar_url": avatarURL})
}

func (h *Handler) UpdateProfile(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var req models.UpdateProfileRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Username == "" || req.Email == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Username and email are required"})
	}

	_, err := database.DB.Exec(
		"UPDATE users SET username = ?, email = ? WHERE id = ?",
		req.Username, req.Email, userID,
	)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Username or email already taken"})
	}

	var user models.User
	database.DB.QueryRow(
		"SELECT id, username, email, avatar_url, created_at FROM users WHERE id = ?", userID,
	).Scan(&user.ID, &user.Username, &user.Email, &user.AvatarURL, &user.CreatedAt)

	return c.JSON(fiber.Map{
		"id":         user.ID,
		"username":   user.Username,
		"email":      user.Email,
		"avatar_url": user.AvatarURL,
	})
}

func (h *Handler) GetPinned(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	rows, err := database.DB.Query("SELECT pinned_user_id FROM pinned_users WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch pinned users"})
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			continue
		}
		ids = append(ids, id)
	}
	return c.JSON(fiber.Map{"pinned_user_ids": ids})
}

func (h *Handler) PinUser(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	pinnedID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}
	if userID == pinnedID {
		return c.Status(400).JSON(fiber.Map{"error": "Cannot pin yourself"})
	}

	_, err = database.DB.Exec(
		"INSERT OR IGNORE INTO pinned_users (user_id, pinned_user_id) VALUES (?, ?)",
		userID, pinnedID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to pin user"})
	}
	return c.JSON(fiber.Map{"message": "User pinned"})
}

func (h *Handler) UnpinUser(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	pinnedID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	_, err = database.DB.Exec(
		"DELETE FROM pinned_users WHERE user_id = ? AND pinned_user_id = ?",
		userID, pinnedID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to unpin user"})
	}
	return c.JSON(fiber.Map{"message": "User unpinned"})
}

func (h *Handler) HandleWebSocket(c *websocket.Conn) {
	v := c.Locals("userId")
	if v == nil {
		log.Println("Missing userId in WebSocket locals")
		return
	}
	uid, ok := v.(int64)
	if !ok {
		log.Println("Invalid userId type in WebSocket")
		return
	}

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
