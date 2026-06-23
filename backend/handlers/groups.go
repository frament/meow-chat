package handlers

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"my-chat-backend/database"
	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
)

func isGroupMember(groupID, userID int64) bool {
	var count int
	database.DB.QueryRow(
		"SELECT COUNT(*) FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?",
		groupID, userID,
	).Scan(&count)
	return count > 0
}

func (h *Handler) CreateGroupChat(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var req struct {
		Name string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}
	if req.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Group name is required"})
	}

	tx, err := database.DB.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create group"})
	}
	defer tx.Rollback()

	result, err := tx.Exec(
		"INSERT INTO group_chats (name, created_by) VALUES (?, ?)",
		req.Name, userID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create group"})
	}
	groupID, _ := result.LastInsertId()

	_, err = tx.Exec(
		"INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)",
		groupID, userID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add creator"})
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create group"})
	}

	return c.Status(201).JSON(fiber.Map{"id": groupID, "name": req.Name})
}

func (h *Handler) GetGroupChats(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	rows, err := database.DB.Query(`
		SELECT g.id, g.name, g.created_by, g.created_at,
			(SELECT COUNT(*) FROM group_chat_members WHERE group_chat_id = g.id) as member_count
		FROM group_chats g
		JOIN group_chat_members m ON g.id = m.group_chat_id
		WHERE m.user_id = ?
		ORDER BY g.created_at DESC
	`, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch groups"})
	}
	defer rows.Close()

	groups := make([]models.GroupChat, 0)
	for rows.Next() {
		var g models.GroupChat
		if err := rows.Scan(&g.ID, &g.Name, &g.CreatedBy, &g.CreatedAt, &g.MemberCount); err != nil {
			continue
		}
		groups = append(groups, g)
	}

	return c.JSON(groups)
}

func (h *Handler) GetGroupChat(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	groupID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}

	if !isGroupMember(groupID, userID) {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}

	var g models.GroupChat
	err = database.DB.QueryRow(`
		SELECT g.id, g.name, g.created_by, g.created_at,
			(SELECT COUNT(*) FROM group_chat_members WHERE group_chat_id = g.id) as member_count
		FROM group_chats g WHERE g.id = ?
	`, groupID).Scan(&g.ID, &g.Name, &g.CreatedBy, &g.CreatedAt, &g.MemberCount)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Group not found"})
	}

	memberRows, err := database.DB.Query(`
		SELECT gm.user_id, u.username, u.avatar_url
		FROM group_chat_members gm
		JOIN users u ON gm.user_id = u.id
		WHERE gm.group_chat_id = ?
	`, groupID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch members"})
	}
	defer memberRows.Close()

	members := make([]models.GroupMember, 0)
	for memberRows.Next() {
		var m models.GroupMember
		if err := memberRows.Scan(&m.UserID, &m.Username, &m.AvatarURL); err == nil {
			members = append(members, m)
		}
	}

	return c.JSON(fiber.Map{
		"group":   g,
		"members": members,
	})
}

func (h *Handler) AddGroupMember(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	groupID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}

	if !isGroupMember(groupID, userID) {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}

	var req struct {
		Username string `json:"username"`
	}
	if err := c.BodyParser(&req); err != nil || req.Username == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Username required"})
	}

	var targetID int64
	err = database.DB.QueryRow("SELECT id FROM users WHERE username = ?", req.Username).Scan(&targetID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}

	if isGroupMember(groupID, targetID) {
		return c.Status(400).JSON(fiber.Map{"error": "User already in group"})
	}

	_, err = database.DB.Exec(
		"INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)",
		groupID, targetID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add member"})
	}

	return c.JSON(fiber.Map{"message": "Member added"})
}

func (h *Handler) RemoveGroupMember(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	groupID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}

	targetID, err := strconv.ParseInt(c.Params("userId"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	if !isGroupMember(groupID, userID) {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}

	result, err := database.DB.Exec(
		"DELETE FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?",
		groupID, targetID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to remove member"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Member not found"})
	}

	return c.JSON(fiber.Map{"message": "Member removed"})
}

