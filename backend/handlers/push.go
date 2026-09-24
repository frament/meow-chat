package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"

	"my-chat-backend/database"
	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
	"github.com/SherClockHolmes/webpush-go"
)

type vapidKeys struct {
	Public  string `json:"public"`
	Private string `json:"private"`
}

var vapid *vapidKeys

func (h *Handler) LoadVAPIDKeys() error {
	const path = "/data/vapid_keys.json"
	if data, err := os.ReadFile(path); err == nil {
		var k vapidKeys
		if json.Unmarshal(data, &k) == nil && k.Public != "" && k.Private != "" {
			vapid = &k
			return nil
		}
	}

	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return fmt.Errorf("failed to generate VAPID keys: %w", err)
	}

	vapid = &vapidKeys{Public: public, Private: private}
	data, _ := json.MarshalIndent(vapid, "", "  ")
	os.WriteFile(path, data, 0600)
	return nil
}

func (h *Handler) VAPIDPublicKey(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"publicKey": vapid.Public})
}

func (h *Handler) SubscribePush(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var req models.PushSubscriptionRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}
	if req.Endpoint == "" || req.P256dh == "" || req.Auth == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing fields"})
	}

	_, err := database.DB.Exec(
		"INSERT OR IGNORE INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)",
		userID, req.Endpoint, req.P256dh, req.Auth,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save subscription"})
	}

	logPush(userID, "server", "subscribe", req.Endpoint, "", "", "ok", "", "")
	return c.JSON(fiber.Map{"message": "Subscribed"})
}

func (h *Handler) UnsubscribePush(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var req models.DeleteSubscriptionRequest
	if err := c.BodyParser(&req); err != nil || req.Endpoint == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Endpoint required"})
	}

	_, err := database.DB.Exec(
		"DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
		userID, req.Endpoint,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to remove subscription"})
	}

	logPush(userID, "server", "unsubscribe", req.Endpoint, "", "", "ok", "", "")
	return c.JSON(fiber.Map{"message": "Unsubscribed"})
}

