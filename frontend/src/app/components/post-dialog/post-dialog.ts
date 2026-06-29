import { Component, Output, EventEmitter, signal, HostListener, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { filter } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { KeyboardService } from '../../services/keyboard.service';

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

        <!-- Desktop: centered modal -->
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

        <!-- Mobile: bottom sheet -->
        <div data-testid="dialog-sheet"
          (click)="$event.stopPropagation()"
          class="sm:hidden fixed bottom-0 left-0 right-0 rounded-t-[20px] flex flex-col"
          style="background:var(--bg-body);animation:slideUp 0.25s ease;max-height:85dvh;"
          [style.padding-bottom]="sheetPadding()">

          <div class="w-10 h-1 rounded-full mx-auto mt-3 mb-2 shrink-0" style="background:#ddd;"></div>

          <h3 class="text-lg font-bold px-5 mb-3 shrink-0" style="color:var(--text-primary);">Новый пост</h3>

          <div class="flex-1 overflow-y-auto px-5">
            <textarea [(ngModel)]="newPostContent" rows="3"
              placeholder="Что у вас нового?"
              class="w-full rounded-xl p-3 text-sm resize-none outline-none transition-colors mb-3"
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
          </div>

          <div class="flex items-center gap-2 shrink-0 px-5 pt-3 pb-5" style="background:var(--bg-body);border-top:1px solid var(--divider);">
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

  private keyboardService = inject(KeyboardService);
  sheetPadding = computed(() => {
    if (this.keyboardService.isKeyboardOpen()) {
      return '0';
    }
    return 'calc(3.5rem + env(safe-area-inset-bottom, 0px))';
  });

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
    if ((event.target as HTMLElement).getAttribute('data-testid') === 'dialog-overlay') {
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
