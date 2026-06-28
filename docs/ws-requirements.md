# WebSocket Subsystem: Requirements & Specification

> Ядро приложения. Любое нарушение этих требований считается критическим багом.

---

## 1. Архитектура

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Angular     │◄───►│  Fiber (Go)      │     │  SQLite      │
│  (Браузер)   │ WS  │                  │────►│              │
│              │     │  Hub (in-memory) │     │              │
│  Tab 1 ──────┤     │                  │     │  push_copies │
│  Tab 2 ──────┤     │  broadcast chan  │     │  (7-day TTL) │
│  Tab N ──────┤     │  broadcastGroup  │     └──────────────┘
└─────────────┘     │  broadcastAll     │
                    │  broadcastToUser  │     ┌──────────────┐
                    │  onlineUsers map  │     │  Web Push    │
                    │  graceTimers map  │────►│  (Fallback)  │
                    └──────────────────┘     └──────────────┘
```

### 1.1 Компоненты

| Компонент | Роль |
|-----------|------|
| **Hub** | Центральный goroutine-диспетчер. Все операции с `clients map` — только из него. |
| **HandleWebSocket** | Per-connection goroutine. Читает входящие сообщения, поддерживает ping/pong. |
| **REST handlers** | `SendMessage`, `SendGroupMessage` и др. сохраняют в БД, затем шлют в каналы hub. |
| **broadcastToUser** | Канал для точечной отправки произвольных payload конкретному user_id. |
| **Angular Service** | `ApiService` — единственный владелец `WebSocket`. Поднимает, роутит сообщения, переподключается. |

---

## 2. Требования к надёжности (Reliability)

### 2.1 Доставка сообщений

- [x] **R1**: Сообщение, отправленное через REST, должно появиться у отправителя (текущая вкладка) **немедленно** (optimistic render).
- [x] **R2**: Сообщение должно быть подтверждено: optimistic pending → server ID.
- [x] **R3**: Если optimistic render не сработал (race condition), WS-echo от бэкенда гарантирует доставку.
- [x] **R4**: Гарантированная dedup-защита: одинаковые `messageID` не создают дубликатов ни для DM, ни для group.
- [x] **R5**: При disconnect → reconnect все WS-сообщения, отправленные бэкендом во время разрыва, ТЕРЯЮТСЯ (WS не гарантирует persistence). Компенсация: REST API для загрузки истории (`GET /messages`, `GET /group-chat-messages`).

### 2.2 Состояние соединения

- [x] **R6**: `ApiService.wsConnected` signal — единственный source of truth о состоянии WS.
- [x] **R7**: `onclose` → `wsConnected = false` + `scheduleReconnect()`.
- [x] **R8**: `onopen` → `wsConnected = true` + `wsRetryCount = 0`.
- [x] **R9**: Любой вызов `connectWebSocket()` при `wsConnecting = true` — не создаёт новый сокет.

### 2.3 Reconnection

- [x] **R10**: Exponential backoff: 1s → 2s → 4s → 8s → 16s → max 30s + случайный jitter 0–1000ms.
- [x] **R11**: Первые 20 попыток — exponential backoff (суммарно ~8 минут). Затем slow-poll: попытка reconnect каждые 60s.
- [x] **R11b (PWA)**: При возврате пользователя в приложение (`visibilitychange` → `visible`) счётчик retry сбрасывается и WS переподключается немедленно. Это единственный корректный механизм для PWA (standalone), где нет кнопки обновления страницы.
- [x] **R12**: При 401 (expired JWT) — авто-refresh токена через `POST /refresh`. При неудаче — `logout()`.
- [x] **R13**: `disconnectWebSocket()` отменяет таймер переподключения и сбрасывает `wsConnected`.

### 2.3a PWA (Standalone) специфика

- [x] **PWA1**: `scheduleReconnect` НИКОГДА не прекращает reconnect полностью — после 20 быстрых попыток переходит в slow-poll (60s).
- [x] **PWA2**: `visibilitychange` → `visible` сбрасывает `wsRetryCount` в 0 и инициирует немедленный reconnect. Перекрывает slow-poll.
- [x] **PWA3**: `disconnectWebSocket` (при logout) отключает WS и убирает `wsConnected` signal, но `visibilitychange` listener остаётся активным на `document` (т.к. ApiService — singleton). При повторном логине reconnect работает.
- [x] **PWA4**: UI-компоненты подписываются на `wsConnected` signal для отображения bottom-баннера "Нет соединения" с кнопкой "Подключиться". Реализовано: `app.ts`, нижний баннер.
- [x] **PWA5**: Pull-to-refresh жест на мобильных: при свайпе вниз от верхнего края (только при `scrollY === 0` и `!wsConnected()`) отображается индикатор "Потяните для подключения". На 80px срабатывает `api.retryConnection()`. Реализовано: `app.ts`, touch-обработчики.
- [x] **PWA6**: Кнопка "✕" в offline-баннере скрывает баннер на время сессии (`offlineDismissed`). Ручной reconnect всё ещё доступен через pull-to-refresh.

### 2.4 Multi-tab

- [x] **R14**: Сообщение, отправленное из Tab A, появляется в Tab B (того же пользователя) через WS-echo.
- [x] **R15**: WS-echo для отправителя не создаёт дубликата в Tab A (dedup по `messageID`).
- [ ] **Не реализовано**: При восстановлении соединения Tab B после разрыва не получит сообщения, отправленные из Tab A во время разрыва. Решение: REST-загрузка истории при фокусе вкладки.

---

## 3. Требования к безопасности (Security)

### 3.1 Аутентификация

- [x] **S1**: Единственный способ аутентификации WS — JWT access token в query-параметре `?token=`.
- [x] **S2**: Токен валидируется на каждом подключении в middleware `main.go:131-144`.
- [x] **S3**: WS endpoint (`/api/ws`) зарегистрирован ДО `api.Use(handlers.AuthRequired)`.
- [x] **S4**: При экспайре токена WS-соединение закрывается браузером. reconnect с новым токеном после `refreshToken`.

### 3.2 Авторизация

- [ ] **S5: НЕ РЕАЛИЗОВАНО**: Сервер ДОЛЖЕН проверять, что `msg.from` в WS-сообщениях (HandleWebSocket, `ReadJSON`) соответствует `userId` из JWT. Злоумышленник может отправить `{"to": 2, "content": "spam"}` от имени любого user_id.
- [x] **S6**: REST-хендлеры используют `c.Locals("userId")` — безопасно.
- [ ] **S7: НЕ РЕАЛИЗОВАНО**: Rate limiting на WS-сообщения — ограничение количества сообщений в секунду на user/connection.

### 3.3 Интегритет данных

- [x] **S8**: WS-сообщения не сохраняются в БД напрямую из hub — только через REST (кроме WS-входящих, которые пишет `HandleWebSocket`).
- [ ] **S9: ЧАСТИЧНО**: WS-входящие сообщения (`ReadJSON` → `INSERT INTO messages`) проходят ТОЛЬКО валидацию полей (to, content), НО не проверяют friendship. См. S5.

### 3.4 Push-уведомления (условия)

- [ ] **S10: НЕ РЕАЛИЗОВАНО**: Push-copies должны шифроваться серверным ключом (сейчас используется `database.ServerEncrypt()` — проверено).
- [x] **S11**: Push-copies имеют TTL 7 дней, очищаются по крону каждый час.
- [x] **S12**: Push-copies удаляются при успешной WS-доставке (`DELETE FROM push_copies WHERE message_id = ?`).

---

## 4. Требования к производительности (Performance)

### 4.1 Hub

- [x] **P1**: Все каналы буферизованы (`broadcast: 64`, `broadcastGroup: 64`, `broadcastToUser: 64`, `broadcastAll: 16`).
- [x] **P2**: `WriteJSON` имеет write deadline 10s — медленный/отвалившийся клиент не блокирует хаб.
- [x] **P3**: `SetReadLimit(65536)` — лимит на размер входящего WS-сообщения.
- [x] **P4**: `SetReadDeadline(60s)` — при простоте дольше 60с без pong — соединение закрывается.

### 4.2 Ping/Pong

- [x] **P5**: Сервер шлёт PingMessage каждые 25с.
- [x] **P6**: Клиент (браузер) автоматически отвечает PongMessage.
- [x] **P7**: Если пинг не прошёл за 5с (write deadline), соединение закрывается.
- [x] **P8**: Если pong не пришёл за 60с (read deadline), соединение закрывается.

### 4.3 Online status

- [x] **P9**: 30-секундный grace period при отключении — reconnect отменяет таймер.
- [x] **P10**: `user_online` / `user_offline` шлются ВСЕМ подключённым клиентам (broadcastAll).
- [ ] **P11: НЕ РЕАЛИЗОВАНО**: При >1000 одновременных клиентов broadcast online-status на каждое подключение/отключение создаёт O(N²) трафика. Нужна оптимизация (debounce, incremental state).

---

## 5. Маршрутизация сообщений (Message Routing)

### 5.1 Все WS-типы

| Тип | Откуда | Куда (backend) | Куда (frontend) | Статус |
|-----|--------|----------------|-----------------|--------|
| `message` | REST `/messages`, WS `HandleWebSocket` | `broadcast` → sender + recipient | `wsMessages$` → `app.ts`, `chat.ts` | ✅ |
| `group_message` | REST `/group-chat-messages` | `broadcastGroup` → all members | `wsMessages$` → `app.ts`, `chat.ts` | ✅ |
| `user_online` | Hub register | `clients` range → all | `wsOnlineEvent` → `chat.ts` | ✅ |
| `user_offline` | Hub graceExpired | `clients` range → all | `wsOnlineEvent` → `chat.ts` | ✅ |
| `poll_update` | REST `/polls/:id/vote` | `broadcastToUser` → participants | `wsMessages$` → `chat.ts` | ✅ |
| `group_joined` | REST group add/join | `broadcastToUser` → target user | `wsMessages$` → `chat.ts` | ✅ |
| `device_auth_request` | Device auth flow | `broadcastToUser` → target user | `wsMessages$` → `app.ts` → `DeviceAuthComponent` | ✅ |
| `device_approved` | Device auth approve | `broadcastToUser` → target user | `wsMessages$` (not consumed) | ⚠️ Принят, но не обрабатывается |

### 5.2 Правила маршрутизации

- [x] **M1**: `api.service.ts` — единственный источник WS-событий. Компоненты НЕ создают WebSocket напрямую.
- [x] **M2**: WS-сообщения проходят через `wsMessages$` Subject. Исключение: `user_online`/`user_offline` дополнительно дублируются в `wsOnlineEvent` для удобства.
- [x] **M3**: Любой новый WS-тип, добавленный на бэкенде, автоматически приходит на фронтенд (catch-all routing). Не нужно править `api.service.ts`.

---

## 6. Обработка ошибок (Error Handling)

### 6.1 При reconnect-цикле

| Сценарий | Реакция |
|----------|---------|
| Сеть временно пропала | Exponential backoff, reconnect после восстановления |
| Сервер перезагрузился | WS close → reconnect → новый JWT если нужно → все подписки живы |
| Токен протух | `refreshToken()` → новый токен → reconnect |
| Refresh token протух | `logout()` → пользователь перенаправлен на логин |
| 20 быстрых попыток (первые ~8 минут) | Переход в slow-poll режим — reconnect каждые 60s |
| Slow-poll (после 20 попыток) | Продолжается бесконечно. При `visibilitychange` → `visible` retryCount сбрасывается, reconnect немедленно |
| Пользователь вернулся в PWA (visibility → visible) | `resetRetryState()` → `retryConnection()`: retryCount = 0, отмена таймера, немедленный reconnect |
| Пользователь нажал "Подключиться" в offline-баннере | `api.retryConnection()`: сброс retryCount, немедленный reconnect |
| Пользователь сделал pull-to-refresh (мобильные, disconnected) | `api.retryConnection()` при dy >= 80px |

### 6.2 В хабе

| Сценарий | Реакция |
|----------|---------|
| WriteJSON error (клиент отвалился) | `conn.Close()`, `delete(h.clients, conn)` |
| Write deadline exceeded | `WriteJSON` возвращает ошибку → как выше |
| Ping write error | `conn.Close()` → `ReadJSON` в handleWebSocket вернёт ошибку → unregister |
| Read deadline exceeded (pong не пришёл) | `ReadJSON` возвращает ошибку → unregister |
| ReadJSON error (клиент прислал битый JSON) | `ReadJSON` возвращает ошибку → unregister |
| Канал переполнен | `select` с `default` — `log.Println("channel full, dropping message")` (только `broadcastToUser`) |

---

## 7. Тестирование (Testing)

### 7.1 Блоки

- [ ] **T1**: WS handshake с валидным/невалидным/протухшим JWT.
- [ ] **T2**: Отправка сообщения через WS → проверка `messages` таблицы.
- [ ] **T3**: Ping/pong — сервер закрывает соединение при отсутствии pong.
- [ ] **T4**: Grace period — reconnect в течение 30с не меняет `is_online`.
- [ ] **T5**: Push-copies создаются при offline-получателе и удаляются при WS-доставке.

### 7.2 Интеграционные

- [x] **T6**: Сообщение, отправленное из вкладки A, появляется во вкладке B (через WS).
- [x] **T7**: При race между `getMessages` и `sendMessage` сообщение не теряется.
- [x] **T8**: После reconnect все подписки продолжают работать (нет zombie-обработчиков).
- [x] **T9**: Multi-tab: отправка из одной вкладки не создаёт дубликатов в другой.
- [x] **T9a (PWA)**: После 20 неудачных reconnect → slow-poll 60s.
- [x] **T9b (PWA)**: `visibilitychange` → `visible` сбрасывает retryCount и инициирует reconnect.
- [x] **T9c (PWA)**: При logout reconnect не происходит (даже при `visibilitychange`).

### 7.3 Нагрузочные

- [ ] **T10**: 100 одновременных WS-клиентов — нет паники, блокировки или утечки горутин.
- [ ] **T11**: 1000 сообщений в минуту через WS — нет потери сообщений, нет задержки >500ms.
- [ ] **T12**: Отключение 50 клиентов одновременно — grace period работает, `user_offline` не шлётся, пока не истекут таймеры.

---

## 8. Мониторинг (Observability)

- [x] **O1**: Метрика `ws_connections_total` — количество активных соединений.
- [x] **O2**: Метрика `ws_messages_sent_total` по типу (message, group_message, poll_update...).
- [x] **O3**: Метрика `ws_write_errors_total` — количество ошибок записи.
- [x] **O4**: Лог при: подключении, отключении, ошибке записи, создании push-copy, превышении лимитов.
- [x] **O5**: `GET /health` НЕ проверяет WS — healthcheck WS отдельный (`GET /api/ws-health`).

---

## 9. Future Work

### 9.1 WS Scaling

- [ ] **F1**: Для горизонтального масштабирования hub нужно заменить на pub/sub (Redis/NATS). `onlineUsers`, `graceTimers` — в redis.
- [ ] **F2**: При scaling graceful shutdown hub — drain существующих соединений (close with close frame, wait, force close).

### 9.2 E2E Encryption

- [x] **F3**: WS-сообщения уже поддерживают `encrypted_content`/`encrypted_iv`. Требование: сервер НИКОГДА не хранит незашифрованный E2E-контент (кроме push_preview для пушей). ✅
- [ ] **F4**: Push-copies не должны содержать расшифровываемый контент — сейчас push_preview хранится в `server_encrypted_content`, что приемлемо.

### 9.3 Message History

- [ ] **F5**: WS не гарантирует delivery offline-сообщений. Нужна очередь с ack (наподобие STOMP) или fallback на REST + last message ID sync.

### 9.4 Auth Hardening

- [ ] **S5 (repeated)**: Проверять соответствие `msg.from` и `userId` в `HandleWebSocket`.
- [ ] **S7 (repeated)**: Rate limiting на WS: `max 10 messages/sec per connection`, при превышении — close.
