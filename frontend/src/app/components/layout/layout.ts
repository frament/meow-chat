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
              <a routerLink="/feed" routerLinkActive="text-blue-600 font-medium"
                class="text-gray-600 hover:text-gray-900 transition-colors">Лента</a>
              <a routerLink="/chat" routerLinkActive="text-blue-600 font-medium"
                class="text-gray-600 hover:text-gray-900 transition-colors">Чат</a>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-sm text-gray-600">{{ api.currentUser()?.username }}</span>
              <button (click)="logout()"
                class="text-sm text-red-600 hover:text-red-800 transition-colors">Выйти</button>
            </div>
          </div>
        </div>
      </nav>
      <main class="max-w-4xl mx-auto px-4 py-6">
        <ng-content />
      </main>
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
