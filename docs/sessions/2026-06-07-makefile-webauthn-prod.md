# Session 2026-06-07 — Makefile admin commands + WebAuthn production fix

## Makefile
- Added `admin`, `admin-remove`, `admin-list`, `reset-password` targets using `docker compose exec ./server` — `Makefile`

## WebAuthn production fix
- Added `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_ORIGIN` env vars to `docker-compose.yml` (pass-through from host or `.env`) — fixes Face ID on production where defaults (`localhost:4200`) mismatch real domain
