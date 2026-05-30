# Message Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow attaching multiple images to chat messages (like posts).

**Architecture:** New `message_images` table, `POST /api/messages` switches to multipart/form-data, `GET /api/messages` returns images array, WS broadcasts images array. Frontend adds image picker + preview in input area and renders images inside message bubbles.

**Tech Stack:** Go + Fiber + SQLite, Angular 20 + Tailwind v4

---

### Task 1: Backend — Add Image to Message model

**Files:**
- Modify: `backend/models/models.go:15-22`

- [ ] **Add Images field to Message struct**

```go
type Message struct {
	ID         int64     `json:"id"`
	FromUserID int64     `json:"from_user_id"`
	ToUserID   int64     `json:"to_user_id"`
	Content    string    `json:"content"`
	CreatedAt  time.Time `json:"created_at"`
	FromUser   string    `json:"from_user,omitempty"`
	Images     []PostImage `json:"images,omitempty"`
}
```

- [ ] **Commit**

```bash
git add backend/models/models.go
git commit -m "feat: add Images field to Message model"
```

---

### Task 2: Backend — Add message_images table migration + uploads dir

**Files:**
- Modify: `backend/database/database.go:78`
- Modify: `backend/main.go:25`

- [ ] **Add message_images CREATE TABLE to migration**

Insert after `pinned_users` entry:

```go
		`CREATE TABLE IF NOT EXISTS message_images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER NOT NULL,
			image_url TEXT NOT NULL,
			FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
		)`,
```

- [ ] **Add uploads/messages directory creation**

In `backend/database/database.go` after the existing uploads dir creation (line 97):

```go
	if err := os.MkdirAll("./uploads/messages", 0755); err != nil {
		log.Fatal("Failed to create messages uploads directory:", err)
	}
```

- [ ] **Commit**

```bash
git add backend/database/database.go
git commit -m "feat: add message_images table migration"
```

---

### Task 3: Backend — Rewrite SendMessage to accept multipart

**Files:**
- Modify: `backend/handlers/handlers.go:377-397`

- [ ] **Replace SendMessage handler**

Old:

```go
func (h *Handler) SendMessage(c *fiber.Ctx) error {
	fromUserID := c.Locals("userId").(int64)

	var req models.CreateMessageRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	result, err := database.DB.Exec(
		"INSERT INTO messages (from_user_id, to_user_id, content) VALUES (?, ?, ?)",
		fromUserID, req.ToUserID, req.Content,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to send message"})
	}

	id, _ := result.LastInsertId()
	h.broadcast <- wsMessage{from: int64(fromUserID), to: req.ToUserID, content: req.Content}

	return c.Status(201).JSON(fiber.Map{"id": id, "message": "Message sent"})
}
```

New:

```go
func (h *Handler) SendMessage(c *fiber.Ctx) error {
	fromUserID := c.Locals("userId").(int64)

	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid form data"})
	}

	toUserID, err := strconv.ParseInt(form.Value["to_user_id"][0], 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid recipient"})
	}

	content := ""
	if vals, ok := form.Value["content"]; ok && len(vals) > 0 {
		content = vals[0]
	}

	files := form.File["images"]
	if len(files) > 10 {
		return c.Status(400).JSON(fiber.Map{"error": "Maximum 10 images allowed"})
	}

	tx, err := database.DB.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to send message"})
	}
	defer tx.Rollback()

	result, err := tx.Exec(
		"INSERT INTO messages (from_user_id, to_user_id, content) VALUES (?, ?, ?)",
		fromUserID, toUserID, content,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to send message"})
	}

	messageID, _ := result.LastInsertId()

	var images []string
	for _, file := range files {
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".gif" && ext != ".webp" {
			continue
		}
		if file.Size > 10*1024*1024 {
			continue
		}

		filename := fmt.Sprintf("%d_%s", messageID, file.Filename)
		savePath := filepath.Join("./uploads/messages", filename)
		if err := c.SaveFile(file, savePath); err != nil {
			continue
		}
		imageURL := "/uploads/messages/" + filename
		images = append(images, imageURL)

		tx.Exec("INSERT INTO message_images (message_id, image_url) VALUES (?, ?)", messageID, imageURL)
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save message"})
	}

	h.broadcast <- wsMessage{
		from:    fromUserID,
		to:      toUserID,
		content: content,
		images:  images,
	}

	return c.Status(201).JSON(fiber.Map{"id": messageID, "message": "Message sent"})
}
```

