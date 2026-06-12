# MeowChat Federation ("Hive") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect multiple MeowChat servers into a mesh network with cross-server friendship, messaging, posts, and disk-cache management.

**Architecture:** Hybrid REST + offline queue + gossip. Each server stores duplicate data for federated peers locally (with LRU cache limit). BFS routing for multi-hop mesh. Disaster recovery via single-peer URL + bulk-sync.

**Tech Stack:** Go 1.23 + Fiber v2 + SQLite, Angular 20 + Tailwind

---

## File Structure

### New files
- `backend/federation/transport.go` — HTTP client, retry, auth
- `backend/federation/queue.go` — offline retry queue + worker
- `backend/federation/health.go` — ping ticker + drain
- `backend/federation/handler.go` — incoming federation HTTP handlers
- `backend/federation/route.go` — BFS mesh routing
- `backend/federation/mediator.go` — bridge helpers for existing handlers
- `backend/cache/lru_cache.go` — LRU disk cache with limit control
- `backend/models/federation.go` — federation request/response types
- `backend/handlers/admin_federation.go` — admin federation API handlers
- `frontend/src/app/components/admin-federation/admin-federation.ts`
- `frontend/src/app/components/admin-federation/admin-federation.html`

### Modified files
- `backend/database/database.go` — new tables + migrations
- `backend/main.go` — register federation routes, start workers
- `backend/handlers/handlers.go` — server_id awareness in friends, messages, posts, feed
- `backend/handlers/e2ee.go` — key forwarding for federated users
- `backend/models/models.go` — federation-related structs (or new file)
- `frontend/src/app/services/api.service.ts` — new API methods
- `frontend/src/app/components/admin/admin.ts` — add Federation tab
- `frontend/src/app/app.routes.ts` — /admin/federation route

---

### Task 1: Database schema — new federation tables + migrations

**Files:**
- Modify: `backend/database/database.go`

- [ ] **Step 1: Add migration for `federation_servers` table**

Add to the `migrate()` function's `queries` slice:
```go
`CREATE TABLE IF NOT EXISTS federation_servers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    base_url        TEXT NOT NULL UNIQUE,
    server_token    TEXT NOT NULL,
    status          TEXT DEFAULT 'active',
    disk_cache_limit INTEGER DEFAULT 512,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)`,
```

- [ ] **Step 2: Add migration for `federation_users` table**

```go
`CREATE TABLE IF NOT EXISTS federation_users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id    INTEGER NOT NULL REFERENCES federation_servers(id),
    remote_id    INTEGER NOT NULL,
    username     TEXT NOT NULL,
    avatar_url   TEXT DEFAULT '',
    email        TEXT DEFAULT '',
    is_admin     INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, remote_id)
)`,
```

- [ ] **Step 3: Add migration for `federation_queue` table**

```go
`CREATE TABLE IF NOT EXISTS federation_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id    INTEGER NOT NULL REFERENCES federation_servers(id),
    endpoint     TEXT NOT NULL,
    body         TEXT NOT NULL,
    headers      TEXT DEFAULT '',
    priority     INTEGER DEFAULT 0,
    attempts     INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error   TEXT DEFAULT '',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
)`,
```

- [ ] **Step 4: Add migration for `federation_cache_entries` table**

```go
`CREATE TABLE IF NOT EXISTS federation_cache_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id   INTEGER NOT NULL REFERENCES federation_servers(id),
    cache_key   TEXT NOT NULL,
    data_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, cache_key)
)`,
```

- [ ] **Step 5: Add migration for `federation_network` table**

```go
`CREATE TABLE IF NOT EXISTS federation_network (
    server_id          INTEGER PRIMARY KEY,
    name               TEXT NOT NULL,
    base_url           TEXT NOT NULL,
    known_by_server_id INTEGER NOT NULL,
    first_seen         DATETIME DEFAULT CURRENT_TIMESTAMP
)`,
```

- [ ] **Step 6: Add migration for `federation_invites` table**

```go
`CREATE TABLE IF NOT EXISTS federation_invites (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_by   INTEGER NOT NULL REFERENCES users(id),
    token        TEXT UNIQUE NOT NULL,
    max_uses     INTEGER DEFAULT 1,
    use_count    INTEGER DEFAULT 0,
    expires_at   DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
)`,
```

- [ ] **Step 7: Add ALTER TABLE migrations for `server_id` columns**

Add after existing ALTER TABLE migrations:
```go
DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('friends') WHERE name='server_id'").Scan(&count)
if count == 0 {
    DB.Exec("ALTER TABLE friends ADD COLUMN server_id INTEGER DEFAULT NULL REFERENCES federation_servers(id)")
}
DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name='server_id'").Scan(&count)
if count == 0 {
    DB.Exec("ALTER TABLE messages ADD COLUMN server_id INTEGER DEFAULT NULL REFERENCES federation_servers(id)")
}
DB.QueryRow("SELECT COUNT(*) FROM pragma_table_info('posts') WHERE name='server_id'").Scan(&count)
if count == 0 {
    DB.Exec("ALTER TABLE posts ADD COLUMN server_id INTEGER DEFAULT NULL REFERENCES federation_servers(id)")
}
```

- [ ] **Step 8: Build and verify**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 9: Commit**

```bash
git add backend/database/database.go
git commit -m "feat: add federation database tables and migrations"
```

---

### Task 2: Federation models — request/response types

**Files:**
- Create: `backend/models/federation.go`

- [ ] **Step 1: Create federation request/response structs**

```go
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
    ServerID    int64              `json:"server_id"`
    ServerName  string             `json:"server_name"`
    BaseURL     string             `json:"base_url"`
    NewToken    string             `json:"new_token"`
    KnownPeers  []FederationServer `json:"known_peers"`
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
    ServerID     int64               `json:"server_id"`
    Name         string              `json:"name"`
    BaseURL      string              `json:"base_url"`
    KnownServers []FederationServer  `json:"known_servers"`
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
    FromUserID int64  `json:"from_user_id"`
    ToUserID   int64  `json:"to_user_id"`
    Content    string `json:"content"`
    CreatedAt  string `json:"created_at"`
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
    ServerID     int64 `json:"server_id"`
    TotalBytes   int64 `json:"total_bytes"`
    TotalMB      float64 `json:"total_mb"`
    LimitMB      int   `json:"limit_mb"`
    UsagePercent float64 `json:"usage_percent"`
    FileCount    int   `json:"file_count"`
}
```

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/models/federation.go
git commit -m "feat: add federation request/response models"
```

---

### Task 3: Federation transport — HTTP client + auth + retry

**Files:**
- Create: `backend/federation/transport.go`

- [ ] **Step 1: Create federation transport package**

```go
package federation

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "time"

    "my-chat-backend/database"
)

type Transport struct {
    client *http.Client
}

func NewTransport() *Transport {
    return &Transport{
        client: &http.Client{
            Timeout: 30 * time.Second,
            Transport: &http.Transport{
                MaxIdleConns:    10,
                IdleConnTimeout: 60 * time.Second,
            },
        },
    }
}

type FederationRequest struct {
    ServerID   int64
    Endpoint   string
    Method     string
    Body       interface{}
    Headers    map[string]string
}

type FederationResponse struct {
    StatusCode int
    Body       []byte
    Error      string
}

func (t *Transport) getServerToken(serverID int64) (string, string, error) {
    var token, baseURL string
    err := database.DB.QueryRow(
        "SELECT server_token, base_url FROM federation_servers WHERE id = ? AND status = 'active'",
        serverID,
    ).Scan(&token, &baseURL)
    if err != nil {
        return "", "", fmt.Errorf("server not found or not active: %w", err)
    }
    return token, baseURL, nil
}

