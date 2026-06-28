# iOS keyboard gap fix (#21)

## Problem
iOS Safari (iPhone) — при открытии клавиатуры чат сдвигался вверх, оставляя контент под «чёлочкой». При закрытии клавиатуры — фиксированный отступ (safe-area перевычитался) или инпут прятался под нижнюю навигацию.

## Attempts

1. **`visualViewport` + `NgZone`** — вызывал скролл страницы при resize.
2. **`100dvh` + `body fixed+overflow`** — ломал нормальный скролл фида.
3. **`shrink-0` + `100dvh`** — не работал на всех iOS.
4. **`position: fixed`** на контейнере чата:
   - Без safe-area: инпут прятался под bottom nav (не хватало `safe-area-inset-bottom`).
   - С safe-area: отступ при закрытой клавиатуре.

## Final solution

```typescript
mobileChatHeight = computed(() => {
  if (this.keyboardOpen()) {
    return 'calc(100dvh - 3.5rem)';
  }
  return 'calc(100dvh - 7rem - env(safe-area-inset-bottom, 0px))';
});
```

- Контейнер: `position: fixed; top-14` — не участвует в scroll, iOS не двигает страницу.
- С клавиатурой: `100dvh - 3.5rem` (от top-nav до низа, `dvh` корректно уменьшается на iOS 15.4+).
- Без клавиатуры: `100dvh - 7rem - safe-area-inset-bottom` — контейнер заканчивается ровно над bottom nav (у которой есть свой safe-area отступ).
- `safe-area-inset-top` НЕ вычитается (top-nav уже его содержит; его вычитание создавало gap).

## Related changes
- #20: WS-фильтр типов
- #22: iOS double-tap guard
- #23: Post dialog bottom padding
- #24: Cascade delete user
- #25: Post delete button mobile

## Commits
- `da8f1a7` – initial `position: fixed` + `100dvh` attempt
- `1b23e61` – added `visualViewport` (scroll regression)
- `d363748` – removed `visualViewport`, simplified
- `084da9c` – final: added `safe-area-inset-bottom` for non-keyboard state
