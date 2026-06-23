# Session 2026-06-07 — Message types + Group chats + Last username save

## Features

### Message types
- Added `msg_type` field to messages model (text/image/sticker/gif/poll) — `backend/models/models.go`, `database/database.go`
- Backend: `wsMessage` struct gains `msgType`, `SendMessage` reads `type` from form, hub broadcasts `msg_type` in WS payload — `handlers/handlers.go`
- Frontend: `MsgType` type, `msg_type` in `Message`/`WsMessage`, type selector row (5 types) in chat input, rendering switches on `msg_type` — `chat.ts`, `api.service.ts`, `app.ts`

### Group chats
- Tables: `group_chats`, `group_chat_members`, `group_chat_invites`, `group_messages`, `group_message_images` — `database/database.go`
- Group endpoints: CRUD groups, add/remove members, invite tokens (link + QR), send/receive group messages — `handlers/groups.go`
- WebSocket group broadcast: `broadcastGroup` channel, distributes to all online group members, push to offline — `handlers/handlers.go`

### Frontend group UI
- Group section in chat sidebar, create group modal, group info (members + invites), sender names in group messages, WS handling for `group_message` events — `chat.ts`
- Join group page: `/join-group?token=` with invite validation + accept button — `join-group.ts`, `app.routes.ts`
- All modals use inline styles (no external CSS dependencies)

### Last username
- Login page auto-fills last entered username from localStorage, saved on login/biometric success — `login.ts`
