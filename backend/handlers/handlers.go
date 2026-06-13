package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"my-chat-backend/auth"
	"my-chat-backend/database"
	"my-chat-backend/federation"
	"my-chat-backend/models"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/bcrypt"
)



type Handler struct {
	clients         map[*websocket.Conn]int64
	register        chan *wsClient
	unregister      chan *wsClient
	broadcast       chan wsMessage
	broadcastGroup  chan wsMessage
	broadcastAll    chan fiber.Map
	broadcastToUser chan userMessage
	graceExpired    chan int64
	onlineUsers     map[int64]bool
	graceTimers     map[int64]*time.Timer
}

type wsClient struct {
	conn *websocket.Conn
	uid  int64
}

type userMessage struct {
	userID int64
	data   fiber.Map
}

type wsMessage struct {
	messageID         int64
	from              int64
	to                int64
	groupID           int64
	content           string
	msgType           string
	images            []string
	fromName          string
	createdAt         string
	encryptedContent  string
	encryptedIV       string
	pushPreview       string
}

func NewHandler() *Handler {
	h := &Handler{
		clients:         make(map[*websocket.Conn]int64),
		register:        make(chan *wsClient),
		unregister:      make(chan *wsClient),
		broadcast:       make(chan wsMessage),
		broadcastGroup:  make(chan wsMessage),
		broadcastAll:    make(chan fiber.Map),
		broadcastToUser: make(chan userMessage, 10),
		graceExpired:    make(chan int64),
		onlineUsers:     make(map[int64]bool),
		graceTimers:     make(map[int64]*time.Timer),
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
			delivered := false
			for conn, uid := range h.clients {
				if uid == msg.to {
					payload := fiber.Map{
						"type":       "message",
						"from":       msg.from,
						"from_name":  msg.fromName,
						"content":    msg.content,
						"msg_type":   msg.msgType,
						"created_at": msg.createdAt,
					}
					if len(msg.images) > 0 {
						payload["images"] = msg.images
					}
					if msg.encryptedContent != "" {
						payload["encrypted_content"] = msg.encryptedContent
						payload["encrypted_iv"] = msg.encryptedIV
					}
					err := conn.WriteJSON(payload)
					if err != nil {
						log.Println("WebSocket write error:", err)
						conn.Close()
						delete(h.clients, conn)
					} else {
						delivered = true
						// Delete any push copies for this message on delivery
						if msg.messageID > 0 {
							database.DB.Exec("DELETE FROM push_copies WHERE message_id = ?", msg.messageID)
						}
					}
				}
			}
			if !delivered && msg.messageID > 0 {
				preview := msg.pushPreview
				if preview == "" {
					preview = msg.content
				}
				if len(preview) > 120 {
					preview = preview[:120] + "..."
				}
				if preview == "" && len(msg.images) > 0 {
					preview = "[Image]"
				}
				if preview != "" {
					encrypted, err := database.ServerEncrypt([]byte(preview))
					if err == nil {
						expiresAt := time.Now().Add(7 * 24 * time.Hour)
						database.DB.Exec(
							"INSERT INTO push_copies (message_id, for_user_id, server_encrypted_content, expires_at) VALUES (?, ?, ?, ?)",
							msg.messageID, msg.to, encrypted, expiresAt,
						)
					}
				}
				h.sendPushNotification(msg.to,
					"New message from "+msg.fromName,
					preview,
					map[string]interface{}{
						"url":      fmt.Sprintf("/chat/%d", msg.from),
						"senderId": msg.from,
					},
				)
			}

		case msg := <-h.broadcastGroup:
			rows, err := database.DB.Query("SELECT user_id FROM group_chat_members WHERE group_chat_id = ?", msg.groupID)
			if err != nil {
				log.Println("Failed to query group members:", err)
				break
			}
			var memberIDs []int64
			for rows.Next() {
				var uid int64
				rows.Scan(&uid)
				memberIDs = append(memberIDs, uid)
			}
			rows.Close()

			payload := fiber.Map{
				"type":       "group_message",
				"group_id":   msg.groupID,
				"from":       msg.from,
				"from_name":  msg.fromName,
				"content":    msg.content,
				"msg_type":   msg.msgType,
				"created_at": msg.createdAt,
			}
			if len(msg.images) > 0 {
				payload["images"] = msg.images
			}
			if msg.encryptedContent != "" {
				payload["encrypted_content"] = msg.encryptedContent
				payload["encrypted_iv"] = msg.encryptedIV
			}

			for _, memberID := range memberIDs {
				if memberID == msg.from {
					continue
				}
				delivered := false
				for conn, uid := range h.clients {
					if uid == memberID {
						if err := conn.WriteJSON(payload); err != nil {
							log.Println("WebSocket group write error:", err)
							conn.Close()
							delete(h.clients, conn)
						} else {
							delivered = true
						}
					}
				}
				if !delivered {
					preview := msg.content
					if len(preview) > 120 {
						preview = preview[:120] + "..."
					}
					if preview == "" && len(msg.images) > 0 {
						preview = "[Image]"
					}
					var groupName string
					database.DB.QueryRow("SELECT name FROM group_chats WHERE id = ?", msg.groupID).Scan(&groupName)
					h.sendPushNotification(memberID,
						"New message in "+groupName,
						msg.fromName+": "+preview,
						map[string]interface{}{
							"url":      fmt.Sprintf("/chat/group/%d", msg.groupID),
							"groupId":  msg.groupID,
						},
					)
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

		case m := <-h.broadcastToUser:
			for conn, uid := range h.clients {
				if uid == m.userID {
					if err := conn.WriteJSON(m.data); err != nil {
						conn.Close()
						delete(h.clients, conn)
					}
				}
			}
		}
	}
}

func (h *Handler) SendToUser(userID int64, data fiber.Map) {
	select {
	case h.broadcastToUser <- userMessage{userID: userID, data: data}:
	default:
		log.Println("broadcastToUser channel full, dropping message")
	}
}

func (h *Handler) BroadcastDeviceAuthRequest(userID int64, reqID int64, deviceName string) {
	h.SendToUser(userID, fiber.Map{
		"type":        "device_auth_request",
		"id":          reqID,
		"device_name": deviceName,
	})
}

func (h *Handler) BroadcastDeviceApproved(userID int64, deviceID string) {
	h.SendToUser(userID, fiber.Map{
		"type":      "device_approved",
		"device_id": deviceID,
	})
}

func (h *Handler) Register(c *fiber.Ctx) error {
	var req models.RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}
	if req.InviteToken == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invite token required"})
	}

	var tokID, createdBy int64
	var maxUses, useCount int
	var expiresAt *time.Time
	err := database.DB.QueryRow(
		"SELECT id, created_by, max_uses, use_count, expires_at FROM invite_tokens WHERE token = ?",
		req.InviteToken,
	).Scan(&tokID, &createdBy, &maxUses, &useCount, &expiresAt)
	if err == sql.ErrNoRows {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid invite token"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if maxUses > 0 && useCount >= maxUses {
		return c.Status(400).JSON(fiber.Map{"error": "Invite token has been exhausted"})
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return c.Status(400).JSON(fiber.Map{"error": "Invite token has expired"})
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

	database.DB.Exec("UPDATE invite_tokens SET use_count = use_count + 1 WHERE id = ?", tokID)

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
		"SELECT id, username, email, password, avatar_url, is_admin FROM users WHERE username = ?",
		req.Username,
	).Scan(&user.ID, &user.Username, &user.Email, &user.Password, &user.AvatarURL, &user.IsAdmin)

	if err == sql.ErrNoRows {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	accessToken, err := auth.GenerateAccessToken(user.ID, user.IsAdmin)
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
			IsAdmin:   user.IsAdmin,
		},
	})
}

