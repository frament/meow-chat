# Session 2026-05-31 — Push notifications + WS reconnect + badges

## Features

### Push fix
- Moved push trigger from `SendMessage` HTTP handler to hub broadcast handler. Push sent when `!delivered` (no WS client received the message) instead of `!onlineUsers[toUserID]` — eliminates iOS background message loss during 30s grace period — `handlers/handlers.go`

### Early permission request
- `this.#notif.requestPermission()` in `App.ngOnInit()` regardless of SW state — `app.ts`

### Persistent WS reconnect
- Reconnect timer moved into `onclose` handler so it fires on EVERY disconnect — `api.service.ts`
- Token refresh before WS reconnect: `isJwtExpired()` check, refresh via `refreshToken()` if expired, prevents infinite reconnect loop with stale token — `api.service.ts`

### Auto-scroll chat
- `data-scroll-container` attribute + `document.querySelectorAll` + double `requestAnimationFrame` for reliable scroll-to-bottom — `chat.ts`

### Update banner safe area
- `padding: calc(10px + env(safe-area-inset-top, 0px))` — `app.ts`

### Unread badges
- `unreadCounts` signal + `totalUnread` computed in `ApiService`
- Badges on nav links (`.badge-nav`/`.badge-nav-sm`) and user list items (`.badge-user`)
- Cleared on `selectUser()` and `/chat/:id` route — `api.service.ts`, `app.ts`, `layout.ts`, `chat.ts`, `styles.css`
