# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Web Push notifications — users get browser/OS notifications when they receive a message while the chat PWA is closed.

**Architecture:** When a message is sent to an offline user, the backend sends a Web Push via the browser's Push Service. The frontend registers a custom service worker that handles `push` and `notificationclick` events. When the app is open, existing WebSocket delivery is used (no duplicate toasts).

**Tech Stack:** Go (webpush-go), Angular 20 (@angular/service-worker SwPush), Web Push API

**Spec:** `docs/superpowers/specs/2026-05-30-push-notifications-design.md`

---

### Task 1: Backend DB — push_subscriptions table + VAPID keys

**Files:**
- Modify: `backend/database/database.go`
- Modify: `backend/go.mod`

- [ ] **Step 1: Add push_subscriptions table to migration**

Add to the `queries` slice in `database/database.go`:

```go
`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT    NOT NULL,
    p256dh      TEXT    NOT NULL,
    auth        TEXT    NOT NULL,
    UNIQUE(user_id, endpoint)
)`,
```

Also add uploads directory creation (already exists pattern):
```go
if err := os.MkdirAll("./uploads/messages", 0755); err != nil {
    log.Fatal("Failed to create messages uploads directory:", err)
}
```
(already present — no change needed)

- [ ] **Step 2: Add webpush-go dependency**

Run:
```sh
cd backend && go get github.com/SherClockHolmes/webpush-go
```

- [ ] **Step 3: Commit**

```sh
git add backend/database/database.go backend/go.mod backend/go.sum
git commit -m "feat: add push_subscriptions table and webpush-go dep"
```

---

### Task 2: Backend Models — push subscription structs

**Files:**
- Modify: `backend/models/models.go`

- [ ] **Step 1: Add PushSubscriptionRequest and PushSubscription response structs**

Add to `backend/models/models.go`:

```go
type PushSubscriptionRequest struct {
    Endpoint string `json:"endpoint"`
    P256dh   string `json:"p256dh"`
    Auth     string `json:"auth"`
}

type DeleteSubscriptionRequest struct {
    Endpoint string `json:"endpoint"`
}
```

- [ ] **Step 2: Commit**

```sh
git add backend/models/models.go
git commit -m "feat: add push subscription request models"
```

---

### Task 3: Backend — VAPID key generation + push subscription endpoints

**Files:**
- Create: `backend/handlers/push.go` (new file)
- Modify: `backend/main.go`

- [ ] **Step 1: Create push.go with VAPID setup + subscription handlers**

Create `backend/handlers/push.go`:

```go
package handlers

import (
    "crypto/rand"
    "encoding/json"
    "fmt"
    "log"
    "os"
    "path/filepath"

    "my-chat-backend/database"
    "my-chat-backend/models"

    "github.com/gofiber/fiber/v2"
    "github.com/SherClockHolmes/webpush-go"
)

type vapidKeys struct {
    Public  string `json:"public"`
    Private string `json:"private"`
}

var vapid *vapidKeys

func loadOrGenerateVAPIDKeys() error {
    const path = "./vapid_keys.json"
    if data, err := os.ReadFile(path); err == nil {
        var k vapidKeys
        if json.Unmarshal(data, &k) == nil && k.Public != "" && k.Private != "" {
            vapid = &k
            return nil
        }
    }

    private, public, err := webpush.GenerateVAPIDKeys()
    if err != nil {
        return fmt.Errorf("failed to generate VAPID keys: %w", err)
    }

    vapid = &vapidKeys{Public: public, Private: private}
    data, _ := json.MarshalIndent(vapid, "", "  ")
    os.WriteFile(path, data, 0600)
    return nil
}

func (h *Handler) VAPIDPublicKey(c *fiber.Ctx) error {
    return c.JSON(fiber.Map{"publicKey": vapid.Public})
}

func (h *Handler) SubscribePush(c *fiber.Ctx) error {
    userID := c.Locals("userId").(int64)

    var req models.PushSubscriptionRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }
    if req.Endpoint == "" || req.P256dh == "" || req.Auth == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Missing fields"})
    }

    _, err := database.DB.Exec(
        "INSERT OR IGNORE INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)",
        userID, req.Endpoint, req.P256dh, req.Auth,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to save subscription"})
    }

    return c.JSON(fiber.Map{"message": "Subscribed"})
}

func (h *Handler) UnsubscribePush(c *fiber.Ctx) error {
    userID := c.Locals("userId").(int64)

    var req models.DeleteSubscriptionRequest
    if err := c.BodyParser(&req); err != nil || req.Endpoint == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Endpoint required"})
    }

    _, err := database.DB.Exec(
        "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
        userID, req.Endpoint,
    )
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to remove subscription"})
    }

    return c.JSON(fiber.Map{"message": "Unsubscribed"})
}
```

