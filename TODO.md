# TODO

## Testing — Backend (core → periphery)

### Session 1
- [ ] backend/auth/jwt_test.go — generate/validate/parse tokens
- [ ] backend/database/database_test.go — InitDB, SeedAdmin, invite/CRUD
- [ ] backend/handlers/auth_test.go — AuthRequired, AdminRequired, GetUserID
- [ ] backend/handlers/core_test.go — Register/Login/Refresh/GetMe/UpdateProfile
- [ ] backend/handlers/messages_test.go — SendMessage (text + images), GetMessages, DeleteMessage
- [ ] backend/handlers/posts_test.go — CreatePost, GetFeed, AddComment, ToggleReaction

### Session 2
- [ ] backend/handlers/groups_test.go — CRUD, invite, messages
- [ ] backend/handlers/admin_test.go — users, make-admin, files
- [ ] backend/handlers/push_test.go — subscribe/unsubscribe, vapid key
- [ ] backend/handlers/webauthn_test.go — begin/finish registration/login
- [ ] backend/handlers/devices_test.go — register, auth request/approve/poll, key backup/recover
- [ ] backend/handlers/backup_test.go — list/create/upload/delete/restore, maintenance
- [ ] backend/handlers/federation_test.go — servers, ping, block, cache, invites

### Session 3
- [ ] backend/federation/transport_test.go — Send, SendDirect, DownloadFile
- [ ] backend/federation/queue_test.go — enqueue/dequeue/retry/drain
- [ ] backend/federation/route_test.go — BFS, GetRoute, max hops
- [ ] backend/federation/health_test.go — ping, status transitions
- [ ] backend/federation/handler_test.go — incoming message, share-users, forward-post, gossip
- [ ] backend/federation/mediator_test.go — IsRemoteUser, ResolveUserID

### Session 4
- [ ] backend/backup/backup_test.go — CreateBackup (ZIP), RestoreFromZip
- [ ] backend/backup/config_test.go — load/save/validate
- [ ] backend/backup/process_test.go — FindProcess, StopProcess, IsDocker
- [ ] backend/cache/lru_cache_test.go — Set/Get/Remove/Clear/Eviction/Stats

## Testing — Frontend

### Session 5
- [ ] frontend theme.service.spec.ts — getPreferredTheme, setTheme, localStorage, matchMedia
- [ ] frontend notification.service.spec.ts — requestPermission, show, playChime, tab visibility
- [ ] frontend auth.interceptor.spec.ts — Bearer token, 401 refresh, 5xx passthrough
- [ ] frontend api.service.spec.ts — HTTP methods (login/register/messages/posts/groups/admin)
- [ ] frontend api.service.spec.ts — WebSocket lifecycle, signals (currentUser, unreadCounts)
- [ ] frontend crypto.service.spec.ts — device keypair, ECDH, encrypt/decrypt, recovery

### Session 6
- [ ] frontend app.component.spec.ts — theme init, WS reconnect, PWA install, maintenance, update banner
- [ ] frontend login.component.spec.ts — form submit, redirect, biometric, localStorage username
- [ ] frontend register.component.spec.ts — form with invite, error handling
- [ ] frontend feed.component.spec.ts — create post, feed, reactions, image grid, viewer
- [ ] frontend chat.component.spec.ts — messages, send, optimistic, unread divider, virtual scroll, WS

### Session 7
- [ ] frontend layout.component.spec.ts — nav (desktop/mobile), badges, admin link
- [ ] frontend settings.component.spec.ts — profile, avatar, theme, WebAuthn, invites, friends, devices
- [ ] frontend admin.component.spec.ts — users, files, chats, backups tabs
- [ ] frontend admin-federation.component.spec.ts — server table, add/remove/ping/block
- [ ] frontend join-group/add-friend/device-auth spec — simple component tests

## Done
- [x] Chat list virtualization with `@angular/cdk`
- [x] PWA install banner dismiss tracking (localStorage)
- [x] Avatar upload progress indicator
- [x] Backup upload progress indicator
- [x] Testing design spec written and committed
