import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ApiService, User, StickerPack } from '../../services/api.service';
import { AdminFederationComponent } from '../admin-federation/admin-federation';

interface FileEntry {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  mod_time: string;
}

interface AdminGroupChat {
  id: number;
  name: string;
  created_by: number;
  created_by_username: string;
  member_count: number;
  created_at: string;
}

interface BackupEntry {
  filename: string;
  size_bytes: number;
  created_at: string;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [DatePipe, AdminFederationComponent, FormsModule],
  template: `
    <!-- Desktop -->
    <div class="hidden sm:block max-w-6xl mx-auto px-4 py-6 pb-20 sm:pb-6">
      <div class="flex gap-6">
        <!-- Sidebar -->
        <div class="w-48 flex-shrink-0">
          <h1 class="text-xl font-bold mb-6" style="color:var(--text-primary);">Панель администратора</h1>
          <nav class="flex flex-col gap-1">
            <button (click)="activeTab = 'users'"
              [style.background]="activeTab === 'users' ? 'var(--accent-light)' : 'transparent'"
              style="padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);text-align:left;transition:all 0.2s;">
              Пользователи
            </button>
            <button (click)="activeTab = 'files'"
              [style.background]="activeTab === 'files' ? 'var(--accent-light)' : 'transparent'"
              style="padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);text-align:left;transition:all 0.2s;">
              Файлы
            </button>
            <button (click)="activeTab = 'chats'; loadGroupChats()"
              [style.background]="activeTab === 'chats' ? 'var(--accent-light)' : 'transparent'"
              style="padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);text-align:left;transition:all 0.2s;">
              Чаты
            </button>
            <button (click)="activeTab = 'backups'; loadBackups()"
              [style.background]="activeTab === 'backups' ? 'var(--accent-light)' : 'transparent'"
              style="padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);text-align:left;transition:all 0.2s;">
              Бэкапы
            </button>
            <button (click)="activeTab = 'federation'; loadFederation()"
              [style.background]="activeTab === 'federation' ? 'var(--accent-light)' : 'transparent'"
              style="padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);text-align:left;transition:all 0.2s;">
              Федерация
            </button>
            <button (click)="activeTab = 'stickers'; loadStickers()"
              [style.background]="activeTab === 'stickers' ? 'var(--accent-light)' : 'transparent'"
              style="padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);text-align:left;transition:all 0.2s;">
              Стикеры
            </button>
            <button (click)="activeTab = 'settings'"
              [style.background]="activeTab === 'settings' ? 'var(--accent-light)' : 'transparent'"
              style="padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);text-align:left;transition:all 0.2s;">
              Настройки
            </button>
          </nav>
        </div>
        <!-- Content -->
        <div class="flex-1 min-w-0 card p-6">

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
                    <th style="text-align:center;padding:8px 12px;font-weight:500;">Статус</th>
                    <th style="text-align:right;padding:8px 12px;font-weight:500;">Действия</th>
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
                        @if (user.is_banned) {
                          <span style="font-size:13px;color:#e74c3c;">Заблокирован</span>
                        } @else if (user.is_online) {
                          <span style="font-size:13px;color:#34d399;">В сети</span>
                        } @else {
                          <span style="color:var(--text-tertiary);font-size:13px;">Не в сети</span>
                        }
                      </td>
                      <td style="padding:10px 12px;text-align:right;white-space:nowrap;">
                        <div style="display:flex;gap:2px;justify-content:flex-end;align-items:center;">
                          @if (actionLoading === user.id) {
                            <span style="font-size:13px;color:var(--text-tertiary);">...</span>
                          } @else {
                            <button (click)="user.is_admin ? removeAdmin(user) : makeAdmin(user)"
                              [title]="user.is_admin ? 'Снять админа' : 'Назначить админом'"
                              style="padding:5px;border-radius:6px;border:none;background:transparent;cursor:pointer;transition:all 0.2s;"
                              [style.color]="user.is_admin ? 'var(--accent)' : 'var(--text-tertiary)'">
                              @if (user.is_admin) {
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" stroke-width="0"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                              } @else {
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                              }
                            </button>
                            <button (click)="user.is_banned ? unblockUser(user) : blockUser(user)"
                              [title]="user.is_banned ? 'Разблокировать' : 'Заблокировать'"
                              style="padding:5px;border-radius:6px;border:none;background:transparent;cursor:pointer;transition:all 0.2s;"
                              [style.color]="user.is_banned ? '#e67e22' : 'var(--text-tertiary)'">
                              @if (user.is_banned) {
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>
                              } @else {
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                              }
                            </button>
                            <button (click)="deleteUser(user)" title="Удалить"
                              style="padding:5px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:#e74c3c;transition:all 0.2s;">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                            </button>
                          }
                        </div>
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

        @if (activeTab === 'chats') {
          @if (loadingChats) {
            <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
          } @else if (chats.length === 0) {
            <p style="color:var(--text-tertiary);font-size:14px;">Групповые чаты не найдены</p>
          } @else {
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead>
                  <tr style="color:var(--text-secondary);border-bottom:1px solid var(--divider);">
                    <th style="text-align:left;padding:8px 12px;font-weight:500;">Название</th>
                    <th style="text-align:left;padding:8px 12px;font-weight:500;">Создатель</th>
                    <th style="text-align:center;padding:8px 12px;font-weight:500;">Участников</th>
                    <th style="text-align:left;padding:8px 12px;font-weight:500;">Создан</th>
                    <th style="text-align:right;padding:8px 12px;font-weight:500;">Действие</th>
                  </tr>
                </thead>
                <tbody>
                  @for (chat of chats; track chat.id) {
                    <tr style="border-bottom:1px solid var(--divider);">
                      <td style="padding:10px 12px;color:var(--text-primary);font-weight:500;">{{ chat.name }}</td>
                      <td style="padding:10px 12px;color:var(--text-secondary);">{{ chat.created_by_username }}</td>
                      <td style="padding:10px 12px;text-align:center;color:var(--text-primary);">{{ chat.member_count }}</td>
                      <td style="padding:10px 12px;color:var(--text-tertiary);font-size:13px;">{{ chat.created_at | date:'dd.MM.yyyy HH:mm' }}</td>
                      <td style="padding:10px 12px;text-align:right;">
                        <button (click)="deleteChat(chat)" [disabled]="deleteChatLoading === chat.id"
                          style="padding:4px 12px;border-radius:6px;border:1px solid #e74c3c;background:transparent;cursor:pointer;font-size:13px;color:#e74c3c;transition:all 0.2s;">
                          {{ deleteChatLoading === chat.id ? '...' : 'Удалить' }}
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (chatActionMsg) {
            <p class="mt-3 text-sm" [style.color]="chatActionOk ? '#27ae60' : '#e74c3c'">{{ chatActionMsg }}</p>
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
                      <th style="text-align:right;padding:8px 12px;font-weight:500;">Действие</th>
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
                        <td style="padding:10px 12px;text-align:right;">
                          @if (deleteFileLoading === file.path) {
                            <span style="font-size:13px;color:var(--text-tertiary);">...</span>
                          } @else {
                            <button (click)="deleteFile(file)" title="Удалить"
                              style="padding:5px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:#e74c3c;transition:all 0.2s;">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                            </button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        }

        @if (activeTab === 'federation') {
          <app-admin-federation />
        }

        @if (activeTab === 'stickers') {
          <div>
            <div class="flex items-center gap-3 mb-4">
              <input #deskNewPack type="text" [(ngModel)]="newStickerPackName" placeholder="Название нового пака..."
                style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--border-default);font-size:14px;font-family:inherit;">
              <button (click)="createStickerPack()" [disabled]="!newStickerPackName.trim()"
                [style.background]="!newStickerPackName.trim() ? 'var(--accent-muted, #94a3b8)' : 'var(--accent-gradient)'"
                [style.cursor]="!newStickerPackName.trim() ? 'not-allowed' : 'pointer'"
                [style.opacity]="!newStickerPackName.trim() ? '0.5' : '1'"
                style="padding:8px 16px;border-radius:8px;border:none;color:white;font-size:13px;font-weight:500;white-space:nowrap;">
                Создать пак
              </button>
            </div>

            @if (stickerLoading) {
              <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
            } @else if (stickerPacks.length === 0) {
              <p style="color:var(--text-tertiary);font-size:14px;">Нет стикерпаков. Создайте первый.</p>
            } @else {
              @for (pack of stickerPacks; track pack.id) {
                <div style="margin-bottom:20px;padding:16px;border-radius:12px;border:1px solid var(--border-default);">
                  <div class="flex items-center gap-3 mb-3">
                    <span style="font-size:16px;font-weight:600;color:var(--text-primary);">{{ pack.name }}</span>
                    <button (click)="deleteStickerPack(pack)" style="margin-left:auto;padding:4px 10px;border-radius:6px;border:1px solid #e74c3c;background:transparent;cursor:pointer;font-size:12px;color:#e74c3c;">Удалить пак</button>
                  </div>
                  <div class="flex flex-wrap gap-3 mb-3">
                    @for (sticker of pack.stickers; track sticker.id) {
                      <div class="relative">
                        <img [src]="sticker.image_url" class="w-16 h-16 rounded-lg object-cover" style="border:1px solid var(--border-default);">
                        <button (click)="deleteSticker(pack, sticker)"
                          class="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center text-xs rounded-full"
                          style="background:#e74c3c;color:white;border:none;cursor:pointer;">✕</button>
                      </div>
                    }
                  </div>
                  <label class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm cursor-pointer"
                    style="border:2px dashed var(--border-default);color:var(--text-secondary);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    Добавить стикер
                    <input type="file" accept="image/*" (change)="uploadSticker(pack, $event)" class="hidden">
                  </label>
                </div>
              }
            }
            @if (stickerMsg) {
              <p class="text-sm mt-2" [style.color]="stickerMsgOk ? '#27ae60' : '#e74c3c'">{{ stickerMsg }}</p>
            }
          </div>
        }

        @if (activeTab === 'settings') {
          <div class="mb-6">
            <h3 class="text-base font-semibold mb-4" style="color:var(--text-primary);">Giphy API Key</h3>
            <p class="text-sm mb-3" style="color:var(--text-secondary);">
              API-ключ для поиска GIF через Giphy.
            </p>
            <div class="flex gap-2 items-start flex-wrap">
              <input #giphyKeyInput type="text" [(ngModel)]="giphyKey"
                [placeholder]="giphyHasKey ? 'Введите новый ключ...' : 'Введите Giphy API Key...'"
                style="flex:1;min-width:200px;box-sizing:border-box;padding:8px 12px;border-radius:var(--radius-sm);border:1px solid var(--border-default);background:var(--bg-surface);font-size:14px;color:var(--text-primary);outline:none;font-family:inherit;">
              <button (click)="saveGiphyKey()" [disabled]="giphySaving"
                style="padding:8px 16px;border-radius:var(--radius-sm);border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:14px;font-weight:500;font-family:inherit;">
                {{ giphySaving ? '...' : 'Сохранить' }}
              </button>
            </div>
            @if (giphyKeyMsg) {
              <p class="mt-2 text-sm" [style.color]="giphyKeyOk ? '#27ae60' : '#e74c3c'">{{ giphyKeyMsg }}</p>
            }
            @if (giphyHasKey) {
              <p class="mt-2 text-sm" style="color:var(--text-tertiary);">
                Текущий ключ: <code style="font-size:12px;">{{ giphyMaskedKey }}</code>
              </p>
            }
          </div>

          <div class="mt-8 pt-6" style="border-top:1px solid var(--divider);">
            <h3 class="text-base font-semibold mb-4" style="color:var(--text-primary);">Обновления</h3>
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
              class="btn-secondary" style="width:100%;padding:12px 20px;">
              {{ gitHubChecking ? 'Проверка...' : 'Проверить новые версии на GitHub' }}
            </button>
          </div>
        }

        @if (activeTab === 'backups') {
          <div style="display:flex;gap:8px;margin-bottom:16px;">
            <button (click)="createBackup()" [disabled]="backupLoading"
              style="padding:8px 16px;border-radius:8px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:14px;font-weight:500;">
              {{ backupLoading ? '...' : 'Создать бэкап' }}
            </button>
            <label style="padding:8px 16px;border-radius:8px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);display:inline-flex;align-items:center;">
              Загрузить бэкап
              <input type="file" accept=".zip" (change)="uploadBackup($event)" style="display:none;">
            </label>
          </div>

          @if (backupLoading && backupUploadProgress > 0 && backupUploadProgress < 100) {
            <div style="max-width:300px;margin-bottom:12px;">
              <div style="height:4px;border-radius:4px;background:var(--border-light);overflow:hidden;">
                <div style="height:100%;border-radius:4px;background:var(--accent-gradient);transition:width .2s;" [style.width.%]="backupUploadProgress"></div>
              </div>
              <p style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">{{ backupUploadProgress }}%</p>
            </div>
          }

          @if (backupMsg) {
            <p style="font-size:13px;margin-bottom:12px;" [style.color]="backupOk ? '#27ae60' : '#e74c3c'">{{ backupMsg }}</p>
          }

          @if (backupsLoading) {
            <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
          } @else if (backups.length === 0) {
            <p style="color:var(--text-tertiary);font-size:14px;">Бэкапы не найдены</p>
          } @else {
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead>
                  <tr style="color:var(--text-secondary);border-bottom:1px solid var(--divider);">
                    <th style="text-align:left;padding:8px 12px;font-weight:500;">Файл</th>
                    <th style="text-align:left;padding:8px 12px;font-weight:500;">Размер</th>
                    <th style="text-align:left;padding:8px 12px;font-weight:500;">Дата</th>
                    <th style="text-align:right;padding:8px 12px;font-weight:500;">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  @for (b of backups; track b.filename) {
                    <tr style="border-bottom:1px solid var(--divider);">
                      <td style="padding:10px 12px;color:var(--text-primary);font-weight:500;">{{ b.filename }}</td>
                      <td style="padding:10px 12px;color:var(--text-secondary);">{{ formatSize(b.size_bytes) }}</td>
                      <td style="padding:10px 12px;color:var(--text-tertiary);font-size:13px;">{{ b.created_at | date:'dd.MM.yyyy HH:mm' }}</td>
                      <td style="padding:10px 12px;text-align:right;">
                        <div style="display:flex;gap:6px;justify-content:flex-end;">
                          <a [href]="api.downloadBackupUrl(b.filename)" target="_blank"
                            style="padding:4px 10px;border-radius:6px;border:1px solid var(--divider);background:transparent;cursor:pointer;font-size:12px;color:var(--text-secondary);text-decoration:none;">
                            Скачать
                          </a>
                          <button (click)="restoreBackup(b)" [disabled]="restoring === b.filename"
                            style="padding:4px 10px;border-radius:6px;border:1px solid #e67e22;background:transparent;cursor:pointer;font-size:12px;color:#e67e22;">
                            {{ restoring === b.filename ? '...' : 'Восстановить' }}
                          </button>
                          <button (click)="deleteBackup(b)"
                            style="padding:4px 10px;border-radius:6px;border:1px solid #e74c3c;background:transparent;cursor:pointer;font-size:12px;color:#e74c3c;">
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      </div>
      </div>
    </div>

    <!-- Mobile -->
    <div class="sm:hidden px-4 py-4 pb-20">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-lg font-bold" style="color:var(--text-primary);">Админка</h1>
        <div style="position:relative;">
          <select (change)="activeTab = $any($event.target).value"
            style="appearance:none;padding:8px 32px 8px 12px;border-radius:10px;border:1px solid var(--border-default);background:var(--bg-surface);font-size:14px;font-weight:500;color:var(--text-primary);cursor:pointer;font-family:inherit;min-width:160px;">
            <option value="users">Пользователи</option>
            <option value="files">Файлы</option>
            <option value="chats">Чаты</option>
            <option value="backups">Бэкапы</option>
            <option value="federation">Федерация</option>
            <option value="stickers">Стикеры</option>
            <option value="settings">Настройки</option>
          </select>
          <div style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--text-tertiary);font-size:10px;">▼</div>
        </div>
      </div>

      @if (activeTab === 'users') {
        @if (loadingUsers) {
          <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
        } @else {
          <div class="card">
            <div style="padding:10px 14px 6px;font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;">Пользователи · {{ users.length }}</div>
            @for (user of users; track user.id) {
              <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--divider);">
                <div style="position:relative;display:inline-flex;flex-shrink:0;">
                  @if (user.avatar_url) {
                    <img [src]="user.avatar_url" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
                  } @else {
                    <div style="width:40px;height:40px;border-radius:50%;background:var(--avatar-bg);color:var(--avatar-text);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;">
                      {{ user.username[0] }}
                    </div>
                  }
                  @if (user.is_admin) {
                    <div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--accent-gradient);border:2px solid var(--bg-body);display:flex;align-items:center;justify-content:center;">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                    </div>
                  }
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:14px;font-weight:600;color:var(--text-primary);">{{ user.username }}</div>
                  <div style="font-size:12px;color:var(--text-secondary);margin-top:1px;">{{ user.email }}</div>
                  <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
                    @if (user.is_banned) {
                      <span style="font-size:11px;padding:1px 6px;border-radius:99px;background:#fee2e2;color:#dc2626;font-weight:500;">Заблокирован</span>
                    } @else if (user.is_online) {
                      <span style="font-size:11px;padding:1px 6px;border-radius:99px;background:#d1fae5;color:#059669;font-weight:500;">В сети</span>
                    } @else {
                      <span style="font-size:11px;padding:1px 6px;border-radius:99px;background:var(--border-subtle);color:var(--text-tertiary);font-weight:500;">Не в сети</span>
                    }
                  </div>
                </div>
                <div style="display:flex;gap:2px;flex-shrink:0;align-items:center;">
                  @if (actionLoading === user.id) {
                    <span style="font-size:13px;color:var(--text-tertiary);padding:0 8px;">...</span>
                  } @else {
                    <button (click)="user.is_admin ? removeAdmin(user) : makeAdmin(user)"
                      [title]="user.is_admin ? 'Снять админа' : 'Назначить админом'"
                      style="padding:5px;border-radius:8px;border:none;background:transparent;cursor:pointer;transition:all 0.2s;width:34px;height:34px;display:flex;align-items:center;justify-content:center;"
                      [style.color]="user.is_admin ? 'var(--accent)' : 'var(--text-tertiary)'">
                      @if (user.is_admin) {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" stroke-width="0"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                      } @else {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                      }
                    </button>
                    <button (click)="user.is_banned ? unblockUser(user) : blockUser(user)"
                      [title]="user.is_banned ? 'Разблокировать' : 'Заблокировать'"
                      style="padding:5px;border-radius:8px;border:none;background:transparent;cursor:pointer;transition:all 0.2s;width:34px;height:34px;display:flex;align-items:center;justify-content:center;"
                      [style.color]="user.is_banned ? '#e67e22' : 'var(--text-tertiary)'">
                      @if (user.is_banned) {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>
                      } @else {
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                      }
                    </button>
                    <button (click)="deleteUser(user)" title="Удалить"
                      style="padding:5px;border-radius:8px;border:none;background:transparent;cursor:pointer;width:34px;height:34px;display:flex;align-items:center;justify-content:center;color:#e74c3c;transition:all 0.2s;">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        }
        @if (actionMsg) {
          <p class="mt-2 text-sm" [style.color]="actionOk ? '#27ae60' : '#e74c3c'">{{ actionMsg }}</p>
        }
      }

      @if (activeTab === 'files') {
        @if (loadingFiles) {
          <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
        } @else if (files.length === 0) {
          <p style="color:var(--text-tertiary);font-size:14px;">Файлы не найдены</p>
        } @else {
          @if (diskInfo) {
            <div style="padding:14px;border-radius:12px;border:1px solid var(--border-default);background:var(--bg-surface);margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                <span style="font-size:13px;font-weight:600;color:var(--text-primary);">Использование диска</span>
                <span style="font-size:12px;color:var(--text-secondary);">{{ formatSize(diskInfo.used) }} / {{ formatSize(diskInfo.total) }}</span>
              </div>
              <div style="height:8px;border-radius:99px;background:var(--border-default);overflow:hidden;">
                <div [style.width.%]="diskInfo.used_pct" style="height:100%;border-radius:99px;background:var(--accent-gradient);transition:width 0.3s;"></div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:4px;">
                <span style="font-size:11px;color:var(--text-tertiary);">Свободно: {{ formatSize(diskInfo.free) }} ({{ (100 - diskInfo.used_pct).toFixed(1) }}%)</span>
                <span style="font-size:11px;color:var(--text-tertiary);">{{ diskInfo.used_pct.toFixed(1) }}% занято</span>
              </div>
            </div>
          }
          <div class="card">
            @for (file of files; track file.path) {
              <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--divider);">
                <div style="width:36px;height:36px;border-radius:8px;background:var(--border-subtle);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:14px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ file.name }}</div>
                  <div style="display:flex;gap:8px;font-size:12px;color:var(--text-secondary);margin-top:1px;">
                    <span>{{ formatSize(file.size) }}</span>
                    <span>{{ file.mod_time | date:'dd.MM.yyyy HH:mm' }}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ file.path }}</div>
                </div>
                @if (deleteFileLoading === file.path) {
                  <span style="font-size:13px;color:var(--text-tertiary);padding:0 8px;">...</span>
                } @else {
                  <button (click)="deleteFile(file)" title="Удалить"
                    style="padding:6px;border-radius:8px;border:none;background:transparent;cursor:pointer;color:#e74c3c;flex-shrink:0;width:34px;height:34px;display:flex;align-items:center;justify-content:center;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                }
              </div>
            }
          </div>
        }
      }

      @if (activeTab === 'chats') {
        @if (loadingChats) {
          <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
        } @else if (chats.length === 0) {
          <p style="color:var(--text-tertiary);font-size:14px;">Групповые чаты не найдены</p>
        } @else {
          <div class="card">
            @for (chat of chats; track chat.id) {
              <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--divider);">
                <div style="width:40px;height:40px;border-radius:10px;background:var(--accent-light);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--accent);font-weight:600;font-size:16px;">
                  {{ chat.name[0] }}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:14px;font-weight:600;color:var(--text-primary);">{{ chat.name }}</div>
                  <div style="font-size:12px;color:var(--text-secondary);margin-top:1px;">Создал: {{ chat.created_by_username }}</div>
                  <div style="display:flex;gap:10px;margin-top:2px;">
                    <span style="font-size:12px;color:var(--text-tertiary);display:flex;align-items:center;gap:3px;">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                      {{ chat.member_count }}
                    </span>
                    <span style="font-size:12px;color:var(--text-tertiary);">{{ chat.created_at | date:'dd.MM.yyyy HH:mm' }}</span>
                  </div>
                </div>
                <button (click)="deleteChat(chat)" [disabled]="deleteChatLoading === chat.id"
                  style="padding:6px 12px;border-radius:8px;border:1px solid #e74c3c;background:transparent;cursor:pointer;font-size:12px;color:#e74c3c;flex-shrink:0;font-family:inherit;">
                  {{ deleteChatLoading === chat.id ? '...' : 'Удалить' }}
                </button>
              </div>
            }
          </div>
        }
        @if (chatActionMsg) {
          <p class="mt-2 text-sm" [style.color]="chatActionOk ? '#27ae60' : '#e74c3c'">{{ chatActionMsg }}</p>
        }
      }

      @if (activeTab === 'backups') {
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button (click)="createBackup()" [disabled]="backupLoading"
            style="flex:1;padding:10px 16px;border-radius:10px;border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;">
            {{ backupLoading ? '...' : 'Создать бэкап' }}
          </button>
          <label style="flex:1;padding:10px 16px;border-radius:10px;border:1px solid var(--border-default);background:transparent;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);display:flex;align-items:center;justify-content:center;font-family:inherit;">
            Загрузить
            <input type="file" accept=".zip" (change)="uploadBackup($event)" style="display:none;">
          </label>
        </div>

        @if (backupLoading && backupUploadProgress > 0 && backupUploadProgress < 100) {
          <div style="margin-bottom:12px;">
            <div style="height:4px;border-radius:4px;background:var(--border-light);overflow:hidden;">
              <div style="height:100%;border-radius:4px;background:var(--accent-gradient);transition:width .2s;" [style.width.%]="backupUploadProgress"></div>
            </div>
            <p style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">{{ backupUploadProgress }}%</p>
          </div>
        }

        @if (backupMsg) {
          <p style="font-size:13px;margin-bottom:12px;" [style.color]="backupOk ? '#27ae60' : '#e74c3c'">{{ backupMsg }}</p>
        }

        @if (backupsLoading) {
          <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
        } @else if (backups.length === 0) {
          <p style="color:var(--text-tertiary);font-size:14px;">Бэкапы не найдены</p>
        } @else {
          <div class="card">
            @for (b of backups; track b.filename) {
              <div style="padding:12px 14px;border-bottom:1px solid var(--divider);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                  <span style="font-size:14px;font-weight:500;color:var(--text-primary);">{{ b.filename }}</span>
                </div>
                <div style="display:flex;gap:12px;font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
                  <span>{{ formatSize(b.size_bytes) }}</span>
                  <span>{{ b.created_at | date:'dd.MM.yyyy HH:mm' }}</span>
                </div>
                <div style="display:flex;gap:6px;">
                  <a [href]="api.downloadBackupUrl(b.filename)" target="_blank"
                    style="flex:1;padding:6px 10px;border-radius:8px;border:1px solid var(--border-default);background:transparent;cursor:pointer;font-size:12px;color:var(--text-secondary);text-decoration:none;text-align:center;font-family:inherit;">
                    Скачать
                  </a>
                  <button (click)="restoreBackup(b)" [disabled]="restoring === b.filename"
                    style="flex:1;padding:6px 10px;border-radius:8px;border:1px solid #e67e22;background:transparent;cursor:pointer;font-size:12px;color:#e67e22;font-family:inherit;">
                    {{ restoring === b.filename ? '...' : 'Восстановить' }}
                  </button>
                  <button (click)="deleteBackup(b)"
                    style="flex:1;padding:6px 10px;border-radius:8px;border:1px solid #e74c3c;background:transparent;cursor:pointer;font-size:12px;color:#e74c3c;font-family:inherit;">
                    Удалить
                  </button>
                </div>
              </div>
            }
          </div>
        }
      }

      @if (activeTab === 'federation') {
        <app-admin-federation />
      }

      @if (activeTab === 'stickers') {
        <div>
          <div class="flex items-center gap-3 mb-4">
            <input #mobileNewPack type="text" [(ngModel)]="newStickerPackName" placeholder="Название нового пака..."
              style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--border-default);font-size:14px;font-family:inherit;">
            <button (click)="createStickerPack()" [disabled]="!newStickerPackName.trim()"
              [style.background]="!newStickerPackName.trim() ? 'var(--accent-muted, #94a3b8)' : 'var(--accent-gradient)'"
              [style.cursor]="!newStickerPackName.trim() ? 'not-allowed' : 'pointer'"
              [style.opacity]="!newStickerPackName.trim() ? '0.5' : '1'"
              style="padding:8px 16px;border-radius:8px;border:none;color:white;font-size:13px;font-weight:500;white-space:nowrap;">
              Создать пак
            </button>
          </div>

          @if (stickerLoading) {
            <p style="color:var(--text-tertiary);font-size:14px;">Загрузка...</p>
          } @else if (stickerPacks.length === 0) {
            <p style="color:var(--text-tertiary);font-size:14px;">Нет стикерпаков. Создайте первый.</p>
          } @else {
            @for (pack of stickerPacks; track pack.id) {
              <div style="margin-bottom:16px;padding:14px;border-radius:12px;border:1px solid var(--border-default);">
                <div class="flex items-center gap-3 mb-3">
                  <span style="font-size:15px;font-weight:600;color:var(--text-primary);">{{ pack.name }}</span>
                  <button (click)="deleteStickerPack(pack)" style="margin-left:auto;padding:4px 10px;border-radius:6px;border:1px solid #e74c3c;background:transparent;cursor:pointer;font-size:12px;color:#e74c3c;">Удалить</button>
                </div>
                <div class="flex flex-wrap gap-2 mb-3">
                  @for (sticker of pack.stickers; track sticker.id) {
                    <div class="relative">
                      <img [src]="sticker.image_url" class="w-14 h-14 rounded-lg object-cover" style="border:1px solid var(--border-default);">
                      <button (click)="deleteSticker(pack, sticker)"
                        class="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center text-xs rounded-full"
                        style="background:#e74c3c;color:white;border:none;cursor:pointer;">✕</button>
                    </div>
                  }
                </div>
                <label class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm cursor-pointer"
                  style="border:2px dashed var(--border-default);color:var(--text-secondary);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  Добавить стикер
                  <input type="file" accept="image/*" (change)="uploadSticker(pack, $event)" class="hidden">
                </label>
              </div>
            }
          }
          @if (stickerMsg) {
            <p class="text-sm mt-2" [style.color]="stickerMsgOk ? '#27ae60' : '#e74c3c'">{{ stickerMsg }}</p>
          }
        </div>
      }

      @if (activeTab === 'settings') {
        <div class="mb-6">
          <h3 class="text-base font-semibold mb-4" style="color:var(--text-primary);">Giphy API Key</h3>
          <p class="text-sm mb-3" style="color:var(--text-secondary);">
            API-ключ для поиска GIF через Giphy.
          </p>
          <div class="flex gap-2 items-start flex-wrap">
            <input #giphyKeyInput type="text" [(ngModel)]="giphyKey"
              [placeholder]="giphyHasKey ? 'Введите новый ключ...' : 'Введите Giphy API Key...'"
              style="flex:1;min-width:200px;box-sizing:border-box;padding:8px 12px;border-radius:var(--radius-sm);border:1px solid var(--border-default);background:var(--bg-surface);font-size:14px;color:var(--text-primary);outline:none;font-family:inherit;">
            <button (click)="saveGiphyKey()" [disabled]="giphySaving"
              style="padding:8px 16px;border-radius:var(--radius-sm);border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-size:14px;font-weight:500;font-family:inherit;">
              {{ giphySaving ? '...' : 'Сохранить' }}
            </button>
          </div>
          @if (giphyKeyMsg) {
            <p class="mt-2 text-sm" [style.color]="giphyKeyOk ? '#27ae60' : '#e74c3c'">{{ giphyKeyMsg }}</p>
          }
          @if (giphyHasKey) {
            <p class="mt-2 text-sm" style="color:var(--text-tertiary);">
              Текущий ключ: <code style="font-size:12px;">{{ giphyMaskedKey }}</code>
            </p>
          }
        </div>
      }
    </div>
  `,
})
export class AdminComponent implements OnInit {
  activeTab: 'users' | 'files' | 'chats' | 'backups' | 'federation' | 'stickers' | 'settings' = 'users';
  users: User[] = [];
  files: FileEntry[] = [];
  diskInfo: { total: number; used: number; free: number; total_gb: number; used_gb: number; free_gb: number; used_pct: number } | null = null;
  loadingUsers = false;
  loadingFiles = false;
  actionLoading: number | null = null;
  actionMsg = '';
  actionOk = false;
  deleteFileLoading: string | null = null;

