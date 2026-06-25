# Admin Mobile Responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin panel usable on mobile by adding card-based layout and `<select>` tab navigation for `<768px` screens

**Architecture:** Dual-template approach (desktop `hidden sm:block` + mobile `sm:hidden`) matching the existing Chat component pattern. Desktop template stays unchanged. Mobile template uses cards instead of tables and `<select>` instead of tab buttons.

**Tech Stack:** Angular 20 standalone component, Tailwind v4, inline SVGs with `currentColor`, CSS custom properties for theming

---

### Task 1: Add responsive wrapper and mobile tab selector

**Files:**
- Modify: `frontend/src/app/components/admin/admin.ts`

- [ ] **Step 1: Add desktop wrapper and mobile tab `<select>`**

Replace the top-level `<div class="max-w-4xl...">` opening and its first child (the tabs section) to add responsive wrappers and a mobile tab selector.

Find in `admin.ts`:
```
    <div class="max-w-4xl mx-auto px-4 py-6 pb-20 sm:pb-6">
      <div class="card" style="padding:24px;">
        <h1 class="text-xl font-bold mb-6" style="color:var(--text-primary);">Панель администратора</h1>

        <div class="flex gap-1 mb-6" style="border-bottom:1px solid var(--divider);padding-bottom:1px;">
          <button ...>
```

Replace with desktop + mobile split:

```html
    <!-- Desktop -->
    <div class="hidden sm:block max-w-4xl mx-auto px-4 py-6 pb-20 sm:pb-6">
      <div class="card" style="padding:24px;">
        <h1 class="text-xl font-bold mb-6" style="color:var(--text-primary);">Панель администратора</h1>
        <!-- desktop tabs -->
        <div class="flex gap-1 mb-6" style="border-bottom:1px solid var(--divider);padding-bottom:1px;">
          <button (click)="activeTab = 'users'"
            [style.background]="activeTab === 'users' ? 'var(--accent-light)' : 'transparent'"
            style="padding:8px 16px;border-radius:8px 8px 0 0;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);transition:all 0.2s;">
            Управление пользователями
          </button>
          <button (click)="activeTab = 'files'"
            [style.background]="activeTab === 'files' ? 'var(--accent-light)' : 'transparent'"
            style="padding:8px 16px;border-radius:8px 8px 0 0;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);transition:all 0.2s;">
            Управление файлами
          </button>
          <button (click)="activeTab = 'chats'; loadGroupChats()"
            [style.background]="activeTab === 'chats' ? 'var(--accent-light)' : 'transparent'"
            style="padding:8px 16px;border-radius:8px 8px 0 0;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);transition:all 0.2s;">
            Чаты
          </button>
          <button (click)="activeTab = 'backups'; loadBackups()"
            [style.background]="activeTab === 'backups' ? 'var(--accent-light)' : 'transparent'"
            style="padding:8px 16px;border-radius:8px 8px 0 0;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);transition:all 0.2s;">
            Бэкапы
          </button>
          <button (click)="activeTab = 'federation'; loadFederation()"
            [style.background]="activeTab === 'federation' ? 'var(--accent-light)' : 'transparent'"
            style="padding:8px 16px;border-radius:8px 8px 0 0;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);transition:all 0.2s;">
            Федерация
          </button>
        </div>
```

Then before the `@if (activeTab === 'users')`, add closing `</div></div>` for desktop section and opening mobile section with `<select>`:

```html
      </div>
    </div>

    <!-- Mobile -->
    <div class="sm:hidden px-4 py-4 pb-20">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-bold" style="color:var(--text-primary);">Админка</h1>
        <div style="position:relative;">
          <select (change)="activeTab = $event.target.value"
            style="appearance:none;padding:8px 32px 8px 12px;border-radius:10px;border:1px solid var(--border-default);background:var(--bg-surface);font-size:14px;font-weight:500;color:var(--text-primary);cursor:pointer;font-family:inherit;min-width:160px;">
            <option value="users">Пользователи</option>
            <option value="files">Файлы</option>
            <option value="chats">Чаты</option>
            <option value="backups">Бэкапы</option>
            <option value="federation">Федерация</option>
          </select>
          <div style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--text-tertiary);font-size:10px;">▼</div>
        </div>
      </div>
```

Then duplicate all the `@if (activeTab === '...')` blocks with mobile card versions (Tasks 2-5), and close the mobile div:

```html
    </div>
```