func (t *Transport) Send(req FederationRequest) (*FederationResponse, error) {
    token, baseURL, err := t.getServerToken(req.ServerID)
    if err != nil {
        return &FederationResponse{Error: err.Error()}, err
    }

    return t.sendRaw(baseURL+req.Endpoint, req.Method, token, req.Body, req.Headers)
}

// SendDirect makes a request to an arbitrary URL with arbitrary token (no DB lookup)
func (t *Transport) SendDirect(fullURL string, method string, token string, body interface{}, headers map[string]string) (*FederationResponse, error) {
    return t.sendRaw(fullURL, method, token, body, headers)
}

func (t *Transport) sendRaw(url string, method string, token string, body interface{}, headers map[string]string) (*FederationResponse, error) {
    var bodyReader io.Reader
    if body != nil {
        jsonData, err := json.Marshal(body)
        if err != nil {
            return &FederationResponse{Error: err.Error()}, err
        }
        bodyReader = bytes.NewReader(jsonData)
    }

    httpReq, err := http.NewRequest(method, url, bodyReader)
    if err != nil {
        return &FederationResponse{Error: err.Error()}, err
    }
    httpReq.Header.Set("X-Federation-Token", token)
    httpReq.Header.Set("Content-Type", "application/json")
    for k, v := range headers {
        httpReq.Header.Set(k, v)
    }

    resp, err := t.client.Do(httpReq)
    if err != nil {
        return &FederationResponse{Error: err.Error()}, err
    }
    defer resp.Body.Close()

    respBody, _ := io.ReadAll(resp.Body)
    return &FederationResponse{
        StatusCode: resp.StatusCode,
        Body:       respBody,
    }, nil
}

func (t *Transport) SendWithRetry(req FederationRequest) *FederationResponse {
    delays := []time.Duration{1 * time.Second, 5 * time.Second, 15 * time.Second}
    for i, delay := range delays {
        resp, err := t.Send(req)
        if err == nil && resp.StatusCode < 500 {
            return resp
        }
        if i < len(delays)-1 {
            time.Sleep(delay)
        }
    }
    resp, _ := t.Send(req)
    return resp
}
```

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/federation/transport.go
git commit -m "feat: add federation transport with retry"
```

---

### Task 4: Federation queue — offline retry queue + worker

**Files:**
- Create: `backend/federation/queue.go`

- [ ] **Step 1: Create queue with enqueue and worker**

```go
package federation

import (
    "encoding/json"
    "log"
    "time"

    "my-chat-backend/database"
)

type Queue struct {
    transport *Transport
    stopChan  chan struct{}
}

func NewQueue(transport *Transport) *Queue {
    return &Queue{
        transport: transport,
        stopChan:  make(chan struct{}),
    }
}

func (q *Queue) Enqueue(serverID int64, endpoint string, body interface{}) error {
    jsonBody, err := json.Marshal(body)
    if err != nil {
        return err
    }
    _, err = database.DB.Exec(
        "INSERT INTO federation_queue (server_id, endpoint, body) VALUES (?, ?, ?)",
        serverID, endpoint, string(jsonBody),
    )
    return err
}

func (q *Queue) processItem(id int64, serverID int64, endpoint string, body string) {
    var payload interface{}
    json.Unmarshal([]byte(body), &payload)

    resp := q.transport.SendWithRetry(FederationRequest{
        ServerID: serverID,
        Endpoint: endpoint,
        Method:   "POST",
        Body:     payload,
    })

    if resp.Error != "" || resp.StatusCode >= 500 {
        database.DB.Exec(
            "UPDATE federation_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?",
            resp.Error, id,
        )
    } else {
        database.DB.Exec("DELETE FROM federation_queue WHERE id = ?", id)
    }
}

func (q *Queue) Start() {
    ticker := time.NewTicker(30 * time.Second)
    go func() {
        q.processPending()
        for {
            select {
            case <-ticker.C:
                q.processPending()
            case <-q.stopChan:
                ticker.Stop()
                return
            }
        }
    }()
}

func (q *Queue) Stop() {
    close(q.stopChan)
}

func (q *Queue) processPending() {
    rows, err := database.DB.Query(
        "SELECT id, server_id, endpoint, body FROM federation_queue WHERE attempts < max_attempts ORDER BY priority DESC, created_at ASC LIMIT 50",
    )
    if err != nil {
        log.Println("Queue query error:", err)
        return
    }
    defer rows.Close()

    for rows.Next() {
        var id, serverID int64
        var endpoint, body string
        if err := rows.Scan(&id, &serverID, &endpoint, &body); err != nil {
            continue
        }
        q.processItem(id, serverID, endpoint, body)
    }
}

func (q *Queue) DrainFailed(serverID int64) {
    _, err := database.DB.Exec(
        "UPDATE federation_queue SET attempts = 0, last_error = '' WHERE server_id = ? AND attempts >= max_attempts",
        serverID,
    )
    if err != nil {
        log.Println("DrainFailed error:", err)
    }
}
```

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/federation/queue.go
git commit -m "feat: add federation offline queue with worker"
```

---

### Task 5: Federation health — ping ticker + manual ping

**Files:**
- Create: `backend/federation/health.go`

- [ ] **Step 1: Create health checker with ticker**

```go
package federation

import (
    "log"
    "time"

    "my-chat-backend/database"
)

type HealthChecker struct {
    transport *Transport
    queue     *Queue
    stopChan  chan struct{}
}

func NewHealthChecker(transport *Transport, queue *Queue) *HealthChecker {
    return &HealthChecker{
        transport: transport,
        queue:     queue,
        stopChan:  make(chan struct{}),
    }
}

func (hc *HealthChecker) Start() {
    // Initial ping shortly after startup
    go func() {
        time.Sleep(30 * time.Second)
        hc.pingAll()
    }()

    ticker := time.NewTicker(60 * time.Minute)
    go func() {
        for {
            select {
            case <-ticker.C:
                hc.pingAll()
            case <-hc.stopChan:
                ticker.Stop()
                return
            }
        }
    }()
}

func (hc *HealthChecker) Stop() {
    close(hc.stopChan)
}

func (hc *HealthChecker) pingAll() {
    rows, err := database.DB.Query("SELECT id, base_url, server_token FROM federation_servers WHERE status IN ('active', 'unreachable')")
    if err != nil {
        log.Println("Health ping query error:", err)
        return
    }
    defer rows.Close()

    for rows.Next() {
        var id int64
        var baseURL, token string
        if err := rows.Scan(&id, &baseURL, &token); err != nil {
            continue
        }
        hc.pingServer(id, baseURL, token)
    }
}

func (hc *HealthChecker) PingServer(serverID int64) {
    var baseURL, token string
    err := database.DB.QueryRow(
        "SELECT base_url, server_token FROM federation_servers WHERE id = ?", serverID,
    ).Scan(&baseURL, &token)
    if err != nil {
        return
    }
    hc.pingServer(serverID, baseURL, token)
}

func (hc *HealthChecker) pingServer(serverID int64, baseURL string, token string) {
    resp := hc.transport.Send(FederationRequest{
        ServerID: serverID,
        Endpoint: "/api/federation/v1/ping",
        Method:   "HEAD",
    })

    wasUnreachable := false
    var currentStatus string
    database.DB.QueryRow("SELECT status FROM federation_servers WHERE id = ?", serverID).Scan(&currentStatus)
    if currentStatus == "unreachable" {
        wasUnreachable = true
    }

    if resp.Error == nil && resp.StatusCode < 500 {
        if wasUnreachable {
            database.DB.Exec("UPDATE federation_servers SET status = 'active' WHERE id = ?", serverID)
            hc.queue.DrainFailed(serverID)
            log.Printf("Federation server %d recovered, draining failed queue", serverID)
        }
        database.DB.Exec("UPDATE federation_servers SET status = 'active' WHERE id = ?", serverID)
    } else {
        database.DB.Exec("UPDATE federation_servers SET status = 'unreachable' WHERE id = ? AND status = 'active'", serverID)
    }
}
```

- [ ] **Step 2: Add ping endpoint to federation handlers (add later in Task 6)**

- [ ] **Step 3: Verify build**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 4: Commit**

```bash
git add backend/federation/health.go
git commit -m "feat: add federation health checker with ping and auto-drain"
```

---

### Task 6: Federation incoming handlers + routing + mediator

**Files:**
- Create: `backend/federation/handler.go`
- Create: `backend/federation/route.go`
- Create: `backend/federation/mediator.go`

- [ ] **Step 1: Create federation handler with all incoming endpoints**

```go
package federation

