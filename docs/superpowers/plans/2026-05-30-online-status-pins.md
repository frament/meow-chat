# Online Status & Pinned Users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show all users in chat user list with online/offline indicators, 30s grace period on disconnect, and pin/unpin users to top.

**Architecture:** Backend tracks online users via WebSocket hub with a 30s grace timer. New `pinned_users` DB table stores pins. `GET /api/users` returns `is_online` from hub state. WS broadcasts `user_online`/`user_offline` events. Frontend caches users+pins in localStorage, sorts pinned→others, renders online dot + pin toggle per row.

**Tech Stack:** Go + Fiber + SQLite, Angular 20 + Tailwind v4

---

### Task 1: Backend — Add IsOnline to models.User

**Files:**
- Modify: `backend/models/models.go:5-12`

- [ ] **Add IsOnline field**

```go
type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Password  string    `json:"-"`
	AvatarURL string    `json:"avatar_url"`
	CreatedAt time.Time `json:"created_at"`
	IsOnline  bool      `json:"is_online"`
}
```

- [ ] **Commit**

```bash
git add backend/models/models.go
git commit -m "feat: add IsOnline field to User model"
```

---

### Task 2: Backend — Add pinned_users table migration

**Files:**
- Modify: `backend/database/database.go:78`

- [ ] **Add pinned_users CREATE TABLE to migration slice**

Insert after the `refresh_tokens` entry (between line 77 and the `avatar_url` check):

```go
		`CREATE TABLE IF NOT EXISTS pinned_users (
			user_id INTEGER NOT NULL,
			pinned_user_id INTEGER NOT NULL,
			PRIMARY KEY (user_id, pinned_user_id),
			FOREIGN KEY (user_id) REFERENCES users(id),
			FOREIGN KEY (pinned_user_id) REFERENCES users(id)
		)`,
```

- [ ] **Commit**

```bash
git add backend/database/database.go
git commit -m "feat: add pinned_users table migration"
```

---

### Task 3: Backend — Online tracking in WebSocket hub

**Files:**
- Modify: `backend/handlers/handlers.go:22-78` (struct, NewHandler, runHub)
- Modify: `backend/handlers/handlers.go:406-451` (HandleWebSocket — no actual change needed)

- [ ] **Update Handler struct and NewHandler**

Replace existing struct and NewHandler:

```go
type Handler struct {
	clients      map[*websocket.Conn]int64
	register     chan *wsClient
	unregister   chan *wsClient
	broadcast    chan wsMessage
	broadcastAll chan fiber.Map
	graceExpired chan int64
	onlineUsers  map[int64]bool
	graceTimers  map[int64]*time.Timer
}

func NewHandler() *Handler {
	h := &Handler{
		clients:      make(map[*websocket.Conn]int64),
		register:     make(chan *wsClient),
		unregister:   make(chan *wsClient),
		broadcast:    make(chan wsMessage),
		broadcastAll: make(chan fiber.Map),
		graceExpired: make(chan int64),
		onlineUsers:  make(map[int64]bool),
		graceTimers:  make(map[int64]*time.Timer),
	}
	go h.runHub()
	return h
}
```

- [ ] **Rewrite runHub with online tracking + grace period**

```go
func (h *Handler) runHub() {
	for {
		select {
		case client := <-h.register:
			h.clients[client.conn] = client.uid
			// Cancel any existing grace timer (reconnect within grace period)
			if t, ok := h.graceTimers[client.uid]; ok {
				t.Stop()
				delete(h.graceTimers, client.uid)
			}
			if !h.onlineUsers[client.uid] {
				h.onlineUsers[client.uid] = true
				for conn := range h.clients {
					conn.WriteJSON(fiber.Map{"type": "user_online", "user_id": client.uid})
				}
			}

		case client := <-h.unregister:
			if _, ok := h.clients[client.conn]; ok {
				delete(h.clients, client.conn)
				client.conn.Close()
			}
			hasOthers := false
			for _, uid := range h.clients {
				if uid == client.uid {
					hasOthers = true
					break
				}
			}
			if !hasOthers && h.onlineUsers[client.uid] {
				h.graceTimers[client.uid] = time.AfterFunc(30*time.Second, func() {
					h.graceExpired <- client.uid
				})
			}

		case uid := <-h.graceExpired:
			delete(h.graceTimers, uid)
			// Skip if user reconnected while timer was pending
			for _, cu := range h.clients {
				if cu == uid {
					goto skipOffline
				}
			}
			if h.onlineUsers[uid] {
				h.onlineUsers[uid] = false
				for conn := range h.clients {
					conn.WriteJSON(fiber.Map{"type": "user_offline", "user_id": uid})
				}
			}
		skipOffline:

		case msg := <-h.broadcast:
			for conn, uid := range h.clients {
				if uid == msg.to {
					err := conn.WriteJSON(fiber.Map{
						"type":    "message",
						"from":    msg.from,
						"content": msg.content,
					})
					if err != nil {
						log.Println("WebSocket write error:", err)
						conn.Close()
						delete(h.clients, conn)
					}
				}
			}

		case msg := <-h.broadcastAll:
			for conn := range h.clients {
				if err := conn.WriteJSON(msg); err != nil {
					log.Println("WebSocket broadcastAll write error:", err)
					conn.Close()
					delete(h.clients, conn)
				}
			}
		}
	}
}
```

