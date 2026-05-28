# Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace current Tailwind utility-based styling with CSS custom property theming (warm light + dark), add theme selector to settings.

**Architecture:** CSS variables on `.theme-light`/`.theme-dark` classes on `<html>`; `ThemeService` manages state and persists to localStorage; all components switch to `var(--*)` references.

**Tech Stack:** Angular 20 standalone, Tailwind v4 (kept for layout, colors via CSS vars), Plus Jakarta Sans font

---

### Task 1: Core Foundation — styles.css + ThemeService + index.html

**Files:**
- Modify: `frontend/src/styles.css`
- Create: `frontend/src/app/services/theme.service.ts`
- Modify: `frontend/src/index.html`

- [ ] **Step 1: Write styles.css with full CSS custom properties for both themes**

Content of `frontend/src/styles.css`:
```css
@import "tailwindcss";
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

:root {
  --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
}

.theme-light {
  --bg-body: #f5f0eb;
  --bg-surface: #ffffff;
  --bg-surface-hover: #faf7f4;
  --bg-elevated: #ffffff;
  --text-primary: #2d2824;
  --text-secondary: #8a7e73;
  --text-tertiary: #b8aea4;
  --border-subtle: rgba(0,0,0,0.06);
  --border-default: rgba(0,0,0,0.08);
  --accent: #c9754f;
  --accent-hover: #b8643f;
  --accent-light: #fdf1eb;
  --shadow-sm: 0 1px 3px rgba(120,80,50,0.06), 0 1px 2px rgba(120,80,50,0.04);
  --shadow-md: 0 4px 12px rgba(120,80,50,0.08), 0 2px 4px rgba(120,80,50,0.04);
  --shadow-lg: 0 8px 30px rgba(120,80,50,0.1);
  --nav-bg: rgba(255,255,255,0.82);
  --nav-border: rgba(0,0,0,0.06);
  --avatar-bg: #fdf1eb;
  --avatar-text: #c9754f;
  --input-bg: #ffffff;
  --divider: rgba(0,0,0,0.06);
  --accent-gradient: linear-gradient(135deg, #c9754f 0%, #b8643f 100%);
}

.theme-dark {
  --bg-body: #151210;
  --bg-surface: #1e1b18;
  --bg-surface-hover: #252220;
  --bg-elevated: #282522;
  --text-primary: #f0ece8;
  --text-secondary: #9c938b;
  --text-tertiary: #635b54;
  --border-subtle: rgba(255,255,255,0.06);
  --border-default: rgba(255,255,255,0.08);
  --accent: #e8946a;
  --accent-hover: #d4845d;
  --accent-light: rgba(232,148,106,0.12);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.5);
  --nav-bg: rgba(30,27,24,0.92);
  --nav-border: rgba(255,255,255,0.06);
  --avatar-bg: rgba(232,148,106,0.15);
  --avatar-text: #e8946a;
  --input-bg: #1e1b18;
  --divider: rgba(255,255,255,0.06);
  --accent-gradient: linear-gradient(135deg, #e8946a 0%, #d4845d 100%);
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--bg-body);
  color: var(--text-primary);
  transition: background 0.4s ease, color 0.4s ease;
}

::selection {
  background: var(--accent-light);
  color: var(--text-primary);
}

::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: 3px;
}
```

- [ ] **Step 2: Create ThemeService**

Content of `frontend/src/app/services/theme.service.ts`:
```typescript
import { Injectable, Renderer2, RendererFactory2 } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private renderer: Renderer2;
  private mediaQuery: MediaQueryList;
  private systemDark = false;
  private themeListeners: (() => void)[] = [];

  constructor(rendererFactory: RendererFactory2) {
    this.renderer = rendererFactory.createRenderer(null, null);

    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemDark = this.mediaQuery.matches;

    this.mediaQuery.addEventListener('change', (e) => {
      this.systemDark = e.matches;
      if (this.getStoredMode() === 'system') {
        this.applyThemeClass();
      }
    });

    this.applyStoredTheme();
  }

  private getStoredMode(): ThemeMode {
    return (localStorage.getItem('theme') as ThemeMode) || 'system';
  }

  get currentMode(): ThemeMode {
    return this.getStoredMode();
  }

  get resolvedTheme(): 'light' | 'dark' {
    const mode = this.getStoredMode();
    if (mode === 'system') return this.systemDark ? 'dark' : 'light';
    return mode;
  }

  private applyThemeClass() {
    const theme = this.resolvedTheme;
    this.renderer.removeClass(document.documentElement, 'theme-light');
    this.renderer.removeClass(document.documentElement, 'theme-dark');
    this.renderer.addClass(document.documentElement, `theme-${theme}`);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#151210' : '#f5f0eb');
    }
  }

  applyStoredTheme() {
    this.applyThemeClass();
  }

  setTheme(mode: ThemeMode) {
    localStorage.setItem('theme', mode);
    this.applyThemeClass();
    this.notify();
  }

  private notify() {
    for (const fn of this.themeListeners) fn();
  }

  onChange(fn: () => void) {
    this.themeListeners.push(fn);
  }
}
```