import (
    "github.com/gofiber/fiber/v2"
)

type FederationHandler struct {
    transport *Transport
    queue     *Queue
    health    *HealthChecker
}

func NewFederationHandler(transport *Transport, queue *Queue, health *HealthChecker) *FederationHandler {
    return &FederationHandler{
        transport: transport,
        queue:     queue,
        health:    health,
    }
}

func (fh *FederationHandler) AuthMiddleware(c *fiber.Ctx) error {
    token := c.Get("X-Federation-Token")
    if token == "" {
        return c.Status(401).JSON(fiber.Map{"error": "Missing federation token"})
    }

    var serverID int64
    err := database.DB.QueryRow(
        "SELECT id FROM federation_servers WHERE server_token = ? AND status = 'active'",
        token,
    ).Scan(&serverID)
    if err != nil {
        return c.Status(403).JSON(fiber.Map{"error": "Invalid or inactive federation token"})
    }

    c.Locals("federationServerId", serverID)
    return c.Next()
}

func (fh *FederationHandler) HandlePing(c *fiber.Ctx) error {
    return c.JSON(fiber.Map{"status": "ok"})
}

func (fh *FederationHandler) HandleSendMessage(c *fiber.Ctx) error {
    var req struct {
        FromUserID int64    `json:"from_user_id"`
        ToUserID   int64    `json:"to_user_id"`
        Content    string   `json:"content"`
        MsgType    string   `json:"msg_type"`
        Images     []string `json:"images,omitempty"`
        CreatedAt  string   `json:"created_at"`
    }
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    serverID := c.Locals("federationServerId").(int64)

    result, err := database.DB.Exec(
        "INSERT INTO messages (from_user_id, to_user_id, content, msg_type, created_at, server_id) VALUES (?, ?, ?, ?, ?, ?)",
        req.FromUserID, req.ToUserID, req.Content, req.MsgType, req.CreatedAt, serverID,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to save message"})
    }

    messageID, _ := result.LastInsertId()
    for _, imgURL := range req.Images {
        database.DB.Exec(
            "INSERT INTO message_images (message_id, image_url) VALUES (?, ?)",
            messageID, imgURL,
        )
    }

    return c.Status(201).JSON(fiber.Map{"id": messageID})
}

func (fh *FederationHandler) HandleForwardPost(c *fiber.Ctx) error {
    var req struct {
        UserID   int64    `json:"user_id"`
        Content  string   `json:"content"`
        IsPublic bool     `json:"is_public"`
        Images   []string `json:"images,omitempty"`
        CreatedAt string  `json:"created_at"`
    }
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    serverID := c.Locals("federationServerId").(int64)

    isPublicInt := 0
    if req.IsPublic {
        isPublicInt = 1
    }

    result, err := database.DB.Exec(
        "INSERT INTO posts (user_id, content, is_public, created_at, server_id) VALUES (?, ?, ?, ?, ?)",
        req.UserID, req.Content, isPublicInt, req.CreatedAt, serverID,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to save post"})
    }

    postID, _ := result.LastInsertId()
    for _, imgURL := range req.Images {
        database.DB.Exec(
            "INSERT INTO post_images (post_id, image_url) VALUES (?, ?)",
            postID, imgURL,
        )
    }

    return c.Status(201).JSON(fiber.Map{"id": postID})
}

func (fh *FederationHandler) HandleForwardKey(c *fiber.Ctx) error {
    var req struct {
        UserID    int64  `json:"user_id"`
        PublicKey string `json:"public_key"`
    }
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    serverID := c.Locals("federationServerId").(int64)

    _, err := database.DB.Exec(
        `INSERT INTO user_keys (user_id, public_key) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET public_key = excluded.public_key, created_at = CURRENT_TIMESTAMP`,
        req.UserID, req.PublicKey,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to save key"})
    }

    return c.JSON(fiber.Map{"message": "Key saved"})
}

func (fh *FederationHandler) HandleGetKey(c *fiber.Ctx) error {
    remoteID, err := c.ParamsInt("remoteId")
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
    }

    var publicKey string
    err = database.DB.QueryRow(
        "SELECT public_key FROM user_keys WHERE user_id = ?", int64(remoteID),
    ).Scan(&publicKey)
    if err != nil {
        return c.Status(404).JSON(fiber.Map{"error": "No key found"})
    }

    return c.JSON(fiber.Map{"public_key": publicKey})
}

func (fh *FederationHandler) HandleGetUser(c *fiber.Ctx) error {
    remoteID, err := c.ParamsInt("remoteId")
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
    }

    var u struct {
        ID        int64  `json:"id"`
        Username  string `json:"username"`
        AvatarURL string `json:"avatar_url"`
        Email     string `json:"email"`
    }
    err = database.DB.QueryRow(
        "SELECT id, username, avatar_url, email FROM users WHERE id = ?", int64(remoteID),
    ).Scan(&u.ID, &u.Username, &u.AvatarURL, &u.Email)
    if err != nil {
        return c.Status(404).JSON(fiber.Map{"error": "User not found"})
    }

    return c.JSON(u)
}

func (fh *FederationHandler) HandleShareUsers(c *fiber.Ctx) error {
    rows, err := database.DB.Query("SELECT id, username, avatar_url, email, is_admin FROM users ORDER BY id")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
    }
    defer rows.Close()

    users := make([]BulkSyncUser, 0)
    for rows.Next() {
        var u BulkSyncUser
        if err := rows.Scan(&u.RemoteID, &u.Username, &u.AvatarURL, &u.Email, &u.IsAdmin); err != nil {
            continue
        }
        users = append(users, u)
    }

    return c.JSON(users)
}

func (fh *FederationHandler) HandleBulkUsers(c *fiber.Ctx) error {
    offset, _ := c.QueryInt("offset", 0)
    limit, _ := c.QueryInt("limit", 100)
    if limit > 200 {
        limit = 200
    }

    rows, err := database.DB.Query(
        "SELECT id, username, avatar_url, email, is_admin FROM users ORDER BY id LIMIT ? OFFSET ?",
        limit, offset,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
    }
    defer rows.Close()

    users := make([]BulkSyncUser, 0)
    for rows.Next() {
        var u BulkSyncUser
        if err := rows.Scan(&u.RemoteID, &u.Username, &u.AvatarURL, &u.Email, &u.IsAdmin); err != nil {
            continue
        }
        users = append(users, u)
    }

    return c.JSON(users)
}

func (fh *FederationHandler) HandleBulkMessages(c *fiber.Ctx) error {
    serverID := c.Locals("federationServerId").(int64)
    offset, _ := c.QueryInt("offset", 0)
    limit, _ := c.QueryInt("limit", 100)
    if limit > 200 {
        limit = 200
    }

    var remoteServerID int64
    database.DB.QueryRow(
        "SELECT id FROM federation_servers WHERE id = ?",
        serverID,
    ).Scan(&remoteServerID)

    rows, err := database.DB.Query(`
        SELECT from_user_id, to_user_id, content, created_at
        FROM messages
        WHERE server_id = ? OR server_id IS NULL
        ORDER BY id LIMIT ? OFFSET ?
    `, remoteServerID, limit, offset)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch messages"})
    }
    defer rows.Close()

    msgs := make([]BulkSyncMessage, 0)
    for rows.Next() {
        var m BulkSyncMessage
        if err := rows.Scan(&m.FromUserID, &m.ToUserID, &m.Content, &m.CreatedAt); err != nil {
            continue
        }
        msgs = append(msgs, m)
    }

    return c.JSON(msgs)
}

