# my-chat

![version](https://img.shields.io/badge/version-1.0.0-blue)

Чат в реальном времени с федеративной mesh-сетью: Go бэкенд (Fiber + SQLite + WebSocket) и Angular 20 фронтенд (standalone + Tailwind v4).

## 🚀 Установка

### Вариант 1: Docker (рекомендуется)

```sh
git clone https://github.com/.../my-chat.git
cd my-chat
make build   # docker compose build
make up      # docker compose up -d
```

- Фронтенд: http://localhost
- API: http://localhost:8080/api

Остановка: `make down`

### Вариант 2: Linux VDS (прямая установка)

```sh
git clone https://github.com/.../my-chat.git
cd my-chat
sudo make install
```

`make install` собирает бэкенд + фронтенд, создаёт systemd-сервис, настраивает nginx.  
После установки отредактируйте `/etc/my-chat.env` и запустите:

```sh
sudo systemctl start my-chat
sudo systemctl enable my-chat
```

### Вариант 3: Windows

```cmd
git clone https://github.com/.../my-chat.git
cd my-chat
install.bat
```

Собирает бэкенд и фронтенд, создаёт директории.  
Для запуска: `set DB_PATH=./data/chat.db && my-chat-server.exe`  
Для service-режима используйте nssm (см. инструкцию в выводе install.bat).

## 🔄 Обновление

### Docker
```sh
make update   # git pull + docker compose build + up -d
```

### Linux VDS
```sh
git pull
sudo make install
sudo systemctl restart my-chat
```

### MAJOR-обновления
При обновлении MAJOR-версии (например, v1.x.x → v2.x.x) требуется **backup перед обновлением**:

```sh
cd backend && go run . admin backup   # или через API
# затем обновление
```

Сервер не запустится, если MAJOR-версия БД не совпадает с версией сервера.

## Требования

- **Docker** + Docker Compose (для варианта 1)
- **Go 1.23+** (`CGO_ENABLED=1`) + **Node.js 24+** (для прямой установки)

## 🔗 Федеративная совместимость

| Сервер A | Сервер B | Совместимость |
|----------|----------|---------------|
| v1.x.x | v1.y.y | ✅ Одинаковый MAJOR |
| v1.x.x | v2.x.x | ❌ Разные MAJOR |

При федеративном handshake проверяется MAJOR-версия. Сервера с разными MAJOR не могут соединиться.

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

## CLI (администрирование)

Утилита для управления пользователями через терминал (не требует запущенного сервера):

```sh
cd backend

# Создаётся автоматически при первом запуске: admin / admin

# Управление админами
go run . admin list                              # список администраторов
go run . admin add <username>                    # сделать пользователя админом
go run . admin remove <username>                 # снять права администратора

# Сброс пароля
go run . admin reset-password <username> <password>
```

## Проверка production-сборки

```sh
cd frontend && npm run build   # production-сборка с service worker
```

## Структура проекта

```
backend/          # Go модуль (Fiber + SQLite)
  main.go         # точка входа, регистрация маршрутов
  version/        # версия приложения
  database/       # SQLite авто-миграция + schema_version
  handlers/       # REST-обработчики + WebSocket hub
  federation/     # федеративная mesh-сеть (транспорт, очередь, health, handler)
  backup/         # backup/restore (VACUUM INTO + ZIP)
  cache/          # LRU disk cache для федерации
  models/         # структуры запросов/ответов
frontend/         # Angular 20 standalone + Tailwind v4
contrib/          # systemd unit, nginx config, env template
install.bat       # установка на Windows
```

## Заметки

- **CGO обязателен**: go-sqlite3 требует gcc. Docker устанавливает его автоматически; локально нужен `CGO_ENABLED=1` и установленный gcc.
- **Авторизация**: JWT access/refresh tokens. Access token (15мин) через `Authorization: Bearer`. Refresh token (7 дней) в localStorage.
- **WebSocket**: in-memory hub, не масштабируется за пределами одного экземпляра. Эндпоинт: `/api/ws?token=`.
- **БД создаётся автоматически** при запуске — ручная настройка не требуется.
- **Версионирование**: SemVer, breaking changes только в MAJOR. Версия сервера доступна по `GET /api/version`.
