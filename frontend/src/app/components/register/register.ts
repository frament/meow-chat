import { Component, OnInit } from '@angular/core';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
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
        @if (!inviteToken) {
          <p class="text-center text-sm" style="color:var(--text-tertiary);margin-bottom:16px;">
            Регистрация только по приглашениям. Вам нужен invite-токен от existing пользователя.
          </p>
        }
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
          @if (!inviteToken) {
            <div>
              <label class="block text-sm font-medium" style="color:var(--text-secondary);">Invite-токен</label>
              <input type="text" [(ngModel)]="inviteToken" name="invite_token" required class="form-input mt-1" placeholder="Вставьте токен">
            </div>
          }
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
export class RegisterComponent implements OnInit {
  username = '';
  email = '';
  password = '';
  inviteToken = '';
  error = '';
  success = '';
  checking = false;

  constructor(
    private api: ApiService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    this.inviteToken = this.route.snapshot.queryParams['invite'] || '';
    if (this.inviteToken) {
      this.checking = true;
      this.api.checkInvite(this.inviteToken).subscribe({
        next: (res) => {
          this.checking = false;
          if (!res.valid) {
            this.error = 'Invite-токен недействителен' + (res.reason ? ' (' + res.reason + ')' : '');
          }
        },
        error: () => {
          this.checking = false;
          this.error = 'Invite-токен не найден';
        },
      });
    }
  }

  onSubmit() {
    if (!this.inviteToken) return;
    this.api.register(this.username, this.email, this.password, this.inviteToken).subscribe({
      next: () => {
        this.success = 'Регистрация успешна! Перенаправляю...';
        setTimeout(() => this.router.navigate(['/login']), 1500);
      },
      error: (err) => {
        if (err.status === 400) {
          this.error = err.error?.error || 'Ошибка: недействительный invite-токен';
        } else {
          this.error = 'Ошибка регистрации. Возможно, пользователь уже существует.';
        }
      },
    });
  }
}
