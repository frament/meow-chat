import { Component } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-screen bg-gray-50">
      <nav class="bg-white shadow-sm border-b">
        <div class="max-w-4xl mx-auto px-4">
          <div class="flex items-center justify-between h-14">
            <div class="flex items-center gap-6">
              <a routerLink="/feed" class="font-bold text-lg text-blue-600">MyChat</a>
              <div class="hidden sm:flex items-center gap-6">
                <a routerLink="/feed" routerLinkActive="text-blue-600 font-medium"
                  class="text-gray-600 hover:text-gray-900 transition-colors">Лента</a>
                <a routerLink="/chat" routerLinkActive="text-blue-600 font-medium"
                  class="text-gray-600 hover:text-gray-900 transition-colors">Чат</a>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-sm text-gray-600 hidden sm:inline">{{ api.currentUser()?.username }}</span>
              <button (click)="logout()"
                class="text-sm text-red-600 hover:text-red-800 transition-colors">Выйти</button>
            </div>
          </div>
        </div>
      </nav>
      <main class="max-w-4xl mx-auto px-4 py-6 pb-20 sm:pb-6">
        <ng-content />
      </main>
      <nav class="fixed bottom-0 left-0 right-0 bg-white border-t sm:hidden z-50">
        <div class="flex items-center justify-around h-14">
          <a routerLink="/feed" routerLinkActive="text-blue-600" class="flex flex-col items-center gap-0.5 text-gray-500 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
            <span class="text-xs">Лента</span>
          </a>
          <a routerLink="/chat" routerLinkActive="text-blue-600" class="flex flex-col items-center gap-0.5 text-gray-500 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span class="text-xs">Чат</span>
          </a>
        </div>
      </nav>
    </div>
  `,
})
export class LayoutComponent {
  constructor(protected api: ApiService, private router: Router) {}

  logout() {
    this.api.currentUser.set(null);
    localStorage.removeItem('currentUser');
    this.router.navigate(['/login']);
  }
}
