# Session 2026-05-31 — Unread message divider

## Features

### Unread divider
- Visual separator between read and unread messages in chat — `chat.ts`, `chat.html`

### Backend changes
- Added `createdAt` to `wsMessage` struct + WS broadcast payload for boundary tracking — `handlers/handlers.go`

### Frontend state
- `unreadBoundaries` signal: tracks first unread message timestamp per user in `ApiService`, set via `incrementUnread(createdAt)` — `api.service.ts`
- 30s boundary timeout: divider stays visible for 30s after opening chat (survives duplicate `selectUser` calls from `route.paramMap` + `resolvePendingChat`), then clears — `chat.ts`
- Separated clear: `clearUnread` no longer clears boundary; new `clearUnreadBoundary` for explicit boundary cleanup — `api.service.ts`

### Styling
- `.unread-divider` with accent horizontal lines + "Новые сообщения" label — `styles.css`
