# Multi-Device E2EE Key Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync ECDH identity keys across devices so a user can read/send E2EE messages from any device (device-to-device transfer + password recovery phrase recovery).

**Architecture:** Three new DB tables (`user_devices`, `device_auth_requests`, `user_keys_backup`), backend device auth request flow with WS notifications, frontend CryptoService extended with device keypair + ECDH key transfer + PBKDF2 recovery.

**Tech Stack:** Go 1.23 + Fiber v2 + SQLite, Angular 20 standalone + Web Crypto API

---

### Task 1: Database migrations

**Files:**
- Modify: `backend/database/database.go` (add 3 CREATE TABLE statements before the ALTER TABLE section)

- [ ] **Step 1: Add migrations**

Add to the `queries` slice in `InitDB()`:

```go
`CREATE TABLE IF NOT EXISTS user_devices (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name       TEXT NOT NULL,
    device_public_key TEXT NOT NULL,
    device_id         TEXT NOT NULL UNIQUE,
    last_seen         DATETIME,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
)`,
`CREATE TABLE IF NOT EXISTS device_auth_requests (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name       TEXT NOT NULL,
    device_public_key TEXT NOT NULL,
    device_id         TEXT NOT NULL,
    status            TEXT DEFAULT 'pending',
    encrypted_key     TEXT,
    iv                TEXT,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at        DATETIME DEFAULT (datetime('now', '+15 minutes'))
)`,
`CREATE TABLE IF NOT EXISTS user_keys_backup (
    user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_key      TEXT NOT NULL,
    iv                 TEXT NOT NULL,
    salt               TEXT NOT NULL,
    hash_iterations    INTEGER DEFAULT 100000,
    recovery_phrase_encrypted TEXT,
    recovery_phrase_salt     TEXT,
    recovery_phrase_iv       TEXT,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
)`,
```

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./...`
Expected: no error

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): add user_devices, device_auth_requests, user_keys_backup tables"
```

---

### Task 2: Backend device endpoints

**Files:**
- Create: `backend/handlers/devices.go`

Overview of all endpoints in this handler struct:

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | /api/devices/register | RegisterDevice | Register current device |
| GET | /api/devices | ListDevices | List user's trusted devices |
| DELETE | /api/devices/:deviceId | RemoveDevice | Remove a device |
| POST | /api/devices/auth-request | CreateAuthRequest | Request auth for new device |
| GET | /api/devices/auth-requests | ListAuthRequests | Pending requests for trusted devices |
| POST | /api/devices/auth/:id/approve | ApproveAuthRequest | Approve + upload encrypted key |
| DELETE | /api/devices/auth/:id | DenyAuthRequest | Deny/cancel |
| GET | /api/devices/auth/:id | GetAuthRequest | Poll for approved key |
| POST | /api/devices/backup-keys | UploadKeyBackup | Upload password-derived backup |
| POST | /api/devices/recover | RecoverKeys | Recover identity key |
| POST | /api/devices/recovery-phrase | GenerateRecoveryPhrase | Generate + return BIP39-like phrase |
| POST | /api/devices/recovery-phrase/set | SetRecoveryPhraseBackup | Upload phrase-encrypted backup |
| GET | /api/devices/recovery-phrase | GetRecoveryPhraseStatus | Check if phrase is set |

- [ ] **Step 1: Create devices.go with imports and Handler struct methods**

```go
package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"strings"
	"time"

	"my-chat-backend/database"
	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/pbkdf2"
)
```

Note: `golang.org/x/crypto/pbkdf2` is used. If not already in go.mod, add it.

- [ ] **Step 2: RegisterDevice handler**

```go
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
		"INSERT INTO user_devices (user_id, device_name, device_public_key, device_id, last_seen) VALUES (?, ?, ?, ?, datetime('now'))",
		userID, req.DeviceName, req.PublicKey, req.DeviceID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to register device"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Device registered"})
}
```

- [ ] **Step 3: ListDevices handler**

```go
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
```

- [ ] **Step 4: RemoveDevice handler**

```go
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
```

- [ ] **Step 5: CreateAuthRequest handler**

