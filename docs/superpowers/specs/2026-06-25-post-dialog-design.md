# Post Dialog — Design Spec

## Problem

The post creation form is currently rendered inline at the top of the feed page as a `.card.new-post` div with a textarea, image picker, previews, progress bar, public toggle, and submit button. This takes up significant vertical space, clutters the feed on mobile, and mixes post-creation logic with post-display logic in a single component.

## Goal

Extract post creation into a separate standalone dialog component with two visual modes: centered modal on desktop, bottom sheet on mobile. Replace the inline form with a compact button.

## Architecture

### New component: `PostDialogComponent`

- Location: `frontend/src/app/components/post-dialog/post-dialog.ts`
- Standalone, no router
- Inline template (matching project conventions)
- `@Output() postCreated = new EventEmitter<void>()` — emitted after successful post creation
- No `@Input()` — self-contained state

### State (Angular signals)

| Signal | Type | Description |
|--------|------|-------------|
| `showDialog` | `WritableSignal<boolean>` | Controls dialog visibility |
| `newPostContent` | `string` | Textarea value (two-way bound) |
| `selectedFiles` | `File[]` | Picked image files |
| `previews` | `string[]` | Object URL previews for selected files |
| `uploading` | `WritableSignal<boolean>` | True while upload in progress |
| `uploadProgress` | `WritableSignal<number>` | 0–100 upload percentage |
| `isPublic` | `boolean` | Public/private toggle |

### Methods

| Method | Responsibility |
|--------|----------------|
| `open()` | Set `showDialog` to true |
| `close()` | Reset form state, set `showDialog` to false |
| `onFilesSelected(event)` | Read `FileList`, push to `selectedFiles`, generate preview URLs |
| `removeFile(index)` | Revoke object URL, remove from arrays |
| `createPost()` | Submit post: text-only path or multipart with progress |
| `onBackdropClick(event)` | Close if click target is backdrop (not dialog content) |
| `onKeydown(event)` | Close on Escape |
| `ngOnDestroy()` | Revoke all remaining object URLs (memory cleanup) |

### FeedComponent changes

**Removed** from `feed.ts`:
- `.card.new-post` div and all its template content
- Signals/variables: `newPostContent`, `selectedFiles`, `previews`, `uploading`, `uploadProgress`, `isPublic`
- Methods: `createPost()`, `onFilesSelected()`, `removeFile()`

**Added** to `feed.ts`:
- Injected `PostDialogComponent` (via `import` + `viewChild` or template reference)
- Compact button at top of feed: `<button (click)="postDialog.open()">Написать пост...</button>`
- Template has `<app-post-dialog (postCreated)="loadFeed()" />`
- After dialog emits `postCreated`, feed calls `this.loadFeed()`

### ApiService

No changes required. The existing `createPost()` and `createPostWithProgress()` endpoints are reused.

## Layout

### Desktop — Centered modal

```
┌─────────────────────────────────────┐
│         ✕                           │
│         НОВЫЙ ПОСТ                   │
│                                     │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │                               │  │
│  └───────────────────────────────┘  │
│                                     │
│  [🖼 Фото]  [☐ Всем]  [Опубликовать] │
│                                     │
│  ████████░░ 80% (if uploading)      │
└─────────────────────────────────────┘
```

- Overlay: fixed inset 0, background `rgba(0,0,0,0.45)`, z-index 50
- Modal: white bg, border-radius 16px, max-width 480px, padding 24px, centered
- Animation: fade up + slight scale (0.97 → 1), 200ms ease
- Close: ✕ button, backdrop click, Escape

### Mobile — Bottom sheet

```
┌─────────────────────────────────────┐
│           ═══ (handle 4px)          │
│                                     │
│  НОВЫЙ ПОСТ                         │
│                                     │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │                               │  │
│  └───────────────────────────────┘  │
│                                     │
│  [preview strip, 64x64 thumbs]      │
│                                     │
│  ───────────────────────────────    │  ← separator
│  [🖼 Фото]  [☐ Всем] [Опубликовать] │
│                                     │
│  ████████░░ 80%                     │
└─────────────────────────────────────┘
```

- Overlay: fixed inset 0, background `rgba(0,0,0,0.35)`, z-index 50
- Sheet: white bg, border-radius 20px 20px 0 0, padding 20px 24px 24px, bottom-aligned
- Pull handle: 40px × 4px, centered, `background #ddd`, border-radius 2px
- Animation: slide up from bottom, 250ms ease
- Close: swipe down (touch drag), ✕ button, backdrop click, Escape

### Trigger button (feed.ts)

Replaces the current `.card.new-post` form. Simple dashed-border button:

```
┌──────────────────────────────────────┐
│  ✏️  Написать пост...                 │
└──────────────────────────────────────┘
```

- Width 100%, border `2px dashed #ccc`, border-radius 12px
- Padding 12px 16px, text color gray
- Hover: border + text change to accent color (`#6c5ce7`)

## Data flow

1. User clicks "Написать пост..." button in feed
2. PostDialog opens with appropriate layout (desktop modal or mobile sheet)
3. User types content, optionally picks images (previews shown, multiple files allowed)
4. Optionally toggles "Показать всем"
5. User clicks "Опубликовать"
6. If text-only: calls `api.createPost()`
   If with images: calls `api.createPostWithProgress()` showing progress bar
7. On success: dialog emits `postCreated`, closes, form resets; feed listens and calls `loadFeed()`
8. On error: error shown inline in dialog, dialog stays open

## Error handling

- Network error during upload: show error message inside dialog (not alert)
- Empty content + no images: submit button disabled or ignored
- File too large / wrong type: handled by `accept="image/*"` + backend validation (unchanged)

## Testing

- PostDialogComponent: 6+ tests
  - Opens and renders
  - Closes on backdrop click
  - Closes on Escape
  - Desktop shows centered modal, mobile shows bottom sheet
  - Image selection shows previews
  - Public toggle works
  - Create post calls API
- FeedComponent: update existing tests to use PostDialog pattern
- No existing test should break (all behavior preserved, just moved)

## File changes

| File | Action |
|------|--------|
| `frontend/src/app/components/post-dialog/post-dialog.ts` | **Create** |
| `frontend/src/app/components/post-dialog/post-dialog.component.spec.ts` | **Create** |
| `frontend/src/app/components/feed/feed.ts` | **Edit** — remove form, add button + dialog ref |
| `frontend/src/app/components/feed/feed.component.spec.ts` | **Edit** — update tests |

## Non-goals

- No router changes (no `/create-post` route)
- No backend changes
- No shared dialog abstraction (we match project conventions of inline dialogs)
- No changes to post display, reactions, image viewer, or delete functionality