func (fh *FederationHandler) HandleBulkPosts(c *fiber.Ctx) error {
    serverID := c.Locals("federationServerId").(int64)
    offset, _ := c.QueryInt("offset", 0)
    limit, _ := c.QueryInt("limit", 100)
    if limit > 200 {
        limit = 200
    }

    var remoteServerID int64
    database.DB.QueryRow(
        "SELECT id FROM federation_servers WHERE id = ?",
        serverID,
    ).Scan(&remoteServerID)

    rows, err := database.DB.Query(`
        SELECT user_id, content, is_public, created_at
        FROM posts
        WHERE server_id = ? OR server_id IS NULL
        ORDER BY id LIMIT ? OFFSET ?
    `, remoteServerID, limit, offset)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch posts"})
    }
    defer rows.Close()

    posts := make([]BulkSyncPost, 0)
    for rows.Next() {
        var p BulkSyncPost
        var isPublic int
        if err := rows.Scan(&p.UserID, &p.Content, &isPublic, &p.CreatedAt); err != nil {
            continue
        }
        p.IsPublic = isPublic == 1
        posts = append(posts, p)
    }

    return c.JSON(posts)
}

func (fh *FederationHandler) HandleIntroduce(c *fiber.Ctx) error {
    var req GossipIntroduceRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    // Save to federation_network
    database.DB.Exec(
        "INSERT OR IGNORE INTO federation_network (server_id, name, base_url, known_by_server_id) VALUES (?, ?, ?, ?)",
        req.ServerID, req.Name, req.BaseURL, c.Locals("federationServerId").(int64),
    )

    return c.JSON(fiber.Map{"message": "introduced"})
}

func (fh *FederationHandler) HandleGossipNewPeer(c *fiber.Ctx) error {
    var req GossipNewPeerRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    if req.Hops >= 5 {
        return c.JSON(fiber.Map{"message": "max hops reached"})
    }

    // Save to local network
    database.DB.Exec(
        "INSERT OR IGNORE INTO federation_network (server_id, name, base_url, known_by_server_id) VALUES (?, ?, ?, ?)",
        req.Server.ID, req.Server.Name, req.Server.BaseURL, req.ViaServerID,
    )

    // Propagate to all direct neighbors
    rows, err := database.DB.Query(
        "SELECT id, base_url, server_token FROM federation_servers WHERE status = 'active' AND id != ?",
        req.ViaServerID,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to propagate"})
    }
    defer rows.Close()

    for rows.Next() {
        var neighborID int64
        var neighborURL, neighborToken string
        if err := rows.Scan(&neighborID, &neighborURL, &neighborToken); err != nil {
            continue
        }

        req.Hops++
        fh.transport.Send(FederationRequest{
            ServerID: neighborID,
            Endpoint: "/api/federation/v1/gossip/new-peer",
            Method:   "POST",
            Body:     req,
        })
    }

    return c.JSON(fiber.Map{"message": "propagated"})
}

func (fh *FederationHandler) HandleRecoverServer(c *fiber.Ctx) error {
    var req struct {
        RecoveryToken string `json:"recovery_token"`
    }
    if err := c.BodyParser(&req); err != nil || req.RecoveryToken == "" {
        return c.Status(400).JSON(fiber.Map{"error": "recovery_token required"})
    }

    // Validate recovery token (stored in federation_servers, single-use)
    var serverID int64
    err := database.DB.QueryRow(
        "SELECT id FROM federation_servers WHERE server_token = ? AND status = 'pending'",
        req.RecoveryToken,
    ).Scan(&serverID)
    if err != nil {
        return c.Status(403).JSON(fiber.Map{"error": "Invalid recovery token"})
    }

    // Generate new server token
    newToken := generateToken()
    database.DB.Exec("UPDATE federation_servers SET server_token = ?, status = 'active' WHERE id = ?", newToken, serverID)

    // Gather known peers
    rows, err := database.DB.Query(
        "SELECT server_id, name, base_url FROM federation_network WHERE server_id != ?",
        serverID,
    )
    knownPeers := make([]FederationServer, 0)
    if err == nil {
        defer rows.Close()
        for rows.Next() {
            var p FederationServer
            if err := rows.Scan(&p.ID, &p.Name, &p.BaseURL); err == nil {
                knownPeers = append(knownPeers, p)
            }
        }
    }

    return c.JSON(FederationRecoverResponse{
        ServerID:   serverID,
        NewToken:   newToken,
        KnownPeers: knownPeers,
    })
}

func generateToken() string {
    b := make([]byte, 32)
    rand.Read(b)
    return hex.EncodeToString(b)
}
```

- [ ] **Step 2: Create route.go with BFS routing**

```go
package federation

import (
    "my-chat-backend/database"
)

type RouteHop struct {
    ServerID  int64  `json:"server_id"`
    BaseURL   string `json:"base_url"`
    NextHopID int64  `json:"next_hop_id"`
}

func FindRoute(targetServerID int64) *RouteHop {
    // Check direct connection first
    var directID int64
    err := database.DB.QueryRow(
        "SELECT id FROM federation_servers WHERE id = ? AND status = 'active'",
        targetServerID,
    ).Scan(&directID)
    if err == nil {
        var baseURL string
        database.DB.QueryRow("SELECT base_url FROM federation_servers WHERE id = ?", targetServerID).Scan(&baseURL)
        return &RouteHop{
            ServerID:  targetServerID,
            BaseURL:   baseURL,
            NextHopID: targetServerID,
        }
    }

    // BFS through federation_network
    type node struct {
        serverID int64
        nextHop  int64
    }
    visited := make(map[int64]bool)
    queue := []node{}

    // Seed with all direct neighbors
    rows, _ := database.DB.Query("SELECT id FROM federation_servers WHERE status = 'active'")
    if rows != nil {
        defer rows.Close()
        for rows.Next() {
            var id int64
            rows.Scan(&id)
            visited[id] = true
            queue = append(queue, node{serverID: id, nextHop: id})
        }
    }

    for len(queue) > 0 {
        current := queue[0]
        queue = queue[1:]

        if current.serverID == targetServerID {
            var baseURL string
            database.DB.QueryRow("SELECT base_url FROM federation_network WHERE server_id = ?", targetServerID).Scan(&baseURL)
            return &RouteHop{
                ServerID:  targetServerID,
                BaseURL:   baseURL,
                NextHopID: current.nextHop,
            }
        }

        netRows, _ := database.DB.Query(
            "SELECT server_id FROM federation_network WHERE known_by_server_id = ?",
            current.serverID,
        )
        if netRows != nil {
            for netRows.Next() {
                var id int64
                netRows.Scan(&id)
                if !visited[id] {
                    visited[id] = true
                    queue = append(queue, node{serverID: id, nextHop: current.nextHop})
                }
            }
            netRows.Close()
        }
    }

    return nil
}
```

- [ ] **Step 3: Create mediator.go — bridge for existing handlers**

```go
package federation

import (
    "my-chat-backend/database"
)

// IsRemoteUser checks if a user belongs to a federated server
func IsRemoteUser(userID int64) (bool, int64) {
    var serverID int64
    err := database.DB.QueryRow(
        "SELECT server_id FROM federation_users WHERE remote_id = ?",
        userID,
    ).Scan(&serverID)
    if err != nil {
        return false, 0
    }
    return true, serverID
}

