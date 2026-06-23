# Session 2026-05-31 — System notifications + Global WebSocket

## Features

### System notifications
- Added `from_name` to backend WS message struct + broadcast payload — `handlers/handlers.go`
- New `NotificationService`: manages `Notification` API permission, `show()`, tab visibility tracking (`document.visibilitychange` + `blur`/`focus`) — `notification.service.ts`

### Global WebSocket
- Refactored WS from chat component to `ApiService` singleton — persists across pages, auto-connect on auth, auto-disconnect on logout — `api.service.ts`
- `App` component subscribes to `wsMessages$`, shows browser notification when tab is hidden OR user is not on the correct chat route; click navigates to `/chat/:senderId` — `app.ts`

### Chat cleanup
- Removed local WS management from chat component, subscribes to `api.wsMessages$` instead, uses `data.from_name` from server — `chat.ts`
- WS connection lifecycle: constructor → `connectWebSocket()` if saved token, `storeAuth()` → `connectWebSocket()`, `logout()` → `disconnectWebSocket()`

## Fixes
- Fixed notification permission request: moved from `App.ngOnInit()` to `LoginComponent.onSubmit()` (user gesture required) — `login.ts`, `notification.service.ts`
- Fixed `uploads/` not persisting in Docker: added volume to `docker-compose.yml`
- Fixed iOS safe area: added `viewport-fit=cover`, `env(safe-area-inset-bottom)` padding for bottom nav and mobile chat — `index.html`, `layout.ts`, `chat.ts`
- Rebranded to MeowChat: updated title, manifest, nav logo text — `index.html`, `layout.ts`, `manifest.webmanifest`
- Added SVG logo + favicon concepts in `design-mockups/`
- Replaced favicon with PNG favicon — `index.html`, `favicon.png`
- Fixed iOS safe area top padding for notch/status bar — `layout.ts`
- Fixed mobile chat height to account for both top and bottom nav with safe areas — `chat.ts`
- Added notification chime via Web Audio API, then replaced with custom `notification.mp3` — `notification.service.ts`
- Fixed favicon transparency for dark theme — `favicon.png`
- **Badging API**: `navigator.setAppBadge()` unread count on PWA icon, cleared on focus/chat navigation — `app.ts`
- **WS connection fix**: Moved `connectWebSocket()` from `ApiService` constructor to `App.ngOnInit()`, added 3s auto-reconnect on close — `api.service.ts`, `app.ts`
