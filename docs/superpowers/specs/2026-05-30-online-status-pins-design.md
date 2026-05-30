# Online Status & Pinned Users

## Overview

Show all users in the chat user list, with online/offline indicators and the ability to pin users to the top.

## 1. Online Tracking (Backend)

### Graceful disconnect

- `Handler` gains two new maps:
  - `onlineUsers map[int64]bool` — tracks which users are currently considered online
  - `graceTimers map[int64]*time.Timer` — pending grace period timers per userId
- **On WS connect** (`register`):
  1. Add conn→userId to `clients` map (existing)
  2. If a grace timer exists for this userId → stop and clear it (reconnect within grace period)
  3. If userId was NOT already in `onlineUsers` → set `onlineUsers[userId]=true`, broadcast to all connected clients: `{"type":"user_online","user_id":N}`
- **On WS disconnect** (`unregister`):
  1. Remove conn from `clients` (existing)
  2. If userId has NO remaining connections → start a 30-second grace timer
  3. On timer expiry: delete from `onlineUsers`, broadcast `{"type":"user_offline","user_id":N}` to all connected clients
- **Reconnect within grace period**: stop the timer (already handled above on register)
- **Thread safety**: all operations happen in `runHub` select loop (single goroutine), no locks needed

### Broadcasting

- `broadcast` channel currently sends messages to a specific recipient
- A new `broadcastAll` channel (`chan fiber.Map`) sends events to every connected client
- `runHub` handles it alongside existing select cases:
  ```go
  case msg := <-h.broadcastAll:
      for conn := range h.clients {
          conn.WriteJSON(msg)  // best-effort, log errors
      }
  ```
- Online/offline events use `broadcastAll`

### GET /api/users returns is_online

```go
func (h *Handler) GetUsers(c *fiber.Ctx) error {
    // existing SQL query
    // for each user, set IsOnline = h.onlineUsers[u.ID]
    // return JSON
}
```

### User model add IsOnline

```go
type User struct {
    // ... existing fields
    IsOnline bool `json:"is_online"`
}
```

## 2. Pins (Backend)

### Database

New table:
```sql
CREATE TABLE IF NOT EXISTS pinned_users (
    user_id INTEGER NOT NULL,
    pinned_user_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, pinned_user_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (pinned_user_id) REFERENCES users(id)
);
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/pinned` | Returns `[pinned_user_id, ...]` for current user |
| `POST` | `/api/pin/:id` | Pin user `:id` for current user |
| `DELETE` | `/api/pin/:id` | Unpin user `:id` for current user |

- All protected by `AuthRequired` middleware (registered after `/ws`)
- `userId` extracted via `c.Locals("userId").(int64)`

## 3. Frontend

### ApiService changes

- Extend `User` interface: `is_online: boolean`
- New methods: `getPinned()`, `pinUser(id)`, `unpinUser(id)`
- WebSocket: handle incoming events `user_online`, `user_offline` — emit updates (e.g., via `Subject`)

### Chat component

#### Data flow

1. On init: load `cachedUsers` + `cachedPins` from localStorage → render immediately
2. Fetch `GET /api/users` + `GET /api/pinned` in parallel
3. Merge server data: update usernames, avatar_urls, is_online
4. Cache merged data to localStorage
5. Subscribe to WS online/offline events → update `is_online` in place (both in-memory and cache)

#### Layout

Two sections in user list (both desktop and mobile):

```
📌 Закреплённые
  [user] ● 📌  (открепить)
  [user]   📌  (открепить)

  Все пользователи
  [user] ● 📌  (закрепить)
  [user]   📌  (закрепить)
```

- If no pinned users → "Закреплённые" section is hidden
- Each user row has a pin toggle icon (📌)
- Online indicator: green dot (●)

#### Pin toggle

- Click pin icon → optimistic update (add/remove from pinned list, re-render)
- Save updated pinned list to localStorage
- Send `POST/DELETE /api/pin/:id` to server
- On failure: revert the optimistic update

### localStorage keys

- `cachedUsers` — `User[]` (full list with is_online, cached after each API fetch)
- `cachedPins` — `number[]` (pinned_user_id list, updated on each pin/unpin)

## Files Changed

| File | Change |
|------|--------|
| `backend/models/models.go` | Add `IsOnline` field to `User` |
| `backend/handlers/handlers.go` | Add `onlineUsers`, `graceTimers`, `broadcastAll` to `Handler`; update `runHub`, `HandleWebSocket`, `GetUsers`; add pin handlers |
| `backend/handlers/auth.go` | (no change needed) |
| `backend/database/database.go` | Add `pinned_users` table to auto-migration |
| `backend/main.go` | Register pin routes |
| `frontend/src/app/services/api.service.ts` | Extend `User`, add `getPinned/pinUser/unpinUser`, add WS online event Subject |
| `frontend/src/app/components/chat/chat.ts` | Rewrite user list sections, add pin/online indicators, localStorage caching, WS subscription |
