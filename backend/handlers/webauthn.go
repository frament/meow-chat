package handlers

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"log"
	"os"
	"sync"
	"time"

	"my-chat-backend/auth"
	"my-chat-backend/database"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/gofiber/fiber/v2"
)

var (
	rpID     string
	rpOrigin string
	rpName   = "MeowChat"

	webAuthn  *webauthn.WebAuthn
	waOnce    sync.Once
	waInitErr error

	sessionsMu sync.RWMutex
	sessions   = map[string]*webauthn.SessionData{}
)

func initWebAuthn() error {
	waOnce.Do(func() {
		rpID = os.Getenv("WEBAUTHN_RP_ID")
		if rpID == "" {
			rpID = "localhost"
		}
		rpOrigin = os.Getenv("WEBAUTHN_RP_ORIGIN")
		if rpOrigin == "" {
			rpOrigin = "http://localhost:4200"
		}

		webAuthn, waInitErr = webauthn.New(&webauthn.Config{
			RPDisplayName: rpName,
			RPID:          rpID,
			RPOrigins:     []string{rpOrigin},
		})
	})
	return waInitErr
}

type waUser struct {
	id          int64
	name        string
	displayName string
	credentials []webauthn.Credential
}

func (u *waUser) WebAuthnID() []byte {
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, uint64(u.id))
	return buf
}

func (u *waUser) WebAuthnName() string                       { return u.name }
func (u *waUser) WebAuthnDisplayName() string                 { return u.displayName }
func (u *waUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }
func (u *waUser) WebAuthnIcon() string                        { return "" }

func loadWACredentials(userID int64) []webauthn.Credential {
	rows, err := database.GetWebAuthnCredentials(userID)
	if err != nil {
		return nil
	}
	creds := make([]webauthn.Credential, 0, len(rows))
	for _, r := range rows {
		creds = append(creds, webauthn.Credential{
			ID:              r.CredentialID,
			PublicKey:       r.PublicKey,
			AttestationType: r.AttestationType,
			Authenticator: webauthn.Authenticator{
				AAGUID:    r.AAGUID,
				SignCount: r.SignCount,
			},
		})
	}
	return creds
}

func sessionID() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func storeSession(sid string, sd *webauthn.SessionData) {
	sessionsMu.Lock()
	sessions[sid] = sd
	sessionsMu.Unlock()
}

func getAndDelSession(sid string) *webauthn.SessionData {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	sd := sessions[sid]
	if sd != nil {
		delete(sessions, sid)
	}
	return sd
}

func (h *Handler) WebAuthnBeginRegistration(c *fiber.Ctx) error {
	if err := initWebAuthn(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "WebAuthn init failed"})
	}

	userID := c.Locals("userId").(int64)

	var username, email string
	err := database.DB.QueryRow("SELECT username, email FROM users WHERE id = ?", userID).Scan(&username, &email)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "User not found"})
	}

	existing := loadWACredentials(userID)
	user := &waUser{id: userID, name: username, displayName: username, credentials: existing}

	creation, sd, err := webAuthn.BeginRegistration(user,
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			AuthenticatorAttachment: protocol.AuthenticatorAttachment("platform"),
			UserVerification:        protocol.UserVerificationRequirement("required"),
			ResidentKey:             protocol.ResidentKeyRequirement("preferred"),
		}),
	)
	if err != nil {
		log.Println("BeginRegistration error:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to begin registration"})
	}

	sid := sessionID()
	storeSession(sid, sd)

	return c.JSON(fiber.Map{
		"session_id": sid,
		"options":    creation,
	})
}

func (h *Handler) WebAuthnFinishRegistration(c *fiber.Ctx) error {
	if err := initWebAuthn(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "WebAuthn init failed"})
	}

	userID := c.Locals("userId").(int64)

	var body struct {
		SessionID string          `json:"session_id"`
		Cred      json.RawMessage `json:"credential"`
	}
	if err := c.BodyParser(&body); err != nil || body.SessionID == "" || len(body.Cred) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	sd := getAndDelSession(body.SessionID)
	if sd == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Session expired or invalid"})
	}

	parsed, err := protocol.ParseCredentialCreationResponseBody(bytes.NewReader(body.Cred))
	if err != nil {
		log.Println("ParseCredentialCreationResponseBody error:", err)
		return c.Status(400).JSON(fiber.Map{"error": "Invalid credential data"})
	}

	var username string
	database.DB.QueryRow("SELECT username FROM users WHERE id = ?", userID).Scan(&username)

	existing := loadWACredentials(userID)
	user := &waUser{id: userID, name: username, displayName: username, credentials: existing}

	cred, err := webAuthn.CreateCredential(user, *sd, parsed)
	if err != nil {
		log.Println("CreateCredential error:", err)
		return c.Status(400).JSON(fiber.Map{"error": "Failed to register credential"})
	}

	if err := database.SaveWebAuthnCredential(userID, cred.ID, cred.PublicKey, cred.Authenticator.AAGUID, cred.AttestationType, cred.Authenticator.SignCount); err != nil {
		log.Println("SaveWebAuthnCredential error:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save credential"})
	}

	return c.JSON(fiber.Map{"message": "Credential registered"})
}