- [ ] **Step 3: Update index.html**

Content of `frontend/src/index.html` (only changes shown):
- Add `class="theme-light"` to `<html>` tag
- Update `<meta name="theme-color" content="#f5f0eb">`

```html
<html lang="ru" class="theme-light">
...
<meta name="theme-color" content="#f5f0eb">
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles.css frontend/src/app/services/theme.service.ts frontend/src/index.html
git commit -m "feat: add CSS custom properties theming and ThemeService"
```

---

### Task 2: Migrate Layout Component

**Files:**
- Modify: `frontend/src/app/components/layout/layout.ts`

- [ ] **Step 1: Rewrite layout.ts template with CSS vars**

Replace old Tailwind classes:
- `bg-gray-50` → use body style from `styles.css` (no need on wrapper)
- `bg-white shadow-sm border-b` on nav → use `style="background:var(--nav-bg);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--nav-border);"`
- `text-blue-600` on logo → use `style="background:var(--accent-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;"`
- `text-gray-600 hover:text-gray-900` on nav links → `style="color:var(--text-secondary)"` hover `var(--text-primary)`
- `text-blue-600 font-medium` active → `style="color:var(--accent)"`
- `bg-blue-100 text-blue-600` on avatar fallback → `style="background:var(--avatar-bg);color:var(--avatar-text)"`
- `border-gray-200` → `style="border-color:var(--border-default)"`
- `bg-white border-t` on mobile nav → matching nav styles

Add left/right pseudo-border via `::before`/`::after` on nav (use a class or inline style approach — simplest: wrap nav in a div with the pseudo-elements, or just apply these styles inline). Since Angular templates limit pseudo-elements, add a `<style>` block in the component or use global styles. Best approach: add a `.top-nav` class in `styles.css`.

Add a nav class to `styles.css`:
```css
.top-nav {
  background: var(--nav-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--nav-border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.top-nav::before,
.top-nav::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--nav-border);
  opacity: 0.5;
  pointer-events: none;
}
.top-nav::before { left: 0; }
.top-nav::after { right: 0; }
```

Add to layout template: `class="top-nav"` instead of raw classes.

Same for bottom nav — add a `.bottom-nav` class:
```css
.bottom-nav {
  background: var(--nav-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid var(--nav-border);
}
```

Replace avatar URL image border with `var(--border-default)`.

- [ ] **Step 2: Add nav classes to styles.css**

Add the `.top-nav` and `.bottom-nav` CSS classes from step 1 into `styles.css`.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles.css frontend/src/app/components/layout/layout.ts
git commit -m "feat: migrate layout component to CSS variable theming"
```

---

### Task 3: Migrate Feed Component

**Files:**
- Modify: `frontend/src/app/components/feed/feed.ts`

- [ ] **Step 1: Rewrite feed.ts template with CSS vars**

Replace classes in the template:
- Card wrapper `bg-white rounded-xl shadow-sm border p-3 sm:p-4` → use a `.card` class
- Textarea `border border-gray-300 focus:border-blue-500 focus:ring-blue-500` → use CSS vars
- Button `bg-blue-600` → `.btn-primary` class
- Secondary button `border border-gray-300 text-gray-600` → `.btn-secondary` class
- Avatar fallback `bg-blue-100 text-blue-600` → CSS vars

Add to `styles.css`:
```css
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 16px;
  box-shadow: var(--shadow-sm);
  transition: all 0.3s ease;
}
.card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--border-default);
}
.card textarea {
  width: 100%;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  font-family: var(--font-sans);
  font-size: 14px;
  background: var(--input-bg);
  color: var(--text-primary);
  resize: none;
  outline: none;
  transition: border-color 0.2s;
}
.card textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}
.card textarea::placeholder {
  color: var(--text-tertiary);
}
.btn-primary {
  padding: 8px 18px;
  background: var(--accent-gradient);
  color: white;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}
.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(201,117,79,0.3);
}
.btn-secondary {
  padding: 8px 18px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-weight: 500;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-secondary:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.post-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.post-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--avatar-bg);
  color: var(--avatar-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}
