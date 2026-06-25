# GIF Sending in Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GIF sending to chat via Giphy integration with admin-configurable API key.

**Architecture:** Giphy API key stored in `server_settings` DB table. Frontend searches GIFs through backend proxy (`/api/giphy/search`). Selected GIF downloaded client-side, uploaded as a message image (reuses existing image pipeline). Admin panel has "Settings" tab for key management.

**Tech Stack:** Go (Fiber v2), SQLite, Angular 20, Giphy REST API

---

### Task 1: Backend — Add `server_settings` table

**Files:**
- Modify: `backend/database/database.go` (add table + GetSetting/SetSetting helpers)

- [ ] **Step 1: Add table to migration**

Add after the last `CREATE TABLE IF NOT EXISTS` in `migrate()`:

```go
`CREATE TABLE IF NOT EXISTS server_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
)`,
```

- [ ] **Step 2: Add GetSetting/SetSetting helpers**

Add after `migrate()` function:

```go
func GetSetting(key string) (string, error) {
    var value string
    err := DB.QueryRow("SELECT value FROM server_settings WHERE key = ?", key).Scan(&value)
    if err == sql.ErrNoRows {
        return "", nil
    }
    return value, err
}

func SetSetting(key, value string) error {
    _, err := DB.Exec("INSERT OR REPLACE INTO server_settings (key, value) VALUES (?, ?)", key, value)
    return err
}
```

- [ ] **Step 3: Verify build**

Run: `cd backend && go build ./...`
Expected: success

- [ ] **Step 4: Commit**

```bash
git add backend/database/database.go
git commit -m "feat: add server_settings table with GetSetting/SetSetting"
```

### Task 2: Backend — Add Giphy types to models

**Files:**
- Modify: `backend/models/models.go`

- [ ] **Step 1: Add Giphy response models**

Add before closing `package models`:

```go
type GiphySearchRequest struct {
    Query  string `json:"q"`
    Offset int    `json:"offset"`
    Limit  int    `json:"limit"`
}

type GiphyResult struct {
    ID          string `json:"id"`
    URL         string `json:"url"`
    PreviewURL  string `json:"preview_url"`
    Width       int    `json:"width"`
    Height      int    `json:"height"`
}

type GiphySearchResponse struct {
    Results []GiphyResult `json:"results"`
}

type GiphyKeyResponse struct {
    Key   string `json:"key"`
    HasKey bool  `json:"has_key"`
}

type GiphyKeyUpdateRequest struct {
    Key string `json:"key"`
}
```

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./...`
Expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/models/models.go
git commit -m "feat: add Giphy API models"
```

### Task 3: Backend — Add admin Giphy key handlers

**Files:**
- Modify: `backend/handlers/handlers.go` (add handlers after existing admin handlers)

- [ ] **Step 1: Add GetGiphyKey handler**

Add after last admin handler (before line ~1836 or at end of file):

```go
func (h *Handler) GetGiphyKey(c *fiber.Ctx) error {
    key, err := database.GetSetting("giphy_api_key")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to read setting"})
    }
    masked := ""
    if len(key) > 4 {
        masked = key[:4] + strings.Repeat("*", len(key)-4)
    }
    return c.JSON(models.GiphyKeyResponse{
        Key:    masked,
        HasKey: key != "",
    })
}

func (h *Handler) UpdateGiphyKey(c *fiber.Ctx) error {
    var req models.GiphyKeyUpdateRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
    }
    if err := database.SetSetting("giphy_api_key", req.Key); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to save setting"})
    }
    return c.JSON(fiber.Map{"ok": true})
}
```

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./...`
Expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/handlers/handlers.go
git commit -m "feat: add admin Giphy API key handlers"
```

### Task 4: Backend — Create Giphy proxy handler

**Files:**
- Create: `backend/handlers/giphy.go`

- [ ] **Step 1: Create giphy.go**

