import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-admin-federation',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="max-w-4xl mx-auto px-4 py-6 pb-20 sm:pb-6">
      <div class="card" style="padding:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h1 class="text-xl font-bold" style="color:var(--text-primary);">Федеративная сеть</h1>
          <div style="display:flex;gap:8px;">
            <button (click)="showConnect = true" style="padding:8px 16px;border-radius:8px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.2s;">Подключиться</button>
            <button (click)="showInvite = true" style="padding:8px 16px;border-radius:8px;border:none;background:#27ae60;color:white;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.2s;">Создать инвайт</button>
            <button (click)="showRestore = true" style="padding:8px 16px;border-radius:8px;border:none;background:#8e44ad;color:white;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.2s;">Восстановить</button>
          </div>
        </div>

        <!-- Stats -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">
          <div style="padding:16px;border-radius:12px;border:1px solid var(--border-default);">
            <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:4px;">Серверов</div>
            <div style="font-size:24px;font-weight:700;color:var(--text-primary);">{{ servers.length }}</div>
          </div>
          <div style="padding:16px;border-radius:12px;border:1px solid var(--border-default);">
            <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:4px;">Всего кэш</div>
            <div style="font-size:24px;font-weight:700;color:var(--text-primary);">{{ formatTotalCache() }}</div>
          </div>
          <div style="padding:16px;border-radius:12px;border:1px solid var(--border-default);">
            <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:4px;">Очередь failed</div>
            <div style="font-size:24px;font-weight:700;color:var(--text-primary);">{{ failedCount }}</div>
          </div>
        </div>

        <!-- Servers table -->
        @if (loading) {
          <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
        } @else if (servers.length === 0) {
          <p style="color:var(--text-tertiary);font-size:14px;">Нет подключенных серверов. Нажмите "Подключиться" или "Создать инвайт".</p>
        } @else {
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <thead>
                <tr style="color:var(--text-secondary);border-bottom:1px solid var(--divider);">
                  <th style="text-align:left;padding:8px 12px;font-weight:500;">Имя</th>
                  <th style="text-align:left;padding:8px 12px;font-weight:500;">Адрес</th>
                  <th style="text-align:center;padding:8px 12px;font-weight:500;">Статус</th>
                  <th style="text-align:right;padding:8px 12px;font-weight:500;">Кэш</th>
                  <th style="text-align:right;padding:8px 12px;font-weight:500;">Действия</th>
                </tr>
              </thead>
              <tbody>
                @for (s of servers; track s.id) {
                  <tr style="border-bottom:1px solid var(--divider);">
                    <td style="padding:10px 12px;color:var(--text-primary);font-weight:500;">{{ s.name }}</td>
                    <td style="padding:10px 12px;color:var(--text-secondary);font-size:13px;">{{ s.base_url }}</td>
                    <td style="padding:10px 12px;text-align:center;">
                      @if (s.status === 'active') {
                        <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;background:rgba(52,211,153,0.1);color:#34d399;">active</span>
                      } @else if (s.status === 'blocked') {
                        <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;background:rgba(231,76,60,0.1);color:#e74c3c;">blocked</span>
                      } @else {
                        <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;background:rgba(241,196,15,0.1);color:#f1c40f;">{{ s.status }}</span>
                      }
                    </td>
                    <td style="padding:10px 12px;text-align:right;color:var(--text-primary);">{{ formatBytes(s.cache_bytes) }}</td>
                    <td style="padding:10px 12px;text-align:right;">
                      <div style="display:flex;gap:4px;justify-content:flex-end;">
                        <button (click)="ping(s)" title="Пинг" style="padding:4px 8px;border-radius:6px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);transition:all 0.2s;">🔄</button>
                        @if (s.status === 'active') {
                          <button (click)="block(s)" title="Заблокировать" style="padding:4px 8px;border-radius:6px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:#e74c3c;transition:all 0.2s;">⛔</button>
                        } @else if (s.status === 'blocked') {
                          <button (click)="unblock(s)" title="Разблокировать" style="padding:4px 8px;border-radius:6px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:#27ae60;transition:all 0.2s;">✅</button>
                        }
                        <button (click)="clearCache(s)" title="Очистить кэш" style="padding:4px 8px;border-radius:6px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);transition:all 0.2s;">🧹</button>
                        <button (click)="disconnect(s)" title="Отключить" style="padding:4px 8px;border-radius:6px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);transition:all 0.2s;">✕</button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        <!-- Cache limits -->
        @if (servers.length > 0) {
          <div style="margin-top:20px;padding:16px;border-radius:12px;border:1px solid var(--border-default);">
            <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:12px;">Лимиты кэша (МБ)</h3>
            @for (s of servers; track s.id) {
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
                <span style="width:120px;font-size:13px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ s.name }}</span>
                <input type="range" min="128" max="10240" [value]="s.disk_cache_limit" (change)="updateCacheLimit(s, $event)" style="flex:1;accent-color:var(--accent);">
                <span style="font-size:13px;color:var(--text-secondary);min-width:60px;text-align:right;">{{ s.disk_cache_limit }} МБ</span>
              </div>
            }
          </div>
        }

        @if (msg) {
          <p class="mt-3 text-sm" [style.color]="msgOk ? '#27ae60' : '#e74c3c'">{{ msg }}</p>
        }
      </div>
    </div>

    <!-- Connect modal -->
    @if (showConnect) {
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px;">
        <div style="background:white;border-radius:12px;padding:24px;width:100%;max-width:440px;">
          <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">Подключиться к серверу</h3>
          <input [(ngModel)]="connectUrl" placeholder="https://server.example.com/invite?token=..." style="width:100%;padding:10px 12px;border:1px solid var(--border-default);border-radius:8px;font-size:14px;margin-bottom:16px;">
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button (click)="showConnect = false" style="padding:8px 16px;border-radius:8px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);">Отмена</button>
            <button (click)="doConnect()" style="padding:8px 16px;border-radius:8px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:13px;font-weight:500;">Подключиться</button>
          </div>
        </div>
      </div>
    }

    <!-- Invite modal -->
    @if (showInvite) {
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px;">
        <div style="background:white;border-radius:12px;padding:24px;width:100%;max-width:440px;">
          <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">Создать приглашение</h3>
          <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:6px;">Максимум использований (0 = безлимит):</label>
          <input type="number" [(ngModel)]="inviteMaxUses" min="0" style="width:100%;padding:10px 12px;border:1px solid var(--border-default);border-radius:8px;font-size:14px;margin-bottom:12px;">
          <button (click)="createInvite()" style="padding:8px 16px;border-radius:8px;border:none;background:#27ae60;color:white;cursor:pointer;font-size:13px;font-weight:500;margin-bottom:12px;">Создать</button>
          @if (generatedInviteUrl) {
            <div style="padding:12px;background:var(--bg-secondary);border-radius:8px;font-size:13px;word-break:break-all;color:var(--text-primary);margin-bottom:12px;">
              {{ generatedInviteUrl }}
            </div>
          }
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button (click)="showInvite = false; generatedInviteUrl = ''" style="padding:8px 16px;border-radius:8px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);">Закрыть</button>
          </div>
        </div>
      </div>
    }

    <!-- Restore modal -->
    @if (showRestore) {
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px;">
        <div style="background:white;border-radius:12px;padding:24px;width:100%;max-width:440px;">
          <h3 style="font-size:16px;font-weight:700;margin-bottom:8px;">Восстановление после переустановки</h3>
          <p style="font-size:13px;color:var(--text-tertiary);margin-bottom:12px;">Введите URL любого сервера из вашей федеративной сети:</p>
          <input [(ngModel)]="restoreUrl" placeholder="https://peer.example.com" style="width:100%;padding:10px 12px;border:1px solid var(--border-default);border-radius:8px;font-size:14px;margin-bottom:16px;">
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button (click)="showRestore = false" style="padding:8px 16px;border-radius:8px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:13px;color:var(--text-secondary);">Отмена</button>
            <button (click)="doRestore()" style="padding:8px 16px;border-radius:8px;border:none;background:#8e44ad;color:white;cursor:pointer;font-size:13px;font-weight:500;">Восстановить</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class AdminFederationComponent implements OnInit {
  servers: any[] = [];
  loading = false;
  msg = '';
  msgOk = false;
  failedCount = 0;

  showConnect = false;
  connectUrl = '';

  showInvite = false;
  inviteMaxUses = 1;
  generatedInviteUrl = '';

  showRestore = false;
  restoreUrl = '';

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadServers();
  }

  loadServers() {
    this.loading = true;
    this.api.getFederationServers().subscribe({
      next: (res) => {
        this.servers = res;
        this.loading = false;
      },
      error: () => this.loading = false,
    });
  }

  ping(s: any) {
    this.api.pingFederationServer(s.id).subscribe({
      next: (res) => {
        s.status = res.status;
        this.msg = `Пинг завершён: ${res.status}`;
        this.msgOk = true;
        this.clearMsg();
      },
    });
  }

  block(s: any) {
    this.api.blockFederationServer(s.id).subscribe(() => {
      s.status = 'blocked';
    });
  }

  unblock(s: any) {
    this.api.unblockFederationServer(s.id).subscribe(() => {
      s.status = 'active';
    });
  }

  clearCache(s: any) {
    this.api.clearFederationCache(s.id).subscribe(() => {
      s.cache_bytes = 0;
      s.cache_count = 0;
    });
  }

  disconnect(s: any) {
    if (!confirm(`Отключить сервер "${s.name}"?`)) return;
    this.api.deleteFederationServer(s.id).subscribe(() => {
      this.servers = this.servers.filter(x => x.id !== s.id);
    });
  }

  createInvite() {
    this.api.createFederationInvite(this.inviteMaxUses).subscribe({
      next: (res) => {
        this.generatedInviteUrl = res.invite_url;
      },
    });
  }

  doConnect() {
    if (!this.connectUrl) return;
    this.api.connectFederation(this.connectUrl).subscribe({
      next: () => {
        this.showConnect = false;
        this.connectUrl = '';
        this.loadServers();
        this.msg = 'Сервер подключён';
        this.msgOk = true;
        this.clearMsg();
      },
    });
  }

  doRestore() {
    if (!this.restoreUrl) return;
    this.api.restoreFederation(this.restoreUrl).subscribe({
      next: () => {
        this.showRestore = false;
        this.restoreUrl = '';
        this.loadServers();
        this.msg = 'Восстановление запущено — синхронизация в фоне';
        this.msgOk = true;
        this.clearMsg();
      },
    });
  }

  updateCacheLimit(s: any, event: Event) {
    const target = event.target as HTMLInputElement;
    s.disk_cache_limit = parseInt(target.value, 10);
    this.api.updateFederationServer(s.id, {
      disk_cache_limit: s.disk_cache_limit,
    }).subscribe();
  }

  formatBytes(bytes: number): string {
    if (!bytes) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  formatTotalCache(): string {
    const total = this.servers.reduce((acc: number, s: any) => acc + (s.cache_bytes || 0), 0);
    return this.formatBytes(total);
  }

  private clearMsg() {
    setTimeout(() => (this.msg = ''), 3000);
  }
}
