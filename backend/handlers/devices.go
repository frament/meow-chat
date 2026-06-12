package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"time"

	"my-chat-backend/database"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/pbkdf2"
)

func (h *Handler) RegisterDevice(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	var req struct {
		DeviceName string `json:"device_name"`
		PublicKey  string `json:"device_public_key"`
		DeviceID   string `json:"device_id"`
	}
	if err := c.BodyParser(&req); err != nil || req.DeviceName == "" || req.PublicKey == "" || req.DeviceID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "device_name, device_public_key, device_id required"})
	}

	_, err := database.DB.Exec(
		"INSERT INTO user_devices (user_id, device_name, device_public_key, device_id, last_seen) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(device_id) DO UPDATE SET last_seen = datetime('now'), device_name = excluded.device_name, device_public_key = excluded.device_public_key",
		userID, req.DeviceName, req.PublicKey, req.DeviceID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to register device"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Device registered"})
}

func (h *Handler) ListDevices(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	rows, err := database.DB.Query(
		"SELECT id, device_name, device_public_key, device_id, COALESCE(last_seen, ''), created_at FROM user_devices WHERE user_id = ? ORDER BY created_at",
		userID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch devices"})
	}
	defer rows.Close()

	type Device struct {
		ID              int64  `json:"id"`
		DeviceName      string `json:"device_name"`
		DevicePublicKey string `json:"device_public_key"`
		DeviceID        string `json:"device_id"`
		LastSeen        string `json:"last_seen"`
		CreatedAt       string `json:"created_at"`
	}
	devices := make([]Device, 0)
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.ID, &d.DeviceName, &d.DevicePublicKey, &d.DeviceID, &d.LastSeen, &d.CreatedAt); err != nil {
			continue
		}
		devices = append(devices, d)
	}
	return c.JSON(devices)
}

func (h *Handler) RemoveDevice(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	deviceID := c.Params("deviceId")
	if deviceID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "device_id required"})
	}

	res, err := database.DB.Exec(
		"DELETE FROM user_devices WHERE device_id = ? AND user_id = ?",
		deviceID, userID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to remove device"})
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Device not found"})
	}

	database.DB.Exec("DELETE FROM device_auth_requests WHERE device_id = ? AND user_id = ?", deviceID, userID)
	return c.JSON(fiber.Map{"message": "Device removed"})
}

func (h *Handler) CreateAuthRequest(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	var req struct {
		DeviceName string `json:"device_name"`
		PublicKey  string `json:"device_public_key"`
		DeviceID   string `json:"device_id"`
	}
	if err := c.BodyParser(&req); err != nil || req.DeviceName == "" || req.PublicKey == "" || req.DeviceID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "device_name, device_public_key, device_id required"})
	}

	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM user_devices WHERE device_id = ? AND user_id = ?", req.DeviceID, userID).Scan(&count)
	if count > 0 {
		return c.Status(409).JSON(fiber.Map{"error": "Device already registered"})
	}

	result, err := database.DB.Exec(
		`INSERT INTO device_auth_requests (user_id, device_name, device_public_key, device_id, status)
		 VALUES (?, ?, ?, ?, 'pending')`,
		userID, req.DeviceName, req.PublicKey, req.DeviceID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create auth request"})
	}

	reqID, _ := result.LastInsertId()
	h.BroadcastDeviceAuthRequest(userID, reqID, req.DeviceName)
	return c.Status(201).JSON(fiber.Map{"id": reqID})
}

func (h *Handler) ListAuthRequests(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	rows, err := database.DB.Query(
		"SELECT id, device_name, device_public_key, device_id, status, created_at FROM device_auth_requests WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC",
		userID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch requests"})
	}
	defer rows.Close()

	type AuthRequest struct {
		ID              int64  `json:"id"`
		DeviceName      string `json:"device_name"`
		DevicePublicKey string `json:"device_public_key"`
		DeviceID        string `json:"device_id"`
		Status          string `json:"status"`
		CreatedAt       string `json:"created_at"`
	}
	reqs := make([]AuthRequest, 0)
	for rows.Next() {
		var r AuthRequest
		if err := rows.Scan(&r.ID, &r.DeviceName, &r.DevicePublicKey, &r.DeviceID, &r.Status, &r.CreatedAt); err != nil {
			continue
		}
		reqs = append(reqs, r)
	}
	return c.JSON(reqs)
}

