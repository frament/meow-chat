# MdPipe XSS fix + test suite cleanup

## Changes

### frontend/src/app/pipes/md.pipe.ts (+2 lines)
- HTML-escape input before `marked.parse()` — prevent XSS via raw `<script>` tags in markdown input
- Only escape `&` → `&amp;` and `<` → `&lt;`; leave `>` untouched so blockquote syntax still works

### frontend/src/app/pipes/md.pipe.spec.ts (+137 lines) — new
17 tests: bold, italic, code (inline/block), links with target=_blank, blockquotes, ordered/unordered lists, headings, tables (with alignment), strikethrough, empty/null input, plain text, HTML escaping (XSS), line breaks, horizontal rules

### frontend/src/app/components/chat/chat.component.spec.ts
- Add `chatHeaderInfo: signal(null)` to mock API (ngOnDestroy calls .set())

### frontend/src/app/components/layout/layout.component.spec.ts
- Add `chatHeaderInfo: signal(null)` to mock API (template reads chatHeaderInfo())

### frontend/src/app/components/admin/admin.component.spec.ts
- Add `getVersion`, `checkUpdate` spies to mock API (ngOnInit calls loadVersion)
- Update button labels: "Пользователи" / "Файлы" (not "Управление пользователями/файлами")
- Update tab count 6→7 (stickers tab added)

### frontend/src/app/app.component.spec.ts
- Add `checkUpdate`, `checkHealth` return values to mock API

### frontend/src/app/components/chat/chat.component.spec.ts
- Fix type toggle test: button shows icon 'Aa' not label 'Текст'

## Commands
```sh
cd frontend && npx ng test --no-watch --browsers=ChromeHeadless
```