- [ ] **Step 2: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: Build succeeds (there will be missing `@if` blocks, but each tab's content still exists from the desktop template — the build should pass since we only added wrappers and a `<select>`)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/admin/admin.ts
git commit -m "feat: add responsive wrapper and mobile tab selector to admin panel"
```

### Task 2: Add mobile users card view

**Files:**
- Modify: `frontend/src/app/components/admin/admin.ts`

- [ ] **Step 1: Add mobile users template**

After the mobile `<select>` section (inside mobile `<div class="sm:hidden ...">`), before the `</div>` closing tag, add the mobile users view. Place it AFTER the desktop `@if (activeTab === 'users')` block (which is inside the desktop `<div class="hidden sm:block ...">`).

```html
      @if (activeTab === 'users') {
        @if (loadingUsers) {
          <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
        } @else {
          <div class="card">
            <div style="padding:10px 14px 6px;font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;">Пользователи · {{ users.length }}</div>
            @for (user of users; track user.id) {
              <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--divider);">
                <div style="position:relative;display:inline-flex;flex-shrink:0;">
                  @if (user.avatar_url) {
                    <img [src]="user.avatar_url" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
                  } @else {
                    <div style="width:40px;height:40px;border-radius:50%;background:var(--avatar-bg);color:var(--avatar-text);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;">
                      {{ user.username[0] }}
                    </div>
                  }
                  @if (user.is_admin) {
                    <div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--accent-gradient);border:2px solid var(--bg-body);display:flex;align-items:center;justify-content:center;">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                    </div>
                  }
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:14px;font-weight:600;color:var(--text-primary);">{{ user.username }}</div>
                  <div style="font-size:12px;color:var(--text-secondary);margin-top:1px;">{{ user.email }}</div>
                  <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
                    @if (user.is_banned) {
                      <span style="font-size:11px;padding:1px 6px;border-radius:99px;background:#fee2e2;color:#dc2626;font-weight:500;">Заблокирован</span>
                    } @else if (user.is_online) {
                      <span style="font-size:11px;padding:1px 6px;border-radius:99px;background:#d1fae5;color:#059669;font-weight:500;">В сети</span>
                    } @else {
                      <span style="font-size:11px;padding:1px 6px;border-radius:99px;background:var(--border-subtle);color:var(--text-tertiary);font-weight:500;">Не в сети</span>
                    }
                  </div>
                </div>
                <div style="display:flex;gap:2px;flex-shrink:0;align-items:center;">
                  @if (actionLoading === user.id) {
                    <span style="font-size:13px;color:var(--text-tertiary);padding:0 8px;">...</span>
                  } @else {
                    <button (click)="user.is_admin ? removeAdmin(user) : makeAdmin(user)"
                      [title]="user.is_admin ? 'Снять админа' : 'Назначить админом'"
                      style="padding:5px;border-radius:8px;border:none;background:transparent;cursor:pointer;transition:all 0.2s;width:34px;height:34px;display:flex;align-items:center;justify-content:center;"
                      [style.color]="user.is_admin ? 'var(--accent)' : 'var(--text-tertiary)'">
                      @if (user.is_admin) {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" stroke-width="0"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                      } @else {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                      }
                    </button>
                    <button (click)="user.is_banned ? unblockUser(user) : blockUser(user)"
                      [title]="user.is_banned ? 'Разблокировать' : 'Заблокировать'"
                      style="padding:5px;border-radius:8px;border:none;background:transparent;cursor:pointer;transition:all 0.2s;width:34px;height:34px;display:flex;align-items:center;justify-content:center;"
                      [style.color]="user.is_banned ? '#e67e22' : 'var(--text-tertiary)'">
                      @if (user.is_banned) {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>
                      } @else {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                      }
                    </button>
                    <button (click)="deleteUser(user)" title="Удалить"
                      style="padding:5px;border-radius:8px;border:none;background:transparent;cursor:pointer;width:34px;height:34px;display:flex;align-items:center;justify-content:center;color:#e74c3c;transition:all 0.2s;">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        }
        @if (actionMsg) {
          <p class="mt-2 text-sm" [style.color]="actionOk ? '#27ae60' : '#e74c3c'">{{ actionMsg }}</p>
        }
      }
```

Insert this block after the desktop section's closing `</div></div>` (which closes the desktop `.card` and `.hidden sm:block`), before the mobile section's closing `</div>`.

- [ ] **Step 2: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/admin/admin.ts
git commit -m "feat: add mobile card view for admin users tab"
```

### Task 3: Add mobile files card view

**Files:**
- Modify: `frontend/src/app/components/admin/admin.ts`

- [ ] **Step 1: Add mobile files template**

Before the `</div>` (mobile section close), add:

```html
      @if (activeTab === 'files') {
        @if (loadingFiles) {
          <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
        } @else if (files.length === 0) {
          <p style="color:var(--text-tertiary);font-size:14px;">Файлы не найдены</p>
        } @else {
          @if (diskInfo) {
            <div style="padding:14px;border-radius:12px;border:1px solid var(--border-default);background:var(--bg-surface);margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="font-size:13px;font-weight:600;color:var(--text-primary);">Использование диска</span>
                <span style="font-size:12px;color:var(--text-secondary);">{{ formatSize(diskInfo.used) }} / {{ formatSize(diskInfo.total) }}</span>
              </div>
              <div style="height:8px;border-radius:99px;background:var(--border-default);overflow:hidden;">
                <div [style.width.%]="diskInfo.used_pct" style="height:100%;border-radius:99px;background:var(--accent-gradient);transition:width 0.3s;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:4px;">
                <span style="font-size:11px;color:var(--text-tertiary);">Свободно: {{ formatSize(diskInfo.free) }} ({{ (100 - diskInfo.used_pct).toFixed(1) }}%)</span>
                <span style="font-size:11px;color:var(--text-tertiary);">{{ diskInfo.used_pct.toFixed(1) }}% занято</span>
              </div>
            </div>
          }
          <div class="card">
            @for (file of files; track file.path) {
              <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--divider);">
                <div style="width:36px;height:36px;border-radius:8px;background:var(--border-subtle);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:14px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ file.name }}</div>
                  <div style="display:flex;gap:8px;font-size:12px;color:var(--text-secondary);margin-top:1px;">
                    <span>{{ formatSize(file.size) }}</span>
                    <span>{{ file.mod_time | date:'dd.MM.yyyy HH:mm' }}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ file.path }}</div>
                </div>
                @if (deleteFileLoading === file.path) {
                  <span style="font-size:13px;color:var(--text-tertiary);padding:0 8px;">...</span>
                } @else {
                  <button (click)="deleteFile(file)" title="Удалить"
                    style="padding:6px;border-radius:8px;border:none;background:transparent;cursor:pointer;color:#e74c3c;flex-shrink:0;width:34px;height:34px;display:flex;align-items:center;justify-content:center;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                }
              </div>
            }
          </div>
        }
      }
```

- [ ] **Step 2: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/admin/admin.ts
git commit -m "feat: add mobile card view for admin files tab"
```

### Task 4: Add mobile chats card view

**Files:**
- Modify: `frontend/src/app/components/admin/admin.ts`

- [ ] **Step 1: Add mobile chats template**

Before the `</div>` (mobile section close), add:

```html
      @if (activeTab === 'chats') {
        @if (loadingChats) {
          <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
        } @else if (chats.length === 0) {
          <p style="color:var(--text-tertiary);font-size:14px;">Групповые чаты не найдены</p>
        } @else {
          <div class="card">
            @for (chat of chats; track chat.id) {
              <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--divider);">
                <div style="width:40px;height:40px;border-radius:10px;background:var(--accent-light);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--accent);font-weight:600;font-size:16px;">
                  {{ chat.name[0] }}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:14px;font-weight:600;color:var(--text-primary);">{{ chat.name }}</div>
                  <div style="font-size:12px;color:var(--text-secondary);margin-top:1px;">Создал: {{ chat.created_by_username }}</div>
                  <div style="display:flex;gap:10px;margin-top:2px;">
                    <span style="font-size:12px;color:var(--text-tertiary);display:flex;align-items:center;gap:3px;">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                      {{ chat.member_count }}
                    </span>
                    <span style="font-size:12px;color:var(--text-tertiary);">{{ chat.created_at | date:'dd.MM.yyyy HH:mm' }}</span>
                  </div>
                </div>
                <button (click)="deleteChat(chat)" [disabled]="deleteChatLoading === chat.id"
                  style="padding:6px 12px;border-radius:8px;border:1px solid #e74c3c;background:transparent;cursor:pointer;font-size:12px;color:#e74c3c;flex-shrink:0;font-family:inherit;">
                  {{ deleteChatLoading === chat.id ? '...' : 'Удалить' }}
                </button>
              </div>
            }
          </div>
        }
        @if (chatActionMsg) {
          <p class="mt-2 text-sm" [style.color]="chatActionOk ? '#27ae60' : '#e74c3c'">{{ chatActionMsg }}</p>
        }
      }
```

- [ ] **Step 2: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/admin/admin.ts
git commit -m "feat: add mobile card view for admin chats tab"
```

### Task 5: Add mobile backups card view

**Files:**
- Modify: `frontend/src/app/components/admin/admin.ts`

- [ ] **Step 1: Add mobile backups template**

Before the `</div>` (mobile section close), add:

```html
      @if (activeTab === 'backups') {
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button (click)="createBackup()" [disabled]="backupLoading"
            style="flex:1;padding:10px 16px;border-radius:10px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;">
            {{ backupLoading ? '...' : 'Создать бэкап' }}
          </button>
          <label style="flex:1;padding:10px 16px;border-radius:10px;border:1px solid var(--border-default);background:transparent;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);display:flex;align-items:center;justify-content:center;font-family:inherit;">
            Загрузить
            <input type="file" accept=".zip" (change)="uploadBackup($event)" style="display:none;">
          </label>
        </div>

        @if (backupLoading && backupUploadProgress > 0 && backupUploadProgress < 100) {
          <div style="margin-bottom:12px;">
            <div style="height:4px;border-radius:4px;background:var(--border-light);overflow:hidden;">
              <div style="height:100%;border-radius:4px;background:var(--accent-gradient);transition:width .2s;" [style.width.%]="backupUploadProgress"></div>
            </div>
            <p style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">{{ backupUploadProgress }}%</p>
          </div>
        }

        @if (backupMsg) {
          <p style="font-size:13px;margin-bottom:12px;" [style.color]="backupOk ? '#27ae60' : '#e74c3c'">{{ backupMsg }}</p>
        }

        @if (backupsLoading) {
          <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
        } @else if (backups.length === 0) {
          <p style="color:var(--text-tertiary);font-size:14px;">Бэкапы не найдены</p>
        } @else {
          <div class="card">
            @for (b of backups; track b.filename) {
              <div style="padding:12px 14px;border-bottom:1px solid var(--divider);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                  <span style="font-size:14px;font-weight:500;color:var(--text-primary);">{{ b.filename }}</span>
                </div>
                <div style="display:flex;gap:12px;font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
                  <span>{{ formatSize(b.size_bytes) }}</span>
                  <span>{{ b.created_at | date:'dd.MM.yyyy HH:mm' }}</span>
                </div>
                <div style="display:flex;gap:6px;">
                  <a [href]="api.downloadBackupUrl(b.filename)" target="_blank"
                    style="flex:1;padding:6px 10px;border-radius:8px;border:1px solid var(--border-default);background:transparent;cursor:pointer;font-size:12px;color:var(--text-secondary);text-decoration:none;text-align:center;font-family:inherit;">
                    Скачать
                  </a>
                  <button (click)="restoreBackup(b)" [disabled]="restoring === b.filename"
                    style="flex:1;padding:6px 10px;border-radius:8px;border:1px solid #e67e22;background:transparent;cursor:pointer;font-size:12px;color:#e67e22;font-family:inherit;">
                    {{ restoring === b.filename ? '...' : 'Восстановить' }}
                  </button>
                  <button (click)="deleteBackup(b)"
                    style="flex:1;padding:6px 10px;border-radius:8px;border:1px solid #e74c3c;background:transparent;cursor:pointer;font-size:12px;color:#e74c3c;font-family:inherit;">
                    Удалить
                  </button>
                </div>
              </div>
            }
          </div>
        }
      }
```

- [ ] **Step 2: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/admin/admin.ts
git commit -m "feat: add mobile card view for admin backups tab"
```

### Task 6: Add mobile federation tab (reuse existing component)

**Files:**
- Modify: `frontend/src/app/components/admin/admin.ts`

- [ ] **Step 1: Add mobile federation template**

Before the `</div>` (mobile section close), add:

```html
      @if (activeTab === 'federation') {
        <app-admin-federation />
      }
```

(Reuses the existing `AdminFederationComponent` — no changes needed since it's already a standalone component with its own responsive layout.)

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/admin/admin.ts
git commit -m "feat: add mobile federation tab in admin panel"
```

### Task 7: Final verification

**Files:**
- N/A (verification only)

- [ ] **Step 1: Run production build**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run tests**

Run: `cd frontend && npm test -- --watch=false`
Expected: All tests pass (admin component test should still pass since we didn't change the class logic, only added template branches)

- [ ] **Step 3: Final commit**

```bash
git add frontend/src/app/components/admin/admin.ts
git commit -m "fix: make admin panel responsive on mobile with card-based layout"
```