```go
package handlers

import (
    "encoding/json"
    "io"
    "net/http"
    "net/url"
    "strconv"

    "my-chat-backend/database"
    "my-chat-backend/models"

    "github.com/gofiber/fiber/v2"
)

func (h *Handler) SearchGiphy(c *fiber.Ctx) error {
    apiKey, err := database.GetSetting("giphy_api_key")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to read Giphy key"})
    }
    if apiKey == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Giphy API key not configured"})
    }

    query := c.Query("q")
    offset, _ := strconv.Atoi(c.Query("offset", "0"))
    limit, _ := strconv.Atoi(c.Query("limit", "20"))

    u, _ := url.Parse("https://api.giphy.com/v1/gifs/search")
    q := u.Query()
    q.Set("api_key", apiKey)
    q.Set("q", query)
    q.Set("offset", strconv.Itoa(offset))
    q.Set("limit", strconv.Itoa(limit))
    u.RawQuery = q.Encode()

    resp, err := http.Get(u.String())
    if err != nil {
        return c.Status(502).JSON(fiber.Map{"error": "Failed to reach Giphy"})
    }
    defer resp.Body.Close()

    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return c.Status(502).JSON(fiber.Map{"error": "Failed to read Giphy response"})
    }

    var giphyResp struct {
        Data []struct {
            ID     string `json:"id"`
            Images struct {
                Original struct {
                    URL    string `json:"url"`
                    Width  string `json:"width"`
                    Height string `json:"height"`
                } `json:"original"`
                PreviewGif struct {
                    URL string `json:"url"`
                } `json:"preview_gif"`
            } `json:"images"`
        } `json:"data"`
    }
    if err := json.Unmarshal(body, &giphyResp); err != nil {
        return c.Status(502).JSON(fiber.Map{"error": "Failed to parse Giphy response"})
    }

    results := make([]models.GiphyResult, 0, len(giphyResp.Data))
    for _, d := range giphyResp.Data {
        w, _ := strconv.Atoi(d.Images.Original.Width)
        h, _ := strconv.Atoi(d.Images.Original.Height)
        results = append(results, models.GiphyResult{
            ID:         d.ID,
            URL:        d.Images.Original.URL,
            PreviewURL: d.Images.PreviewGif.URL,
            Width:      w,
            Height:     h,
        })
    }

    return c.JSON(models.GiphySearchResponse{Results: results})
}

func (h *Handler) TrendingGiphy(c *fiber.Ctx) error {
    apiKey, err := database.GetSetting("giphy_api_key")
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to read Giphy key"})
    }
    if apiKey == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Giphy API key not configured"})
    }

    offset, _ := strconv.Atoi(c.Query("offset", "0"))
    limit, _ := strconv.Atoi(c.Query("limit", "20"))

    u, _ := url.Parse("https://api.giphy.com/v1/gifs/trending")
    q := u.Query()
    q.Set("api_key", apiKey)
    q.Set("offset", strconv.Itoa(offset))
    q.Set("limit", strconv.Itoa(limit))
    u.RawQuery = q.Encode()

    resp, err := http.Get(u.String())
    if err != nil {
        return c.Status(502).JSON(fiber.Map{"error": "Failed to reach Giphy"})
    }
    defer resp.Body.Close()

    body, err := io.ReadAll(resp.Body)
    if err != nil {
        return c.Status(502).JSON(fiber.Map{"error": "Failed to read Giphy response"})
    }

    var giphyResp struct {
        Data []struct {
            ID     string `json:"id"`
            Images struct {
                Original struct {
                    URL    string `json:"url"`
                    Width  string `json:"width"`
                    Height string `json:"height"`
                } `json:"original"`
                PreviewGif struct {
                    URL string `json:"url"`
                } `json:"preview_gif"`
            } `json:"images"`
        } `json:"data"`
    }
    if err := json.Unmarshal(body, &giphyResp); err != nil {
        return c.Status(502).JSON(fiber.Map{"error": "Failed to parse Giphy response"})
    }

    results := make([]models.GiphyResult, 0, len(giphyResp.Data))
    for _, d := range giphyResp.Data {
        w, _ := strconv.Atoi(d.Images.Original.Width)
        h, _ := strconv.Atoi(d.Images.Original.Height)
        results = append(results, models.GiphyResult{
            ID:         d.ID,
            URL:        d.Images.Original.URL,
            PreviewURL: d.Images.PreviewGif.URL,
            Width:      w,
            Height:     h,
        })
    }

    return c.JSON(models.GiphySearchResponse{Results: results})
}
```

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./...`
Expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/handlers/giphy.go
git commit -m "feat: add Giphy search/trending proxy handlers"
```