Note: `HandleWebSocket` at lines 406-451 stays exactly as-is. The existing `register`/`unregister` channel sends automatically trigger the new logic.

- [ ] **Commit**

```bash
git add backend/handlers/handlers.go
git commit -m "feat: online tracking with 30s grace period in WS hub"
```

---

### Task 4: Backend — Update GetUsers to return is_online

**Files:**
- Modify: `backend/handlers/handlers.go:150-166`

- [ ] **Add IsOnline field population in GetUsers**

```go
func (h *Handler) GetUsers(c *fiber.Ctx) error {
	rows, err := database.DB.Query("SELECT id, username, email, avatar_url, created_at FROM users ORDER BY username")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.AvatarURL, &u.CreatedAt); err != nil {
			continue
		}
		u.IsOnline = h.onlineUsers[u.ID]
		users = append(users, u)
	}
	return c.JSON(users)
}
```

- [ ] **Commit**

```bash
git add backend/handlers/handlers.go
git commit -m "feat: GetUsers returns is_online from hub state"
```

---

### Task 5: Backend — Pin handlers

**Files:**
- Modify: `backend/handlers/handlers.go` (append after UpdateProfile, before HandleWebSocket)

- [ ] **Add GetPinned handler** (between line 404 and 406)

```go
func (h *Handler) GetPinned(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	rows, err := database.DB.Query("SELECT pinned_user_id FROM pinned_users WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch pinned users"})
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			continue
		}
		ids = append(ids, id)
	}
	return c.JSON(fiber.Map{"pinned_user_ids": ids})
}
```

- [ ] **Add PinUser handler**

```go
func (h *Handler) PinUser(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	pinnedID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}
	if userID == pinnedID {
		return c.Status(400).JSON(fiber.Map{"error": "Cannot pin yourself"})
	}

	_, err = database.DB.Exec(
		"INSERT OR IGNORE INTO pinned_users (user_id, pinned_user_id) VALUES (?, ?)",
		userID, pinnedID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to pin user"})
	}
	return c.JSON(fiber.Map{"message": "User pinned"})
}
```

- [ ] **Add UnpinUser handler**

```go
func (h *Handler) UnpinUser(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)
	pinnedID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	_, err = database.DB.Exec(
		"DELETE FROM pinned_users WHERE user_id = ? AND pinned_user_id = ?",
		userID, pinnedID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to unpin user"})
	}
	return c.JSON(fiber.Map{"message": "User unpinned"})
}
```

- [ ] **Commit**

```bash
git add backend/handlers/handlers.go
git commit -m "feat: pin/unpin/get-pinned handlers"
```

---

### Task 6: Backend — Register pin routes in main.go

**Files:**
- Modify: `backend/main.go:54-66`

- [ ] **Add pin routes after AuthRequired middleware**

```go
	api.Get("/pinned", h.GetPinned)
	api.Post("/pin/:id", h.PinUser)
	api.Delete("/pin/:id", h.UnpinUser)
```

Insert after `api.Use(handlers.AuthRequired)` (line 54), before `api.Post("/logout"`:

```go
	api.Use(handlers.AuthRequired)

	api.Get("/pinned", h.GetPinned)
	api.Post("/pin/:id", h.PinUser)
	api.Delete("/pin/:id", h.UnpinUser)

	api.Post("/logout", h.Logout)
```

- [ ] **Commit**

```bash
git add backend/main.go
git commit -m "feat: register pin/unpin routes"
```

---

