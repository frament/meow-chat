# MeowChat Federation ("Hive") Design

## Overview

Federation allows multiple independent MeowChat servers to connect into a mesh network ("hive"). Users across servers can become friends, exchange messages, share posts, and participate in group chats as if they were on the same server — with full offline support via local caching.

## Architecture

### Communication Model: Hybrid REST + Queue + Gossip

Servers communicate via REST API with an offline queue for unreliable connections. A gossip protocol propagates topology information across the network. Health pings detect server availability.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Server A   │─────│  Server B   │─────│  Server C   │
│  (direct)   │     │  (direct)   │     │  (direct)   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                       │
       └─────────────── via B ─────────────────┘
                      (routed)
```

- **Direct connections**: Servers that have exchanged invites
- **Routed connections**: Servers known via gossip, reachable through intermediate hops
- **Offline queue**: Failed requests are retried with exponential backoff

## Data Model

### New tables

#### `federation_servers`
```sql
CREATE TABLE IF NOT EXISTS federation_servers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    base_url        TEXT NOT NULL UNIQUE,
    server_token    TEXT NOT NULL,
    status          TEXT DEFAULT 'active',     -- active | blocked | unreachable
    disk_cache_limit INTEGER DEFAULT 512,      -- MB
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `federation_users`
Maps remote users to local references.
```sql
CREATE TABLE IF NOT EXISTS federation_users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id    INTEGER NOT NULL REFERENCES federation_servers(id),
    remote_id    INTEGER NOT NULL,
    username     TEXT NOT NULL,
    avatar_url   TEXT DEFAULT '',
    email        TEXT DEFAULT '',
    is_admin     INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, remote_id)
);
```

#### `federation_cache_entries`
Tracks cached data for LRU eviction.
```sql
CREATE TABLE IF NOT EXISTS federation_cache_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id   INTEGER NOT NULL REFERENCES federation_servers(id),
    cache_key   TEXT NOT NULL,
    data_type   TEXT NOT NULL,      -- message | post | file | avatar
    size_bytes  INTEGER NOT NULL,
    accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, cache_key)
);
```

#### `federation_queue`
Offline message queue for retries.
```sql
CREATE TABLE IF NOT EXISTS federation_queue (
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
);
```

