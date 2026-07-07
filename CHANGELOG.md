# Changelog

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