func (h *Handler) GetUsers(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	rows, err := database.DB.Query(`
		SELECT id, username, email, avatar_url, created_at, NULL as server_id
		FROM users
		WHERE id IN (
			SELECT friend_id FROM friends WHERE user_id = ?
			UNION
			SELECT user_id FROM friends WHERE friend_id = ?
		)
		UNION ALL
		SELECT fu.remote_id, fu.username, fu.email, fu.avatar_url, fu.created_at, fu.server_id
		FROM federation_users fu
		WHERE fu.remote_id IN (
			SELECT friend_id FROM friends WHERE user_id = ? AND server_id IS NOT NULL
			UNION
			SELECT user_id FROM friends WHERE friend_id = ? AND server_id IS NOT NULL
		)
		ORDER BY 2
	`, userID, userID, userID, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
	}
	defer rows.Close()

	type userWithServer struct {
		models.User
		ServerID *int64 `json:"server_id,omitempty"`
	}

	users := make([]userWithServer, 0)
	for rows.Next() {
		var u userWithServer
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.AvatarURL, &u.CreatedAt, &u.ServerID); err != nil {
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

	isPublic := false
	if vals, ok := form.Value["is_public"]; ok && len(vals) > 0 {
		isPublic = vals[0] == "true" || vals[0] == "1"
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

	isPublicInt := 0
	if isPublic {
		isPublicInt = 1
	}
	result, err := tx.Exec(
		"INSERT INTO posts (user_id, content, is_public) VALUES (?, ?, ?)",
		userID, content, isPublicInt,
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

	// Forward public posts to all federated servers
	if isPublic && fedTransport != nil {
		rows, err := database.DB.Query("SELECT id FROM federation_servers WHERE status = 'active'")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var serverID int64
				rows.Scan(&serverID)
				fwdImages := make([]string, len(savedImages))
				for i, img := range savedImages {
					fwdImages[i] = c.BaseURL() + img
				}
				fedTransport.Send(federation.FederationRequest{
					ServerID: serverID,
					Endpoint: "/api/federation/v1/forward-post",
					Method:   "POST",
					Body: map[string]interface{}{
						"user_id":    userID,
						"content":    content,
						"is_public":  true,
						"images":     fwdImages,
						"created_at": time.Now().Format(time.RFC3339),
					},
				})
			}
		}
	}

	return c.Status(201).JSON(fiber.Map{"id": postID, "message": "Post created"})
}

func (h *Handler) ToggleReaction(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	postID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid post ID"})
	}

	var body struct {
		Emoji string `json:"emoji"`
	}
	if err := c.BodyParser(&body); err != nil || body.Emoji == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Emoji is required"})
	}

	var existingID int64
	err = database.DB.QueryRow(
		"SELECT id FROM post_reactions WHERE post_id = ? AND user_id = ? AND emoji = ?",
		postID, userID, body.Emoji,
	).Scan(&existingID)

	if err == nil {
		// Reaction exists — remove it
		_, err = database.DB.Exec("DELETE FROM post_reactions WHERE id = ?", existingID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to remove reaction"})
		}
		return c.JSON(fiber.Map{"action": "removed", "emoji": body.Emoji})
	}

	if err != sql.ErrNoRows {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	// Reaction doesn't exist — add it
	_, err = database.DB.Exec(
		"INSERT INTO post_reactions (post_id, user_id, emoji) VALUES (?, ?, ?)",
		postID, userID, body.Emoji,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add reaction"})
	}
	return c.Status(201).JSON(fiber.Map{"action": "added", "emoji": body.Emoji})
}

