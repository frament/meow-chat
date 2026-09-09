# Сессия 2026-09-09: Диагностика прода (home-lab) — push, iOS-загрузка, история чата

## Контекст
Разбор трёх жалоб на production (Docker Compose на `home-lab`, 192.168.1.41, путь `~/rep/my-chat`):
1. Пропали все уведомления (push + бейджи внутри приложения).
2. Отправка сообщения с картинкой не уходит.
3. В ходе тестов всплыло: новые сообщения не появляются в чате, хотя push приходит.

SSH-доступ: `frament@192.168.1.41` (пароль), обёртка `expect` для пароля (sshpass нет на macOS).

## Диагностика

### 1. Push мёртв → сломан DNS внутри Docker-контейнера
- В логах backend с 2026-09-08 17:40: `Web Push send error: dial tcp: lookup fcm.googleapis.com on 127.0.0.1.11:53: server misbehaving` (SERVFAIL). То же для `web.push.apple.com`.
- Push работал до 11 июля (`Web Push sent`), следующий триггер случился только 8 сентября — потому баг был незаметен ~месяц.
- Причина: контейнер пересоздавался ~5 недель назад, когда в host `/etc/resolv.conf` не было пригодного DNS → Docker собрал container resolv.conf без upstream (`# NO EXTERNAL NAMESERVERS DEFINED`). Хост и роутер (`192.168.1.1`) резолвят нормально.
- **Фикс:** `dns: [192.168.1.1]` в `docker-compose.yml` (сервис `backend`) → `docker compose up -d`. Проверено: `fcm.googleapis.com` резолвится.
- Бейджи в приложении считаются только из живых WS-событий + fallback-push; при мёртвом push сообщение, пришедшее офлайн, терялось полностью. После фикса DNS восстановился и push (Екатерина получила уведомление).

### 2. Картинка «не уходит» → известный баг WebKit (Safari/iOS 26.5.x)
- nginx-лог: `POST /api/messages → 400`, тело запроса **пустое** (`Content-Length: 0`) при `Content-Type: multipart/form-data; boundary=…`. Перехват сырого тела временным python-прокси на :18080 подтвердил: тело 0 байт, хотя `type=image`.
- Текстовые multipart (без файла) уходят нормально. Backend/nginx файлы принимают (серверный curl-тест → 201 + файл на диск).
- Это **WebKit bug 319985** (Safari/iOS 26.5.x, резолюция 2026-07): XHR/fetch с дисковым `File` из `<input type=file>` на странице под контролем service worker шлёт пустое тело. Рабочий обход из бага: слать **in-memory копию** (`new File([await file.arrayBuffer()], name)`).
- **Фикс:** хелпер `toMemoryFile()` (`frontend/src/app/services/upload-utils.ts`) — снапшот файла в память при выборе; применён в чате, постах, аватаре (settings), стикерах (admin). Подтверждено: файл доходит (сообщение 222, 343 КБ на диске).

### 3. Новые сообщения не видны в чате → `GET /api/messages` отдавал СТАРЫЕ 100
- `ORDER BY created_at ASC LIMIT 100` — всегда самые старые 100. В чате 1↔2 (Екатерина) 157 сообщений → новые (219/224/225) никогда не загружались при открытии чата. Push доходит, а в чате пусто.
- Тот же баг в групповых сообщениях (`groups.go`).
- **Фикс:** `SELECT * FROM ( … ORDER BY m.id DESC LIMIT 100 ) ORDER BY id ASC` в `GetMessages` и `GetGroupMessages`.

### Бонус-баги
- `messageType` застревал в `image`: после отправки картинки следующие «текстовые» уходили как `type=image` без файла (сообщение 220 «Тест»). → сброс на `text` после отправки/удаления файлов.
- Отправитель не видел свою картинку: optimistic-пузырь без `images`, свои WS-эхо пропускаются. → optimistic получает локальные превью, при ответе сервера подставляются реальные URL (`images` теперь возвращаются в 201-ответе `SendMessage`/групповой отправки); превью не пишутся в localStorage (helper `persistCache`).

## Изменённые файлы
- `docker-compose.yml` — `dns: [192.168.1.1]` у backend
- `backend/handlers/handlers.go` — GetMessages последние 100; `images` в ответе SendMessage
- `backend/handlers/groups.go` — GetGroupMessages последние 100; `images` в ответе
- `frontend/src/app/services/upload-utils.ts` — новый, `toMemoryFile()`
- `frontend/src/app/components/chat/chat.ts` — memory-файлы, сброс image-режима, optimistic-превью, `persistCache`
- `frontend/src/app/components/post-dialog/post-dialog.ts`, `settings/settings.ts`, `admin/admin.ts` — memory-файлы при выборе

## Проверка
- Backend: `go build ./...` + `go test ./handlers/ -run 'TestSendMessage|TestGetMessages|TestWS'` — ok.
- Frontend: `ng build --configuration production` — ok (предупреждения старые: budget/qrcode).
- На проде: оба контейнера пересобраны, `/api/health` 200; SQL проверен на боевой БД (в выдаче 219/224/225).
- Пользователь подтвердил: всё работает.

## Инструменты диагностики (временные, убраны)
- Временный подробный nginx-лог (`$request_length`, content_type) через `docker cp` конфига + reload.
- Python-прокси-дампер на :18080 (лог сырого тела multipart), перехват только `POST /api/messages` через `location = /api/messages`. Всё возвращено в исходное состояние.

## TBD / наблюдения
- iOS-фикс завязан на то, что `provideHttpClient` без `withFetch()` (XHR). Если перейдут на fetch — проверить обход под SW.
- Дубль сообщения «дважды в Safari»: не воспроизвёлся после фиксов (вероятно, две WS-сессии или старый кэш).
- История: пагинация за пределы 100 последних сообщений не реализована (TBD).
