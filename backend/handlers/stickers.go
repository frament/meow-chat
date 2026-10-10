package handlers

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"my-chat-backend/database"
	"my-chat-backend/imageproc"
	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) GetStickerPacks(c *fiber.Ctx) error {
	rows, err := database.DB.Query("SELECT id, name, created_at FROM sticker_packs ORDER BY created_at ASC")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch sticker packs"})
	}
	defer rows.Close()

	packs := make([]models.StickerPack, 0)
	for rows.Next() {
		var p models.StickerPack
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt); err != nil {
			continue
		}
		packs = append(packs, p)
	}

	if len(packs) > 0 {
		packIDs := make([]interface{}, 0, len(packs))
		idPos := make([]int64, 0, len(packs))
		for _, p := range packs {
			packIDs = append(packIDs, p.ID)
			idPos = append(idPos, p.ID)
		}
		placeholders := make([]string, len(packIDs))
		for i := range packIDs {
			placeholders[i] = "?"
		}
		sRows, err := database.DB.Query(
			"SELECT id, pack_id, image_url, sort_order FROM stickers WHERE pack_id IN ("+strings.Join(placeholders, ",")+") ORDER BY sort_order ASC",
			packIDs...,
		)
		if err == nil {
			defer sRows.Close()
			stickerMap := make(map[int64][]models.Sticker)
			for sRows.Next() {
				var s models.Sticker
				if err := sRows.Scan(&s.ID, &s.PackID, &s.ImageURL, &s.SortOrder); err == nil {
					stickerMap[s.PackID] = append(stickerMap[s.PackID], s)
				}
			}
			for i := range packs {
				if stickers, ok := stickerMap[packs[i].ID]; ok {
					packs[i].Stickers = stickers
				}
			}
		}
	}

	return c.JSON(packs)
}

// Admin endpoints

func (h *Handler) AdminCreateStickerPack(c *fiber.Ctx) error {
	var req models.CreateStickerPackRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	result, err := database.DB.Exec("INSERT INTO sticker_packs (name) VALUES (?)", name)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create sticker pack"})
	}
	id, _ := result.LastInsertId()
	return c.Status(201).JSON(fiber.Map{"id": id, "name": name})
}

func (h *Handler) AdminRenameStickerPack(c *fiber.Ctx) error {
	packID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid pack ID"})
	}

	// Trimmed, and emptiness judged after trimming: `req.Name == ""` let a name
	// of three spaces through and left the pack named "   " - invisible in the
	// list and impossible to tell apart from a rendering bug.
	var req models.CreateStickerPackRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	_, err = database.DB.Exec("UPDATE sticker_packs SET name = ? WHERE id = ?", name, packID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to rename sticker pack"})
	}
	return c.JSON(fiber.Map{"message": "Pack renamed"})
}

func (h *Handler) AdminDeleteStickerPack(c *fiber.Ctx) error {
	packID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid pack ID"})
	}

	// Delete sticker files first
	rows, err := database.DB.Query("SELECT image_url FROM stickers WHERE pack_id = ?", packID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var url string
			rows.Scan(&url)
			if localPath := stripUploadsPrefix(url); localPath != "" {
				os.Remove(localPath)
			}
		}
	}

	_, err = database.DB.Exec("DELETE FROM sticker_packs WHERE id = ?", packID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to delete sticker pack"})
	}
	return c.JSON(fiber.Map{"message": "Pack deleted"})
}

func (h *Handler) AdminUploadSticker(c *fiber.Ctx) error {
	packID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid pack ID"})
	}

	file, err := c.FormFile("sticker")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Sticker image required"})
	}

	if file.Size > 5*1024*1024 {
		return c.Status(400).JSON(fiber.Map{"error": "Image too large (max 5MB)"})
	}

	// Get next sort order
	var maxOrder int
	database.DB.QueryRow("SELECT COALESCE(MAX(sort_order), -1) FROM stickers WHERE pack_id = ?", packID).Scan(&maxOrder)

	// Through saveImage, like every other upload path: it compresses the file and
	// takes the extension from the bytes rather than the name. Stickers used to
	// go through c.SaveFile, which stored whatever arrived - a 3.1 MB phone photo
	// stayed 3.1 MB, and a JPEG named .png was served as image/png.
	//
	// The animation is why this was worth a second look rather than a mechanical
	// swap. APNG is a PNG with extra chunks, and imageproc.Sniff matches on the
	// PNG signature, so an iPhone sticker is recognised as PNG and passes
	// through uncompressed - the one case where leaving the bytes alone is
	// correct, because a JPEG round-trip would flatten the animation. GIF passes
	// for the same reason. APNG therefore never needs the .apng allowlist entry
	// the client may send: the extension comes from the bytes now.
	base := fmt.Sprintf("sticker_%d_%d", packID, maxOrder+1)
	imageURL, err := saveImage(file, "stickers", base)
	if err != nil {
		if errors.Is(err, imageproc.ErrNotAnImage) {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid image format (jpg, png, gif, webp allowed)"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save sticker"})
	}
	// A failed INSERT must not leave the file behind, but imageproc may also
	// have written thumbnails next to it - stripping the uploads prefix gives
	// the real path, and that one is what deleteStickerPack uses too.
	savePath := stripUploadsPrefix(imageURL)
	if savePath == "" {
		savePath = "./" + strings.TrimPrefix(imageURL, "/")
	}
	result, err := database.DB.Exec(
		"INSERT INTO stickers (pack_id, image_url, sort_order) VALUES (?, ?, ?)",
		packID, imageURL, maxOrder+1,
	)
	if err != nil {
		os.Remove(savePath)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save sticker record"})
	}
	stickerID, _ := result.LastInsertId()

	return c.Status(201).JSON(fiber.Map{"id": stickerID, "image_url": imageURL})
}

func (h *Handler) AdminDeleteSticker(c *fiber.Ctx) error {
	packID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid pack ID"})
	}
	stickerID, err := strconv.ParseInt(c.Params("stickerId"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid sticker ID"})
	}

	var imageURL string
	err = database.DB.QueryRow("SELECT image_url FROM stickers WHERE id = ? AND pack_id = ?", stickerID, packID).Scan(&imageURL)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Sticker not found"})
	}

	_, err = database.DB.Exec("DELETE FROM stickers WHERE id = ?", stickerID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to delete sticker"})
	}

	if localPath := stripUploadsPrefix(imageURL); localPath != "" {
		os.Remove(localPath)
	}
	return c.JSON(fiber.Map{"message": "Sticker deleted"})
}

func stripUploadsPrefix(url string) string {
	if strings.HasPrefix(url, "/uploads/") {
		return "." + url
	}
	return ""
}
