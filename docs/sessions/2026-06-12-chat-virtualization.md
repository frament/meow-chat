# Session 2026-06-12 — Chat list virtualization with @angular/cdk

## Changes
- Installed `@angular/cdk@20` — compatible with Angular 20
- Replaced two `@for` message lists (desktop + mobile) with `cdk-virtual-scroll-viewport` + `*cdkVirtualFor` — `chat.ts`
- Added `$any(item)` casts for union type `Message | { _divider: true }` in template — `chat.ts`
- Created `displayMessages` getter: merges unread divider as `{ _divider: true }` placeholder into flat array — `chat.ts`
- Updated `scrollToBottom()`: uses `CdkVirtualScrollViewport.scrollToIndex()` instead of `querySelectorAll` + `scrollTop` — `chat.ts`
- Added `@ViewChild('scrollViewportDesktop')` and `@ViewChild('scrollViewportMobile')` — `chat.ts`

## Result
Build verified (`ng build` passes without errors)