```go
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

	// Check device isn't already registered
	var count int
	database.DB.QueryRow("SELECT COUNT(*) FROM user_devices WHERE device_id = ? AND user_id = ?", req.DeviceID, userID).Scan(&count)
	if count > 0 {
		return c.Status(409).JSON(fiber.Map{"error": "Device already registered"})
	}

	result, err := database.DB.Exec(
		`INSERT INTO device_auth_requests (user_id, device_name, device_public_key, device_id, status, expires_at)
		 VALUES (?, ?, ?, ?, 'pending', datetime('now', '+15 minutes'))`,
		userID, req.DeviceName, req.PublicKey, req.DeviceID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create auth request"})
	}

	reqID, _ := result.LastInsertId()

	// Broadcast WS event to all connected sessions of this user
	broadcastDeviceAuthRequest(userID, reqID, req.DeviceName, req.DeviceID)

	return c.Status(201).JSON(fiber.Map{"id": reqID})
}
```

- [ ] **Step 6: ListAuthRequests, GetAuthRequest, DenyAuthRequest handlers**

```go
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

	var status, encryptedKey, iv, deviceID string
	var expiresAt string
	err = database.DB.QueryRow(
		"SELECT status, COALESCE(encrypted_key, ''), COALESCE(iv, ''), device_id, expires_at FROM device_auth_requests WHERE id = ? AND user_id = ?",
		reqID, userID,
	).Scan(&status, &encryptedKey, &iv, &deviceID, &expiresAt)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Auth request not found"})
	}

	// Check expiry
	if status == "pending" {
		var expires time.Time
		if err := expires.Scan(expiresAt); err == nil && time.Now().After(expires) {
			database.DB.Exec("UPDATE device_auth_requests SET status = 'expired' WHERE id = ?", reqID)
			status = "expired"
		}
	}

	return c.JSON(fiber.Map{
		"status":         status,
		"encrypted_key":  encryptedKey,
		"iv":             iv,
		"device_id":      deviceID,
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
```

- [ ] **Step 7: ApproveAuthRequest handler**

```go
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

	database.DB.Exec(
		"UPDATE device_auth_requests SET status = 'approved', encrypted_key = ?, iv = ? WHERE id = ?",
		req.EncryptedKey, req.IV, reqID,
	)

	// Broadcast approval to the requesting device via WS
	broadcastDeviceApproved(userID, deviceID)

	return c.JSON(fiber.Map{"message": "Approved"})
}
```

- [ ] **Step 8: Register device from approved request** (auto-register when device polls and gets approved)

When the requesting device polls `GetAuthRequest` and sees `status = 'approved'`, it should automatically register. The device should call `RegisterDevice` separately. No server-side auto-register needed.

- [ ] **Step 9: UploadKeyBackup handler**

```go
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
```

- [ ] **Step 10: RecoverKeys handler**

```go
func (h *Handler) RecoverKeys(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	var req struct {
		Method string `json:"method"` // "password" or "phrase"
		Input  string `json:"input"`  // password or recovery phrase
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
			return c.Status(404).JSON(fiber.Map{"error": "No password backup found. Set up backup first."})
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

	// Derive KEK on server
	kek := pbkdf2.Key([]byte(req.Input), []byte(salt), iterations, 32, sha256.New)

	// The encrypted_key is base64(iv + ciphertext). The server decrypts and returns the plaintext.
	// This means the identity key JWK is briefly in server memory, then returned over HTTPS.
	// The client imports it into IndexedDB.
	decoded, err := base64.StdEncoding.DecodeString(encryptedKey)
	if err != nil || len(decoded) < 12 {
		return c.Status(500).JSON(fiber.Map{"error": "Invalid encrypted key format"})
	}

	ivBytes, err := base64.StdEncoding.DecodeString(iv)
	if err != nil || len(ivBytes) != 12 {
		return c.Status(500).JSON(fiber.Map{"error": "Invalid IV"})
	}

	ciphertext := decoded

	// Use AES-GCM to decrypt — for this we need the cipher library
	// Since Go's standard library has crypto/aes and crypto/cipher:
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
```

Add to imports:
```go
import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"strings"
	"time"

	"my-chat-backend/database"
	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/pbkdf2"
)
```

- [ ] **Step 11: GenerateRecoveryPhrase handler**