func (h *Handler) GetAuthRequest(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	reqID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request ID"})
	}

	var status, encryptedKey, iv, deviceID, expiresAt string
	err = database.DB.QueryRow(
		"SELECT status, COALESCE(encrypted_key, ''), COALESCE(iv, ''), device_id, expires_at FROM device_auth_requests WHERE id = ? AND user_id = ?",
		reqID, userID,
	).Scan(&status, &encryptedKey, &iv, &deviceID, &expiresAt)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Auth request not found"})
	}

	if status == "pending" {
		if expiresAt != "" {
			expires, parseErr := time.Parse("2006-01-02 15:04:05", expiresAt)
			if parseErr == nil && time.Now().After(expires) {
				database.DB.Exec("UPDATE device_auth_requests SET status = 'expired' WHERE id = ?", reqID)
				status = "expired"
			}
		}
	}

	return c.JSON(fiber.Map{
		"status":        status,
		"encrypted_key": encryptedKey,
		"iv":            iv,
		"device_id":     deviceID,
	})
}

func (h *Handler) DenyAuthRequest(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	reqID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request ID"})
	}

	database.DB.Exec("UPDATE device_auth_requests SET status = 'denied' WHERE id = ? AND user_id = ? AND status = 'pending'", reqID, userID)
	return c.JSON(fiber.Map{"message": "Request denied"})
}

func (h *Handler) ApproveAuthRequest(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	reqID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request ID"})
	}

	var req struct {
		EncryptedKey string `json:"encrypted_key"`
		IV           string `json:"iv"`
	}
	if err := c.BodyParser(&req); err != nil || req.EncryptedKey == "" || req.IV == "" {
		return c.Status(400).JSON(fiber.Map{"error": "encrypted_key and iv required"})
	}

	var status, deviceID, deviceName string
	err = database.DB.QueryRow(
		"SELECT status, device_id, device_name FROM device_auth_requests WHERE id = ? AND user_id = ?",
		reqID, userID,
	).Scan(&status, &deviceID, &deviceName)
	if err != nil || status != "pending" {
		return c.Status(400).JSON(fiber.Map{"error": "Auth request not found or not pending"})
	}

	_, err = database.DB.Exec(
		"UPDATE device_auth_requests SET status = 'approved', encrypted_key = ?, iv = ? WHERE id = ?",
		req.EncryptedKey, req.IV, reqID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to approve request"})
	}

	h.BroadcastDeviceApproved(userID, deviceID)
	return c.JSON(fiber.Map{"message": "Approved"})
}

func (h *Handler) UploadKeyBackup(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	var req struct {
		EncryptedKey   string `json:"encrypted_key"`
		IV             string `json:"iv"`
		Salt           string `json:"salt"`
		HashIterations int    `json:"hash_iterations"`
	}
	if err := c.BodyParser(&req); err != nil || req.EncryptedKey == "" || req.IV == "" || req.Salt == "" {
		return c.Status(400).JSON(fiber.Map{"error": "encrypted_key, iv, salt required"})
	}
	if req.HashIterations < 1 {
		req.HashIterations = 100000
	}

	_, err := database.DB.Exec(
		`INSERT INTO user_keys_backup (user_id, encrypted_key, iv, salt, hash_iterations, updated_at)
		 VALUES (?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(user_id) DO UPDATE SET encrypted_key = excluded.encrypted_key, iv = excluded.iv, salt = excluded.salt, hash_iterations = excluded.hash_iterations, updated_at = datetime('now')`,
		userID, req.EncryptedKey, req.IV, req.Salt, req.HashIterations,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to upload backup"})
	}

	return c.JSON(fiber.Map{"message": "Backup saved"})
}