### Task 7: Frontend — Extend ApiService with is_online, pin methods, WS events

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`

- [ ] **Add is_online to User interface**

```typescript
export interface User {
  id: number;
  username: string;
  email: string;
  avatar_url: string;
  created_at: string;
  is_online: boolean;
}
```

- [ ] **Add pin methods**

```typescript
getPinned() {
  return this.http.get<{ pinned_user_ids: number[] }>(`${this.baseUrl}/pinned`);
}

pinUser(id: number) {
  return this.http.post<{ message: string }>(`${this.baseUrl}/pin/${id}`, {});
}

unpinUser(id: number) {
  return this.http.delete<{ message: string }>(`${this.baseUrl}/pin/${id}`);
}
```

- [ ] **Add WS online event Subject**

```typescript
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
```

```typescript
readonly wsOnlineEvent = new Subject<{ type: 'user_online' | 'user_offline'; user_id: number }>();
```

- [ ] **Commit**

```bash
git add frontend/src/app/services/api.service.ts
git commit -m "feat: add is_online, pin methods, WS event subject to ApiService"
```

---

### Task 8: Frontend — Rewrite ChatComponent user list with online indicators + pins

**Files:**
- Modify: `frontend/src/app/components/chat/chat.ts`

- [ ] **Add import for Subscription**

```typescript
import { Component, OnInit, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, User, Message } from '../../services/api.service';
import { Subscription } from 'rxjs';
```

- [ ] **Replace user list data flow in ngOnInit**

Old code (lines 157-183):
```typescript
  ngOnInit() {
    this.currentUserId = this.api.currentUser()?.id ?? 0;

    this.route.paramMap.subscribe((params) => {
      const userId = params.get('userId');
      this.showMobileChat = !!userId;
      if (userId && this.users.length > 0) {
        const user = this.users.find((u) => u.id === Number(userId));
        if (user) {
          this.selectUser(user);
        }
      }
    });

    this.api.getUsers().subscribe((users: User[]) => {
      this.users = users.filter((u) => u.id !== this.currentUserId);
      const userId = this.route.snapshot.paramMap.get('userId');
      if (userId) {
        const user = this.users.find((u) => u.id === Number(userId));
        if (user) {
          this.selectUser(user);
        }
      }
    });

    this.connectWebSocket();
  }
```

New code:
```typescript
  ngOnInit() {
    this.currentUserId = this.api.currentUser()?.id ?? 0;

    this.route.paramMap.subscribe((params) => {
      const userId = params.get('userId');
      this.showMobileChat = !!userId;
      if (userId && this.users.length > 0) {
        const user = this.users.find((u) => u.id === Number(userId));
        if (user) {
          this.selectUser(user);
        }
      }
    });

    // Load cached data immediately, then fetch fresh from server
    this.loadFromCache();
    this.loadFromServer();
    this.listenWsOnlineEvents();
    this.connectWebSocket();
  }

  private loadFromCache() {
    const cached = localStorage.getItem('cachedUsers');
    const cachedPins = localStorage.getItem('cachedPins');
    if (cached) {
      const users: User[] = JSON.parse(cached);
      this.users = users.filter((u) => u.id !== this.currentUserId);
    }
    if (cachedPins) {
      this.pinnedIds = new Set<number>(JSON.parse(cachedPins));
    }
  }

  private loadFromServer() {
    this.api.getUsers().subscribe((users: User[]) => {
      this.users = users.filter((u) => u.id !== this.currentUserId);
      localStorage.setItem('cachedUsers', JSON.stringify(users));
      this.resolvePendingChat();
    });
    this.api.getPinned().subscribe((res) => {
      this.pinnedIds = new Set(res.pinned_user_ids);
      localStorage.setItem('cachedPins', JSON.stringify(res.pinned_user_ids));
    });
  }

  private resolvePendingChat() {
    const userId = this.route.snapshot.paramMap.get('userId');
    if (userId) {
      const user = this.users.find((u) => u.id === Number(userId));
      if (user) {
        this.selectUser(user);
      }
    }
  }

  private listenWsOnlineEvents() {
    this.wsSubscription = this.api.wsOnlineEvent.subscribe((event) => {
      for (const u of this.users) {
        if (u.id === event.user_id) {
          u.is_online = event.type === 'user_online';
          break;
        }
      }
      // Force change detection by replacing the array
      this.users = [...this.users];
    });
  }
```

- [ ] **Add class fields for pinnedIds and wsSubscription**

```typescript
  users: User[] = [];
  selectedUser: User | null = null;
  messages: Message[] = [];
  messageContent = '';
  currentUserId = 0;
  showMobileChat = false;
  pinnedIds: Set<number> = new Set();
  private ws: WebSocket | null = null;
  private wsSubscription: Subscription | null = null;
