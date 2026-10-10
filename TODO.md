# TODO

## Открытые пункты
- _(нет — все пункты ниже закрыты)_

Замечания, которые **не** исправлены и ждут своей очереди, разложены по вехам
`ROADMAP.md`: `reloadOpenGroup`/`reloadOpenThread` → **v1.9.0** (раунд 3),
мёртвое поле `e2eeReady` → **v1.5.2**, а повод, по которому вообще понадобилось
`cryptoReady()`, разобран в #36 выше. Бэклог пересчитан 2026-10-10: восемь его
пунктов к тому моменту уже были исправлены кодом.

## Bugs (2026-10-09) — все исправлены ✓

Заведены после ручного прогона: стикеры, групповой чат, push. Причина каждого
установлена чтением кода, исправления внесены, тесты ловят откат каждой правки
(проверено мутационно — см. «Тесты» ниже).

- [x] **#34** Стикерпаки пропадали при повторном входе в админку.
      `stickerPacks` жил только в памяти компонента, а `ngOnInit`
      (`admin.ts:1145`) грузил `users`/`files`/`giphy`/`version` — не стикеры.
      В десктопном сайдбаре кнопка вызывала `loadStickers()` сама
      (`admin.ts:66`), поэтому там баг не был виден; на мобильном вкладка
      переключалась через `onTabChange()` (`admin.ts:1101`), который дёргал
      загрузку только для `push` и `decrypt`. Итог: вернулся в админку → выбрал
      «Стикеры» → `stickerPacks.length === 0` → «Нет стикерпаков. Создайте
      первый», хотя база полна. Данные не терялись, терялась только загрузка.
      **Исправлено:** одна точка входа `selectTab()` (`admin.ts`), через которую
      идут и кнопки сайдбара, и мобильный `<select>`; вкладка сама решает, что
      грузить, поэтому новый способ открытия уже не может «забыть». Заодно
      `<select>` отражает текущую вкладку (`[value]="activeTab"`). Тем же были
      сломаны «Чаты», «Бэкапы» и «Федерация» на мобильном.

- [x] **#35** Отправителю не показывался его собственный стикер.
      Оптимистичное сообщение (`chat.ts:1918` для группы, `chat.ts:1967` для
      лички) клало в `content` id стикера, но **не** клало `sticker_url`, а
      шаблон рисует именно `sticker_url` (`chat.ts:222`, `chat.ts:572`).
      `finalizeOptimistic` (`chat.ts:2034`) подставлял только `id` и `images`,
      `sticker_url` из ответа сервера не переносил — а сервер его и не
      возвращал: `resp` в `groups.go:709` и `handlers.go:1377` содержал только
      `id`/`message`/`images`/`poll`. Свой кадр WS отправлятель отбрасывал
      (`chat.ts:1299`, `chat.ts:1254`). Итог: у автора пустой бакет, у остальных
      стикер есть; после перезагрузки страницы появлялся.
      **Исправлено:** сервер отдаёт `sticker_url` в ответе на отправку (оба
      пути), `finalizeOptimistic` его переносит, а оптимистичный бакет берёт URL
      прямо из пикера (`pendingStickerURL`) — стикер виден мгновенно, не дожидаясь
      ответа. `Message` в `api.service.ts` теперь знает про `sticker_url`
      (раньше шаблон доставал его через `$any`).

- [x] **#36** После авторизации новые сообщения в общем чате приходили
      «зашифрованными».
      Гонка с флагом `e2eeReady` (`chat.ts:1209`): он ставился в
      `this.crypto.init().then(...)` (`chat.ts:1214`), а не `await`-ом, и весь
      путь расшифровки проверял его **до** попытки. `decryptGroupMsg`
      (`chat.ts:2412`) при `e2eeReady === false` вообще не расшифровывал и
      оставлял `content` пустым; WS-ветка (`chat.ts:1303`) подставляла
      `[Зашифрованное сообщение]`. Повторной расшифровки не происходило:
      `onGroupKeyReady` (`chat.ts:2372`) перечитывает историю только если дойдёт
      `group_key_ready`, а `reloadOpenThread` (`chat.ts:1434`) для групп выходит
      сразу.
      **Исправлено:** флаг заменён на `cryptoReady()` — ожидание, а не проверка;
      `init()` идемпотентен, так что ждать дёшево. Все потребители
      (`decryptGroupMsg`, WS-ветки DM и групп, `selectGroup`, `rotateGroupKeys`,
      `distributeGroupKeyToMember`, `createGroup`) ждут его вместо ветвления.
      Попутно вскрылось то же самое в `createGroup`: группа, созданная в первые
      мгновения после входа, оставалась **вообще без ключа** — её не мог
      расшифровать никто, включая автора.

