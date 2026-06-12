package federation

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"my-chat-backend/database"
	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
)

type FederationHandler struct {
	transport       *Transport
	queue           *Queue
	health          *HealthChecker
	OnIncomingMessage func(fromUserID, toUserID int64, content, msgType string, createdAt string, images []string)
}

func NewFederationHandler(transport *Transport, queue *Queue, health *HealthChecker) *FederationHandler {
	return &FederationHandler{
		transport: transport,
		queue:     queue,
		health:    health,
	}
}

func (fh *FederationHandler) AuthMiddleware(c *fiber.Ctx) error {
	token := c.Get("X-Federation-Token")
	if token == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Missing federation token"})
	}

	var serverID int64
	err := database.DB.QueryRow(
		"SELECT id FROM federation_servers WHERE server_token = ? AND status = 'active'",
		token,
	).Scan(&serverID)
	if err != nil {
		return c.Status(403).JSON(fiber.Map{"error": "Invalid or inactive federation token"})
	}

	c.Locals("federationServerId", serverID)
	return c.Next()
}

func (fh *FederationHandler) HandleJoinInvite(c *fiber.Ctx) error {
	var req models.FederationJoinRequest
	if err := c.BodyParser(&req); err != nil || req.Token == "" || req.Name == "" || req.BaseURL == "" {
		return c.Status(400).JSON(fiber.Map{"error": "token, name, base_url required"})
	}

	var inviteID int64
	var maxUses, useCount int
	var expiresAt *time.Time
	err := database.DB.QueryRow(
		"SELECT id, max_uses, use_count, expires_at FROM federation_invites WHERE token = ?",
		req.Token,
	).Scan(&inviteID, &maxUses, &useCount, &expiresAt)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Invalid invite token"})
	}

	if maxUses > 0 && useCount >= maxUses {
		return c.Status(410).JSON(fiber.Map{"error": "Invite token exhausted"})
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return c.Status(410).JSON(fiber.Map{"error": "Invite token expired"})
	}

	database.DB.Exec("UPDATE federation_invites SET use_count = use_count + 1 WHERE id = ?", inviteID)

	var existingID int64
	err = database.DB.QueryRow(
		"SELECT id FROM federation_servers WHERE base_url = ?", req.BaseURL,
	).Scan(&existingID)
	if err == nil {
		return c.Status(409).JSON(fiber.Map{"error": "Server already connected"})
	}

	newToken := generateToken()
	result, err := database.DB.Exec(
		"INSERT INTO federation_servers (name, base_url, server_token, status) VALUES (?, ?, ?, 'active')",
		req.Name, req.BaseURL, newToken,
	)
	if err != nil {
		log.Println("Federation HandleJoinInvite insert error:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to register server"})
	}

	serverID, _ := result.LastInsertId()

	hostname, _ := os.Hostname()
	localName := hostname
	if localName == "" {
		localName = "MeowChat Server"
	}

	// Fetch users from the new server and import them
	go func() {
		time.Sleep(500 * time.Millisecond)
		shareResp, shareErr := fh.transport.SendDirect(req.BaseURL+"/api/federation/v1/share-users", "POST", newToken, nil, nil)
		if shareErr == nil && shareResp.StatusCode == 200 {
			var remoteUsers []struct {
				RemoteID  int64  `json:"remote_id"`
				Username  string `json:"username"`
				AvatarURL string `json:"avatar_url"`
				Email     string `json:"email"`
				IsAdmin   bool   `json:"is_admin"`
			}
			if err := json.Unmarshal(shareResp.Body, &remoteUsers); err == nil {
				for _, u := range remoteUsers {
					isAdminInt := 0
					if u.IsAdmin {
						isAdminInt = 1
					}
					database.DB.Exec(
						`INSERT OR IGNORE INTO federation_users (server_id, remote_id, username, avatar_url, email, is_admin) VALUES (?, ?, ?, ?, ?, ?)`,
						serverID, u.RemoteID, u.Username, u.AvatarURL, u.Email, isAdminInt,
					)
				}
				log.Printf("Federation: imported %d users from new peer", len(remoteUsers))
			}
		}
	}()

	return c.Status(201).JSON(models.FederationJoinResponse{
		ServerID:    serverID,
		Name:        localName,
		BaseURL:     c.BaseURL(),
		ServerToken: newToken,
	})
}