func (h *Handler) CreateGroupInvite(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	groupID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}

	if !isGroupMember(groupID, userID) {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}

	maxUses := 0
	if val := c.Query("max_uses"); val != "" {
		maxUses, _ = strconv.Atoi(val)
	}

	token := generateToken()

	var expiresAt *time.Time
	if val := c.Query("expires_in"); val != "" {
		d, err := time.ParseDuration(val)
		if err == nil {
			t := time.Now().Add(d)
			expiresAt = &t
		}
	}

	_, err = database.DB.Exec(
		"INSERT INTO group_chat_invites (group_chat_id, token, max_uses, expires_at) VALUES (?, ?, ?, ?)",
		groupID, token, maxUses, expiresAt,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create invite"})
	}

	return c.Status(201).JSON(fiber.Map{"token": token})
}

func (h *Handler) GetGroupInvite(c *fiber.Ctx) error {
	token := c.Params("token")

	var inv models.GroupChatInvite
	var expires sql.NullTime
	err := database.DB.QueryRow(`
		SELECT id, group_chat_id, token, max_uses, use_count, expires_at, created_at
		FROM group_chat_invites WHERE token = ?
	`, token).Scan(&inv.ID, &inv.GroupChatID, &inv.Token, &inv.MaxUses, &inv.UseCount, &expires, &inv.CreatedAt)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Invite not found"})
	}
	if expires.Valid {
		inv.ExpiresAt = &expires.Time
	}

	if inv.MaxUses > 0 && inv.UseCount >= inv.MaxUses {
		return c.Status(410).JSON(fiber.Map{"error": "Invite expired"})
	}
	if inv.ExpiresAt != nil && time.Now().After(*inv.ExpiresAt) {
		return c.Status(410).JSON(fiber.Map{"error": "Invite expired"})
	}

	var groupName string
	database.DB.QueryRow("SELECT name FROM group_chats WHERE id = ?", inv.GroupChatID).Scan(&groupName)

	return c.JSON(fiber.Map{
		"group_chat_id": inv.GroupChatID,
		"group_name":    groupName,
		"token":         inv.Token,
	})
}

func (h *Handler) JoinGroupViaInvite(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	token := c.Params("token")

	var inv models.GroupChatInvite
	var expires sql.NullTime
	err := database.DB.QueryRow(`
		SELECT id, group_chat_id, token, max_uses, use_count, expires_at, created_at
		FROM group_chat_invites WHERE token = ?
	`, token).Scan(&inv.ID, &inv.GroupChatID, &inv.Token, &inv.MaxUses, &inv.UseCount, &expires, &inv.CreatedAt)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Invite not found"})
	}
	if expires.Valid {
		inv.ExpiresAt = &expires.Time
	}

	if inv.MaxUses > 0 && inv.UseCount >= inv.MaxUses {
		return c.Status(410).JSON(fiber.Map{"error": "Invite expired"})
	}
	if inv.ExpiresAt != nil && time.Now().After(*inv.ExpiresAt) {
		return c.Status(410).JSON(fiber.Map{"error": "Invite expired"})
	}

	if isGroupMember(inv.GroupChatID, userID) {
		return c.Status(400).JSON(fiber.Map{"error": "Already a member"})
	}

	tx, err := database.DB.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to join"})
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		"INSERT INTO group_chat_members (group_chat_id, user_id) VALUES (?, ?)",
		inv.GroupChatID, userID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to join group"})
	}

	_, err = tx.Exec(
		"UPDATE group_chat_invites SET use_count = use_count + 1 WHERE id = ?",
		inv.ID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update invite"})
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to join"})
	}

	var groupName string
	database.DB.QueryRow("SELECT name FROM group_chats WHERE id = ?", inv.GroupChatID).Scan(&groupName)

	return c.JSON(fiber.Map{
		"message":       "Joined group",
		"group_chat_id": inv.GroupChatID,
		"group_name":    groupName,
	})
}