- [x] **#37** В группах push приходил и отправителю.
      `broadcastGroup` (`handlers.go:495`) обходил всех участников, включая
      `msg.from`, и слал push каждому, кому WS-доставка не удалась. У отправителя
      соединение есть, но: несколько вкладок, обрыв и мгновенный реконнект, или
      ошибка записи в его сокет (`handlers.go:501`) — и `delivered` оставался
      `false`. Для личных чатов это уже было сделано правильно (`handlers.go:431`:
      `delivered` ставится только при `uid == msg.to`), для групп — нет.
      **Исправлено:** `if memberID == msg.from { continue }` в
      `handlers.go:495`, симметрично личным чатам.

- [x] **#38** В группах сообщение иногда не появлялось в чате, хотя push пришёл.
      Push приходит ровно тогда, когда WS-доставка не удалась (см. #37), то есть
      клиент **не** получил кадр вообще — а значит, не получил его и через
      `wsMessages$`, и в `this.messages` сообщение не попадало. Восстановления не
      было: `reloadOpenThread` для групп выходил сразу (`chat.ts:1436`),
      `visibilitychange` тоже только для личных чатов (`chat.ts:1386`),
      `retryLoadMessages` (`chat.ts:1698`) работал лишь с `selectedUser`.
      Восстановление было только в полной перезагрузке или перевыборе чата.
      **Исправлено:** `reloadOpenGroup()` — групповой аналог `reloadOpenThread`,
      со слиянием, а не заменой (оптимистичные сообщения должны пережить
      перечитку). Подключена к reconnect-эффекту, к `visibilitychange` (теперь
      для обоих типов чатов) и к кнопке «повторить».

### Тесты

- `backend/handlers/bugs_2026_10_09_test.go` — 4 теста (#35 ×2, #37, плюс
  «текстовое сообщение не получает `sticker_url`»).
- `frontend/.../chat.bugs-2026-10-09.spec.ts` — 13 тестов (#35 ×4, #36 ×4, #38 ×5).
- `frontend/.../admin.bugs-2026-10-09.spec.ts` — 6 тестов (#34).
- `admin.component.spec.ts` — +4 теста на `selectTab` через мобильный `<select>`.

Мутационная проверка (откат правки → тест обязан покраснеть) проведена для всех
пяти: `case 'stickers': break;` в `selectTab`; откат `reloadOpenThread` на выход
для групп; откат `cryptoReady()` на проверку флага — отдельно в WS-ветке и в
`decryptGroupMsg`; снятие `sticker_url` из оптимистичного бакета; снятие
`memberID == msg.from` в Go.

Первый прогон выявил два фиктивных теста, оба исправлены. Тест на #38
моделировал первый коннект вместо реконнекта, поэтому эффект не срабатывал. А
мок `crypto.init()` в #36 резолвил гейт при первом вызове — то есть на первом
же `ngOnInit`, задолго до прихода сообщения, — и гонку disarm-ил; тесты проходили
и на неисправленном коде. После исправления мока (`init()` возвращает тот же
pending-промис, как настоящий сервис) откат ловится, но пришлось добавить
отдельный тест на `reloadOpenGroup` как вызывающий `decryptGroupMsg`: путь через
`selectGroup` ждёт `cryptoReady()` заранее и замаскировал бы откат.

## Интерфейс стикерпаков (2026-10-09)

- [x] **Переименование пака.** Эндпоинт `PUT /api/admin/sticker-packs/:id` и
      метод `api.adminRenameStickerPack` существовали с самого запуска стикеров —
      вызова из интерфейса не было ни одного. Добавлена кнопка «Переименовать» и
      в десктопной, и в мобильной вкладке: поле с предзаполненным именем,
      Enter — сохранить, Escape — отмена, фокус в поле сразу.
      Черновик сбрасывается при каждой перезагрузке списка (`loadStickers`), иначе
      недописанное имя всплыло бы в следующем паке. Сервер теперь триммит имя:
      проверка `req.Name == ""` пропускала имя из одних пробелов, и пак назывался
      `"   "` — в списке это выглядит как «пак потерялся». То же поправлено в
      создании пака.
- [x] **Добавление стикеров iPhone.** Отдельного формата «стикер iPhone» нет:
      это APNG (или GIF/PNG), и покидает клавиатуру стикеров только перетаскиванием
      или копированием — через выбор файла он не достаётся в принципе. Поэтому
      добавлены два входа, которых не покрывает `<input type="file">`: drop на
      зону пака и вставка из буфера. Зона кликабельна и фокусируема, вставка
      ловится на `document` (HostListener) — на iPhone два пальца попадают в
      страницу, а не в `div`, поэтому целью вставки назначается последняя
      «взведённая» зона.
      На сервере `.apng` добавлен в список допустимых и **переименовывается в
      `.png` при сохранении**: Go отдаёт для него `image/apng`, который не
      понимает ни один браузер, и `<img>` показал бы пустоту. APNG — валидный PNG,
      браузеры анимируют лишние чанки сами, так что переименование ничего не
      теряет. Ограничение 5 МБ и прочие форматы не тронуты.

### Тесты

- `backend/handlers/sticker_pack_ui_test.go` — 4 теста: переименование (в том
  числе отказ на пустом имени), отказ не-админу, приём APNG с проверкой
  расширения в ответе, и что список допустимых форматов не превратился в «прими
  что угодно».
- `admin.bugs-2026-10-09.spec.ts` — +13 тестов: 6 на переименование, 7 на
  drop/paste.

Попутно вскрылось то, что `BACKLOG.md` описывает как «таблица маршрутов дублируется»:
в `handlers_test_setup.go` **не было ни одного маршрута стикеров** — все шесть
существуют в `main.go` и отсутствуют в harness. И `uploads/stickers` в фикстуре
не создавался (только `uploads/messages`), из-за чего первая загрузка стикера в
тесте падала в 500 на `c.SaveFile`, хотя в проде каталог есть. Обе правки внесены
в том же духе, что и предыдущая — «схема уже из одного источника», теперь и
каталоги, и маршруты стикеров не расходятся.

Мутационная проверка проведена: откат обработчика вставки, откат переименования в
`.png` и откат тримминга имени — каждый даёт красный тест.

## Test Summary

> Счётчики — число **объявленных** тестов (`func Test*` в Go, `it(...)` в Jasmine), посчитано по исходникам. После правки счётчиков прогоны не запускались. Это единственное место, где живут числа: бейдж в `README.md` и упоминания в `ROADMAP.md` ссылаются сюда и не дублируют значения.

### Backend — 339 тестов в 41 файлах (Go)
| Файл | Тестов |
|------|--------|
| `backend/auth/jwt_secret_test.go` | 3 |
| `backend/auth/jwt_test.go` | 11 |
| `backend/backup/backup_test.go` | 5 |
| `backend/backup/config_test.go` | 6 |
| `backend/backup/process_test.go` | 6 |
| `backend/cache/lru_cache_test.go` | 8 |
| `backend/database/database_test.go` | 5 |
| `backend/federation/handler_test.go` | 25 |
| `backend/federation/health_test.go` | 5 |
| `backend/federation/mediator_test.go` | 7 |
| `backend/federation/queue_test.go` | 4 |
| `backend/federation/route_test.go` | 5 |
| `backend/federation/transport_test.go` | 10 |
| `backend/handlers/admin_federation_test.go` | 2 |
| `backend/handlers/admin_test.go` | 13 |
| `backend/handlers/auth_test.go` | 10 |
| `backend/handlers/backup_test.go` | 3 |
| `backend/handlers/bugs_2026_10_09_test.go` | 4 |
| `backend/handlers/core_test.go` | 13 |
| `backend/handlers/decrypt_logs_test.go` | 4 |
| `backend/handlers/devices_test.go` | 17 |
| `backend/handlers/e2ee_test.go` | 10 |
| `backend/handlers/envelopes_test.go` | 1 |
| `backend/handlers/friend_requests_test.go` | 17 |
| `backend/handlers/group_key_test.go` | 5 |
| `backend/handlers/groups_test.go` | 12 |
| `backend/handlers/images_test.go` | 2 |
| `backend/handlers/messages_test.go` | 8 |
| `backend/handlers/polls_test.go` | 15 |
| `backend/handlers/posts_test.go` | 10 |
| `backend/handlers/push_logs_test.go` | 11 |
| `backend/handlers/push_test.go` | 8 |
| `backend/handlers/sticker_pack_ui_test.go` | 4 |
| `backend/handlers/unread_test.go` | 3 |
| `backend/handlers/update_test.go` | 7 |
| `backend/handlers/version_test.go` | 1 |
| `backend/handlers/webauthn_test.go` | 8 |
| `backend/handlers/ws_test.go` | 24 |
| `backend/imageproc/imageproc_test.go` | 7 |
| `backend/imageproc/orientation_test.go` | 7 |
| `backend/imageproc/store_test.go` | 13 |
| **Backend total** | **339** |

### Frontend — 381 тестов в 35 файлах (Jasmine/Karma)
| Файл | Тестов |
|------|--------|
| `frontend/src/app/app.component.spec.ts` | 29 |
| `frontend/src/app/components/add-friend/add-friend.component.spec.ts` | 7 |
| `frontend/src/app/components/admin-federation/admin-federation.component.spec.ts` | 3 |
| `frontend/src/app/components/admin/admin.bugs-2026-10-09.spec.ts` | 20 |
| `frontend/src/app/components/admin/admin.component.spec.ts` | 9 |
| `frontend/src/app/components/chat/chat.bugs-2026-10-09.spec.ts` | 12 |
| `frontend/src/app/components/chat/chat.component.spec.ts` | 26 |
| `frontend/src/app/components/chat/chat.composer.spec.ts` | 11 |
| `frontend/src/app/components/chat/chat.dedup.spec.ts` | 7 |
| `frontend/src/app/components/chat/chat.sticky-scroll.spec.ts` | 6 |
| `frontend/src/app/components/chat/gif-picker/gif-picker.spec.ts` | 8 |
| `frontend/src/app/components/chat/sticker-picker/sticker-picker.spec.ts` | 9 |
| `frontend/src/app/components/device-auth/device-auth.component.spec.ts` | 12 |
| `frontend/src/app/components/feed/feed.component.spec.ts` | 4 |
| `frontend/src/app/components/join-group/join-group.component.spec.ts` | 6 |
| `frontend/src/app/components/layout/layout.component.spec.ts` | 4 |
| `frontend/src/app/components/login/login.component.spec.ts` | 14 |
| `frontend/src/app/components/notice/notice.component.spec.ts` | 3 |
| `frontend/src/app/components/post-dialog/post-dialog.component.spec.ts` | 18 |
| `frontend/src/app/components/register/register.component.spec.ts` | 10 |
| `frontend/src/app/components/settings/settings.component.spec.ts` | 15 |
| `frontend/src/app/pipes/last-seen.pipe.spec.ts` | 13 |
| `frontend/src/app/pipes/md.pipe.spec.ts` | 17 |
| `frontend/src/app/services/api.service.spec.ts` | 33 |
| `frontend/src/app/services/auth.interceptor.spec.ts` | 9 |
| `frontend/src/app/services/clock.service.spec.ts` | 4 |
| `frontend/src/app/services/concurrency.interceptor.spec.ts` | 12 |
| `frontend/src/app/services/connectivity.interceptor.spec.ts` | 7 |
| `frontend/src/app/services/crypto.service.spec.ts` | 9 |
| `frontend/src/app/services/key-recovery.spec.ts` | 3 |
| `frontend/src/app/services/keyboard.service.spec.ts` | 6 |
| `frontend/src/app/services/notice.service.spec.ts` | 8 |
| `frontend/src/app/services/notification.service.spec.ts` | 8 |
| `frontend/src/app/services/theme.service.spec.ts` | 8 |
| `frontend/src/app/services/timeout.interceptor.spec.ts` | 11 |
| **Frontend total** | **381** |

**Итого: 720 тестов в 76 файлах.**

> Таблицы пересобраны из исходников 2026-10-09: до этого они перечисляли 35 из 40 Go-файлов и 27 из 35 frontend-файлов, а заголовки и итоги не сходились с суммой строк.
>
> Frontend: объявлено 381, выполняется 380 — один тест помечен Jasmine как skipped. Это было и до правок 2026-10-09 (проверено на чистом дереве через `git stash`: 345 объявлено, 344 выполняется), то есть расхождение не принесено этой работой. Кто именно пропускается — не установлено, `xit`/`fdescribe` в `src` нет.

## Отменённые отметки
- ~~Chat list virtualization with `@angular/cdk`~~ — **не сделано, задача снята.** Зависимость `@angular/cdk ^20.2.14` есть в `frontend/package.json`, но в `frontend/src` нет ни одного её использования: ни `cdk-virtual-scroll-viewport`, ни `*cdkVirtualFor`. Отметка была ошибочной. Задача снята как оптимизация несуществующей проблемы: лента сообщений ограничена `LIMIT 100` на сервере, список друзей упирается в потолок инстанса (~100 пользователей). Обоснование и реальное предусловие (серверная пагинация) — в `ROADMAP.md`, веха v1.5.0, и `BACKLOG.md`. Зависимость оставлена в `package.json`.

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
