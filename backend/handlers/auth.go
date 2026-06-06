package handlers

import (
	"strings"

	"my-chat-backend/auth"
	"my-chat-backend/database"

	"github.com/gofiber/fiber/v2"
)

func AuthRequired(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Missing authorization header"})
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == authHeader {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid authorization format"})
	}

	claims, err := auth.ValidateAccessToken(token)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid or expired token"})
	}

	c.Locals("userId", claims.UserID)
	c.Locals("isAdmin", claims.IsAdmin)
	return c.Next()
}

func AdminRequired(c *fiber.Ctx) error {
	isAdmin, ok := c.Locals("isAdmin").(bool)
	if !ok || !isAdmin {
		return c.Status(403).JSON(fiber.Map{"error": "Admin access required"})
	}
	return c.Next()
}

func (h *Handler) Refresh(c *fiber.Ctx) error {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.BodyParser(&req); err != nil || req.RefreshToken == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Refresh token required"})
	}

	claims, err := auth.ValidateRefreshToken(req.RefreshToken)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid or expired refresh token"})
	}

	userID, err := database.GetRefreshToken(claims.ID)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Refresh token revoked or expired"})
	}

	database.DeleteRefreshToken(claims.ID)

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

	database.SaveRefreshToken(userID, tokenID, claims.ExpiresAt.Time)

	return c.JSON(fiber.Map{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
	})
}

func (h *Handler) Logout(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	database.DeleteUserRefreshTokens(userID)
	return c.JSON(fiber.Map{"message": "Logged out"})
}
