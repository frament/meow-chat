# Session 2026-06-06 — Invite-only registration + notification fixes

## Features

### Invite tokens
- `invite_tokens` table (id, created_by, token, max_uses, use_count, expires_at) — `database/database.go`
- Invite API: `POST/GET/DELETE /api/invites`, `GET /api/invite/:token` — `handlers/handlers.go`, `main.go`
- Registration now requires `invite_token`, validated before user creation — `handlers/handlers.go`, `models/models.go`

### Frontend invite UI
- `InviteToken` interface, `createInvite/getMyInvites/deleteInvite/checkInvite` — `api.service.ts`
- Register page: reads `?invite=TOKEN` from URL or shows manual input — `register.ts`
- Settings — Invites section to create, copy link, fullscreen QR overlay, revoke invites — `settings.ts`
- QR code: `qrcode` npm package, fullscreen overlay with copy button — `settings.ts`, `package.json`

## Notification fixes
- Push sound fix: reused Audio element, handled `play()` promise rejection, added `silent: true` to Notification to suppress system sound — `notification.service.ts`
- SW push fix: added `silent: true` to `showNotification()` in SW — `sw-push-handler.js`
- Sound caching: added `.mp3` to `ngsw-config.json` asset patterns — `ngsw-config.json`
