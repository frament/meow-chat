package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"my-chat-backend/cache"
	"my-chat-backend/database"
	"my-chat-backend/federation"
	"my-chat-backend/models"
	"my-chat-backend/version"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) AdminListFederationServers(c *fiber.Ctx) error {
	rows, err := database.DB.Query(`
		SELECT fs.id, fs.name, fs.base_url, fs.status, fs.disk_cache_limit, fs.created_at,
			COALESCE(SUM(fce.size_bytes), 0) as cache_bytes,
			COUNT(fce.id) as cache_count
		FROM federation_servers fs
		LEFT JOIN federation_cache_entries fce ON fce.server_id = fs.id
		GROUP BY fs.id
		ORDER BY fs.name
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch servers"})
	}
	defer rows.Close()

	type ServerWithStats struct {
		ID             int64  `json:"id"`
		Name           string `json:"name"`
		BaseURL        string `json:"base_url"`
		Status         string `json:"status"`
		DiskCacheLimit int    `json:"disk_cache_limit"`
		CacheBytes     int64  `json:"cache_bytes"`
		CacheCount     int    `json:"cache_count"`
		CreatedAt      string `json:"created_at"`
	}

	servers := make([]ServerWithStats, 0)
	for rows.Next() {
		var s ServerWithStats
		if err := rows.Scan(&s.ID, &s.Name, &s.BaseURL, &s.Status, &s.DiskCacheLimit, &s.CreatedAt, &s.CacheBytes, &s.CacheCount); err != nil {
			continue
		}
		servers = append(servers, s)
	}

	return c.JSON(servers)
}

func (h *Handler) AdminGetFederationServer(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid server ID"})
	}

	var s struct {
		ID             int64  `json:"id"`
		Name           string `json:"name"`
		BaseURL        string `json:"base_url"`
		Status         string `json:"status"`
		DiskCacheLimit int    `json:"disk_cache_limit"`
		CreatedAt      string `json:"created_at"`
	}
	err = database.DB.QueryRow(
		"SELECT id, name, base_url, status, disk_cache_limit, created_at FROM federation_servers WHERE id = ?",
		id,
	).Scan(&s.ID, &s.Name, &s.BaseURL, &s.Status, &s.DiskCacheLimit, &s.CreatedAt)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Server not found"})
	}

	return c.JSON(s)
}

func (h *Handler) AdminCreateFederationInvite(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	var req models.FederationInviteRequest
	if err := c.BodyParser(&req); err != nil {
		req.MaxUses = 1
	}
	if req.MaxUses < 0 {
		req.MaxUses = 0
	}
	if req.MaxUses == 0 {
		req.MaxUses = 1
	}

	token := generateToken()

	var expiresAt *time.Time
	if req.ExpiresIn != "" {
		d, err := time.ParseDuration(req.ExpiresIn)
		if err == nil {
			t := time.Now().Add(d)
			expiresAt = &t
		}
	}

	_, err := database.DB.Exec(
		"INSERT INTO federation_invites (created_by, token, max_uses, expires_at) VALUES (?, ?, ?, ?)",
		userID, token, req.MaxUses, expiresAt,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create invite"})
	}

	inviteURL := c.BaseURL() + "/admin/federation/join?token=" + token

	return c.Status(201).JSON(models.FederationInviteResponse{
		Token:     token,
		InviteURL: inviteURL,
	})
}

func (h *Handler) AdminConnectFederation(c *fiber.Ctx) error {
	var req models.FederationConnectRequest
	if err := c.BodyParser(&req); err != nil || req.InviteURL == "" {
		return c.Status(400).JSON(fiber.Map{"error": "invite_url required"})
	}

	parsed, err := url.Parse(req.InviteURL)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid invite URL"})
	}

	token := parsed.Query().Get("token")
	if token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "No token in invite URL"})
	}

	remoteBaseURL := parsed.Scheme + "://" + parsed.Host
	joinURL := remoteBaseURL + "/api/federation/v1/join"

	hostname, _ := os.Hostname()
	localName := hostname
	if localName == "" {
		localName = "MeowChat Server"
	}
	localBaseURL := c.BaseURL()

	joinReq := models.FederationJoinRequest{
		Token:   token,
		Name:    localName,
		BaseURL: localBaseURL,
		Version: version.Version,
		Major:   database.CurrentMajor,
	}

	resp, err := fedTransport.SendDirect(joinURL, "POST", "", joinReq, nil)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to contact server: " + err.Error()})
	}
	if resp.StatusCode == 404 || resp.StatusCode == 410 {
		return c.Status(400).JSON(fiber.Map{"error": "Invite token invalid or expired"})
	}
	if resp.StatusCode == 409 {
		return c.Status(409).JSON(fiber.Map{"error": "Server already connected"})
	}
	if resp.StatusCode != 201 {
		return c.Status(502).JSON(fiber.Map{"error": "Server rejected connection: " + string(resp.Body)})
	}

	var joinResp models.FederationJoinResponse
	if err := json.Unmarshal(resp.Body, &joinResp); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Invalid server response"})
	}

	if joinResp.Major != 0 && joinResp.Major != database.CurrentMajor {
		return c.Status(409).JSON(fiber.Map{"error": fmt.Sprintf("Peer incompatible: remote v%d.x.x, local v%d.x.x", joinResp.Major, database.CurrentMajor)})
	}

	_, err = database.DB.Exec(
		"INSERT INTO federation_servers (name, base_url, server_token, status) VALUES (?, ?, ?, 'active')",
		joinResp.Name, joinResp.BaseURL, joinResp.ServerToken,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save server"})
	}

	var newServerID int64
	database.DB.QueryRow("SELECT id FROM federation_servers WHERE base_url = ?", joinResp.BaseURL).Scan(&newServerID)

	// Share users with the remote server
	if newServerID > 0 {
		shareResp, shareErr := fedTransport.Send(federation.FederationRequest{
			ServerID: newServerID,
			Endpoint: "/api/federation/v1/share-users",
			Method:   "POST",
		})
		if shareErr == nil && shareResp.StatusCode == 200 {
			var remoteUsers []struct {
				RemoteID  int64  `json:"remote_id"`
				Username  string `json:"username"`
				AvatarURL string `json:"avatar_url"`
				Email     string `json:"email"`
				IsAdmin   bool   `json:"is_admin"`
			}
			if err := json.Unmarshal(shareResp.Body, &remoteUsers); err == nil {
				for _, u := range remoteUsers {
					isAdminInt := 0
					if u.IsAdmin {
						isAdminInt = 1
					}
					database.DB.Exec(
						`INSERT OR IGNORE INTO federation_users (server_id, remote_id, username, avatar_url, email, is_admin) VALUES (?, ?, ?, ?, ?, ?)`,
						newServerID, u.RemoteID, u.Username, u.AvatarURL, u.Email, isAdminInt,
					)
				}
				log.Printf("Federation: imported %d users from new peer", len(remoteUsers))
			}
		}

		// Sync sticker packs from the new peer
		go syncStickerPacksFromPeer(newServerID)
	}

	return c.JSON(fiber.Map{"message": "Connected to " + joinResp.Name})
}

func (h *Handler) AdminUpdateFederationServer(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid server ID"})
	}

	var req models.FederationServerUpdate
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Name != nil {
		database.DB.Exec("UPDATE federation_servers SET name = ? WHERE id = ?", *req.Name, id)
	}
	if req.DiskCacheLimit != nil {
		database.DB.Exec("UPDATE federation_servers SET disk_cache_limit = ? WHERE id = ?", *req.DiskCacheLimit, id)
	}

	return c.JSON(fiber.Map{"message": "Server updated"})
}

func (h *Handler) AdminBlockFederationServer(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid server ID"})
	}

	database.DB.Exec("UPDATE federation_servers SET status = 'blocked' WHERE id = ?", id)
	return c.JSON(fiber.Map{"message": "Server blocked"})
}

func (h *Handler) AdminUnblockFederationServer(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid server ID"})
	}

	database.DB.Exec("UPDATE federation_servers SET status = 'active' WHERE id = ?", id)
	return c.JSON(fiber.Map{"message": "Server unblocked"})
}

func (h *Handler) AdminDeleteFederationServer(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid server ID"})
	}

	cache.ClearServerCache(id)

	database.DB.Exec("DELETE FROM federation_users WHERE server_id = ?", id)
	database.DB.Exec("DELETE FROM federation_queue WHERE server_id = ?", id)
	database.DB.Exec("DELETE FROM federation_cache_entries WHERE server_id = ?", id)
	database.DB.Exec("DELETE FROM federation_servers WHERE id = ?", id)

	return c.JSON(fiber.Map{"message": "Server disconnected"})
}

func (h *Handler) AdminPingFederationServer(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid server ID"})
	}

	if fedHealth != nil {
		fedHealth.PingServer(id)
	}

	var status string
	database.DB.QueryRow("SELECT status FROM federation_servers WHERE id = ?", id).Scan(&status)

	return c.JSON(fiber.Map{
		"status":  status,
		"message": "Ping completed",
	})
}

func (h *Handler) AdminClearFederationCache(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("serverId"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid server ID"})
	}

	if err := cache.ClearServerCache(id); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to clear cache"})
	}

	return c.JSON(fiber.Map{"message": "Cache cleared"})
}

func (h *Handler) AdminRestoreFederation(c *fiber.Ctx) error {
	var req models.FederationRecoverRequest
	if err := c.BodyParser(&req); err != nil || req.PeerURL == "" {
		return c.Status(400).JSON(fiber.Map{"error": "peer_url required"})
	}

	recoverURL := req.PeerURL
	resp, err := fedTransport.SendDirect(recoverURL, "POST", "", nil, nil)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to contact peer: " + err.Error()})
	}
	if resp.StatusCode != 200 {
		return c.Status(502).JSON(fiber.Map{"error": "Peer rejected recovery: " + string(resp.Body)})
	}

	var recoveryResp models.FederationRecoverResponse
	if err := json.Unmarshal(resp.Body, &recoveryResp); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Invalid peer response"})
	}

	database.DB.Exec(
		"INSERT INTO federation_servers (name, base_url, server_token, status, disk_cache_limit) VALUES (?, ?, ?, 'active', 512)",
		recoveryResp.ServerName, recoveryResp.BaseURL, recoveryResp.NewToken,
	)

	for _, peer := range recoveryResp.KnownPeers {
		database.DB.Exec(
			"INSERT OR IGNORE INTO federation_network (server_id, name, base_url, known_by_server_id) VALUES (?, ?, ?, ?)",
			peer.ID, peer.Name, peer.BaseURL, recoveryResp.ServerID,
		)
	}

	go syncFederationFromPeer(recoveryResp.ServerID)

	return c.JSON(fiber.Map{"message": "Restore initiated — syncing data from peer"})
}

func syncFederationFromPeer(serverID int64) {
	offset := 0
	for {
		resp, err := fedTransport.Send(federation.FederationRequest{
			ServerID: serverID,
			Endpoint: fmt.Sprintf("/api/federation/v1/bulk/users?offset=%d&limit=100", offset),
			Method:   "GET",
		})
		if err != nil || resp.StatusCode != 200 {
			log.Println("Federation sync: users error:", err)
			break
		}
		var users []models.BulkSyncUser
		if err := json.Unmarshal(resp.Body, &users); err != nil || len(users) == 0 {
			break
		}
		for _, u := range users {
			database.DB.Exec(
				"INSERT OR IGNORE INTO federation_users (server_id, remote_id, username, avatar_url, email, is_admin) VALUES (?, ?, ?, ?, ?, ?)",
				serverID, u.RemoteID, u.Username, u.AvatarURL, u.Email, u.IsAdmin,
			)
		}
		offset += 100
	}
}

func (h *Handler) AdminSyncStickerPacks(c *fiber.Ctx) error {
	serverID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid server ID"})
	}

	var name string
	err = database.DB.QueryRow("SELECT name FROM federation_servers WHERE id = ?", serverID).Scan(&name)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Server not found"})
	}

	syncStickerPacksFromPeer(serverID)

	return c.JSON(fiber.Map{"message": "Sticker packs sync initiated from " + name})
}

func syncStickerPacksFromPeer(serverID int64) {
	resp, err := fedTransport.Send(federation.FederationRequest{
		ServerID: serverID,
		Endpoint: "/api/federation/v1/bulk/sticker-packs",
		Method:   "GET",
	})
	if err != nil {
		log.Printf("Federation: failed to fetch sticker packs from server %d: %v", serverID, err)
		return
	}
	if resp.StatusCode != 200 {
		log.Printf("Federation: sticker packs fetch returned %d from server %d", resp.StatusCode, serverID)
		return
	}

	var packs []models.BulkSyncStickerPack
	if err := json.Unmarshal(resp.Body, &packs); err != nil {
		log.Printf("Federation: failed to parse sticker packs from server %d: %v", serverID, err)
		return
	}

	for _, pack := range packs {
		result, err := database.DB.Exec(
			"INSERT INTO sticker_packs (name, server_id) VALUES (?, ?)",
			pack.Name, serverID,
		)
		if err != nil {
			log.Printf("Federation: failed to import sticker pack %q: %v", pack.Name, err)
			continue
		}
		packID, _ := result.LastInsertId()

		for _, s := range pack.Stickers {
			localURL := s.ImageURL
			if strings.HasPrefix(s.ImageURL, "http") {
				data, dlErr := fedTransport.DownloadFile(s.ImageURL)
				if dlErr == nil {
					ext := filepath.Ext(s.ImageURL)
					if ext == "" {
						ext = ".png"
					}
					localName := fmt.Sprintf("fed_pack_%d_%d%s", packID, s.SortOrder, ext)
					localPath := filepath.Join(".", "uploads", "stickers", localName)
					os.MkdirAll(filepath.Dir(localPath), 0755)
					if writeErr := os.WriteFile(localPath, data, 0644); writeErr == nil {
						localURL = "/uploads/stickers/" + localName
					}
				}
			}
			database.DB.Exec(
				"INSERT INTO stickers (pack_id, image_url, sort_order) VALUES (?, ?, ?)",
				packID, localURL, s.SortOrder,
			)
		}
	}
	log.Printf("Federation: imported %d sticker packs from server %d", len(packs), serverID)
}
