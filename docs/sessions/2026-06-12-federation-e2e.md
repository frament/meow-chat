# Session 2026-06-12 — Federation E2E test + cross-server message/post forwarding

## E2E test
- `backend/cmd/e2e-test/main.go` — starts 2 servers, tests connect, E2EE key sync, cross-server message, post forwarding, offline queue

## SendMessage forwarding
- Added `federation_users` lookup + `fedTransport.Send()` to `/api/federation/v1/send-message` — `handlers/handlers.go`

## GetMessages fix
- `LEFT JOIN` on `users`/`federation_users` with `COALESCE` for `from_username`, added `server_id` to scan — `handlers/handlers.go`

## WS broadcast
- `OnIncomingMessage` callback on `FederationHandler` → `h.SendToUser()` for real-time notification — `federation/handler.go`, `main.go`

## User sharing
- Both `AdminConnectFederation` and `HandleJoinInvite` now call `/api/federation/v1/share-users` on the peer — `handlers/admin_federation.go`, `federation/handler.go`

## CreatePost forwarding
- Public posts forwarded to all active federated servers — `handlers/handlers.go`

## GetFeed fix
- Federated posts query includes `p.is_public = 1` — `handlers/handlers.go`
