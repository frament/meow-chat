import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService, User, Message, MsgType, GroupChat, GroupMember } from '../../services/api.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <input type="file" #fileInput (change)="onFileSelected($event)" accept="image/jpeg,image/png,image/gif,image/webp" multiple style="display:none;">
    <!-- Desktop -->
    <div class="hidden md:flex gap-4 h-[calc(100vh-6rem)]">
      <div class="w-72 card p-3 overflow-y-auto shrink-0">
        <div class="flex items-center justify-between" style="margin-bottom:8px;">
          <h3 class="section-label" style="margin:0;">Групповые чаты</h3>
          <button (click)="showCreateGroup = true"
            style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:white;font-size:16px;cursor:pointer;">+</button>
        </div>
        @for (group of groupChats; track group.id) {
          <div (click)="selectGroup(group)"
            class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
            [style.background]="selectedGroup?.id === group.id ? 'var(--accent-light)' : 'transparent'"
            [class.hover-bg]="selectedGroup?.id !== group.id">
            <span class="flex-1 text-sm truncate" style="color:var(--text-primary);">{{ group.name }}</span>
            <span class="text-xs opacity-50">{{ group.member_count }}</span>
          </div>
        }
        @if (groupChats.length > 0) {
          <div class="divider" style="margin:8px 0;"></div>
        }
        @if (getPinnedUsers().length > 0) {
          <h3 class="section-label" style="margin-bottom:12px;">📌 Закреплённые</h3>
          @for (user of getPinnedUsers(); track user.id) {
            <div (click)="openChat(user)"
              class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
              [style.background]="selectedUser?.id === user.id ? 'var(--accent-light)' : 'transparent'"
              [class.hover-bg]="selectedUser?.id !== user.id">
              <div style="position:relative;display:inline-flex;">
                @if (user.avatar_url) {
                  <img [src]="user.avatar_url" class="w-8 h-8 rounded-full object-cover">
                } @else {
                  <div class="post-avatar" style="width:32px;height:32px;font-size:13px;">
                    {{ user.username[0] }}
                  </div>
                }
                @if (user.is_admin) {
                  <div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--accent-gradient);border:2px solid var(--bg-body);display:flex;align-items:center;justify-content:center;">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                  </div>
                }
              </div>
              <span class="flex-1 text-sm" style="color:var(--text-primary);">{{ user.username }}</span>
              @if (api.unreadCounts()[user.id]) {
                <span class="badge-user">{{ api.unreadCounts()[user.id] }}</span>
              }
              @if (user.is_online) {
                <span class="w-2 h-2 rounded-full shrink-0" style="background:#34d399;"></span>
              }
              <button (click)="togglePin(user.id, $event)" class="p-1 text-xs" style="color:var(--text-tertiary);" title="Открепить">📌</button>
            </div>
          }
          <div class="divider" style="margin:8px 0;"></div>
        }

        <h3 class="section-label" style="margin-bottom:12px;">Все пользователи</h3>
        @for (user of getUnpinnedUsers(); track user.id) {
          <div (click)="openChat(user)"
            class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
            [style.background]="selectedUser?.id === user.id ? 'var(--accent-light)' : 'transparent'"
            [class.hover-bg]="selectedUser?.id !== user.id">
            <div style="position:relative;display:inline-flex;">
              @if (user.avatar_url) {
                <img [src]="user.avatar_url" class="w-8 h-8 rounded-full object-cover">
              } @else {
                <div class="post-avatar" style="width:32px;height:32px;font-size:13px;">
                  {{ user.username[0] }}
                </div>
              }
              @if (user.is_admin) {
                <div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--accent-gradient);border:2px solid var(--bg-body);display:flex;align-items:center;justify-content:center;">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                </div>
              }
            </div>
            <span class="flex-1 text-sm" style="color:var(--text-primary);">{{ user.username }}</span>
            @if (api.unreadCounts()[user.id]) {
              <span class="badge-user">{{ api.unreadCounts()[user.id] }}</span>
            }
            @if (user.is_online) {
              <span class="w-2 h-2 rounded-full shrink-0" style="background:#34d399;"></span>
            }
            <button (click)="togglePin(user.id, $event)" class="p-1 text-xs" style="color:var(--text-tertiary);" title="Закрепить">📌</button>
          </div>
        }
      </div>

      <div class="flex-1 card flex flex-col">
        @if (!selectedUser && !selectedGroup) {
          <div class="flex-1 flex items-center justify-center" style="color:var(--text-tertiary);font-size:14px;">
            Выберите чат
          </div>
        }

        @if (selectedUser || selectedGroup) {
          @if (selectedGroup) {
          <div class="flex items-center gap-3 px-4 py-3" style="border-bottom:1px solid var(--divider);">
            <h3 class="font-medium" style="color:var(--text-primary);">{{ selectedGroup.name }}</h3>
            <button (click)="loadGroupInfo()"
              style="margin-left:auto;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:none;border-radius:var(--radius-sm);background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:14px;">ℹ️</button>
          </div>
          }
          @if (selectedUser) {
          <div class="flex items-center gap-3 px-4 py-3" style="border-bottom:1px solid var(--divider);">
            <h3 class="font-medium" style="color:var(--text-primary);">{{ selectedUser.username }}</h3>
          </div>
          }

          <div data-scroll-container class="flex-1 overflow-y-auto p-4" style="display:flex;flex-direction:column;gap:8px;">
            @for (msg of messages; track msg.id; let i = $index) {
              @if (i === unreadDividerIdx) {
                <div class="unread-divider"><span>Новые сообщения</span></div>
              }
              <div class="flex" [class.justify-end]="msg.from_user_id === currentUserId">
                <div [class.chat-message-outgoing]="msg.from_user_id === currentUserId"
                  [class.chat-message-incoming]="msg.from_user_id !== currentUserId">
                  @if (selectedGroup && msg.from_user_id !== currentUserId) {
                    <p class="text-xs font-medium mb-1" style="color:var(--accent);">{{ msg.from_user }}</p>
                  }
                  @if ((msg.msg_type || 'text') === 'sticker') {
                    <div class="flex flex-col items-center gap-1 px-3 py-2 min-w-[80px]">
                      <span style="font-size:2rem;">🎯</span>
                      <span class="text-xs opacity-60">Sticker</span>
                    </div>
                  } @else if ((msg.msg_type || 'text') === 'gif') {
                    <div class="flex flex-col items-center gap-1 px-3 py-2 min-w-[80px]">
                      <span style="font-size:1.25rem;font-weight:700;">GIF</span>
                      @if (msg.content) { <span class="text-xs opacity-60">{{ msg.content }}</span> }
                    </div>
                  } @else if ((msg.msg_type || 'text') === 'poll') {
                    <div class="flex flex-col gap-2 px-3 py-2 min-w-[180px]">
                      <span class="text-sm font-medium">{{ msg.content || 'Poll' }}</span>
                      <div class="flex items-center gap-2 text-xs opacity-60">
                        <span>📊</span><span>Coming soon</span>
                      </div>
                    </div>
                  } @else {
                    @if (msg.content) { <p>{{ msg.content }}</p> }
                    @if (msg.images && msg.images.length > 0) {
                    <div class="flex flex-wrap gap-1 mt-1">
                      @for (img of msg.images; track img.id || $index) {
                      <img [src]="img.image_url" class="max-w-[200px] max-h-[200px] rounded-lg object-cover cursor-pointer"
                      (click)="openImage(img.image_url)">
                      }
                    </div>
                    }
                  }
                  <p class="text-xs mt-1 opacity-70">{{ msg.created_at | date:'HH:mm' }}</p>
                </div>
              </div>
            }
          </div>

          <!-- Desktop chat input -->
          <div>
            @if (previews.length > 0) {
            <div class="flex gap-2 px-4 py-2 overflow-x-auto" style="border-top:1px solid var(--divider);">
              @for (preview of previews; track $index) {
              <div class="relative shrink-0">
                <img [src]="preview" class="w-16 h-16 rounded-lg object-cover">
                <button (click)="removeFile($index)"
                class="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-xs rounded-full"
                style="background:var(--bg-overlay);color:var(--text-primary);border:1px solid var(--divider);">✕</button>
              </div>
              }
            </div>
            }
            <div class="flex gap-1 px-4 py-1.5" style="border-top:1px solid var(--divider);">
              @for (t of msgTypes; track t.id) {
                <button (click)="messageType = t.id"
                  [style.background]="messageType === t.id ? 'var(--accent-light)' : 'transparent'"
                  [style.color]="messageType === t.id ? 'var(--accent)' : 'var(--text-tertiary)'"
                  [title]="t.label"
                  style="flex:1;height:30px;display:flex;align-items:center;justify-content:center;gap:3px;border:none;border-radius:var(--radius-sm);font-size:11px;cursor:pointer;transition:all 0.15s;">
                  <span>{{ t.icon }}</span>
                  <span style="font-weight:500;">{{ t.label }}</span>
                </button>
              }
            </div>
            <div class="chat-input" style="border-top:1px solid var(--divider);padding:12px 16px;display:flex;gap:8px;">
              <button (click)="triggerFileInput()" title="Прикрепить изображение"
              style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:transparent;color:var(--text-tertiary);cursor:pointer;">
              <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              </button>
              <input type="text" [(ngModel)]="messageContent" (keyup.enter)="sendMessage()"
              style="flex:1;height:36px;box-sizing:border-box;"
              [placeholder]="messageType === 'text' ? 'Напишите сообщение...' : messageType === 'image' ? 'Подпись к изображению...' : 'Скоро...'">
              <button (click)="sendMessage()" title="Отправить"
              style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:white;cursor:pointer;transition:all 0.2s;">
              <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              </button>
            </div>
          </div>
        }
      </div>
    </div>

    <!-- Mobile -->
    <div class="md:hidden">
      @if (!showMobileChat) {
        <div class="px-4 py-6 pb-20 space-y-2">
          <div class="flex items-center justify-between" style="margin-bottom:8px;">
            <h3 class="section-label" style="margin:0;">Групповые чаты</h3>
            <button (click)="showCreateGroup = true"
              style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:white;font-size:16px;cursor:pointer;">+</button>
          </div>
          @for (group of groupChats; track group.id) {
            <div (click)="selectGroup(group)"
              class="card flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover-bg">
              <span class="flex-1 text-sm font-medium truncate" style="color:var(--text-primary);">{{ group.name }}</span>
              <span class="text-xs opacity-50">{{ group.member_count }}</span>
            </div>
          }
          @if (groupChats.length > 0) {
            <div class="divider"></div>
          }
          @if (getPinnedUsers().length > 0) {
            <h3 class="section-label" style="margin-bottom:12px;">📌 Закреплённые</h3>
            @for (user of getPinnedUsers(); track user.id) {
              <div (click)="openChat(user)"
                class="card flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover-bg">
                <div style="position:relative;display:inline-flex;">
                  @if (user.avatar_url) {
                    <img [src]="user.avatar_url" class="w-10 h-10 rounded-full object-cover shrink-0">
                  } @else {
                    <div class="post-avatar" style="width:40px;height:40px;font-size:16px;">
                      {{ user.username[0] }}
                    </div>
                  }
                  @if (user.is_admin) {
                    <div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--accent-gradient);border:2px solid var(--bg-body);display:flex;align-items:center;justify-content:center;">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                    </div>
                  }
                </div>
                <span class="flex-1 text-sm font-medium" style="color:var(--text-primary);">{{ user.username }}</span>
                @if (api.unreadCounts()[user.id]) {
                  <span class="badge-user">{{ api.unreadCounts()[user.id] }}</span>
                }
                @if (user.is_online) {
                  <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:#34d399;"></span>
                }
                <button (click)="togglePin(user.id, $event)" class="p-1 text-sm" style="color:var(--text-tertiary);" title="Открепить">📌</button>
              </div>
            }
          }

          <h3 class="section-label" style="margin-bottom:12px;">Все пользователи</h3>
          @for (user of getUnpinnedUsers(); track user.id) {
            <div (click)="openChat(user)"
              class="card flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover-bg">
              <div style="position:relative;display:inline-flex;">
                @if (user.avatar_url) {
                  <img [src]="user.avatar_url" class="w-10 h-10 rounded-full object-cover shrink-0">
                } @else {
                  <div class="post-avatar" style="width:40px;height:40px;font-size:16px;">
                    {{ user.username[0] }}
                  </div>
                }
                @if (user.is_admin) {
                  <div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--accent-gradient);border:2px solid var(--bg-body);display:flex;align-items:center;justify-content:center;">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                  </div>
                }
              </div>
              <span class="flex-1 text-sm font-medium" style="color:var(--text-primary);">{{ user.username }}</span>
              @if (api.unreadCounts()[user.id]) {
                <span class="badge-user">{{ api.unreadCounts()[user.id] }}</span>
              }
              @if (user.is_online) {
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:#34d399;"></span>
              }
              <button (click)="togglePin(user.id, $event)" class="p-1 text-sm" style="color:var(--text-tertiary);" title="Закрепить">📌</button>
            </div>
          }
        </div>
      }

      @if (showMobileChat && (selectedUser || selectedGroup)) {
        <div class="flex flex-col" style="height:calc(100dvh - 7rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));">
          <div class="flex items-center gap-3 px-4 py-3 shrink-0"
            style="border-bottom:1px solid var(--border-default);background:var(--nav-bg);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);">
            <button (click)="router.navigate(['/chat'])" class="p-1 -ml-1" style="color:var(--text-secondary);">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div class="flex items-center gap-2">
              @if (selectedUser) {
              <div style="position:relative;display:inline-flex;">
                @if (selectedUser.avatar_url) {
                  <img [src]="selectedUser.avatar_url" class="w-7 h-7 rounded-full object-cover">
                } @else {
                  <div class="flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold"
                    style="background:var(--avatar-bg);color:var(--avatar-text);">
                    {{ selectedUser.username[0] }}
                  </div>
                }
                @if (selectedUser.is_admin) {
                  <div style="position:absolute;bottom:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:var(--accent-gradient);border:2px solid var(--bg-body);display:flex;align-items:center;justify-content:center;">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
                  </div>
                }
              </div>
              <h3 class="font-medium text-sm" style="color:var(--text-primary);">{{ selectedUser.username }}</h3>
              } @else {
              <div class="flex items-center gap-2">
                <h3 class="font-medium text-sm" style="color:var(--text-primary);">{{ selectedGroup?.name }}</h3>
                <button (click)="loadGroupInfo()" class="text-xs" style="color:var(--text-tertiary);">ℹ️</button>
              </div>
              }
            </div>
          </div>

          <div data-scroll-container class="flex-1 overflow-y-auto p-4" style="display:flex;flex-direction:column;gap:8px;">
            @for (msg of messages; track msg.id; let i = $index) {
              @if (i === unreadDividerIdx) {
                <div class="unread-divider"><span>Новые сообщения</span></div>
              }
              <div class="flex" [class.justify-end]="msg.from_user_id === currentUserId">
                <div [class.chat-message-outgoing]="msg.from_user_id === currentUserId"
                  [class.chat-message-incoming]="msg.from_user_id !== currentUserId">
                  @if (selectedGroup && msg.from_user_id !== currentUserId) {
                    <p class="text-xs font-medium mb-1" style="color:var(--accent);">{{ msg.from_user }}</p>
                  }
                  @if ((msg.msg_type || 'text') === 'sticker') {
                    <div class="flex flex-col items-center gap-1 px-3 py-2 min-w-[80px]">
                      <span style="font-size:2rem;">🎯</span>
                      <span class="text-xs opacity-60">Sticker</span>
                    </div>
                  } @else if ((msg.msg_type || 'text') === 'gif') {
                    <div class="flex flex-col items-center gap-1 px-3 py-2 min-w-[80px]">
                      <span style="font-size:1.25rem;font-weight:700;">GIF</span>
                      @if (msg.content) { <span class="text-xs opacity-60">{{ msg.content }}</span> }
                    </div>
                  } @else if ((msg.msg_type || 'text') === 'poll') {
                    <div class="flex flex-col gap-2 px-3 py-2 min-w-[180px]">
                      <span class="text-sm font-medium">{{ msg.content || 'Poll' }}</span>
                      <div class="flex items-center gap-2 text-xs opacity-60">
                        <span>📊</span><span>Coming soon</span>
                      </div>
                    </div>
                  } @else {
                    @if (msg.content) { <p>{{ msg.content }}</p> }
                    @if (msg.images && msg.images.length > 0) {
                    <div class="flex flex-wrap gap-1 mt-1">
                      @for (img of msg.images; track img.id || $index) {
                      <img [src]="img.image_url" class="max-w-[200px] max-h-[200px] rounded-lg object-cover cursor-pointer"
                      (click)="openImage(img.image_url)">
                      }
                    </div>
                    }
                  }
                  <p class="text-xs mt-1 opacity-70">{{ msg.created_at | date:'HH:mm' }}</p>
                </div>
              </div>
            }
          </div>

          <!-- Mobile chat input -->
          <div>
            @if (previews.length > 0) {
            <div class="flex gap-2 px-4 py-2 overflow-x-auto" style="border-top:1px solid var(--divider);">
              @for (preview of previews; track $index) {
              <div class="relative shrink-0">
                <img [src]="preview" class="w-16 h-16 rounded-lg object-cover">
                <button (click)="removeFile($index)"
                class="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-xs rounded-full"
                style="background:var(--bg-overlay);color:var(--text-primary);border:1px solid var(--divider);">✕</button>
              </div>
              }
            </div>
            }
            <div class="flex gap-1 px-4 py-1.5" style="border-top:1px solid var(--divider);">
              @for (t of msgTypes; track t.id) {
                <button (click)="messageType = t.id"
                  [style.background]="messageType === t.id ? 'var(--accent-light)' : 'transparent'"
                  [style.color]="messageType === t.id ? 'var(--accent)' : 'var(--text-tertiary)'"
                  [title]="t.label"
                  style="flex:1;height:30px;display:flex;align-items:center;justify-content:center;gap:3px;border:none;border-radius:var(--radius-sm);font-size:11px;cursor:pointer;transition:all 0.15s;">
                  <span>{{ t.icon }}</span>
                  <span style="font-weight:500;">{{ t.label }}</span>
                </button>
              }
            </div>
            <div class="chat-input" style="border-top:1px solid var(--divider);padding:12px 16px;display:flex;gap:8px;">
              <button (click)="triggerFileInput()" title="Прикрепить изображение"
              style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:transparent;color:var(--text-tertiary);cursor:pointer;">
              <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              </button>
              <input type="text" [(ngModel)]="messageContent" (keyup.enter)="sendMessage()"
              style="flex:1;height:36px;box-sizing:border-box;"
              [placeholder]="messageType === 'text' ? 'Напишите сообщение...' : messageType === 'image' ? 'Подпись к изображению...' : 'Скоро...'">
              <button (click)="sendMessage()" title="Отправить"
              style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:white;cursor:pointer;transition:all 0.2s;">
              <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              </button>
            </div>
          </div>
        </div>
      }
    </div>

    <!-- Create Group Modal -->
    @if (showCreateGroup) {
    <div (click)="showCreateGroup = false"
      style="position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);">
      <div (click)="$event.stopPropagation()"
        style="background:var(--bg-body);border-radius:var(--radius-md);padding:24px 28px;width:90%;max-width:380px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
        <h3 class="text-lg font-medium mb-3" style="color:var(--text-primary);">Создать группу</h3>
        <input type="text" [(ngModel)]="newGroupName"
          style="width:100%;box-sizing:border-box;margin-bottom:12px;"
          placeholder="Название группы...">
        <div class="flex gap-2 justify-end">
          <button (click)="showCreateGroup = false"
            style="padding:8px 16px;border-radius:var(--radius-sm);border:1px solid var(--divider);background:transparent;color:var(--text-primary);cursor:pointer;">Отмена</button>
          <button (click)="createGroup()" [disabled]="!newGroupName.trim()"
            style="padding:8px 16px;border-radius:var(--radius-sm);border:none;background:var(--accent-gradient);color:white;cursor:pointer;">Создать</button>
        </div>
      </div>
    </div>
    }

    <!-- Group Info Modal -->
    @if (showGroupInfo && selectedGroup) {
    <div (click)="showGroupInfo = false"
      style="position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);">
      <div (click)="$event.stopPropagation()"
        style="background:var(--bg-body);border-radius:var(--radius-md);padding:24px 28px;width:90%;max-width:400px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
        <h3 class="text-lg font-medium mb-3" style="color:var(--text-primary);">{{ selectedGroup.name }}</h3>
        <p class="text-sm mb-3 opacity-60">{{ groupMembers.length }} участников</p>

        <div class="mb-3">
          <h4 class="text-sm font-medium mb-2" style="color:var(--text-primary);">Участники</h4>
          @for (m of groupMembers; track m.user_id) {
          <div class="flex items-center gap-2 py-1">
            @if (m.avatar_url) {
              <img [src]="m.avatar_url" class="w-6 h-6 rounded-full object-cover">
            } @else {
              <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold"
                style="background:var(--avatar-bg);color:var(--avatar-text);">{{ m.username[0] }}</div>
            }
            <span class="text-sm" style="color:var(--text-primary);">{{ m.username }}</span>
          </div>
          }
        </div>

        <div class="mb-3">
          <h4 class="text-sm font-medium mb-2" style="color:var(--text-primary);">Пригласить</h4>
          <button (click)="createInvite()"
            style="padding:6px 12px;border-radius:var(--radius-sm);border:none;background:var(--accent-gradient);color:white;font-size:12px;cursor:pointer;">
            Создать ссылку-приглашение
          </button>
          @if (inviteToken) {
          <div class="mt-2">
            <input type="text" [value]="inviteUrl" readonly
              (click)="$event.target.select()" style="width:100%;box-sizing:border-box;font-size:11px;">
            <div class="flex gap-2 mt-2">
              <button (click)="copyInviteLink()"
                style="padding:4px 10px;border-radius:var(--radius-sm);border:1px solid var(--divider);background:transparent;color:var(--text-primary);font-size:11px;cursor:pointer;">
                {{ copied ? 'Скопировано!' : 'Копировать' }}
              </button>
              <button (click)="showQR = !showQR"
                style="padding:4px 10px;border-radius:var(--radius-sm);border:1px solid var(--divider);background:transparent;color:var(--text-primary);font-size:11px;cursor:pointer;">
                {{ showQR ? 'Скрыть QR' : 'QR-код' }}
              </button>
            </div>
            @if (showQR) {
            <div class="mt-2 flex justify-center">
              <img [src]="'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=' + encodeURI(inviteUrl)"
                class="w-40 h-40">
            </div>
            }
          </div>
          }
        </div>

        <div class="flex justify-end">
          <button (click)="showGroupInfo = false"
            style="padding:8px 16px;border-radius:var(--radius-sm);border:1px solid var(--divider);background:transparent;color:var(--text-primary);cursor:pointer;">Закрыть</button>
        </div>
      </div>
    </div>
    }
  `,
})
export class ChatComponent implements OnInit, OnDestroy {
  users: User[] = [];
  selectedUser: User | null = null;
  messages: Message[] = [];
  messageContent = '';
  messageType: MsgType = 'text';
  readonly msgTypes: { id: MsgType; icon: string; label: string }[] = [
    { id: 'text', icon: 'Aa', label: 'Текст' },
    { id: 'image', icon: '🖼', label: 'Фото' },
    { id: 'sticker', icon: '🎯', label: 'Стикер' },
    { id: 'gif', icon: 'GIF', label: 'GIF' },
    { id: 'poll', icon: '📊', label: 'Опрос' },
  ];
  selectedFiles: File[] = [];
  previews: string[] = [];
  currentUserId = 0;
  showMobileChat = false;
  pinnedIds: Set<number> = new Set();
  unreadDividerIdx = -1;
  groupChats: GroupChat[] = [];
  selectedGroup: GroupChat | null = null;
  groupMembers: GroupMember[] = [];
  showGroupInfo = false;
  showCreateGroup = false;
  newGroupName = '';
  inviteToken = '';
  inviteUrl = '';
  copied = false;
  showQR = false;
  private subscriptions: Subscription[] = [];
  private boundaryTimer: ReturnType<typeof setTimeout> | null = null;

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.querySelectorAll<HTMLDivElement>('[data-scroll-container]').forEach(el => {
          el.scrollTop = el.scrollHeight;
        });
      });
    });
  }

  constructor(
    protected api: ApiService,
    private route: ActivatedRoute,
    protected router: Router,
  ) {}

  ngOnInit() {
    this.currentUserId = this.api.currentUser()?.id ?? 0;

    this.route.paramMap.subscribe((params) => {
      const userId = params.get('userId');
      const groupId = params.get('groupId');
      this.showMobileChat = !!(userId || groupId);
      if (groupId && this.groupChats.length > 0) {
        this.resolvePendingGroupChat(Number(groupId));
      } else if (userId && this.users.length > 0) {
        const user = this.users.find((u) => u.id === Number(userId));
        if (user) {
          this.selectUser(user);
        }
      }
    });

    this.loadFromCache();
    this.loadFromServer();
    this.loadGroupChats();
    this.listenWsOnlineEvents();

    this.subscriptions.push(
      this.api.wsMessages$.subscribe((data: any) => {
        if (data.type === 'message' && this.selectedUser && data.from === this.selectedUser.id) {
          const msg: Message = {
            id: Date.now(),
            from_user_id: data.from,
            to_user_id: this.currentUserId,
            content: data.content,
            msg_type: data.msg_type || 'text',
            created_at: new Date().toISOString(),
            from_user: data.from_name || this.selectedUser.username,
            images: data.images ? data.images.map((url: string) => ({ id: 0, image_url: url })) : undefined,
          };
          this.messages.push(msg);
          localStorage.setItem(this.messageCacheKey(this.selectedUser.id), JSON.stringify(this.messages));
          this.scrollToBottom();
        }
        if (data.type === 'group_message' && this.selectedGroup && data.group_id === this.selectedGroup.id) {
          const msg: Message = {
            id: Date.now(),
            from_user_id: data.from,
            to_user_id: 0,
            group_chat_id: data.group_id,
            content: data.content,
            msg_type: data.msg_type || 'text',
            created_at: new Date().toISOString(),
            from_user: data.from_name || '',
            images: data.images ? data.images.map((url: string) => ({ id: 0, image_url: url })) : undefined,
          };
          this.messages.push(msg);
          this.scrollToBottom();
        }
      })
    );
  }

  private loadFromCache() {
    const cached = localStorage.getItem('cachedUsers');
    const cachedPins = localStorage.getItem('cachedPins');
    if (cached) {
      const users: User[] = JSON.parse(cached);
      this.users = users.filter((u) => u.id !== this.currentUserId);
    }
    if (cachedPins) {
      this.pinnedIds = new Set<number>(JSON.parse(cachedPins));
    }
  }

  private loadFromServer() {
    this.api.getUsers().subscribe((users: User[]) => {
      this.users = users.filter((u) => u.id !== this.currentUserId);
      localStorage.setItem('cachedUsers', JSON.stringify(users));
      this.resolvePendingChat();
    });
    this.api.getPinned().subscribe((res) => {
      this.pinnedIds = new Set(res.pinned_user_ids);
      localStorage.setItem('cachedPins', JSON.stringify(res.pinned_user_ids));
    });
  }

  private resolvePendingChat() {
    const userId = this.route.snapshot.paramMap.get('userId');
    if (userId) {
      const user = this.users.find((u) => u.id === Number(userId));
      if (user) {
        this.selectUser(user);
      }
    }
  }

  private listenWsOnlineEvents() {
    this.subscriptions.push(
      this.api.wsOnlineEvent.subscribe((event) => {
      for (const u of this.users) {
        if (u.id === event.user_id) {
          u.is_online = event.type === 'user_online';
          break;
        }
      }
      // Force change detection by replacing array reference
      this.users = [...this.users];
    })
    );
  }

  ngOnDestroy() {
    for (const sub of this.subscriptions) sub.unsubscribe();
    if (this.boundaryTimer) clearTimeout(this.boundaryTimer);
  }

  private messageCacheKey(otherUserId: number): string {
    const ids = [this.currentUserId, otherUserId].sort((a, b) => a - b);
    return `cached_messages_${ids[0]}_${ids[1]}`;
  }

  selectUser(user: User) {
    this.selectedUser = user;
    this.selectedGroup = null;

    const boundary = this.api.unreadBoundaries()[user.id] ?? null;
    this.api.clearUnread(user.id);

    const cached = localStorage.getItem(this.messageCacheKey(user.id));
    this.messages = cached ? JSON.parse(cached) : [];

    this.api.getMessages(this.currentUserId, user.id).subscribe((msgs: Message[]) => {
      this.messages = msgs;
      localStorage.setItem(this.messageCacheKey(user.id), JSON.stringify(msgs));
      if (boundary) {
        const idx = msgs.findIndex(m => new Date(m.created_at) >= new Date(boundary));
        this.unreadDividerIdx = idx >= 0 ? idx : -1;
        if (this.boundaryTimer) clearTimeout(this.boundaryTimer);
        this.boundaryTimer = setTimeout(() => {
          this.api.clearUnreadBoundary(user.id);
          this.boundaryTimer = null;
        }, 30000);
      } else {
        this.unreadDividerIdx = -1;
      }
      this.scrollToBottom();
    });
  }

  openChat(user: User) {
    this.selectedGroup = null;
    this.router.navigate(['/chat', user.id]);
  }

  togglePin(userId: number, event: MouseEvent) {
    event.stopPropagation();
    if (this.pinnedIds.has(userId)) {
      this.pinnedIds.delete(userId);
      this.api.unpinUser(userId).subscribe({ error: () => this.pinnedIds.add(userId) });
    } else {
      this.pinnedIds.add(userId);
      this.api.pinUser(userId).subscribe({ error: () => this.pinnedIds.delete(userId) });
    }
    this.pinnedIds = new Set(this.pinnedIds);
    localStorage.setItem('cachedPins', JSON.stringify([...this.pinnedIds]));
  }

  getPinnedUsers(): User[] {
    return this.users.filter((u) => this.pinnedIds.has(u.id));
  }

  getUnpinnedUsers(): User[] {
    return this.users.filter((u) => !this.pinnedIds.has(u.id));
  }

  sendMessage() {
    if (!this.selectedUser && !this.selectedGroup) return;
    if (!this.messageContent.trim() && this.selectedFiles.length === 0) return;
    const type = this.messageType;

    const content = this.messageContent;
    const files = [...this.selectedFiles];

    if (this.selectedGroup) {
      this.api.sendGroupMessage(this.selectedGroup.id, content, files, type).subscribe({
        next: () => {
          const msg: Message = {
            id: Date.now(),
            from_user_id: this.currentUserId,
            to_user_id: 0,
            group_chat_id: this.selectedGroup!.id,
            content: content,
            msg_type: type,
            created_at: new Date().toISOString(),
            from_user: this.api.currentUser()?.username ?? '',
          };
          this.messages.push(msg);
          this.messageContent = '';
          this.clearFiles();
          this.scrollToBottom();
        },
      });
    } else if (this.selectedUser) {
      this.api.sendMessage(this.selectedUser.id, content, files, type).subscribe({
        next: () => {
          const msg: Message = {
            id: Date.now(),
            from_user_id: this.currentUserId,
            to_user_id: this.selectedUser!.id,
            content: content,
            msg_type: type,
            created_at: new Date().toISOString(),
            from_user: this.api.currentUser()?.username ?? '',
          };
          this.messages.push(msg);
          localStorage.setItem(this.messageCacheKey(this.selectedUser!.id), JSON.stringify(this.messages));
          this.messageContent = '';
          this.clearFiles();
          this.scrollToBottom();
        },
      });
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    const remaining = 10 - this.selectedFiles.length;
    for (let i = 0; i < Math.min(input.files.length, remaining); i++) {
      this.selectedFiles.push(input.files[i]);
      const reader = new FileReader();
      reader.onload = (e) => this.previews.push(e.target!.result as string);
      reader.readAsDataURL(input.files[i]);
    }
    input.value = '';
  }

  removeFile(index: number) {
    this.selectedFiles.splice(index, 1);
    this.previews.splice(index, 1);
  }

  private clearFiles() {
    this.selectedFiles = [];
    this.previews = [];
  }

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;
  triggerFileInput() {
    this.fileInputRef?.nativeElement.click();
  }

  openImage(url: string) {
    window.open(url, '_blank');
  }

  encodeURI(url: string): string {
    return encodeURIComponent(url);
  }

  // Group chat methods
  selectGroup(group: GroupChat) {
    this.selectedGroup = group;
    this.selectedUser = null;
    this.showMobileChat = true;
    this.router.navigate(['/chat', 'group', group.id]);

    this.api.getGroupMessages(group.id).subscribe((msgs: Message[]) => {
      this.messages = msgs;
      this.scrollToBottom();
    });
  }

  createGroup() {
    if (!this.newGroupName.trim()) return;
    this.api.createGroupChat(this.newGroupName.trim()).subscribe({
      next: () => {
        this.showCreateGroup = false;
        this.newGroupName = '';
        this.loadGroupChats();
      },
    });
  }

  loadGroupChats() {
    this.api.getGroupChats().subscribe((groups: GroupChat[]) => {
      this.groupChats = groups;
      const groupId = this.route.snapshot.paramMap.get('groupId');
      if (groupId && !this.selectedGroup) {
        this.resolvePendingGroupChat(Number(groupId));
      }
    });
  }

  loadGroupInfo() {
    if (!this.selectedGroup) return;
    this.api.getGroupChat(this.selectedGroup.id).subscribe((res) => {
      this.groupMembers = res.members;
      this.showGroupInfo = true;
    });
  }

  createInvite() {
    if (!this.selectedGroup) return;
    this.inviteToken = '';
    this.copied = false;
    this.api.createGroupInvite(this.selectedGroup.id).subscribe({
      next: (res) => {
        this.inviteToken = res.token;
        const baseUrl = window.location.origin;
        this.inviteUrl = `${baseUrl}/join-group?token=${res.token}`;
      },
    });
  }

  copyInviteLink() {
    navigator.clipboard.writeText(this.inviteUrl).then(() => {
      this.copied = true;
      setTimeout(() => this.copied = false, 2000);
    });
  }

  private resolvePendingGroupChat(groupId: number) {
    const group = this.groupChats.find((g) => g.id === groupId);
    if (group) {
      this.selectGroup(group);
    }
  }
}
