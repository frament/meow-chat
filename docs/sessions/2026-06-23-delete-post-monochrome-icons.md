# Session 2026-06-23 — Delete posts + monochrome icons

## Backend
- `DELETE /api/posts/:id` — new handler `DeletePost` in `handlers/handlers.go` (checks own post or admin, deletes image files from disk, then DB row; CASCADE handles `post_images` and `post_reactions`)
- Route registered in `main.go`
- Tests: `TestDeletePost_OwnPost`, `TestDeletePost_AdminDeletesOtherPost`, `TestDeletePost_NotOwner`, `TestDeletePost_NotFound` — `posts_test.go`

## Frontend
- `deletePost(id)` method in `api.service.ts`
- Delete button (✕) in post header, visible only for own posts or admin — `feed.ts`
- Changed `api` from `private` to `protected` for template access

## Monochrome icons
Replaced all colorful emoji UI icons with monochrome SVGs (`currentColor`):
- `feed.ts`: 📷 → SVG camera
- `chat.ts`: 📌×6, ℹ️×2, 🎯×2, 📊×2, 🔒×2, ⏳×2, 🖼/🎯/📊 (msgTypes) → SVGs
- `settings.ts`: ☀️🌙💻 → SVGs sun/moon/monitor
- `admin-federation.ts`: 🔄⛔✅🧹 → SVGs refresh/ban/check/trash
- `add-friend.ts`, `join-group.ts`: 🎉 — removed

## AGENTS.md
- Added rule: «Monochrome icons: All UI icons must use monochrome SVGs with `currentColor`, never colorful emoji. The only exception is reaction emojis on posts.»
- Updated pinned users section (removed 📌 from docs)

## Tests
- Backend: +4 DeletePost tests (all pass)
- Frontend: +2 tests (delete button shown/hidden), +86 total
