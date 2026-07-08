# 2026-07-08: Federation invite icons + settings text button cleanup

## Problem
- Federation invite modal показывал сырой URL текстом, без кнопок копирования/QR
- В настройках кнопки "Копировать" и "QR" в списке инвайтов были текстовыми (не по monochrome standard)

## Changes

### `admin-federation.ts`
- Импортирован `qrcode`
- URL инвайта теперь отображается в блоке с иконками copy+QR (как friend invite в settings)
- Добавлены `copyFederationInvite()`, `showFederationQR()`, `closeFederationQR()`, `copyFederationInviteFromQR()`
- QR-оверлей модалки

### `settings.ts`
- "Копировать" и "QR" текстовые кнопки в списке инвайтов заменены на monochrome SVG иконки
- Убран `{{ inv.token.slice(0, 16) }}…` из карточки инвайта — остались только дата, использовано и 3 кнопки
- Убран `{{ friendInviteUrl }}` из блока друга — добавлена дата создания (первой), 3 кнопки
- Оба списка приведены к единому стилю: мета-информация слева, кнопки справа

### Backend: `handlers.go`
- `CreateFriendInvite` теперь возвращает `created_at` (через `INSERT ... RETURNING created_at`)

### `api.service.ts`
- Тип ответа `createFriendInvite()` расширен до `{ token: string; created_at: string }`

## Files
- `backend/handlers/handlers.go`
- `frontend/src/app/services/api.service.ts`
- `frontend/src/app/components/settings/settings.ts`
- `frontend/src/app/components/admin-federation/admin-federation.ts`
