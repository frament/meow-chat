# План: полноценный per-device E2EE (мультидевайс)

Статус: черновик к обсуждению · дата: 2026-09-28

## 1. Проблема (что ломается сейчас)

E2EE спроектирован под **одно устройство на пользователя**:

- `user_keys` хранит **одну** строку `(user_id, public_key)`, `PutKey` делает `ON CONFLICT(user_id) DO UPDATE` (`backend/handlers/e2ee.go:21-38`). Последнее устройство, которое синхронизировало ключ, перезаписывает публичный ключ всех остальных.
- Identity-keypair генерируется **на устройство** и лежит в IndexedDB (`CryptoService.ensureIdentityKey`, `frontend/src/app/services/crypto.service.ts:64-87`).
- Групповой ключ — случайный AES на устройство (`groupKeyRaw_<gid>` в IndexedDB), а `group_key_shares` привязан к паре `(group_chat_id, user_id)` (`backend/handlers/e2ee.go:86-143`), т.е. зашифрован **под один** публичный ключ пользователя.
- `distributeGroupKeyToMembers` пропускает самого себя (`frontend/src/app/components/chat/chat.ts:1832`), поэтому второе устройство того же пользователя никогда не получает собственный share.
- DM шифруются как `ECDH(myDevicePriv, peerServerPub)` (`getSharedKey`, `crypto.service.ts:126-145`) — «peerServerPub» тоже один на пользователя.

**Симптом (прод):** сообщение, отправленное с телефона, на ПК показывает `[Зашифрованное сообщение]` — ПК имеет другую identity-пару и не может расшифровать шар/сообщение. Прод-подтверждение: `user_keys.user_id=1` перезаписан телефоном 2026-09-28 17:25:49; `group_key_shares` для группы 1 — по одной строке на user 1/9/10.

Инфраструктура синхронизации **уже частично есть**, но не задействована:
- `user_devices` (`device_id`, `device_public_key`, `device_name`) — таблица пустая;
- `device_auth_requests` + approve-флоу (`backend/handlers/devices.go:94-234`, UI `frontend/src/app/components/device-auth/device-auth.ts`);
- `user_keys_backup` (password/recovery-phrase wrap identity key) — таблица пустая;
- client-side `encryptIdentityKeyForDevice` / `decryptIdentityKeyFromDevice` / `importIdentityKey` (`crypto.service.ts:411-513`).

## 2. Цели и не-цели

**Цели**
- Любое устройство пользователя расшифровывает DM и группы, включая историю, без пересылки plaintext на сервер.
- Добавление/отзыв устройства без потери доступа на остальных.
- Отзыв устройства лишает его доступа к *новым* сообщениям (forward secrecy на уровне эпох).
- Сохранение текущего threat-model: сервер honest-but-curious, plaintext не видит.

**Не-цели (пока)**
- Защита от скомпрометированного сервера, который раздаёт поддельные device-keys (нужен transparency/verification — отдельная задача).
- Скрытие метаданных (кто/когда/размер).
- Полная PQ-криптография.

## 3. Целевая архитектура (вариант per-device)

Каждое устройство имеет **свой** identity-ключ. Сообщения фан-аутятся на key-набор получателя; групповой ключ раздаётся на каждое устройство.

### 3.1 Реестр device-ключей
- `user_devices` расширяется: `identity_public_key`, `key_version`, `verified_at`, `revoked_at`.
- Новый эндпоинт `GET /api/users/:id/device-keys` → список активных (не revoked) device-ключей.
- `device_public_key` из linking-флоу переиспользуется как identity-ключ устройства (он и так ECDH P-256).

### 3.2 DM: конверты (envelopes)
- Отправитель генерирует случайный симметричный `content_key` (AES-256-GCM), шифрует текст/вложения.
- Для каждого активного устройства получателя и каждого *своего другого* устройства (чтобы читать свои исходящие на всех своих устройствах) считает `ECDH(senderDevicePriv, devicePub)` и оборачивает `content_key`.
- В сообщении хранятся `ciphertext + iv` и список конвертов `{device_id, wrapped_key, iv}`.
- Новая таблица `message_envelopes(message_id, device_id, wrapped_key, iv)` (или JSON-колонка).
- Устройство расшифровывает своим identity-ключом тот конверт, что адресован ему.

### 3.3 Группы: ключ на устройство + эпохи
- `group_key_shares` переезжает с `(group_chat_id, user_id)` на `(group_chat_id, device_id)` + `epoch`.
- Новая таблица `group_keys(group_chat_id, epoch, created_at)` (метаданные; сам ключ только у клиентов).
- Создатель группы генерирует ключ эпохи 0 и раскладывает его на все devices всех участников.
- Новый участник/новое устройство — уже реализованный флоу «request key» (см. ниже) плюс device-скоуп.

### 3.4 Добавление устройства (linking)
- Новое устройство регистрирует свой device-ключ, создаёт `device_auth_request`.
- Доверенное устройство аппрувит и **не** переносит общий identity-ключ (в per-device модели он не нужен), а передаёт:
  - набор групповых ключей (все активные эпохи) — обёрнутый на device-ключ нового устройства;
  - (опционально) ничего для DM, т.к. DM-конверты адресуются на device-ключи автоматически.
- Т.е. существующий approve-канал переиспользуется как «key transfer channel».