func (h *Handler) GetFeed(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	rows, err := database.DB.Query(`
		SELECT p.id, p.user_id, p.content, p.created_at, u.username, u.avatar_url, u.is_admin, p.is_public
		FROM posts p
		JOIN users u ON p.user_id = u.id
		WHERE p.user_id = ?
		   OR p.is_public = 1
		   OR p.user_id IN (
			SELECT friend_id FROM friends WHERE user_id = ?
			UNION
			SELECT user_id FROM friends WHERE friend_id = ?
		)
		UNION ALL
		SELECT p.id, p.user_id, p.content, p.created_at, fu.username, fu.avatar_url, fu.is_admin, p.is_public
		FROM posts p
		JOIN federation_users fu ON p.user_id = fu.remote_id AND p.server_id = fu.server_id
		WHERE p.server_id IS NOT NULL
		  AND (p.is_public = 1
		   OR p.user_id IN (
			SELECT friend_id FROM friends WHERE user_id = ? AND friends.server_id IS NOT NULL
			UNION
			SELECT user_id FROM friends WHERE friend_id = ? AND friends.server_id IS NOT NULL
		))
		ORDER BY 4 DESC
		LIMIT 50
	`, userID, userID, userID, userID, userID)
	if err != nil {
		log.Printf("GetFeed query error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch feed"})
	}
	defer rows.Close()

	posts := make([]models.Post, 0)
	for rows.Next() {
		var p models.Post
		var isPublic int
		if err := rows.Scan(&p.ID, &p.UserID, &p.Content, &p.CreatedAt, &p.Username, &p.AvatarURL, &p.IsAdmin, &isPublic); err != nil {
			continue
		}
		p.IsPublic = isPublic == 1

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

		// Fetch reactions
		reactRows, err := database.DB.Query(
			"SELECT emoji, COUNT(*) FROM post_reactions WHERE post_id = ? GROUP BY emoji ORDER BY COUNT(*) DESC",
			p.ID,
		)
		if err == nil {
			for reactRows.Next() {
				var r models.Reaction
				if err := reactRows.Scan(&r.Emoji, &r.Count); err == nil {
					// Check if current user reacted
					var exists int
					database.DB.QueryRow(
						"SELECT COUNT(*) FROM post_reactions WHERE post_id = ? AND user_id = ? AND emoji = ?",
						p.ID, userID, r.Emoji,
					).Scan(&exists)
					r.Reacted = exists == 1
					p.Reactions = append(p.Reactions, r)
				}
			}
			reactRows.Close()
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
		SELECT m.id, m.from_user_id, m.to_user_id, m.content, COALESCE(m.msg_type, 'text'), m.created_at,
			COALESCE(u.username, fu.username) as from_username,
			COALESCE(m.encrypted_content, ''), COALESCE(m.encrypted_iv, ''), m.server_id
		FROM messages m
		LEFT JOIN users u ON m.server_id IS NULL AND m.from_user_id = u.id
		LEFT JOIN federation_users fu ON m.server_id IS NOT NULL AND m.from_user_id = fu.remote_id AND m.server_id = fu.server_id
		WHERE (m.from_user_id = ? AND m.to_user_id = ?)
		   OR (m.from_user_id = ? AND m.to_user_id = ?)
		ORDER BY m.created_at ASC
		LIMIT 100
	`, userID1, userID2, userID2, userID1)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch messages"})
	}
	defer rows.Close()

	messages := make([]models.Message, 0)
	for rows.Next() {
		var m models.Message
		var serverID *int64
		if err := rows.Scan(&m.ID, &m.FromUserID, &m.ToUserID, &m.Content, &m.Type, &m.CreatedAt, &m.FromUser, &m.EncryptedContent, &m.EncryptedIV, &serverID); err != nil {
			continue
		}
		messages = append(messages, m)
	}

	// Fetch images for all messages
	msgIDs := make([]interface{}, 0, len(messages))
	idPos := make([]int64, 0, len(messages))
	for _, m := range messages {
		msgIDs = append(msgIDs, m.ID)
		idPos = append(idPos, m.ID)
	}
	if len(msgIDs) > 0 {
		placeholders := make([]string, len(msgIDs))
		for i := range msgIDs {
			placeholders[i] = "?"
		}
		imgRows, err := database.DB.Query(
			"SELECT id, message_id, image_url FROM message_images WHERE message_id IN ("+strings.Join(placeholders, ",")+")",
			msgIDs...,
		)
		if err == nil {
			defer imgRows.Close()
			imgMap := make(map[int64][]models.PostImage)
			for imgRows.Next() {
				var img models.PostImage
				var msgID int64
				if err := imgRows.Scan(&img.ID, &msgID, &img.ImageURL); err == nil {
					imgMap[msgID] = append(imgMap[msgID], img)
				}
			}
			for i := range messages {
				if imgs, ok := imgMap[messages[i].ID]; ok {
					messages[i].Images = imgs
				}
			}
		}
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

	msgType := "text"
	if vals, ok := form.Value["type"]; ok && len(vals) > 0 && vals[0] != "" {
		msgType = vals[0]
	}

	encryptedContent := ""
	if vals, ok := form.Value["encrypted_content"]; ok && len(vals) > 0 {
		encryptedContent = vals[0]
	}
	encryptedIV := ""
	if vals, ok := form.Value["encrypted_iv"]; ok && len(vals) > 0 {
		encryptedIV = vals[0]
	}
	pushPreview := ""
	if vals, ok := form.Value["push_preview"]; ok && len(vals) > 0 {
		pushPreview = vals[0]
	}
	if pushPreview == "" {
		pushPreview = content
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
		"INSERT INTO messages (from_user_id, to_user_id, content, msg_type, encrypted_content, encrypted_iv) VALUES (?, ?, ?, ?, ?, ?)",
		fromUserID, toUserID, content, msgType, encryptedContent, encryptedIV,
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

	var senderName string
	database.DB.QueryRow("SELECT username FROM users WHERE id = ?", fromUserID).Scan(&senderName)

	h.broadcast <- wsMessage{
		messageID:        messageID,
		from:             fromUserID,
		to:               toUserID,
		content:          content,
		msgType:          msgType,
		images:           images,
		fromName:         senderName,
		createdAt:        time.Now().Format(time.RFC3339),
		encryptedContent: encryptedContent,
		encryptedIV:      encryptedIV,
		pushPreview:      pushPreview,
	}

	// Forward to federated server if recipient is a remote user
	if fedTransport != nil {
		var serverID int64
		err := database.DB.QueryRow(
			"SELECT server_id FROM federation_users WHERE remote_id = ?",
			toUserID,
		).Scan(&serverID)
		if err == nil {
			fwdImages := make([]string, len(images))
			for i, img := range images {
				fwdImages[i] = c.BaseURL() + img
			}
			fedTransport.Send(federation.FederationRequest{
				ServerID: serverID,
				Endpoint: "/api/federation/v1/send-message",
				Method:   "POST",
				Body: map[string]interface{}{
					"from_user_id": fromUserID,
					"to_user_id":   toUserID,
					"content":      content,
					"msg_type":     msgType,
					"images":       fwdImages,
					"created_at":   time.Now().Format(time.RFC3339),
				},
			})
		}
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

	ids := make([]int64, 0)
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

func generateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *Handler) CreateInvite(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var req models.CreateInviteRequest
	if err := c.BodyParser(&req); err != nil {
		req.MaxUses = 1
	}
	if req.MaxUses < 0 {
		req.MaxUses = 0
	}
	if req.MaxUses == 0 {
		req.MaxUses = 1
	}

	token := generateToken()

	var expiresAt *time.Time
	if req.ExpiresIn != "" {
		d, err := time.ParseDuration(req.ExpiresIn)
		if err == nil {
			t := time.Now().Add(d)
			expiresAt = &t
		}
	}

	_, err := database.DB.Exec(
		"INSERT INTO invite_tokens (created_by, token, max_uses, expires_at) VALUES (?, ?, ?, ?)",
		userID, token, req.MaxUses, expiresAt,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create invite"})
	}

	return c.Status(201).JSON(fiber.Map{"token": token})
}

func (h *Handler) GetMyInvites(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	rows, err := database.DB.Query(
		"SELECT id, created_by, token, max_uses, use_count, expires_at, created_at FROM invite_tokens WHERE created_by = ? ORDER BY created_at DESC",
		userID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch invites"})
	}
	defer rows.Close()

	invites := make([]models.InviteToken, 0)
	for rows.Next() {
		var inv models.InviteToken
		if err := rows.Scan(&inv.ID, &inv.CreatedBy, &inv.Token, &inv.MaxUses, &inv.UseCount, &inv.ExpiresAt, &inv.CreatedAt); err != nil {
			continue
		}
		invites = append(invites, inv)
	}
	return c.JSON(invites)
}

func (h *Handler) DeleteInvite(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid invite ID"})
	}

	result, err := database.DB.Exec("DELETE FROM invite_tokens WHERE id = ? AND created_by = ?", id, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to delete invite"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Invite not found"})
	}
	return c.JSON(fiber.Map{"message": "Invite deleted"})
}

func (h *Handler) CheckInvite(c *fiber.Ctx) error {
	token := c.Params("token")

	var id, createdBy int64
	var maxUses, useCount int
	var expiresAt *time.Time
	err := database.DB.QueryRow(
		"SELECT id, created_by, max_uses, use_count, expires_at FROM invite_tokens WHERE token = ?",
		token,
	).Scan(&id, &createdBy, &maxUses, &useCount, &expiresAt)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Invite not found", "valid": false})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	valid := true
	reason := ""
	if maxUses > 0 && useCount >= maxUses {
		valid = false
		reason = "exhausted"
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		valid = false
		reason = "expired"
	}

	var creatorName string
	database.DB.QueryRow("SELECT username FROM users WHERE id = ?", createdBy).Scan(&creatorName)

	return c.JSON(fiber.Map{
		"valid":    valid,
		"reason":   reason,
		"created_by": createdBy,
		"creator":  creatorName,
	})
}

func (h *Handler) CreateFriendInvite(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	token := generateToken()

	_, err := database.DB.Exec(
		"INSERT INTO friend_invites (created_by, token) VALUES (?, ?)",
		userID, token,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create friend invite"})
	}

	return c.Status(201).JSON(fiber.Map{"token": token})
}

func (h *Handler) CheckFriendInvite(c *fiber.Ctx) error {
	token := c.Params("token")

	var id, createdBy int64
	var usedBy *int64
	err := database.DB.QueryRow(
		"SELECT id, created_by, used_by FROM friend_invites WHERE token = ?",
		token,
	).Scan(&id, &createdBy, &usedBy)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Friend invite not found", "valid": false})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	valid := true
	reason := ""
	if usedBy != nil {
		valid = false
		reason = "already_used"
	}

	var creatorName string
	database.DB.QueryRow("SELECT username FROM users WHERE id = ?", createdBy).Scan(&creatorName)

	return c.JSON(fiber.Map{
		"valid":     valid,
		"reason":    reason,
		"created_by": createdBy,
		"creator":   creatorName,
	})
}

func (h *Handler) AcceptFriendInvite(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	token := c.Params("token")

	var id, createdBy int64
	var usedBy *int64
	err := database.DB.QueryRow(
		"SELECT id, created_by, used_by FROM friend_invites WHERE token = ?",
		token,
	).Scan(&id, &createdBy, &usedBy)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Invite not found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	if usedBy != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invite already used"})
	}

	if createdBy == userID {
		return c.Status(400).JSON(fiber.Map{"error": "Cannot accept your own invite"})
	}

	// Store friendship with sorted pair (user_id < friend_id)
	friend1 := createdBy
	friend2 := userID
	if friend1 > friend2 {
		friend1, friend2 = friend2, friend1
	}

	tx, err := database.DB.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		"INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)",
		friend1, friend2,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add friend"})
	}

	_, err = tx.Exec(
		"UPDATE friend_invites SET used_by = ? WHERE id = ?",
		userID, id,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update invite"})
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to accept invite"})
	}

	return c.JSON(fiber.Map{"message": "Friend added"})
}

func (h *Handler) GetFriends(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	rows, err := database.DB.Query(`
		SELECT id, username, email, avatar_url, created_at
		FROM users
		WHERE id IN (
			SELECT friend_id FROM friends WHERE user_id = ?
			UNION
			SELECT user_id FROM friends WHERE friend_id = ?
		)
		ORDER BY username
	`, userID, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch friends"})
	}
	defer rows.Close()

	users := make([]models.User, 0)
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

func (h *Handler) RemoveFriend(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	friendID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	friend1 := userID
	friend2 := friendID
	if friend1 > friend2 {
		friend1, friend2 = friend2, friend1
	}

	result, err := database.DB.Exec(
		"DELETE FROM friends WHERE user_id = ? AND friend_id = ?",
		friend1, friend2,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to remove friend"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Friend not found"})
	}

	return c.JSON(fiber.Map{"message": "Friend removed"})
}

func (h *Handler) AdminListGroupChats(c *fiber.Ctx) error {
	rows, err := database.DB.Query(`
		SELECT g.id, g.name, g.created_by, g.created_at, u.username,
			(SELECT COUNT(*) FROM group_chat_members WHERE group_chat_id = g.id) as member_count
		FROM group_chats g
		JOIN users u ON g.created_by = u.id
		ORDER BY g.created_at DESC
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch groups"})
	}
	defer rows.Close()

	type AdminGroupChat struct {
		ID          int64     `json:"id"`
		Name        string    `json:"name"`
		CreatedBy   int64     `json:"created_by"`
		CreatedByUs string    `json:"created_by_username"`
		MemberCount int       `json:"member_count"`
		CreatedAt   time.Time `json:"created_at"`
	}

	groups := make([]AdminGroupChat, 0)
	for rows.Next() {
		var g AdminGroupChat
		if err := rows.Scan(&g.ID, &g.Name, &g.CreatedBy, &g.CreatedAt, &g.CreatedByUs, &g.MemberCount); err != nil {
			continue
		}
		groups = append(groups, g)
	}
	return c.JSON(groups)
}

