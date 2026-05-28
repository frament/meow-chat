import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Post } from '../../services/api.service';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <div class="space-y-4 sm:space-y-6">
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
          <button (click)="createPost()" class="btn-primary" style="margin-left:auto;">
            Опубликовать
          </button>
        </div>
      </div>

      @for (post of posts; track post.id) {
        <div class="card">
          <div class="post-header">
            @if (post.avatar_url) {
              <img [src]="post.avatar_url" class="post-avatar">
            } @else {
              <div class="post-avatar">
                {{ post.username[0] }}
              </div>
            }
            <div class="post-meta" style="flex:1;">
              <p class="post-username">{{ post.username }}</p>
              <p class="post-time">{{ post.created_at | date:'dd.MM.yyyy HH:mm' }}</p>
            </div>
          </div>
          <p class="post-content">{{ post.content }}</p>
          @if (post.images && post.images.length > 0) {
            <div class="post-images">
              @for (img of post.images; track img.id) {
                <img [src]="img.image_url" class="cursor-pointer hover:opacity-90 transition-opacity"
                  (click)="openImage(img.image_url)">
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class FeedComponent implements OnInit {
  posts: Post[] = [];
  newPostContent = '';
  selectedFiles: File[] = [];
  previews: string[] = [];

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
    this.api.createPost(this.newPostContent, this.selectedFiles).subscribe(() => {
      this.newPostContent = '';
      this.selectedFiles = [];
      this.previews = [];
      this.loadFeed();
    });
  }

  openImage(url: string) {
    window.open(url, '_blank');
  }
}