```

- [ ] **Update ngOnDestroy**

```typescript
  ngOnDestroy() {
    this.ws?.close();
    this.wsSubscription?.unsubscribe();
  }
```

- [ ] **Add pin/unpin methods**

```typescript
  togglePin(userId: number, event: MouseEvent) {
    event.stopPropagation();
    if (this.pinnedIds.has(userId)) {
      this.pinnedIds.delete(userId);
      this.api.unpinUser(userId).subscribe({ error: () => this.pinnedIds.add(userId) });
    } else {
      this.pinnedIds.add(userId);
      this.api.pinUser(userId).subscribe({ error: () => this.pinnedIds.delete(userId) });
    }
    this.pinnedIds = new Set(this.pinnedIds); // trigger signal
    localStorage.setItem('cachedPins', JSON.stringify([...this.pinnedIds]));
  }

  getPinnedUsers(): User[] {
    return this.users.filter((u) => this.pinnedIds.has(u.id));
  }

  getUnpinnedUsers(): User[] {
    return this.users.filter((u) => !this.pinnedIds.has(u.id));
  }
```

- [ ] **Update connectWebSocket to handle online/offline events**

```typescript
  connectWebSocket() {
    this.ws = this.api.connectWebSocket();

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'message' && this.selectedUser) {
        if (data.from === this.selectedUser.id) {
          this.messages.push({
            id: Date.now(),
            from_user_id: data.from,
            to_user_id: this.currentUserId,
            content: data.content,
            created_at: new Date().toISOString(),
            from_user: this.selectedUser.username,
          });
        }
      }

      if (data.type === 'user_online' || data.type === 'user_offline') {
        this.api.wsOnlineEvent.next(data);
      }
    };
  }
```

- [ ] **Replace desktop user list template (lines 14-31)**

Old:
```html
      <div class="w-72 card p-3 overflow-y-auto shrink-0">
        <h3 class="section-label" style="margin-bottom:12px;">Пользователи</h3>
        @for (user of users; track user.id) {
          <div (click)="openChat(user)"
            class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
            [style.background]="selectedUser?.id === user.id ? 'var(--accent-light)' : 'transparent'"
            [class.hover-bg]="selectedUser?.id !== user.id">
            @if (user.avatar_url) {
              <img [src]="user.avatar_url" class="w-8 h-8 rounded-full object-cover">
            } @else {
              <div class="post-avatar" style="width:32px;height:32px;font-size:13px;">
                {{ user.username[0] }}
              </div>
            }
            <span class="text-sm" style="color:var(--text-primary);">{{ user.username }}</span>
          </div>
        }
      </div>
```

New:
```html
      <div class="w-72 card p-3 overflow-y-auto shrink-0">
        @if (getPinnedUsers().length > 0) {
          <h3 class="section-label" style="margin-bottom:12px;">📌 Закреплённые</h3>
          @for (user of getPinnedUsers(); track user.id) {
            <div (click)="openChat(user)"
              class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
              [style.background]="selectedUser?.id === user.id ? 'var(--accent-light)' : 'transparent'"
              [class.hover-bg]="selectedUser?.id !== user.id">
              @if (user.avatar_url) {
                <img [src]="user.avatar_url" class="w-8 h-8 rounded-full object-cover">
              } @else {
                <div class="post-avatar" style="width:32px;height:32px;font-size:13px;">
                  {{ user.username[0] }}
                </div>
              }
              <span class="flex-1 text-sm" style="color:var(--text-primary);">{{ user.username }}</span>
              @if (user.is_online) {
                <span class="w-2 h-2 rounded-full shrink-0" style="background:#34d399;"></span>
              }
              <button (click)="togglePin(user.id, $event)" class="p-1 text-xs" style="color:var(--text-tertiary);" title="Открепить">📌</button>
            </div>
          }
          <div class="divider" style="margin:8px 0;"></div>
        }

        <h3 class="section-label" style="margin-bottom:12px;">Все пользователи</h3>
        @for (user of getUnpinnedUsers(); track user.id) {
          <div (click)="openChat(user)"
            class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
            [style.background]="selectedUser?.id === user.id ? 'var(--accent-light)' : 'transparent'"
            [class.hover-bg]="selectedUser?.id !== user.id">
            @if (user.avatar_url) {
              <img [src]="user.avatar_url" class="w-8 h-8 rounded-full object-cover">
            } @else {
              <div class="post-avatar" style="width:32px;height:32px;font-size:13px;">
                {{ user.username[0] }}
              </div>
            }
            <span class="flex-1 text-sm" style="color:var(--text-primary);">{{ user.username }}</span>
            @if (user.is_online) {
              <span class="w-2 h-2 rounded-full shrink-0" style="background:#34d399;"></span>
            }
            <button (click)="togglePin(user.id, $event)" class="p-1 text-xs" style="color:var(--text-tertiary);" title="Закрепить">📌</button>
          </div>
        }
      </div>
