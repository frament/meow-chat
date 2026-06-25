package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"my-chat-backend/database"
	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) SearchGiphy(c *fiber.Ctx) error {
	apiKey, err := database.GetSetting("giphy_api_key")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to read Giphy key"})
	}
	if apiKey == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Giphy API key not configured"})
	}

	query := c.Query("q")
	offset, _ := strconv.Atoi(c.Query("offset", "0"))
	limit, _ := strconv.Atoi(c.Query("limit", "20"))

	u, _ := url.Parse("https://api.giphy.com/v1/gifs/search")
	q := u.Query()
	q.Set("api_key", apiKey)
	q.Set("q", query)
	q.Set("offset", strconv.Itoa(offset))
	q.Set("limit", strconv.Itoa(limit))
	u.RawQuery = q.Encode()

	resp, err := http.Get(u.String())
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to reach Giphy"})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to read Giphy response"})
	}

	var giphyResp struct {
		Data []struct {
			ID     string `json:"id"`
			Images struct {
				Original struct {
					URL    string `json:"url"`
					Width  string `json:"width"`
					Height string `json:"height"`
				} `json:"original"`
				PreviewGif struct {
					URL string `json:"url"`
				} `json:"preview_gif"`
			} `json:"images"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &giphyResp); err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to parse Giphy response"})
	}

	results := make([]models.GiphyResult, 0, len(giphyResp.Data))
	for _, d := range giphyResp.Data {
		w, _ := strconv.Atoi(d.Images.Original.Width)
		h, _ := strconv.Atoi(d.Images.Original.Height)
		results = append(results, models.GiphyResult{
			ID:         d.ID,
			URL:        d.Images.Original.URL,
			PreviewURL: d.Images.PreviewGif.URL,
			Width:      w,
			Height:     h,
		})
	}

	return c.JSON(models.GiphySearchResponse{Results: results})
}

func (h *Handler) TrendingGiphy(c *fiber.Ctx) error {
	apiKey, err := database.GetSetting("giphy_api_key")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to read Giphy key"})
	}
	if apiKey == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Giphy API key not configured"})
	}

	offset, _ := strconv.Atoi(c.Query("offset", "0"))
	limit, _ := strconv.Atoi(c.Query("limit", "20"))

	u, _ := url.Parse("https://api.giphy.com/v1/gifs/trending")
	q := u.Query()
	q.Set("api_key", apiKey)
	q.Set("offset", strconv.Itoa(offset))
	q.Set("limit", strconv.Itoa(limit))
	u.RawQuery = q.Encode()

	resp, err := http.Get(u.String())
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to reach Giphy"})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to read Giphy response"})
	}

	var giphyResp struct {
		Data []struct {
			ID     string `json:"id"`
			Images struct {
				Original struct {
					URL    string `json:"url"`
					Width  string `json:"width"`
					Height string `json:"height"`
				} `json:"original"`
				PreviewGif struct {
					URL string `json:"url"`
				} `json:"preview_gif"`
			} `json:"images"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &giphyResp); err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to parse Giphy response"})
	}

	results := make([]models.GiphyResult, 0, len(giphyResp.Data))
	for _, d := range giphyResp.Data {
		w, _ := strconv.Atoi(d.Images.Original.Width)
		h, _ := strconv.Atoi(d.Images.Original.Height)
		results = append(results, models.GiphyResult{
			ID:         d.ID,
			URL:        d.Images.Original.URL,
			PreviewURL: d.Images.PreviewGif.URL,
			Width:      w,
			Height:     h,
		})
	}

	return c.JSON(models.GiphySearchResponse{Results: results})
}