  chats: AdminGroupChat[] = [];
  loadingChats = false;
  deleteChatLoading: number | null = null;
  chatActionMsg = '';
  chatActionOk = false;

  backups: BackupEntry[] = [];
  backupsLoading = false;
  backupLoading = false;
  backupUploadProgress = 0;
  restoring: string | null = null;
  backupMsg = '';
  backupOk = false;

  giphyKey = '';
  giphyMaskedKey = '';
  giphyHasKey = false;
  giphySaving = false;
  giphyKeyMsg = '';
  giphyKeyOk = false;

  stickerPacks: StickerPack[] = [];
  stickerLoading = false;
  newStickerPackName = '';
  stickerMsg = '';
  stickerMsgOk = false;

  currentVersion = '—';
  latestVersion = '';
  downloadUrl = '';
  gitHubUpdateAvailable = false;
  gitHubChecking = false;
  gitHubCheckError = '';
  versionCheckDone = false;

  constructor(public api: ApiService) {}

  loadFederation() {}

  ngOnInit() {
    this.loadUsers();
    this.loadFiles();
    this.loadGiphyKey();
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

  loadGiphyKey() {
    this.api.getGiphyKey().subscribe({
      next: (res) => {
        this.giphyHasKey = res.has_key;
        this.giphyMaskedKey = res.key;
      },
    });
  }

  loadStickers() {
    this.stickerLoading = true;
    this.stickerMsg = '';
    this.api.getStickerPacks().subscribe({
      next: (packs) => { this.stickerPacks = packs; this.stickerLoading = false; },
      error: () => { this.stickerMsg = 'Ошибка загрузки стикерпаков'; this.stickerMsgOk = false; this.stickerLoading = false; },
    });
  }

  createStickerPack() {
    const name = this.newStickerPackName.trim();
    if (!name) return;
    this.newStickerPackName = '';
    this.stickerMsg = '';
    this.api.adminCreateStickerPack(name).subscribe({
      next: () => {
        this.loadStickers();
        this.stickerMsg = 'Пак создан';
        this.stickerMsgOk = true;
        setTimeout(() => this.stickerMsg = '', 3000);
      },
      error: (err: unknown) => {
        console.error('createStickerPack error', err);
        const msg = err instanceof Error ? err.message : typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err);
        this.stickerMsg = 'Ошибка: ' + msg;
        this.stickerMsgOk = false;
      },
    });
  }

