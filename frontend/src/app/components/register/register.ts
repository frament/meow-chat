import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center px-4" style="background:var(--bg-body);">
      <div class="card" style="padding:24px 28px;width:100%;max-width:400px;">
        <h1 class="text-2xl font-bold text-center mb-6" style="color:var(--text-primary);">Регистрация</h1>
        <form (ngSubmit)="onSubmit()" class="space-y-4">
          <div>
            <label class="block text-sm font-medium" style="color:var(--text-secondary);">Имя пользователя</label>
            <input type="text" [(ngModel)]="username" name="username" required class="form-input mt-1">
          </div>
          <div>
            <label class="block text-sm font-medium" style="color:var(--text-secondary);">Email</label>
            <input type="email" [(ngModel)]="email" name="email" required class="form-input mt-1">
          </div>
          <div>
            <label class="block text-sm font-medium" style="color:var(--text-secondary);">Пароль</label>
            <input type="password" [(ngModel)]="password" name="password" required class="form-input mt-1">
          </div>
          <button type="submit" class="btn-primary" style="width:100%;padding:10px 20px;">
            Зарегистрироваться
          </button>
        </form>
        <p class="mt-4 text-center text-sm" style="color:var(--text-secondary);">
          Уже есть аккаунт? <a routerLink="/login" style="color:var(--accent);text-decoration:underline;">Войти</a>
        </p>
        @if (error) {
          <p class="mt-2 text-sm text-center" style="color:#e74c3c;">{{ error }}</p>
        }
        @if (success) {
          <p class="mt-2 text-sm text-center" style="color:#27ae60;">{{ success }}</p>
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