.post-username {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.post-time {
  font-size: 12px;
  color: var(--text-tertiary);
}
.post-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
}
.post-images {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  margin-top: 12px;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.post-images img {
  width: 100%;
  height: 160px;
  object-fit: cover;
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles.css frontend/src/app/components/feed/feed.ts
git commit -m "feat: migrate feed component to CSS variable theming"
```

---

### Task 4: Update Settings with Theme Selector

**Files:**
- Modify: `frontend/src/app/components/settings/settings.ts`

- [ ] **Step 1: Rewrite settings.ts with CSS vars + add theme selector**

Inject `ThemeService`, add `selectedTheme: ThemeMode`, load from service on init.

Add theme selector HTML below the profile form, after a divider:

```html
<div class="divider"></div>

<div class="settings-section">
  <div class="section-label">Оформление</div>
  <div class="theme-options">
    <label class="theme-option" [class.active]="selectedTheme === 'light'" (click)="selectTheme('light')">
      <span class="theme-icon">☀️</span>
      <div>
        <div>Светлая</div>
        <div class="theme-desc">Тёплая кремовая гамма</div>
      </div>
      <span class="radio" style="margin-left:auto;"></span>
    </label>
    <label class="theme-option" [class.active]="selectedTheme === 'dark'" (click)="selectTheme('dark')">
      <span class="theme-icon">🌙</span>
      <div>
        <div>Тёмная</div>
        <div class="theme-desc">Глубокий тёмный фон, аккуратные акценты</div>
      </div>
      <span class="radio" style="margin-left:auto;"></span>
    </label>
    <label class="theme-option" [class.active]="selectedTheme === 'system'" (click)="selectTheme('system')">
      <span class="theme-icon">💻</span>
      <div>
        <div>Системная</div>
        <div class="theme-desc">Автоматически следует за настройками системы</div>
      </div>
      <span class="radio" style="margin-left:auto;"></span>
    </label>
  </div>
</div>
```

Add the following CSS to `styles.css`:
```css
.divider {
  height: 1px;
  background: var(--divider);
  margin: 24px 0;
}
.section-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}
.theme-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.theme-option {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}
.theme-option:hover {
  border-color: var(--accent);
  background: var(--accent-light);
}
.theme-option.active {
  border-color: var(--accent);
  background: var(--accent-light);
}
.theme-option .radio {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--border-default);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.2s;
}
.theme-option.active .radio {
  border-color: var(--accent);
}
.theme-option.active .radio::after {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
}
.theme-option .theme-icon {
  font-size: 20px;
  flex-shrink: 0;
}
.theme-option .theme-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 400;
  margin-top: 2px;
}
```

Add TypeScript:
```typescript
import { ThemeService, ThemeMode } from '../../services/theme.service';

// In class:
selectedTheme: ThemeMode = 'light';

constructor(
  private api: ApiService,
  private router: Router,
  private theme: ThemeService,
) {
  this.selectedTheme = this.theme.currentMode;
}

selectTheme(mode: ThemeMode) {
  this.selectedTheme = mode;
  this.theme.setTheme(mode);
}
```

Also migrate all existing form styles in settings to use CSS vars.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles.css frontend/src/app/components/settings/settings.ts
git commit -m "feat: add theme selector to settings page with CSS var theming"
```

---

### Task 5: Migrate Login, Register, Chat

**Files:**
- Modify: `frontend/src/app/components/login/login.ts`
- Modify: `frontend/src/app/components/register/register.ts`
- Modify: `frontend/src/app/components/chat/chat.ts`

- [ ] **Step 1: Migrate login.ts**

Replace all Tailwind color classes with CSS var references and the `.card` class. Login form should look like a card centered on the page. Replace `bg-white`, `text-gray-*`, `border-gray-*`, `bg-blue-600`, `bg-blue-100 text-blue-600`.

- [ ] **Step 2: Migrate register.ts**

Same pattern as login — card centered, CSS vars, no hardcoded colors.

- [ ] **Step 3: Migrate chat.ts**

Replace all color classes with CSS vars. Add chat-specific styles to `styles.css` if needed (`.chat-message-incoming`, `.chat-message-outgoing`, `.chat-sidebar`, etc.):

```css
.chat-message-incoming {
  background: var(--bg-surface-hover);
  color: var(--text-primary);
  align-self: flex-start;
}
.chat-message-outgoing {
  background: var(--accent-gradient);
  color: white;
  align-self: flex-end;
}
.chat-input input {
  border: 1px solid var(--border-default);
  background: var(--input-bg);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  font-family: var(--font-sans);
  font-size: 13px;
  outline: none;
}
.chat-input input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles.css frontend/src/app/components/login/login.ts frontend/src/app/components/register/register.ts frontend/src/app/components/chat/chat.ts
git commit -m "feat: migrate login, register, chat to CSS variable theming"
```

---

### Task 6: Polish and Verify

**Files:**
- Verify: all component files

- [ ] **Step 1: Check for remaining hardcoded Tailwind color classes**

Search for remaining color classes that should be CSS vars:
```bash
rg "bg-(white|gray|blue|red|green)" frontend/src/app/
rg "text-(gray|blue|red|green)-" frontend/src/app/
rg "border-(gray|blue)-" frontend/src/app/
```

Fix any remaining instances.

- [ ] **Step 2: Verify both themes render correctly**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: polish remaining color references for theme system"
```