func (h *Handler) GetGroupMessages(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	groupID, err := strconv.ParseInt(c.Params("groupId"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}

	if !isGroupMember(groupID, userID) {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}

	rows, err := database.DB.Query(`
		SELECT m.id, m.from_user_id, COALESCE(m.msg_type, 'text'), m.content, m.created_at, u.username, COALESCE(m.encrypted_content, ''), COALESCE(m.encrypted_iv, '')
		FROM group_messages m
		JOIN users u ON m.from_user_id = u.id
		WHERE m.group_chat_id = ?
		ORDER BY m.created_at ASC
		LIMIT 100
	`, groupID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch messages"})
	}
	defer rows.Close()

	messages := make([]models.Message, 0)
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(&m.ID, &m.FromUserID, &m.Type, &m.Content, &m.CreatedAt, &m.FromUser, &m.EncryptedContent, &m.EncryptedIV); err != nil {
			continue
		}
		m.GroupChatID = &groupID
		messages = append(messages, m)
	}

	msgIDs := make([]interface{}, 0, len(messages))
	for _, m := range messages {
		msgIDs = append(msgIDs, m.ID)
	}
	if len(msgIDs) > 0 {
		placeholders := make([]string, len(msgIDs))
		for i := range msgIDs {
			placeholders[i] = "?"
		}
		imgRows, err := database.DB.Query(
			"SELECT id, message_id, image_url FROM group_message_images WHERE message_id IN ("+strings.Join(placeholders, ",")+")",
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

		loadPollsForMessages(messages, userID, true)
	}

	return c.JSON(messages)
}

func (h *Handler) DeleteGroupChat(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	groupID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}

	// Only creator or admin can delete
	var createdBy int64
	err = database.DB.QueryRow("SELECT created_by FROM group_chats WHERE id = ?", groupID).Scan(&createdBy)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Group not found"})
	}

	isAdmin, _ := c.Locals("isAdmin").(bool)
	if createdBy != userID && !isAdmin {
		return c.Status(403).JSON(fiber.Map{"error": "Only the group creator can delete this group"})
	}

	_, err = database.DB.Exec("DELETE FROM group_chats WHERE id = ?", groupID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to delete group"})
	}

	return c.JSON(fiber.Map{"message": "Group deleted"})
}

func (h *Handler) SendGroupMessage(c *fiber.Ctx) error {
	fromUserID := c.Locals("userId").(int64)

	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid form data"})
	}

	groupID, err := strconv.ParseInt(form.Value["group_chat_id"][0], 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group chat"})
	}

	if !isGroupMember(groupID, fromUserID) {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
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
	pushPreview := content
	if vals, ok := form.Value["push_preview"]; ok && len(vals) > 0 {
		pushPreview = vals[0]
	}

	pollOptions := form.Value["poll_options[]"]
	pollMultiple := false
	if vals, ok := form.Value["poll_multiple"]; ok && len(vals) > 0 && vals[0] == "true" {
		pollMultiple = true
	}

	if msgType == "poll" {
		if content == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Poll question required"})
		}
		if len(pollOptions) < 2 {
			return c.Status(400).JSON(fiber.Map{"error": "At least 2 poll options required"})
		}
		if len(pollOptions) > 20 {
			return c.Status(400).JSON(fiber.Map{"error": "Maximum 20 poll options allowed"})
		}
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
		"INSERT INTO group_messages (group_chat_id, from_user_id, content, msg_type, encrypted_content, encrypted_iv) VALUES (?, ?, ?, ?, ?, ?)",
		groupID, fromUserID, content, msgType, encryptedContent, encryptedIV,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to send message"})
	}
	messageID, _ := result.LastInsertId()

	var pollID int64
	if msgType == "poll" {
		pres, err := tx.Exec(
			"INSERT INTO polls (group_message_id, question, is_multiple_choice) VALUES (?, ?, ?)",
			messageID, content, pollMultiple,
		)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create poll"})
		}
		pollID, _ = pres.LastInsertId()
		for _, optText := range pollOptions {
			if optText == "" {
				continue
			}
			_, err := tx.Exec(
				"INSERT INTO poll_options (poll_id, text) VALUES (?, ?)",
				pollID, optText,
			)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to create poll option"})
			}
		}
	}

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
		tx.Exec("INSERT INTO group_message_images (group_message_id, image_url) VALUES (?, ?)", messageID, imageURL)
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save message"})
	}

	var senderName string
	database.DB.QueryRow("SELECT username FROM users WHERE id = ?", fromUserID).Scan(&senderName)

	var pollData fiber.Map
	if pollID > 0 {
		options := loadPollOptions(pollID, fromUserID)
		pollData = fiber.Map{
			"id": pollID, "question": content, "is_multiple_choice": pollMultiple, "options": options,
		}
	}

	h.broadcastGroup <- wsMessage{
		messageID:        messageID,
		groupID:          groupID,
		from:             fromUserID,
		content:          content,
		msgType:          msgType,
		images:           images,
		fromName:         senderName,
		createdAt:        time.Now().Format(time.RFC3339),
		encryptedContent: encryptedContent,
		encryptedIV:      encryptedIV,
		pushPreview:      pushPreview,
		pollData:         pollData,
	}

	resp := fiber.Map{"id": messageID, "message": "Message sent"}
	if pollData != nil {
		resp["poll"] = pollData
	}
	return c.Status(201).JSON(resp)
}