- [ ] **Step 2: Register routes in main.go**

Add after the `api.Post("/refresh", h.Refresh)` line (before the WS route), since `VAPIDPublicKey` doesn't need auth:

```go
api.Get("/push/vapid-public-key", h.VAPIDPublicKey)
```

Add after `api.Use(handlers.AuthRequired)` — inside the auth-required group:

```go
api.Post("/push/subscribe", h.SubscribePush)
api.Delete("/push/subscribe", h.UnsubscribePush)
```

And add `h.loadOrGenerateVAPIDKeys()` call after `h := handlers.NewHandler()`:

```go
h := handlers.NewHandler()
if err := h.loadOrGenerateVAPIDKeys(); err != nil {
    log.Fatal("Failed to init VAPID keys:", err)
}
```

Since `loadOrGenerateVAPIDKeys` is defined on `*Handler` in the `push.go` file (same package), this works.

- [ ] **Step 3: Commit**

```sh
git add backend/handlers/push.go backend/main.go
git commit -m "feat: add VAPID keys and push subscription endpoints"
```

---

### Task 4: Backend — Push trigger when user is offline

**Files:**
- Modify: `backend/handlers/handlers.go`
- Modify: `backend/handlers/push.go`

- [ ] **Step 1: Add sendPushNotification helper to push.go**

Append to `backend/handlers/push.go`:

```go
func (h *Handler) sendPushNotification(toUserID int64, title, body string, data map[string]interface{}) {
    rows, err := database.DB.Query(
        "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
        toUserID,
    )
    if err != nil {
        log.Println("Failed to query push subscriptions:", err)
        return
    }
    defer rows.Close()

    for rows.Next() {
        var endpoint, p256dh, auth string
        if err := rows.Scan(&endpoint, &p256dh, &auth); err != nil {
            continue
        }

        sub := &webpush.Subscription{
            Endpoint: endpoint,
            Keys: webpush.Keys{
                P256dh: p256dh,
                Auth:   auth,
            },
        }

        payload, _ := json.Marshal(map[string]interface{}{
            "title": title,
            "body":  body,
            "icon":  "/favicon.ico",
            "data":  data,
        })

        resp, err := webpush.SendNotification(payload, sub, &webpush.Options{
            Subscriber:      "admin@mychat.local",
            VAPIDPublicKey:  vapid.Public,
            VAPIDPrivateKey: vapid.Private,
            TTL:             86400,
        })
        if err != nil {
            log.Println("Web Push send error:", err)
            continue
        }
        resp.Body.Close()

        // If subscription is expired/gone, remove it
        if resp.StatusCode == 410 || resp.StatusCode == 404 {
            database.DB.Exec("DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint)
        }
    }
}
```

- [ ] **Step 2: Add import for json in handlers.go if not present**

In `handlers.go`, `json` is not imported yet. Check imports — `encoding/json` is not currently imported. The `fiber.Map` serialization is handled by Fiber internally. The existing code uses `fiber.Map` and `database` — no `json` import.

We need to add `"encoding/json"` to the import list in `back...` — wait, `push.go` is a separate file but in the same package, so the import in `push.go` covers it. The function `sendPushNotification` is in `push.go`.

- [ ] **Step 3: Call sendPushNotification from SendMessage when recipient is offline**