func (fh *FederationHandler) HandlePing(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"status": "ok"})
}

func (fh *FederationHandler) HandleSendMessage(c *fiber.Ctx) error {
	var req struct {
		FromUserID int64    `json:"from_user_id"`
		ToUserID   int64    `json:"to_user_id"`
		Content    string   `json:"content"`
		MsgType    string   `json:"msg_type"`
		Images     []string `json:"images,omitempty"`
		CreatedAt  string   `json:"created_at"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	serverID := c.Locals("federationServerId").(int64)

	result, err := database.DB.Exec(
		"INSERT INTO messages (from_user_id, to_user_id, content, msg_type, created_at, server_id) VALUES (?, ?, ?, ?, ?, ?)",
		req.FromUserID, req.ToUserID, req.Content, req.MsgType, req.CreatedAt, serverID,
	)
	if err != nil {
		log.Println("Federation HandleSendMessage error:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save message"})
	}

	messageID, _ := result.LastInsertId()
	for _, imgURL := range req.Images {
		database.DB.Exec(
			"INSERT INTO message_images (message_id, image_url) VALUES (?, ?)",
			messageID, imgURL,
		)
	}

	if fh.OnIncomingMessage != nil {
		fh.OnIncomingMessage(req.FromUserID, req.ToUserID, req.Content, req.MsgType, req.CreatedAt, req.Images)
	}

	return c.Status(201).JSON(fiber.Map{"id": messageID})
}

func (fh *FederationHandler) HandleForwardPost(c *fiber.Ctx) error {
	var req struct {
		UserID    int64    `json:"user_id"`
		Content   string   `json:"content"`
		IsPublic  bool     `json:"is_public"`
		Images    []string `json:"images,omitempty"`
		CreatedAt string   `json:"created_at"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	serverID := c.Locals("federationServerId").(int64)

	isPublicInt := 0
	if req.IsPublic {
		isPublicInt = 1
	}

	result, err := database.DB.Exec(
		"INSERT INTO posts (user_id, content, is_public, created_at, server_id) VALUES (?, ?, ?, ?, ?)",
		req.UserID, req.Content, isPublicInt, req.CreatedAt, serverID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save post"})
	}

	postID, _ := result.LastInsertId()
	for i, imgURL := range req.Images {
		localURL := imgURL
		if strings.HasPrefix(imgURL, "http") {
			localURL = fh.cacheRemoteImage(postID, i, imgURL)
		}
		database.DB.Exec(
			"INSERT INTO post_images (post_id, image_url) VALUES (?, ?)",
			postID, localURL,
		)
	}

	return c.Status(201).JSON(fiber.Map{"id": postID})
}

func (fh *FederationHandler) cacheRemoteImage(postID int64, index int, remoteURL string) string {
	data, err := fh.transport.DownloadFile(remoteURL)
	if err != nil {
		log.Printf("Federation: failed to download post image %s: %v", remoteURL, err)
		return remoteURL
	}

	ext := filepath.Ext(remoteURL)
	if ext == "" {
		ext = ".jpg"
	}
	localName := fmt.Sprintf("fed_post_%d_%d%s", postID, index, ext)
	localPath := filepath.Join(".", "uploads", "posts", localName)

	if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
		log.Printf("Federation: failed to create posts dir: %v", err)
		return remoteURL
	}
	if err := os.WriteFile(localPath, data, 0644); err != nil {
		log.Printf("Federation: failed to write post image %s: %v", localPath, err)
		return remoteURL
	}

	return "/uploads/posts/" + localName
}

