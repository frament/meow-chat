# ✅ All Done — 262 tests across 29 files

## Test Summary

### Backend — 176 tests (Go, 18 files)
| Package | Tests |
|---------|-------|
| `backend/auth/jwt_test.go` | 11 |
| `backend/database/database_test.go` | 3 |
| `backend/handlers/auth_test.go` | 6 |
| `backend/handlers/core_test.go` | 9 |
| `backend/handlers/messages_test.go` | 4 |
| `backend/handlers/posts_test.go` | 6 |
| `backend/handlers/groups_test.go` | 11 |
| `backend/handlers/admin_test.go` | 13 |
| `backend/handlers/push_test.go` | 5 |
| `backend/handlers/webauthn_test.go` | 4 |
| `backend/handlers/devices_test.go` | 16 |
| `backend/handlers/backup_test.go` | 4 |
| `backend/handlers/admin_federation_test.go` | 9 |
| `backend/handlers/update_test.go` | 6 |
| `backend/backup/config_test.go` | 6 |
| `backend/backup/backup_test.go` | 5 |
| `backend/backup/process_test.go` | 5 |
| `backend/cache/lru_cache_test.go` | 8 |
| `backend/federation/*_test.go` (6 files) | 54 |
| `backend/handlers/polls_test.go` | 13 |
 | `backend/handlers/ws_test.go` | 17 |
 | **Backend total** | **200** |

### Frontend — 91 tests (17 files)
| Component/Service | Tests |
|-------------------|-------|
| `theme.service.spec.ts` | 8 |
| `notification.service.spec.ts` | 8 |
| `crypto.service.spec.ts` | 7 |
| `auth.interceptor.spec.ts` | 11 |
| `api.service.spec.ts` | 7 |
| `app.component.spec.ts` | 7 |
| `login.component.spec.ts` | 3 |
| `register.component.spec.ts` | 3 |
| `layout.component.spec.ts` | 4 |
| `feed.component.spec.ts` | 4 |
| `chat.component.spec.ts` | 14 |
| `settings.component.spec.ts` | 2 |
| `admin.component.spec.ts` | 4 |
| `device-auth.component.spec.ts` | 3 |
| `admin-federation.component.spec.ts` | 3 |
| `add-friend.component.spec.ts` | 2 |
| `join-group.component.spec.ts` | 2 |
| `post-dialog.component.spec.ts` | 18 |
 | **Frontend total** | **108** |

### Grand total: 308 tests, 0 failures ✅

## Done
- [x] Chat list virtualization with `@angular/cdk`
- [x] PWA install banner dismiss tracking (localStorage)
- [x] Avatar upload progress indicator
- [x] Backup upload progress indicator
- [x] Testing design spec written and committed
- [x] Sessions 1-7 all complete — every file in TODO.md has tests

## New TODOs (2026-06-25)
- [x] #12 Вынести публикацию поста в отдельный dialog/page ✓
- [x] #13 Создать систему обнаружения новых версий из GitHub ✓
- [x] #1 Автоматически добавлять пользователя в друзья к тому кто дал приглашение на сервер
- [x] #2 Проверить проблему обновления чата при добавлении нового пользователя: пользователь создает приглашение (через PWA) → другой принимает → оба заходят в новый чат → пользователь из PWA отправляет сообщение → второй не получает ✓
- [x] #3 Исправить внешний вид админки для mobile ✓
- [x] #4 Добавить возможность удалять свои посты (для админов — любые посты на своем сервере)
- [x] #5 В админке добавить возможность удалять/блокировать пользователей
- [x] #6 В админке добавить возможность удалять файлы
- [x] #7 В реакциях у поста показывать только использованные реакции, через + давать добавлять новые
- [x] #8 В чате реализовать отправку GIF ✓
- [x] #9 В чате сделать видимым вариант «опрос» только в групповых чатах
- [x] #10 В чатах реализовать тип сообщения «опрос»
- [x] #11 В чатах сделать меню выбора типа сообщения посимпотичнее ✓
- [x] #14 Сделать поиск по пользователям с приглашением в друзья ✓
- [x] #15 Реализовать сообщения-стикеры ✓
- [x] #16 Пройтись по спецификациям из `docs/ws-requirements.md` (S5, S7, T1–T12, O1–O5, секции 2.4, 3.2–3.4) — S5 ✓, S7 ✓, S9 ✓, T1–T12 ✓, T9a–T9c ✓, O1–O5 ✓
- [x] #17 Реализовать федерацию стикерпаков: выгрузка/загрузка/синхронизация между серверами ✓
- [x] #18 WS-Hub: исправить утечки и потенциальный panic (small scale, ~10 users)
      - **P1** — `Handler.Close()` не останавливает `graceTimers` → `AfterFunc` шлёт в закрытый канал → panic/goroutine leak ✓
      - **P1** — `graceExpired` unbuffered + `AfterFunc` → блокировка при медленном hub → утекающая горутина ✓
      - **P2** — `h.broadcast <- msg` (буфер 64) блокирует HandleWebSocket при полном канале ✓
      - **P2** — No `sync.WaitGroup` → `Close()` не дожидается завершения hub ✓
      - **P3** — `c.WriteJSON` в S5/S9: ошибки не проверяются ✓
      - **P3** — Подготовленные запросы (`db.Prepare`) для `INSERT INTO messages` и `SELECT 1 FROM friends` ✓
- [x] #19 WS-Frontend: исправить баги и улучшить типизацию (small scale)
      - **P1** — `atob` не умеет base64url → JWT с `-`/`_` кидает `InvalidCharacterError`, каждый reconnect дёргает refresh ✓
      - **P2** — `Subject` без `asObservable()` → любой может вызвать `.next()` и подделать WS-сообщение ✓
      - **P2** — `new WebSocket(url)` без try-catch → крэш при невалидном URL ✓
      - **P3** — `onerror` → `ws.close()` избыточен (onclose придёт сам) ✓
      - **P3** — `Subject<any>` → потеря типизации сообщений ✓
      - **P3** — `setAppBadge` без проверки наличия API — уже было сделано ✓

## Bugs (2026-06-28) — All fixed ✓
- [x] **#20** Ложные уведомления о новых сообщениях: фильтр типов WS-событий — только `message`/`group_message`, игнорируются `user_online`/`user_offline` и др. + игнорирование своих сообщений.
- [x] **#21** Мобильная версия: лишний отступ input при клавиатуре — переведён с `dvh` на `window.visualViewport` для точного отслеживания высоты.
- [x] **#22** iOS: двойное нажатие отправки стикера — добавлен guard `sending` + `(touchstart)` на кнопку отправки для срабатывания до скрытия клавы.
- [x] **#23** Мобильная версия: панель "новый пост" перекрыта навигацией — добавлен `padding-bottom: calc(3.5rem + env(safe-area-inset-bottom))` в bottom sheet.
- [x] **#24** Каскадное удаление данных пользователя — добавлены `friend_invites`, `push_copies`, `poll_votes`, `post_reactions WHERE user_id` + удаление файлов (post/message images).
- [x] **#25** Мобильная версия: кнопка удаления поста — заменён `text-xs px-2 pb-2` на `text-sm p-2` для mobile.

## Chat UI improvements
- [x] **#26** Убрать текст "Зашифрованное сообщение" в чате
- [x] **#27** Уменьшить размер текста времени сообщения
- [x] **#28** Не отображать GIF как прикреплённый файл для отправки
- [ ] **#29** Индикатор загрузки файла внутри сообщения
- [ ] **#30** Добавить рядом со временем отправки индикатор отправки и прочтения сообщения