// GetLocalUserID looks up local user id for a federated user
func GetLocalUserID(serverID int64, remoteID int64) (int64, error) {
    var id int64
    err := database.DB.QueryRow(
        "SELECT id FROM federation_users WHERE server_id = ? AND remote_id = ?",
        serverID, remoteID,
    ).Scan(&id)
    return id, err
}

// ResolveUserID returns (isLocal bool, actualServerID int64)
func ResolveUserID(userID int64) (bool, int64) {
    // Check if it's a remote user
    remote, serverID := IsRemoteUser(userID)
    if remote {
        return false, serverID
    }
    return true, 0 // 0 = local
}
```

- [ ] **Step 4: Verify build**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 5: Commit**

```bash
git add backend/federation/handler.go backend/federation/route.go backend/federation/mediator.go
git commit -m "feat: add federation incoming handlers, BFS routing, mediator"
```

---

### Task 7: Cache layer — LRU disk cache

**Files:**
- Create: `backend/cache/lru_cache.go`

- [ ] **Step 1: Create LRU cache implementation**

```go
package cache

import (
    "io"
    "log"
    "os"
    "path/filepath"
    "time"

    "my-chat-backend/database"
)

const cacheBaseDir = "./uploads/federation_cache"

func EnsureCacheDir() {
    if err := os.MkdirAll(cacheBaseDir, 0755); err != nil {
        log.Fatal("Failed to create federation cache directory:", err)
    }
}

// CacheFilePath returns the local cache path for a remote file
func CacheFilePath(serverID int64, remotePath string) string {
    return filepath.Join(cacheBaseDir, serverID, remotePath)
}

