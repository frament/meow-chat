# Changelog

## [1.2.0] — 2026-09-24

### 🚀 Features
- **Постоянные непрочитанные** — серверный `GET /api/unread`: счётчики по собеседникам и группам + время первого непрочитанного. Бейджи и разделитель «Новые сообщения» переживают push, сворачивание PWA и перезагрузку (раньше жили только в памяти вкладки). Группы получили собственные непрочитанные и отдельное read-состояние (`group_chat_members.last_read_message_id`).
- **Честный E2EE** — при успешном шифровании на сервер уходит пустой `content` (текст только в `encrypted_content`); сервер больше не хранит полный открытый текст. Если расшифровать нельзя — показывается «[Зашифрованное сообщение]». Отправка **блокируется** с инлайн-ошибкой, если у собеседника/группы нет ключа (вместо молчаливого fallback в plaintext).
- **Группировка сообщений по датам** — разделители «Сегодня»/«Вчера»/дата перед сообщениями другого дня (личные и группы, desktop/mobile).
- **Админ-страница Push** — вкладка со статусом подписок и логами доставки: серверные (`send` со статусом push-сервиса, `error`, `no_subscription`, `subscribe`, `unsubscribe`), клиентские (`subscribe`, `rotate`, `permission_denied`, …) и подтверждения из service worker (`received`, `shown`, `click`). Хранение 14 дней.
- **PWA**: постоянная кнопка установки в настройках.
- **Группы**: кнопка управления в мобильном хедере; приглашение друзей в группу прямо из меню управления.

### 🐛 Bug Fixes
- **Push self-heal** — service worker при `pushsubscriptionchange` переподписывается с текущим VAPID-ключом (раньше — без ключа → невалидная подписка). Сервер удаляет мёртвые подписки на `403` и просит клиента переподписаться; клиент сверяет отпечаток ключа и делает одноразовую чистую ротацию подписки.
- **Версия приложения** — `version.Version` был `const`, из-за чего `-X` ldflags не применялись и в UI всегда показывалась `1.1.0`. Теперь `var`, версия запекается из `git describe` (Dockerfile/compose/Makefile).
- **Плашка «Нет соединения»** больше не мигает на старте (grace-период 5 c).
- **Giphy** — не-админы больше не получают 403 от админского эндпоинта ключа; добавлен `GET /api/giphy/status`.
- **Загрузка файлов на iOS/Safari** — обход WebKit bug 319985 через in-memory копию файла.
- **История чата** — `GET /api/messages` отдаёт последние 100 (а не самые старые), новые сообщения видны в чатах >100.
- **DNS в Docker** — пин `192.168.1.1`, иначе Web Push падал с SERVFAIL.
- **Mobile**: первое сообщение больше не уезжает под верхнюю навигацию; ссылки в исходящих пузырях видимы.

### 🔧 Internal
- Удалён мёртвый `push_copies` (серверно-зашифрованные копии превью нигде не читались).
- Кастомный `ErrorHandler` логирует сообщение/стек вместо `[object Object]`.
- Расширено тестовое покрытие (backend E2EE/группы, frontend даты/блокировка отправки).

---

## [1.1.1] — 2026-07-11

### 🐛 Bug Fixes
- **iOS PWA push notifications** — полностью починен `403 Forbidden` от Apple Push.
  - VAPID keys persistence (`/data/vapid_keys.json` — не теряются при пересборке)
  - VAPID subscriber: `admin@chat.frament.netcraze.link` → `admin@gmail.com`
  - Удалён `bearerTransport` — теперь стандартный `WebPush` auth (Apple не принимал `Bearer` схему)
  - Старые push subscriptions удалены из DB для принудительной переподписки
  - Настройка email через `VAPID_CONTACT` env var (дефолт `admin@gmail.com`)
- **Notification sound** — звук уведомления через AudioContext для iOS.
- **Read receipts** — иконки прочтения терялись при переоткрытии чата.
- **GitHub version check** — скрыта от обычных пользователей, только для админов.
- **Mobile header** — логотип и текст на одной строке.
- **Friend invites** — дата в карточке заявки, иконки вместо текстовых кнопок.

### 🚀 Features
- **Real-time read receipts** — отметки о прочтении через WS broadcast.
- **VAPID contact** — настраивается через `VAPID_CONTACT` env var.

