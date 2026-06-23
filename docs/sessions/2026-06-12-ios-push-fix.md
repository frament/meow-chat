# Session 2026-06-12 — iOS PWA push fix after force-quit

## Root cause
iOS убивает WebKit процесс PWA при force-quit → APNs не может доставить push

## Fixes
- **SW fix**: Добавлен `pushsubscriptionchange` listener в `sw-push-handler.js` — при сбросе подписки iOS автоматически переподписывается и уведомляет клиента
- **App fix**: `tryReSubscribePush()` вызывается при каждом `window.focus` + в `ngOnInit` — проверяет существующую подписку через `pushManager.getSubscription()`, перерегистрирует на сервере; если подписка отсутствует — создаёт новую через `requestSubscription()`

## Result
Окно потери push после force-quit сведено к reopen приложения