func (fh *FederationHandler) HandleForwardKey(c *fiber.Ctx) error {
	var req struct {
		UserID    int64  `json:"user_id"`
		PublicKey string `json:"public_key"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	_, err := database.DB.Exec(
		`INSERT INTO user_keys (user_id, public_key) VALUES (?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET public_key = excluded.public_key, created_at = CURRENT_TIMESTAMP`,
		req.UserID, req.PublicKey,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save key"})
	}

	return c.JSON(fiber.Map{"message": "Key saved"})
}

func (fh *FederationHandler) HandleGetKey(c *fiber.Ctx) error {
	remoteID, err := strconv.ParseInt(c.Params("remoteId"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	var publicKey string
	err = database.DB.QueryRow(
		"SELECT public_key FROM user_keys WHERE user_id = ?", remoteID,
	).Scan(&publicKey)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "No key found"})
	}

	return c.JSON(fiber.Map{"public_key": publicKey})
}

func (fh *FederationHandler) HandleGetUser(c *fiber.Ctx) error {
	remoteID, err := strconv.ParseInt(c.Params("remoteId"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	var u struct {
		ID        int64  `json:"id"`
		Username  string `json:"username"`
		AvatarURL string `json:"avatar_url"`
		Email     string `json:"email"`
	}
	err = database.DB.QueryRow(
		"SELECT id, username, avatar_url, email FROM users WHERE id = ?", remoteID,
	).Scan(&u.ID, &u.Username, &u.AvatarURL, &u.Email)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}

	return c.JSON(u)
}

func (fh *FederationHandler) HandleShareUsers(c *fiber.Ctx) error {
	rows, err := database.DB.Query("SELECT id, username, avatar_url, email, is_admin FROM users ORDER BY id")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
	}
	defer rows.Close()

	users := make([]models.BulkSyncUser, 0)
	for rows.Next() {
		var u models.BulkSyncUser
		if err := rows.Scan(&u.RemoteID, &u.Username, &u.AvatarURL, &u.Email, &u.IsAdmin); err != nil {
			continue
		}
		users = append(users, u)
	}

	return c.JSON(users)
}

func (fh *FederationHandler) HandleBulkUsers(c *fiber.Ctx) error {
	offset, _ := strconv.Atoi(c.Query("offset", "0"))
	limit, _ := strconv.Atoi(c.Query("limit", "100"))
	if limit > 200 {
		limit = 200
	}

	rows, err := database.DB.Query(
		"SELECT id, username, avatar_url, email, is_admin FROM users ORDER BY id LIMIT ? OFFSET ?",
		limit, offset,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
	}
	defer rows.Close()

	users := make([]models.BulkSyncUser, 0)
	for rows.Next() {
		var u models.BulkSyncUser
		if err := rows.Scan(&u.RemoteID, &u.Username, &u.AvatarURL, &u.Email, &u.IsAdmin); err != nil {
			continue
		}
		users = append(users, u)
	}

	return c.JSON(users)
}

func (fh *FederationHandler) HandleBulkMessages(c *fiber.Ctx) error {
	offset, _ := strconv.Atoi(c.Query("offset", "0"))
	limit, _ := strconv.Atoi(c.Query("limit", "100"))
	if limit > 200 {
		limit = 200
	}

	rows, err := database.DB.Query(`
		SELECT from_user_id, to_user_id, content, created_at
		FROM messages
		WHERE server_id IS NULL
		ORDER BY id LIMIT ? OFFSET ?
	`, limit, offset)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch messages"})
	}
	defer rows.Close()

	msgs := make([]models.BulkSyncMessage, 0)
	for rows.Next() {
		var m models.BulkSyncMessage
		if err := rows.Scan(&m.FromUserID, &m.ToUserID, &m.Content, &m.CreatedAt); err != nil {
			continue
		}
		msgs = append(msgs, m)
	}

	return c.JSON(msgs)
}

func (fh *FederationHandler) HandleBulkPosts(c *fiber.Ctx) error {
	offset, _ := strconv.Atoi(c.Query("offset", "0"))
	limit, _ := strconv.Atoi(c.Query("limit", "100"))
	if limit > 200 {
		limit = 200
	}

	rows, err := database.DB.Query(`
		SELECT user_id, content, is_public, created_at
		FROM posts
		WHERE server_id IS NULL
		ORDER BY id LIMIT ? OFFSET ?
	`, limit, offset)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch posts"})
	}
	defer rows.Close()

	posts := make([]models.BulkSyncPost, 0)
	for rows.Next() {
		var p models.BulkSyncPost
		var isPublic int
		if err := rows.Scan(&p.UserID, &p.Content, &isPublic, &p.CreatedAt); err != nil {
			continue
		}
		p.IsPublic = isPublic == 1
		posts = append(posts, p)
	}

	return c.JSON(posts)
}

func (fh *FederationHandler) HandleIntroduce(c *fiber.Ctx) error {
	var req models.GossipIntroduceRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	database.DB.Exec(
		"INSERT OR IGNORE INTO federation_network (server_id, name, base_url, known_by_server_id) VALUES (?, ?, ?, ?)",
		req.ServerID, req.Name, req.BaseURL, c.Locals("federationServerId").(int64),
	)

	return c.JSON(fiber.Map{"message": "introduced"})
}

func (fh *FederationHandler) HandleGossipNewPeer(c *fiber.Ctx) error {
	var req models.GossipNewPeerRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Hops >= 5 {
		return c.JSON(fiber.Map{"message": "max hops reached"})
	}

	database.DB.Exec(
		"INSERT OR IGNORE INTO federation_network (server_id, name, base_url, known_by_server_id) VALUES (?, ?, ?, ?)",
		req.Server.ID, req.Server.Name, req.Server.BaseURL, req.ViaServerID,
	)

	rows, err := database.DB.Query(
		"SELECT id, base_url, server_token FROM federation_servers WHERE status = 'active' AND id != ?",
		req.ViaServerID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to propagate"})
	}
	defer rows.Close()

	for rows.Next() {
		var neighborID int64
		var neighborURL, neighborToken string
		if err := rows.Scan(&neighborID, &neighborURL, &neighborToken); err != nil {
			continue
		}

		req.Hops++
		fh.transport.Send(FederationRequest{
			ServerID: neighborID,
			Endpoint: "/api/federation/v1/gossip/new-peer",
			Method:   "POST",
			Body:     req,
		})
	}

	return c.JSON(fiber.Map{"message": "propagated"})
}

func (fh *FederationHandler) HandleRecoverServer(c *fiber.Ctx) error {
	var req struct {
		RecoveryToken string `json:"recovery_token"`
	}
	if err := c.BodyParser(&req); err != nil || req.RecoveryToken == "" {
		return c.Status(400).JSON(fiber.Map{"error": "recovery_token required"})
	}

	var serverID int64
	err := database.DB.QueryRow(
		"SELECT id FROM federation_servers WHERE server_token = ? AND status = 'pending'",
		req.RecoveryToken,
	).Scan(&serverID)
	if err != nil {
		return c.Status(403).JSON(fiber.Map{"error": "Invalid recovery token"})
	}

	newToken := generateToken()
	database.DB.Exec("UPDATE federation_servers SET server_token = ?, status = 'active' WHERE id = ?", newToken, serverID)

	rows, err := database.DB.Query(
		"SELECT server_id, name, base_url FROM federation_network WHERE server_id != ?",
		serverID,
	)
	knownPeers := make([]models.FederationServer, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var p models.FederationServer
			if err := rows.Scan(&p.ID, &p.Name, &p.BaseURL); err == nil {
				knownPeers = append(knownPeers, p)
			}
		}
	}

	return c.JSON(models.FederationRecoverResponse{
		ServerID:   serverID,
		NewToken:   newToken,
		KnownPeers: knownPeers,
	})
}

func generateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}
