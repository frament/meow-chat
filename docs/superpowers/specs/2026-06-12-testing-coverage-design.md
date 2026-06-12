# Тестирование MeowChat — Design Spec

## Общий подход

- **Фреймворки**: Go `testing` (backend), Jasmine + Karma (frontend)
- **Порядок**: от ядра к периферии, полный цикл на модуль (тестовая инфраструктура → все тесты → commit → следующий модуль)
- **Backend**: table-driven tests с `t.Run`, in-memory SQLite (`:memory:`) для каждого теста, `fiber.Test()` для handler-тестов
- **Frontend**: `TestBed.configureTestingModule` + `HttpTestingController` + моки сервисов через `TestBed.overrideProvider` или spy

## Модули и файлы

### 1. auth/jwt — `backend/auth/jwt_test.go`
- `TestGenerateAccessToken`: проверяет подпись, claims (`userId`, `isAdmin`), срок действия
- `TestValidateAccessToken`: правильный/просроченный/неправильная подпись/мусор
- `TestGenerateRefreshToken`: формат, уникальность
- `TestParseToken`: извлечение claims
- Table-driven, без БД

### 2. database — `backend/database/database_test.go`
- `TestInitDB`: все таблицы созданы (users, messages, posts, groups, federation, push, webauthn, devices…)
- `TestSeedAdmin`: админ создаётся, повторный вызов не дублирует
- `TestCreateInviteToken`: создание, max_uses, expires_at
- `TestCreateUser`: уникальность username, хэш пароля
- Инфраструктура: `func setupTestDB() *sql.DB` — `:memory:` SQLite + `InitDB`

### 3. handlers — `backend/handlers/`

#### auth_test.go
- `TestAuthRequired`: без токена → 401, валидный → 200, просроченный → 401
- `TestAdminRequired`: обычный пользователь → 403, админ → 200
- `TestGetUserID`: извлечение userId из контекста

#### core_test.go
- `TestRegister`: успешная регистрация, дубликат username, без invite token, неверный токен
- `TestLogin`: правильный пароль, неверный пароль, несуществующий пользователь
- `TestRefresh`: валидный refresh → новые токены, просроченный → 401
- `TestGetMe`: авторизованный запрос, неавторизованный
- `TestUpdateProfile`: смена username/email, конфликт username

#### messages_test.go
- `TestGetMessages`: пустой диалог, с сообщениями, пагинация, с картинками (message_images)
- `TestSendMessage`: текстовое сообщение, с картинками (multipart), максимальное кол-во картинок (10), тип сообщения (`msg_type`)
- `TestDeleteMessage`: своё сообщение → 200, чужое → 403
- Мок WebSocket hub через интерфейс

#### posts_test.go
- `TestCreatePost`: текст, с картинками (multipart), `is_public`, без картинок
- `TestGetFeed`: собственные посты, друзей, публичные, федеративные (federation_posts)
- `TestAddComment`: текст комментария, к несуществующему посту
- `TestToggleReaction`: поставить/убрать reaction, множественные реакции

#### groups_test.go
- `TestCreateGroup`: название, список участников
- `TestGetGroupMessages`: пустая группа, с сообщениями, с картинками
- `TestSendGroupMessage`: текст, изображения, от неучастника → 403
- `TestAddMember` / `TestRemoveMember`: владелец может, не-владелец → 403
- `TestDeleteGroup`: владелец → 200, участник → 403
- `TestGroupInvite`: создание invite, join по токену, повторный join

#### admin_test.go
- `TestAdminListUsers`: пагинация, фильтр
- `TestAdminMakeAdmin` / `TestAdminRemoveAdmin`: админ может, обычный → 403
- `TestAdminListFiles`: список файлов, disk usage (мок disk_unix/disk_windows)

#### push_test.go
- `TestPushSubscribe`: валидная подписка, дубликат
- `TestPushUnsubscribe`: удаление подписки, несуществующая
- `TestGetVapidPublicKey`: возвращает ключ

#### webauthn_test.go
- `TestBeginRegistration`: создаёт опции, сохраняет session
- `TestFinishRegistration`: валидный credential, невалидный → 400
- `TestBeginLogin` / `TestFinishLogin`: полный flow
- `TestHasCredentials`: с credentials → true, без → false

#### devices_test.go
- `TestRegisterDevice`: имя + public key
- `TestListDevices` / `TestRemoveDevice`
- `TestCreateAuthRequest`: создаёт запрос для другого пользователя
- `TestApproveAuthRequest` / `TestDenyAuthRequest`
- `TestPollAuthRequest`: approved, denied, pending
- `TestKeyBackup` / `TestKeyRecover`: encrypt/decrypt на сервере
- `TestRecoveryPhrase`: generate/verify phrase

