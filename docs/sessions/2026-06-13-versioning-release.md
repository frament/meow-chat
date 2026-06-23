# Session 2026-06-13 — Versioning strategy + install scripts + v1.0.0 release

## Versioning
- SemVer, breaking only in MAJOR
- `backend/version/version.go`
- `GET /api/version` endpoint

## Schema migration
- `schema_version` table (major/minor/patch)
- Startup MAJOR check → FATAL on mismatch; auto-update MINOR/PATCH

## Federation handshake
- Version in `FederationJoinRequest`/`FederationJoinResponse`
- MAJOR mismatch → 409 reject

## Install scripts
- Linux VDS: `make install` target; `contrib/systemd/meow-chat.service`; `contrib/nginx/meow-chat.conf`; `contrib/env.template`
- Windows: `install.bat` — builds backend + frontend, creates dirs, nssm instructions

## README
- Promo banner with favicon3.png + badges
- AI-Assisted Development section
- Installation/update/federation docs

## Release
- All commits pushed, tag `v1.0.0` created and pushed
