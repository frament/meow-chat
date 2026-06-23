# Админка: блокировка/удаление пользователей и удаление файлов

## Что сделано

### #5 — Удаление/блокировка пользователей в админке
- **Бэкенд**:
  - `backend/database/database.go`: авто-миграция колонки `is_banned` в таблицу `users`
  - `backend/handlers/handlers.go`:
    - `AdminBlockUser` — устанавливает `is_banned = 1`
    - `AdminUnblockUser` — устанавливает `is_banned = 0`
    - `AdminDeleteUser` — удаляет пользователя и все связанные данные (сообщения, посты, друзей, группы, устройства, WebAuthn, ключи, подписки) в транзакции
    - `Login` — проверяет `is_banned`, возвращает 403 если заблокирован
    - `AdminListUsers` — теперь возвращает `is_banned`
  - `backend/main.go`: новые роуты `POST /admin/users/:id/block`, `POST /admin/users/:id/unblock`, `DELETE /admin/users/:id`
- **Фронтенд**:
  - `api.service.ts`: новые методы `adminBlockUser`, `adminUnblockUser`, `adminDeleteUser`, `adminDeleteFile`
  - `admin.ts`: в таблице пользователей:
    - Убрана колонка "Админ" (статус перенесён на аватарку и иконку-щит)
    - Текстовые кнопки заменены на иконки: 🛡️ (щит), 🚫/🔓 (бан/разбан), 🗑️ (удалить)

### #6 — Удаление файлов в админке
- **Бэкенд**: `AdminDeleteFile` с валидацией пути (только внутри `./uploads/`), роут `DELETE /admin/files`
- **Фронтенд**: кнопка с иконкой корзины в таблице файлов

### #7 — Реакции: показывать только использованные
- `frontend/feed.ts`: вместо всех 7 эмодзи под каждым постом теперь показываются только те, у которых `count > 0`
- Добавлена кнопка "+" — открывает picker с оставшимися эмодзи, закрывается при клике вне или выборе

## Файлы
- `backend/database/database.go` — +4 строки миграция `is_banned`
- `backend/handlers/handlers.go` — хендлеры (блокировка, удаление, файлы)
- `backend/handlers/handlers_test_setup.go` — тестовый setup (колонка + роуты)
- `backend/main.go` — новые роуты
- `frontend/src/app/services/api.service.ts` — методы API
- `frontend/src/app/components/admin/admin.ts` — UI иконками
- `frontend/src/app/components/feed/feed.ts` — реакции, picker "+"
- `TODO.md` — помечены #5, #6, #7 как выполненные

## Тесты
- 176 Go-тестов, 84 Angular-тестов — все проходят
- build backend и frontend — успешно
