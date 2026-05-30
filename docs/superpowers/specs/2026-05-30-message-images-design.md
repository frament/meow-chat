# Message Images

Allow attaching multiple images to chat messages.

## Architecture

### Database
Add `message_images` table (mirrors `post_images`):
```sql
CREATE TABLE IF NOT EXISTS message_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
```

### Backend

**POST /api/messages** — change from JSON to `multipart/form-data`:
- Fields: `to_user_id` (string), `content` (string, optional), `images` (multiple files, optional)
- Save `content` + `to_user_id` to `messages` table, get `message_id`
- Save each uploaded image to `./uploads/messages/`, insert row into `message_images`
- Broadcast via WS with images array: `{"type":"message","from":N,"content":"...","images":["/uploads/messages/..."]}`

**GET /api/messages** — LEFT JOIN `message_images`, return `images[]` per message

**Models.Message** — add `Images []PostImage` field (reuse `PostImage`, or add new `MessageImage`)

### Frontend

**Message interface** — add `images?: { id: number; image_url: string }[]`

**sendMessage()** — accept `files?: File[]`, send as FormData

**Chat input** — add image picker button + preview strip above input (like feed's new post)

**Message bubble** — render images grid (like post-images) below text

**Cache** — images stored as part of Message in localStorage (automatic)

### Limits
- Max 10 files per message
- Max 10MB per file
- Allowed types: jpg, jpeg, png, gif, webp

## Files Changed

| File | Change |
|------|--------|
| `backend/models/models.go` | Add `Images` field to `Message` |
| `backend/database/database.go` | Add `message_images` table migration |
| `backend/handlers/handlers.go` | Rewrite `SendMessage` to multipart; update `GetMessages` with JOIN; update WS broadcast to include images |
| `backend/main.go` | Create `./uploads/messages/` directory on startup |
| `frontend/src/app/services/api.service.ts` | Update `Message` interface, `sendMessage` to accept files |
| `frontend/src/app/components/chat/chat.ts` | Image picker, preview, image rendering in bubbles, WS handler with images |
