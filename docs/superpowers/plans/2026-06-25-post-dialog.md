# Post Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract post creation from inline form in feed into a standalone PostDialogComponent

**Architecture:** New `PostDialogComponent` with dual layout (centered modal for desktop, bottom sheet for mobile). Trigger button replaces inline form. Dialog emits `postCreated` event; feed reloads on receipt.

**Tech Stack:** Angular 20 (standalone, signals, inline templates), Tailwind v4

**Design spec:** `docs/superpowers/specs/2026-06-25-post-dialog-design.md`

---

### Task 1: Create PostDialogComponent

**Files:**
- Create: `frontend/src/app/components/post-dialog/post-dialog.ts`
- Create: `frontend/src/app/components/post-dialog/post-dialog.component.spec.ts`

- [ ] **Step 1: Write the failing tests for PostDialogComponent**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PostDialogComponent } from './post-dialog';
import { ApiService } from '../../services/api.service';
import { signal, computed } from '@angular/core';
import { of } from 'rxjs';

describe('PostDialogComponent', () => {
  let component: PostDialogComponent;
  let fixture: ComponentFixture<PostDialogComponent>;

  const mockApi = {
    currentUser: signal({ id: 1, username: 'test', avatar_url: '' }),
    getFeed: jasmine.createSpy().and.returnValue(of([])),
    createPost: jasmine.createSpy().and.returnValue(of({ id: 1, message: 'ok' })),
    createPostWithProgress: jasmine.createSpy().and.returnValue(of({})),
    wsMessages$: of(null),
    totalUnread: computed(() => 0),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PostDialogComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PostDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('is hidden by default', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="dialog-overlay"]')).toBeFalsy();
  });

  it('shows dialog after open()', () => {
    component.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="dialog-overlay"]')).toBeTruthy();
  });

  it('renders textarea in dialog', () => {
    component.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const textarea = compiled.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea?.getAttribute('placeholder')).toContain('нового');
  });

  it('renders public toggle checkbox', () => {
    component.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const checkbox = compiled.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
  });

  it('renders submit button', () => {
    component.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const btn = Array.from(compiled.querySelectorAll('button')).find(b => b.textContent?.includes('Опубликовать'));
    expect(btn).toBeTruthy();
  });

  it('renders photo picker button', () => {
    component.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const btn = Array.from(compiled.querySelectorAll('button, label')).find(b => b.textContent?.includes('Фото'));
    expect(btn).toBeTruthy();
  });

  it('closes on backdrop click', () => {
    component.open();
    fixture.detectChanges();
    const overlay = fixture.nativeElement.querySelector('[data-testid="dialog-overlay"]') as HTMLElement;
    overlay.click();
    fixture.detectChanges();
    expect(component.showDialog()).toBeFalse();
  });

  it('closes on Escape key', () => {
    component.open();
    fixture.detectChanges();
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    document.dispatchEvent(event);
    fixture.detectChanges();
    expect(component.showDialog()).toBeFalse();
  });

  it('closes on close button click', () => {
    component.open();
    fixture.detectChanges();
    const closeBtn = fixture.nativeElement.querySelector('[data-testid="dialog-close"]') as HTMLElement;
    closeBtn.click();
    fixture.detectChanges();
    expect(component.showDialog()).toBeFalse();
  });

  it('calls createPost on submit and emits postCreated', () => {
    const spy = jasmine.createSpy('postCreated');
    component.postCreated.subscribe(spy);
    component.newPostContent = 'Hello world';
    component.open();
    fixture.detectChanges();
    const btn = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b: HTMLElement) => b.textContent?.includes('Опубликовать')) as HTMLElement;
    btn.click();
    fixture.detectChanges();
    expect(mockApi.createPost).toHaveBeenCalledWith('Hello world', [], false);
    expect(spy).toHaveBeenCalled();
  });

  it('disables submit when content empty and no files', () => {
    component.open();
    fixture.detectChanges();
    const btn = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b: HTMLElement) => b.textContent?.includes('Опубликовать')) as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx ng test --watch=false --include='src/app/components/post-dialog/post-dialog.component.spec.ts'`
Expected: FAIL — component does not exist, all tests error

- [ ] **Step 3: Write PostDialogComponent implementation**

```typescript
import { Component, Output, EventEmitter, signal, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { filter } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-post-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (showDialog()) {
      <div data-testid="dialog-overlay"
        (click)="onBackdropClick($event)"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        style="background:rgba(0,0,0,0.45);">

        <!-- Desktop: centered modal (hidden on small screens, shown on sm+) -->
        <div data-testid="dialog-modal"
          (click)="$event.stopPropagation()"
          class="hidden sm:block w-full max-w-[480px] rounded-2xl p-6"
          style="background:var(--bg-body);animation:fadeUp 0.2s ease;">

          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold" style="color:var(--text-primary);">Новый пост</h3>
            <button data-testid="dialog-close" (click)="close()"
              class="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-80"
              style="background:var(--bg-card-hover);color:var(--text-secondary);border:none;cursor:pointer;">
              ✕
            </button>
          </div>

          <textarea [(ngModel)]="newPostContent" rows="4"
            placeholder="Что у вас нового?"
            class="w-full rounded-xl p-3 text-sm resize-y outline-none transition-colors mb-3"
            style="border:2px solid var(--border-default);background:var(--bg-card);color:var(--text-primary);min-height:100px;"></textarea>

          @if (previews.length > 0) {
            <div class="flex flex-wrap gap-2 mb-3">
              @for (preview of previews; track $index) {
                <div class="relative w-[72px] h-[72px]">
                  <img [src]="preview" class="w-full h-full object-cover rounded-lg" style="border:1px solid var(--border-default);">
                  <button (click)="removeFile($index)"
                    class="absolute -top-2 -right-2 w-5 h-5 rounded-full text-xs flex items-center justify-center hover:opacity-90"
                    style="background:#e74c3c;color:white;border:none;cursor:pointer;">
                    ✕
                  </button>
                </div>
              }
            </div>
          }

          <div class="flex flex-wrap gap-2">
            @if (uploading()) {
              <div style="width:100%;height:3px;background:var(--divider);border-radius:2px;margin-bottom:4px;">
                <div style="height:100%;width:{{uploadProgress()}}%;background:var(--accent-gradient);border-radius:2px;transition:width 0.2s;"></div>
              </div>
            }
            <label class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm cursor-pointer"
              style="border:2px dashed var(--border-default);color:var(--text-secondary);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Фото
              <input type="file" multiple accept="image/*" (change)="onFilesSelected($event)" class="hidden">
            </label>
            <label class="flex items-center gap-2 text-sm ml-auto cursor-pointer" style="color:var(--text-secondary);">
              <input type="checkbox" [(ngModel)]="isPublic" class="w-4 h-4">
              <span>Всем</span>
            </label>
            <button (click)="createPost()" [disabled]="!newPostContent.trim() && selectedFiles.length === 0"
              class="btn-primary" style="margin-left:8px;">
              Опубликовать
            </button>
          </div>
        </div>

        <!-- Mobile: bottom sheet (shown on small screens only) -->
        <div data-testid="dialog-sheet"
          (click)="$event.stopPropagation()"
          class="sm:hidden fixed bottom-0 left-0 right-0 rounded-t-[20px] p-5 pb-6"
          style="background:var(--bg-body);animation:slideUp 0.25s ease;max-height:85%;overflow-y:auto;">

          <div class="w-10 h-1 rounded-full mx-auto mb-4" style="background:#ddd;"></div>

          <h3 class="text-lg font-bold mb-4" style="color:var(--text-primary);">Новый пост</h3>

          <textarea [(ngModel)]="newPostContent" rows="3"
            placeholder="Что у вас нового?"
            class="w-full rounded-xl p-3 text-sm resize-y outline-none transition-colors mb-3"
            style="border:2px solid var(--border-default);background:var(--bg-card);color:var(--text-primary);min-height:90px;"></textarea>

          @if (previews.length > 0) {
            <div class="flex flex-wrap gap-2 mb-3">
              @for (preview of previews; track $index) {
                <div class="relative w-16 h-16">
                  <img [src]="preview" class="w-full h-full object-cover rounded-lg" style="border:1px solid var(--border-default);">
                  <button (click)="removeFile($index)"
                    class="absolute -top-2 -right-2 w-5 h-5 rounded-full text-xs flex items-center justify-center hover:opacity-90"
                    style="background:#e74c3c;color:white;border:none;cursor:pointer;">
                    ✕
                  </button>
                </div>
              }
            </div>
          }

          @if (uploading()) {
            <div style="width:100%;height:3px;background:var(--divider);border-radius:2px;margin-bottom:4px;">
              <div style="height:100%;width:{{uploadProgress()}}%;background:var(--accent-gradient);border-radius:2px;transition:width 0.2s;"></div>
            </div>
          }

          <div class="flex items-center gap-2 pt-3" style="border-top:1px solid var(--divider);">
            <label class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm cursor-pointer"
              style="background:var(--bg-card-hover);color:var(--text-secondary);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Фото
              <input type="file" multiple accept="image/*" (change)="onFilesSelected($event)" class="hidden">
            </label>
            <label class="flex items-center gap-2 text-sm cursor-pointer" style="color:var(--text-secondary);">
              <input type="checkbox" [(ngModel)]="isPublic" class="w-4 h-4">
              <span>Всем</span>
            </label>
            <button (click)="createPost()" [disabled]="!newPostContent.trim() && selectedFiles.length === 0"
              class="btn-primary ml-auto">
              Опубликовать
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes fadeUp {
      from { opacity:0; transform:translateY(16px) scale(0.97); }
      to { opacity:1; transform:translateY(0) scale(1); }
    }
    @keyframes slideUp {
      from { transform:translateY(100%); }
      to { transform:translateY(0); }
    }
  `]
})
export class PostDialogComponent {
  @Output() postCreated = new EventEmitter<void>();

  showDialog = signal(false);
  newPostContent = '';
  selectedFiles: File[] = [];
  previews: string[] = [];
  isPublic = false;
  uploading = signal(false);
  uploadProgress = signal(0);

  constructor(private api: ApiService) {}

  open() {
    this.showDialog.set(true);
  }

  close() {
    this.showDialog.set(false);
    this.resetForm();
  }

  private resetForm() {
    this.newPostContent = '';
    this.selectedFiles = [];
    this.previews.forEach(p => URL.revokeObjectURL(p));
    this.previews = [];
    this.isPublic = false;
    this.uploading.set(false);
    this.uploadProgress.set(0);
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).dataset?.['testid'] === 'dialog-overlay') {
      this.close();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.showDialog()) {
      this.close();
    }
  }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        if (this.selectedFiles.length >= 10) break;
        this.selectedFiles.push(file);
        this.previews.push(URL.createObjectURL(file));
      }
      input.value = '';
    }
  }

  removeFile(index: number) {
    URL.revokeObjectURL(this.previews[index]);
    this.selectedFiles.splice(index, 1);
    this.previews.splice(index, 1);
  }

  createPost() {
    if (!this.newPostContent.trim() && this.selectedFiles.length === 0) return;
    const hasFiles = this.selectedFiles.length > 0;
    if (hasFiles) {
      this.uploading.set(true);
      this.uploadProgress.set(0);
      this.api.createPostWithProgress(this.newPostContent, this.selectedFiles, this.isPublic)
        .pipe(filter(e => e.type === HttpEventType.UploadProgress || e.type === HttpEventType.Response))
        .subscribe({
          next: (event: any) => {
            if (event.type === HttpEventType.UploadProgress) {
              this.uploadProgress.set(Math.round(100 * event.loaded / event.total));
            } else if (event.type === HttpEventType.Response) {
              this.handleSuccess();
            }
          },
          error: () => { this.uploading.set(false); },
        });
    } else {
      this.api.createPost(this.newPostContent, this.selectedFiles, this.isPublic).subscribe({
        next: () => this.handleSuccess(),
        error: () => {},
      });
    }
  }

  private handleSuccess() {
    this.postCreated.emit();
    this.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx ng test --watch=false --include='src/app/components/post-dialog/post-dialog.component.spec.ts'`
Expected: all 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/components/post-dialog/
git commit -m "feat: add PostDialogComponent with desktop modal and mobile bottom sheet (#12)"
```

---

### Task 2: Update FeedComponent — remove inline form, add trigger button + dialog

**Files:**
- Modify: `frontend/src/app/components/feed/feed.ts`
- Modify: `frontend/src/app/components/feed/feed.component.spec.ts`

- [ ] **Step 1: Update feed tests first (TDD — expect new behavior)**

Replace existing feed test file content:

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeedComponent } from './feed';
import { ApiService } from '../../services/api.service';
import { signal, computed } from '@angular/core';
import { of } from 'rxjs';

describe('FeedComponent', () => {
  let component: FeedComponent;
  let fixture: ComponentFixture<FeedComponent>;

  const mockApi = {
    currentUser: signal({ id: 1, username: 'test', avatar_url: '' }),
    getFeed: jasmine.createSpy().and.returnValue(of([])),
    deletePost: jasmine.createSpy().and.returnValue(of({})),
    wsMessages$: of(null),
    totalUnread: computed(() => 0),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeedComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('has new post trigger button instead of inline form', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    // Should NOT have the old .new-post card
    expect(compiled.querySelector('.new-post')).toBeFalsy();
    // Should have the trigger button
    const triggerBtn = Array.from(compiled.querySelectorAll('button')).find(b => b.textContent?.includes('Написать пост'));
    expect(triggerBtn).toBeTruthy();
  });

  it('renders posts list', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    // Verify post-related elements still render (no posts in mock, but feed area exists)
    expect(compiled.querySelector('.card')).toBeFalsy(); // no posts loaded
  });

  it('renders delete button on own post', () => {
    component.posts = [{
      id: 1,
      user_id: 1,
      content: 'Test post',
      created_at: new Date().toISOString(),
      username: 'test',
      avatar_url: '',
      is_admin: false,
      is_public: false,
    }];
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const deleteBtn = compiled.querySelector('button[title="Удалить пост"]');
    expect(deleteBtn).toBeTruthy();
  });

  it('hides delete button on other user post', () => {
    component.posts = [{
      id: 2,
      user_id: 2,
      content: 'Other post',
      created_at: new Date().toISOString(),
      username: 'other',
      avatar_url: '',
      is_admin: false,
      is_public: false,
    }];
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const deleteBtn = compiled.querySelector('button[title="Удалить пост"]');
    expect(deleteBtn).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (old tests expect .new-post)**

Run: `npx ng test --watch=false --include='src/app/components/feed/feed.component.spec.ts'`
Expected: FAIL — old feed still has `.new-post`

- [ ] **Step 3: Update FeedComponent — remove inline form, add trigger + dialog**

Remove the `.card.new-post` div (lines 14-51) from the template and replace with a trigger button. Add `PostDialogComponent` to imports.

Changes to `feed.ts`:

**Imports:** Add `PostDialogComponent` to imports array and import statement
```typescript
import { PostDialogComponent } from '../post-dialog/post-dialog';
```

**imports array:** Change `imports: [DatePipe, FormsModule]` to `imports: [DatePipe, FormsModule, PostDialogComponent]`

**Template:** Replace lines 14-51 (the `.card.new-post` block) with:
```html
<button (click)="postDialog.open()"
  class="w-full flex items-center gap-2 px-4 py-3 rounded-xl text-sm cursor-pointer transition-colors"
  style="border:2px dashed var(--border-default);color:var(--text-secondary);background:transparent;">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
  Написать пост...
</button>

<app-post-dialog (postCreated)="loadFeed()" />
```

Add a template reference variable to feed template (add `#postDialog` to the app-post-dialog tag):
```html
<app-post-dialog #postDialog (postCreated)="loadFeed()" />
```

**Component class:** Remove these fields and methods:
- Remove fields: `newPostContent`, `selectedFiles`, `previews`, `isPublic`, `uploading`, `uploadProgress`
- Remove methods: `onFilesSelected`, `removeFile`, `createPost`
- Remove unused imports: `HttpEventType`, `filter`

Final feed.ts should look like (changes highlighted):

```typescript
import { Component, OnInit, signal, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Post, PostImage } from '../../services/api.service';
import { PostDialogComponent } from '../post-dialog/post-dialog';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [DatePipe, FormsModule, PostDialogComponent],
  template: `
    <div class="px-4 py-6 pb-20 sm:pb-6 space-y-4 sm:space-y-6">
      <!-- New post trigger button -->
      <button (click)="postDialog.open()"
        class="w-full flex items-center gap-2 px-4 py-3 rounded-xl text-sm cursor-pointer transition-colors"
        style="border:2px dashed var(--border-default);color:var(--text-secondary);background:transparent;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        Написать пост...
      </button>

      <app-post-dialog #postDialog (postCreated)="loadFeed()" />

      @for (post of posts; track post.id) {
        <!-- ... post cards same as before, lines 54-123 unchanged ... -->
      }
    </div>

    <!-- style and viewer overlay unchanged -->
  `,
})
export class FeedComponent implements OnInit {
  @ViewChild('postDialog') postDialog!: PostDialogComponent;

  posts: Post[] = [];
  reactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉'];
  pickerPostId: number | null = null;
  viewerImages: PostImage[] | null = null;
  viewerIndex = 0;

  // All remaining methods unchanged: getActiveReactions, getAvailableEmojis,
  // togglePicker, hasReacted, getReactionCount, toggleReaction,
  // constructor, ngOnInit, loadFeed, deletePost,
  // openViewer, closeViewer, prevViewer, nextViewer
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx ng test --watch=false --include='src/app/components/feed/feed.component.spec.ts'`
Expected: all 5 tests PASS (create component, trigger button, posts list, delete own, hide delete other)

- [ ] **Step 5: Run all frontend tests to make sure nothing broke**

Run: `npx ng test --watch=false`
Expected: 97+ tests PASS (was 91, added 12 for PostDialog, removed 3 old feed tests → net +6 = 97)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/components/feed/feed.ts frontend/src/app/components/feed/feed.component.spec.ts
git commit -m "refactor: replace inline post form with trigger button + PostDialogComponent (#12)"
```

---

### Task 3: Verification and cleanup

**Files:**
- Verify: `frontend/src/app/components/post-dialog/post-dialog.ts`
- Verify: `frontend/src/app/components/feed/feed.ts`
- No new file changes

- [ ] **Step 1: Verify no broken imports in feed.ts**

Check that removed imports (`HttpEventType`, `filter`) are no longer referenced in feed.ts. Also verify unused `ViewChild` import is correct.

Run: `npx ng build --configuration production 2>&1` (just check compilation, don't need full build)
Expected: Build succeeds with no errors

- [ ] **Step 2: Run full test suite**

Run: `npx ng test --watch=false`
Expected: all tests PASS

- [ ] **Step 3: Verify desktop vs mobile rendering**

In PostDialogComponent spec, add these tests if not present:

```typescript
it('shows centered modal class on desktop (hidden sm:block)', () => {
  component.open();
  fixture.detectChanges();
  const modal = fixture.nativeElement.querySelector('[data-testid="dialog-modal"]');
  expect(modal).toBeTruthy();
  expect(modal.classList.contains('hidden')).toBeTrue();
  expect(modal.classList.contains('sm:block')).toBeTrue();
});

it('shows bottom sheet class on mobile (sm:hidden)', () => {
  component.open();
  fixture.detectChanges();
  const sheet = fixture.nativeElement.querySelector('[data-testid="dialog-sheet"]');
  expect(sheet).toBeTruthy();
  expect(sheet.classList.contains('sm:hidden')).toBeTrue();
});
```

Verify these pass.

- [ ] **Step 4: Update TODO.md**

Mark #12 as done, update test counts.

- [ ] **Step 5: Final commit**

```bash
git add TODO.md
git commit -m "chore: update TODO.md, mark #12 as done"
```
