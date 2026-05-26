import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gray-50">
      <div class="bg-white p-8 rounded-xl shadow-md w-full max-w-md">
        <h1 class="text-2xl font-bold text-center mb-6">Вход</h1>
        <form (ngSubmit)="onSubmit()" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">Имя пользователя</label>
            <input type="text" [(ngModel)]="username" name="username" required
              class="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Пароль</label>
            <input type="password" [(ngModel)]="password" name="password" required
              class="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          </div>
          <button type="submit"
            class="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors">
            Войти
          </button>
        </form>
        <p class="mt-4 text-center text-sm text-gray-600">
          Нет аккаунта? <a routerLink="/register" class="text-blue-600 hover:underline">Зарегистрироваться</a>
        </p>
        @if (error) {
          <p class="mt-2 text-red-600 text-sm text-center">{{ error }}</p>
        }
      </div>
    </div>
  `,
})
export class LoginComponent {
  username = '';
  password = '';
  error = '';

  constructor(private api: ApiService, private router: Router) {}

  onSubmit() {
    this.api.login(this.username, this.password).subscribe({
      next: (res) => {
        this.api.currentUser.set(res);
        localStorage.setItem('currentUser', JSON.stringify(res));
        this.router.navigate(['/feed']);
      },
      error: () => {
        this.error = 'Неверное имя пользователя или пароль';
      },
    });
  }
}
