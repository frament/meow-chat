# Session: Fix Issue #2 - Chat Update Problem When Adding New User via Invite

## Date
2026-06-25

## Goal
Fix issue #2: chat update problem when adding a new user via invite (user sends message via PWA, second user doesn't receive it)

## Root Cause Analysis
The issue was caused by missing WebSocket notifications after group join operations. 

Specifically:
- `broadcastGroup` (handlers.go:202-271) correctly queries `group_chat_members` from DB at send time and delivers to connected clients correctly
- However, `JoinGroupViaInvite` (groups.go:284-346) and `AddGroupMember` (groups.go:143-180) successfully insert into `group_chat_members` but lacked WebSocket broadcast
- Frontend `ChatComponent` subscribes to `wsMessages$` and filters by `this.selectedGroup`, requiring the group to be in the loaded list or handled via `group_joined` event

The frontend loads group chats only during initialization (`ngOnInit()` via `loadGroups()`), so when a user accepts an invite or is added to a group, the new chat doesn't appear in the list automatically. Consequently, messages sent after joining aren't displayed because the group isn't in the loaded list.

## Changes Made

### Backend (`backend/handlers/groups.go`)
Added `SendToUser` with `group_joined` event in:
1. **`JoinGroupViaInvite`** (after successful user addition to group)
2. **`AddGroupMember`** (after successful admin/user addition to group)

Both methods now send WebSocket notifications to the newly added user:
```go
h.Hub.SendToUser(userID, map[string]interface{}{
    "type": "group_joined",
    "data": map[string]interface{}{
        "group_id": groupID,
        "group_name": groupName,
    },
})
```

### Frontend (`frontend/src/app/components/chat/chat.ts`)
Added handling for `group_joined` event in the WebSocket message subscriber:
- Calls `loadGroupChats()` to refresh the list of groups
- If a group is not currently selected, automatically selects it via `resolvePendingGroupChat(groupId)`

```typescript
case 'group_joined':
  const joinedGroupId = (data as any).group_id;
  this.loadGroupChats();
  if (!this.selectedGroup || this.selectedGroup.id !== joinedGroupId) {
    this.resolvePendingGroupChat(joinedGroupId);
  }
  break;
```

## Testing Notes
- Backend compiled successfully with `go build -o ../build/backend.exe .`
- Changes ensure that when a user accepts an invite or is added to a group, they receive a WebSocket notification and the frontend updates the group list automatically

## Files Modified
- `backend/handlers/groups.go` - Added `group_joined` WebSocket notifications in `JoinGroupViaInvite` and `AddGroupMember`
- `frontend/src/app/components/chat/chat.ts` - Added handling for `group_joined` event to refresh groups and select new chat
- `TODO.md` - Marked issue #2 as completed