In `backend/handlers/handlers.go`, modify `SendMessage` — after `h.broadcast <- wsMessage{...}` and before the return, add:

```go
// Send push notification if recipient is offline
if !h.onlineUsers[toUserID] {
    // Fetch sender name
    var senderName string
    database.DB.QueryRow("SELECT username FROM users WHERE id = ?", fromUserID).Scan(&senderName)
    preview := content
    if len(preview) > 120 {
        preview = preview[:120] + "..."
    }
    if preview == "" && len(images) > 0 {
        preview = "[Image]"
    }
    h.sendPushNotification(toUserID,
        "New message from "+senderName,
        preview,
        map[string]interface{}{"url": fmt.Sprintf("/chat/%d", fromUserID), "senderId": fromUserID},
    )
}
```

Add `"fmt"` to imports in `handlers.go` (already imported).

- [ ] **Step 4: Commit**

```sh
git add backend/handlers/push.go backend/handlers/handlers.go
git commit -m "feat: send push notification when message recipient is offline"
```

---

### Task 5: Frontend — Custom Service Worker with push handler

**Files:**
- Create: `frontend/src/sw-push-handler.js`

- [ ] **Step 1: Create sw-push-handler.js**

Create `frontend/src/sw-push-handler.js`:

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
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(location.host) && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 2: Commit**

```sh
git add frontend/src/sw-push-handler.js
git commit -m "feat: add custom service worker for push notifications"
```

---

### Task 6: Frontend — Register custom SW + update build config

**Files:**
- Modify: `frontend/angular.json`
- Modify: `frontend/ngsw-config.json`
- Modify: `frontend/src/app/app.config.ts`

- [ ] **Step 1: Add sw-push-handler.js to angular.json assets**

