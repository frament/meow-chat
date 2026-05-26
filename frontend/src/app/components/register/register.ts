import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gray-50">
      <div class="bg-white p-8 rounded-xl shadow-md w-full max-w-md">
        <h1 class="text-2xl font-bold text-center mb-6">Регистрация</h1>
        <form (ngSubmit)="onSubmit()" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">Имя пользователя</label>
            <input type="text" [(ngModel)]="username" name="username" required
              class="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Email</label>
            <input type="email" [(ngModel)]="email" name="email" required
              class="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700">Пароль</label>
            <input type="password" [(ngModel)]="password" name="password" required
              class="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          </div>
          <button type="submit"
            class="w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors">
            Зарегистрироваться
          </button>
        </form>
        <p class="mt-4 text-center text-sm text-gray-600">
          Уже есть аккаунт? <a routerLink="/login" class="text-blue-600 hover:underline">Войти</a>
        </p>
        @if (error) {
          <p class="mt-2 text-red-600 text-sm text-center">{{ error }}</p>
        }
        @if (success) {
          <p class="mt-2 text-green-600 text-sm text-center">{{ success }}</p>
        }
      </div>
    </div>
  `,
})
export class RegisterComponent {
  username = '';
  email = '';
  password = '';
  error = '';
  success = '';

  constructor(private api: ApiService, private router: Router) {}

  onSubmit() {
    this.api.register(this.username, this.email, this.password).subscribe({
      next: () => {
        this.success = 'Регистрация успешна! Перенаправляю...';
        setTimeout(() => this.router.navigate(['/login']), 1500);
      },
      error: () => {
        this.error = 'Ошибка регистрации. Возможно, пользователь уже существует.';
      },
    });
  }
}
