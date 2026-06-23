# Session 2026-06-12 — PWA install banner dismiss + Avatar upload progress

## PWA install banner dismiss tracking
- Added `localStorage.getItem('installDismissed')` check before showing install banner — `app.ts`
- `dismissInstall()` persists flag via `localStorage.setItem('installDismissed', 'true')` — `app.ts`
- `appinstalled` and `installApp`.accepted both clear the flag — `app.ts`
- Banner no longer reappears after user dismisses it until app is installed

## Avatar upload progress bar
- Added `HttpEventType.UploadProgress` handling to `uploadAvatar()` — `api.service.ts`
- Added `uploadProgress` field + progress bar UI (percentage + gradient bar) in settings — `settings.ts`
