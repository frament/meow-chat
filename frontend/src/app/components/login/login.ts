import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center" style="background:var(--bg-body);">
      <div class="card" style="padding:24px 28px;width:100%;max-width:400px;margin:0 16px;">
        <h1 class="text-2xl font-bold text-center mb-6" style="color:var(--text-primary);">Вход</h1>
        <form (ngSubmit)="onSubmit()" class="space-y-4">
          <div>
            <label class="block text-sm font-medium" style="color:var(--text-secondary);">Имя пользователя</label>
            <input type="text" [(ngModel)]="username" name="username" required class="form-input mt-1">
          </div>
          <div>
            <label class="block text-sm font-medium" style="color:var(--text-secondary);">Пароль</label>
            <input type="password" [(ngModel)]="password" name="password" required class="form-input mt-1">
          </div>
          <button type="submit" class="btn-primary" style="width:100%;padding:10px 20px;">
            Войти
          </button>
        </form>
        <p class="mt-4 text-center text-sm" style="color:var(--text-secondary);">
          Нет аккаунта? <a routerLink="/register" style="color:var(--accent);text-decoration:underline;">Зарегистрироваться</a>
        </p>
        @if (error) {
          <p class="mt-2 text-sm text-center" style="color:#e74c3c;">{{ error }}</p>
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