func (h *Handler) RecoverKeys(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	var req struct {
		Method string `json:"method"`
		Input  string `json:"input"`
	}
	if err := c.BodyParser(&req); err != nil || req.Input == "" {
		return c.Status(400).JSON(fiber.Map{"error": "method and input required"})
	}

	var encryptedKey, iv, salt string
	var iterations int

	if req.Method == "password" {
		err := database.DB.QueryRow(
			"SELECT encrypted_key, iv, salt, hash_iterations FROM user_keys_backup WHERE user_id = ?",
			userID,
		).Scan(&encryptedKey, &iv, &salt, &iterations)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "No password backup found"})
		}
	} else if req.Method == "phrase" {
		err := database.DB.QueryRow(
			"SELECT recovery_phrase_encrypted, recovery_phrase_iv, recovery_phrase_salt FROM user_keys_backup WHERE user_id = ?",
			userID,
		).Scan(&encryptedKey, &iv, &salt)
		if err != nil || encryptedKey == "" {
			return c.Status(404).JSON(fiber.Map{"error": "No recovery phrase backup found"})
		}
		iterations = 100000
	} else {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid method, must be 'password' or 'phrase'"})
	}

	kek := pbkdf2.Key([]byte(req.Input), []byte(salt), iterations, 32, sha256.New)

	ivBytes, err := base64.StdEncoding.DecodeString(iv)
	if err != nil || len(ivBytes) != 12 {
		return c.Status(500).JSON(fiber.Map{"error": "Invalid IV"})
	}

	ciphertext, err := base64.StdEncoding.DecodeString(encryptedKey)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Invalid encrypted key"})
	}

	block, err := aes.NewCipher(kek)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Decryption failed"})
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Decryption failed"})
	}

	plaintext, err := gcm.Open(nil, ivBytes, ciphertext, nil)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid password or phrase"})
	}

	return c.JSON(fiber.Map{"identity_key_jwk": string(plaintext)})
}

func (h *Handler) GenerateRecoveryPhrase(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	entropy := make([]byte, 16)
	if _, err := rand.Read(entropy); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to generate phrase"})
	}

	phrase := hex.EncodeToString(entropy)
	var parts []string
	for i := 0; i < len(phrase); i += 4 {
		end := i + 4
		if end > len(phrase) {
			end = len(phrase)
		}
		parts = append(parts, phrase[i:end])
	}
	humanPhrase := strings.Join(parts, "-")

	phraseHash := sha256.Sum256([]byte(humanPhrase))
	database.DB.Exec(
		"UPDATE user_keys_backup SET updated_at = datetime('now') WHERE user_id = ?",
		userID,
	)

	return c.JSON(fiber.Map{
		"phrase":      humanPhrase,
		"phrase_hash": hex.EncodeToString(phraseHash[:]),
	})
}

func (h *Handler) SetRecoveryPhraseBackup(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	var req struct {
		EncryptedKey string `json:"encrypted_key"`
		IV           string `json:"iv"`
		Salt         string `json:"salt"`
	}
	if err := c.BodyParser(&req); err != nil || req.EncryptedKey == "" || req.IV == "" || req.Salt == "" {
		return c.Status(400).JSON(fiber.Map{"error": "encrypted_key, iv, salt required"})
	}

	_, err := database.DB.Exec(
		`INSERT INTO user_keys_backup (user_id, encrypted_key, iv, salt, hash_iterations, recovery_phrase_encrypted, recovery_phrase_iv, recovery_phrase_salt, updated_at)
		 VALUES (?, '', '', 0, 0, ?, ?, ?, datetime('now'))
		 ON CONFLICT(user_id) DO UPDATE SET
		 	recovery_phrase_encrypted = excluded.recovery_phrase_encrypted,
		 	recovery_phrase_iv = excluded.recovery_phrase_iv,
		 	recovery_phrase_salt = excluded.recovery_phrase_salt,
		 	updated_at = datetime('now')`,
		userID, req.EncryptedKey, req.IV, req.Salt,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save phrase backup"})
	}

	return c.JSON(fiber.Map{"message": "Recovery phrase backup saved"})
}

func (h *Handler) GetRecoveryPhraseStatus(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	var count int
	database.DB.QueryRow(
		"SELECT COUNT(*) FROM user_keys_backup WHERE user_id = ? AND recovery_phrase_encrypted IS NOT NULL AND recovery_phrase_encrypted != ''",
		userID,
	).Scan(&count)
	return c.JSON(fiber.Map{"has_recovery_phrase": count > 0})
}