In `frontend/angular.json`, add the custom SW to the build assets array (so it's copied to output):

```json
"assets": [
  { "glob": "**/*", "input": "public" },
  { "glob": "sw-push-handler.js", "input": "src" }
],
```

- [ ] **Step 2: Add sw-push-handler.js to ngsw-config.json resources**

In `frontend/ngsw-config.json`, add to the `app` asset group's resources files:

```json
"resources": {
  "files": [
    "/favicon.ico",
    "/index.csr.html",
    "/index.html",
    "/manifest.webmanifest",
    "/sw-push-handler.js",
    "/*.css",
    "/*.js"
  ]
}
```

- [ ] **Step 3: Register custom SW in app.config.ts**

In `frontend/src/app/app.config.ts`, change the service worker registration from `'ngsw-worker.js'` to `'sw-push-handler.js'`:

```ts
provideServiceWorker('sw-push-handler.js', {
  enabled: !isDevMode(),
  registrationStrategy: 'registerWhenStable:30000',
}),
```

- [ ] **Step 4: Commit**

```sh
git add frontend/angular.json frontend/ngsw-config.json frontend/src/app/app.config.ts
git commit -m "feat: register custom service worker for push handling"
```

---

### Task 7: Frontend — Add push subscription API methods

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`

- [ ] **Step 1: Add getVapidPublicKey(), pushSubscribe(), pushUnsubscribe() methods**

Add to `ApiService` class:

```ts
getVapidPublicKey() {
  return this.http.get<{ publicKey: string }>(`${this.baseUrl}/push/vapid-public-key`);
}

pushSubscribe(subscription: PushSubscriptionJSON) {
  return this.http.post(`${this.baseUrl}/push/subscribe`, {
    endpoint: subscription.endpoint,
    p256dh: subscription.keys?.p256dh,
    auth: subscription.keys?.auth,
  });
}

pushUnsubscribe(endpoint: string) {
  return this.http.delete(`${this.baseUrl}/push/subscribe`, {
    body: { endpoint },
  });
}
```

- [ ] **Step 2: Commit**

```sh
git add frontend/src/app/services/api.service.ts
git commit -m "feat: add push subscription API methods"
```

---

### Task 8: Frontend — Push subscription lifecycle in App component

**Files:**
- Modify: `frontend/src/app/app.ts`

- [ ] **Step 1: Add SwPush subscription logic**

Modify `frontend/src/app/app.ts`:

```ts
import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SwUpdate, SwPush } from '@angular/service-worker';
import { interval, fromEvent, filter, tap, Subscription } from 'rxjs';
import { ApiService } from './services/api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    @if (updateAvailable()) {
      <div class="update-banner">
        <span>Доступна новая версия</span>
        <button (click)="applyUpdate()">Обновить</button>
      </div>
    }
    <router-outlet />
  `,
  styles: [`
    .update-banner {
      position: fixed; top: 0; left: 0; right: 0;
      z-index: 9999; display: flex; align-items: center;
      justify-content: center; gap: 12px; padding: 10px 16px;
      background: #1d4ed8; color: #fff; font-size: 14px;
    }
    .update-banner button {
      background: #fff; color: #1d4ed8; border: none;
      border-radius: 6px; padding: 4px 12px; font-weight: 600; cursor: pointer;
    }
  `],
})
export class App implements OnInit, OnDestroy {
  readonly #sw = inject(SwUpdate);
  readonly #swPush = inject(SwPush);
  readonly #api = inject(ApiService);
  readonly updateAvailable = signal(false);

  #sub = new Subscription();

  constructor() {
    if (this.#sw.isEnabled) {
      this.#sw.versionUpdates
        .pipe(filter(evt => evt.type === 'VERSION_READY'))
        .subscribe(() => this.updateAvailable.set(true));

      this.#sub.add(
        fromEvent(window, 'focus').subscribe(() => this.#sw.checkForUpdate())
      );

      this.#sub.add(
        interval(30 * 60 * 1000)
          .pipe(tap(() => this.#sw.checkForUpdate()))
          .subscribe()
      );
    }
  }

  ngOnInit() {
    if (!this.#swPush.isEnabled) return;

    this.#api.getVapidPublicKey().subscribe({
      next: (keys) => {
        this.#swPush.requestSubscription({ serverPublicKey: keys.publicKey }).then(sub => {
          this.#api.pushSubscribe(sub.toJSON()).subscribe();
        }).catch(() => {});
      },
    });
  }

  ngOnDestroy() {
    this.#sub.unsubscribe();
  }

  applyUpdate() {
    this.#sw.activateUpdate().then(() => document.location.reload());
  }
}
```

Also import `OnInit, OnDestroy` and `Subscription` from `@angular/core` and `rxjs`.

Current imports:
```ts
import { Component, inject, signal } from '@angular/core';
```
Change to:
```ts
import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
```

Add rxjs imports:
```ts
import { Subscription } from 'rxjs';
```
(interval, fromEvent, filter, tap are already imported from rxjs)

- [ ] **Step 2: Commit**

```sh
git add frontend/src/app/app.ts
git commit -m "feat: add push subscription lifecycle in app component"
```

---

### Task 9: Verify build

**Files:** none

- [ ] **Step 1: Run production build**

```sh
cd frontend && npm run build
```

Expected: Build succeeds with no errors. Verify `sw-push-handler.js` appears in the output (`frontend/dist/frontend/`).

- [ ] **Step 2: Commit**

```sh
git commit --allow-empty -m "chore: verify push notification build"
```

---

### Task 10: Update AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add session entry**

Add to the Session (2026-05-30) section:

```markdown
- Added push notifications via Web Push API
- Backend: `push_subscriptions` table + VAPID key generation — `database/database.go`, `handlers/push.go`
- Backend: push subscription endpoints (`GET/POST/DELETE /api/push/*`) — `main.go`, `handlers/push.go`
- Backend: push trigger in `SendMessage` when recipient offline — `handlers/handlers.go`
- Frontend: custom `sw-push-handler.js` service worker with `push`/`notificationclick` handlers
- Frontend: `SwPush` subscription lifecycle on login — `app.ts`, `api.service.ts`
```

- [ ] **Step 2: Commit**

```sh
git add AGENTS.md
git commit -m "docs: update session log"
git push
```
