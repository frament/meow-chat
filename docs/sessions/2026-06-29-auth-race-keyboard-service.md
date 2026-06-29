# Auth race condition + KeyboardService + mobile header move

## Changes

### 1. Mobile chat header → main top nav
- Chat component: удалена мобильная панель с кнопкой «назад» + аватар собеседника (lines 505-537)
- Layout component: на мобильных при активном чате показывает кнопку «назад» + имя/аватар вместо логотипа
- ApiService: добавлен `chatHeaderInfo` signal, устанавливается в `selectUser`/`selectGroup`, сбрасывается в `ngOnDestroy`

### 2. KeyboardService (централизованное скрытие bottom-nav)
- Создан `KeyboardService` с глобальными `focusin`/`focusout` слушателями на `document`
- При фокусе любого `INPUT`/`TEXTAREA` добавляет класс `keyboard-open` на `body`
- CSS: `body.keyboard-open .bottom-nav { display: none }`
- Chat component: удалён локальный `keyboardOpen`/`onInputFocus`/`onInputBlur`, использует сервис
- Eager injection в `LayoutComponent` — работает на всех страницах
- Post dialog: `padding-bottom` динамический (без 3.5rem при открытой клавиатуре)

### 3. Auth race condition (double refresh → logout)
**Root cause:** При истечении access token несколько параллельных API-запросов одновременно получают 401. Каждый независимо вызывает `refreshToken()` с одним и тем же старым refresh token. Первый успевает, сервер отзывает старый токен. Второй падает с 401 → `logout()`.

**Fix:** `refreshAccessToken()` в ApiService — дебаунс через `ReplaySubject`:
- Только первый вызов реально шлёт запрос
- Остальные подписываются на результат in-flight refresh
- HTTP interceptor и `scheduleReconnect()` (WebSocket) используют общий метод

### 4. Push notification corruption check
- Проверен production build: `sw-push-handler.js` и `ngsw-worker.js` лежат рядом в `browser/`
- `importScripts('./ngsw-worker.js')` резолвится корректно
- VK использует тот же механизм Web Push API; разница не в технике, а в отсутствии race-condition logout'ов у VK

## Files changed
- `frontend/src/app/services/keyboard.service.ts` — новый сервис
- `frontend/src/app/services/api.service.ts` — `chatHeaderInfo`, `refreshAccessToken()`
- `frontend/src/app/services/auth.interceptor.ts` — использует `refreshAccessToken()`
- `frontend/src/app/components/chat/chat.ts` — убран mobile header, убран local keyboard handler
- `frontend/src/app/components/layout/layout.ts` — mobile chat header, inject KeyboardService
- `frontend/src/app/components/post-dialog/post-dialog.ts` — dynamic padding via KeyboardService

## Commits
- `d9124c3` — move mobile chat header into main top nav
- `c6be6da` — centralize keyboard-open: KeyboardService
- `408af3b` — eagerly inject KeyboardService in LayoutComponent
- `a2490ec` — fix post dialog keyboard padding
- `e6773ec` — zero padding on post dialog when keyboard open
- `fe1b413` — debounce concurrent refresh token calls
