package handlers

import (
	"database/sql"
	"encoding/base64"

	"my-chat-backend/database"

	"github.com/gofiber/fiber/v2"
)

// GetServerKey serves the public half of the server's X25519 pair.
//
// Unauthenticated on purpose: it is a public key, and the client needs it before
// it can trust anything else on the connection. What makes that safe is the pin,
// not a token - a substituted key is caught by comparing the fingerprint with the
// constant in the bundle, and a request for credentials first would change
// nothing about that comparison.
func (h *Handler) GetServerKey(c *fiber.Ctx) error {
	if len(database.ServerX25519Public) != 32 {
		return c.Status(500).JSON(fiber.Map{"error": "Server key is not loaded"})
	}
	return c.JSON(fiber.Map{
		"kid":         database.KeyID(database.ServerX25519Public),
		"public_key":  base64.StdEncoding.EncodeToString(database.ServerX25519Public),
		"fingerprint": database.Fingerprint(database.ServerX25519Public),
	})
}

// RegisterReceiveKey stores the X25519 public key of the calling device.
//
// One key per device rather than per user: the private half is meant to live in
// the browser with `extractable: false`, and such a key cannot be exported, so a
// per-user key could never reach the user's second device.
func (h *Handler) RegisterReceiveKey(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var req struct {
		DeviceID  string `json:"device_id"`
		PublicKey string `json:"public_key"`
	}
	if err := c.BodyParser(&req); err != nil || req.DeviceID == "" || req.PublicKey == "" {
		return c.Status(400).JSON(fiber.Map{"error": "device_id and public_key required"})
	}

	raw, err := base64.StdEncoding.DecodeString(req.PublicKey)
	if err != nil || len(raw) != 32 {
		return c.Status(400).JSON(fiber.Map{"error": "public_key must be 32 bytes, base64 encoded"})
	}

	// The device must belong to this user. Without the check a token could attach
	// a key to somebody else's device id and then collect their messages, which is
	// the one thing this table exists to prevent.
	var deviceRowID int64
	err = database.DB.QueryRow(
		"SELECT id FROM user_devices WHERE device_id = ? AND user_id = ?",
		req.DeviceID, userID,
	).Scan(&deviceRowID)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Unknown device"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	kid := database.KeyID(raw)

	// Re-registering the same key is the normal case: a client may call this on
	// every start. A second active row would leave it ambiguous which key to wrap
	// to, so this is answered rather than inserted.
	var active int
	if err := database.DB.QueryRow(
		"SELECT COUNT(*) FROM device_receive_keys WHERE user_device_id = ? AND kid = ? AND retired_at IS NULL",
		deviceRowID, kid,
	).Scan(&active); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if active > 0 {
		return c.JSON(fiber.Map{"kid": kid, "message": "Key already registered"})
	}

	tx, err := database.DB.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	defer tx.Rollback()

	// Retired, not deleted: content already wrapped under the previous key still
	// has to be readable, and the envelope's kid points at this row.
	if _, err := tx.Exec(
		"UPDATE device_receive_keys SET retired_at = datetime('now') WHERE user_device_id = ? AND retired_at IS NULL",
		deviceRowID,
	); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if _, err := tx.Exec(
		"INSERT INTO device_receive_keys (user_device_id, kid, public_key) VALUES (?, ?, ?)",
		deviceRowID, kid, req.PublicKey,
	); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(201).JSON(fiber.Map{"kid": kid})
}
