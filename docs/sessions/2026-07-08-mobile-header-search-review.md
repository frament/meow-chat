# Mobile header fix + user search review

## Changes

### `frontend/src/app/components/layout/layout.ts` (-0 / +0, 1 char)
- `sm:flex` → `flex` — на мобилке логотип + MeowChat теперь в одну строку (раньше `sm:flex` отключал `display:flex` на экранах <640px, img и span стакались вертикально)

## Search review

Поиск пользователей (`SearchUsers`, `handlers.go:1565`) работает корректно:
- Исключает себя (`id != ?`)
- Исключает забаненных (`is_banned = 0`)
- Ищет по `LIKE %query%`
- **Исключает друзей** (`NOT IN (SELECT ... FROM friends)`) — это фича с самого внедрения (`1c1bcd2`)
- Находит только не-друзей для кнопки «В друзья»

Решение: оставить как есть. Если понадобится поиск по всем пользователям (включая друзей) — переделать.
