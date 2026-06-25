# GIF Sending in Chat — Design Spec

## Overview

Add GIF sending support to the chat. Users can search Giphy via a modal picker, select a GIF, and send it as a message. Giphy API key is configured per-server in the admin panel.

## Architecture

```
Frontend (GIF picker modal)
  → GET /api/giphy/search?q=<query>
  ← { results: [{ id, url, preview_url, width, height }] }

Frontend (send GIF)
  → POST /api/messages (multipart: type=gif, images=[downloaded_gif])
  ← message object with msg_type='gif', images[]

Frontend (receive GIF via WS)
  ← { type: 'message', msg_type: 'gif', images: [...], ... }
```

Giphy API key is stored server-side. Frontend never sees it.

## 1. Database — `server_settings` table

New table to store arbitrary key-value settings:

```sql
CREATE TABLE IF NOT EXISTS server_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
```

Auto-migrated in `database.go`. Keys are simple strings; the Giphy key uses key `'giphy_api_key'`.

## 2. Backend — Admin settings endpoints

### `GET /api/admin/settings/giphy-key`
Returns `{ key: "..." }` with the current Giphy API key (masked partially for display: `Abcd****`).

### `PUT /api/admin/settings/giphy-key`
Body: `{ key: "new-giphy-api-key" }`
Stores the key in `server_settings`.

Both protected by `AdminRequired` middleware.

## 3. Backend — Giphy proxy endpoint

### `GET /api/giphy/search?q=<query>&offset=0&limit=20`
- Protected by `AuthRequired` middleware (same as message endpoints)
- Reads `giphy_api_key` from `server_settings`
- Proxies to `https://api.giphy.com/v1/gifs/search?api_key=<key>&q=<query>&offset=<offset>&limit=<limit>`
- Returns sanitized response: `{ results: [{ id, url, preview_url, width, height }] }`

### `GET /api/giphy/trending`
- Protected by `AuthRequired` middleware
- Same pattern but calls `https://api.giphy.com/v1/gifs/trending?api_key=<key>&offset=0&limit=20`
- Same response format.

## 4. Backend — Message sending (GIF reuses image pipeline)

No structural changes needed. The existing flow already:
- Accepts `msg_type='gif'` in the request
- Validates `.gif` extension
- Saves GIFs to `./uploads/messages/`
- Inserts into `message_images` table
- Broadcasts via WS with `images[]`

When the frontend sends a GIF message:
1. Frontend fetches the selected GIF from Giphy's `url` as a Blob
2. Creates a `File` from the Blob
3. Sends as multipart `POST /api/messages` with `type=gif` + `images=[file]`
4. Backend processes it identically to any image message

This approach reuses the entire image pipeline with zero backend changes for message sending.

## 5. Frontend — Admin panel field

Add a **Settings** tab (6th tab) in the admin component at `frontend/src/app/components/admin/`:

- Tab label: "Настройки"
- Contains: "Giphy API Key" text input + "Сохранить" button
- On load: `GET /api/admin/settings/giphy-key` → show masked key
- On save: `PUT /api/admin/settings/giphy-key` with the input value
- Success/error snackbar

## 6. Frontend — GIF picker modal

### Location
`frontend/src/app/components/chat/gif-picker/` — new standalone component.

### Trigger
When user clicks "GIF" in the message type menu (currently disabled, will be enabled):
- Opens `GifPickerComponent` as a modal overlay

### Component structure
```
GifPickerComponent
├── Header: "GIF" + "Giphy" badge + close (✕) button
├── Search bar: input field with debounce (300ms)
│   └── On empty → show trending
├── Results grid: 3-column, scrollable, virtual scroll if needed
│   └── Each item: thumbnail (aspect-ratio square), click to select
└── Loading indicator (spinner) during search
```

### Flow
1. Open modal → immediately fetch trending from `/api/giphy/trending`
2. User types → debounce 300ms → fetch `/api/giphy/search?q=...`
3. User clicks a GIF → modal closes
4. Frontend fetches the GIF from Giphy's `url` as a Blob
5. Creates a `File` from the Blob
6. Calls `sendMessage()` with `msg_type='gif'` and the file in `images`
7. Message appears in chat as a GIF bubble

### Message bubble rendering
The existing `@else if (($any(item).msg_type || 'text') === 'gif')` branch in `chat.html` currently shows placeholder text. Replace it with the same image rendering as regular images (clickable thumbnail grid), since GIFs are now stored the same way.

Remove the separate `gif` branch — it will fall through to the default image display.

## 7. Files changed

### Backend
- `backend/database/database.go` — add `server_settings` table auto-migration
- `backend/handlers/admin.go` — add `GetGiphyKey`, `UpdateGiphyKey` handlers
- `backend/handlers/giphy.go` — new file: Giphy proxy handlers
- `backend/models/` — add Giphy search request/response types
- `backend/main.go` — register new routes

### Frontend
- `frontend/src/app/components/admin/admin.ts` — add "Settings" tab with Giphy key input
- `frontend/src/app/components/admin/admin.html` — add tab content
- `frontend/src/app/components/chat/gif-picker/gif-picker.ts` — new component
- `frontend/src/app/components/chat/gif-picker/gif-picker.html` — new template
- `frontend/src/app/components/chat/gif-picker/gif-picker.spec.ts` — new tests
- `frontend/src/app/components/chat/chat.ts` — enable GIF button, open picker, handle selection
- `frontend/src/app/components/chat/chat.html` — update GIF bubble rendering
- `frontend/src/app/services/api.service.ts` — add `searchGiphy()`, `getGiphyTrending()`, `getGiphyKey()`, `updateGiphyKey()` methods

## 8. Testing

- Admin settings endpoints: unit tests for get/update Giphy key
- Giphy proxy: unit test with mock Giphy API response
- GIF picker component: open, search, select, close
- Chat integration: GIF button click opens picker, selecting GIF sends message
- GIF message display: bubble renders GIF thumbnail correctly

## 9. Edge cases & error handling

- **No Giphy key configured**: GIF button in type menu shows a tooltip "Настройте Giphy API Key в админке" and remains disabled
- **Giphy API rate limit / error**: show error toast "Ошибка загрузки GIF" with retry button
- **GIF download failure**: show error toast and keep modal open
- **Empty search results**: show "Ничего не найдено" placeholder
- **Very large GIFs**: same size limits as images (10MB max, enforced by backend)

## 10. Future considerations

- Multi-provider support (Tenor) — architecture supports it via the proxy pattern
- GIF favorites / recent — can be added to the settings table later
