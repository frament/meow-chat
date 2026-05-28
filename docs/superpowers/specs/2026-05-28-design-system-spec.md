# MyChat Design System — Spec

## Overview

Complete redesign of MyChat UI: warm/cozy light theme + dark theme, with user-controlled switching (light/dark/system). Replaces the current Tailwind utility-based styling with CSS custom properties for consistent theming.

## Problems Addressed

1. **Borders**: Black `solid` lines → soft semi-transparent borders (`rgba`), matching the theme
2. **Flatness**: Pure white `#fff` on `#f9fafb` → warm surfaces with subtle shadows, depth via blur/glass effects
3. **Font**: System UI font → `Plus Jakarta Sans` (smoother, warmer, no pixelation)

## Theme Architecture

### CSS Custom Properties (Two Themes)

All colors defined as CSS variables on `:root.theme-light` / `:root.theme-dark`.

**Light Theme (`theme-light`):**
- Body: `#f5f0eb` (warm cream)
- Surface: `#ffffff` (with warm-tinted shadows)
- Text primary: `#2d2824` (warm dark)
- Text secondary: `#8a7e73`
- Text tertiary: `#b8aea4`
- Accent: `#c9754f` (terracotta), gradient `#c9754f → #b8643f`
- Borders: `rgba(0,0,0,0.06)` subtle, `rgba(0,0,0,0.08)` default
- Nav: `rgba(255,255,255,0.82)` with `backdrop-filter: blur(16px)`
- Shadows: warm-toned (`rgba(120,80,50,0.06…)`)

**Dark Theme (`theme-dark`):**
- Body: `#151210` (deep warm charcoal)
- Surface: `#1e1b18`
- Text primary: `#f0ece8`
- Text secondary: `#9c938b`
- Text tertiary: `#635b54`
- Accent: `#e8946a` (warm orange), gradient `#e8946a → #d4845d`
- Borders: `rgba(255,255,255,0.06)` subtle, `rgba(255,255,255,0.08)` default
- Nav: `rgba(30,27,24,0.92)` with blur, left/right pseudo-element borders
- Shadows: dark ambient

### Theme Switching

- **3 modes**: light | dark | system
- **Persistence**: saved to `localStorage` key `theme`
- **System mode**: listens to `matchMedia('(prefers-color-scheme: dark)')`, auto-switches on change
- **Application**: class `theme-light` or `theme-dark` on `<html>` or `<body>` element
- **Transition**: `0.4s ease` on `background` and `color` for smooth crossfade

## Component Migrations

Every component replaces Tailwind color classes with semantic CSS variable classes:

| Tailwind (old) | CSS var (new) |
|---|---|
| `bg-gray-50` | `var(--bg-body)` |
| `bg-white` | `var(--bg-surface)` |
| `text-gray-600` | `var(--text-secondary)` |
| `text-gray-800` | `var(--text-primary)` |
| `text-gray-500` | `var(--text-tertiary)` |
| `border-gray-300` / `border` | `var(--border-default)` |
| `border-b` / `border-t` | `var(--border-subtle)` or `var(--nav-border)` |
| `bg-blue-600` | `var(--accent)` |
| `bg-blue-100` / `text-blue-600` | `var(--avatar-bg)` / `var(--avatar-text)` |
| `shadow-sm` | `var(--shadow-sm)` |
| | `backdrop-filter: blur()` for glass |

## Components to Update

1. **`styles.css`** — define all CSS variables for both themes, font import, base body styles
2. **`index.html`** — add `theme-light` class to `<html>`, update `<meta name="theme-color">` dynamically
3. **`api.service.ts`** or **new `theme.service.ts`** — theme state management (3 modes, localStorage, media query listener)
4. **`layout.ts`** — replace all Tailwind color classes with CSS vars, add glass nav
5. **`feed.ts`** — replace card/post/new-post styles with CSS vars
6. **`settings.ts`** — add theme selector UI (3 radio options), replace all styles with CSS vars
7. **`chat.ts`** (if exists) — replace all styles with CSS vars
8. **`login.ts`** / **`register.ts`** — replace all styles with CSS vars

## Settings Page — Theme Selector

Located below the profile form, separated by a divider.

- Radio-style list: Светлая (☀️) / Тёмная (🌙) / Системная (💻)
- Each option: icon + title + description + custom radio dot
- Active option highlighted with accent color + light background
- Click immediately switches theme (preview before save)

## Implementation Order

1. Create `styles.css` with CSS vars + font + base transitions
2. Create `ThemeService` (manages state, localStorage, system listener)
3. Update `index.html` with initial theme class
4. Migrate `layout.ts` (nav, mobile nav)
5. Migrate `feed.ts` (new post card, post cards)
6. Migrate `settings.ts` + add theme selector
7. Migrate remaining components (login, register, chat)

## Files to Modify

- `frontend/src/styles.css` — rewrite with CSS custom properties
- `frontend/src/index.html` — initial theme class + meta update
- `frontend/src/app/services/api.service.ts` — maybe add theme loading from profile
- `frontend/src/app/components/layout/layout.ts` — migrate styles
- `frontend/src/app/components/feed/feed.ts` — migrate styles
- `frontend/src/app/components/settings/settings.ts` — migrate + add theme selector
- `frontend/src/app/components/login/login.ts` — migrate styles
- `frontend/src/app/components/register/register.ts` — migrate styles
- `frontend/src/app/components/chat/chat.ts` — migrate styles

## New Files

- `frontend/src/app/services/theme.service.ts` — theme state management
