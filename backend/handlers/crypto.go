package handlers

import (
	"database/sql"
	"encoding/base64"

	"my-chat-backend/database"

	"github.com/gofiber/fiber/v2"
)

// gcmTag is the AES-GCM authentication tag. The wrapped private key must carry
// at least this much on top of the key itself.
const gcmTag = 16

// GetServerKey serves the public half of the server's X25519 pair.
//
// Unauthenticated on purpose: it is a public key, and the client needs it before
// it can trust anything else on the connection. What makes that safe is the pin,
// not a token - a substituted key is caught by comparing the fingerprint with the
// constant in the bundle, and asking for credentials first would change nothing
// about that comparison.
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

// GetReceiveKey returns the caller's own key material.
//
// A second device needs the same private key, and it can only get it from here:
// the client generates the pair once, and there is no other store. Returning the
// wrapped blob is safe in the sense that matters - it opens with the account
// password, so a token alone does not read it. That is the boundary this design
// chose, and it is written down rather than assumed.
func (h *Handler) GetReceiveKey(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var kid, publicKey, wrapped, salt, createdAt string
	err := database.DB.QueryRow(`
		SELECT kid, public_key, wrapped_private_key, kdf_salt, COALESCE(created_at, '')
		FROM user_receive_keys
		WHERE user_id = ? AND retired_at IS NULL`, userID,
	).Scan(&kid, &publicKey, &wrapped, &salt, &createdAt)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "No receive key is set up for this account"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.JSON(fiber.Map{
		"kid":                 kid,
		"public_key":          publicKey,
		"wrapped_private_key": wrapped,
		"kdf_salt":            salt,
		"created_at":          createdAt,
	})
}

// RegisterReceiveKey stores the user's X25519 public key and the private half
// wrapped with a key derived from their password.
//
// The key is per user. A per-device key would have to be carried from the phone
// to the laptop, and carrying it is the E2EE problem this design leaves behind:
// trusted-device lists, shares that never arrived, one device reading a group
// while the other cannot.
func (h *Handler) RegisterReceiveKey(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var req struct {
		PublicKey         string `json:"public_key"`
		WrappedPrivateKey string `json:"wrapped_private_key"`
		KDFSalt           string `json:"kdf_salt"`
	}
	if err := c.BodyParser(&req); err != nil ||
		req.PublicKey == "" || req.WrappedPrivateKey == "" || req.KDFSalt == "" {
		return c.Status(400).JSON(fiber.Map{"error": "public_key, wrapped_private_key and kdf_salt required"})
	}

	publicKey, err := base64.StdEncoding.DecodeString(req.PublicKey)
	if err != nil || len(publicKey) != 32 {
		return c.Status(400).JSON(fiber.Map{"error": "public_key must be 32 bytes, base64 encoded"})
	}
	wrapped, err := base64.StdEncoding.DecodeString(req.WrappedPrivateKey)
	if err != nil || len(wrapped) < 32+gcmTag {
		return c.Status(400).JSON(fiber.Map{"error": "wrapped_private_key must be the encrypted 32-byte key, base64 encoded"})
	}
	salt, err := base64.StdEncoding.DecodeString(req.KDFSalt)
	if err != nil || len(salt) != 16 {
		return c.Status(400).JSON(fiber.Map{"error": "kdf_salt must be 16 bytes, base64 encoded"})
	}

	kid := database.KeyID(publicKey)

	var activeKid string
	err = database.DB.QueryRow(
		"SELECT kid FROM user_receive_keys WHERE user_id = ? AND retired_at IS NULL", userID,
	).Scan(&activeKid)
	switch {
	case err == nil:
		// Re-registering the same key is the normal case: a client may call this
		// on every start, and there is nothing to change.
		if activeKid == kid {
			return c.JSON(fiber.Map{"kid": kid, "message": "Key already registered"})
		}
		// A different key must not silently replace the old one. Whoever holds a
		// token could otherwise point the key at themselves and receive the whole
		// history wrapped for them. Replacement is a rotation confirmed by the
		// password, which is a separate, deliberate act.
		return c.Status(409).JSON(fiber.Map{
			"error": "This account already has a receive key. Replacing it needs the password and is done by rotation, not by registering again.",
			"kid":   activeKid,
		})
	case err != sql.ErrNoRows:
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	if _, err := database.DB.Exec(
		`INSERT INTO user_receive_keys (user_id, kid, public_key, wrapped_private_key, kdf_salt)
		 VALUES (?, ?, ?, ?, ?)`,
		userID, kid, req.PublicKey, req.WrappedPrivateKey, req.KDFSalt,
	); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(201).JSON(fiber.Map{"kid": kid})
}
