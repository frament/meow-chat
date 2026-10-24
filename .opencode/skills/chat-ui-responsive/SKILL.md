---
name: chat-ui-responsive
description: Maintaining and verifying the responsive layout of the MeowChat UI. Use when changing chat/feed/admin markup, merging desktop and mobile variants, touching breakpoints, pane switching (showMobileChat), safe-area spacing, or when a change must be checked visually on a phone-sized viewport.
---

# Responsive layout in this project

The UI exists in **two renderings** for several screens: a desktop layout and a mobile
one. That duplication is the source of a repeated bug class, and this file exists so the
next change does not rediscover it.

## The rule that matters most

**One source of truth for "which pane is visible."**

On mobile the chat shows the list *or* the thread, chosen by `showMobileChat`. On
desktop both are visible at once. Do not express this with two copies of the markup, and
do not express it by adding/removing a static utility class that also appears in the
template.

**This already broke once.** `chat.ts` had `[class.hidden]="showMobileChat"` next to a
static `hidden md:block`. The binding and the static class fought, and on a phone both
panes were visible. It is recorded in `AGENTS.md`; do not reintroduce it.

Preferred shapes, in order:

1. One template, with the difference carried by an explicit signal (`isMobile()` from
   `matchMedia`, same threshold as the CSS breakpoint — see below).
2. One template, with the few differing values returned by getters
   (`rowClass`, `avatarClass`, `nameClass`, …), each returning **exactly** the old string
   for its branch. This is provable by diff and is the recommended way to merge two
   variants without guessing.
3. Two variants in one component, chosen by an input — acceptable as an intermediate
   step, not as the destination.

Avoid `md:`-only utility swaps when the two looks differ in structure rather than size:
they cannot be reviewed by reading, only by looking.

## Docs, not memory

Angular and Tailwind move fast, and the training data lags: use the Context7 MCP
(`resolve-library-id`, then `query-docs`) for `@if`/`@for`, Tailwind v4, Angular control
flow and CSS features instead of recalling them. Context7 is configured for this project
in `opencode.json`.

## Breakpoints

| Utility | Min width | Used for |
|---|---|---|
| `sm:` | 640px | top vs bottom navigation, some paddings |
| `md:` | 768px | the whole desktop/mobile layout split |

Any JS breakpoint **must** use the same numbers. A mismatch produces the "both panes
visible" bug above without any CSS being wrong.

## Tokens, not literals

Style through the custom properties in `frontend/src/styles.css`: `--bg-body`,
`--bg-surface`, `--bg-elevated`, `--border-default`, `--divider`, `--radius-sm`,
`--radius-lg`, `--accent`, `--accent-light`, `--accent-gradient`, `--text-primary`,
`--text-secondary`, `--text-tertiary`, `--avatar-bg`, `--avatar-text`. Both themes must
work: never hardcode a colour that has a token.

Mobile-specific spacing that is easy to forget:

- bottom navigation: `padding-bottom: env(safe-area-inset-bottom)`;
- top of the mobile chat pane: `top: calc(3.5rem + env(safe-area-inset-top, 0px))`;
- the list is `pb-20` so the last row clears the bottom nav.

## Verifying a change

Tests cannot judge appearance. For any visual change, do all of this:

1. Run the stack: `make dev-backend` (port 8080, seeds `admin`/`admin`) and
   `make dev-frontend` (port 4200, proxies `/api` and `/uploads` to 8080).
2. Open `http://localhost:4200` in the browser panel, log in, navigate to the screen.
3. Take a screenshot at **mobile** viewport and at **desktop**.
4. Make the change; take the same two screenshots.
5. Compare them. The refactor must produce *no* difference; a redesign must produce the
   intended one.

Never report a layout change as done on the strength of green tests alone. That has
already produced two rounds of "green and unrelated to the question".

## Where the duplication lives

| File | What |
|---|---|
| `frontend/src/app/components/chat/chat.html` | thread, modals; list is extracted |
| `frontend/src/app/components/chat/chat-list.component.html` | list, both variants, selected by `mobile` |
| `frontend/src/app/components/feed/feed.ts` | feed, single layout |
| `frontend/src/app/components/admin/admin.ts` | admin tables, single layout |

The chat list is step A of the round-3 refactor: extracted with the markup unchanged.
Step B is collapsing its two variants — the plan and the exact list of differences are in
`BACKLOG.md` under «chat.ts: выравнивать или рефакторить».
