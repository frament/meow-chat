# TODO

## Открытые пункты
- _(нет — все пункты ниже закрыты)_

## Test Summary

> Счётчики — число **объявленных** тестов (`func Test*` в Go, `it(...)` в Jasmine), посчитано по исходникам. После правки счётчиков прогоны не запускались. Это единственное место, где живут числа: бейдж в `README.md` и упоминания в `ROADMAP.md` ссылаются сюда и не дублируют значения.

### Backend — 320 тестов в 38 файлах (Go)
| Файл | Тестов |
|------|--------|
| `backend/auth/jwt_test.go` | 11 |
| `backend/backup/backup_test.go` | 5 |
| `backend/backup/config_test.go` | 6 |
| `backend/backup/process_test.go` | 6 |
| `backend/cache/lru_cache_test.go` | 8 |
| `backend/database/database_test.go` | 5 |
| `backend/federation/handler_test.go` | 24 |
| `backend/federation/health_test.go` | 5 |
| `backend/federation/mediator_test.go` | 7 |
| `backend/federation/queue_test.go` | 4 |
| `backend/federation/route_test.go` | 5 |
| `backend/federation/transport_test.go` | 10 |
| `backend/handlers/admin_federation_test.go` | 2 |
| `backend/handlers/admin_test.go` | 13 |
| `backend/handlers/auth_test.go` | 10 |
| `backend/handlers/backup_test.go` | 3 |
| `backend/handlers/core_test.go` | 13 |
| `backend/handlers/decrypt_logs_test.go` | 4 |
| `backend/handlers/devices_test.go` | 17 |
| `backend/handlers/e2ee_test.go` | 10 |
| `backend/handlers/envelopes_test.go` | 1 |
| `backend/handlers/friend_requests_test.go` | 17 |
| `backend/handlers/group_key_test.go` | 5 |
| `backend/handlers/groups_test.go` | 12 |
| `backend/handlers/messages_test.go` | 8 |
| `backend/handlers/polls_test.go` | 15 |
| `backend/handlers/posts_test.go` | 10 |
| `backend/handlers/push_logs_test.go` | 7 |
| `backend/handlers/push_test.go` | 8 |
| `backend/handlers/unread_test.go` | 3 |
| `backend/handlers/update_test.go` | 7 |
| `backend/handlers/version_test.go` | 1 |
| `backend/handlers/webauthn_test.go` | 8 |
| `backend/handlers/ws_test.go` | 20 |
| **Backend total** | **320** |

### Frontend — 247 тестов в 26 файлах (Jasmine/Karma)
| Файл | Тестов |
|------|--------|
| `frontend/src/app/app.component.spec.ts` | 13 |
| `frontend/src/app/pipes/md.pipe.spec.ts` | 17 |
| `frontend/src/app/pipes/last-seen.pipe.spec.ts` | 11 |
| `frontend/src/app/services/api.service.spec.ts` | 22 |
| `frontend/src/app/services/auth.interceptor.spec.ts` | 9 |
| `frontend/src/app/services/crypto.service.spec.ts` | 9 |
| `frontend/src/app/services/keyboard.service.spec.ts` | 5 |
| `frontend/src/app/services/notice.service.spec.ts` | 8 |
| `frontend/src/app/services/notification.service.spec.ts` | 8 |
| `frontend/src/app/services/theme.service.spec.ts` | 8 |
| `frontend/src/app/components/add-friend/add-friend.component.spec.ts` | 7 |
| `frontend/src/app/components/admin/admin.component.spec.ts` | 6 |
| `frontend/src/app/components/admin-federation/admin-federation.component.spec.ts` | 3 |
| `frontend/src/app/components/chat/chat.component.spec.ts` | 19 |
| `frontend/src/app/components/chat/gif-picker/gif-picker.spec.ts` | 8 |
| `frontend/src/app/components/chat/sticker-picker/sticker-picker.spec.ts` | 9 |
| `frontend/src/app/components/device-auth/device-auth.component.spec.ts` | 12 |
| `frontend/src/app/components/feed/feed.component.spec.ts` | 4 |
| `frontend/src/app/components/join-group/join-group.component.spec.ts` | 6 |
| `frontend/src/app/components/notice/notice.component.spec.ts` | 3 |
| `frontend/src/app/components/layout/layout.component.spec.ts` | 4 |
| `frontend/src/app/components/login/login.component.spec.ts` | 7 |
| `frontend/src/app/components/post-dialog/post-dialog.component.spec.ts` | 18 |
| `frontend/src/app/components/register/register.component.spec.ts` | 8 |
| `frontend/src/app/components/settings/settings.component.spec.ts` | 15 |
| **Frontend total** | **247** |

**Итого: 567 тестов в 64 файлах.**

> Раньше в шапке стояло «262 tests across 29 files», а таблицы давали 177 и 108 с итогом 308 — цифры не сходились между собой и с исходниками. Файлы, отсутствовавшие в таблицах: `decrypt_logs`, `e2ee`, `envelopes`, `friend_requests`, `group_key`, `push_logs`, `unread`, `version` (Go), `gif-picker`, `sticker-picker`, `md.pipe`, `keyboard.service` (Frontend).

## Отменённые отметки
- ~~Chat list virtualization with `@angular/cdk`~~ — **не сделано, задача снята.** Зависимость `@angular/cdk ^20.2.14` есть в `frontend/package.json`, но в `frontend/src` нет ни одного её использования: ни `cdk-virtual-scroll-viewport`, ни `*cdkVirtualFor`. Отметка была ошибочной. Задача снята как оптимизация несуществующей проблемы: лента сообщений ограничена `LIMIT 100` на сервере, список друзей упирается в потолок инстанса (~100 пользователей). Обоснование и реальное предусловие (серверная пагинация) — в `ROADMAP.md`, v1.5.0 и Backlog. Зависимость оставлена в `package.json`.

## Done
- [x] PWA install banner dismiss tracking (localStorage) — `app.ts`: `dismissInstall()`, покрыто тестами в `app.component.spec.ts`
- [x] Avatar upload progress indicator — `settings.ts`: `uploadProgress` + `HttpEventType.UploadProgress`
- [x] Backup upload progress indicator — `admin.ts`: `backupUploadProgress`
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
- [x] **#23** Мобильная версия: панель "новый пост" перекрыта навигацией — добавлены `padding-bottom: calc(3.5rem + env(safe-area-inset-bottom))` в bottom sheet.
- [x] **#24** Каскадное удаление данных пользователя — добавлены `friend_invites`, `push_copies`, `poll_votes`, `post_reactions WHERE user_id` + удаление файлов (post/message images).
- [x] **#25** Мобильная версия: кнопка удаления поста — заменён `text-xs px-2 pb-2` на `text-sm p-2` для mobile.

## Chat UI improvements
- [x] **#26** Убрать текст "Зашифрованное сообщение" в чате
- [x] **#27** Уменьшить размер текста времени сообщения
- [x] **#28** Не отображать GIF как прикреплённый файл для отправки
- [x] **#29** Индикатор загрузки файла внутри сообщения
- [x] **#30** Добавить рядом со временем отправки индикатор отправки и прочтения сообщения

## Done
- [x] #31 Ограничить высоту миниатюр аватаров пользователей в списке друзей и чатах
- [x] #32 Редактор аватара: выбор части картинки для аватара (crop/zoom)
- [x] #33 Markdown для сообщений и постов