#### `federation_network`
Gossip-discovered servers (read-only topology).
```sql
CREATE TABLE IF NOT EXISTS federation_network (
    server_id          INTEGER PRIMARY KEY,
    name               TEXT NOT NULL,
    base_url           TEXT NOT NULL,
    known_by_server_id INTEGER NOT NULL,
    first_seen         DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `federation_invites`
One-time or reusable invites for server-to-server connection.
```sql
CREATE TABLE IF NOT EXISTS federation_invites (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_by   INTEGER NOT NULL REFERENCES users(id),
    token        TEXT UNIQUE NOT NULL,
    max_uses     INTEGER DEFAULT 1,    -- 0 = unlimited
    use_count    INTEGER DEFAULT 0,
    expires_at   DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Extended existing tables

```sql
ALTER TABLE friends ADD COLUMN server_id INTEGER DEFAULT NULL REFERENCES federation_servers(id);
ALTER TABLE messages ADD COLUMN server_id INTEGER DEFAULT NULL REFERENCES federation_servers(id);
ALTER TABLE posts ADD COLUMN server_id INTEGER DEFAULT NULL REFERENCES federation_servers(id);
```

- `server_id = NULL` = local user/data
- `server_id = <id>` = federated user/data

## Transport Layer (`backend/federation/`)

### `transport.go`
- HTTP client with configurable timeout (30s)
- Authentication via `X-Federation-Token` header
- Automatic retry with exponential backoff: 1s → 5s → 15s (3 attempts)
- Falls back to queue on failure

### `queue.go`
- Background worker (every 30s) processes pending queue items
- `drainFailedQueue(serverID)` resets failed items to 0 attempts on server recovery
- Max 3 attempts, then marked as `failed`

### `health.go`
- `time.Ticker` pings every 60 minutes: `HEAD /api/federation/v1/ping`
- On status change `unreachable → active`: calls `drainFailedQueue()`
- Manual ping button in admin panel does the same

### `handler.go`
Incoming federation endpoints (registered BEFORE `AuthRequired`):
```
POST /api/federation/v1/ping
POST /api/federation/v1/send-message
POST /api/federation/v1/forward-post
POST /api/federation/v1/forward-key
GET  /api/federation/v1/get-key/:remoteId
GET  /api/federation/v1/get-user/:remoteId
POST /api/federation/v1/share-users
POST /api/federation/v1/route          — for multi-hop routing
POST /api/federation/v1/introduce      — gossip: tell us about yourself
POST /api/federation/v1/gossip/new-peer  — gossip: propagate new peer
POST /api/federation/v1/recover-server   — disaster recovery
GET  /api/federation/v1/bulk/users
GET  /api/federation/v1/bulk/messages
GET  /api/federation/v1/bulk/posts
```

### `route.go`
BFS shortest-path routing across `federation_network`:
- Checks direct `federation_servers` first
- Falls back to BFS on `federation_network`
- `X-Route-Trace` header prevents cycles

### `mediator.go`
Bridge for existing handlers. Helpers:
```go
func resolveUser(federationUsers, remoteUserID) -> (local bool, serverID int64)
func sendToFederatedUser(msg) -> save local + queue to remote
func forwardRoute(targetServerID, action, payload) -> route through mesh
```

## Cache Layer (`backend/cache/`)

### `lru_cache.go`
- Disk-based LRU cache per server
- On write: check total cache size for `server_id`. If exceeds `disk_cache_limit`, evict least-recently-used entries until under limit
- Cache scope: message text, post text, files (images), avatars, public keys

### Cache proxy for files
```
GET /api/federation/v1/proxy-file?path=/uploads/posts/123.jpg&server_id=2
  → fetch from remote, save to local cache/ directory, return file
  → on subsequent requests: serve from cache, update accessed_at
```

## Federation Invite Flow

1. Admin A clicks "Создать приглашение" in admin panel
2. Server creates `federation_invite` with configurable `max_uses` (default 1) and optional expiry
3. Link returned: `https://server-a.example.com/admin/federation/join?token=abc123`
4. QR code generated for the link
5. Admin A sends link/QR to Admin B
6. Admin B enters link → server B calls `POST /api/federation/v1/join` on server A
7. Server A validates token, creates `federation_servers` entry for B, generates `server_token`
8. Server B saves A's entry
9. Gossip propagates: B tells all its peers about A via `POST /api/federation/v1/gossip/new-peer`
10. B's peers add A to `federation_network`

## Disaster Recovery (Reinstall)

1. Admin A enters any known peer URL: `https://server-b.example.com`
2. Server A calls `POST /api/federation/v1/recover-server` on server B
3. Server B validates (admin B may need to approve), returns:
   ```json
   {
     "server_id": 1,
     "new_token": "...",
     "known_peers": [ { "id": 3, "name": "Peer C", "base_url": "..." }, ... ]
   }
   ```
4. Server A saves B + all peers in `federation_network`, bulk-syncs from each peer:
   - Users → `federation_users`
   - Messages → `messages` with `server_id`
   - Posts → `posts` with `server_id`
5. Files cached lazily on first access via proxy

## Gossip Protocol

### Introduction (new server joining)
```
POST /api/federation/v1/introduce
Body: { "server_id": 1, "name": "A", "base_url": "...", "known_servers": [] }
```

### Propagation
When a server learns about a new peer, it broadcasts to all its direct neighbors:
```
POST /api/federation/v1/gossip/new-peer
Body: { "server": { "id": 1, "name": "A", "base_url": "...", "via_server_id": 2 } }
```

Receivers add to `federation_network` with `known_by_server_id = sender` and propagate further. Payload includes `hops` counter (max 5) — when `hops >= 5`, propagation stops.

## Friendship Across Federation

### Existing direct invite flow (forwarded)
1. Alice on Server A creates friend invite
2. Server A sees Charlie is on Server C → routes invite through mesh
3. Server C delivers to Charlie
4. Charlie accepts → friendship saved on both A and C with `server_id` pointing to each other's server

### New search flow
1. Alice searches for "@charlie" in chat
2. Server A queries all known peers via gossip-forwarded user index (or on-demand search routed through mesh)
3. Results include Charlie (Server C)
4. Alice sends friend request → routed through mesh
5. Charlie accepts → bidirectional friendship established

## E2EE Across Federation

1. When servers connect, they exchange public keys of their users via `POST /api/federation/v1/forward-key`
2. Alice encrypts message with Bob's public key → sends encrypted blob
3. Blob is stored locally + forwarded to Bob's server via queue
4. Bob decrypts locally with his private key

## Admin Panel — Federation Tab

### Stats bar
- Total servers connected
- Total remote users
- Cache usage / limit (with percentage)
- Failed queue items count

### Servers table
Columns: # | Name | Address | Status (🟢/🔴/🟡) | Cache | Ping latency
Actions per server (modal):
- Edit name / cache limit slider (128MB – 10GB)
- Ping now
- Block / unblock / disconnect
- Clear cache
- Re-sync / reconnect

### Connect new server
- Input field for invite URL
- "Generate invite" button (returns link + QR)

### Disaster recovery
- Input field for any peer URL
- "Restore" button → auto sync all

## Implementation Order

1. Database schema (new tables + migrations)
2. `backend/federation/` — transport, handlers, routing, health, queue
3. `backend/cache/` — LRU cache with disk limit
4. Extend existing handlers (`SendMessage`, `GetFeed`, `GetUsers`, friends) to check `server_id`
5. Admin API endpoints + frontend `admin-federation` component
6. Gossip protocol implementation
7. Bulk-sync for disaster recovery
8. E2EE key forwarding across federation

## Admin CLI (extension of existing)

```sh
go run . admin federation list                    # show connected servers
go run . admin federation invite [max_uses]        # create federation invite
go run . admin federation connect <url>            # connect to a server
go run . admin federation block <server_id>        # block a server
go run . admin federation sync <server_id>         # force re-sync
```
