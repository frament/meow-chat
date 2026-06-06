import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService, User } from '../../services/api.service';

interface FileEntry {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  mod_time: string;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="max-w-4xl mx-auto px-4 py-6 pb-20 sm:pb-6">
      <div class="card" style="padding:24px;">
        <h1 class="text-xl font-bold mb-6" style="color:var(--text-primary);">Панель администратора</h1>

        <div class="flex gap-1 mb-6" style="border-bottom:1px solid var(--divider);padding-bottom:1px;">
          <button (click)="activeTab = 'users'"
            [style.background]="activeTab === 'users' ? 'var(--accent-light)' : 'transparent'"
            style="padding:8px 16px;border-radius:8px 8px 0 0;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);transition:all 0.2s;">
            Управление пользователями
          </button>
          <button (click)="activeTab = 'files'"
            [style.background]="activeTab === 'files' ? 'var(--accent-light)' : 'transparent'"
            style="padding:8px 16px;border-radius:8px 8px 0 0;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);transition:all 0.2s;">
            Управление файлами
          </button>
        </div>

        @if (activeTab === 'users') {
          @if (loadingUsers) {
            <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
          } @else {
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead>
                  <tr style="color:var(--text-secondary);border-bottom:1px solid var(--divider);">
                    <th style="text-align:left;padding:8px 12px;font-weight:500;">Пользователь</th>
                    <th style="text-align:left;padding:8px 12px;font-weight:500;">Email</th>
                    <th style="text-align:center;padding:8px 12px;font-weight:500;">Админ</th>
                    <th style="text-align:center;padding:8px 12px;font-weight:500;">Статус</th>
                    <th style="text-align:right;padding:8px 12px;font-weight:500;">Действие</th>
                  </tr>
                </thead>
                <tbody>
                  @for (user of users; track user.id) {
                    <tr style="border-bottom:1px solid var(--divider);">
                      <td style="padding:10px 12px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                          <div style="position:relative;display:inline-flex;">
                            @if (user.avatar_url) {
                              <img [src]="user.avatar_url" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
                            } @else {
                              <div style="width:32px;height:32px;border-radius:50%;background:var(--avatar-bg);color:var(--avatar-text);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;">
                                {{ user.username[0] }}
                              </div>
                            }
                            @if (user.is_admin) {
                              <div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--accent-gradient);border:2px solid var(--bg-body);display:flex;align-items:center;justify-content:center;">
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                              </div>
                            }
                          </div>
                          <span style="color:var(--text-primary);font-weight:500;">{{ user.username }}</span>
                        </div>
                      </td>
                      <td style="padding:10px 12px;color:var(--text-secondary);">{{ user.email }}</td>
                      <td style="padding:10px 12px;text-align:center;">
                        @if (user.is_admin) {
                          <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;background:var(--accent-light);color:var(--accent);">Да</span>
                        } @else {
                          <span style="color:var(--text-tertiary);font-size:13px;">Нет</span>
                        }
                      </td>
                      <td style="padding:10px 12px;text-align:center;">
                        @if (user.is_online) {
                          <span style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:#34d399;">В сети</span>
                        } @else {
                          <span style="color:var(--text-tertiary);font-size:13px;">Не в сети</span>
                        }
                      </td>
                      <td style="padding:10px 12px;text-align:right;">
                        @if (actionLoading === user.id) {
                          <span style="font-size:13px;color:var(--text-tertiary);">...</span>
                        } @else if (user.is_admin) {
                          <button (click)="removeAdmin(user)" style="padding:4px 12px;border-radius:6px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);transition:all 0.2s;">Снять админа</button>
                        } @else {
                          <button (click)="makeAdmin(user)" style="padding:4px 12px;border-radius:6px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:13px;transition:all 0.2s;">Назначить админом</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (actionMsg) {
            <p class="mt-3 text-sm" [style.color]="actionOk ? '#27ae60' : '#e74c3c'">{{ actionMsg }}</p>
          }
        }

        @if (activeTab === 'files') {
          @if (loadingFiles) {
            <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
          } @else if (files.length === 0) {
            <p style="color:var(--text-tertiary);font-size:14px;">Файлы не найдены</p>
          } @else {
            @if (diskInfo) {
              <div style="margin-bottom:20px;padding:16px;border-radius:12px;border:1px solid var(--border-default);">
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                  <span style="font-size:14px;font-weight:600;color:var(--text-primary);">Использование диска</span>
                  <span style="font-size:13px;color:var(--text-secondary);">{{ formatSize(diskInfo.used) }} / {{ formatSize(diskInfo.total) }}</span>
                </div>
                <div style="height:8px;border-radius:999px;background:var(--border-default);overflow:hidden;">
                  <div [style.width.%]="diskInfo.used_pct" style="height:100%;border-radius:999px;background:var(--accent-gradient);transition:width 0.3s;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:6px;">
                  <span style="font-size:12px;color:var(--text-tertiary);">Свободно: {{ formatSize(diskInfo.free) }} ({{ (100 - diskInfo.used_pct).toFixed(1) }}%)</span>
                  <span style="font-size:12px;color:var(--text-tertiary);">{{ diskInfo.used_pct.toFixed(1) }}% занято</span>
                </div>
              </div>
            }
            @if (files.length === 0) {
              <p style="color:var(--text-tertiary);font-size:14px;">Файлы не найдены</p>
            } @else {
              <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                  <thead>
                    <tr style="color:var(--text-secondary);border-bottom:1px solid var(--divider);">
                      <th style="text-align:left;padding:8px 12px;font-weight:500;">Файл</th>
                      <th style="text-align:left;padding:8px 12px;font-weight:500;">Размер</th>
                      <th style="text-align:left;padding:8px 12px;font-weight:500;">Дата</th>
                      <th style="text-align:left;padding:8px 12px;font-weight:500;">Путь</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (file of files; track file.path) {
                      <tr style="border-bottom:1px solid var(--divider);">
                        <td style="padding:10px 12px;color:var(--text-primary);font-weight:500;">
                          <div style="display:flex;align-items:center;gap:8px;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2">
                              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            {{ file.name }}
                          </div>
                        </td>
                        <td style="padding:10px 12px;color:var(--text-secondary);">{{ formatSize(file.size) }}</td>
                        <td style="padding:10px 12px;color:var(--text-secondary);">{{ file.mod_time | date:'dd.MM.yyyy HH:mm' }}</td>
                        <td style="padding:10px 12px;color:var(--text-tertiary);font-size:13px;">{{ file.path }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        }
      </div>
    </div>
  `,
})
export class AdminComponent implements OnInit {
  activeTab: 'users' | 'files' = 'users';
  users: User[] = [];
  files: FileEntry[] = [];
  diskInfo: { total: number; used: number; free: number; total_gb: number; used_gb: number; free_gb: number; used_pct: number } | null = null;
  loadingUsers = false;
  loadingFiles = false;
  actionLoading: number | null = null;
  actionMsg = '';
  actionOk = false;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadUsers();
    this.loadFiles();
  }

  loadUsers() {
    this.loadingUsers = true;
    this.api.getAdminUsers().subscribe({
      next: (u) => { this.users = u; this.loadingUsers = false; },
      error: () => this.loadingUsers = false,
    });
  }

  loadFiles() {
    this.loadingFiles = true;
    this.api.getAdminFiles().subscribe({
      next: (res) => { this.files = res.files; this.diskInfo = res.disk; this.loadingFiles = false; },
      error: () => this.loadingFiles = false,
    });
  }

  makeAdmin(user: User) {
    this.actionLoading = user.id;
    this.actionMsg = '';
    this.api.adminMakeAdmin(user.id).subscribe({
      next: () => {
        user.is_admin = true;
        this.actionLoading = null;
        this.actionMsg = `Пользователь ${user.username} теперь администратор`;
        this.actionOk = true;
        this.clearMsg();
      },
      error: () => {
        this.actionLoading = null;
        this.actionMsg = 'Ошибка назначения администратора';
        this.actionOk = false;
        this.clearMsg();
      },
    });
  }

  removeAdmin(user: User) {
    this.actionLoading = user.id;
    this.actionMsg = '';
    this.api.adminRemoveAdmin(user.id).subscribe({
      next: () => {
        user.is_admin = false;
        this.actionLoading = null;
        this.actionMsg = `Права администратора сняты с ${user.username}`;
        this.actionOk = true;
        this.clearMsg();
      },
      error: () => {
        this.actionLoading = null;
        this.actionMsg = 'Ошибка снятия прав администратора';
        this.actionOk = false;
        this.clearMsg();
      },
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private clearMsg() {
    setTimeout(() => (this.actionMsg = ''), 3000);
  }
}