### Task 5: Backend — Register routes in main.go

**Files:**
- Modify: `backend/main.go`

- [ ] **Step 1: Add Giphy routes after `admin` group, before `bak` group**

Find the `admin` group and add after it (before `bak := api.Group(...)`):

```go
admin.Get("/settings/giphy-key", h.GetGiphyKey)
admin.Put("/settings/giphy-key", h.UpdateGiphyKey)

giphy := api.Group("/giphy", handlers.AuthRequired)
giphy.Get("/search", h.SearchGiphy)
giphy.Get("/trending", h.TrendingGiphy)
```

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./...`
Expected: success

- [ ] **Step 3: Commit**

```bash
git add backend/main.go
git commit -m "feat: register Giphy routes"
```

### Task 6: Frontend — API service methods

**Files:**
- Modify: `frontend/src/app/services/api.service.ts`

- [ ] **Step 1: Add Giphy-related interfaces and methods**

Add after existing interfaces:

```typescript
export interface GiphyResult {
  id: string;
  url: string;
  preview_url: string;
  width: number;
  height: number;
}

export interface GiphySearchResponse {
  results: GiphyResult[];
}

export interface GiphyKeyResponse {
  key: string;
  has_key: boolean;
}
```

Add methods to `ApiService` class:

```typescript
searchGiphy(query: string, offset = 0, limit = 20) {
  return this.http.get<GiphySearchResponse>(`${this.apiUrl}/giphy/search`, {
    params: { q: query, offset, limit }
  });
}

getGiphyTrending(offset = 0, limit = 20) {
  return this.http.get<GiphySearchResponse>(`${this.apiUrl}/giphy/trending`, {
    params: { offset, limit }
  });
}

getGiphyKey() {
  return this.http.get<GiphyKeyResponse>(`${this.apiUrl}/admin/settings/giphy-key`);
}

