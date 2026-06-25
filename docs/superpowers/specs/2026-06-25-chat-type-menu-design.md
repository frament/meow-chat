# Chat Message Type Menu Redesign

## Problem
The message type selector in the chat input (text/image/sticker/GIF/poll) currently shows all types as equal flat buttons in a row with `flex:1`. This looks cluttered, lacks visual hierarchy, and takes space unnecessarily — especially since the user is usually in "text" mode.

## Solution
Replace the row of flat buttons with a single compact toggle button that opens a popup menu.

### Interaction
1. Input bar shows a single button with the active type's icon + label + `▾` arrow — e.g. `Aa ▾` for text, `🖼 ▾` for image.
2. Clicking the button toggles a popup menu above it.
3. Popup lists all message types: Текст, Фото, Стикер (disabled), GIF (disabled), Опрос.
4. Clicking a type sets `messageType` and closes the popup.
5. Clicking outside the popup closes it.
6. Escape key closes it.

### Disabled items
"Стикер" and "GIF" are shown but disabled (`opacity:0.4`, `cursor:not-allowed`) with a "скоро" badge, since these types are not yet implemented.

### States
- **Closed:** Shows active type icon + label + `▾`
- **Open:** Popup visible above the button
- **Changed:** Popup closes, button shows new active type

### Visual
- Popup: min-width 170px, `border-radius:14px`, `box-shadow`, `bg-elevated`
- Each item: 32px height, icon + label, `border-radius:10px`
- Active: `var(--accent-light)` background
- Hover: `var(--bg-surface-hover)`
- Divider before disabled section

## Files Affected
- `frontend/src/app/components/chat/chat.ts` — template changes (dual: desktop + mobile input bars), class changes (`showTypeMenu`, `selectType`, `currentTypeIcon`, `currentTypeLabel`)

## No New Dependencies
Reuses existing `msgTypes` array, existing inline SVGs, existing popup/overlay patterns from the codebase.