func (h *Handler) AdminDeleteGroupChat(c *fiber.Ctx) error {
	groupID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}

	result, err := database.DB.Exec("DELETE FROM group_chats WHERE id = ?", groupID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to delete group"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Group not found"})
	}

	return c.JSON(fiber.Map{"message": "Group deleted"})
}

func (h *Handler) AdminListFiles(c *fiber.Ctx) error {
	type FileEntry struct {
		Name    string `json:"name"`
		Path    string `json:"path"`
		Size    int64  `json:"size"`
		IsDir   bool   `json:"is_dir"`
		ModTime string `json:"mod_time"`
	}

	dirs := []string{"./uploads/avatars", "./uploads/posts", "./uploads/messages"}
	result := make([]FileEntry, 0)

	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			info, err := entry.Info()
			if err != nil {
				continue
			}
			result = append(result, FileEntry{
				Name:    entry.Name(),
				Path:    "/" + dir[1:] + "/" + entry.Name(),
				Size:    info.Size(),
				IsDir:   entry.IsDir(),
				ModTime: info.ModTime().Format(time.RFC3339),
			})
		}
	}

	disk := getDiskUsage("./uploads")

	return c.JSON(fiber.Map{
		"files": result,
		"disk":  disk,
	})
}

func (h *Handler) AdminListUsers(c *fiber.Ctx) error {
	rows, err := database.DB.Query("SELECT id, username, email, avatar_url, is_admin, created_at FROM users ORDER BY username")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
	}
	defer rows.Close()

	type AdminUser struct {
		ID        int64     `json:"id"`
		Username  string    `json:"username"`
		Email     string    `json:"email"`
		AvatarURL string    `json:"avatar_url"`
		IsAdmin   bool      `json:"is_admin"`
		CreatedAt time.Time `json:"created_at"`
		IsOnline  bool      `json:"is_online"`
	}

	users := make([]AdminUser, 0)
	for rows.Next() {
		var u AdminUser
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.AvatarURL, &u.IsAdmin, &u.CreatedAt); err != nil {
			continue
		}
		u.IsOnline = h.onlineUsers[u.ID]
		users = append(users, u)
	}
	return c.JSON(users)
}

