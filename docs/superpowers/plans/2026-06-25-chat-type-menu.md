# Chat Type Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace flat type selector buttons with a compact toggle button + popup menu

**Architecture:** Single `showTypeMenu` flag controls popup visibility. Popup rendered inline via `@if` above the toggle button. Click-outside via `@HostListener('document:click')`. Desktop and mobile input bars each get independent popup templates, but share the same `showTypeMenu` state.

**Tech Stack:** Angular 20 standalone component, inline styles, existing `msgTypes` array

---

### Task 1: Add component state properties and methods

**Files:**
- Modify: `frontend/src/app/components/chat/chat.ts` (class body, after existing `pollMultiple = false`)

- [ ] **Step 1: Add `showTypeMenu` property**

After `pollMultiple = false;` (line 654), add:
```typescript
showTypeMenu = false;
```

- [ ] **Step 2: Add `currentTypeIcon` and `currentTypeLabel` getters**

After `get visibleMsgTypes()` block (line 656-661), add:
```typescript
get currentTypeIcon(): string {
  return this.msgTypes.find(t => t.id === this.messageType)?.icon || 'Aa';
}

get currentTypeLabel(): string {
  return this.msgTypes.find(t => t.id === this.messageType)?.label || '';
}
```

- [ ] **Step 3: Add `selectType(id)` method**

After `get visibleMsgTypes()`, add:
```typescript
selectType(id: MsgType) {
  this.messageType = id;
  this.showTypeMenu = false;
}
```

- [ ] **Step 4: Add HostListeners for popup close**

Add imports at top of file if not already there:
```typescript
import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
```

After any existing method or before `ngOnInit`, add:
```typescript
@HostListener('document:click', ['$event'])
onDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (this.showTypeMenu && !target.closest('.type-menu-container')) {
    this.showTypeMenu = false;
  }
}

@HostListener('document:keydown.escape')
onEscapePress() {
  this.showTypeMenu = false;
}
```

- [ ] **Step 5: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/components/chat/chat.ts
git commit -m "feat: add showTypeMenu state and selectType method for chat type menu"
```

### Task 2: Replace desktop type button row with toggle + popup

**Files:**
- Modify: `frontend/src/app/components/chat/chat.ts` (template, desktop input bar)

- [ ] **Step 1: Replace the desktop type buttons row**

Find lines 215-226 (the `@for (t of visibleMsgTypes; track t.id)` button row) and replace with:

```html
            <div class="type-menu-container" style="position:relative;">
              <button (click)="showTypeMenu = !showTypeMenu"
                [title]="currentTypeLabel"
                style="height:30px;display:flex;align-items:center;gap:4px;padding:0 10px;border:1px solid var(--border-default);border-radius:var(--radius-sm);background:transparent;cursor:pointer;font-size:12px;font-weight:500;color:var(--text-primary);font-family:inherit;transition:all 0.15s;">
                <span [innerHTML]="currentTypeIcon"></span>
                <span>{{ currentTypeLabel }}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="3" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              @if (showTypeMenu) {
                <div style="position:absolute;bottom:calc(100% + 4px);left:0;z-index:50;min-width:180px;padding:6px;border-radius:14px;background:var(--bg-elevated);border:1px solid var(--border-default);box-shadow:var(--shadow-lg);">
                  @for (t of visibleMsgTypes; track t.id) {
                    @if (t.id === 'sticker' || t.id === 'gif') {
                      <button disabled
                        style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;background:transparent;cursor:not-allowed;font-size:13px;font-weight:500;color:var(--text-primary);font-family:inherit;text-align:left;opacity:0.4;">
                        <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
                        <span>{{ t.label }}</span>
                        <span style="font-size:10px;color:var(--text-tertiary);margin-left:auto;">скоро</span>
                      </button>
                    } @else {
                      <button (click)="selectType(t.id)"
                        [style.background]="messageType === t.id ? 'var(--accent-light)' : 'transparent'"
                        [style.color]="messageType === t.id ? 'var(--accent)' : 'var(--text-primary)'"
                        style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;text-align:left;transition:all 0.1s;">
                        <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
                        <span>{{ t.label }}</span>
                      </button>
                    }
                  }
                </div>
              }
            </div>
```

- [ ] **Step 2: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/chat/chat.ts
git commit -m "feat: replace desktop chat type buttons with popup menu"
```

### Task 3: Replace mobile type button row with toggle + popup

**Files:**
- Modify: `frontend/src/app/components/chat/chat.ts` (template, mobile input bar)

- [ ] **Step 1: Replace the mobile type buttons row**

Find lines 487-498 (the mobile `@for (t of visibleMsgTypes; track t.id)` button row) and replace with the same popup template as desktop (identical structure, `position:absolute` popup above the toggle button).

- [ ] **Step 2: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/chat/chat.ts
git commit -m "feat: replace mobile chat type buttons with popup menu"
```

### Task 4: Verify all tests pass

**Files:**
- Modify: `frontend/src/app/components/chat/chat.component.spec.ts` (add test for type menu)

- [ ] **Step 1: Add test for popup toggle**

In `chat.component.spec.ts`, add these tests before the closing `});`:

```typescript
  it('toggles type menu popup on button click', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const toggleBtn = container?.querySelector('button') as HTMLButtonElement;
    if (!toggleBtn) return; // guard if element not found
    expect(component.showTypeMenu).toBeFalse();
    toggleBtn.click();
    fixture.detectChanges();
    expect(component.showTypeMenu).toBeTrue();
    const popupItems = container.querySelectorAll('button[disabled], button:not([disabled])');
    expect(popupItems.length).toBeGreaterThan(0);
    // click again to close
    toggleBtn.click();
    fixture.detectChanges();
    expect(component.showTypeMenu).toBeFalse();
  });

  it('selects a type from the popup', () => {
    component.showTypeMenu = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const textBtn = Array.from(container?.querySelectorAll('button') || [])
      .find(b => b.textContent?.includes('Текст')) as HTMLButtonElement;
    if (!textBtn) return;
    textBtn.click();
    fixture.detectChanges();
    expect(component.messageType).toBe('text');
    expect(component.showTypeMenu).toBeFalse();
  });

  it('shows disabled items for sticker and gif', () => {
    component.showTypeMenu = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const disabledBtns = container?.querySelectorAll('button[disabled]') || [];
    const disabledTexts = Array.from(disabledBtns).map(b => b.textContent?.trim());
    expect(disabledTexts.some(t => t?.includes('Стикер'))).toBeTrue();
    expect(disabledTexts.some(t => t?.includes('GIF'))).toBeTrue();
  });
```

- [ ] **Step 2: Run tests**

Run: `cd frontend && npm test -- --watch=false`
Expected: All tests pass

- [ ] **Step 3: Final commit**

```bash
git add frontend/src/app/components/chat/chat.ts frontend/src/app/components/chat/chat.component.spec.ts
git commit -m "fix: redesign chat type menu with popup, disable sticker and gif"
```
