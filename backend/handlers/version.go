package handlers

import (
	"my-chat-backend/version"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) GetVersion(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"version": version.Version})
}
