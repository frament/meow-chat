# Сессия 2026-09-19: Постоянные непрочитанные, бейджи/разделитель и self-heal push

## Контекст
Повторная жалоба на уведомления (прод home-lab, `192.168.1.41`):
1. Уведомления приходят только внутри локальной сети.
2. Нет бейджей ни в навигации/PWA, ни в списке чатов.
3. В чатах пропало разделение на новые (непрочитанные) и старые сообщения.

## Диагностика

### 1. Push вне LAN → протухшие FCM-подписки
В логах backend: для `fcm.googleapis.com` — `403 the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions`, для `web.push.apple.com` — `201`. То есть на Chrome/Android push мёртв после ротации VAPID-ключей, а единственный рабочий путь — in-app WS, который требует доступа к серверу (LAN).
Системная причина: сервер удалял подписку только на `410/404`, а клиент вслепую переотправлял старую подписку (`getSubscription()`), не сверяя VAPID-ключ.

### 2/3. Бейджи и разделитель → unread был чисто клиентским
`unreadCounts`/`unreadBoundaries` — in-memory сигналы, заполнялись только живым WS-событием. При сворачивании PWA код сам рвёт WS и шлёт `/offline`, поэтому сообщение, доставленное push'ем, не оставляло ни бейджа, ни разделителя. В БД при этом уже были реальные `messages.is_read=0` (users 5/7/8). У групп read-состояния не было вовсе.
Плюс баг: `chat.ts:selectUser` искал индекс разделителя в свежих `msgs`, а применял к `this.messages` (после перехода на «последние 100» индекс уезжал).

## Изменения

### Backend
- `GET /api/unread` (`handlers.go:GetUnread`) — непрочитанные по собеседникам и группам + `first_unread_at`.
- `group_chat_members.last_read_message_id` (миграция в `database.go`), `POST /api/group-chats/:groupId/read` (`groups.go:MarkGroupRead`). Новым участникам `last_read_message_id` = текущий MAX(id), чтобы история не стала непрочитанной.
- `push.go`: удаление подписки на `403` (плюс прежние `410/404`).
- `main.go`, `handlers_test_setup.go`: новые маршруты; `handlers/unread_test.go`.

### Frontend
- `api.service.ts`: сигналы `groupUnreadCounts`/`groupUnreadBoundaries`, `getUnread()`/`hydrateUnread()`, `markGroupRead()`, `totalUnread` учитывает группы.
- `app.ts`: гидратация unread при старте, смене пользователя и `visibilitychange→visible`; бейдж PWA от `totalUnread` через `effect` (убран сброс бейджа на каждый фокус); self-heal push — сверка `localStorage.pushVapidKey` с текущим VAPID, при расхождении `unsubscribe()` + переподписка + `DELETE /push/subscribe` старого endpoint.
- `chat.ts`: фикс индекса разделителя; групповые бейджи и разделитель; отметка прочтения DM/групп при живом WS.

### Прод
- Удалены протухшие FCM-подписки user 1 (id 703, 905); остались рабочие Apple-подписки.

## Проверка
- Backend: `go build ./...`; `go test ./handlers/`, `./database/` — зелёные. Полный `./...` не гоняется: компиляция с CGO валит RAM (машина ребуталась), ограничение помогает не всегда.
- Frontend: `npm run build`; спеки App/Chat — 23 SUCCESS. Полный сьют Karma местами флакает по таймауту, но проходит (199 SUCCESS).

## TBD
- Полная серверная пагинация истории (>100) всё ещё не сделана.
- Групповые непрочитанные считаются от `last_read_message_id`, а не от реального «прочитано до сообщения N».

## Дополнение (2026-09-19): оффлайн-плашка и версия в UI

### 1. «Нет соединения» мигало при старте
Плашка показывалась сразу по `!api.wsConnected()`, пока WS ещё устанавливался. Добавлен grace-период 5 с: сигнал `showOffline` + `effect` в `app.ts`; при успешном коннекте плашка и флаг dismiss сбрасываются.

### 2. Неверная версия в настройках
Корень: `version.Version` был `const`, а `-X` ldflags переопределяет только `var` — поэтому override тихо игнорировался; Dockerfile вообще собирал без ldflags. Итог — всегда 1.1.0 (при релизе 1.1.1).
- `version.go`: `const` → `var Version = "1.1.1"`.
- `Dockerfile`: `ARG VERSION=1.1.1` + `-ldflags "-X my-chat-backend/version.Version=${VERSION}"`.
- `docker-compose.yml`: build arg `VERSION: ${VERSION:-1.1.1}`.
- `Makefile`: `VERSION=$(git describe --tags --always --dirty)`, прокидывается в `build`/`update`/`restart-backend`.
- `update.go`: убран спец-кейс `IsDev` (`>=`), дававший ложное «есть обновление» для git-describe-версий (`v1.1.1-7-g...`); теперь просто `version.Compare(release, Version) > 0`.
- Тест `TestCheckUpdate_DescribeVersionNoFalseUpdate`.

Проверено: backend `go build` + тесты handlers (релевантные) — зелёные; frontend build + спеки App/Settings — 24 SUCCESS.

## Дополнение (2026-09-24): push не пришёл в группе, хотя бейджи верны

### Диагностика по логам прода
Wedge (user 9) отправил в группу 1 («Old school») сообщения 9/10 (13:29–13:30), frament отправил 11 (14:06):
```
13:29:39 Web Push sent to user 1, Apple .../QH9z... status 201
13:29:39 No push subscriptions found for user 10
14:06:47 No push subscriptions found for user 9
14:06:47 No push subscriptions found for user 10
```
Вывод: у user 9 и user 10 **нет ни одной push-подписки** на сервере → push невозможен. Бейджи корректны, т.к. считаются серверно и не требуют push.

### Найденный баг
`sw-push-handler.js` в `pushsubscriptionchange` вызывал `pushManager.subscribe({ userVisibleOnly: true })` **без `applicationServerKey`**. Такая подписка не связана с текущим VAPID-ключом → FCM/APNs отвечают `403`, а после фикса от 19.09 сервер её удаляет → подписка исчезает.

### Фиксы
- `sw-push-handler.js`: в `pushsubscriptionchange` сначала тянет `/api/push/vapid-public-key` и подписывается с этим ключом; убран дублирующий `.catch`.
- `push.go`: при удалении подписки на `403` сервер шлёт владельцу WS-событие `{type:"push_resubscribe"}`.
- `app.ts`: обработка `push_resubscribe` → `forceResubscribePush()` (unsubscribe + `DELETE /push/subscribe` + свежая подписка). Проактивная переподписка по `localStorage` теперь срабатывает только когда ключ известен и реально изменился (не рушит рабочие подписки на первом запуске).

### Важно для пользователей 9/10
Подписка появится, когда они откроют обновлённое приложение с разрешёнными уведомлениями (на iOS — только установленная на «Домой» PWA, iOS 16.4+). Без разрешения/установки push работать не будет.
