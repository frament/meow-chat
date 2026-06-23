# Session 2026-06-23 — Poll message type (#9, #10) + test infrastructure fixes

## Poll implementation
- **Backend**: `polls.go` — CastVote, loadPollOptions, broadcastPollUpdate, loadPollsForMessages
- **Backend**: `handlers.go` — SendMessage creates poll in transaction when `type=poll`; WS broadcast includes `pollData`; GetMessages loads polls via `loadPollsForMessages`
- **Backend**: `groups.go` — same for SendGroupMessage / GetGroupMessages
- **Backend**: `models/models.go` — Poll, PollOption, PollVoteRequest, Message.Poll
- **Backend**: `database/database.go` — polls, poll_options, poll_votes tables
- **Backend**: `main.go` — `POST /polls/:id/vote` route
- **Frontend**: `api.service.ts` — PollOption/Poll interfaces, castVote(), sendMessage/sendGroupMessage/...WithProgress accept pollOptions + pollMultiple
- **Frontend**: `chat.ts` — poll creation UI, poll display with voting, `visibleMsgTypes` filtering poll in private chats, WS poll_update handler
- **13 backend tests** for polls (send, validation, vote, group poll, multi-choice, etc.)

## Bug fixes
- **Test infrastructure**: Changed `setupTestApp` from `:memory:` (per-connection isolation — each connection sees empty DB) to temp file with `MaxOpenConns=2`. Fixed all cross-test DB pollution.
- **Column name mismatch**: `group_message_images` INSERT used `message_id` instead of `group_message_id`
- **TestCastVote_GroupPoll**: Added `INSERT INTO users` for second user (was implicitly depending on shared in-memory DB from previous tests)

## Stats
- **262 tests total** (176 Go + 86 Angular) — all pass
- **4 files changed**, **2 new files**
