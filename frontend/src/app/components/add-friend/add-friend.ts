import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-add-friend',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="min-h-screen flex items-center justify-center px-4" style="background:var(--bg-body);">
      <div class="card" style="padding:24px 28px;width:100%;max-width:400px;text-align:center;">
        @if (loading) {
          <p style="color:var(--text-secondary);">Проверка приглашения...</p>
        }

        @if (!loading && error) {
          <div>
            <h1 class="text-xl font-bold mb-4" style="color:var(--text-primary);">Ошибка</h1>
            <p style="color:var(--text-tertiary);margin-bottom:16px;">{{ error }}</p>
            <button (click)="router.navigate(['/settings'])" class="btn-secondary" style="padding:8px 20px;">Настройки</button>
          </div>
        }

        @if (!loading && !error && inviteData) {
          <h1 class="text-xl font-bold mb-4" style="color:var(--text-primary);">Приглашение в друзья</h1>
          <p style="color:var(--text-secondary);margin-bottom:4px;">Пользователь</p>
          <p class="text-lg font-semibold mb-6" style="color:var(--text-primary);">{{ inviteData.creator }}</p>
          <p style="color:var(--text-tertiary);font-size:13px;margin-bottom:16px;">хочет добавить вас в друзья</p>
          @if (acceptSuccess) {
            <div class="mb-4">
              <p style="color:#27ae60;font-weight:500;margin-bottom:8px;">Вы стали друзьями!</p>
              <button (click)="router.navigate(['/chat'])" class="btn-primary" style="padding:8px 20px;">Написать</button>
            </div>
          } @else if (acceptError) {
            <p style="color:#e74c3c;font-size:13px;margin-bottom:12px;">{{ acceptError }}</p>
            <button (click)="doAccept()" class="btn-primary" style="padding:10px 24px;">Повторить</button>
          } @else {
            <button (click)="doAccept()" [disabled]="accepting" class="btn-primary" style="padding:10px 24px;">
              {{ accepting ? 'Принятие...' : 'Принять приглашение' }}
            </button>
            <div class="mt-4">
              <a routerLink="/" style="color:var(--text-tertiary);font-size:13px;text-decoration:underline;">Вернуться на главную</a>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class AddFriendComponent implements OnInit {
  loading = true;
  error = '';
  inviteData: { valid: boolean; creator: string; created_by: number } | null = null;
  accepting = false;
  acceptSuccess = false;
  acceptError = '';

  constructor(
    private route: ActivatedRoute,
    protected router: Router,
    private api: ApiService,
  ) {}

  ngOnInit() {
    const token = this.route.snapshot.queryParams['token'];
    if (!token) {
      this.error = 'Неверная ссылка приглашения';
      this.loading = false;
      return;
    }

    if (!this.api.currentUser()) {
      this.router.navigate(['/login'], { queryParams: { redirect: `/add-friend?token=${token}` } });
      return;
    }

    this.api.checkFriendInvite(token).subscribe({
      next: (res) => {
        this.loading = false;
        if (!res.valid) {
          this.error = res.reason === 'already_used' ? 'Это приглашение уже использовано' : 'Приглашение недействительно';
          return;
        }
        this.inviteData = res;
      },
      error: () => {
        this.loading = false;
        this.error = 'Приглашение не найдено';
      },
    });
  }

  doAccept() {
    const token = this.route.snapshot.queryParams['token'];
    if (!token) return;

    this.accepting = true;
    this.acceptError = '';
    this.api.acceptFriendInvite(token).subscribe({
      next: () => {
        this.accepting = false;
        this.acceptSuccess = true;
      },
      error: (err) => {
        this.accepting = false;
        this.acceptError = err.error?.error || 'Ошибка принятия приглашения';
      },
    });
  }
}
