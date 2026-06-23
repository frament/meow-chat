# Poll Message Type — Design Spec

## Overview
Add a "poll" message type to private and group chats. Users can create polls with multiple options, vote (single or multiple choice), and see live results.

## Data Model

### New Tables

#### `polls`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| message_id | INTEGER FK → messages(id) ON DELETE CASCADE | For private chat polls (nullable) |
| group_message_id | INTEGER FK → group_messages(id) ON DELETE CASCADE | For group chat polls (nullable) |
| question | TEXT NOT NULL | The poll question |
| is_multiple_choice | INTEGER DEFAULT 0 | 0 = single choice, 1 = multi |
| created_at | DATETIME DEFAULT NOW | |

One of `message_id` or `group_message_id` is set (mutually exclusive). A `CHECK` constraint ensures exactly one is non-NULL.

#### `poll_options`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| poll_id | INTEGER NOT NULL FK → polls(id) ON DELETE CASCADE | |
| text | TEXT NOT NULL | Option text |
| created_at | DATETIME DEFAULT NOW | |

#### `poll_votes`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| poll_option_id | INTEGER NOT NULL FK → poll_options(id) ON DELETE CASCADE | |
| user_id | INTEGER NOT NULL FK → users(id) | |
| created_at | DATETIME DEFAULT NOW | |
| UNIQUE(poll_option_id, user_id) | | One vote per option per user |

## Backend Changes

### Models (`models/models.go`)
- `Poll` struct: id, message_id, group_message_id, question, is_multiple_choice, options[], created_at
- `PollOption` struct: id, text, vote_count (computed)
- `PollVoteRequest`: option_id

### Sending a Poll Message
When `POST /api/messages` or `POST /api/group-chat-messages` is called with `type=poll`:
- Form fields: `poll_options[]` (repeated, min 2), `poll_multiple` ("true"/"false")
- `content` = poll question
- Validation: `poll_options` must have 2-20 items
- In the transaction that inserts the message, also:
  1. Insert into `polls`
  2. Insert each option into `poll_options`
- Response includes `poll` field on the message object

### Vote API
`POST /api/polls/:id/vote` (AuthRequired)
- Body: `{ option_id: number }`
- Validates: poll exists, message accessible, user hasn't already voted this option
- For single-choice polls: validates user hasn't voted ANY option in this poll
- Inserts vote, broadcasts `poll_update` via WebSocket

### Get Messages
`GetMessages` / `GetGroupMessages` now LEFT JOIN polls and poll_options when msg_type='poll'. Each message with a poll includes the full poll data with vote counts.

### WebSocket Events
- `poll_update` event sent to all chat participants when a vote is cast
- Payload: `{ type: "poll_update", message_id?, group_message_id?, poll_id, options: [{ id, text, vote_count, voted: bool }], total_votes }`

### Database Migration
Add `ALTER TABLE polls ADD COLUMN group_message_id INTEGER` and `CHECK` after initial create (or use conditional creation).

## Frontend Changes

### Message Type Menu (#9)
In `chat.ts`, filter `msgTypes` array to exclude `'poll'` when `selectedGroup === null`:
```typescript
get visibleMsgTypes() {
  return this.msgTypes.filter(t => t.id !== 'poll' || this.selectedGroup);
}
```

### Poll Creation UI
When `messageType === 'poll'`:
- Input area changes: text field for question + list of option inputs (2 minimum, add/remove buttons)
- Toggle for single/multiple choice
- Send button creates the poll message

### Poll Display
Poll messages render:
- Question text
- List of options with:
  - Radio button (single choice) or checkbox (multi choice)
  - Option text
  - Vote count and percentage bar (after voting)
  - "Vote" button (if not voted yet) or "Voted" indicator
- Total votes count at bottom

### Real-time Updates
WebSocket handler processes `poll_update` events and updates the poll display for affected messages.

## Testing

### Backend
- `TestCreatePollMessage`: send message with type=poll, verify poll + options created
- `TestCreatePollInGroup`: same for group messages
- `TestCastVote_SingleChoice`: vote for an option, verify count incremented
- `TestCastVote_SingleChoice_TwoOptions`: reject second vote
- `TestCastVote_MultipleChoice`: allow voting two options
- `TestCastVote_Unauthenticated`: 401 without auth
- `TestGetMessages_WithPoll`: verify poll data returned in message list

### Frontend
- Poll creation renders when messageType = 'poll'
- Poll display shows options with vote buttons
- Poll option hidden in private chats
