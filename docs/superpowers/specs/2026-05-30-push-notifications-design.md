# Push Notifications — Design Spec

## Goal
When a user receives a chat message while the app is closed or backgrounded, show a browser/OS notification via Web Push API. When the app is open, continue using existing WebSocket delivery (no duplicate toasts).

## Architecture

```
[User A sends message]
        │
        v
[Backend: SendMessage handler]
        │
        ├── WebSocket broadcast (existing) → User B if online
        └── If User B offline (not in WS hub)
                └── Web Push → Push Service (browser) → User B's SW → Notification
```

## Backend

### VAPID keys
- Generate on first startup if `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars not set
- Save to `vapid_keys.json` in backend working directory
- Expose public key via `GET /api/push/vapid-public-key`

### DB table: `push_subscriptions`
```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT    NOT NULL,
    p256dh      TEXT    NOT NULL,
    auth        TEXT    NOT NULL,
    UNIQUE(user_id, endpoint)
);
```

### API endpoints

| Method | Path                      | Auth | Description                        |
|--------|---------------------------|------|------------------------------------|
| GET    | `/api/push/vapid-public-key` | No   | Returns `{ publicKey: string }`  |
| POST   | `/api/push/subscribe`     | Yes  | Save subscription `{ endpoint, p256dh, auth }` |
| DELETE | `/api/push/subscribe`     | Yes  | Remove subscription by `{ endpoint }` |

### Push trigger (in SendMessage handler)
After saving message + broadcasting via WS:
1. Build recipient user ID
2. Check if recipient is in `onlineUsers` map (WS hub)
3. If online — done (WS handles it)
4. If offline — query all `push_subscriptions` for that user → send Web Push with message preview

### Library
- `github.com/SherClockHolmes/webpush-go`

### Web Push payload
```json
{
  "title": "New message from {sender_name}",
  "body": "{message_preview}",
  "icon": "/favicon.ico",
  "data": {
    "url": "/chat/{sender_id}",
    "senderId": "{sender_id}"
  }
}
```

## Frontend

### Service Worker push handler
- Angular's default SW (`ngsw-worker.js`) does NOT handle push events — we need a custom wrapper
- Create `frontend/src/sw-push-handler.js` that imports the Angular SW and handles `push`/`notificationclick`:

```js
importScripts('./ngsw-worker.js');

self.addEventListener('push', (event) => {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/favicon.ico',
      data: data.data,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

- Include `sw-push-handler.js` in `ngsw-config.json` as an asset (`installMode: "prefetch"`)
- Register `sw-push-handler.js` instead of `ngsw-worker.js` in `app.config.ts`
- `SwPush.subscription` / `requestSubscription` / `unsubscribe` — used to manage push subscription in the app

### Flow
1. **On login / app init**: check `SwPush.isEnabled`, request permission, subscribe via `SwPush.requestSubscription({ serverPublicKey })`, POST subscription to backend
2. **On logout**: DELETE subscription from backend
3. **When app is open**: `SwPush.messages` observable fires for incoming pushes — ignore (WS handles delivery)
4. **When app is closed**: custom SW `push` handler calls `showNotification()`, `notificationclick` opens `/chat/{senderId}`

### Files changed
- `frontend/src/sw-push-handler.js` — new file, custom SW with push handlers
- `frontend/src/app/services/api.service.ts` — add `getVapidPublicKey()`, `pushSubscribe()`, `pushUnsubscribe()`
- `frontend/src/app/app.ts` — add `SwPush` subscription/unsubscription logic
- `frontend/ngsw-config.json` — add `sw-push-handler.js` to asset resources
- `frontend/src/app/app.config.ts` — register `sw-push-handler.js` instead of `ngsw-worker.js`

## iOS note
Web Push on iOS works starting from Safari 16.4 (iOS 16.4+). On older iOS, push is silently unavailable.

## Future scope (not in this iteration)
- Push for new posts in feed
- Push for user coming online
- Rich notifications with reply actions