- [ ] **Update wsMessage struct to include images**

```go
type wsMessage struct {
	from    int64
	to      int64
	content string
	images  []string
}
```

- [ ] **Update WS broadcast in runHub to include images**

Old:

```go
			err := conn.WriteJSON(fiber.Map{
				"type":    "message",
				"from":    msg.from,
				"content": msg.content,
			})
```

New:

```go
			payload := fiber.Map{
				"type":    "message",
				"from":    msg.from,
				"content": msg.content,
			}
			if len(msg.images) > 0 {
				payload["images"] = msg.images
			}
			err := conn.WriteJSON(payload)
```

- [ ] **Commit**

```bash
git add backend/handlers/handlers.go
git commit -m "feat: SendMessage accepts multipart with images"
```

---

### Task 4: Backend — Update GetMessages to return images

**Files:**
- Modify: `backend/handlers/handlers.go:341-375`

- [ ] **Replace GetMessages handler**

Old:

```go
func (h *Handler) GetMessages(c *fiber.Ctx) error {
	authUserID := c.Locals("userId").(int64)
	userID1 := c.Query("user1")
	userID2 := c.Query("user2")

	id1, _ := strconv.ParseInt(userID1, 10, 64)
	id2, _ := strconv.ParseInt(userID2, 10, 64)
	if id1 != authUserID && id2 != authUserID {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}

	rows, err := database.DB.Query(`
		SELECT m.id, m.from_user_id, m.to_user_id, m.content, m.created_at, u.username
		FROM messages m
		JOIN users u ON m.from_user_id = u.id
		WHERE (m.from_user_id = ? AND m.to_user_id = ?)
		   OR (m.from_user_id = ? AND m.to_user_id = ?)
		ORDER BY m.created_at ASC
		LIMIT 100
	`, userID1, userID2, userID2, userID1)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch messages"})
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(&m.ID, &m.FromUserID, &m.ToUserID, &m.Content, &m.CreatedAt, &m.FromUser); err != nil {
			continue
		}
		messages = append(messages, m)
	}
	return c.JSON(messages)
}
```

New:

```go
func (h *Handler) GetMessages(c *fiber.Ctx) error {
	authUserID := c.Locals("userId").(int64)
	userID1 := c.Query("user1")
	userID2 := c.Query("user2")

	id1, _ := strconv.ParseInt(userID1, 10, 64)
	id2, _ := strconv.ParseInt(userID2, 10, 64)
	if id1 != authUserID && id2 != authUserID {
		return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
	}

	rows, err := database.DB.Query(`
		SELECT m.id, m.from_user_id, m.to_user_id, m.content, m.created_at, u.username
		FROM messages m
		JOIN users u ON m.from_user_id = u.id
		WHERE (m.from_user_id = ? AND m.to_user_id = ?)
		   OR (m.from_user_id = ? AND m.to_user_id = ?)
		ORDER BY m.created_at ASC
		LIMIT 100
	`, userID1, userID2, userID2, userID1)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch messages"})
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(&m.ID, &m.FromUserID, &m.ToUserID, &m.Content, &m.CreatedAt, &m.FromUser); err != nil {
			continue
		}
		messages = append(messages, m)
	}

	// Fetch images for all messages
	msgIDs := make([]interface{}, 0, len(messages))
	idPos := make([]int64, 0, len(messages))
	for _, m := range messages {
		msgIDs = append(msgIDs, m.ID)
		idPos = append(idPos, m.ID)
	}
	if len(msgIDs) > 0 {
		placeholders := make([]string, len(msgIDs))
		for i := range msgIDs {
			placeholders[i] = "?"
		}
		imgRows, err := database.DB.Query(
			"SELECT id, message_id, image_url FROM message_images WHERE message_id IN ("+strings.Join(placeholders, ",")+")",
			msgIDs...,
		)
		if err == nil {
			defer imgRows.Close()
			imgMap := make(map[int64][]models.PostImage)
			for imgRows.Next() {
				var img models.PostImage
				var msgID int64
				if err := imgRows.Scan(&img.ID, &msgID, &img.ImageURL); err == nil {
					imgMap[msgID] = append(imgMap[msgID], img)
				}
			}
			for i := range messages {
				if imgs, ok := imgMap[messages[i].ID]; ok {
					messages[i].Images = imgs
				}
			}
		}
	}

	return c.JSON(messages)
}
```