func (h *Handler) WebAuthnBeginLogin(c *fiber.Ctx) error {
	if err := initWebAuthn(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "WebAuthn init failed"})
	}

	var body struct {
		Username string `json:"username"`
	}
	if err := c.BodyParser(&body); err != nil || body.Username == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Username required"})
	}

	var userID int64
	var username, email string
	err := database.DB.QueryRow("SELECT id, username, email FROM users WHERE username = ?", body.Username).Scan(&userID, &username, &email)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}

	existing := loadWACredentials(userID)
	if len(existing) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "No biometric credentials registered"})
	}

	user := &waUser{id: userID, name: username, displayName: username, credentials: existing}

	assertion, sd, err := webAuthn.BeginLogin(user)
	if err != nil {
		log.Println("BeginLogin error:", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to begin login"})
	}

	sid := sessionID()
	storeSession(sid, sd)

	return c.JSON(fiber.Map{
		"session_id": sid,
		"options":    assertion,
	})
}

func (h *Handler) WebAuthnFinishLogin(c *fiber.Ctx) error {
	if err := initWebAuthn(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "WebAuthn init failed"})
	}

	var body struct {
		SessionID string          `json:"session_id"`
		Cred      json.RawMessage `json:"credential"`
	}
	if err := c.BodyParser(&body); err != nil || body.SessionID == "" || len(body.Cred) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	sd := getAndDelSession(body.SessionID)
	if sd == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Session expired or invalid"})
	}

	parsed, err := protocol.ParseCredentialRequestResponseBody(bytes.NewReader(body.Cred))
	if err != nil {
		log.Println("ParseCredentialRequestResponseBody error:", err)
		return c.Status(400).JSON(fiber.Map{"error": "Invalid credential data"})
	}

	credID := parsed.RawID
	var userID int64
	err = database.DB.QueryRow(`
		SELECT user_id FROM webauthn_credentials WHERE credential_id = ?
	`, credID).Scan(&userID)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Credential not found"})
	}

	var uUsername, uEmail string
	database.DB.QueryRow("SELECT username, email FROM users WHERE id = ?", userID).Scan(&uUsername, &uEmail)

	existing := loadWACredentials(userID)
	user := &waUser{id: userID, name: uUsername, displayName: uUsername, credentials: existing}

	cred, err := webAuthn.ValidateLogin(user, *sd, parsed)
	if err != nil {
		log.Println("ValidateLogin error:", err)
		return c.Status(400).JSON(fiber.Map{"error": "Authentication failed"})
	}

	database.DB.Exec("UPDATE webauthn_credentials SET sign_count = ? WHERE user_id = ? AND credential_id = ?",
		cred.Authenticator.SignCount, userID, cred.ID)

	var isAdmin bool
	database.DB.QueryRow("SELECT is_admin FROM users WHERE id = ?", userID).Scan(&isAdmin)

	accessToken, err := auth.GenerateAccessToken(userID, isAdmin)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
	}

	refreshToken, tokenID, err := auth.GenerateRefreshToken(userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to generate refresh token"})
	}

	database.SaveRefreshToken(userID, tokenID, time.Now().Add(7*24*time.Hour))

	return c.JSON(fiber.Map{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"user": fiber.Map{
			"id":         userID,
			"username":   uUsername,
			"email":      uEmail,
			"avatar_url": "",
			"is_admin":   isAdmin,
		},
	})
}

func (h *Handler) WebAuthnListCredentials(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	rows, err := database.GetWebAuthnCredentials(userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch credentials"})
	}

	type CredInfo struct {
		ID        int64  `json:"id"`
		CreatedAt string `json:"created_at"`
	}
	result := make([]CredInfo, 0, len(rows))
	for _, r := range rows {
		result = append(result, CredInfo{ID: r.ID, CreatedAt: r.CreatedAt})
	}
	return c.JSON(result)
}

func (h *Handler) WebAuthnRemoveCredential(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	id, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid credential ID"})
	}

	if err := database.DeleteWebAuthnCredential(int64(id), userID); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Credential not found"})
	}
	return c.JSON(fiber.Map{"message": "Credential removed"})
}

func (h *Handler) WebAuthnHasCredentials(c *fiber.Ctx) error {
	var body struct {
		Username string `json:"username"`
	}
	if err := c.BodyParser(&body); err != nil || body.Username == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Username required"})
	}

	var userID int64
	err := database.DB.QueryRow("SELECT id FROM users WHERE username = ?", body.Username).Scan(&userID)
	if err != nil {
		return c.JSON(fiber.Map{"has_credentials": false})
	}

	count, err := database.CountWebAuthnCredentials(userID)
	if err != nil || count == 0 {
		return c.JSON(fiber.Map{"has_credentials": false})
	}
	return c.JSON(fiber.Map{"has_credentials": true})
}