### 3.5 Отзыв устройства и ротация
- `DELETE /devices/:deviceId` → `revoked_at`, сервер шлёт всем участникам событие `device_revoked`.
- Участники: (а) при следующей отправке исключают revoked device из конвертов; (б) инициируют **новую эпоху** группового ключа (`epoch+1`) и раскладывают её на оставшиеся устройства. Старые сообщения остаются читаемыми оставшимися устройствами.
- DM: отправитель просто перестаёт адресовать revoked device.

## 4. Изменения данных

| Таблица | Сейчас | Станет |
|---|---|---|
| `user_keys` | одна строка на user | legacy, dual-read на время миграции |
| `user_devices` | device_public_key | + `identity_public_key`, `key_version`, `verified_at`, `revoked_at` |
| `group_key_shares` | `(group, user_id)` | `(group, device_id, epoch)` |
| `message_envelopes` | — | new: `message_id`, `device_id`, `wrapped_key`, `iv` |
| `group_keys` | — | new: `group_chat_id`, `epoch`, `created_at` |
| `user_keys_backup` | identity JWK по паролю | recovery для identity-ключа устройства (опционально) |

## 5. API

- `GET /api/users/:id/device-keys` — активные device-ключи пользователя.
- `POST /api/devices/register` — уже есть; добавить `identity_public_key`.
- `POST /api/messages` — принимать `envelopes[]`; `GET /api/messages` — отдавать `envelopes[]`.
- `POST /api/group-chats/:id/keys` — принимать `device_id` + `epoch`.
- `POST /api/group-chats/:id/request-key` — уже реализован (broadcast `group_key_request`); расширить до device-скоупа.
- `POST /api/group-chats/:id/rotate-key` — новая эпоха + broadcast `group_key_epoch`.
- `DELETE /api/devices/:deviceId` — trigger ротации.

## 6. Совместимость и миграция

1. **Dual-read/write.** Клиент v<sup>new</sup> шлёт и envelopes, и legacy-поле `encrypted_content` (на старый `user_keys`), пока не убедимся, что все активные клиенты обновились. Получатель выбирает envelopes, если есть, иначе старый путь.
2. **Feature-flag по версии клиента** (заголовок `X-Client-Version`): новый формат включается только для пар «оба клиента новые».
3. **Backfill device-ключей.** При логине каждое устройство регистрирует `device_public_key`; сервер сохраняет. Пока `user_keys` остаётся для старых.
4. **История.** Старые DM/группы расшифровываются старым ключом, который нужно сохранить локально на устройстве (уже есть). Новые эпохи — только для новых сообщений.

## 7. Поэтапный rollout

- **Фаза 0 (интерим, закрывает кейс ПК уже сейчас).** Включить существующий device-linking как продуктовый флоу: на новом устройстве — «Связать с телефоном», телефон аппрувит, identity JWK переносится (`encryptIdentityKeyForDevice`). Плюс сделать `distributeGroupKeyToMembers` не-пропускающим собственные устройства (раздавать self-share на каждый device). Это поднимает ПК без смены формата сообщений.
- **Фаза 1.** Реестр device-ключей + `GET device-keys`; устройства регистрируются при старте.
- **Фаза 2.** DM-конверты (новая таблица + API + клиент), dual-read.
- **Фаза 3.** Групповые ключи на device + эпохи + ротация при отзыве устройства.
- **Фаза 4.** Recovery/backup, выпиливание legacy `user_keys`-пути, нагрузочная/security-проверка.

## 8. Тестирование

- Unit (Go): `GET device-keys` (authz, revoked-фильтр), сохранение/выдача envelopes, device-скоуп `group_key_shares`, ротация эпохи.
- Unit (TS): wrap/unwrap content_key, выбор правильного конверта, отказ при отсутствии ключа устройства.
- Интеграция: 2 устройства одного user расшифровывают DM и группу; revoked-устройство не может расшифровать новые сообщения; новое устройство после linking получает групповые ключи.
- Регресс: старые сообщения (legacy) всё ещё читаются; спеки `chat`/`app`/`crypto` зелёные.

## 9. Риски и открытые вопросы

- **Рост хранения**: envelope на каждое устройство каждого получателя (комнаты с большими группами × много устройств). Нужен лимит и/или batched-конверты.
- **Производительность WebCrypto** при десятках устройств на сообщение.
- **Recovery UX**: если пользователь потерял все устройства — история нечитаема без backup/фразы; решить, что считать дефолтом.
- **Атомарность ротации**: пока часть устройств не получила новую эпоху, возможны «дыры»; нужен буфер/догон.
- **Federation**: device-ключи удалённых пользователей и ротации через `/api/federation/...` — отдельное расширение.
- **Верификация device-ключей**: без неё MITM со стороны сервера возможен; минимум — показывать фингерпринт при linking.

## 10. Ссылки на код

- Проблема: `backend/handlers/e2ee.go` (PutKey/UploadGroupKeyShare/GetMyGroupKeyShare), `frontend/src/app/services/crypto.service.ts` (identity/group/DM), `frontend/src/app/components/chat/chat.ts` (distribute/decrypt/send).
- Готовая инфраструктура: `backend/handlers/devices.go`, `frontend/src/app/components/device-auth/device-auth.ts`, `user_keys_backup`.
- Сделано в этой сессии (кейс «первое сообщение в группе»): `POST /group-chats/:id/request-key`, broadcast `group_key_request`/`group_member_added`, `group_key_ready`, авто-ретрай отправки на клиенте.