#### backup_test.go
- `TestListBackups`: пустой список, с файлами
- `TestCreateBackup`: создаёт ZIP
- `TestUploadBackup`: загрузка .zip
- `TestDeleteBackup`: удаление файла
- `TestRestoreBackup`: валидный ZIP → success, битый ZIP → error
- `TestMaintenanceMode`: маркер `.maintenance` → 503 на всех эндпоинтах
- `TestBackupSettings`: GET/PUT settings

#### federation_test.go
- `TestAddServer`: добавление сервера, дубликат URL
- `TestRemoveServer`: удаление, несуществующий → 404
- `TestPingServer`: успешный ping, недоступный сервер
- `TestBlockServer` / `TestUnblockServer`
- `TestClearServerCache`
- `TestCreateFederationInvite`

### 4. federation package — `backend/federation/`

#### transport_test.go
- `TestSend`: успешный запрос, retry при ошибке (1s→5s→15s), таймаут
- `TestSendDirect`: без retry
- `TestDownloadFile`: успешная загрузка, 404
- Mock HTTP-сервера для тестов

#### queue_test.go
- `TestEnqueue` / `TestDequeue`: FIFO
- `TestRetry`: неудачный → retry через 30s, успешный → удаляется
- `TestDrainFailedOnRecovery`: при recovery все failed досылаются

#### route_test.go
- `TestGetRoute`: прямой путь, через 1 hop, max hops (5), недостижимый узел
- `TestAddRoute` / `TestRemoveRoute`

#### health_test.go
- `TestPing`: активный сервер → success, недоступный → draining
- `TestStatusTransitions`: active → draining → active (recovery), draining → dead

#### handler_test.go
- `TestHandleIncomingMessage`: получение сообщения от федеративного сервера
- `TestHandleShareUsers`: импорт пользователей
- `TestHandleForwardPost`: загрузка + сохранение изображений
- `TestHandleGossipRelay`: relay с TTL decrement
- `TestHandlePing` / `TestHandleCacheStats`
- Два `*fiber.App` с соединением между ними

#### mediator_test.go
- `TestIsRemoteUser`: пользователь с сервера, локальный
- `TestResolveUserID`: составной ID → (serverID, userID)

### 5. backup package — `backend/backup/`

#### backup_test.go
- `TestCreateBackup`: DB + ключи + uploads в ZIP, проверка содержимого
- `TestRestoreFromZip`: распаковка всех файлов, восстановление в t.TempDir()
- `TestVaccumInto`: `VACUUM INTO` не блокирует reads
- Инфраструктура: `t.TempDir()` для всех файлов

#### config_test.go
- `TestLoadConfig`: загрузка из JSON, значения по умолчанию
- `TestSaveConfig`: сохранение, перезагрузка
- `TestValidateConfig`: неверный путь → error

#### process_test.go
- `TestFindProcess`: поиск по PID
- `TestStopProcess`: SIGTERM/taskkill
- `TestIsDocker`: проверка /.dockerenv
- `TestSendRestartSignal`: сигнал PID 1

### 6. cache package — `backend/cache/`

#### lru_cache_test.go
- `TestSetGet`: запись и чтение, обновление `accessed_at`
- `TestRemove`: удаление существующего/несуществующего
- `TestClear`: полная очистка
- `TestEviction`: превышение лимита → LRU eviction
- `TestStats`: размер, кол-во записей, per-server лимиты
- `TestUpdateCacheStats`: goroutine обновляет статистику
- Инфраструктура: `t.TempDir()` для cache-директории

### 7. Frontend services

#### theme.service.spec.ts
- `getPreferredTheme()`: matchMedia mock для light/dark/system
- `setTheme(light|dark|system)`: localStorage write, html class toggle
- Инициализация: `@media prefers-color-scheme` listener

#### notification.service.spec.ts
- `requestPermission()`: Notification.requestPermission mock
- `show()`: Notification constructor mock, silent, tag
- `playChime()`: Audio mock, reject handler
- Tab visibility: `document.hidden`, focus/blur listeners

#### auth.interceptor.spec.ts
- Запрос с `Bearer` токеном
- 401 → вызов refresh endpoint → повтор запроса
- 5xx → passthrough без logout
- Без токена → без заголовка Authorization

#### api.service.spec.ts
- `provideHttpClientTesting()` + `HttpTestingController`
- HTTP методы: login, register, refresh, profile, upload-avatar
- Messages: get, send (form-data с images), delete
- Posts: create (form-data с images), get feed, react, comment
- Groups: CRUD, invite, join, messages
- Admin: users, make-admin, files, backup endpoints, federation
- WebAuthn: begin/finish registration, login, credentials, has-credentials
- Devices: register, list, remove, auth request/approve/poll/deny, key backup/recover
- Push: subscribe, unsubscribe, vapid key
- Federation: servers, invites, ping, block, cache
- WebSocket: connect (с token), disconnect, `wsMessages$` события, reconnect (3s таймаут + token refresh), `user_online`, `user_offline`, `group_message`
- Signals: `currentUser` (set после login, clear после logout), `unreadCounts` (increment, clear), `cachedUsers` (set, get from localStorage)

