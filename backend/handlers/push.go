package handlers

import (
	"encoding/json"
	"fmt"
	"os"

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