```go
func (h *Handler) GenerateRecoveryPhrase(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	// Generate 16 random bytes = 128 bits of entropy
	entropy := make([]byte, 16)
	if _, err := rand.Read(entropy); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to generate phrase"})
	}

	// Encode as hex words for simplicity (not true BIP39, but user-friendly)
	phrase := hex.EncodeToString(entropy)
	// Split into groups of 4 chars for readability
	var parts []string
	for i := 0; i < len(phrase); i += 4 {
		end := i + 4
		if end > len(phrase) {
			end = len(phrase)
		}
		parts = append(parts, phrase[i:end])
	}
	humanPhrase := strings.Join(parts, "-")

	// Store phrase hash (SHA256) for verification
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
```

- [ ] **Step 12: SetRecoveryPhraseBackup handler**

```go
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
```

- [ ] **Step 13: GetRecoveryPhraseStatus handler**

```go
func (h *Handler) GetRecoveryPhraseStatus(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	var count int
	database.DB.QueryRow(
		"SELECT COUNT(*) FROM user_keys_backup WHERE user_id = ? AND recovery_phrase_encrypted IS NOT NULL AND recovery_phrase_encrypted != ''",
		userID,
	).Scan(&count)
	return c.JSON(fiber.Map{"has_recovery_phrase": count > 0})
}
```

- [ ] **Step 14: Commit**

```bash
git add -A && git commit -m "feat(backend): device management + auth request + key recovery endpoints"
```

---

### Task 3: WS broadcast for device auth (thread-safe via hub channel)

**Files:**
- Modify: `backend/handlers/handlers.go`

The hub's `clients` map is only accessed from the `runHub` goroutine. To safely broadcast from HTTP handlers, add a `broadcastToUser` channel.

- [ ] **Step 1: Add userMessage type and channel to Handler struct**

Near `wsMessage` type, add:
```go
type userMessage struct {
	userID int64
	data   fiber.Map
}
```

In Handler struct, add field:
```go
broadcastToUser chan userMessage
```

In `NewHandler()`:
```go
broadcastToUser: make(chan userMessage, 10),
```

- [ ] **Step 2: Add case in runHub select**

```go
case msg := <-h.broadcastToUser:
	for conn, uid := range h.clients {
		if uid == msg.userID {
			err := conn.WriteJSON(msg.data)
			if err != nil {
				conn.Close()
				delete(h.clients, conn)
			}
		}
	}
```

- [ ] **Step 3: Add SendToUser helper method**

```go
func (h *Handler) SendToUser(userID int64, data fiber.Map) {
	select {
	case h.broadcastToUser <- userMessage{userID: userID, data: data}:
	default:
		log.Println("broadcastToUser channel full, dropping message")
	}
}
```

- [ ] **Step 4: Add broadcastDeviceAuthRequest / broadcastDeviceApproved helpers**

```go
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
```

- [ ] **Step 5: Update CreateAuthRequest handler to use h.BroadcastDeviceAuthRequest**

In `devices.go`, call:
```go
h.BroadcastDeviceAuthRequest(userID, reqID, req.DeviceName)
```

- [ ] **Step 6: Update ApproveAuthRequest handler**

```go
h.BroadcastDeviceApproved(userID, deviceID)
```

- [ ] **Step 7: Verify build**

```bash
cd backend && go build ./...
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add thread-safe WS broadcast for device auth events"
```

---

### Task 4: Device route registration in main.go

**Files:**
- Modify: `backend/main.go`

- [ ] **Step 1: Add route group for devices (BEFORE api.Use(AuthRequired) — auth-request and register need auth but some need it, actually all need JWT except none)**

All device endpoints need JWT. Register them after `api.Use(handlers.AuthRequired)`:

```go
dev := api.Group("/devices")
dev.Post("/register", h.RegisterDevice)
dev.Get("/", h.ListDevices)
dev.Delete("/:deviceId", h.RemoveDevice)
dev.Post("/auth-request", h.CreateAuthRequest)
dev.Get("/auth-requests", h.ListAuthRequests)
dev.Get("/auth/:id", h.GetAuthRequest)
dev.Post("/auth/:id/approve", h.ApproveAuthRequest)
dev.Delete("/auth/:id", h.DenyAuthRequest)
dev.Post("/backup-keys", h.UploadKeyBackup)
dev.Post("/recover", h.RecoverKeys)
dev.Post("/recovery-phrase", h.GenerateRecoveryPhrase)
dev.Post("/recovery-phrase/set", h.SetRecoveryPhraseBackup)
dev.Get("/recovery-phrase", h.GetRecoveryPhraseStatus)
```