func (h *Handler) MakeAdmin(c *fiber.Ctx) error {
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	result, err := database.DB.Exec("UPDATE users SET is_admin = 1 WHERE id = ?", targetID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update user"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}

	return c.JSON(fiber.Map{"message": "User is now an admin"})
}

func (h *Handler) RemoveAdmin(c *fiber.Ctx) error {
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	result, err := database.DB.Exec("UPDATE users SET is_admin = 0 WHERE id = ?", targetID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update user"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}

	return c.JSON(fiber.Map{"message": "Admin rights removed"})
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

		msgType := "text"
		if t, ok := msg["msg_type"].(string); ok && t != "" {
			msgType = t
		}

		encryptedContent := ""
		if ec, ok := msg["encrypted_content"].(string); ok {
			encryptedContent = ec
		}
		encryptedIV := ""
		if ei, ok := msg["encrypted_iv"].(string); ok {
			encryptedIV = ei
		}
		pushPreview := content
		if pp, ok := msg["push_preview"].(string); ok {
			pushPreview = pp
		}

		result, err := database.DB.Exec(
			"INSERT INTO messages (from_user_id, to_user_id, content, msg_type, encrypted_content, encrypted_iv) VALUES (?, ?, ?, ?, ?, ?)",
			uid, int64(to), content, msgType, encryptedContent, encryptedIV,
		)
		if err != nil {
			log.Println("Failed to save message:", err)
			continue
		}
		msgID, _ := result.LastInsertId()

		var senderName string
		database.DB.QueryRow("SELECT username FROM users WHERE id = ?", uid).Scan(&senderName)

		h.broadcast <- wsMessage{
			messageID:        msgID,
			from:             uid,
			to:               int64(to),
			content:          content,
			msgType:          msgType,
			fromName:         senderName,
			encryptedContent: encryptedContent,
			encryptedIV:      encryptedIV,
			pushPreview:      pushPreview,
			createdAt:        time.Now().Format(time.RFC3339),
		}
	}
}
