# 2026-07-08: Real-time read receipts via WebSocket

## Problem
Когда получатель открывает чат и сообщения помечаются прочитанными (`MarkMessagesRead`), отправитель не узнаёт об этом в реальном времени — двойная галочка появляется только после перезагрузки.

## Changes

### Backend: `backend/handlers/handlers.go`
- `MarkMessagesRead`: после `UPDATE messages SET is_read = 1` отправляет WS-событие отправителю через `h.SendToUser`
- Событие: `{ type: "mark_read", message_ids: [...], from_user: <currentUserID> }`
- Отправляется только если `affected > 0 && req.UserID > 0`

### Frontend: `frontend/src/app/components/chat/chat.ts`
- Новый обработчик `data.type === 'mark_read'` в подписке `wsMessages$`
- Проходит по `this.messages` и ставит `is_read = true` для сообщений из `data.message_ids`

## Files
- `backend/handlers/handlers.go`
- `frontend/src/app/components/chat/chat.ts`