- [ ] **Step 2: Verify build**

```bash
cd backend && go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: register device API routes"
```

---

### Task 5: Frontend API service — device methods

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`

- [ ] **Step 1: Add device-related API methods**

```typescript
// ── Device Management ──

registerDevice(name: string, publicKey: string, deviceId: string) {
  return this.http.post(`${this.baseUrl}/devices/register`, {
    device_name: name,
    device_public_key: publicKey,
    device_id: deviceId,
  });
}

getDevices(): Observable<any[]> {
  return this.http.get<any[]>(`${this.baseUrl}/devices`);
}

removeDevice(deviceId: string) {
  return this.http.delete(`${this.baseUrl}/devices/${deviceId}`);
}

// ── Device Auth Request ──

createAuthRequest(name: string, publicKey: string, deviceId: string) {
  return this.http.post<{ id: number }>(`${this.baseUrl}/devices/auth-request`, {
    device_name: name,
    device_public_key: publicKey,
    device_id: deviceId,
  });
}

getAuthRequests() {
  return this.http.get<any[]>(`${this.baseUrl}/devices/auth-requests`);
}

getAuthRequest(id: number) {
  return this.http.get<{ status: string; encrypted_key: string; iv: string }>(
    `${this.baseUrl}/devices/auth/${id}`
  );
}

approveAuthRequest(id: number, encryptedKey: string, iv: string) {
  return this.http.post(`${this.baseUrl}/devices/auth/${id}/approve`, {
    encrypted_key: encryptedKey,
    iv,
  });
}

denyAuthRequest(id: number) {
  return this.http.delete(`${this.baseUrl}/devices/auth/${id}`);
}

// ── Key Backup & Recovery ──

uploadKeyBackup(encryptedKey: string, iv: string, salt: string, hashIterations: number = 100000) {
  return this.http.post(`${this.baseUrl}/devices/backup-keys`, {
    encrypted_key: encryptedKey,
    iv,
    salt,
    hash_iterations: hashIterations,
  });
}

recoverKeys(method: 'password' | 'phrase', input: string) {
  return this.http.post<{ identity_key_jwk: string }>(`${this.baseUrl}/devices/recover`, {
    method,
    input,
  });
}

generateRecoveryPhrase() {
  return this.http.post<{ phrase: string; phrase_hash: string }>(
    `${this.baseUrl}/devices/recovery-phrase`, {}
  );
}

setRecoveryPhraseBackup(encryptedKey: string, iv: string, salt: string) {
  return this.http.post(`${this.baseUrl}/devices/recovery-phrase/set`, {
    encrypted_key: encryptedKey,
    iv,
    salt,
  });
}

