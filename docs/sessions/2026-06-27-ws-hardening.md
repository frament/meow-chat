# WS Hardening: Reliability, PWA, UI

## Goal
Защитить ядро WebSocket от всех видов сбоев — потери сообщений, race conditions, zombie-соединений, разрывов в PWA.

## Changes

### Backend (Go) — `handlers.go` + `main.go`

- **Буферизованные каналы**: `broadcast: 64`, `broadcastGroup: 64`, `broadcastToUser: 64`, `broadcastAll: 16`
- **Write deadline**: 10s `SetWriteDeadline` перед каждым `WriteJSON` (6 мест)
- **Ping/Pong**: PingMessage каждые 25с, PongHandler, ReadDeadline 60с, stopPing канал в HandleWebSocket
- **Group echo**: групповые сообщения шлются и отправителю (multi-tab), добавлено поле `id` в payload
- **Online status**: `user_online`/`user_offline` — обрабатывают ошибки записи
- **Federation**: `from_name` + `id` в `OnIncomingMessage`

### Frontend — `api.service.ts`

- **Subject-based routing**: `wsMessages$` теперь `Subject<any>` — роутит ВСЕ 8 WS-типов (было 2): `message`, `group_message`, `user_online`, `user_offline`, `poll_update`, `group_joined`, `device_auth_request`, `device_approved`
- **Exponential backoff**: 1–30s + jitter, вместо фиксированных 3s
- **Connection state**: `wsConnected` signal (source of truth)
- **Guard**: `wsConnecting` флаг блокирует параллельные `connectWebSocket()`
- **Slow-poll**: после 20 попыток — reconnect каждые 60s (бесконечно, не останавливается)
- **PWA**: `visibilitychange` → `visible` сбрасывает retryCount и переподключается немедленно
- **Public API**: `retryConnection()` — публичный метод для ручного reconnect

### Frontend — `chat.ts`

- Group WS dedup: проверка `data.id` в групповом обработчике, fallback на `Date.now()`
- DM merge: `selectUser()` не перезаписывает `this.messages` — merge с optimistic-сообщениями по `id`

### Frontend — `app.ts` (UI)

- **Offline banner**: bottom-баннер "Нет соединения" с кнопкой "Подключиться" (svg-иконки, monochrome, animation slideUp)
- **Pull-to-refresh**: touch-обработчики на `document`, срабатывает только при `scrollY === 0` и `!wsConnected()`, индикатор на 80px, вызов `retryConnection()`
- **Dismiss**: кнопка "✕" скрывает баннер на сессию (`offlineDismissed`)
- **CSS custom properties**: баннер и индикатор используют `var(--bg-surface)`, `var(--border-default)` и т.д.

### Documentation — `docs/ws-requirements.md`

- PWA4/PWA5/PWA6 отмечены как реализованные
- Таблица reconnect в секции 6.1 дополнена строками для retryConnection() и pull-to-refresh

## Verification

- `npx tsc --noEmit` — clean
- `go build -o /dev/null .` — clean
- `npm run build` — pre-existing error (ScrollingModule import), не связан с изменениями

## Files changed

```
 backend/handlers/handlers.go             |  65 +++++++++---
 backend/main.go                          |   3 +
 frontend/src/app/app.ts                  | 143 ++++++++++++++++++++++
 frontend/src/app/components/chat/chat.ts |  27 +++--
 frontend/src/app/services/api.service.ts |  75 ++++++++----
 docs/ws-requirements.md                  |  12 ++-
 docs/sessions/2026-06-27-ws-hardening.md |   1 +
 7 files changed, 291 insertions(+), 35 deletions(-)
```
