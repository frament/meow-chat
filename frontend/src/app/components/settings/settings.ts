import { Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpEventType } from '@angular/common/http';
import { SwUpdate } from '@angular/service-worker';
import { ApiService, InviteToken, User } from '../../services/api.service';
import { ThemeService, ThemeMode } from '../../services/theme.service';
import { CryptoService } from '../../services/crypto.service';
import * as QRCode from 'qrcode';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="max-w-lg mx-auto px-4 py-6 pb-20 sm:pb-6">
      <div class="card" style="padding:24px;">
        <h1 class="text-xl font-bold mb-6" style="color:var(--text-primary);">Настройки</h1>

        <div class="flex flex-col items-center mb-6">
          <div class="relative">
            @if (previewUrl || currentAvatar) {
              <img [src]="previewUrl || currentAvatar" alt="Avatar"
                class="w-24 h-24 rounded-full object-cover" style="border:2px solid var(--border-default);">
            } @else {
              <div class="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-medium"
                style="background:var(--avatar-bg);color:var(--avatar-text);border:2px solid var(--border-default);">
                {{ currentUsername[0] }}
              </div>
            }
            <label class="absolute bottom-0 right-0 rounded-full p-1.5 cursor-pointer transition-colors"
              style="background:var(--accent-gradient);color:white;box-shadow:var(--shadow-sm);">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <input type="file" accept="image/*" (change)="onFileSelected($event)" class="hidden">
            </label>
          </div>
          @if (uploading) {
            <div class="w-full mt-2">
              <div class="h-1.5 rounded-full" style="background:var(--border-light);">
                <div class="h-full rounded-full transition-all duration-200" [style.width.%]="uploadProgress" style="background:var(--accent-gradient);"></div>
              </div>
              <p class="text-xs mt-1 text-center" style="color:var(--text-muted);">{{ uploadProgress }}%</p>
            </div>
          }
          @if (avatarSuccess) {
            <p class="text-sm mt-2" style="color:#27ae60;">Аватар обновлён</p>
          }
        </div>

        <form (ngSubmit)="onSubmit()" class="space-y-4">
          <div>
            <label class="block text-sm font-medium" style="color:var(--text-secondary);">Имя пользователя</label>
            <input type="text" [(ngModel)]="username" name="username" required class="form-input">
          </div>
          <div>
            <label class="block text-sm font-medium" style="color:var(--text-secondary);">Email</label>
            <input type="email" [(ngModel)]="email" name="email" required class="form-input">
          </div>
          <div class="flex gap-3">
            <button type="submit" [disabled]="saving" class="btn-primary" style="flex:1;padding:10px 20px;">
              {{ saving ? 'Сохранение...' : 'Сохранить' }}
            </button>
            <button type="button" (click)="logout()"
              class="btn-danger" style="padding:10px 16px;background:transparent;border:none;color:var(--text-tertiary);font-weight:500;cursor:pointer;font-size:13px;">
              Выйти
            </button>
          </div>
        </form>
        @if (success) {
          <p class="mt-3 text-sm text-center" style="color:#27ae60;">{{ success }}</p>
        }
        @if (error) {
          <p class="mt-3 text-sm text-center" style="color:#e74c3c;">{{ error }}</p>
        }

        <div class="divider"></div>

        <div>
          <div class="section-label">Оформление</div>
          <div class="theme-options">
            <label class="theme-option" [class.active]="selectedTheme === 'light'" (click)="selectTheme('light')">
              <span class="theme-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg></span>
              <div>
                <div>Светлая</div>
                <div class="theme-desc">Тёплая кремовая гамма</div>
              </div>
              <span class="radio" style="margin-left:auto;"></span>
            </label>
            <label class="theme-option" [class.active]="selectedTheme === 'dark'" (click)="selectTheme('dark')">
              <span class="theme-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span>
              <div>
                <div>Тёмная</div>
                <div class="theme-desc">Глубокий тёмный фон, аккуратные акценты</div>
              </div>
              <span class="radio" style="margin-left:auto;"></span>
            </label>
            <label class="theme-option" [class.active]="selectedTheme === 'system'" (click)="selectTheme('system')">
              <span class="theme-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="21" x2="22" y2="21"/></svg></span>
              <div>
                <div>Системная</div>
                <div class="theme-desc">Автоматически следует за настройками системы</div>
              </div>
              <span class="radio" style="margin-left:auto;"></span>
            </label>
          </div>
        </div>

        <div class="divider"></div>

        <div>
          <div class="section-label">Приглашения</div>
          @if (inviteError) {
            <p class="text-sm mb-2" style="color:#e74c3c;">{{ inviteError }}</p>
          }
          <button type="button" (click)="createInvite()" [disabled]="creatingInvite"
            class="btn-secondary" style="width:100%;padding:10px 20px;margin-bottom:12px;">
            {{ creatingInvite ? 'Создание...' : 'Создать приглашение' }}
          </button>
          @if (invites.length > 0) {
            <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;">
              @for (inv of invites; track inv.id) {
                <div style="padding:10px;border-radius:8px;border:1px solid var(--border-default);font-size:13px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="color:var(--text-primary);font-weight:500;">{{ inv.token.slice(0, 16) }}…</span>
                    <div style="display:flex;gap:4px;">
                      <button (click)="copyInvite(inv.token)" title="Копировать ссылку"
                        style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-default);background:transparent;cursor:pointer;font-size:12px;color:var(--text-secondary);">Копировать</button>
                      <button (click)="showQR(inv.token)" title="QR-код"
                        style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-default);background:transparent;cursor:pointer;font-size:12px;color:var(--text-secondary);">QR</button>
                      <button (click)="revokeInvite(inv.id)" title="Отозвать"
                        style="padding:4px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:#e74c3c;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    </div>
                  </div>
                  <div style="display:flex;gap:12px;color:var(--text-tertiary);font-size:12px;">
                    <span>Использовано: {{ inv.use_count }}/{{ inv.max_uses === 0 ? '∞' : inv.max_uses }}</span>
                    <span>{{ inv.created_at | date:'dd.MM.yy' }}</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        @if (qrDataUrl) {
          <div (click)="closeQR()" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;background:rgba(0,0,0,0.6);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;">
            <div (click)="$event.stopPropagation()" style="background:white;border-radius:16px;padding:32px;text-align:center;max-width:360px;width:100%;box-shadow:0 16px 48px rgba(0,0,0,0.3);">
              <img [src]="qrDataUrl" style="width:240px;height:240px;margin:0 auto 16px;border-radius:8px;">
              <p style="font-size:14px;color:#333;font-weight:600;word-break:break-all;margin-bottom:12px;">{{ qrInviteUrl }}</p>
              <div style="display:flex;gap:8px;justify-content:center;">
                <button (click)="copyInviteFromQR()" style="padding:8px 20px;border-radius:8px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:14px;font-weight:500;">Копировать ссылку</button>
                <button (click)="closeQR()" style="padding:8px 20px;border-radius:8px;border:1px solid var(--border-default);background:transparent;cursor:pointer;font-size:14px;color:#666;">Закрыть</button>
              </div>
            </div>
          </div>
        }

        <div class="divider"></div>

        <div>
          <div class="section-label">Друзья</div>
          @if (friendInviteError) {
            <p class="text-sm mb-2" style="color:#e74c3c;">{{ friendInviteError }}</p>
          }
          @if (friendInviteSuccess) {
            <div style="padding:10px;border-radius:8px;border:1px solid var(--border-default);font-size:13px;margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:var(--text-primary);font-weight:500;word-break:break-all;font-size:12px;">{{ friendInviteUrl }}</span>
                <div style="display:flex;gap:4px;flex-shrink:0;">
                  <button (click)="copyFriendInvite()" title="Копировать"
                    style="padding:5px;border-radius:6px;border:1px solid var(--border-default);background:transparent;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                  </button>
                  <button (click)="showFriendQR()" title="QR-код"
                    style="padding:5px;border-radius:6px;border:1px solid var(--border-default);background:transparent;cursor:pointer;color:var(--text-secondary);display:flex;align-items:center;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5" height="5"/><rect x="16" y="3" width="5" height="5"/><rect x="3" y="16" width="5" height="5"/><path d="M21 16h-5v5"/><path d="M16 21v-5h5"/><rect x="10" y="10" width="4" height="4"/></svg>
                  </button>
                  <button (click)="clearFriendInvite()" title="Удалить"
                    style="padding:4px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:#e74c3c;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </div>
              </div>
            </div>
          }
          <button type="button" (click)="createFriendInvite()" [disabled]="creatingFriendInvite"
            class="btn-secondary" style="width:100%;padding:10px 20px;margin-bottom:12px;">
            {{ creatingFriendInvite ? 'Создание...' : 'Создать приглашение в друзья' }}
          </button>
          @if (friends.length > 0) {
            <div style="display:flex;flex-direction:column;gap:6px;">
              @for (friend of friends; track friend.id) {
                <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--border-default);font-size:13px;">
                  <div style="position:relative;display:inline-flex;">
                    @if (friend.avatar_url) {
                      <img [src]="friend.avatar_url" class="w-7 h-7 rounded-full object-cover">
                    } @else {
                      <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
                        style="background:var(--avatar-bg);color:var(--avatar-text);">
                        {{ friend.username[0] }}
                      </div>
                    }
                  </div>
                  <span class="flex-1" style="color:var(--text-primary);font-weight:500;">{{ friend.username }}</span>
                  @if (friend.is_online) {
                    <span class="w-2 h-2 rounded-full" style="background:#34d399;"></span>
                  }
                  <button (click)="removeFriend(friend.id)" title="Удалить из друзей"
                    style="padding:4px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:#e74c3c;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </div>
              }
            </div>
          } @else {
            <p class="text-sm" style="color:var(--text-tertiary);text-align:center;padding:16px 0;">У вас пока нет друзей. Создайте приглашение и поделитесь ссылкой.</p>
          }
        </div>

        @if (friendQrDataUrl) {
          <div (click)="closeFriendQR()" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;background:rgba(0,0,0,0.6);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;">
            <div (click)="$event.stopPropagation()" style="background:white;border-radius:16px;padding:32px;text-align:center;max-width:360px;width:100%;box-shadow:0 16px 48px rgba(0,0,0,0.3);">
              <img [src]="friendQrDataUrl" style="width:240px;height:240px;margin:0 auto 16px;border-radius:8px;">
              <p style="font-size:14px;color:#333;font-weight:600;word-break:break-all;margin-bottom:12px;">{{ friendQrUrl }}</p>
              <div style="display:flex;gap:8px;justify-content:center;">
                <button (click)="copyFriendInviteFromQR()" style="padding:8px 20px;border-radius:8px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:14px;font-weight:500;">Копировать ссылку</button>
                <button (click)="closeFriendQR()" style="padding:8px 20px;border-radius:8px;border:1px solid var(--border-default);background:transparent;cursor:pointer;font-size:14px;color:#666;">Закрыть</button>
              </div>
            </div>
          </div>
        }

        <div class="divider"></div>

        <div>
          <div class="section-label">Биометрия (Face ID / Touch ID)</div>
          @if (webauthnSupported) {
            @if (bioCreds.length === 0) {
              <button type="button" (click)="registerBiometric()" [disabled]="bioRegistering"
                class="btn-secondary" style="width:100%;padding:10px 20px;">
                {{ bioRegistering ? 'Настройка...' : 'Привязать Face ID / Touch ID' }}
              </button>
            } @else {
              <p class="text-sm mb-2" style="color:var(--text-tertiary);">Привязано устройств: {{ bioCreds.length }}</p>
              @for (cred of bioCreds; track cred.id) {
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:8px;border:1px solid var(--border-default);font-size:13px;margin-bottom:6px;">
                  <span style="color:var(--text-primary);">Биометрия #{{ cred.id }}<br><span style="font-size:11px;color:var(--text-tertiary);">добавлена {{ cred.created_at }}</span></span>
                  <button (click)="removeBiometric(cred.id)" title="Удалить"
                    style="padding:4px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:#e74c3c;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </div>
              }
              <button type="button" (click)="registerBiometric()" [disabled]="bioRegistering"
                class="btn-secondary" style="width:100%;padding:8px 16px;margin-top:4px;font-size:13px;">
                {{ bioRegistering ? 'Настройка...' : '+ Добавить ещё' }}
              </button>
            }
            @if (bioError) {
              <p class="text-sm mt-2" style="color:#e74c3c;">{{ bioError }}</p>
            }
            @if (bioSuccess) {
              <p class="text-sm mt-2" style="color:#27ae60;">{{ bioSuccess }}</p>
            }
          } @else {
            <p class="text-sm" style="color:var(--text-tertiary);">WebAuthn не поддерживается вашим браузером</p>
          }
        </div>

        <div class="divider"></div>

        <div>
          <div class="section-label">Шифрование (E2EE)</div>
          <div style="padding:10px;border-radius:8px;border:1px solid var(--border-default);font-size:13px;margin-bottom:4px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="width:8px;height:8px;border-radius:50%;background:var(--e2ee-ready, #27ae60);"></span>
              <span style="color:var(--text-primary);font-weight:500;">{{ e2eeStatus }}</span>
            </div>
            <p style="color:var(--text-tertiary);font-size:12px;">Сообщения шифруются на устройстве. Сервер не может прочитать содержимое.</p>
          </div>
        </div>

        <div class="divider"></div>

        <div>
          <div class="section-label">Обновления</div>

          <div style="padding:10px;border-radius:8px;border:1px solid var(--border-default);font-size:13px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="color:var(--text-secondary);">Текущая версия</span>
              <span style="color:var(--text-primary);font-weight:600;">{{ currentVersion }}</span>
            </div>
            @if (versionCheckDone) {
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:var(--text-secondary);">Последний релиз</span>
                <span style="color:var(--text-primary);font-weight:600;">{{ latestVersion || '—' }}</span>
              </div>
            }
          </div>

          @if (gitHubUpdateAvailable) {
            <div style="padding:10px;border-radius:8px;border:1px solid #e67e22;background:rgba(230,126,34,0.08);margin-bottom:12px;">
              <p style="color:#e67e22;font-weight:600;font-size:13px;margin-bottom:6px;">Доступна новая версия {{ latestVersion }}</p>
              <a [href]="downloadUrl" target="_blank" rel="noopener noreferrer"
                class="btn-primary" style="display:inline-block;padding:8px 16px;font-size:13px;text-decoration:none;text-align:center;">
                Скачать
              </a>
            </div>
          }

          @if (gitHubCheckError) {
            <p class="text-sm mb-2" style="color:#e74c3c;">{{ gitHubCheckError }}</p>
          }

          <button type="button" (click)="checkGitHubUpdates()" [disabled]="gitHubChecking"
            class="btn-secondary" style="width:100%;padding:12px 20px;margin-bottom:8px;">
            {{ gitHubChecking ? 'Проверка...' : 'Проверить новые версии на GitHub' }}
          </button>

          <button type="button" (click)="checkForUpdates()" [disabled]="updateChecking"
            class="btn-secondary" style="width:100%;padding:12px 20px;">
            {{ updateChecking ? 'Проверка...' : 'Проверить обновление PWA' }}
          </button>
          @if (updateStatus) {
            <p class="mt-2 text-sm text-center" [style.color]="updateStatusColor">{{ updateStatus }}</p>
          }
        </div>
      </div>
    </div>

    @if (showCrop) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(0,0,0,0.6);">
        <div class="rounded-2xl p-6 w-full max-w-sm" style="background:var(--bg-surface);">
          <h3 class="text-lg font-semibold mb-4 text-center" style="color:var(--text-primary);">Редактор аватара</h3>

          <div class="mx-auto mb-3 select-none flex items-center justify-center"
            style="width:288px;height:288px;border-radius:50%;overflow:hidden;background:var(--bg-body);cursor:grab;touch-action:none;"
            (pointerdown)="onCropPointerDown($event)"
            (pointermove)="onCropPointerMove($event)"
            (pointerup)="onCropPointerUp()"
            (pointerleave)="onCropPointerUp()">
            <img [src]="cropImageSrc" draggable="false"
              [style.width.px]="288 * cropZoom"
              [style.height.px]="288 * cropZoom"
              [style.marginLeft.px]="cropX"
              [style.marginTop.px]="cropY"
              style="object-fit:cover;max-width:none;max-height:none;flex-shrink:0;display:block;pointer-events:none;">
          </div>

          <div class="flex items-center gap-3 mb-4 px-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="range" min="1" max="3" step="0.05" [(ngModel)]="cropZoom"
              style="flex:1;accent-color:var(--accent);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>

          @if (cropLoading) {
            <p class="text-sm text-center" style="color:var(--text-tertiary);">Обработка...</p>
          } @else {
            <div class="flex gap-3">
              <button (click)="closeCrop()" class="btn-secondary flex-1" style="padding:10px;">Отмена</button>
              <button (click)="confirmCrop()" class="btn-primary flex-1" style="padding:10px;">Сохранить</button>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class SettingsComponent implements OnInit {
  readonly #sw = inject(SwUpdate);

  username = '';
  email = '';
  saving = false;
  success = '';
  error = '';
  selectedFile: File | null = null;
  previewUrl: string | null = null;
  uploading = false;
  uploadProgress = 0;
  avatarSuccess = false;
  showCrop = false;
  cropImageSrc = '';
  cropZoom = 1;
  cropX = 0;
  cropY = 0;
  cropLoading = false;
  #cropImgW = 0;
  #cropImgH = 0;
  selectedTheme: ThemeMode = 'light';
  updateChecking = false;
  updateStatus = '';
  updateStatusColor = '';
  currentVersion = '—';
  latestVersion = '';
  downloadUrl = '';
  gitHubUpdateAvailable = false;
  gitHubChecking = false;
  gitHubCheckError = '';
  versionCheckDone = false;

  invites: InviteToken[] = [];
  creatingInvite = false;
  inviteError = '';
  qrToken = '';
  qrDataUrl = '';
  qrInviteUrl = '';

  friends: User[] = [];
  creatingFriendInvite = false;
  friendInviteError = '';
  friendInviteSuccess = false;
  friendInviteUrl = '';
  friendInviteToken = '';
  friendQrUrl = '';
  friendQrDataUrl = '';

  bioCreds: { id: number; created_at: string }[] = [];
  bioLoading = false;
  bioError = '';
  bioSuccess = '';
  bioRegistering = false;

  e2eeStatus = 'Проверка...';

  constructor(
    private api: ApiService,
    private router: Router,
    private theme: ThemeService,
    private crypto: CryptoService,
  ) {
    this.selectedTheme = this.theme.currentMode;
  }

  async checkForUpdates() {
    if (!this.#sw.isEnabled) {
      this.updateStatus = 'Service worker неактивен';
      this.updateStatusColor = '#e74c3c';
      return;
    }
    this.updateChecking = true;
    this.updateStatus = '';
    try {
      const hasUpdate = await this.#sw.checkForUpdate();
      if (hasUpdate) {
        this.updateStatus = 'Доступно обновление — перезагрузите страницу';
        this.updateStatusColor = '#e67e22';
      } else {
        this.updateStatus = 'Версия актуальна';
        this.updateStatusColor = '#27ae60';
      }
    } catch {
      this.updateStatus = 'Ошибка проверки обновлений';
      this.updateStatusColor = '#e74c3c';
    } finally {
      this.updateChecking = false;
      setTimeout(() => (this.updateStatus = ''), 5000);
    }
  }

  get webauthnSupported() {
    return typeof PublicKeyCredential !== 'undefined';
  }

  get currentUsername() {
    return this.api.currentUser()?.username ?? '';
  }

  get currentAvatar() {
    return this.api.currentUser()?.avatar_url ?? '';
  }

  ngOnInit() {
    const user = this.api.currentUser();
    if (user) {
      this.username = user.username;
      this.email = user.email;
    }
    this.loadInvites();
    this.loadFriends();
    this.loadBioCreds();
    this.initE2EE();
    this.loadVersion();
  }

  loadVersion() {
    this.api.getVersion().subscribe({
      next: (res) => {
        this.currentVersion = res.version;
      },
    });
  }

  checkGitHubUpdates() {
    this.gitHubChecking = true;
    this.gitHubCheckError = '';
    this.api.checkUpdate().subscribe({
      next: (res) => {
        this.gitHubChecking = false;
        this.versionCheckDone = true;
        this.latestVersion = res.latest_version || '—';
        this.downloadUrl = res.download_url || '';
        this.gitHubUpdateAvailable = res.update_available;
        if (res.error) {
          this.gitHubCheckError = res.error;
        }
      },
      error: () => {
        this.gitHubChecking = false;
        this.gitHubCheckError = 'Ошибка проверки обновлений';
      },
    });
  }

  async initE2EE() {
    await this.crypto.init();
    const pubKey = await this.crypto.getPublicKey();
    this.e2eeStatus = pubKey ? 'Активно' : 'Не активировано';
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile = input.files[0];
      const src = URL.createObjectURL(input.files[0]);
      const img = new Image();
      img.onload = () => {
        this.#cropImgW = img.naturalWidth;
        this.#cropImgH = img.naturalHeight;
        this.cropImageSrc = src;
        this.cropZoom = 1;
        this.cropX = 0;
        this.cropY = 0;
        this.showCrop = true;
      };
      img.src = src;
    }
  }

  #cropDrag = false;
  #cropStartX = 0;
  #cropStartY = 0;
  #cropStartPX = 0;
  #cropStartPY = 0;

  get #cropMaxPan() {
    const c = 288;
    return c * (this.cropZoom - 1) / 2;
  }

  onCropPointerDown(e: PointerEvent) {
    this.#cropDrag = true;
    this.#cropStartX = e.clientX;
    this.#cropStartY = e.clientY;
    this.#cropStartPX = this.cropX;
    this.#cropStartPY = this.cropY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  onCropPointerMove(e: PointerEvent) {
    if (!this.#cropDrag) return;
    const max = this.#cropMaxPan;
    this.cropX = Math.max(-max, Math.min(max, this.#cropStartPX + (e.clientX - this.#cropStartX)));
    this.cropY = Math.max(-max, Math.min(max, this.#cropStartPY + (e.clientY - this.#cropStartY)));
  }

  onCropPointerUp() {
    this.#cropDrag = false;
  }

  async confirmCrop() {
    if (!this.#cropImgW || !this.#cropImgH) return;
    const c = 288;
    const zoom = this.cropZoom;
    const contentScale = zoom * Math.max(c / this.#cropImgW, c / this.#cropImgH);

    const origX = this.#cropImgW / 2 - (c / 2 + this.cropX) / contentScale;
    const origY = this.#cropImgH / 2 - (c / 2 + this.cropY) / contentScale;
    const origW = c / contentScale;
    const origH = c / contentScale;

    const size = 256;
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const ctx = out.getContext('2d')!;

    const img = new Image();
    img.src = this.cropImageSrc;
    await img.decode();
    ctx.drawImage(img, origX, origY, origW, origH, 0, 0, size, size);

    out.toBlob((blob) => {
      if (!blob) return;
      const croppedFile = new File([blob], this.selectedFile?.name || 'avatar.png', { type: 'image/png' });
      this.showCrop = false;
      this.previewUrl = URL.createObjectURL(blob);
      this.selectedFile = croppedFile;
      URL.revokeObjectURL(this.cropImageSrc);
      this.uploadAvatar();
    }, 'image/png');
  }

  closeCrop() {
    this.showCrop = false;
    URL.revokeObjectURL(this.cropImageSrc);
    this.cropImageSrc = '';
    this.selectedFile = null;
  }

  uploadAvatar() {
    if (!this.selectedFile) return;
    this.uploading = true;
    this.uploadProgress = 0;
    this.avatarSuccess = false;
    this.api.uploadAvatar(this.selectedFile).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          this.uploadProgress = event.total ? Math.round(event.loaded / event.total * 100) : 0;
        } else if (event.type === HttpEventType.Response) {
          this.uploading = false;
          this.avatarSuccess = true;
          const user = this.api.currentUser();
          if (user && event.body) {
            const updated = { ...user, avatar_url: event.body.avatar_url };
            this.api.currentUser.set(updated);
            localStorage.setItem('currentUser', JSON.stringify(updated));
          }
          setTimeout(() => (this.avatarSuccess = false), 3000);
        }
      },
      error: () => {
        this.uploading = false;
        this.error = 'Ошибка загрузки аватара';
      },
    });
  }

  onSubmit() {
    if (!this.username.trim() || !this.email.trim()) return;
    this.saving = true;
    this.success = '';
    this.error = '';
    this.api.updateProfile(this.username, this.email).subscribe({
      next: (res) => {
        this.saving = false;
        this.api.currentUser.set(res);
        localStorage.setItem('currentUser', JSON.stringify(res));
        this.success = 'Профиль сохранён';
        setTimeout(() => (this.success = ''), 3000);
      },
      error: () => {
        this.saving = false;
        this.error = 'Ошибка сохранения. Возможно, имя или email уже заняты.';
      },
    });
  }

  selectTheme(mode: ThemeMode) {
    this.selectedTheme = mode;
    this.theme.setTheme(mode);
  }

  loadInvites() {
    this.api.getMyInvites().subscribe({
      next: (inv) => this.invites = inv,
    });
  }

  createInvite() {
    this.creatingInvite = true;
    this.inviteError = '';
    this.api.createInvite(1).subscribe({
      next: () => {
        this.creatingInvite = false;
        this.loadInvites();
      },
      error: () => {
        this.creatingInvite = false;
        this.inviteError = 'Ошибка создания приглашения';
      },
    });
  }

  revokeInvite(id: number) {
    this.api.deleteInvite(id).subscribe({
      next: () => this.loadInvites(),
      error: () => this.inviteError = 'Ошибка отзыва приглашения',
    });
  }

  copyInvite(token: string) {
    const url = `${window.location.origin}/register?invite=${token}`;
    navigator.clipboard.writeText(url).catch(() => {});
  }

  async showQR(token: string) {
    this.qrToken = token;
    this.qrInviteUrl = `${window.location.origin}/register?invite=${token}`;
    this.qrDataUrl = await QRCode.toDataURL(this.qrInviteUrl, { width: 512, margin: 2 });
  }

  closeQR() {
    this.qrDataUrl = '';
    this.qrToken = '';
    this.qrInviteUrl = '';
  }

  copyInviteFromQR() {
    navigator.clipboard.writeText(this.qrInviteUrl).catch(() => {});
  }

  loadFriends() {
    this.api.getFriends().subscribe({
      next: (users) => this.friends = users,
    });
  }

  createFriendInvite() {
    this.creatingFriendInvite = true;
    this.friendInviteError = '';
    this.api.createFriendInvite().subscribe({
      next: (res) => {
        this.creatingFriendInvite = false;
        this.friendInviteToken = res.token;
        this.friendInviteUrl = `${window.location.origin}/add-friend?token=${res.token}`;
        this.friendInviteSuccess = true;
      },
      error: () => {
        this.creatingFriendInvite = false;
        this.friendInviteError = 'Ошибка создания приглашения';
      },
    });
  }

  clearFriendInvite() {
    this.friendInviteSuccess = false;
    this.friendInviteUrl = '';
    this.friendInviteToken = '';
  }

  copyFriendInvite() {
    navigator.clipboard.writeText(this.friendInviteUrl).catch(() => {});
  }

  async showFriendQR() {
    this.friendQrUrl = this.friendInviteUrl;
    this.friendQrDataUrl = await QRCode.toDataURL(this.friendQrUrl, { width: 512, margin: 2 });
  }

  closeFriendQR() {
    this.friendQrDataUrl = '';
    this.friendQrUrl = '';
  }

  copyFriendInviteFromQR() {
    navigator.clipboard.writeText(this.friendQrUrl).catch(() => {});
  }

  removeFriend(id: number) {
    this.api.removeFriend(id).subscribe({
      next: () => this.loadFriends(),
      error: () => this.friendInviteError = 'Ошибка удаления друга',
    });
  }

  loadBioCreds() {
    this.api.webauthnListCredentials().subscribe({
      next: (creds) => { this.bioCreds = creds; },
      error: () => {},
    });
  }

  private prepareWebAuthnOptions(opts: any): any {
    const b = (s: string): Uint8Array => {
      const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
      const p = base64.length % 4;
      const raw = atob(p ? base64 + '='.repeat(4 - p) : base64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      return buf;
    };
    const pk = opts.publicKey ?? opts;
    if (pk.challenge) pk.challenge = b(pk.challenge);
    if (pk.user?.id) pk.user.id = b(pk.user.id);
    for (const key of ['excludeCredentials', 'allowCredentials']) {
      if (pk[key]) pk[key].forEach((c: any) => { if (c.id) c.id = b(c.id); });
    }
    return opts;
  }

  async registerBiometric() {
    if (typeof PublicKeyCredential === 'undefined') {
      this.bioError = 'WebAuthn не поддерживается';
      return;
    }
    this.bioRegistering = true;
    this.bioError = '';
    this.bioSuccess = '';

    this.api.webauthnBeginRegistration().subscribe({
      next: async (challenge) => {
        try {
          const credential = await navigator.credentials.create({
            publicKey: this.prepareWebAuthnOptions(challenge.options).publicKey,
          }) as PublicKeyCredential;

          const credJson = credential.toJSON();
          this.api.webauthnFinishRegistration(challenge.session_id, credJson).subscribe({
            next: () => {
              this.bioRegistering = false;
              this.bioSuccess = 'Биометрия привязана';
              this.loadBioCreds();
              setTimeout(() => (this.bioSuccess = ''), 3000);
            },
            error: (err) => {
              this.bioRegistering = false;
              this.bioError = err.error?.error || 'Ошибка привязки';
            },
          });
        } catch (e: any) {
          this.bioRegistering = false;
          if (e?.name === 'NotAllowedError') {
            this.bioError = 'Операция отменена';
          } else if (e?.name === 'NotSupportedError') {
            this.bioError = 'Face ID / Touch ID не настроен на устройстве';
          } else {
            this.bioError = e?.message || 'Ошибка';
          }
        }
      },
      error: (err) => {
        this.bioRegistering = false;
        this.bioError = err.error?.error || 'Ошибка запроса';
      },
    });
  }

  removeBiometric(id: number) {
    this.api.webauthnRemoveCredential(id).subscribe({
      next: () => {
        this.bioSuccess = 'Биометрия удалена';
        this.loadBioCreds();
        setTimeout(() => (this.bioSuccess = ''), 3000);
      },
      error: () => { this.bioError = 'Ошибка удаления'; },
    });
  }

  logout() {
    this.api.logout();
    this.router.navigate(['/login']);
  }
}
