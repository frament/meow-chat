<p align="center">
  <img src="design-mockups/favicon3.png" width="80" height="80" alt="MeowChat">
</p>

<h1 align="center">MeowChat</h1>

<p align="center">
  <b>Домашний чат-сервер для семьи с федеративной mesh-сетью</b><br>
  Go + Angular · WebSocket · E2EE · Federation · Docker
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.3.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/Go-1.23-00ADD8" alt="go">
  <img src="https://img.shields.io/badge/Angular-20-red" alt="angular">
  <img src="https://img.shields.io/badge/tests-512-brightgreen" alt="tests">
  <a href="https://github.com/frament/meow-chat/actions/workflows/ci.yml">
    <img src="https://github.com/frament/meow-chat/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
</p>

<p align="center">
  <a href="#🚀-установка">Установка</a> ·
  <a href="#🔗-федеративная-совместимость">Федерация</a> ·
  <a href="#разработка-локально">Разработка</a> ·
  <a href="#cli-администрирование">CLI</a>
</p>

---

## 🚀 Установка

### Вариант 1: Docker (рекомендуется)

```sh
git clone https://github.com/.../meow-chat.git
cd meow-chat
make build   # docker compose build
make up      # docker compose up -d
```

- Фронтенд: http://localhost
- API: http://localhost:8080/api

Остановка: `make down`

### Вариант 2: Linux VDS (прямая установка)

```sh
git clone https://github.com/.../meow-chat.git
cd meow-chat
sudo make install
```

`make install` собирает бэкенд + фронтенд, создаёт systemd-сервис, настраивает nginx.  
После установки отредактируйте `/etc/meow-chat.env` и запустите:

```sh
sudo systemctl start meow-chat
sudo systemctl enable meow-chat
```

### Вариант 3: Windows

```cmd
git clone https://github.com/.../meow-chat.git
cd meow-chat
install.bat
```

Собирает бэкенд и фронтенд, создаёт директории.  
Для запуска: `set DB_PATH=./data/chat.db && meow-chat-server.exe`  
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
sudo systemctl restart meow-chat
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
| v1.1.x | v1.0.x | ✅ Обратная совместимость |
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

### Тесты

Те же цели, что и в CI (`.github/workflows/ci.yml`):

```sh
make test-backend    # cd backend && go test ./...
make test-frontend   # cd frontend && ng test (headless Chrome)
```

> ⚠️ **Никогда не запускайте оба набора одновременно.** CGO-компиляция плюс Karma с Chrome выедают память, и macOS начинает прибивать приложения (Finder, редактор). По одному, в foreground. Подробности — в `AGENTS.md`.

512 тестов: 285 Go в 34 файлах + 227 Jasmine в 24 файлах.

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

## 🗺️ Roadmap и позиционирование

**MeowChat — домашний чат-сервер для семьи** (один инстанс ≈ один дом, ориентир — до ~100 пользователей) с возможностью объединять семьи через федерацию. Проект сознательно **не** нацелен на горизонтальное масштабирование и SaaS.

Приоритеты развития: **надёжность → простота обновления → новые функции**. План по версиям и вехам — в [`ROADMAP.md`](ROADMAP.md).

Ближайшее крупное направление — **v2.0.0 «Single-artifact distribution»**: один статический бинарь и один образ, фронтенд раздаётся самим сервером (без nginx), единый порт `8080`. На текущий момент (v1.x) актуальна описанная выше nginx-схема.

## 🤖 AI-Assisted Development

Этот проект создан при помощи AI под полным ручным контролем человека. 100% кода написано и проверено человеком — AI использовался как ассистент для ускорения разработки, генерации шаблонов и поиска решений.

- **Архитектура и дизайн**: спроектированы человеком
- **Код**: написан человеком с AI-ассистентом
- **Каждый коммит**: проверен и одобрен человеком
- **Каждая строка**: осмыслена перед включением

## Заметки

- **CGO обязателен**: go-sqlite3 требует gcc. Docker устанавливает его автоматически; локально нужен `CGO_ENABLED=1` и установленный gcc.
- **Авторизация**: JWT access/refresh tokens. Access token (15мин) через `Authorization: Bearer`. Refresh token (7 дней) в localStorage.
- **WebSocket**: in-memory hub, не масштабируется за пределами одного экземпляра. Эндпоинт: `/api/ws?token=`.
- **БД создаётся автоматически** при запуске — ручная настройка не требуется.
- **Версионирование**: SemVer, breaking changes только в MAJOR. Версия сервера доступна по `GET /api/version`.