- [ ] **Commit**

```bash
git add backend/handlers/handlers.go
git commit -m "feat: GetMessages returns message images"
```

---

### Task 5: Backend — Verify compilation

**Files:**
- (no changes)

- [ ] **Build backend**

```bash
cd backend && go build .
```
Expected: No errors.

- [ ] **Start backend, send a test message with curl**

```bash
cd backend && DB_PATH=./data/chat.db go run . &
# Login to get token, then:
curl -X POST http://localhost:8080/api/messages \
  -H "Authorization: Bearer <token>" \
  -F "to_user_id=1" \
  -F "content=hello with image" \
  -F "images=@test.jpg"
```
Expected: 201 with message id.

- [ ] **Commit any remaining files**

```bash
git add -A
git commit -m "fix: backend compilation fixes"
```

---

### Task 6: Frontend — Update Message interface and sendMessage

**Files:**
- Modify: `frontend/src/app/services/api.service.ts:30-36, 145-150`

- [ ] **Add images field to Message interface**

```typescript
export interface Message {
  id: number;
  from_user_id: number;
  to_user_id: number;
  content: string;
  created_at: string;
  from_user: string;
  images?: { id: number; image_url: string }[];
}
```

- [ ] **Update sendMessage to accept optional files**

```typescript
  sendMessage(toUserId: number, content: string, files: File[] = []) {
    const formData = new FormData();
    formData.append('to_user_id', String(toUserId));
    formData.append('content', content);
    for (const file of files) {
      formData.append('images', file);
    }
    return this.http.post<{ id: number; message: string }>(
      `${this.baseUrl}/messages`,
      formData
    );
  }
```

- [ ] **Commit**

```bash
git add frontend/src/app/services/api.service.ts
git commit -m "feat: add images to Message interface and sendMessage"
```

---

### Task 7: Frontend — Update ChatComponent with image support

**Files:**
- Modify: `frontend/src/app/components/chat/chat.ts`

- [ ] **Add image input state fields**

```typescript
  selectedFiles: File[] = [];
  previews: string[] = [];
```

Add these alongside the existing fields (after `messageContent = ''`).

- [ ] **Add image picker and file methods**

Add before `sendMessage()`:

```typescript
  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        if (this.selectedFiles.length >= 10) break;
        this.selectedFiles.push(file);
        const reader = new FileReader();
        reader.onload = (e) => this.previews.push(e.target!.result as string);
        reader.readAsDataURL(file);
      }
      input.value = '';
    }
  }

  removeFile(index: number) {
    this.selectedFiles.splice(index, 1);
    this.previews.splice(index, 1);
  }
```

- [ ] **Update sendMessage to pass files**

