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

	// The account key is created once and never replaced implicitly.
	//
	// A device that lost its local copy regenerates a pair (ensureIdentityKey)
	// and used to land here - silently becoming the owner of the account key.
	// Every message encrypted to the previous key then became unreadable on
	// every device, in both directions: on prod that cost a window of 16
	// messages (28.09-06.10) in one conversation. Replacing the key is key
	// rotation and has to be an explicit, password-confirmed action.
	res, err := database.DB.Exec(
		`INSERT INTO user_keys (user_id, public_key) VALUES (?, ?)
		 ON CONFLICT(user_id) DO NOTHING`,
		userID, body.PublicKey,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save key"})
	}

	inserted, _ := res.RowsAffected()
	if inserted == 0 {
		var existing string
		if err := database.DB.QueryRow(
			"SELECT public_key FROM user_keys WHERE user_id = ?", userID,
		).Scan(&existing); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to read key"})
		}
		if existing != body.PublicKey {
			return c.Status(409).JSON(fiber.Map{
				"error":      "account key already exists",
				"public_key": existing,
			})
		}
		// Same key uploaded again: idempotent, and nothing to forward.
		return c.JSON(fiber.Map{"message": "unchanged"})
	}

	// Forward key to all federated servers
	if fedTransport != nil {
		rows, err := database.DB.Query("SELECT id FROM federation_servers WHERE status = 'active'")
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var serverID int64
				rows.Scan(&serverID)
				federation.SendOrQueue(fedTransport, fedQueue, federation.FederationRequest{
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

// GetAccountKey reports the caller's own account key, if one exists. The client
// needs this *before* it has a key of its own: a device with no local copy must
// ask whether the account already has one instead of generating a replacement.
//
// Registered behind AuthRequired. The assertion below is checked rather than
// bare: this handler panicked on prod, restarted the process and dropped every
// WebSocket, because the route had been registered above the middleware and an
// unauthenticated request carried no userId.
func (h *Handler) GetAccountKey(c *fiber.Ctx) error {
	userID, ok := c.Locals("userId").(int64)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	var publicKey string
	err := database.DB.QueryRow(
		"SELECT public_key FROM user_keys WHERE user_id = ?", userID,
	).Scan(&publicKey)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "No key found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch key"})
	}

	return c.JSON(fiber.Map{"public_key": publicKey})
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

	// Let the recipient know their key is ready so the client can retry/decrypt.
	// Also notify when a user refreshes their own share, so their other linked
	// devices (same account, same key) can pick the group key up.
	h.SendToUser(body.UserID, fiber.Map{
		"type":          "group_key_ready",
		"group_chat_id": groupID,
	})

	return c.JSON(fiber.Map{"message": "Key share saved"})
}

// UploadGroupDeviceKeyShare stores a group key wrapped for one specific device.
// Unlike the user-level share this works even when that device has a different
// identity key (it only needs the device keypair + the sharer's identity key).
func (h *Handler) UploadGroupDeviceKeyShare(c *fiber.Ctx) error {
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
		DeviceID     string `json:"device_id"`
		EncryptedKey string `json:"encrypted_key"`
		IV           string `json:"iv"`
		Epoch        int    `json:"epoch"`
	}
	if err := c.BodyParser(&body); err != nil || body.DeviceID == "" || body.EncryptedKey == "" || body.IV == "" {
		return c.Status(400).JSON(fiber.Map{"error": "device_id, encrypted_key and iv required"})
	}
	if !isGroupMember(groupID, body.UserID) {
		return c.Status(400).JSON(fiber.Map{"error": "User is not a group member"})
	}

	_, err = database.DB.Exec(
		`INSERT INTO group_epoch_key_shares (group_chat_id, user_id, device_id, epoch, encrypted_key, iv, creator_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(group_chat_id, device_id, epoch) DO UPDATE SET
		   user_id = excluded.user_id,
		   encrypted_key = excluded.encrypted_key, iv = excluded.iv, creator_id = excluded.creator_id`,
		groupID, body.UserID, body.DeviceID, body.Epoch, body.EncryptedKey, body.IV, userID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save device key share"})
	}

	// Notify the target user's devices so an unlinked device can pick it up.
	h.SendToUser(body.UserID, fiber.Map{
		"type":          "group_key_ready",
		"group_chat_id": groupID,
	})

	return c.JSON(fiber.Map{"message": "Device key share saved"})
}

func (h *Handler) GetMyGroupDeviceKeyShare(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	groupID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}
	if !isGroupMember(groupID, userID) {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}
	deviceID := c.Query("device_id")
	if deviceID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "device_id required"})
	}
	epoch, _ := strconv.Atoi(c.Query("epoch", "0"))

	var encryptedKey, iv string
	var storedEpoch int
	var creator sql.NullInt64
	err = database.DB.QueryRow(
		"SELECT encrypted_key, iv, epoch, creator_id FROM group_epoch_key_shares WHERE group_chat_id = ? AND user_id = ? AND device_id = ? AND epoch = ?",
		groupID, userID, deviceID, epoch,
	).Scan(&encryptedKey, &iv, &storedEpoch, &creator)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Device key share not found"})
	}

	resp := fiber.Map{"encrypted_key": encryptedKey, "iv": iv, "epoch": storedEpoch}
	if creator.Valid {
		resp["creator_id"] = creator.Int64
	}
	return c.JSON(resp)
}

// GetGroupKeyEpoch returns the newest group key epoch known to the server.
func (h *Handler) GetGroupKeyEpoch(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	groupID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid group ID"})
	}
	if !isGroupMember(groupID, userID) {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}
	var epoch int
	database.DB.QueryRow(
		"SELECT COALESCE(MAX(epoch), 0) FROM group_epoch_key_shares WHERE group_chat_id = ?",
		groupID,
	).Scan(&epoch)
	return c.JSON(fiber.Map{"epoch": epoch})
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