updateGiphyKey(key: string) {
  return this.http.put<{ok: boolean}>(`${this.apiUrl}/admin/settings/giphy-key`, { key });
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: success

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/services/api.service.ts
git commit -m "feat: add Giphy API methods to ApiService"
```

### Task 7: Frontend — Add Settings tab to admin panel

**Files:**
- Modify: `frontend/src/app/components/admin/admin.ts`

- [ ] **Step 1: Add Settings tab button and mobile option**

In desktop tabs, add after the Federation button:

```html
<button (click)="activeTab = 'settings'"
  [style.background]="activeTab === 'settings' ? 'var(--accent-light)' : 'transparent'"
  style="padding:8px 16px;border-radius:8px 8px 0 0;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);transition:all 0.2s;">
  Настройки
</button>
```

In mobile select, add after `<option value="federation">Федерация</option>`:

```html
<option value="settings">Настройки</option>
```

- [ ] **Step 2: Add Settings tab content**

Add after the `@if (activeTab === 'federation')` block and before the closing `</div>` of desktop:

```html
@if (activeTab === 'settings') {
  <div class="mb-6">
    <h3 class="text-base font-semibold mb-4" style="color:var(--text-primary);">Giphy API Key</h3>
    <p class="text-sm mb-3" style="color:var(--text-secondary);">
      API-ключ для поиска GIF через Giphy.
    </p>
    <div class="flex gap-2 items-start flex-wrap">
      <input #giphyKeyInput type="text" [(ngModel)]="giphyKey"
        [placeholder]="giphyHasKey ? 'Введите новый ключ...' : 'Введите Giphy API Key...'"
        style="flex:1;min-width:200px;box-sizing:border-box;">
      <button (click)="saveGiphyKey()" [disabled]="giphySaving"
        style="padding:8px 16px;border-radius:var(--radius-sm);border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:14px;font-weight:500;">
        {{ giphySaving ? '...' : 'Сохранить' }}
      </button>
    </div>
    @if (giphyKeyMsg) {
      <p class="mt-2 text-sm" [style.color]="giphyKeyOk ? '#27ae60' : '#e74c3c'">{{ giphyKeyMsg }}</p>
    }
    @if (giphyHasKey) {
      <p class="mt-2 text-sm" style="color:var(--text-tertiary);">
        Текущий ключ: <code style="font-size:12px;">{{ giphyMaskedKey }}</code>
      </p>
    }
  </div>
}
```

Add the same content after the `@if (activeTab === 'federation')` block in the mobile section.

- [ ] **Step 3: Update component class**

Update `activeTab` type:

```typescript
activeTab: 'users' | 'files' | 'chats' | 'backups' | 'federation' | 'settings' = 'users';
```

Add new properties:

```typescript
// Giphy key
giphyKey = '';
giphyMaskedKey = '';
giphyHasKey = false;
giphySaving = false;
giphyKeyMsg = '';
giphyKeyOk = false;
```

Add `FormsModule` to imports (check if already imported — add if not):

```typescript
import { FormsModule } from '@angular/forms';
```

Update imports in component decorator:

```typescript
imports: [DatePipe, AdminFederationComponent, FormsModule],
```

Add `loadGiphyKey` and `saveGiphyKey` methods:

```typescript
loadGiphyKey() {
  this.api.getGiphyKey().subscribe({
    next: (res) => {
      this.giphyHasKey = res.has_key;
      this.giphyMaskedKey = res.key;
    },
    error: () => {},
  });
}

saveGiphyKey() {
  if (!this.giphyKey.trim()) return;
  this.giphySaving = true;
  this.giphyKeyMsg = '';
  this.api.updateGiphyKey(this.giphyKey.trim()).subscribe({
    next: () => {
      this.giphySaving = false;
      this.giphyKeyMsg = 'Ключ сохранён';
      this.giphyKeyOk = true;
      this.giphyHasKey = true;
      this.giphyMaskedKey = this.giphyKey.trim().slice(0, 4) + '*'.repeat(Math.max(0, this.giphyKey.trim().length - 4));
      this.giphyKey = '';
      setTimeout(() => this.giphyKeyMsg = '', 3000);
    },
    error: () => {
      this.giphySaving = false;
      this.giphyKeyMsg = 'Ошибка сохранения ключа';
      this.giphyKeyOk = false;
    },
  });
}
```

Call `loadGiphyKey()` in `ngOnInit()`:

```typescript
ngOnInit() {
  this.loadUsers();
  this.loadFiles();
  this.loadGiphyKey();
}
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: success

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/components/admin/admin.ts
git commit -m "feat: add Settings tab with Giphy API key management"
```

### Task 8: Frontend — Create GIF picker component

**Files:**
- Create: `frontend/src/app/components/chat/gif-picker/gif-picker.ts`

- [ ] **Step 1: Create directory**

Run: `mkdir -p frontend/src/app/components/chat/gif-picker`

- [ ] **Step 2: Create GifPickerComponent**

```typescript
import { Component, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, GiphyResult } from '../../../services/api.service';
import { Subject, Subscription, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

@Component({
  selector: 'app-gif-picker',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      (click)="close()">
      <div class="bg-[var(--bg-body)] rounded-2xl w-[90%] max-w-[480px] max-h-[80vh] overflow-hidden shadow-2xl"
        (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="flex items-center px-4 py-3 border-b" style="border-color:var(--border-default);">
          <span class="font-semibold text-sm" style="color:var(--text-primary);">GIF</span>
          <span class="ml-2 text-[10px] px-2 py-0.5 rounded-full" style="background:var(--bg-tertiary);color:var(--text-secondary);">Giphy</span>
          <button (click)="close()" class="ml-auto w-7 h-7 flex items-center justify-center rounded-full"
            style="border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:14px;">✕</button>
        </div>

        <!-- Search bar -->
        <div class="px-4 py-2">
          <input type="text" [(ngModel)]="searchQuery" (ngModelChange)="onSearchChange($event)"
            placeholder="Поиск GIF..."
            style="width:100%;box-sizing:border-box;padding:8px 12px;border-radius:999px;border:1px solid var(--border-default);background:var(--bg-tertiary);font-size:13px;color:var(--text-primary);outline:none;font-family:inherit;">
        </div>

        <!-- Results grid -->
        <div class="px-4 pb-4 overflow-y-auto" style="max-height:50vh;">
          @if (loading()) {
            <div class="flex justify-center py-8">
              <span class="text-sm" style="color:var(--text-tertiary);">Загрузка...</span>
            </div>
          } @else if (results().length === 0) {
            <div class="flex justify-center py-8">
              <span class="text-sm" style="color:var(--text-tertiary);">
                {{ searchQuery ? 'Ничего не найдено' : 'Введите запрос для поиска GIF' }}
              </span>
            </div>
          } @else {
            <div class="grid gap-2" style="grid-template-columns:1fr 1fr 1fr;">
              @for (gif of results(); track gif.id) {
                <div class="aspect-square rounded-lg overflow-hidden cursor-pointer bg-cover bg-center"
                  [style.backgroundImage]="'url(' + gif.preview_url + ')'"
                  (click)="selectGif(gif)"
                  style="background-size:cover;">
                </div>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class GifPickerComponent {
  searchQuery = '';
  results = signal<GiphyResult[]>([]);
  loading = signal(false);
  gifSelected = output<GiphyResult | undefined>();

  private searchSubject = new Subject<string>();
  private searchSub?: Subscription;

  constructor(private api: ApiService) {
    this.searchSub = this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((q) => {
        if (!q.trim()) {
          return this.api.getGiphyTrending();
        }
        return this.api.searchGiphy(q);
      }),
    ).subscribe({
      next: (res) => {
        this.results.set(res.results);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });

    // Load trending on open
    this.loading.set(true);
    this.api.getGiphyTrending().subscribe({
      next: (res) => {
        this.results.set(res.results);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onSearchChange(q: string) {
    this.loading.set(true);
    this.searchSubject.next(q);
  }

  selectGif(gif: GiphyResult) {
    this.gifSelected.emit(gif);
  }

  close() {
    this.searchSub?.unsubscribe();
    this.gifSelected.emit(undefined);
  }
}
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: success

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/chat/gif-picker/
git commit -m "feat: add GifPickerComponent"
```

### Task 9: Frontend — Wire GIF picker into chat component

**Files:**
- Modify: `frontend/src/app/components/chat/chat.ts`

- [ ] **Step 1: Add giphyHasKey check**

Add to component class:

```typescript
giphyHasKey = false;

constructor(
  protected api: ApiService,
  private route: ActivatedRoute,
  protected router: Router,
  private crypto: CryptoService,
) {
  // Check if Giphy key is configured
  this.api.getGiphyKey().subscribe({
    next: (res) => this.giphyHasKey = res.has_key,
  });
}
```

- [ ] **Step 2: Import GifPickerComponent**

Add to imports:

```typescript
import { GifPickerComponent, GiphyResult } from './gif-picker/gif-picker';
```

Add to component `imports` array:

```typescript
imports: [DatePipe, FormsModule, ScrollingModule, GifPickerComponent],
```

- [ ] **Step 2: Add showGifPicker property and methods**

Add to component class:

```typescript
showGifPicker = false;

openGifPicker() {
  if (!this.giphyHasKey) {
    return;
  }
  this.showGifPicker = true;
}

onGifSelected(gif: GiphyResult | undefined) {
  this.showGifPicker = false;
  if (!gif) return;

  // Download the GIF from Giphy's original URL and send as message
  fetch(gif.url)
    .then(res => res.blob())
    .then(blob => {
      const file = new File([blob], `giphy_${gif.id}.gif`, { type: 'image/gif' });
      this.selectedFiles = [file];
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.previews = [e.target?.result as string];
      };
      reader.readAsDataURL(blob);
      this.messageType = 'gif'; // Set type to gif so backend stores correct msg_type
      this.sendMessage();
    })
    .catch(() => {
      // Error handled silently — message not sent
    });
}
```

- [ ] **Step 3: Enable GIF button in type menu**

Find the type menu button for GIF (sticker/gif disabled block around line 520) and change from disabled to active:

Replace:

```html
@if (t.id === 'sticker' || t.id === 'gif') {
  <button disabled
    style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;background:transparent;cursor:not-allowed;font-size:13px;font-weight:500;color:var(--text-primary);font-family:inherit;text-align:left;opacity:0.4;">
    <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
    <span>{{ t.label }}</span>
    <span style="font-size:10px;color:var(--text-tertiary);margin-left:auto;">скоро</span>
  </button>
}
```

With:

```html
@if (t.id === 'sticker') {
  <button disabled
    style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;background:transparent;cursor:not-allowed;font-size:13px;font-weight:500;color:var(--text-primary);font-family:inherit;text-align:left;opacity:0.4;">
    <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
    <span>{{ t.label }}</span>
    <span style="font-size:10px;color:var(--text-tertiary);margin-left:auto;">скоро</span>
  </button>
} @else if (t.id === 'gif') {
  @if (giphyHasKey) {
    <button (click)="openGifPicker()"
      style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;text-align:left;transition:all 0.1s;color:var(--text-primary);"
      [style.background]="messageType === t.id ? 'var(--accent-light)' : 'transparent'"
      [style.color]="messageType === t.id ? 'var(--accent)' : 'var(--text-primary)'">
      <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
      <span>{{ t.label }}</span>
    </button>
  } @else {
    <button disabled
      title="Настройте Giphy API Key в админке"
      style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;background:transparent;cursor:not-allowed;font-size:13px;font-weight:500;color:var(--text-primary);font-family:inherit;text-align:left;opacity:0.4;">
      <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
      <span>{{ t.label }}</span>
    </button>
  }
}
```

- [ ] **Step 4: Add GIF picker to template**

Add somewhere in the template (after the create group modal or at the bottom of the template):

```html
@if (showGifPicker) {
  <app-gif-picker (gifSelected)="onGifSelected($event)" />
}
```

- [ ] **Step 5: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: success

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/components/chat/chat.ts
git commit -m "feat: wire GIF picker into chat component"
```

### Task 10: Frontend — Update GIF message bubble rendering

**Files:**
- Modify: `frontend/src/app/components/chat/chat.ts`

- [ ] **Step 1: Remove GIF placeholder, use image rendering**

Find the GIF branch in message bubble (around line 436):

```html
} @else if (($any(item).msg_type || 'text') === 'gif') {
  <div class="flex flex-col items-center gap-1 px-3 py-2 min-w-[80px]">
    <span style="font-size:1.25rem;font-weight:700;">GIF</span>
    @if ($any(item).content) { <span class="text-xs opacity-60">{{ $any(item).content }}</span> }
  </div>
}
```

Replace with — remove the `@else if` for gif entirely. GIF messages will fall through to the `@else` branch which already renders images:

```
(remove the entire gif @else if block)
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: success

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/chat/chat.ts
git commit -m "fix: remove GIF placeholder, reuse image rendering for GIF messages"
```

### Task 11: End-to-end verification

- [ ] **Step 1: Build backend**

Run: `cd backend && go build ./...`
Expected: success

- [ ] **Step 2: Build frontend**

Run: `cd frontend && npm run build`
Expected: success

- [ ] **Step 3: Run backend tests**

Run: `cd backend && go test ./...`
Expected: all pass

- [ ] **Step 4: Run frontend tests**

Run: `cd frontend && npx ng test --watch=false`
Expected: all pass

- [ ] **Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "feat: add GIF sending via Giphy integration"
```
