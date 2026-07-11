package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"my-chat-backend/database"
	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
	"github.com/SherClockHolmes/webpush-go"
)

type bearerTransport struct {
	inner http.RoundTripper
}

func (t *bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	auth := req.Header.Get("Authorization")
	if strings.HasPrefix(auth, "WebPush ") {
		req.Header.Set("Authorization", "Bearer "+auth[8:])
	}
	return t.inner.RoundTrip(req)
}

type vapidKeys struct {
	Public  string `json:"public"`
	Private string `json:"private"`
}

var vapid *vapidKeys

func (h *Handler) LoadVAPIDKeys() error {
	const path = "./vapid_keys.json"
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

	return c.JSON(fiber.Map{"message": "Unsubscribed"})
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

		payload, _ := json.Marshal(map[string]interface{}{
			"title": title,
			"body":  body,
			"icon":  "/favicon.ico",
			"data":  data,
		})

		resp, err := webpush.SendNotification(payload, sub, &webpush.Options{
			Subscriber:      "admin@chat.frament.netcraze.link",
			VAPIDPublicKey:  vapid.Public,
			VAPIDPrivateKey: vapid.Private,
			TTL:             86400,
			AuthScheme:      webpush.WebPush,
			HTTPClient:      &http.Client{Transport: &bearerTransport{inner: http.DefaultTransport}},
		})
		if err != nil {
			log.Println("Web Push send error:", err)
			continue
		}
		log.Printf("Web Push sent to user %d, endpoint %s..., status %d", toUserID, endpoint[:min(len(endpoint), 50)], resp.StatusCode)
		if resp.StatusCode != 201 {
			if bodyBytes, readErr := io.ReadAll(resp.Body); readErr == nil {
				log.Printf("Web Push response body: %s", string(bodyBytes))
			}
		}
		resp.Body.Close()

		if resp.StatusCode == 410 || resp.StatusCode == 404 {
			database.DB.Exec("DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint)
		}
	}
	if !hasSubs {
		log.Printf("No push subscriptions found for user %d", toUserID)
	}
}
