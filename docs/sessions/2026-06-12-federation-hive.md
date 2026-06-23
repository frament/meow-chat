# Session 2026-06-12 — Federation/Hive mesh network

## Spec & plan
- Written to `docs/superpowers/specs/2026-06-12-federation-hive-design.md` and `docs/superpowers/plans/2026-06-12-federation-hive-plan.md`

## Database
- 6 federation tables (federation_servers, federation_users, federation_queue, federation_cache_entries, federation_network, federation_invites) + server_id on friends/messages/posts — `database/database.go`

## Backend
- Federation models: all request/response structs — `backend/models/federation.go`
- Transport: HTTP client with retry (1s→5s→15s), auth via X-Federation-Token — `backend/federation/transport.go`
- Queue: background worker with 30s retry interval — `backend/federation/queue.go`
- Health: ping ticker (60min), manual ping endpoint, auto-drain on recovery — `backend/federation/health.go`
- Incoming handlers: 12 endpoints (send-message, forward-post, forward-key, bulk/users/messages/posts/bulk-done, gossip, recover-server, ping, cache-stats) — `backend/federation/handler.go`
- BFS routing: shortest-path search across federation_network table — `backend/federation/route.go`
- Mediator: `IsRemoteUser`, `ResolveUserID` helpers — `backend/federation/mediator.go`
- LRU disk cache: per-server limit enforcement, accessed_at-based eviction — `backend/cache/lru_cache.go`
- Admin federation API: CRUD servers, CreateInvite, PingServer, BlockServer, UnblockServer, ClearServerCache, RestoreServer — `backend/handlers/admin_federation.go`
- Federation globals: package-level federation references — `backend/handlers/federation_globals.go`
- E2EE forwarding: PutKey forwards public key to all active federated peers — `backend/handlers/e2ee.go`
- Extended handlers: GetUsers UNION ALL federation_users, GetFeed UNION ALL federation_posts — `backend/handlers/handlers.go`
- Route registration: federation routes registered BEFORE AuthRequired, uses X-Federation-Token header auth — `main.go`
- CLI commands: `go run . admin federation list` + `go run . admin federation invite [n]` — `main.go`

## Frontend
- AdminFederationComponent standalone component, 11 API methods, /admin/federation route, "Федерация" nav link — `admin-federation.ts`, `api.service.ts`, `app.routes.ts`, `admin.ts`

## Architecture
- Hybrid model: REST + offline queue + gossip for unreliable connections
- Compositional (server_id, user_id) IDs
- Data duplicated on both servers
- Gossip TTL=5 hops
