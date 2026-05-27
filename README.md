# my-chat

Чат в реальном времени: Go бэкенд (Fiber + SQLite + WebSocket) и Angular 20 фронтенд (standalone components + Tailwind v4).

## Требования

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- *Для локальной разработки:* Go 1.22+ (`CGO_ENABLED=1`), Node.js 24+, npm

## Быстрый старт (Docker Compose)

```sh
make build   # docker compose build
make up      # docker compose up -d
```

- Фронтенд: http://localhost
- API бэкенда: http://localhost:8080/api

Остановка: `make down`

## Разработка (локально)

### Бэкенд (Go + SQLite)

Требуется CGO (gcc для go-sqlite3):

```sh
make dev-backend
# запускает: cd backend && DB_PATH=./data/chat.db go run .
```

Сервер стартует на `:8080`. БД SQLite создаётся в `backend/data/chat.db`.

### Фронтенд (Angular)

```sh
make dev-frontend
# запускает: cd frontend && npm run start
```

Открывается на `:4200`. Запросы к `/api` проксируются на `localhost:8080` (включая WebSocket).

## Проверка production-сборки

```sh
cd frontend && npm run build   # production-сборка с service worker
```

## Структура проекта

```
backend/          # Go модуль (Fiber + SQLite)
  main.go         # точка входа, регистрация маршрутов
  database/       # SQLite авто-миграция (users, messages, posts)
  handlers/       # REST-обработчики + WebSocket hub
  models/         # структуры запросов/ответов
frontend/
  src/app/
    components/   # standalone компоненты (login, register, feed, chat, layout)
    services/     # API-вызовы + WebSocket
  proxy.conf.js   # конфиг dev-прокси
  nginx.conf      # конфиг reverse-proxy для продакшена
```

## Заметки

- **CGO обязателен**: go-sqlite3 требует gcc. Docker устанавливает его автоматически; локально нужен `CGO_ENABLED=1` и установленный gcc.
- **Авторизация**: без JWT. Login сохраняет ID пользователя в localStorage; фронтенд отправляет заголовок `X-User-Id`.
- **WebSocket**: in-memory hub, не масштабируется за пределами одного экземпляра. Эндпоинт: `/api/ws/:userId`.
- **БД создаётся автоматически** при запуске — ручная настройка не требуется.