```typescript
  sendMessage() {
    if (!this.messageContent.trim() && this.selectedFiles.length === 0) return;
    if (!this.selectedUser) return;

    const content = this.messageContent;
    const files = [...this.selectedFiles];
    this.selectedFiles = [];
    this.previews = [];

    this.api.sendMessage(this.selectedUser.id, content, files).subscribe({
      next: () => {
        const msg: Message = {
          id: Date.now(),
          from_user_id: this.currentUserId,
          to_user_id: this.selectedUser!.id,
          content: content,
          created_at: new Date().toISOString(),
          from_user: this.api.currentUser()?.username ?? '',
        };
        this.messages.push(msg);
        localStorage.setItem(this.messageCacheKey(this.selectedUser!.id), JSON.stringify(this.messages));
        this.messageContent = '';
      },
    });
  }
```

- [ ] **Update WS message handler to include images**

Old in connectWebSocket:

```typescript
          const msg: Message = {
            id: Date.now(),
            from_user_id: data.from,
            to_user_id: this.currentUserId,
            content: data.content,
            created_at: new Date().toISOString(),
            from_user: this.selectedUser.username,
          };
```

New:

```typescript
          const msg: Message = {
            id: Date.now(),
            from_user_id: data.from,
            to_user_id: this.currentUserId,
            content: data.content,
            created_at: new Date().toISOString(),
            from_user: this.selectedUser.username,
            images: data.images ? data.images.map((url: string) => ({ id: 0, image_url: url })) : undefined,
          };
```

- [ ] **Update message rendering template — add images grid below text**

In both desktop and mobile message rendering templates, add below `<p>{{ msg.content }}</p>`:

```html
                  @if (msg.images && msg.images.length > 0) {
                    <div class="post-images" style="margin-top:6px;">
                      @for (img of msg.images; track img.id) {
                        <img [src]="img.image_url" class="rounded-lg" style="width:100%;height:120px;object-fit:cover;cursor:pointer;"
                          (click)="openImage(img.image_url)">
                      }
                    </div>
                  }
```

- [ ] **Add image picker UI in chat input area**

Below the send button (or before the input), add:

```html
            <label class="flex items-center justify-center shrink-0 cursor-pointer"
              style="width:36px;height:36px;border-radius:var(--radius-sm);color:var(--text-tertiary);"
              title="Добавить фото">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <input type="file" multiple accept="image/*" (change)="onFilesSelected($event)" class="hidden">
            </label>
```

- [ ] **Add preview strip above input**

Between the messages area and the chat input, add when there are previews:

```html
          @if (previews.length > 0) {
            <div class="flex gap-2 px-4 py-2 overflow-x-auto" style="border-top:1px solid var(--divider);">
              @for (preview of previews; track $index) {
                <div class="relative w-16 h-16 shrink-0">
                  <img [src]="preview" class="w-full h-full object-cover rounded-lg" style="border:1px solid var(--border-default);">
                  <button (click)="removeFile($index)" class="absolute -top-2 -right-2 w-5 h-5 rounded-full text-xs flex items-center justify-center hover:opacity-90" style="background:#e74c3c;color:white;">✕</button>
                </div>
              }
            </div>
          }
```

- [ ] **Add openImage method**

```typescript
  openImage(url: string) {
    window.open(url, '_blank');
  }
```

- [ ] **Add previews and selectedFiles to mobile input area too**

Same image picker label and same preview strip in the mobile chat input section.

- [ ] **Commit**

```bash
git add frontend/src/app/components/chat/chat.ts
git commit -m "feat: image picker, preview, and rendering in chat messages"
```

---

### Self-Review Checklist

- [ ] **Spec coverage:** message_images table (Task 2), multipart SendMessage (Task 3), GetMessages returns images (Task 4), Message model updated (Task 1), frontend Message interface + sendMessage (Task 6), image picker/preview/rendering (Task 7), cache includes images (automatic from Message serialization).
- [ ] **Placeholder scan:** No TBDs, TODOs, or incomplete sections.
- [ ] **Type consistency:** `models.PostImage` reused for message images on backend; `{ id: number; image_url: string }[]` in TS matches. `data.images` from WS is `string[]` (URLs), mapped to `{ id: 0, image_url: url }` in frontend.
