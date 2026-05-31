# System Notifications for Incoming Messages

## Problem

When the application is minimized, the browser tab is in the background, or the user is on a different page (feed/settings), incoming chat messages produce no visible feedback. Push notifications only work when the user is fully offline (no WebSocket connection). If the user has the app open but is not actively viewing the specific chat conversation, messages are silently dropped.

## Requirements

Show a browser system notification when:
1. The browser tab is not focused (other tab active)
2. The browser window is minimized / user is in another app
3. The user is on a different page within the app (feed, settings) while the tab is visible

Do NOT show a notification when the user is actively viewing the chat conversation with the sender.

## Architecture

### Changes Required

1. **Backend**: Add `from_name` to `wsMessage` struct and WS broadcast payload
2. **New service**: `NotificationService` — manages Notification API permission, tab visibility, show()
3. **ApiService**: Refactor WebSocket to a singleton connection managed at app level
4. **App component**: Subscribe to global WS messages, show notifications when appropriate
5. **Chat component**: Remove local WS management, subscribe to global WS stream

---

### 1. Backend: Add `from_name` to WS messages

**File**: `backend/handlers/handlers.go`

**`wsMessage` struct** — add field:
```go
type wsMessage struct {
    from     int64
    to       int64
    content  string
    images   []string
    fromName string   // NEW
}
```

**`SendMessage()` (line 481-486)** — set `fromName`:
```go
var senderName string
database.DB.QueryRow("SELECT username FROM users WHERE id = ?", fromUserID).Scan(&senderName)

h.broadcast <- wsMessage{
    from:     fromUserID,
    to:       toUserID,
    content:  content,
    images:   images,
    fromName: senderName,  // NEW
}
```
(The username query already exists on line 489-490 for push notifications — deduplicate by moving it before the broadcast.)

**`HandleWebSocket()` (line 674)** — add `fromName`:
```go
var senderName string
database.DB.QueryRow("SELECT username FROM users WHERE id = ?", uid).Scan(&senderName)

h.broadcast <- wsMessage{
    from:     uid,
    to:       int64(to),
    content:  content,
    fromName: senderName,  // NEW
}
```

**`runHub()` broadcast handler (line 112-130)** — include in payload:
```go
payload := fiber.Map{
    "type":      "message",
    "from":      msg.from,
    "from_name": msg.fromName,  // NEW
    "content":   msg.content,
}
```

---

### 2. New: `NotificationService`

**File**: `frontend/src/app/services/notification.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private permission = signal<NotificationPermission | null>(null);
  private tabHidden = signal(false);

  constructor() {
    fromEvent(document, 'visibilitychange').subscribe(() => {
      this.tabHidden.set(document.hidden);
    });
    fromEvent(window, 'blur').subscribe(() => this.tabHidden.set(true));
    fromEvent(window, 'focus').subscribe(() => this.tabHidden.set(false));
  }

  async requestPermission(): Promise<boolean> { ... }
  get isTabHidden(): boolean { return this.tabHidden(); }
  show(title: string, options?: NotificationOptions): Notification | null { ... }
}
```

- `requestPermission()`: calls `Notification.requestPermission()`, stores result in signal, returns boolean
- `show()`: checks `permission() === 'granted'`, if yes creates and returns `new Notification(title, options)`
- Visibility tracking: `document.visibilitychange` + `window.blur/focus` → `tabHidden` signal

---

### 3. Refactor: `ApiService` — global WebSocket

**File**: `frontend/src/app/services/api.service.ts`

**New fields:**
```typescript
private ws: WebSocket | null = null;
readonly wsMessages$ = new Subject<WsMessage>();
```

Where `WsMessage`:
```typescript
export interface WsMessage {
  type: 'message';
  from: number;
  from_name: string;
  content: string;
  images?: string[];
}
```

**Refactored `connectWebSocket()`:**
- If `this.ws` already exists and is OPEN, return early (singleton)
- Create new WebSocket with auth token (same URL as before)
- `onmessage`: parse JSON, emit message events to `wsMessages$`, relay `user_online`/`user_offline` to `wsOnlineEvent`
- `onclose` / `onerror`: set `this.ws = null` (auto-reconnect on next call)