func contactEmail() string {
	if e := os.Getenv("VAPID_CONTACT"); e != "" {
		return e
	}
	return "admin@gmail.com"
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// logPush stores a push diagnostic event (server or client origin).
func logPush(userID int64, source, kind, endpoint, title, body, status, detail, ackID string) {
	_, err := database.DB.Exec(
		`INSERT INTO push_logs (user_id, source, kind, endpoint, title, body, status, detail, ack_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, source, kind, truncate(endpoint, 200), truncate(title, 200),
		truncate(body, 500), truncate(status, 40), truncate(detail, 1000), ackID,
	)
	if err != nil {
		log.Println("push log insert failed:", err)
	}
}

func newAckID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return hex.EncodeToString(b)
}

// PushClientLog records an authenticated client-side push event.
func (h *Handler) PushClientLog(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	var req struct {
		Kind     string `json:"kind"`
		Endpoint string `json:"endpoint"`
		Detail   string `json:"detail"`
	}
	if err := c.BodyParser(&req); err != nil || req.Kind == "" {
		return c.Status(400).JSON(fiber.Map{"error": "kind required"})
	}
	logPush(userID, "client", req.Kind, req.Endpoint, "", "", "", req.Detail, "")
	return c.JSON(fiber.Map{"ok": true})
}

// PushAck records a delivery acknowledgement from the service worker. It is
// unauthenticated but keyed by the random ack id embedded in the push payload.
func (h *Handler) PushAck(c *fiber.Ctx) error {
	var req struct {
		AckID  string `json:"ackId"`
		Kind   string `json:"kind"`
		Detail string `json:"detail"`
	}
	if err := c.BodyParser(&req); err != nil || req.AckID == "" || req.Kind == "" {
		return c.Status(400).JSON(fiber.Map{"error": "ackId and kind required"})
	}
	var userID int64
	// Best-effort attribution to the user that owns this push.
	database.DB.QueryRow(
		"SELECT user_id FROM push_logs WHERE ack_id = ? AND user_id IS NOT NULL ORDER BY id DESC LIMIT 1",
		req.AckID,
	).Scan(&userID)
	logPush(userID, "client", req.Kind, "", "", "", "", req.Detail, req.AckID)
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) sendPushNotification(toUserID int64, title, body string, data map[string]interface{}) {
	rows, err := database.DB.Query(
		"SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
		toUserID,
	)
	if err != nil {
		log.Println("Failed to query push subscriptions:", err)
		return
	}
	defer rows.Close()

	hasSubs := false
	for rows.Next() {
		hasSubs = true
		var endpoint, p256dh, auth string
		if err := rows.Scan(&endpoint, &p256dh, &auth); err != nil {
			continue
		}

		sub := &webpush.Subscription{
			Endpoint: endpoint,
			Keys: webpush.Keys{
				P256dh: p256dh,
				Auth:   auth,
			},
		}

		ackID := newAckID()
		if data == nil {
			data = map[string]interface{}{}
		}
		data["ackId"] = ackID

		payload, _ := json.Marshal(map[string]interface{}{
			"title": title,
			"body":  body,
			"icon":  "/favicon.ico",
			"data":  data,
		})

		resp, err := webpush.SendNotification(payload, sub, &webpush.Options{
			Subscriber:      contactEmail(),
			VAPIDPublicKey:  vapid.Public,
			VAPIDPrivateKey: vapid.Private,
			TTL:             86400,
			AuthScheme:      webpush.WebPush,
			HTTPClient:      &http.Client{},
		})
		if err != nil {
			log.Println("Web Push send error:", err)
			logPush(toUserID, "server", "error", endpoint, title, body, "error", err.Error(), ackID)
			continue
		}
		log.Printf("Web Push sent to user %d, endpoint %s..., status %d", toUserID, endpoint[:min(len(endpoint), 50)], resp.StatusCode)
		detail := ""
		if resp.StatusCode != 201 {
			if bodyBytes, readErr := io.ReadAll(resp.Body); readErr == nil {
				detail = string(bodyBytes)
				log.Printf("Web Push response body: %s", detail)
			}
		}
		resp.Body.Close()
		logPush(toUserID, "server", "send", endpoint, title, body, strconv.Itoa(resp.StatusCode), detail, ackID)

		if resp.StatusCode == 410 || resp.StatusCode == 404 || resp.StatusCode == 403 {
			log.Printf("Removing dead push subscription (status %d) for user %d", resp.StatusCode, toUserID)
			database.DB.Exec("DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint)
			// VAPID mismatch means the browser holds a subscription created with
			// a different key. Ask the client to unsubscribe and re-subscribe.
			if resp.StatusCode == 403 {
				h.SendToUser(toUserID, fiber.Map{"type": "push_resubscribe"})
			}
		}
	}
	if !hasSubs {
		log.Printf("No push subscriptions found for user %d", toUserID)
		logPush(toUserID, "server", "no_subscription", "", title, body, "", "", "")
	}
}

type adminPushLog struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	Username  string `json:"username"`
	Source    string `json:"source"`
	Kind      string `json:"kind"`
	Endpoint  string `json:"endpoint"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Status    string `json:"status"`
	Detail    string `json:"detail"`
	CreatedAt string `json:"created_at"`
}

func (h *Handler) AdminPushLogs(c *fiber.Ctx) error {
	limit := 200
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}

	query := `SELECT l.id, COALESCE(l.user_id, 0), COALESCE(u.username, ''), l.source, l.kind,
	                 l.endpoint, l.title, l.body, l.status, l.detail, l.created_at
	          FROM push_logs l LEFT JOIN users u ON u.id = l.user_id`
	args := []interface{}{}
	if source := c.Query("source"); source != "" {
		query += " WHERE l.source = ?"
		args = append(args, source)
	}
	query += " ORDER BY l.id DESC LIMIT ?"
	args = append(args, limit)

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch push logs"})
	}
	defer rows.Close()

	logs := make([]adminPushLog, 0)
	for rows.Next() {
		var e adminPushLog
		if err := rows.Scan(&e.ID, &e.UserID, &e.Username, &e.Source, &e.Kind,
			&e.Endpoint, &e.Title, &e.Body, &e.Status, &e.Detail, &e.CreatedAt); err != nil {
			continue
		}
		logs = append(logs, e)
	}
	return c.JSON(logs)
}

func (h *Handler) AdminPushStatus(c *fiber.Ctx) error {
	type subEntry struct {
		ID       int64  `json:"id"`
		UserID   int64  `json:"user_id"`
		Username string `json:"username"`
		Endpoint string `json:"endpoint"`
	}

	rows, err := database.DB.Query(`
		SELECT ps.id, ps.user_id, COALESCE(u.username, ''), ps.endpoint
		FROM push_subscriptions ps
		LEFT JOIN users u ON u.id = ps.user_id
		ORDER BY ps.user_id, ps.id
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch subscriptions"})
	}
	defer rows.Close()

	subs := make([]subEntry, 0)
	users := map[int64]bool{}
	for rows.Next() {
		var e subEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.Username, &e.Endpoint); err != nil {
			continue
		}
		subs = append(subs, e)
		users[e.UserID] = true
	}

	var lastSend, lastClient sql.NullString
	database.DB.QueryRow("SELECT created_at FROM push_logs WHERE source = 'server' AND kind = 'send' ORDER BY id DESC LIMIT 1").Scan(&lastSend)
	database.DB.QueryRow("SELECT created_at FROM push_logs WHERE source = 'client' ORDER BY id DESC LIMIT 1").Scan(&lastClient)

	return c.JSON(fiber.Map{
		"total_subscriptions":      len(subs),
		"users_with_subscriptions": len(users),
		"last_server_send":         lastSend.String,
		"last_client_event":        lastClient.String,
		"subscriptions":            subs,
	})
}
