# iOS PWA push notification fixes

## Problem
1. Push-уведомления не приходят когда PWA свёрнуто (inconsistent)
2. Свой звук не играет — только при открытом приложении

## Root Cause
- **SW не контролировал страницу при первом запуске**: `skipWaiting()` и `clients.claim()` не вызывались → `navigator.serviceWorker.controller === null` → Angular `SwPush.isEnabled === false` → `tryReSubscribePush()` выходил сразу, подписка не создавалась
- **`silent: true`** в SW глушил системный звук на iOS (SW не может играть кастомный `.mp3` в фоне)
- **`event.data.json()` без try/catch** — кривой payload ронял обработчик, iOS считал failed delivery, после 3х — отзыв подписки
- **`tryReSubscribePush` зависел от `SwPush.isEnabled`** — на iOS при первом запуске всегда false

## Changes

### `frontend/src/sw-push-handler.js` (+8 / -2)
- `install` → `self.skipWaiting()` — SW активируется сразу, не ждёт закрытия PWA
- `activate` → `clients.claim()` — SW сразу контролирует страницу
- `try/catch` вокруг `event.data?.json()` — защита от кривого payload
- `silent: true` → убрано (было в прошлом коммите)
- `requireInteraction: true` — уведомление не пропадает само

### `frontend/src/app/app.ts` (-4 / +5)
- `tryReSubscribePush()` больше не проверяет `SwPush.isEnabled` — вместо этого `'serviceWorker' in navigator`
- Подписка через `reg.pushManager.subscribe()` напрямую, без `SwPush.requestSubscription()` (который внутри тоже проверяет `isEnabled`)
- VAPID `applicationServerKey` передаётся явно

### `backend/handlers/handlers.go` (+2)
- `tag` в data пуша (`chat-{id}`, `group-{id}`) — iOS группирует уведомления одного чата

## VAPID subject
- `push.go:122`: `"admin@mychat.local"` — Apple требует `mailto:` или HTTPS URL как `Subscriber`. Сейчас невалидный email (без `mailto:`). Если push перестанет работать на iOS после этих фиксов — проверить это поле.

## Что не чинится кодом
- iOS может отложить/отменить push при энергосбережении, DND, или если PWA давно не открывали — это платформенное ограничение