**New `disconnectWebSocket()`:**
- Close existing WS, set to null

**Lifecycle:**
- Constructor: if saved token exists, call `connectWebSocket()` after setting `accessToken`
- `storeAuth()`: call `connectWebSocket()` after saving tokens
- `logout()`: call `disconnectWebSocket()` before clearing tokens

---

### 4. App component: notification logic

**File**: `frontend/src/app/app.ts`

**New dependencies:**
- Inject `NotificationService`, `Router`

**`ngOnInit()` additions:**
- After successful auth / at startup, call `notificationService.requestPermission()`
- Subscribe to `api.wsMessages$`
- On each message:
  - Extract `from`, `from_name`, `content`
  - Check `document.hidden` or `!router.url.startsWith('/chat/' + from)`
  - If both conditions are false → skip (user is actively viewing this chat)
  - Otherwise: `notificationService.show("New message from " + from_name, { body, icon, data })`
  - Attach `onclick` handler to notification: `window.focus()`, `router.navigate(['/chat', from])`, `notification.close()`

**Reconnection note:** Notification permission should be requested only once. If denied, silently no-op.

---

### 5. Refactor: Chat component

**File**: `frontend/src/app/components/chat/chat.ts`

**Remove:**
- `private ws: WebSocket | null` field
- `connectWebSocket()` method
- `this.ws.close()` from `ngOnDestroy()`
- WS `onmessage` handler that processes message events + online events

**Changes:**
- Import `Subscription` from `rxjs` (already imported)
- Subscribe to `api.wsMessages$` in `ngOnInit()`:
  ```typescript
  this.wsSubscription = this.api.wsMessages$.subscribe(data => {
    if (data.type === 'message' && this.selectedUser && data.from === this.selectedUser.id) {
      // same logic as before, but use data.from_name instead of this.selectedUser.username
      const msg: Message = {
        id: Date.now(),
        from_user_id: data.from,
        to_user_id: this.currentUserId,
        content: data.content,
        created_at: new Date().toISOString(),
        from_user: data.from_name,  // from server, not local user list
        images: data.images ? data.images.map(url => ({ id: 0, image_url: url })) : undefined,
      };
      this.messages.push(msg);
      localStorage.setItem(this.messageCacheKey(this.selectedUser.id), JSON.stringify(this.messages));
    }
  });
  ```
- Keep existing subscription to `api.wsOnlineEvent` (already works with Subject)
- In `ngOnDestroy()`, unsubscribe `wsSubscription` + `onlineSubscription`

---

### Notification decision matrix

| Tab visible | Route | Viewing sender | Result |
|-------------|-------|----------------|--------|
| Yes | `/chat/5` | `selectedUser.id === 5` | No notification (message appears in chat) |
| Yes | `/chat/3` | `selectedUser.id === 3` | Notification (different conversation) |
| Yes | `/feed` | — | Notification (different page) |
| Yes | `/settings` | — | Notification (different page) |
| No | any | any | Notification (tab backgrounded) |

### Notification click behavior

Clicking the notification:
1. `window.focus()` — brings the browser window to front
2. `router.navigate(['/chat', senderId])` — navigates to the correct conversation
3. Closes the notification

### Error handling / edge cases

- **Permission denied**: No notifications shown; no repeated prompts
- **Notification API unavailable**: `if (!('Notification' in window)) return;` — no-op
- **WS reconnect**: `api.service.ts` handles reconnection; `wsMessages$` is a Subject, subscribers don't need to re-subscribe
- **Logout/Login**: WS disconnects on logout, reconnects on login; old subscription data is stale
- **Multiple tabs**: Each tab has its own WS, own visibility detection. Push notifications (SW) handle the cross-tab case
- **No `from_name` from old server**: Backward-compatible — if `from_name` is undefined, fall back to `"Someone"`
