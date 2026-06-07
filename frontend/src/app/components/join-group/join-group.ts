import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-join-group',
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
            <button (click)="router.navigate(['/'])" class="btn-secondary" style="padding:8px 20px;">На главную</button>
          </div>
        }

        @if (!loading && !error && groupName) {
          <h1 class="text-xl font-bold mb-4" style="color:var(--text-primary);">Приглашение в группу</h1>
          <p style="color:var(--text-secondary);margin-bottom:4px;">Вы приглашены в</p>
          <p class="text-lg font-semibold mb-6" style="color:var(--text-primary);">{{ groupName }}</p>
          @if (joinSuccess) {
            <div class="mb-4">
              <p style="color:#27ae60;font-weight:500;margin-bottom:8px;">Вы присоединились к группе! 🎉</p>
              <button (click)="router.navigate(['/chat', 'group', groupChatId])" class="btn-primary" style="padding:8px 20px;">Открыть чат</button>
            </div>
          } @else if (joinError) {
            <p style="color:#e74c3c;font-size:13px;margin-bottom:12px;">{{ joinError }}</p>
            <button (click)="doJoin()" class="btn-primary" style="padding:10px 24px;">Повторить</button>
          } @else {
            <button (click)="doJoin()" [disabled]="joining" class="btn-primary" style="padding:10px 24px;">
              {{ joining ? 'Присоединение...' : 'Присоединиться' }}
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
export class JoinGroupComponent implements OnInit {
  loading = true;
  error = '';
  groupName = '';
  groupChatId = 0;
  joining = false;
  joinSuccess = false;
  joinError = '';

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
      this.router.navigate(['/login'], { queryParams: { redirect: `/join-group?token=${token}` } });
      return;
    }

    this.api.getGroupInvite(token).subscribe({
      next: (res) => {
        this.loading = false;
        this.groupName = res.group_name;
        this.groupChatId = res.group_chat_id;
      },
      error: () => {
        this.loading = false;
        this.error = 'Приглашение не найдено или истекло';
      },
    });
  }

  doJoin() {
    const token = this.route.snapshot.queryParams['token'];
    if (!token) return;

    this.joining = true;
    this.joinError = '';
    this.api.joinGroupViaInvite(token).subscribe({
      next: () => {
        this.joining = false;
        this.joinSuccess = true;
      },
      error: (err) => {
        this.joining = false;
        this.joinError = err.error?.error || 'Ошибка присоединения к группе';
      },
    });
  }
}