  deleteStickerPack(pack: StickerPack) {
    if (!confirm(`Удалить ${pack.name}?`)) return;
    this.api.adminDeleteStickerPack(pack.id).subscribe({
      next: () => {
        this.loadStickers();
        this.stickerMsg = 'Пак удалён';
        this.stickerMsgOk = true;
        setTimeout(() => this.stickerMsg = '', 3000);
      },
      error: () => { this.stickerMsg = 'Ошибка удаления пака'; this.stickerMsgOk = false; },
    });
  }

  uploadSticker(pack: StickerPack, event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    input.value = '';
    this.api.adminUploadSticker(pack.id, file).subscribe({
      next: () => {
        this.loadStickers();
        this.stickerMsg = 'Стикер добавлен';
        this.stickerMsgOk = true;
        setTimeout(() => this.stickerMsg = '', 3000);
      },
      error: () => { this.stickerMsg = 'Ошибка загрузки стикера'; this.stickerMsgOk = false; },
    });
  }

  deleteSticker(pack: StickerPack, sticker: { id: number }) {
    this.api.adminDeleteSticker(pack.id, sticker.id).subscribe({
      next: () => {
        this.loadStickers();
        this.stickerMsg = 'Стикер удалён';
        this.stickerMsgOk = true;
        setTimeout(() => this.stickerMsg = '', 3000);
      },
      error: () => { this.stickerMsg = 'Ошибка удаления стикера'; this.stickerMsgOk = false; },
    });
  }

