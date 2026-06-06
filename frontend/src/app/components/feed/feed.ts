import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Post, PostImage } from '../../services/api.service';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <div class="px-4 py-6 pb-20 sm:pb-6 space-y-4 sm:space-y-6">
      <div class="card new-post">
        <h2 class="text-lg font-semibold mb-3" style="color:var(--text-primary);">Новый пост</h2>
        <textarea [(ngModel)]="newPostContent" rows="3" placeholder="Что у вас нового?"></textarea>

        @if (previews.length > 0) {
          <div class="flex flex-wrap gap-2 mt-3">
            @for (preview of previews; track $index) {
              <div class="relative w-20 h-20">
                <img [src]="preview" class="w-full h-full object-cover rounded-lg" style="border:1px solid var(--border-default);">
                <button (click)="removeFile($index)"
                  class="absolute -top-2 -right-2 w-5 h-5 rounded-full text-xs flex items-center justify-center hover:opacity-90"
                  style="background:#e74c3c;color:white;">
                  ✕
                </button>
              </div>
            }
          </div>
        }

        <div class="flex flex-wrap gap-2 mt-3">
          <label class="btn-secondary" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
            <span>📷</span> Добавить фото
            <input type="file" multiple accept="image/*" (change)="onFilesSelected($event)" class="hidden">
          </label>
          <label class="flex items-center gap-2 text-sm" style="color:var(--text-secondary);cursor:pointer;margin-left:12px;">
            <input type="checkbox" [(ngModel)]="isPublic" class="w-4 h-4">
            <span>Показать всем</span>
          </label>
          <button (click)="createPost()" class="btn-primary" style="margin-left:auto;">
            Опубликовать
          </button>
        </div>
      </div>

      @for (post of posts; track post.id) {
        <div class="card">
          <div class="post-header">
            <div style="position:relative;display:inline-flex;">
              @if (post.avatar_url) {
                <img [src]="post.avatar_url" class="post-avatar">
              } @else {
                <div class="post-avatar">
                  {{ post.username[0] }}
                </div>
              }
              @if (post.is_admin) {
                <div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--accent-gradient);border:2px solid var(--bg-body);display:flex;align-items:center;justify-content:center;">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                </div>
              }
            </div>
            <div class="post-meta" style="flex:1;">
              <p class="post-username">{{ post.username }}</p>
              <p class="post-time">{{ post.created_at | date:'dd.MM.yyyy HH:mm' }}</p>
            </div>
          </div>
          <p class="post-content">{{ post.content }}</p>
          @if (post.images && post.images.length > 0) {
            @let count = post.images.length;
            @let showCount = count > 4 ? 4 : count;
            <div [class]="'post-images post-images-' + showCount">
              @for (img of post.images.slice(0, showCount); track img.id; let i = $index) {
                <div class="post-image-wrapper" (click)="openViewer(post.images!, i)">
                  <img [src]="img.image_url" loading="lazy">
                  @if (count > 4 && i === showCount - 1) {
                    <div class="post-image-overlay">+{{ count - 4 }}</div>
                  }
                </div>
              }
            </div>
          }
          <div class="flex flex-wrap gap-1 mt-3 pt-2" style="border-top:1px solid var(--divider);">
            @for (r of reactionEmojis; track r) {
              <button (click)="toggleReaction(post, r)"
                [style.background]="hasReacted(post, r) ? 'var(--accent-light)' : 'transparent'"
                [style.border-color]="hasReacted(post, r) ? 'var(--accent)' : 'var(--border-default)'"
                style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;border:1px solid;cursor:pointer;font-size:15px;line-height:1;transition:all 0.15s;">
                {{ r }}
                @if (getReactionCount(post, r) > 0) {
                  <span style="font-size:12px;color:var(--text-secondary);font-weight:500;">{{ getReactionCount(post, r) }}</span>
                }
              </button>
            }
          </div>
        </div>
      }
    </div>

    @if (viewerImages) {
      <div class="viewer-overlay" (click)="closeViewer()">
        <img [src]="viewerImages[viewerIndex].image_url" (click)="$event.stopPropagation()">
        <button class="viewer-close" (click)="closeViewer()">✕</button>
        @if (viewerImages.length > 1) {
          <button class="viewer-nav viewer-nav-prev" (click)="$event.stopPropagation(); prevViewer()">‹</button>
          <button class="viewer-nav viewer-nav-next" (click)="$event.stopPropagation(); nextViewer()">›</button>
          <div class="viewer-counter">{{ viewerIndex + 1 }} / {{ viewerImages.length }}</div>
        }
      </div>
    }
  `,
})
export class FeedComponent implements OnInit {
  posts: Post[] = [];
  newPostContent = '';
  selectedFiles: File[] = [];
  previews: string[] = [];
  isPublic = false;
  reactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉'];
  viewerImages: PostImage[] | null = null;
  viewerIndex = 0;

  hasReacted(post: Post, emoji: string): boolean {
    return post.reactions?.some(r => r.emoji === emoji && r.reacted) ?? false;
  }

  getReactionCount(post: Post, emoji: string): number {
    return post.reactions?.find(r => r.emoji === emoji)?.count ?? 0;
  }

  toggleReaction(post: Post, emoji: string) {
    this.api.toggleReaction(post.id, emoji).subscribe(() => {
      // Optimistically update local state
      const existing = post.reactions?.find(r => r.emoji === emoji);
      if (!post.reactions) post.reactions = [];
      if (existing) {
        existing.reacted = !existing.reacted;
        existing.count += existing.reacted ? 1 : -1;
        if (existing.count <= 0) {
          post.reactions = post.reactions.filter(r => r.emoji !== emoji);
        }
      } else {
        post.reactions.push({ emoji, count: 1, reacted: true });
      }
    });
  }

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadFeed();
  }

  loadFeed() {
    this.api.getFeed().subscribe((posts) => (this.posts = posts));
  }

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

  createPost() {
    if (!this.newPostContent.trim() && this.selectedFiles.length === 0) return;
    this.api.createPost(this.newPostContent, this.selectedFiles, this.isPublic).subscribe(() => {
      this.newPostContent = '';
      this.selectedFiles = [];
      this.previews = [];
      this.isPublic = false;
      this.loadFeed();
    });
  }

  openViewer(images: PostImage[], index: number) {
    this.viewerImages = images;
    this.viewerIndex = index;
    document.body.style.overflow = 'hidden';
  }

  closeViewer() {
    this.viewerImages = null;
    document.body.style.overflow = '';
  }

  prevViewer() {
    if (this.viewerImages) {
      this.viewerIndex = this.viewerIndex > 0 ? this.viewerIndex - 1 : this.viewerImages.length - 1;
    }
  }

  nextViewer() {
    if (this.viewerImages) {
      this.viewerIndex = this.viewerIndex < this.viewerImages.length - 1 ? this.viewerIndex + 1 : 0;
    }
  }
}
