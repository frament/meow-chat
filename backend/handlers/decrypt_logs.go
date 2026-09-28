package handlers

import (
	"strconv"

	"my-chat-backend/database"

	"github.com/gofiber/fiber/v2"
)

// LogDecryptFailure records a client-side E2EE decryption failure. Before the
// per-device migration this is the telemetry that tells us whether real users
// are unable to read existing messages, and how widespread it is.
func (h *Handler) LogDecryptFailure(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var req struct {
		Scope         string `json:"scope"`
		PeerID        int64  `json:"peer_id"`
		GroupID       int64  `json:"group_id"`
		MsgType       string `json:"msg_type"`
		ClientVersion string `json:"client_version"`
		Detail        string `json:"detail"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid body"})
	}
	if req.Scope != "dm" && req.Scope != "group" {
		return c.Status(400).JSON(fiber.Map{"error": "scope must be dm or group"})
	}

	_, err := database.DB.Exec(
		`INSERT INTO decrypt_failures (user_id, scope, peer_id, group_id, msg_type, client_version, detail)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		userID, req.Scope, req.PeerID, req.GroupID,
		truncate(req.MsgType, 40), truncate(req.ClientVersion, 40), truncate(req.Detail, 200),
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to record"})
	}
	return c.JSON(fiber.Map{"ok": true})
}

type decryptFailureEntry struct {
	ID            int64  `json:"id"`
	UserID        int64  `json:"user_id"`
	Username      string `json:"username"`
	Scope         string `json:"scope"`
	PeerID        int64  `json:"peer_id"`
	PeerUsername  string `json:"peer_username"`
	GroupID       int64  `json:"group_id"`
	GroupName     string `json:"group_name"`
	MsgType       string `json:"msg_type"`
	ClientVersion string `json:"client_version"`
	Detail        string `json:"detail"`
	CreatedAt     string `json:"created_at"`
}

// AdminDecryptFailures returns aggregates plus recent E2EE decryption failures.
func (h *Handler) AdminDecryptFailures(c *fiber.Ctx) error {
	limit, _ := strconv.Atoi(c.Query("limit", "200"))
	if limit <= 0 || limit > 1000 {
		limit = 200
	}

	var total, dmCount, groupCount, usersCount, groupsCount int
	database.DB.QueryRow("SELECT COUNT(*) FROM decrypt_failures").Scan(&total)
	database.DB.QueryRow("SELECT COUNT(*) FROM decrypt_failures WHERE scope = 'dm'").Scan(&dmCount)
	database.DB.QueryRow("SELECT COUNT(*) FROM decrypt_failures WHERE scope = 'group'").Scan(&groupCount)
	database.DB.QueryRow("SELECT COUNT(DISTINCT user_id) FROM decrypt_failures").Scan(&usersCount)
	database.DB.QueryRow("SELECT COUNT(DISTINCT group_id) FROM decrypt_failures WHERE scope = 'group'").Scan(&groupsCount)

	var lastAt string
	database.DB.QueryRow("SELECT COALESCE(MAX(created_at), '') FROM decrypt_failures").Scan(&lastAt)

	rows, err := database.DB.Query(`
		SELECT f.id, f.user_id, COALESCE(u.username, ''), f.scope,
		       f.peer_id, COALESCE(p.username, ''),
		       f.group_id, COALESCE(g.name, ''),
		       f.msg_type, f.client_version, f.detail, f.created_at
		FROM decrypt_failures f
		LEFT JOIN users u ON u.id = f.user_id
		LEFT JOIN users p ON p.id = f.peer_id
		LEFT JOIN group_chats g ON g.id = f.group_id
		ORDER BY f.id DESC LIMIT ?`, limit)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to fetch"})
	}
	defer rows.Close()

	entries := make([]decryptFailureEntry, 0)
	for rows.Next() {
		var e decryptFailureEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.Username, &e.Scope, &e.PeerID, &e.PeerUsername,
			&e.GroupID, &e.GroupName, &e.MsgType, &e.ClientVersion, &e.Detail, &e.CreatedAt); err != nil {
			continue
		}
		entries = append(entries, e)
	}

	return c.JSON(fiber.Map{
		"total":       total,
		"dm_count":    dmCount,
		"group_count": groupCount,
		"users":       usersCount,
		"groups":      groupsCount,
		"last_at":     lastAt,
		"recent":      entries,
	})
}