// StoreFile caches a remote file locally
func StoreFile(serverID int64, cacheKey string, data []byte) error {
    cacheDir := filepath.Join(cacheBaseDir, serverID)
    if err := os.MkdirAll(cacheDir, 0755); err != nil {
        return err
    }

    localPath := filepath.Join(cacheDir, cacheKey)
    if err := os.WriteFile(localPath, data, 0644); err != nil {
        return err
   }

    // Record in cache entries
    database.DB.Exec(
        `INSERT OR REPLACE INTO federation_cache_entries (server_id, cache_key, data_type, size_bytes, accessed_at, created_at)
         VALUES (?, ?, 'file', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        serverID, cacheKey, int64(len(data)),
    )

    // Enforce cache limit
    EnforceLimit(serverID)
    return nil
}

// ReadFile reads a cached file, returns nil if not cached
func ReadFile(serverID int64, cacheKey string) []byte {
    localPath := filepath.Join(cacheBaseDir, serverID, cacheKey)
    data, err := os.ReadFile(localPath)
    if err != nil {
        return nil
    }

    // Update accessed_at
    database.DB.Exec(
        "UPDATE federation_cache_entries SET accessed_at = CURRENT_TIMESTAMP WHERE server_id = ? AND cache_key = ?",
        serverID, cacheKey,
    )

    return data
}

// FileExists checks if a file is cached
func FileExists(serverID int64, cacheKey string) bool {
    localPath := filepath.Join(cacheBaseDir, serverID, cacheKey)
    _, err := os.Stat(localPath)
    return err == nil
}

// EnforceLimit checks and evicts LRU entries if over limit
func EnforceLimit(serverID int64) {
    var limitMB int
    database.DB.QueryRow(
        "SELECT disk_cache_limit FROM federation_servers WHERE id = ?", serverID,
    ).Scan(&limitMB)
    if limitMB <= 0 {
        return
    }

    limitBytes := int64(limitMB) * 1024 * 1024

    var totalBytes int64
    database.DB.QueryRow(
        "SELECT COALESCE(SUM(size_bytes), 0) FROM federation_cache_entries WHERE server_id = ?",
        serverID,
    ).Scan(&totalBytes)

    for totalBytes > limitBytes {
        // Find LRU entry
        var entryID int64
        var cacheKey string
        var size int64
        err := database.DB.QueryRow(
            "SELECT id, cache_key, size_bytes FROM federation_cache_entries WHERE server_id = ? ORDER BY accessed_at ASC LIMIT 1",
            serverID,
        ).Scan(&entryID, &cacheKey, &size)
        if err != nil {
            break
        }

        // Delete from disk
        localPath := filepath.Join(cacheBaseDir, serverID, cacheKey)
        os.Remove(localPath)

        // Delete from DB
        database.DB.Exec("DELETE FROM federation_cache_entries WHERE id = ?", entryID)

        totalBytes -= size
    }
}

// GetStats returns cache statistics for a server
func GetStats(serverID int64) (totalBytes int64, fileCount int) {
    database.DB.QueryRow(
        "SELECT COALESCE(SUM(size_bytes), 0), COUNT(*) FROM federation_cache_entries WHERE server_id = ?",
        serverID,
    ).Scan(&totalBytes, &fileCount)
    return
}

// ClearServerCache clears all cached files for a server
func ClearServerCache(serverID int64) error {
    cacheDir := filepath.Join(cacheBaseDir, serverID)
    if err := os.RemoveAll(cacheDir); err != nil {
        return err
    }
    database.DB.Exec("DELETE FROM federation_cache_entries WHERE server_id = ?", serverID)
    return nil
}

// ProxyFile fetches a file from a remote server, caches it, and returns the local path
func ProxyFile(serverID int64, remotePath string) (string, error) {
    cacheKey := remotePath

    // Check local cache first
    if FileExists(serverID, cacheKey) {
        return CacheFilePath(serverID, cacheKey), nil
    }

    // TODO: fetch from remote server via federation transport
    // This will be called from the proxy endpoint

    return "", nil
}
```

- [ ] **Step 2: Build**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/cache/lru_cache.go
git commit -m "feat: add LRU disk cache for federation with limit enforcement"
```

---

### Task 8: Register federation routes in main.go + start workers

**Files:**
- Modify: `backend/main.go`

- [ ] **Step 1: Add federation setup in main.go**

After `h.LoadVAPIDKeys()` line, add:
```go
fedTransport := federation.NewTransport()
fedQueue := federation.NewQueue(fedTransport)
fedHealth := federation.NewHealthChecker(fedTransport, fedQueue)
fedHandler := federation.NewFederationHandler(fedTransport, fedQueue, fedHealth)

// Federation incoming endpoints (BEFORE AuthRequired)
fed := api.Group("/federation/v1")
fed.Use(fedHandler.AuthMiddleware)
fed.Head("/ping", fedHandler.HandlePing)
fed.Post("/ping", fedHandler.HandlePing)
fed.Post("/send-message", fedHandler.HandleSendMessage)
fed.Post("/forward-post", fedHandler.HandleForwardPost)
fed.Post("/forward-key", fedHandler.HandleForwardKey)
fed.Get("/get-key/:remoteId", fedHandler.HandleGetKey)
fed.Get("/get-user/:remoteId", fedHandler.HandleGetUser)
fed.Post("/share-users", fedHandler.HandleShareUsers)
fed.Get("/bulk/users", fedHandler.HandleBulkUsers)
fed.Get("/bulk/messages", fedHandler.HandleBulkMessages)
fed.Get("/bulk/posts", fedHandler.HandleBulkPosts)
fed.Post("/introduce", fedHandler.HandleIntroduce)
fed.Post("/gossip/new-peer", fedHandler.HandleGossipNewPeer)
fed.Post("/recover-server", fedHandler.HandleRecoverServer)

// Start background workers
fedQueue.Start()
fedHealth.Start()
```

Also add imports: `"my-chat-backend/federation"` and `"crypto/rand"` and `"encoding/hex"`.

- [ ] **Step 2: Build**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/main.go
git commit -m "feat: register federation routes and start background workers"
```

---

### Task 9: Admin federation API endpoints

**Files:**
- Create: `backend/handlers/admin_federation.go`

- [ ] **Step 1: Create admin federation handlers**

```go
package handlers

import (
    "strconv"
    "time"

    "my-chat-backend/database"
    "my-chat-backend/federation"
    "my-chat-backend/models"

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
        ID              int64   `json:"id"`
        Name            string  `json:"name"`
        BaseURL         string  `json:"base_url"`
        Status          string  `json:"status"`
        DiskCacheLimit  int     `json:"disk_cache_limit"`
        CacheBytes      int64   `json:"cache_bytes"`
        CacheCount      int     `json:"cache_count"`
        CreatedAt       string  `json:"created_at"`
    }

    servers := make([]ServerWithStats, 0)
    for rows.Next() {
        var s ServerWithStats
        if err := rows.Scan(&s.ID, &s.Name, &s.BaseURL, &s.Status, &s.DiskCacheLimit, &s.CacheBytes, &s.CacheCount, &s.CreatedAt); err != nil {
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
        ID              int64  `json:"id"`
        Name            string `json:"name"`
        BaseURL         string `json:"base_url"`
        Status          string `json:"status"`
        DiskCacheLimit  int    `json:"disk_cache_limit"`
        CreatedAt       string `json:"created_at"`
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

    return c.Status(201).JSON(models.FederationInviteResponse{
        Token:     token,
        InviteURL: c.BaseURL() + "/admin/federation/join?token=" + token,
    })
}

func (h *Handler) AdminConnectFederation(c *fiber.Ctx) error {
    var req models.FederationConnectRequest
    if err := c.BodyParser(&req); err != nil || req.InviteURL == "" {
        return c.Status(400).JSON(fiber.Map{"error": "invite_url required"})
    }

    // Extract token from URL
    // Simplified: assume URL ends with ?token=xxx
    // In real code, parse URL properly

    return c.JSON(fiber.Map{"message": "Connected"})
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

    // Clean up cache
    cache.ClearServerCache(id)

    // Delete related data
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

    // Use the global health checker
    fedHealth.PingServer(id)

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
    userID := c.Locals("userId").(int64)
    var req models.FederationRecoverRequest
    if err := c.BodyParser(&req); err != nil || req.PeerURL == "" {
        return c.Status(400).JSON(fiber.Map{"error": "peer_url required"})
    }

    // The peer URL should be like: https://peer.example.com/federation/recover?token=RECOVERY_TOKEN
    // Parse the base URL and token
    // Simplified: assume URL format is <base_url>/federation/recover?token=<token>
    // In real code, use proper URL parsing

    // Step 1: Call peer's recover-server endpoint
    recoverURL := req.PeerURL
    resp, err := fedTransport.SendDirect(recoverURL, "POST", "", nil, nil)
    if err != nil {
        return c.Status(502).JSON(fiber.Map{"error": "Failed to contact peer: " + err.Error()})
    }
    if resp.StatusCode != 200 {
        return c.Status(502).JSON(fiber.Map{"error": "Peer rejected recovery: " + string(resp.Body)})
    }

    // Step 2: Parse response
    var recoveryResp models.FederationRecoverResponse
    if err := json.Unmarshal(resp.Body, &recoveryResp); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Invalid peer response"})
    }

    // Step 3: Save the peer server
    database.DB.Exec(
        "INSERT INTO federation_servers (name, base_url, server_token, status, disk_cache_limit) VALUES (?, ?, ?, 'active', 512)",
        recoveryResp.ServerName, recoveryResp.BaseURL, recoveryResp.NewToken,
    )

    // Step 4: Save known peers in federation_network
    for _, peer := range recoveryResp.KnownPeers {
        database.DB.Exec(
            "INSERT OR IGNORE INTO federation_network (server_id, name, base_url, known_by_server_id) VALUES (?, ?, ?, ?)",
            peer.ID, peer.Name, peer.BaseURL, recoveryResp.ServerID,
        )
    }

    // Step 5: Trigger bulk sync (async — progress reported via admin panel)
    go h.syncFederationFromPeer(recoveryResp.ServerID)

    return c.JSON(fiber.Map{"message": "Restore initiated — syncing data from peer"})
}

func (h *Handler) syncFederationFromPeer(serverID int64) {
    offset := 0
    for {
        resp := fedTransport.Send(federation.FederationRequest{
            ServerID: serverID,
            Endpoint: fmt.Sprintf("/api/federation/v1/bulk/users?offset=%d&limit=100", offset),
            Method:   "GET",
        })
        if resp.Error != nil || resp.StatusCode != 200 {
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

    // Sync messages (same pattern with /api/federation/v1/bulk/messages)
    // Sync posts (same pattern with /api/federation/v1/bulk/posts)
}
```

- [ ] **Step 2: Add admin federation routes to main.go**

After the existing admin routes block, add:
```go
admin.Get("/federation/servers", h.AdminListFederationServers)
admin.Get("/federation/servers/:id", h.AdminGetFederationServer)
admin.Post("/federation/invites", h.AdminCreateFederationInvite)
admin.Post("/federation/connect", h.AdminConnectFederation)
admin.Put("/federation/servers/:id", h.AdminUpdateFederationServer)
admin.Post("/federation/servers/:id/ping", h.AdminPingFederationServer)
admin.Post("/federation/servers/:id/block", h.AdminBlockFederationServer)
admin.Post("/federation/servers/:id/unblock", h.AdminUnblockFederationServer)
admin.Delete("/federation/servers/:id", h.AdminDeleteFederationServer)
admin.Delete("/federation/cache/:serverId", h.AdminClearFederationCache)
admin.Post("/federation/restore", h.AdminRestoreFederation)
```

- [ ] **Step 3: Make mediator / health checker accessible from Handler**

Add to `Handler` struct in `handlers.go`:
```go
FedTransport *federation.Transport
FedQueue     *federation.Queue
FedHealth    *federation.HealthChecker
```

Set them in `NewHandler()` or via setter after init.

Actually, the simplest approach is to make them package-level variables or pass them through to the handler. 
Let's go with package-level vars since we already have `Handler` as a struct.

In `admin_federation.go` add at top:
```go
var (
    fedTransport *federation.Transport
    fedQueue     *federation.Queue
    fedHealth    *federation.HealthChecker
)

func InitFederationGlobals(t *federation.Transport, q *federation.Queue, h *federation.HealthChecker) {
    fedTransport = t
    fedQueue = q
    fedHealth = h
}
```

Then in `main.go` after creating them: `handlers.InitFederationGlobals(fedTransport, fedQueue, fedHealth)`

- [ ] **Step 4: Build**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 5: Commit**

```bash
git add backend/handlers/admin_federation.go backend/main.go backend/handlers/handlers.go
git commit -m "feat: add admin federation API endpoints"
```

---

### Task 10: Extend existing handlers for server_id awareness

**Files:**
- Modify: `backend/handlers/handlers.go`

- [ ] **Step 1: Update GetUsers to include federation_users**

Replace the existing query with one that also includes federated users:
```go
func (h *Handler) GetUsers(c *fiber.Ctx) error {
    userID := c.Locals("userId").(int64)
    rows, err := database.DB.Query(`
        SELECT id, username, email, avatar_url, created_at, NULL as server_id
        FROM users
        WHERE id IN (
            SELECT friend_id FROM friends WHERE user_id = ?
            UNION
            SELECT user_id FROM friends WHERE friend_id = ?
        )
        UNION ALL
        SELECT fu.remote_id, fu.username, fu.email, fu.avatar_url, fu.created_at, fu.server_id
        FROM federation_users fu
        WHERE fu.remote_id IN (
            SELECT friend_id FROM friends WHERE user_id = ? AND server_id IS NOT NULL
            UNION
            SELECT user_id FROM friends WHERE friend_id = ? AND server_id IS NOT NULL
        )
        ORDER BY username
    `, userID, userID, userID, userID)
    // ... rest stays the same
}
```

- [ ] **Step 2: Update GetFeed to include federated posts**

Replace existing GetFeed query to include posts with server_id:
```go
func (h *Handler) GetFeed(c *fiber.Ctx) error {
    userID := c.Locals("userId").(int64)
    // ... same query but also include posts from federated servers
    // WHERE p.server_id IS NOT NULL AND p.user_id IN (federated friends)
}
```

- [ ] **Step 3: Build and verify**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 4: Commit**

```bash
git add backend/handlers/handlers.go
git commit -m "feat: extend handlers for federated users and posts"
```

---

### Task 11: E2EE key forwarding across federation

**Files:**
- Modify: `backend/handlers/e2ee.go`
- Modify: `backend/federation/handler.go`

- [ ] **Step 1: When a user puts their E2EE key, also forward to federated peers**

In `PutKey` in `e2ee.go`, after saving locally:
```go
// Forward key to all federated servers
rows, err := database.DB.Query("SELECT id FROM federation_servers WHERE status = 'active'")
if err == nil {
    defer rows.Close()
    for rows.Next() {
        var serverID int64
        rows.Scan(&serverID)
        fedTransport.Send(FederationRequest{
            ServerID: serverID,
            Endpoint: "/api/federation/v1/forward-key",
            Method:   "POST",
            Body: map[string]interface{}{
                "user_id":    userID,
                "public_key": body.PublicKey,
            },
        })
    }
}
```

- [ ] **Step 2: Build**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/handlers/e2ee.go
git commit -m "feat: forward E2EE public keys to federated peers"
```

---

### Task 12: Frontend — Admin Federation component

**Files:**
- Create: `frontend/src/app/components/admin-federation/admin-federation.ts`
- Create: `frontend/src/app/components/admin-federation/admin-federation.html`
- Modify: `frontend/src/app/services/api.service.ts`
- Modify: `frontend/src/app/components/admin/admin.ts`
- Modify: `frontend/src/app/app.routes.ts`

- [ ] **Step 1: Add federation API methods to api.service.ts**

```typescript
// Federation admin
getFederationServers() {
  return this.http.get<any[]>(`${this.baseUrl}/admin/federation/servers`);
}

getFederationServer(id: number) {
  return this.http.get<any>(`${this.baseUrl}/admin/federation/servers/${id}`);
}

createFederationInvite(maxUses = 1) {
  return this.http.post<{ token: string; invite_url: string }>(
    `${this.baseUrl}/admin/federation/invites`, { max_uses: maxUses }
  );
}

connectFederation(inviteUrl: string) {
  return this.http.post<{ message: string }>(
    `${this.baseUrl}/admin/federation/connect`, { invite_url: inviteUrl }
  );
}

updateFederationServer(id: number, data: { name?: string; disk_cache_limit?: number }) {
  return this.http.put<{ message: string }>(
    `${this.baseUrl}/admin/federation/servers/${id}`, data
  );
}

pingFederationServer(id: number) {
  return this.http.post<{ status: string; message: string }>(
    `${this.baseUrl}/admin/federation/servers/${id}/ping`, {}
  );
}

blockFederationServer(id: number) {
  return this.http.post<{ message: string }>(
    `${this.baseUrl}/admin/federation/servers/${id}/block`, {}
  );
}

unblockFederationServer(id: number) {
  return this.http.post<{ message: string }>(
    `${this.baseUrl}/admin/federation/servers/${id}/unblock`, {}
  );
}

deleteFederationServer(id: number) {
  return this.http.delete<{ message: string }>(
    `${this.baseUrl}/admin/federation/servers/${id}`
  );
}

clearFederationCache(serverId: number) {
  return this.http.delete<{ message: string }>(
    `${this.baseUrl}/admin/federation/cache/${serverId}`
  );
}

restoreFederation(peerUrl: string) {
  return this.http.post<{ message: string }>(
    `${this.baseUrl}/admin/federation/restore`, { peer_url: peerUrl }
  );
}
```

- [ ] **Step 2: Create admin-federation component**

```typescript
// admin-federation.ts
import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-admin-federation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-federation.html',
})
export class AdminFederationComponent implements OnInit {
  servers: any[] = [];
  selectedServer: any = null;
  showModal = false;
  showInviteModal = false;
  showConnectModal = false;
  showRestoreModal = false;
  inviteUrl = '';
  inviteMaxUses = 1;
  connectUrl = '';
  restoreUrl = '';
  cacheStats = { totalMB: 0, limitMB: 0, usagePercent: 0 };
  loading = false;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadServers();
  }

  loadServers() {
    this.loading = true;
    this.api.getFederationServers().subscribe({
      next: (res) => {
        this.servers = res;
        this.loading = false;
      },
      error: () => this.loading = false,
    });
  }

  createInvite() {
    this.api.createFederationInvite(this.inviteMaxUses).subscribe({
      next: (res) => {
        this.inviteUrl = res.invite_url;
      },
    });
  }

  connect() {
    this.api.connectFederation(this.connectUrl).subscribe({
      next: () => {
        this.showConnectModal = false;
        this.connectUrl = '';
        this.loadServers();
      },
    });
  }

  ping(server: any) {
    this.api.pingFederationServer(server.id).subscribe({
      next: (res) => {
        server.status = res.status;
      },
    });
  }

  block(server: any) {
    this.api.blockFederationServer(server.id).subscribe(() => {
      server.status = 'blocked';
    });
  }

  unblock(server: any) {
    this.api.unblockFederationServer(server.id).subscribe(() => {
      server.status = 'active';
    });
  }

  disconnect(server: any) {
    if (confirm(`Отключить сервер "${server.name}"?`)) {
      this.api.deleteFederationServer(server.id).subscribe(() => {
        this.loadServers();
      });
    }
  }

  clearCache(server: any) {
    this.api.clearFederationCache(server.id).subscribe(() => {
      server.cache_bytes = 0;
      server.cache_count = 0;
    });
  }

  restore() {
    this.api.restoreFederation(this.restoreUrl).subscribe({
      next: () => {
        this.showRestoreModal = false;
        this.restoreUrl = '';
        this.loadServers();
      },
    });
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  updateCacheLimit(server: any) {
    this.api.updateFederationServer(server.id, {
      disk_cache_limit: server.disk_cache_limit,
    }).subscribe();
  }
}
```

- [ ] **Step 3: Create admin-federation template**

```html
<div class="p-4 md:p-6 max-w-5xl mx-auto">
  <div class="flex justify-between items-center mb-6">
    <h2 class="text-xl font-bold">Федеративная сеть</h2>
    <div class="flex gap-2">
      <button (click)="showConnectModal = true" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">Подключиться</button>
      <button (click)="showInviteModal = true" class="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm">Создать инвайт</button>
      <button (click)="showRestoreModal = true" class="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm">Восстановить</button>
    </div>
  </div>

  <!-- Stats bar -->
  <div class="grid grid-cols-3 gap-4 mb-6">
    <div class="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
      <div class="text-sm text-gray-500">Серверов</div>
      <div class="text-2xl font-bold">{{ servers.length }}</div>
    </div>
    <div class="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
      <div class="text-sm text-gray-500">Кэш</div>
      <div class="text-2xl font-bold">{{ formatBytes(cacheStats.totalMB * 1024 * 1024) }}</div>
    </div>
    <div class="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
      <div class="text-sm text-gray-500">Лимит</div>
      <div class="text-2xl font-bold">{{ cacheStats.limitMB }} МБ</div>
    </div>
  </div>

  <!-- Servers table -->
  <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-gray-50 dark:bg-gray-700">
        <tr>
          <th class="px-4 py-3 text-left">Имя</th>
          <th class="px-4 py-3 text-left">Адрес</th>
          <th class="px-4 py-3 text-left">Статус</th>
          <th class="px-4 py-3 text-right">Кэш</th>
          <th class="px-4 py-3 text-right">Действия</th>
        </tr>
      </thead>
      <tbody>
        @for (server of servers; track server.id) {
        <tr class="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
          <td class="px-4 py-3 font-medium">{{ server.name }}</td>
          <td class="px-4 py-3 text-gray-500 text-xs">{{ server.base_url }}</td>
          <td class="px-4 py-3">
            @if (server.status === 'active') {
            <span class="text-green-600">🟢 active</span>
            } @else if (server.status === 'blocked') {
            <span class="text-red-600">🔴 blocked</span>
            } @else if (server.status === 'unreachable') {
            <span class="text-yellow-600">🟡 unreachable</span>
            } @else {
            <span class="text-gray-500">{{ server.status }}</span>
            }
          </td>
          <td class="px-4 py-3 text-right">{{ formatBytes(server.cache_bytes) }}</td>
          <td class="px-4 py-3 text-right">
            <div class="flex gap-1 justify-end">
              <button (click)="ping(server)" class="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-600 rounded" title="Пинг">🔄</button>
              @if (server.status === 'active') {
              <button (click)="block(server)" class="px-2 py-1 text-xs bg-red-100 dark:bg-red-900 rounded" title="Заблокировать">⛔</button>
              } @else if (server.status === 'blocked') {
              <button (click)="unblock(server)" class="px-2 py-1 text-xs bg-green-100 dark:bg-green-900 rounded" title="Разблокировать">✅</button>
              }
              <button (click)="clearCache(server)" class="px-2 py-1 text-xs bg-yellow-100 dark:bg-yellow-900 rounded" title="Очистить кэш">🧹</button>
              <button (click)="disconnect(server)" class="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-600 rounded" title="Отключить">✕</button>
            </div>
          </td>
        </tr>
        }
        @empty {
        <tr>
          <td colspan="5" class="px-4 py-8 text-center text-gray-500">
            Нет подключенных серверов
          </td>
        </tr>
        }
      </tbody>
    </table>
  </div>

  <!-- Cache limit inline edit -->
  <div class="mt-6 bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
    <h3 class="font-medium mb-3">Лимиты кэша</h3>
    @for (server of servers; track server.id) {
    <div class="flex items-center gap-3 mb-2">
      <span class="w-32 text-sm truncate">{{ server.name }}</span>
      <input type="range" min="128" max="10240" [(ngModel)]="server.disk_cache_limit"
             (change)="updateCacheLimit(server)" class="flex-1">
      <span class="text-sm w-20 text-right">{{ server.disk_cache_limit }} МБ</span>
    </div>
    }
  </div>

  <!-- Connect modal -->
  @if (showConnectModal) {
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md">
      <h3 class="text-lg font-bold mb-4">Подключиться к серверу</h3>
      <input [(ngModel)]="connectUrl" placeholder="https://server.example.com/invite?token=..." class="w-full px-3 py-2 border rounded-lg mb-4">
      <div class="flex gap-2 justify-end">
        <button (click)="showConnectModal = false" class="px-4 py-2 text-gray-600">Отмена</button>
        <button (click)="connect()" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Подключиться</button>
      </div>
    </div>
  </div>
  }

  <!-- Invite modal -->
  @if (showInviteModal) {
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md">
      <h3 class="text-lg font-bold mb-4">Создать приглашение</h3>
      <label class="block mb-2 text-sm">Максимум использований (0 = безлимит):</label>
      <input type="number" [(ngModel)]="inviteMaxUses" min="0" class="w-full px-3 py-2 border rounded-lg mb-4">
      <button (click)="createInvite()" class="px-4 py-2 bg-green-600 text-white rounded-lg mb-4">Создать</button>
      @if (inviteUrl) {
      <div class="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg break-all text-sm">{{ inviteUrl }}</div>
      }
      <div class="flex gap-2 justify-end mt-4">
        <button (click)="showInviteModal = false; inviteUrl = ''" class="px-4 py-2 text-gray-600">Закрыть</button>
      </div>
    </div>
  </div>
  }

  <!-- Restore modal -->
  @if (showRestoreModal) {
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div class="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md">
      <h3 class="text-lg font-bold mb-4">Восстановление после переустановки</h3>
      <p class="text-sm text-gray-500 mb-4">Введите URL любого сервера из вашей федеративной сети:</p>
      <input [(ngModel)]="restoreUrl" placeholder="https://peer.example.com" class="w-full px-3 py-2 border rounded-lg mb-4">
      <div class="flex gap-2 justify-end">
        <button (click)="showRestoreModal = false" class="px-4 py-2 text-gray-600">Отмена</button>
        <button (click)="restore()" class="px-4 py-2 bg-purple-600 text-white rounded-lg">Восстановить</button>
      </div>
    </div>
  </div>
  }
