# System Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show browser system notifications when the app is minimized, tab is backgrounded, or user is on a different page.

**Architecture:** Backend adds `from_name` to WebSocket messages. Frontend moves WS to a singleton in ApiService. New NotificationService manages `Notification` API permission + visibility tracking. App component makes notification decisions.

**Tech Stack:** Go 1.22, Angular 20, WebSocket, Notification API

---

### Task 1: Backend — add `from_name` to WS message

**Files:**
- Modify: `backend/handlers/handlers.go` — wsMessage struct, broadcast payload, SendMessage, HandleWebSocket

- [ ] **Add `fromName` to `wsMessage` struct**

Find:
```go
type wsMessage struct {
	from    int64
	to      int64
	content string
	images  []string
}
```

Replace with:
```go
type wsMessage struct {
	from     int64
	to       int64
	content  string
	images   []string
	fromName string
}
```

- [ ] **Include `from_name` in hub broadcast payload**

In `runHub()`, find the broadcast case (around line 112-130):
```go
case msg := <-h.broadcast:
    for conn, uid := range h.clients {
        if uid == msg.to {
            payload := fiber.Map{
                "type":    "message",
                "from":    msg.from,
                "content": msg.content,
            }
```

Replace this whole `payload` block with:
```go
payload := fiber.Map{
    "type":      "message",
    "from":      msg.from,
    "from_name": msg.fromName,
    "content":   msg.content,
}
```

- [ ] **Set `fromName` in `SendMessage()`**

Find (lines 481-486):
```go
h.broadcast <- wsMessage{
    from:    fromUserID,
    to:      toUserID,
    content: content,
    images:  images,
}
```

Replace with:
```go
var senderName string
database.DB.QueryRow("SELECT username FROM users WHERE id = ?", fromUserID).Scan(&senderName)

h.broadcast <- wsMessage{
    from:     fromUserID,
    to:       toUserID,
    content:  content,
    images:   images,
    fromName: senderName,
}
```

Then remove the duplicate username query that follows (the push notification block on lines 488-503 already has its own query — keep that one, remove the one we just moved before the broadcast, since we now query before broadcast).

Wait, looking at the original code, lines 488-503 has:
```go
if !h.onlineUsers[toUserID] {
    var senderName string
    database.DB.QueryRow("SELECT username FROM users WHERE id = ?", fromUserID).Scan(&senderName)
    ...
}
```

This is a separate lookup for push notifications. It's fine to keep it — the broadcast happens for ALL messages, but push only when offline. We can't reuse the `senderName` variable from the broadcast code because the broadcast always needs it.

Actually, we already declared `senderName` above for the broadcast. The push block has its own `var senderName string` — that's a new scope (inside `if` block), so there's no conflict. No change needed there.

- [ ] **Set `fromName` in `HandleWebSocket()`**

Find (line 674):
```go
h.broadcast <- wsMessage{from: uid, to: int64(to), content: content}
```

Replace with:
```go
var senderName string
database.DB.QueryRow("SELECT username FROM users WHERE id = ?", uid).Scan(&senderName)

h.broadcast <- wsMessage{
    from:     uid,
    to:       int64(to),
    content:  content,
    fromName: senderName,
}
```

---

### Task 2: Frontend — create NotificationService

**Files:**
- Create: `frontend/src/app/services/notification.service.ts`

- [ ] **Create the NotificationService**

Create `frontend/src/app/services/notification.service.ts` with:

```typescript
import { Injectable, signal } from '@angular/core';
import { fromEvent } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private permission = signal<NotificationPermission | null>(null);
  private tabHidden = signal(false);

  constructor() {
    if (typeof document !== 'undefined') {
      fromEvent(document, 'visibilitychange').subscribe(() => {
        this.tabHidden.set(document.hidden);
      });
    }
    if (typeof window !== 'undefined') {
      fromEvent(window, 'blur').subscribe(() => this.tabHidden.set(true));
      fromEvent(window, 'focus').subscribe(() => this.tabHidden.set(false));
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') {
      this.permission.set('granted');
      return true;
    }
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    this.permission.set(result);
    return result === 'granted';
  }

  get isTabHidden(): boolean {
    return this.tabHidden();
  }

  show(title: string, options?: NotificationOptions): Notification | null {
    if (this.permission() !== 'granted') return null;
    try {
      const n = new Notification(title, options);
      return n;
    } catch {
      return null;
    }
  }
}
```

---

