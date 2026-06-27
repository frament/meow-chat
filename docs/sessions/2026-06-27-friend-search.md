# Friend Search & Friend Requests

## Goal
Реализовать поиск пользователей по username и отправку запросов в друзья (issue #14).

## Changes

### Backend (Go) — `database.go`, `handlers.go`, `main.go`

- **`friend_requests` table**: `from_user`, `to_user`, `status` (pending/accepted/rejected), `UNIQUE(from_user, to_user)`
- **`GET /api/users/search?q=`**: поиск пользователей (исключая себя и уже друзей, `LIKE`, max 20)
- **`POST /api/friend-requests/:id`**: отправить запрос. Авто-принятие если встречный запрос уже есть (mutual). WS-уведомление получателю
- **`GET /api/friend-requests`**: список входящих `pending` запросов
- **`POST /api/friend-requests/:id/accept`**: принять запрос → добавить в `friends`, обновить статус, WS-уведомление отправителю
- **`DELETE /api/friend-requests/:id`**: отклонить запрос (status = 'rejected')
- **Cleanup**: `AdminDeleteUser` удаляет записи из `friend_requests`

### Frontend — `api.service.ts`

- `searchUsers(query)` — GET
- `sendFriendRequest(userId)` — POST
- `getFriendRequests()` — GET
- `acceptFriendRequest(requestId)` — POST
- `rejectFriendRequest(requestId)` — DELETE

### Frontend — `chat.ts`

- **Search bar** в сайдбаре (десктоп + мобилка), debounce 300ms
- **Результаты поиска** — аватар, username, кнопка «В друзья»
- **Входящие заявки** — секция с кнопками ✓ / ✕
- **WS обработка**: `friend_request` → `loadIncomingRequests()`, `friend_request_accepted` → `loadFromServer()` + `loadIncomingRequests()`
- **Auto-accept**: если запрос mutual — скрываем пользователя из результатов

### Tests — `friend_requests_test.go` (17 tests)

- SearchUsers: success, excludes self, excludes friends, short query, requires auth
- SendFriendRequest: success, self, already friends, duplicate, auto-accept
- GetFriendRequests: empty, with pending
- AcceptFriendRequest: success, not found, wrong user
- RejectFriendRequest: success, not found

### Tests — `api.service.spec.ts` (6 tests)

- searchUsers, sendFriendRequest, sendFriendRequest auto_accepted, getFriendRequests, acceptFriendRequest, rejectFriendRequest

### Test Infrastructure

- `handlers_test_setup.go`: added `friend_requests` CREATE TABLE + 5 new routes
- `chat.component.spec.ts`: added 5 mock methods (searchUsers, sendFriendRequest, getFriendRequests, acceptFriendRequest, rejectFriendRequest)

## Verification

- `go test ./handlers/ -count=1` — 17 new tests pass (total handler suite: all pass)
- `ng test --watch=false` — 6 new API tests pass, 105 success / 7 pre-existing failures (App component, unrelated)
- `go build ./...` — clean

## Files changed

```
 backend/database/database.go                       |   8 +
 backend/handlers/handlers.go                       | 247 +++++++++++++++++++++
 backend/handlers/handlers_test_setup.go            |  14 ++
 backend/main.go                                    |   6 +
 frontend/src/app/components/chat/chat.ts           | 199 +++++++++++++++++
 frontend/src/app/components/chat/chat.component.spec.ts |   5 +
 frontend/src/app/services/api.service.ts           |  22 ++
 frontend/src/app/services/api.service.spec.ts      |  66 ++++++
 8 files changed, 567 insertions(+)
```
