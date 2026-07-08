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
- Убран `{{ friendInviteUrl }}` из блока друга — остались только 3 кнопки
- Оба списка приведены к единому стилю: мета-информация слева, кнопки справа

## Files
- `frontend/src/app/components/admin-federation/admin-federation.ts`
- `frontend/src/app/components/settings/settings.ts`