```

- [ ] **Replace mobile user list template (lines 72-91)**

Old:
```html
      @if (!showMobileChat) {
        <div class="px-4 py-6 pb-20">
          <h3 class="section-label" style="margin-bottom:12px;">Пользователи</h3>
          @for (user of users; track user.id) {
            <div (click)="openChat(user)"
              class="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover-bg"
              style="border-bottom:1px solid var(--divider);">
              @if (user.avatar_url) {
                <img [src]="user.avatar_url" class="w-10 h-10 rounded-full object-cover shrink-0">
              } @else {
                <div class="post-avatar" style="width:40px;height:40px;font-size:16px;">
                  {{ user.username[0] }}
                </div>
              }
              <span class="text-sm font-medium" style="color:var(--text-primary);">{{ user.username }}</span>
            </div>
          }
        </div>
      }
```

New:
```html
      @if (!showMobileChat) {
        <div class="px-4 py-6 pb-20">
          @if (getPinnedUsers().length > 0) {
            <h3 class="section-label" style="margin-bottom:12px;">📌 Закреплённые</h3>
            @for (user of getPinnedUsers(); track user.id) {
              <div (click)="openChat(user)"
                class="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover-bg"
                style="border-bottom:1px solid var(--divider);">
                @if (user.avatar_url) {
                  <img [src]="user.avatar_url" class="w-10 h-10 rounded-full object-cover shrink-0">
                } @else {
                  <div class="post-avatar" style="width:40px;height:40px;font-size:16px;">
                    {{ user.username[0] }}
                  </div>
                }
                <span class="flex-1 text-sm font-medium" style="color:var(--text-primary);">{{ user.username }}</span>
                @if (user.is_online) {
                  <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:#34d399;"></span>
                }
                <button (click)="togglePin(user.id, $event)" class="p-1 text-sm" style="color:var(--text-tertiary);" title="Открепить">📌</button>
              </div>
            }
            <div class="divider" style="margin:8px 0;"></div>
          }

          <h3 class="section-label" style="margin-bottom:12px;">Все пользователи</h3>
          @for (user of getUnpinnedUsers(); track user.id) {
            <div (click)="openChat(user)"
              class="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover-bg"
              style="border-bottom:1px solid var(--divider);">
              @if (user.avatar_url) {
                <img [src]="user.avatar_url" class="w-10 h-10 rounded-full object-cover shrink-0">
              } @else {
                <div class="post-avatar" style="width:40px;height:40px;font-size:16px;">
                  {{ user.username[0] }}
                </div>
              }
              <span class="flex-1 text-sm font-medium" style="color:var(--text-primary);">{{ user.username }}</span>
              @if (user.is_online) {
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:#34d399;"></span>
              }
              <button (click)="togglePin(user.id, $event)" class="p-1 text-sm" style="color:var(--text-tertiary);" title="Закрепить">📌</button>
            </div>
          }
        </div>
      }
```

- [ ] **Verify frontend builds**

```bash
cd frontend && npm run build
```
Expected: Build succeeds.

- [ ] **Commit**

```bash
git add frontend/src/app/components/chat/chat.ts
git commit -m "feat: online indicator, pin/unpin sections in chat user list"
```

---

### Self-Review Checklist

- [ ] **Spec coverage:** All requirements covered — online tracking with grace period (Task 3), pinned_users DB table (Task 2), pin API (Task 5-6), is_online in API response (Task 4), localStorage caching + WS events for real-time updates + pin toggle + online indicator on frontend (Task 7-8).
- [ ] **Placeholder scan:** No TBDs, TODOs, or "implement later". Every task has complete code.
- [ ] **Type consistency:** `IsOnline bool` in Go → `is_online: boolean` in TS. `pinned_user_ids: number[]` in Go → `Set<number>` in TS. `togglePin(agevent)` consistent across desktop and mobile templates.
- [ ] **Build check:** Frontend build command included in Task 8.