### Task 3: Frontend — refactor ApiService with global WS

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`

- [ ] **Add imports, new types, and fields**

Add to imports:
```typescript
import { Injectable, signal } from '@angular/core';
// existing imports...
```

After the `Message` interface, add:
```typescript
export interface WsMessage {
  type: 'message';
  from: number;
  from_name: string;
  content: string;
  images?: string[];
}
```

Add fields to the `ApiService` class:
```typescript
private ws: WebSocket | null = null;
readonly wsMessages$ = new Subject<WsMessage>();
```

- [ ] **Add `connectWebSocket()` and `disconnectWebSocket()` methods**

Replace the existing `connectWebSocket()` method (line 193-197) with:

```typescript
connectWebSocket(): void {
  if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
  if (this.ws) this.ws.close();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = this.accessToken();
  if (!token) return;

  this.ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?token=${token}`);

  this.ws.onmessage = (event) => {
    let data: any;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === 'message') {
      this.wsMessages$.next(data as WsMessage);
    }

    if (data.type === 'user_online' || data.type === 'user_offline') {
      this.wsOnlineEvent.next(data);
    }
  };

  this.ws.onclose = () => {
    this.ws = null;
  };

  this.ws.onerror = () => {
    this.ws?.close();
  };
}

disconnectWebSocket(): void {
  this.ws?.close();
  this.ws = null;
}
```

- [ ] **Add lifecycle management**

In the constructor, after setting `accessToken`, add:
```typescript
if (token) {
  this.connectWebSocket();
}
```

In `storeAuth()`, at the end add:
```typescript
this.connectWebSocket();
```

In `logout()`, before clearing tokens, add:
```typescript
this.disconnectWebSocket();
```

---

### Task 4: Frontend — add notification logic to App component

**Files:**
- Modify: `frontend/src/app/app.ts`

- [ ] **Add imports and DI**

Add imports:
```typescript
import { Router } from '@angular/router';
import { NotificationService } from './services/notification.service';
```

Add DI fields:
```typescript
readonly #router = inject(Router);
readonly #notif = inject(NotificationService);
```

- [ ] **Add WS subscription + notification logic**

In `ngOnInit()`, before the existing push subscription block, add:

```typescript
// Request notification permission
this.#notif.requestPermission();

// Show system notifications for incoming WS messages
this.#sub.add(
  this.#api.wsMessages$.subscribe((msg) => {
    const isHidden = document.hidden;
    const isCorrectChat = this.#router.url.startsWith(`/chat/${msg.from}`);
    if (isHidden || !isCorrectChat) {
      const n = this.#notif.show(
        `New message from ${msg.from_name || 'Someone'}`,
        {
          body: msg.content || (msg.images?.length ? '[Image]' : ''),
          icon: '/favicon.ico',
          tag: `chat-${msg.from}`,
          data: { url: `/chat/${msg.from}`, senderId: msg.from },
        }
      );
      if (n) {
        n.onclick = () => {
          window.focus();
          this.#router.navigate(['/chat', msg.from]);
          n.close();
        };
      }
    }
  })
);
```

---

### Task 5: Frontend — refactor Chat component to use global WS

**Files:**
- Modify: `frontend/src/app/components/chat/chat.ts`

- [ ] **Remove local WS field and connectWebSocket**

Remove these:
- `private ws: WebSocket | null = null;`
- Call to `this.connectWebSocket()` in `ngOnInit()`
- The entire `connectWebSocket()` method (lines 345-371)
- `this.ws?.close();` from `ngOnDestroy()`

- [ ] **Add wsMessages subscription**

In `ngOnInit()`, after the existing `this.listenWsOnlineEvents()`, add subscription to `wsMessages$`:

```typescript
this.wsSubscription = this.api.wsMessages$.subscribe((data) => {
  if (data.type === 'message' && this.selectedUser && data.from === this.selectedUser.id) {
    const msg: Message = {
      id: Date.now(),
      from_user_id: data.from,
      to_user_id: this.currentUserId,
      content: data.content,
      created_at: new Date().toISOString(),
      from_user: data.from_name || this.selectedUser.username,
      images: data.images ? data.images.map((url: string) => ({ id: 0, image_url: url })) : undefined,
    };
    this.messages.push(msg);
    localStorage.setItem(this.messageCacheKey(this.selectedUser.id), JSON.stringify(this.messages));
  }
});
```

Change the `wsSubscription` type from `Subscription | null` to allow subscribing to both:
```typescript
private wsSubscription: Subscription | null = null;
private onlineSubscription: Subscription | null = null;
// or just reuse wsSubscription since listenWsOnlineEvents already assigns to it
```

Actually, looking at the existing code, `listenWsOnlineEvents()` assigns to `this.wsSubscription`:
```typescript
private listenWsOnlineEvents() {
    this.wsSubscription = this.api.wsOnlineEvent.subscribe((event) => { ... });
}
```

So we need to handle both subscriptions. Change to:
```typescript
private subscriptions: Subscription[] = [];
```

In `ngOnInit()`:
```typescript
this.subscriptions.push(
  this.api.wsOnlineEvent.subscribe((event) => { ... })
);
this.subscriptions.push(
  this.api.wsMessages$.subscribe((data) => { ... })
);
```

In `ngOnDestroy()`:
```typescript
for (const sub of this.subscriptions) sub.unsubscribe();
```

Remove the old:
- `private wsSubscription: Subscription | null = null;`
- `this.wsSubscription?.unsubscribe();` from ngOnDestroy

---

### Task 6: Verify the build

- [ ] **Build frontend to verify no TS errors**

```bash
cd frontend && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Verify backend compiles**

```bash
cd backend && go build -o my-chat-backend.exe .
```

Expected: Compiles with no errors.
