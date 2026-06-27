package models

type FederationServer struct {
	ID              int64  `json:"id"`
	Name            string `json:"name"`
	BaseURL         string `json:"base_url"`
	Status          string `json:"status"`
	DiskCacheLimit  int    `json:"disk_cache_limit"`
	CreatedAt       string `json:"created_at"`
}

type FederationUser struct {
	ID        int64  `json:"id"`
	ServerID  int64  `json:"server_id"`
	RemoteID  int64  `json:"remote_id"`
	Username  string `json:"username"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
	IsAdmin   bool   `json:"is_admin"`
}

type FederationQueueItem struct {
	ID          int64  `json:"id"`
	ServerID    int64  `json:"server_id"`
	Endpoint    string `json:"endpoint"`
	Body        string `json:"body"`
	Attempts    int    `json:"attempts"`
	MaxAttempts int    `json:"max_attempts"`
	LastError   string `json:"last_error"`
	CreatedAt   string `json:"created_at"`
}

type FederationInviteRequest struct {
	MaxUses   int    `json:"max_uses"`
	ExpiresIn string `json:"expires_in,omitempty"`
}

type FederationInviteResponse struct {
	Token     string `json:"token"`
	InviteURL string `json:"invite_url"`
}

type FederationConnectRequest struct {
	InviteURL string `json:"invite_url"`
}

type FederationRecoverRequest struct {
	PeerURL string `json:"peer_url"`
}

type FederationRecoverResponse struct {
	ServerID   int64              `json:"server_id"`
	ServerName string             `json:"server_name"`
	BaseURL    string             `json:"base_url"`
	NewToken   string             `json:"new_token"`
	KnownPeers []FederationServer `json:"known_peers"`
}

type FederationJoinRequest struct {
	Token   string `json:"token"`
	Name    string `json:"name"`
	BaseURL string `json:"base_url"`
	Version string `json:"version,omitempty"`
	Major   int    `json:"major,omitempty"`
}

type FederationJoinResponse struct {
	ServerID    int64  `json:"server_id"`
	Name        string `json:"name"`
	BaseURL     string `json:"base_url"`
	ServerToken string `json:"server_token"`
	Version     string `json:"version,omitempty"`
	Major       int    `json:"major,omitempty"`
}

type FederationServerUpdate struct {
	Name           *string `json:"name,omitempty"`
	DiskCacheLimit *int    `json:"disk_cache_limit,omitempty"`
}

type FederationRouteRequest struct {
	TargetServerID int64       `json:"target_server_id"`
	Action         string      `json:"action"`
	Payload        interface{} `json:"payload"`
}

type GossipIntroduceRequest struct {
	ServerID     int64              `json:"server_id"`
	Name         string             `json:"name"`
	BaseURL      string             `json:"base_url"`
	KnownServers []FederationServer `json:"known_servers"`
}

type GossipNewPeerRequest struct {
	Server      FederationServer `json:"server"`
	ViaServerID int64            `json:"via_server_id"`
	Hops        int              `json:"hops"`
}

type BulkSyncUser struct {
	RemoteID  int64  `json:"remote_id"`
	Username  string `json:"username"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
	IsAdmin   bool   `json:"is_admin"`
}

type BulkSyncMessage struct {
	FromUserID int64    `json:"from_user_id"`
	ToUserID   int64    `json:"to_user_id"`
	Content    string   `json:"content"`
	CreatedAt  string   `json:"created_at"`
	Images     []string `json:"images,omitempty"`
}

type BulkSyncPost struct {
	UserID    int64    `json:"user_id"`
	Content   string   `json:"content"`
	IsPublic  bool     `json:"is_public"`
	CreatedAt string   `json:"created_at"`
	Images    []string `json:"images,omitempty"`
}

type FederationCacheStats struct {
	ServerID     int64   `json:"server_id"`
	TotalBytes   int64   `json:"total_bytes"`
	TotalMB      float64 `json:"total_mb"`
	LimitMB      int     `json:"limit_mb"`
	UsagePercent float64 `json:"usage_percent"`
	FileCount    int     `json:"file_count"`
}

type BulkSyncStickerPack struct {
	Name     string                `json:"name"`
	Stickers []BulkSyncSticker     `json:"stickers"`
}

type BulkSyncSticker struct {
	ImageURL  string `json:"image_url"`
	SortOrder int    `json:"sort_order"`
}
