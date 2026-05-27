import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
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
            <a routerLink="/settings" class="hidden sm:flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors">
              @if (api.currentUser()?.avatar_url) {
                <img [src]="api.currentUser()?.avatar_url" class="w-7 h-7 rounded-full object-cover">
              } @else {
                <div class="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-600">
                  {{ (api.currentUser()?.username ?? '?')[0] }}
                </div>
              }
              <span class="text-sm">{{ api.currentUser()?.username }}</span>
            </a>
          </div>
        </div>
      </nav>
      <main class="max-w-4xl mx-auto px-4 py-6 pb-20 sm:pb-6">
        <router-outlet />
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
          <a routerLink="/settings" routerLinkActive="text-blue-600" class="flex flex-col items-center gap-0.5 text-gray-500 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span class="text-xs">Профиль</span>
          </a>
        </div>
      </nav>
    </div>
  `,
})
export class LayoutComponent {
  constructor(protected api: ApiService) {}
}
