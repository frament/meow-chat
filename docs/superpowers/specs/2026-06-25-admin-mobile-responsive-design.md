# Admin Panel Mobile Responsive Design

## Problem
The admin panel (`frontend/src/app/components/admin/admin.ts`) uses HTML tables and tab buttons with inline styles. On mobile (<768px), tables overflow horizontally, tab buttons don't fit the viewport, action buttons are too small for touch, and the layout is cramped.

## Solution
Follow the dual-template pattern used by the Chat component: one DOM tree for desktop (`hidden sm:block`), another for mobile (`sm:hidden`).

### Desktop (unchanged)
- Tab buttons: horizontal row as-is
- Data: HTML `<table>` with current inline styles
- Disks usage bar, backup toolbar — all as-is

### Mobile
- **Tab navigation**: Replace tab buttons with `<select>` dropdown. User selects a tab → `activeTab` is set via `(change)="activeTab = $event.target.value"`. No emoji/icons in the native `<select>` since `<option>` only supports text.
- **User list** (`activeTab === 'users'`): Each user is a `<div class="card">` row with avatar (40px), username, email, status badge (online/offline/banned/admin), and action buttons (make admin, block/unblock, delete) styled with `currentColor` monochrome SVGs. Buttons are 32×32px touch targets.
- **File list** (`activeTab === 'files'`): Each file is a card row with file icon (36px rounded square), filename, size + date, path (truncated), and delete button. Disk usage shown as a separate card with progress bar.
- **Chat list** (`activeTab === 'chats'`): Each chat is a card row with chat icon (40px rounded), name, creator, member count, creation date, and delete button.
- **Backups** (`activeTab === 'backups'`): Each backup is a card with filename, size + date, and action buttons (download/restore/delete) using full-width layout. Create/upload buttons shown as toolbar at top.

### Responsive breakpoints
- Use Tailwind's `sm:` breakpoint (640px) to switch between desktop and mobile views
- Desktop: `hidden sm:block`
- Mobile: `sm:hidden`

### Design system compliance
- All icons use monochrome inline SVGs with `currentColor`
- Colors use CSS custom properties (`var(--text-primary)`, `var(--accent)`, etc.)
- Touch targets minimum 32×32px
- `pb-20` for bottom nav clearance
- Theme support (light/dark) through existing CSS variables

## Files Affected
- `frontend/src/app/components/admin/admin.ts` — add mobile template trees alongside existing desktop templates

## No New Dependencies
No new packages or imports. Reuses existing patterns (dual template, inline SVGs, Tailwind responsive classes).
