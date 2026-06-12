package handlers

import (
	"database/sql"
	"strconv"

	"my-chat-backend/database"
	"my-chat-backend/federation"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) PutKey(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var body struct {
		PublicKey string `json:"public_key"`
	}
	if err := c.BodyParser(&body); err != nil || body.PublicKey == "" {
		return c.Status(400).JSON(fiber.Map{"error": "public_key is required"})
	}

	_, err := database.DB.Exec(
		`INSERT INTO user_keys (user_id, public_key) VALUES (?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET public_key = excluded.public_key, created_at = CURRENT_TIMESTAMP`,
		userID, body.PublicKey,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save key"})
	}

	// Forward key to all federated servers
	if fedTransport != nil {
		rows, err := database.DB.Query("SELECT id FROM federation_servers WHERE status = 'active'")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var serverID int64
				rows.Scan(&serverID)
				fedTransport.Send(federation.FederationRequest{
					ServerID: serverID,
					Endpoint: "/api/federation/v1/forward-key",
					Method:   "POST",
					Body: map[string]interface{}{
						"user_id":    userID,
						"public_key": body.PublicKey,
					},
				})
			}
		}
	}

	return c.JSON(fiber.Map{"message": "Key saved"})
}

func (h *Handler) GetKey(c *fiber.Ctx) error {
	targetID, err := strconv.ParseInt(c.Params("userId"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	var publicKey string
	err = database.DB.QueryRow(
		"SELECT public_key FROM user_keys WHERE user_id = ?", targetID,
	).Scan(&publicKey)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "No key found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch key"})
	}

	return c.JSON(fiber.Map{"public_key": publicKey})
}

func (h *Handler) DeletePushCopy(c *fiber.Ctx) error {
	messageID, err := strconv.ParseInt(c.Params("messageId"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid message ID"})
	}

	database.DB.Exec("DELETE FROM push_copies WHERE message_id = ?", messageID)
	return c.JSON(fiber.Map{"message": "Push copy deleted"})
}

func (h *Handler) UploadGroupKeyShare(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	groupID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}

	if !isGroupMember(groupID, userID) {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}

	var body struct {
		UserID       int64  `json:"user_id"`
		EncryptedKey string `json:"encrypted_key"`
		IV           string `json:"iv"`
	}
	if err := c.BodyParser(&body); err != nil || body.EncryptedKey == "" || body.IV == "" {
		return c.Status(400).JSON(fiber.Map{"error": "encrypted_key and iv required"})
	}

	if !isGroupMember(groupID, body.UserID) {
		return c.Status(400).JSON(fiber.Map{"error": "User is not a group member"})
	}

	_, err = database.DB.Exec(
		`INSERT INTO group_key_shares (group_chat_id, user_id, encrypted_key, iv) VALUES (?, ?, ?, ?)
		 ON CONFLICT(group_chat_id, user_id) DO UPDATE SET encrypted_key = excluded.encrypted_key, iv = excluded.iv`,
		groupID, body.UserID, body.EncryptedKey, body.IV,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save key share"})
	}

	return c.JSON(fiber.Map{"message": "Key share saved"})
}

func (h *Handler) GetMyGroupKeyShare(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	groupID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}

	if !isGroupMember(groupID, userID) {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}

	var encryptedKey, iv string
	err = database.DB.QueryRow(
		"SELECT encrypted_key, iv FROM group_key_shares WHERE group_chat_id = ? AND user_id = ?",
		groupID, userID,
	).Scan(&encryptedKey, &iv)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Key share not found"})
	}

	return c.JSON(fiber.Map{"encrypted_key": encryptedKey, "iv": iv})
}