  saveGiphyKey() {
    if (!this.giphyKey.trim()) return;
    this.giphySaving = true;
    this.giphyKeyMsg = '';
    this.api.updateGiphyKey(this.giphyKey.trim()).subscribe({
      next: () => {
        this.giphySaving = false;
        this.giphyKeyMsg = 'Ключ сохранён';
        this.giphyKeyOk = true;
        this.giphyHasKey = true;
        this.giphyMaskedKey = this.giphyKey.trim().slice(0, 4) + '*'.repeat(Math.max(0, this.giphyKey.trim().length - 4));
        this.giphyKey = '';
        setTimeout(() => this.giphyKeyMsg = '', 3000);
      },
      error: () => {
        this.giphySaving = false;
        this.giphyKeyMsg = 'Ошибка сохранения ключа';
        this.giphyKeyOk = false;
      },
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

  blockUser(user: User) {
    if (!confirm(`Заблокировать пользователя ${user.username}?`)) return;
    this.actionLoading = user.id;
    this.actionMsg = '';
    this.api.adminBlockUser(user.id).subscribe({
      next: () => {
        user.is_banned = true;
        this.actionLoading = null;
        this.actionMsg = `Пользователь ${user.username} заблокирован`;
        this.actionOk = true;
        this.clearMsg();
      },
      error: () => {
        this.actionLoading = null;
        this.actionMsg = 'Ошибка блокировки пользователя';
        this.actionOk = false;
        this.clearMsg();
      },
    });
  }

  unblockUser(user: User) {
    this.actionLoading = user.id;
    this.actionMsg = '';
    this.api.adminUnblockUser(user.id).subscribe({
      next: () => {
        user.is_banned = false;
        this.actionLoading = null;
        this.actionMsg = `Пользователь ${user.username} разблокирован`;
        this.actionOk = true;
        this.clearMsg();
      },
      error: () => {
        this.actionLoading = null;
        this.actionMsg = 'Ошибка разблокировки пользователя';
        this.actionOk = false;
        this.clearMsg();
      },
    });
  }

  deleteUser(user: User) {
    if (!confirm(`Удалить пользователя ${user.username}? Все его данные будут безвозвратно удалены.`)) return;
    this.actionLoading = user.id;
    this.actionMsg = '';
    this.api.adminDeleteUser(user.id).subscribe({
      next: () => {
        this.users = this.users.filter(u => u.id !== user.id);
        this.actionLoading = null;
        this.actionMsg = `Пользователь ${user.username} удалён`;
        this.actionOk = true;
        this.clearMsg();
      },
      error: () => {
        this.actionLoading = null;
        this.actionMsg = 'Ошибка удаления пользователя';
        this.actionOk = false;
        this.clearMsg();
      },
    });
  }

  deleteFile(file: FileEntry) {
    if (!confirm(`Удалить файл "${file.name}"?`)) return;
    this.deleteFileLoading = file.path;
    this.api.adminDeleteFile(file.path).subscribe({
      next: () => {
        this.files = this.files.filter(f => f.path !== file.path);
        this.deleteFileLoading = null;
      },
      error: () => {
        this.deleteFileLoading = null;
        this.actionMsg = 'Ошибка удаления файла';
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

  loadGroupChats() {
    this.loadingChats = true;
    this.api.getAdminGroupChats().subscribe({
      next: (chats) => { this.chats = chats; this.loadingChats = false; },
      error: () => this.loadingChats = false,
    });
  }

  deleteChat(chat: AdminGroupChat) {
    if (!confirm(`Удалить чат "${chat.name}"? Это действие необратимо.`)) return;
    this.deleteChatLoading = chat.id;
    this.chatActionMsg = '';
    this.api.adminDeleteGroupChat(chat.id).subscribe({
      next: () => {
        this.chats = this.chats.filter(c => c.id !== chat.id);
        this.deleteChatLoading = null;
        this.chatActionMsg = `Чат "${chat.name}" удалён`;
        this.chatActionOk = true;
        this.clearChatMsg();
      },
      error: () => {
        this.deleteChatLoading = null;
        this.chatActionMsg = 'Ошибка удаления чата';
        this.chatActionOk = false;
        this.clearChatMsg();
      },
    });
  }

  private clearChatMsg() {
    setTimeout(() => (this.chatActionMsg = ''), 3000);
  }

  loadBackups() {
    this.backupsLoading = true;
    this.api.getBackups().subscribe({
      next: (list) => { this.backups = list; this.backupsLoading = false; },
      error: () => this.backupsLoading = false,
    });
  }

  createBackup() {
    this.backupLoading = true;
    this.backupMsg = '';
    this.api.createBackup().subscribe({
      next: (res) => {
        this.backupLoading = false;
        this.backupMsg = `Бэкап создан: ${res.filename}`;
        this.backupOk = true;
        this.loadBackups();
        setTimeout(() => this.backupMsg = '', 3000);
      },
      error: () => {
        this.backupLoading = false;
        this.backupMsg = 'Ошибка создания бэкапа';
        this.backupOk = false;
        setTimeout(() => this.backupMsg = '', 3000);
      },
    });
  }

  uploadBackup(event: any) {
    const file = event.target?.files?.[0];
    if (!file) return;
    this.backupLoading = true;
    this.backupUploadProgress = 0;
    this.backupMsg = '';
    this.api.uploadBackup(file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          this.backupUploadProgress = event.total ? Math.round(event.loaded / event.total * 100) : 0;
        } else if (event.type === HttpEventType.Response) {
          this.backupLoading = false;
          this.backupMsg = 'Бэкап загружен';
          this.backupOk = true;
          this.loadBackups();
          setTimeout(() => this.backupMsg = '', 3000);
        }
      },
      error: () => {
        this.backupLoading = false;
        this.backupMsg = 'Ошибка загрузки';
        this.backupOk = false;
        setTimeout(() => this.backupMsg = '', 3000);
      },
    });
    event.target.value = '';
  }

  restoreBackup(b: BackupEntry) {
    if (!confirm(`Восстановить сервер из бэкапа "${b.filename}"? Сервер будет перезапущен.`)) return;
    this.restoring = b.filename;
    this.api.restoreBackup(b.filename).subscribe({
      next: () => {
        this.restoring = null;
        this.backupMsg = 'Сервер восстанавливается...';
        this.backupOk = true;
      },
      error: () => {
        this.restoring = null;
        this.backupMsg = 'Ошибка восстановления';
        this.backupOk = false;
        setTimeout(() => this.backupMsg = '', 3000);
      },
    });
  }

  deleteBackup(b: BackupEntry) {
    if (!confirm(`Удалить бэкап "${b.filename}"?`)) return;
    this.api.deleteBackup(b.filename).subscribe({
      next: () => {
        this.backups = this.backups.filter(x => x.filename !== b.filename);
      },
      error: () => {
        this.backupMsg = 'Ошибка удаления';
        this.backupOk = false;
        setTimeout(() => this.backupMsg = '', 3000);
      },
    });
  }
}