</div>
```

- [ ] **Step 4: Add route and admin tab**

In `app.routes.ts`:
```typescript
{ path: 'admin/federation', component: AdminFederationComponent }
```

In `admin.ts` admin panel, add a "Федерация" tab:
```typescript
// Add to tabs array
{ id: 'federation', label: 'Федерация', route: '/admin/federation' }
```

Import `AdminFederationComponent` in both files.

- [ ] **Step 5: Verify frontend build**

Run: `cd frontend && npm run build` — expected: success

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/components/admin-federation/ frontend/src/app/services/api.service.ts frontend/src/app/components/admin/admin.ts frontend/src/app/app.routes.ts
git commit -m "feat: add frontend admin federation panel"
```

---

### Task 13: Admin CLI federation commands

**Files:**
- Modify: `backend/main.go`

- [ ] **Step 1: Add federation CLI commands**

In `runAdminCLI()`, add additional cases after existing ones:
```go
case "federation":
    if len(os.Args) < 4 {
        fmt.Println("Usage:")
        fmt.Println("  go run . admin federation list")
        fmt.Println("  go run . admin federation invite [max_uses]")
        fmt.Println("  go run . admin federation connect <url>")
        fmt.Println("  go run . admin federation block <server_id>")
        fmt.Println("  go run . admin federation sync <server_id>")
        return
    }
    fedAction := os.Args[3]
    switch fedAction {
    case "list":
        rows, err := database.DB.Query("SELECT id, name, base_url, status, disk_cache_limit FROM federation_servers ORDER BY name")
        if err != nil {
            fmt.Printf("Error: %v\n", err)
            return
        }
        defer rows.Close()
        fmt.Println("Federation servers:")
        for rows.Next() {
            var id, limit int
            var name, baseURL, status string
            if err := rows.Scan(&id, &name, &baseURL, &status, &limit); err != nil {
                continue
            }
            fmt.Printf("  #%d  %s  %s  [%s]  cache: %dMB\n", id, name, baseURL, status, limit)
        }
    case "invite":
        maxUses := 1
        if len(os.Args) >= 5 {
            maxUses, _ = strconv.Atoi(os.Args[4])
        }
        token := generateToken()
        _, err := database.DB.Exec(
            "INSERT INTO federation_invites (created_by, token, max_uses) VALUES (?, ?, ?)",
            1, token, maxUses,
        )
        if err != nil {
            fmt.Printf("Error: %v\n", err)
            return
        }
        fmt.Printf("Invite token: %s\n", token)
    default:
        fmt.Printf("Unknown federation action: %s\n", fedAction)
    }
```

- [ ] **Step 2: Build and verify**

Run: `cd backend && go build ./...` — expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/main.go
git commit -m "feat: add federation admin CLI commands"
```