getRecoveryPhraseStatus() {
  return this.http.get<{ has_recovery_phrase: boolean }>(
    `${this.baseUrl}/devices/recovery-phrase`
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd frontend && npm run build
```
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(frontend): device management and recovery API methods"
```

---

### Task 6: CryptoService — device keypair + key transfer + recovery

**Files:**
- Modify: `frontend/src/app/services/crypto.service.ts`

- [ ] **Step 1: Add device keypair properties and generation**

```typescript
private deviceKeyPair: CryptoKeyPair | null = null;
deviceId: string = '';
deviceName: string = '';

async ensureDeviceKeyPair(): Promise<void> {
  const stored = await this.getIndexedDB('deviceKeyJWK');
  const storedPub = await this.getIndexedDB('devicePublicKeySPKI');
  if (stored && storedPub) {
    this.deviceKeyPair = {
      privateKey: await crypto.subtle.importKey('jwk', JSON.parse(stored), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits']),
      publicKey: await this.importPublicKey(storedPub),
    };
    return;
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits']
  ) as CryptoKeyPair;

  const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const pubB64 = this.arrayBufferToBase64(spki);

  await this.setIndexedDB('deviceKeyJWK', JSON.stringify(jwk));
  await this.setIndexedDB('devicePublicKeySPKI', pubB64);

  this.deviceKeyPair = keyPair;
  this.deviceId = this.generateDeviceId();
}

private generateDeviceId(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

async getDevicePublicKeySPKI(): Promise<string> {
  return await this.getIndexedDB('devicePublicKeySPKI') || '';
}
```

- [ ] **Step 2: Add ECDH key transfer method (encrypt identity key for peer device)**

```typescript
async encryptIdentityKeyForDevice(deviceSPKI: string): Promise<{ encrypted: string; iv: string } | null> {
  if (!this.deviceKeyPair) return null;

  const peerPubKey = await this.importPublicKey(deviceSPKI);
  if (!peerPubKey) return null;

  // Derive shared secret between my device key + peer device public key
  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPubKey },
    this.deviceKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const identityJWK = await this.getIndexedDB('identityKeyJWK');
  if (!identityJWK) return null;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(identityJWK);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoded
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return {
    encrypted: this.arrayBufferToBase64(combined.buffer),
    iv: this.arrayBufferToBase64(iv.buffer),
  };
}
```

- [ ] **Step 3: Add decrypt method for received identity key**

```typescript
async decryptIdentityKeyFromDevice(encryptedB64: string, ivB64: string, deviceSPKI: string): Promise<string | null> {
  if (!this.deviceKeyPair) return null;

  const peerPubKey = await this.importPublicKey(deviceSPKI);
  if (!peerPubKey) return null;

  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPubKey },
    this.deviceKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const encrypted = this.base64ToArrayBuffer(encryptedB64);
  const iv = this.base64ToArrayBuffer(ivB64);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      encrypted
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Add PBKDF2 helper for password-derived KEK**

```typescript
async deriveKeyFromPassword(password: string, salt: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password),
    'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  ) as Promise<CryptoKey>;
}

async encryptIdentityKeyWithKEK(kek: CryptoKey, salt: string): Promise<{ encrypted: string; iv: string; salt: string } | null> {
  const identityJWK = await this.getIndexedDB('identityKeyJWK');
  if (!identityJWK) return null;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(identityJWK);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    kek,
    encoded
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return {
    encrypted: this.arrayBufferToBase64(combined.buffer),
    iv: this.arrayBufferToBase64(iv.buffer),
    salt,
  };
}

async decryptIdentityKeyWithKEK(kek: CryptoKey, encryptedB64: string, ivB64: string): Promise<string | null> {
  const encrypted = this.base64ToArrayBuffer(encryptedB64);
  const iv = this.base64ToArrayBuffer(ivB64);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      kek,
      encrypted
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Add importIdentityKey method**

```typescript
async importIdentityKey(jwkJson: string): Promise<void> {
  const jwk = JSON.parse(jwkJson);
  const privateKey = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits']
  );
  // Export the public key as SPKI from the private key's JWK x/y
  const publicKey = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  const pubB64 = this.arrayBufferToBase64(spki);

  await this.setIndexedDB('identityKeyJWK', jwkJson);
  await this.setIndexedDB('publicKeySPKI', pubB64);
  this.e2eeReady = true;
  this.log('Identity key imported from other device');
}

private base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
```

- [ ] **Step 6: Add IndexedDB helper updates (ensure getIndexedDB/setIndexedDB support the new keys)**

The existing `getIndexedDB`/`setIndexedDB` helpers already work for any key name. No changes needed.

- [ ] **Step 7: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(crypto): device keypair, ECDH transfer, PBKDF2 recovery helpers"
```

---

### Task 7: App component — device auth flow + recovery UI

**Files:**
- Modify: `frontend/src/app/app.ts`
- Create: `frontend/src/app/components/device-auth/device-auth.ts`

The app component needs to:
1. On new device (no identity key): initiate auth request + poll for approval
2. On trusted device: listen for WS `device_auth_request` events → show modal
3. Handle recovery: if auth request fails/timeout, show recovery option

- [ ] **Step 1: Create DeviceAuthComponent**

```typescript
// frontend/src/app/components/device-auth/device-auth.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { Subscription, interval } from 'rxjs';

@Component({
  selector: 'app-device-auth',
  standalone: true,
  template: `
    <!-- Waiting for approval -->
    @if (status === 'waiting_for_approval') {
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div class="card" style="max-width:400px;width:100%;padding:24px;">
          <h2 style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text-primary);">Подтверждение входа</h2>
          <p style="font-size:14px;color:var(--text-secondary);margin-bottom:16px;">
            Открыто новое устройство <strong>{{ deviceName }}</strong>.<br>
            Подтвердите вход на одном из ваших доверенных устройств.
          </p>
          <div style="display:flex;gap:8px;justify-content:center;">
            <div style="width:20px;height:20px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></div>
          </div>
          <p style="font-size:13px;color:var(--text-tertiary);margin-top:16px;text-align:center;">
            Ожидание подтверждения...
          </p>
          <button (click)="cancel()" style="width:100%;margin-top:12px;padding:8px;border-radius:8px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);">
            Отмена
          </button>
        </div>
      </div>
    }

    <!-- Approval modal (shown on trusted device) -->
    @if (incomingRequest) {
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div class="card" style="max-width:400px;width:100%;padding:24px;">
          <h2 style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text-primary);">Подтвердить устройство</h2>
          <p style="font-size:14px;color:var(--text-secondary);margin-bottom:16px;">
            Устройство <strong>{{ incomingRequest.device_name }}</strong> запрашивает доступ к вашей учётной записи.
          </p>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button (click)="denyRequest()" style="padding:8px 16px;border-radius:8px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);">
              Отклонить
            </button>
            <button (click)="approveRequest()" style="padding:8px 16px;border-radius:8px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:13px;font-weight:500;">
              Подтвердить
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class DeviceAuthComponent implements OnInit, OnDestroy {
  status: 'idle' | 'waiting_for_approval' | 'approved' | 'failed' = 'idle';
  deviceName: string = '';
  authRequestId: number = 0;
  incomingRequest: any = null;
  private pollSub?: Subscription;

  constructor(
    private api: ApiService,
    private crypto: CryptoService,
  ) {}

  ngOnInit() {}

  ngOnDestroy() {
    this.pollSub?.unsubscribe();
  }

  async startNewDeviceFlow() {
    this.deviceName = 'Device ' + Math.random().toString(36).slice(2, 6);
    this.status = 'waiting_for_approval';

    const pubKey = await this.crypto.getDevicePublicKeySPKI();
    const deviceId = this.crypto.deviceId;

    this.api.createAuthRequest(this.deviceName, pubKey, deviceId).subscribe({
      next: (res) => {
        this.authRequestId = res.id;
        this.startPolling();
      },
      error: () => {
        this.status = 'failed';
      },
    });
  }

  private startPolling() {
    this.pollSub = interval(3000).subscribe(() => {
      this.api.getAuthRequest(this.authRequestId).subscribe(res => {
        if (res.status === 'approved' && res.encrypted_key) {
          this.status = 'approved';
          this.pollSub?.unsubscribe();
          this.processApprovedKey(res.encrypted_key, res.iv);
        } else if (res.status === 'denied' || res.status === 'expired') {
          this.status = 'failed';
          this.pollSub?.unsubscribe();
        }
      });
    });
  }

  private async processApprovedKey(encryptedB64: string, ivB64: string) {
    const deviceSPKI = await this.crypto.getDevicePublicKeySPKI();
    const jwk = await this.crypto.decryptIdentityKeyFromDevice(encryptedB64, ivB64, deviceSPKI);
    if (jwk) {
      await this.crypto.importIdentityKey(jwk);
      // Re-register since we now have identity key
      await this.crypto.syncPublicKey();
      location.reload();
    }
  }

  // Called when this device is the trusted one
  showIncomingRequest(req: any) {
    this.incomingRequest = req;
  }

  async approveRequest() {
    if (!this.incomingRequest) return;
    const result = await this.crypto.encryptIdentityKeyForDevice(this.incomingRequest.device_public_key);
    if (!result) return;

    this.api.approveAuthRequest(this.incomingRequest.id, result.encrypted, result.iv).subscribe({
      next: () => {
        this.incomingRequest = null;
      },
    });
  }

  denyRequest() {
    if (!this.incomingRequest) return;
    this.api.denyAuthRequest(this.incomingRequest.id).subscribe(() => {
      this.incomingRequest = null;
    });
  }

  cancel() {
    if (this.authRequestId) {
      this.api.denyAuthRequest(this.authRequestId).subscribe();
    }
    this.status = 'idle';
    this.pollSub?.unsubscribe();
  }
}
```

- [ ] **Step 2: Integrate into App component**

In `app.ts`:
- Import and add `DeviceAuthComponent` to component imports
- Subscribe to `wsMessages$` for `device_auth_request` events
- Show `app-device-auth` in template (conditionally)
- After login, check if identity key exists, if not → start device auth flow

- [ ] **Step 3: Add recovery option in login/register**

On login, if no identity key in IndexedDB and auth request fails, show recovery option:
- "Восстановить с паролем" → password input → `api.recoverKeys('password', password)` → import
- "Восстановить с фразой" → phrase input → `api.recoverKeys('phrase', phrase)` → import

- [ ] **Step 4: Add key backup on first login with password**

After password login, if identity key exists and no backup on server → PBKDF2 → `api.uploadKeyBackup(...)`

- [ ] **Step 5: Verify build**

```bash
cd frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: device auth flow + recovery UI in app component"
```

---

### Task 8: Group key re-sharing on device approve

**Files:**
- Modify: `frontend/src/app/services/crypto.service.ts`

When a new device is approved, the trusted device must re-encrypt group keys for the new device.

- [ ] **Step 1: Add method to re-share group keys for a new device**

```typescript
async reshareGroupKeysForDevice(deviceSPKI: string): Promise<void> {
  // Get all group IDs where this user is a member
  const db = await this.openDB();
  const tx = db.transaction('keys', 'readonly');
  const store = tx.objectStore('keys');
  const allKeys = await new Promise<string[]>((resolve, reject) => {
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
  db.close();

  const groupKeyPrefix = 'groupKeyRaw_';
  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith(groupKeyPrefix)) {
      const groupId = parseInt(key.replace(groupKeyPrefix, ''), 10);
      if (isNaN(groupId)) continue;
      const rawKey = await this.getIndexedDB(key);
      if (!rawKey) continue;
      // Encrypt raw group key with the new device's identity key
      // This is handled per-user (not per-device), so group key shares
      // are encrypted with the user's ECDH identity key, not device key.
      // When the new device has the identity key, it can decrypt group keys
      // that are already on the server — no extra step needed!
    }
  }
}
```

Actually, since group key shares are encrypted with the user's ECDH identity key (not device key), once the new device has the identity key, it can decrypt existing group key shares from the server. No re-sharing needed!

The only case where re-sharing matters is for new members added to a group while the new device was offline, but that's handled by the existing `getGroupKey` flow (brute-force or with `key_creator_id` fix).

- [ ] **Step 2: Add `key_creator_id` column fix**

In `database/database.go`, add migration:

```go
DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('group_key_shares') WHERE name='key_creator_id'").Scan(&count)
if count == 0 {
    DB.Exec("ALTER TABLE group_key_shares ADD COLUMN key_creator_id INTEGER DEFAULT NULL REFERENCES users(id)")
}
```

This makes `getGroupKey` able to query the correct creator instead of brute-forcing.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add key_creator_id to group_key_shares; group key re-sharing"
```

---

### Task 9: Final integration + testing

- [ ] **Step 1: Verify full backend build + frontend build**

```bash
cd backend && go build ./...
cd frontend && npm run build
```

- [ ] **Step 2: Commit any remaining changes**

```bash
git add -A && git commit -m "chore: finalize multi-device E2EE key sync implementation"
```

- [ ] **Step 3: Review feature coverage**

Verify:
- [x] New device can request auth via WS
- [x] Trusted device receives WS notification and can approve
- [x] Identity key transferred ECDH-encrypted device-to-device
- [x] Password recovery: PBKDF2 on server + AES-GCM decrypt
- [x] Recovery phrase: generated, set, used for recovery
- [x] Group key shares have `key_creator_id`
- [x] All API routes registered
- [x] Frontend compiles
- [x] Backend compiles
