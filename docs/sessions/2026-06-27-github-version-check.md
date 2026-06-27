# Session 2026-06-27 — GitHub version update detection (#13)

## Summary
Implemented a system to check for new versions from GitHub releases.

## Backend
- `backend/version/version.go` — Added `Compare()` (semver comparison), `IsDev()`, mutable `GitHubRepo`/`GitHubAPIBase` vars
- `backend/handlers/update.go` — `GET /api/check-update` endpoint: fetches GitHub API for latest release, compares with current version, 1h cache
- `backend/handlers/update_test.go` — 6 tests (no releases, new version, up-to-date, dev→release, unreachable, cache)
- `backend/main.go` — route registered (line 126)

## Frontend
- `api.service.ts` — Added `getVersion()` and `checkUpdate()` methods
- `app.ts` — Auto-check every 6h + on window focus, banner with download link for admin users
- `settings.ts` — Version info section (current + latest), "Check GitHub" and "Check PWA" buttons
- Fixed test mocks in `settings.component.spec.ts` and `app.component.spec.ts`

## Config
- `TODO.md` — Marked #13 done, updated test counts (301 total)

## Files changed
- `backend/version/version.go`
- `backend/handlers/update.go` (new)
- `backend/handlers/update_test.go` (new)
- `backend/main.go`
- `frontend/src/app/services/api.service.ts`
- `frontend/src/app/app.ts`
- `frontend/src/app/components/settings/settings.ts`
- `frontend/src/app/components/settings/settings.component.spec.ts`
- `frontend/src/app/app.component.spec.ts`
- `TODO.md`
