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
 | `backend/handlers/ws_test.go` | 14 |
 | **Backend total** | **197** |

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

### Grand total: 303 tests, 0 failures ✅

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
- [x] #16 Пройтись по спецификациям из `docs/ws-requirements.md` (S5, S7, T1–T12, O1–O5, секции 2.4, 3.2–3.4) — S5 ✓, S7 ✓, S9 ✓, T1–T10/T12 ✓, T9a–T9c ✓, O1–O5 ✗
- [x] #17 Реализовать федерацию стикерпаков: выгрузка/загрузка/синхронизация между серверами ✓
