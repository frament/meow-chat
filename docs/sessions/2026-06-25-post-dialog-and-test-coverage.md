# Session: Post Dialog + Test Coverage

**Date:** 2026-06-25

## Tasks completed

### #12 — Вынести публикацию поста в отдельный dialog/page

**Design process:**
- Explored current feed implementation (inline `.card.new-post` form in feed.ts)
- Chose dialog approach (not separate page/router)
- Mockup of 3 variants: centered modal (A), bottom sheet (B), side panel (C)
- User chose A for desktop, B for mobile
- Mockup of 4 button placement options: inline (1), FAB (2), navbar (3), bottom tab (4)
- User chose option 1 (inline button replacing the form)

**Implementation:**
- Created `PostDialogComponent` at `frontend/src/app/components/post-dialog/post-dialog.ts`
- Dual layout: `hidden sm:block` centered modal (desktop), `sm:hidden` bottom sheet (mobile)
- Trigger button with dashed border replaces inline form in feed
- Dialog emits `postCreated` event; feed reloads on receipt
- All state (signals + regular fields) and methods extracted from FeedComponent

**Files created:**
- `frontend/src/app/components/post-dialog/post-dialog.ts` — component
- `frontend/src/app/components/post-dialog/post-dialog.component.spec.ts` — 18 tests
- `docs/superpowers/specs/2026-06-25-post-dialog-design.md` — design spec
- `docs/superpowers/plans/2026-06-25-post-dialog.md` — impl plan
- `mockups/post-dialog-proposal.html` — dialog mockup
- `mockups/post-button-placement.html` — button placement mockup

**Files modified:**
- `frontend/src/app/components/feed/feed.ts` — removed inline form, added trigger button + `<app-post-dialog>`
- `frontend/src/app/components/feed/feed.component.spec.ts` — updated tests (4 → 4, restructured)
- `TODO.md` — test counts, mark #12 done, add #14

### Test coverage improvements

Added 4 missing tests to PostDialogComponent:
- Form reset after successful post creation
- Upload progress bar rendering when uploading
- `createPostWithProgress` called when files selected
- Dialog stays open on API error

Total tests: 106 frontend + 189 backend = 295, 0 failures.

## New TODOs
- [ ] #13 — Version detection from GitHub
- [ ] #2 — Chat update bug (PWA invite → message not received)
- [ ] #8 — GIF sending in chat
- [ ] #14 — Search users with friend invite

## Commits
- `18f9e0e` docs: post dialog design spec (#12)
- `19f4f19` feat: add PostDialogComponent with desktop modal and mobile bottom sheet (#12)
- `c7dd854` refactor: replace inline post form with trigger button + PostDialogComponent (#12)
- `7c7531a` chore: update TODO.md, mark #12 as done
- `ffee0be` test: add missing PostDialog tests — form reset, progress bar, createPostWithProgress, API error