#### crypto.service.spec.ts
- IndexedDB mock через `fakeIndexedDB` для idb-keyval
- `crypto.subtle` mock для ECDH P-256
- `generateDeviceKeypair()`: создаёт JWK, SPKI, deviceId
- `encryptIdentityKeyForDevice()` / `decryptIdentityKeyFromDevice()`: ECDH + AES-GCM
- `importIdentityKey()` / `exportIdentityKey()`: JWK import/export
- `hasIdentityKey()`: IndexedDB check, true/false
- `generateRecoveryPhrase()`: 12 BIP39-like слов
- `recoverFromPhrase()`: phrase → identity key

### 8. Frontend компоненты

Каждый компонент:
- `TestBed.configureTestingModule` с standalone компонентом
- mock сервисы: `ApiService`, `ThemeService`, `NotificationService`, `CryptoService`
- `provideHttpClientTesting()` + `HttpTestingController`
- `RouterTestingModule` для компонентов с навигацией

#### app.component.spec.ts
- Инициализация темы при старте
- WS reconnect (3s таймаут)
- PWA install prompt (`beforeinstallprompt` event → banner shown)
- Maintenance poll (`/api/health` → overlay)
- Update banner (SwUpdate versionUpdates)
- Device auth request (WS `device_auth_request` → `DeviceAuthComponent`)
- Unread badges (`setAppBadge()`)

#### login.component.spec.ts
- Форма: username + password → submit
- Успешный login → redirect
- Ошибка → сообщение
- `?redirect=` → returnUrl
- Biometric login button: показан если есть credentials, скрыт если нет
- localStorage username: сохранение при успешном login, автозаполнение

#### register.component.spec.ts
- Форма с invite token
- `?invite=` из URL → автозаполнение
- Успешная регистрация → redirect на login
- Ошибка: неверный токен, дубликат

#### feed.component.spec.ts
- Создание поста: текст + изображения (file input), is_public toggle, progress bar
- Лента: посты друзей, публичные, пустая лента
- Reactions: клик → toggle
- Image grid: 1/2/3/4+ layout, +N overlay
- Fullscreen viewer: open, close, prev/next

#### chat.component.spec.ts
- User list: друзья, pinned, online status, groups
- Messages: загрузка истории, send (text + images), optimistic (pending), progress bar
- Unread divider: отображается 30s
- Virtual scroll (`cdk-virtual-scroll-viewport`)
- WS: новые сообщения, group_message, online status
- Message types: text/image/sticker/gif/poll rendering
- Mobile: user list / chat toggle

#### layout.component.spec.ts
- Desktop nav: chat, feed, settings, admin link (если is_admin)
- Mobile bottom nav: те же пункты
- Unread badges на навигации
- Online status indicator
- Safe area padding

#### settings.component.spec.ts
- Профиль: username, email, save
- Аватар: file picker, preview, upload progress, success/error
- Тема: light/dark/system selector
- Пароль: смена
- WebAuthn: register credential, list, remove
- Invites: create, copy link, QR, revoke
- Friends: list, remove
- Devices: list, remove
- Update check: button → checkForUpdate()

#### admin.component.spec.ts
- 4 таба: Users, Files, Chats, Backups, Federation
- Users: таблица, make-admin/remove-admin
- Files: таблица с disk usage bar
- Chats: таблица групп, delete
- Backups: список, create, download, upload (progress), delete, restore
- Мок всех admin API

#### admin-federation.component.spec.ts
- Таблица серверов
- Add server form, remove, ping, block/unblock
- Invite creation

#### join-group.component.spec.ts / add-friend.component.spec.ts / device-auth.component.spec.ts
- Простые тесты: render с mock API, accept/reject действия

## Инструменты и раннеры

- **Backend**: `go test ./... -v -count=1` (без кеша)
- **Frontend**: `cd frontend && npm test` (запускает `ng test`)
- **Coverage**: `go test -coverprofile=coverage.out ./...` + `ng test --code-coverage`

## Порядок реализации

1. `auth/jwt_test.go` → commit
2. `database/database_test.go` → commit
3. `handlers/auth_test.go` + `core_test.go` → commit
4. `handlers/messages_test.go` + `posts_test.go` → commit
5. `handlers/groups_test.go` → commit
6. `handlers/admin_test.go` + `push_test.go` + `webauthn_test.go` + `devices_test.go` → commit
7. `handlers/backup_test.go` + `federation_test.go` → commit
8. `federation/*_test.go` → commit
9. `backup/*_test.go` → commit
10. `cache/*_test.go` → commit
11. Frontend services tests → commit
12. Frontend components tests → commit
