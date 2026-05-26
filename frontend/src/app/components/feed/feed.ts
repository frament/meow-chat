import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Post } from '../../services/api.service';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <div class="space-y-6">
      <div class="bg-white rounded-xl shadow-sm border p-4">
        <h2 class="text-lg font-semibold mb-3">Новый пост</h2>
        <textarea [(ngModel)]="newPostContent" rows="3"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          placeholder="Что у вас нового?"></textarea>
        <button (click)="createPost()"
          class="mt-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm">
          Опубликовать
        </button>
      </div>

      @for (post of posts; track post.id) {
        <div class="bg-white rounded-xl shadow-sm border p-4">
          <div class="flex items-center gap-2 mb-2">
            <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-medium text-blue-600">
              {{ post.username[0] }}
            </div>
            <div>
              <p class="text-sm font-medium">{{ post.username }}</p>
              <p class="text-xs text-gray-500">{{ post.created_at | date:'dd.MM.yyyy HH:mm' }}</p>
            </div>
          </div>
          <p class="text-gray-800">{{ post.content }}</p>
        </div>
      }
    </div>
  `,
})
export class FeedComponent implements OnInit {
  posts: Post[] = [];
  newPostContent = '';

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadFeed();
  }

  loadFeed() {
    this.api.getFeed().subscribe((posts) => (this.posts = posts));
  }

  createPost() {
    if (!this.newPostContent.trim()) return;
    this.api.createPost(this.newPostContent).subscribe(() => {
      this.newPostContent = '';
      this.loadFeed();
    });
  }
}