### 🧪 Testing
- **Makefile** — добавлен `test-backend` с CGO RAM limit для Intel Mac.

### 📝 Documentation
- Session docs: iOS push notifications fix.

---

## [1.1.0] — 2026-07-07

### 🚀 Features
- **Markdown rendering** — сообщения и посты рендерятся через `marked` (bold, italic, код, ссылки, таблицы, списки, блокцитаты, заголовки, зачёркивание, HR). XSS-защита через HTML-escaping перед парсингом.
- **GIF/Giphy** — поиск и тренды через Giphy API, встраивание GIF в сообщения без загрузки на сервер. Админ-панель управления API-ключом.
- **Stickers** — тип сообщения "стикер", админ-панель загрузки/удаления стикеров, чат-паста для iOS. Федеративная синхронизация паков (#15, #17).
- **Poll** — тип сообщения "опрос" с множественным выбором (#9, #10).
- **Avatar crop editor** — кадрирование аватара с pan/zoom перед загрузкой.
- **Post dialog** — модальное окно для создания постов (десктоп: модалка, мобилка: bottom sheet) (#12).
- **Reactions** — показ только использованных реакций в посте + picker (#7).
- **Friend requests** — поиск пользователей, отправка/приём/отклонение заявок (#14).
- **Read indicators** — sent/read галочки, `is_read` колонка, `mark-read` endpoint (#30).
- **Upload progress** — прогресс-бар загрузки внутри pending-сообщения (#29).
- **GitHub version check** — авто-проверка новой версии в админ-панели (#13).
- **Admin: block/delete users** — блокировка/удаление пользователей и файлов (#5, #6).
- **Admin: stickers tab** — загрузка/удаление стикеров, сайдбар-раскладка.
- **Admin: версия** — кнопка проверки обновлений, unify иконок удаления.
- **Auto-friend on register** — при регистрации по инвайту автоматически добавлять в друзья (#1).
- **Monochrome icons** — замена цветных эмодзи на SVG-иконки в UI (кроме реакций).

### 🐛 Bug Fixes
- **iOS keyboard (#21)** — 10+ итераций фикса: visualViewport + NgZone, 100dvh, fixed позиционирование, shrink-0 на input, safe-area-inset-bottom, body fixed+overflow. Централизованный KeyboardService.
- **Mobile message duplication** — пропуск своих сообщений из WS (уже обработаны оптимистично).
- **Auth race condition** — debounce параллельных refresh token запросов.
- **Group chat race** — race condition в создании сообщений группы.
- **Admin responsive** — card-based layout для мобильной админ-панели (#3).
- **Chat type menu** — редизайн с popup-меню, отключение GIF/стикеров при отсутствии (#11).
- **Post dialog mobile** — лайаут bottom sheet, убирание bottom-nav placeholder при клавиатуре.
- **GIF preview** — использование `preview_url` вместо `url` для надёжной загрузки на мобилках.
- **Test DB schema sync** — синхронизация тестовой схемы с production.
- **Admin nav buttons** — видимые hover/active состояния, левая рамка для active.
- **Nginx** — `client_max_body_size 50M` для 413 ошибок.
- **WS hardening** — ping/pong, backoff, PWA reconnect, offline UI-индикация (#18, #19).
- **Template type checks** — исправление `class.text-right` binding для Angular control flow.
- **GIF picker** — закрытие type menu при открытии пикера.

### 🧪 Testing
- **WS tests** — T1-T12 (основные сценарии), S7 rate limiting, S9 friendship check. Race-тесты, reconnection, PWA reconnect.
- **Push-copy tests** — grace reconnect, encrypted preview, empty preview (3 новых + 2 существующих).
- **MdPipe** — 17 тестов на все элементы markdown (таблицы, код, ссылки, XSS и т.д.).
- **Admin** — тесты блокировки/удаления пользователей, удаления файлов.
- **PostDialog** — тесты сброса формы, прогресс-бара, API-ошибок.
- **Spec suite cleanup** — починено 20 сломанных spec (Chat, Layout, Admin, App).

### 📝 Documentation
- Session docs для всех фич (30+ файлов).
- AI-Assisted Development секция.
- Репозиторий переименован: `my-chat` → `meow-chat`.
- LeanKG + MCP сервера для codebase навигации.

---

## [1.0.0] — 2026-06-13

Первый стабильный релиз.
