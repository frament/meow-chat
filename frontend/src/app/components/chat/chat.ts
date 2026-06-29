import { Component, OnInit, OnDestroy, ViewChild, ElementRef, signal, computed, HostListener } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, firstValueFrom, fromEvent } from 'rxjs';
import { HttpEventType } from '@angular/common/http';
import { filter } from 'rxjs/operators';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService, User, Message, MsgType, GroupChat, GroupMember, GiphyResult } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { KeyboardService } from '../../services/keyboard.service';
import { GifPickerComponent } from './gif-picker/gif-picker';
import { StickerPickerComponent } from './sticker-picker/sticker-picker';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [DatePipe, FormsModule, GifPickerComponent, StickerPickerComponent],
  template: `
    <input type="file" #fileInput (change)="onFileSelected($event)" accept="image/jpeg,image/png,image/gif,image/webp" multiple style="display:none;">
    <!-- Desktop -->
    <div class="hidden md:flex gap-4 h-[calc(100vh-6rem)]">
      <div class="w-72 card p-3 overflow-y-auto shrink-0">
        <!-- Search -->
        <div style="position:relative;margin-bottom:8px;">
          <input type="text" [(ngModel)]="searchQuery" (input)="onSearchInput()" placeholder="Поиск пользователей..."
            style="width:100%;box-sizing:border-box;height:34px;padding-left:30px;font-size:13px;">
          <svg style="position:absolute;left:8px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-tertiary);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          @if (searchQuery && searchResults) {
            <button (click)="clearSearch()" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:12px;padding:2px;">✕</button>
          }
        </div>
        @if (searchQuery && searchResults) {
          <div style="margin-bottom:8px;">
            @if (searchResults.length === 0) {
              <p class="text-xs" style="color:var(--text-tertiary);padding:4px 0;">Ничего не найдено</p>
            } @else {
              <h3 class="section-label" style="margin-bottom:8px;">Результаты поиска</h3>
              @for (user of searchResults; track user.id) {
                <div class="flex items-center gap-2 p-2 rounded-lg" style="margin-bottom:4px;">
                  @if (user.avatar_url) {
                    <img [src]="user.avatar_url" class="w-8 h-8 rounded-full object-cover shrink-0">
                  } @else {
                    <div class="flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold shrink-0"
                      style="background:var(--avatar-bg);color:var(--avatar-text);">{{ user.username[0] }}</div>
                  }
                  <span class="flex-1 text-sm truncate" style="color:var(--text-primary);">{{ user.username }}</span>
                  <button (click)="sendFriendReq(user.id, $event)" [disabled]="sendingFriendReq === user.id"
                    class="text-xs shrink-0" style="padding:4px 10px;border-radius:var(--radius-sm);border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-weight:500;">
                    {{ sendingFriendReq === user.id ? '...' : 'В друзья' }}
                  </button>
                </div>
              }
            }
          </div>
          <div class="divider" style="margin:8px 0;"></div>
        }
        <!-- Incoming friend requests -->
        @if (incomingRequests.length > 0) {
          <div style="margin-bottom:8px;">
            <h3 class="section-label" style="margin-bottom:8px;">Заявки в друзья</h3>
            @for (req of incomingRequests; track req.id) {
              <div class="flex items-center gap-2 p-2 rounded-lg" style="margin-bottom:4px;background:var(--accent-light);">
                @if (req.avatar_url) {
                  <img [src]="req.avatar_url" class="w-8 h-8 rounded-full object-cover shrink-0">
                } @else {
                  <div class="flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold shrink-0"
                    style="background:var(--avatar-bg);color:var(--avatar-text);">{{ req.username[0] }}</div>
                }
                <span class="flex-1 text-sm truncate" style="color:var(--text-primary);">{{ req.username }}</span>
                <button (click)="acceptFriendReq(req.id, $event)" class="text-xs shrink-0"
                  style="padding:4px 8px;border-radius:var(--radius-sm);border:none;background:#27ae60;color:white;cursor:pointer;font-weight:500;">✓</button>
                <button (click)="rejectFriendReq(req.id, $event)" class="text-xs shrink-0"
                  style="padding:4px 8px;border-radius:var(--radius-sm);border:1px solid var(--border-default);background:transparent;color:var(--text-tertiary);cursor:pointer;">✕</button>
              </div>
            }
          </div>
          <div class="divider" style="margin:8px 0;"></div>
        }
        <div class="flex items-center justify-between" style="margin-bottom:8px;">
          <h3 class="section-label" style="margin:0;">Групповые чаты</h3>
           <button (click)="showCreateGroup = true"
            style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:white;cursor:pointer;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
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
          <h3 class="section-label" style="margin-bottom:12px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="display:inline;vertical-align:middle;margin-right:2px;"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg> Закреплённые</h3>
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
              <button (click)="togglePin(user.id, $event)" class="p-1 text-xs" style="color:var(--text-tertiary);" title="Открепить"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg></button>
            </div>
          }
          <div class="divider" style="margin:8px 0;"></div>
        }

        <h3 class="section-label" style="margin-bottom:12px;">Друзья</h3>
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
            <button (click)="togglePin(user.id, $event)" class="p-1 text-xs" style="color:var(--text-tertiary);" title="Закрепить"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg></button>
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
              style="margin-left:auto;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:none;border-radius:var(--radius-sm);background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:14px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></button>
          </div>
          }
          @if (selectedUser) {
          <div class="flex items-center gap-3 px-4 py-3" style="border-bottom:1px solid var(--divider);">
            <h3 class="font-medium" style="color:var(--text-primary);">{{ selectedUser.username }}</h3>
          </div>
          }

          <div #scrollContainerDesktop class="flex-1 overflow-y-auto" style="min-height:0;">
            <div class="p-4" style="display:flex;flex-direction:column;gap:8px;">
              @for (item of displayMessages; track $index) {
                @if ($any(item)._divider) {
                  <div class="unread-divider"><span>Новые сообщения</span></div>
                } @else {
                  <div class="flex" [class.justify-end]="$any(item).from_user_id === currentUserId">
                    <div [class.chat-message-outgoing]="$any(item).from_user_id === currentUserId"
                      [class.chat-message-incoming]="$any(item).from_user_id !== currentUserId">
                      @if (selectedGroup && $any(item).from_user_id !== currentUserId) {
                        <p class="text-xs font-medium mb-1" style="color:var(--accent);">{{ $any(item).from_user }}</p>
                      }
                      @if (($any(item).msg_type || 'text') === 'sticker') {
                        <div class="px-2 py-1">
                          <img [src]="$any(item).sticker_url" class="w-24 h-24 object-contain rounded-lg">
                        </div>
                       } @else if (($any(item).msg_type || 'text') === 'gif') {
                        <img [src]="$any(item).content" class="max-w-[200px] max-h-[200px] rounded-lg object-cover">
                       } @else if (($any(item).msg_type || 'text') === 'poll') {
                        @let poll = $any(item).poll;
                        <div class="flex flex-col gap-2 px-3 py-2 min-w-[220px]">
                          <span class="text-sm font-medium">{{ $any(item).content || 'Poll' }}</span>
                          @if (poll && poll.options) {
                          <div class="flex flex-col gap-1.5 mt-1">
                            @for (opt of poll.options; track opt.id) {
                            <button (click)="castVote(poll.id, opt.id)"
                              [style.borderColor]="opt.voted ? 'var(--accent)' : 'var(--divider)'"
                              [style.background]="opt.voted ? 'var(--accent-light)' : 'transparent'"
                              class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs w-full text-left transition-all"
                              style="border:1px solid;cursor:pointer;">
                              <span class="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-[10px]"
                                [style.background]="opt.voted ? 'var(--accent)' : 'var(--bg-overlay)'"
                                [style.color]="opt.voted ? 'white' : 'var(--text-tertiary)'">
                                {{ opt.vote_count }}
                              </span>
                              <span class="flex-1" style="color:var(--text-primary);">{{ opt.text }}</span>
                              @if (opt.voted) {
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              }
                            </button>
                            }
                          </div>
                          <span class="text-xs opacity-50">
                            @let tv = computeTotalVotes(poll);
                            {{ tv }} голос{{ tv === 1 ? '' : (tv >= 2 && tv <= 4 ? 'а' : 'ов') }}
                          </span>
                          }
                        </div>
                      } @else {
                        @if ($any(item).content) { <p>{{ $any(item).content }}</p> }
                        @if ($any(item).images && $any(item).images.length > 0) {
                        <div class="flex flex-wrap gap-1 mt-1">
                          @for (img of $any(item).images; track img.id || $index) {
                          <img [src]="img.image_url" class="max-w-[200px] max-h-[200px] rounded-lg object-cover cursor-pointer"
                          (click)="openImage(img.image_url)">
                          }
                        </div>
                        }
                      }
                      @if ($any(item).pending && uploading()) {
                      <div style="height:3px;background:var(--divider);border-radius:2px;margin-top:6px;overflow:hidden;">
                        <div style="height:100%;width:{{uploadProgress()}}%;background:var(--accent-gradient);transition:width 0.2s;"></div>
                      </div>
                      }
                      <p class="text-[10px] mt-1 opacity-70" [class.text-right]="item.from_user_id === currentUserId">
                        {{ $any(item).created_at | date:'HH:mm' }}
                        @if ($any(item).pending) {
                          <span style="margin-left:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
                        } @else if ($any(item).from_user_id === currentUserId) {
                          <span style="margin-left:4px;color:var(--text-tertiary);">
                            @if ($any(item).is_read) {
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23 7l-2-2-9 9-4-4-2 2 6 6z"/></svg>
                            } @else {
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            }
                          </span>
                        }
                      </p>
                    </div>
                  </div>
                }
              }
            </div>
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
            @if (messageType === 'poll') {
            <div class="flex flex-col gap-2 px-4 py-2" style="border-top:1px solid var(--divider);">
              <input type="text" [(ngModel)]="messageContent" placeholder="Вопрос опроса..."
                style="height:36px;box-sizing:border-box;">
              @for (opt of pollOptions; track trackPollOption($index, opt); let i = $index) {
              <div class="flex items-center gap-2">
                <input type="text" [(ngModel)]="pollOptions[i]" [placeholder]="'Вариант ' + (i+1)"
                  style="flex:1;height:32px;box-sizing:border-box;font-size:13px;">
                @if (pollOptions.length > 2) {
                <button (click)="removePollOption(i)" class="w-6 h-6 flex items-center justify-center text-xs rounded-full"
                  style="border:none;background:transparent;color:var(--text-tertiary);cursor:pointer;">✕</button>
                }
              </div>
              }
              <div class="flex items-center gap-2">
                <button (click)="addPollOption()" class="text-xs"
                  style="padding:4px 10px;border:1px dashed var(--divider);border-radius:var(--radius-sm);background:transparent;color:var(--text-tertiary);cursor:pointer;">+ Добавить вариант</button>
                <label class="flex items-center gap-1 text-xs" style="color:var(--text-tertiary);cursor:pointer;">
                  <input type="checkbox" [(ngModel)]="pollMultiple" style="cursor:pointer;">
                  Несколько вариантов
                </label>
              </div>
            </div>
            } @else {
            <div class="chat-input" style="border-top:1px solid var(--divider);padding:12px 16px;display:flex;gap:8px;position:relative;">

              <div class="type-menu-container" style="position:relative;">
                <button (click)="showTypeMenu = !showTypeMenu"
                  [title]="currentTypeLabel"
                  style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:transparent;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);font-family:inherit;">
                  <span [innerHTML]="currentTypeIcon"></span>
                </button>
                @if (showTypeMenu) {
                  <div style="position:absolute;bottom:calc(100% + 8px);left:0;z-index:50;min-width:180px;padding:6px;border-radius:14px;background:var(--bg-elevated);border:1px solid var(--border-default);box-shadow:var(--shadow-lg);">
                    @for (t of visibleMsgTypes; track t.id) {
                      @if (t.id === 'sticker') {
                        <button (click)="openStickerPicker()"
                          style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;text-align:left;transition:all 0.1s;color:var(--text-primary);">
                          <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
                          <span>{{ t.label }}</span>
                        </button>
                      } @else if (t.id === 'gif') {
                        @if (giphyHasKey) {
                          <button (click)="openGifPicker()"
                            style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;text-align:left;transition:all 0.1s;color:var(--text-primary);">
                            <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
                            <span>{{ t.label }}</span>
                          </button>
                        } @else {
                          <button disabled
                            title="Настройте Giphy API Key в админке"
                            style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;background:transparent;cursor:not-allowed;font-size:13px;font-weight:500;color:var(--text-primary);font-family:inherit;text-align:left;opacity:0.4;">
                            <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
                            <span>{{ t.label }}</span>
                          </button>
                        }
                      } @else {
                        <button (click)="selectType(t.id)"
                          [style.background]="messageType === t.id ? 'var(--accent-light)' : 'transparent'"
                          [style.color]="messageType === t.id ? 'var(--accent)' : 'var(--text-primary)'"
                          style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;text-align:left;transition:all 0.1s;">
                          <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
                          <span>{{ t.label }}</span>
                        </button>
                      }
                    }
                  </div>
                }
              </div>
              <input type="text" [(ngModel)]="messageContent" (keyup.enter)="sendMessage()" (paste)="onPaste($event)"
              style="flex:1;height:36px;box-sizing:border-box;"
              [placeholder]="messageType === 'text' ? 'Напишите сообщение...' : 'Подпись к изображению...'">
              <button (touchstart)="sendMessage()" (click)="sendMessage()" title="Отправить"
              style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:white;cursor:pointer;transition:all 0.2s;">
              <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              </button>
            </div>
            }
          </div>
        }
      </div>
    </div>

    <!-- Mobile -->
    <div class="md:hidden">
      @if (!showMobileChat) {
        <div class="px-4 py-6 pb-20 space-y-2">
          <!-- Mobile search -->
          <div style="position:relative;margin-bottom:8px;">
            <input type="text" [(ngModel)]="searchQuery" (input)="onSearchInput()" placeholder="Поиск пользователей..."
              style="width:100%;box-sizing:border-box;height:38px;padding-left:34px;font-size:14px;border-radius:12px;">
            <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--text-tertiary);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            @if (searchQuery && searchResults) {
              <button (click)="clearSearch()" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:14px;padding:2px;">✕</button>
            }
          </div>
          @if (searchQuery && searchResults) {
            <div>
              @if (searchResults.length === 0) {
                <p class="text-xs" style="color:var(--text-tertiary);padding:8px 4px;">Ничего не найдено</p>
              } @else {
                <h3 class="section-label" style="margin-bottom:8px;">Результаты поиска</h3>
                @for (user of searchResults; track user.id) {
                  <div class="card flex items-center gap-3 p-3 rounded-lg" style="margin-bottom:6px;">
                    <div class="shrink-0">
                      @if (user.avatar_url) {
                        <img [src]="user.avatar_url" class="w-10 h-10 rounded-full object-cover">
                      } @else {
                        <div class="flex items-center justify-center w-10 h-10 rounded-full text-sm font-semibold"
                          style="background:var(--avatar-bg);color:var(--avatar-text);">{{ user.username[0] }}</div>
                      }
                    </div>
                    <span class="flex-1 text-sm font-medium" style="color:var(--text-primary);">{{ user.username }}</span>
                    <button (click)="sendFriendReq(user.id, $event)" [disabled]="sendingFriendReq === user.id"
                      class="text-xs shrink-0" style="padding:6px 14px;border-radius:var(--radius-sm);border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-weight:500;">
                      {{ sendingFriendReq === user.id ? '...' : 'В друзья' }}
                    </button>
                  </div>
                }
              }
            </div>
            <div class="divider"></div>
          }
          <!-- Mobile incoming requests -->
          @if (incomingRequests.length > 0) {
            <div>
              <h3 class="section-label" style="margin-bottom:8px;">Заявки в друзья</h3>
              @for (req of incomingRequests; track req.id) {
                <div class="card flex items-center gap-3 p-3 rounded-lg" style="background:var(--accent-light);margin-bottom:6px;">
                  <div class="shrink-0">
                    @if (req.avatar_url) {
                      <img [src]="req.avatar_url" class="w-10 h-10 rounded-full object-cover">
                    } @else {
                      <div class="flex items-center justify-center w-10 h-10 rounded-full text-sm font-semibold"
                        style="background:var(--avatar-bg);color:var(--avatar-text);">{{ req.username[0] }}</div>
                    }
                  </div>
                  <span class="flex-1 text-sm font-medium" style="color:var(--text-primary);">{{ req.username }}</span>
                  <button (click)="acceptFriendReq(req.id, $event)" class="text-xs shrink-0"
                    style="padding:6px 12px;border-radius:var(--radius-sm);border:none;background:#27ae60;color:white;cursor:pointer;font-weight:500;">✓</button>
                  <button (click)="rejectFriendReq(req.id, $event)" class="text-xs shrink-0"
                    style="padding:6px 12px;border-radius:var(--radius-sm);border:1px solid var(--border-default);background:transparent;color:var(--text-tertiary);cursor:pointer;">✕</button>
                </div>
              }
            </div>
            <div class="divider"></div>
          }
          <div class="flex items-center justify-between" style="margin-bottom:8px;">
            <h3 class="section-label" style="margin:0;">Групповые чаты</h3>
            <button (click)="showCreateGroup = true"
              style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:white;cursor:pointer;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
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
            <h3 class="section-label" style="margin-bottom:12px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="display:inline;vertical-align:middle;margin-right:2px;"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg> Закреплённые</h3>
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

          <h3 class="section-label" style="margin-bottom:12px;">Друзья</h3>
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
        <div class="flex flex-col fixed inset-x-0 top-14 z-30" [style.height]="mobileChatHeight()">
          <div #scrollContainerMobile class="flex-1 overflow-y-auto" style="min-height:0;">
            <div class="p-4" style="display:flex;flex-direction:column;gap:8px;">
              @for (item of displayMessages; track $index) {
                @if ($any(item)._divider) {
                  <div class="unread-divider"><span>Новые сообщения</span></div>
                } @else {
                  <div class="flex" [class.justify-end]="$any(item).from_user_id === currentUserId">
                    <div [class.chat-message-outgoing]="$any(item).from_user_id === currentUserId"
                      [class.chat-message-incoming]="$any(item).from_user_id !== currentUserId">
                      @if (selectedGroup && $any(item).from_user_id !== currentUserId) {
                        <p class="text-xs font-medium mb-1" style="color:var(--accent);">{{ $any(item).from_user }}</p>
                      }
                      @if (($any(item).msg_type || 'text') === 'sticker') {
                        <div class="px-2 py-1">
                          <img [src]="$any(item).sticker_url" class="w-24 h-24 object-contain rounded-lg">
                        </div>
                       } @else if (($any(item).msg_type || 'text') === 'gif') {
                        <img [src]="$any(item).content" class="max-w-[200px] max-h-[200px] rounded-lg object-cover">
                       } @else if (($any(item).msg_type || 'text') === 'poll') {
                        @let poll = $any(item).poll;
                        <div class="flex flex-col gap-2 px-3 py-2 min-w-[220px]">
                          <span class="text-sm font-medium">{{ $any(item).content || 'Poll' }}</span>
                          @if (poll && poll.options) {
                          <div class="flex flex-col gap-1.5 mt-1">
                            @for (opt of poll.options; track opt.id) {
                            <button (click)="castVote(poll.id, opt.id)"
                              [style.borderColor]="opt.voted ? 'var(--accent)' : 'var(--divider)'"
                              [style.background]="opt.voted ? 'var(--accent-light)' : 'transparent'"
                              class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs w-full text-left transition-all"
                              style="border:1px solid;cursor:pointer;">
                              <span class="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-[10px]"
                                [style.background]="opt.voted ? 'var(--accent)' : 'var(--bg-overlay)'"
                                [style.color]="opt.voted ? 'white' : 'var(--text-tertiary)'">
                                {{ opt.vote_count }}
                              </span>
                              <span class="flex-1" style="color:var(--text-primary);">{{ opt.text }}</span>
                              @if (opt.voted) {
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              }
                            </button>
                            }
                          </div>
                          <span class="text-xs opacity-50">
                            @let tv = computeTotalVotes(poll);
                            {{ tv }} голос{{ tv === 1 ? '' : (tv >= 2 && tv <= 4 ? 'а' : 'ов') }}
                          </span>
                          }
                        </div>
                      } @else {
                        @if ($any(item).content) { <p>{{ $any(item).content }}</p> }
                        @if ($any(item).images && $any(item).images.length > 0) {
                        <div class="flex flex-wrap gap-1 mt-1">
                          @for (img of $any(item).images; track img.id || $index) {
                          <img [src]="img.image_url" class="max-w-[200px] max-h-[200px] rounded-lg object-cover cursor-pointer"
                          (click)="openImage(img.image_url)">
                          }
                        </div>
                        }
                      }
                      @if ($any(item).pending && uploading()) {
                      <div style="height:3px;background:var(--divider);border-radius:2px;margin-top:6px;overflow:hidden;">
                        <div style="height:100%;width:{{uploadProgress()}}%;background:var(--accent-gradient);transition:width 0.2s;"></div>
                      </div>
                      }
                      <p class="text-[10px] mt-1 opacity-70" [class.text-right]="item.from_user_id === currentUserId">
                        {{ $any(item).created_at | date:'HH:mm' }}
                        @if ($any(item).pending) {
                          <span style="margin-left:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
                        } @else if ($any(item).from_user_id === currentUserId) {
                          <span style="margin-left:4px;color:var(--text-tertiary);">
                            @if ($any(item).is_read) {
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23 7l-2-2-9 9-4-4-2 2 6 6z"/></svg>
                            } @else {
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            }
                          </span>
                        }
                      </p>
                    </div>
                  </div>
                }
              }
            </div>
          </div>

          <!-- Mobile chat input -->
          <div class="shrink-0">
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
            @if (messageType === 'poll') {
            <div class="flex flex-col gap-2 px-4 py-2" style="border-top:1px solid var(--divider);">
              <input type="text" [(ngModel)]="messageContent" placeholder="Вопрос опроса..."
                style="height:36px;box-sizing:border-box;">
              @for (opt of pollOptions; track trackPollOption($index, opt); let i = $index) {
              <div class="flex items-center gap-2">
                <input type="text" [(ngModel)]="pollOptions[i]" [placeholder]="'Вариант ' + (i+1)"
                  style="flex:1;height:32px;box-sizing:border-box;font-size:13px;">
                @if (pollOptions.length > 2) {
                <button (click)="removePollOption(i)" class="w-6 h-6 flex items-center justify-center text-xs rounded-full"
                  style="border:none;background:transparent;color:var(--text-tertiary);cursor:pointer;">✕</button>
                }
              </div>
              }
              <div class="flex items-center gap-2">
                <button (click)="addPollOption()" class="text-xs"
                  style="padding:4px 10px;border:1px dashed var(--divider);border-radius:var(--radius-sm);background:transparent;color:var(--text-tertiary);cursor:pointer;">+ Добавить вариант</button>
                <label class="flex items-center gap-1 text-xs" style="color:var(--text-tertiary);cursor:pointer;">
                  <input type="checkbox" [(ngModel)]="pollMultiple" style="cursor:pointer;">
                  Несколько вариантов
                </label>
              </div>
            </div>
            } @else {
            <div class="chat-input" style="border-top:1px solid var(--divider);padding:12px 16px;display:flex;gap:8px;position:relative;">

              <div class="type-menu-container" style="position:relative;">
                <button (click)="showTypeMenu = !showTypeMenu"
                  [title]="currentTypeLabel"
                  style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:transparent;cursor:pointer;font-size:14px;font-weight:500;color:var(--text-primary);font-family:inherit;">
                  <span [innerHTML]="currentTypeIcon"></span>
                </button>
                @if (showTypeMenu) {
                  <div style="position:absolute;bottom:calc(100% + 8px);left:0;z-index:50;min-width:180px;padding:6px;border-radius:14px;background:var(--bg-elevated);border:1px solid var(--border-default);box-shadow:var(--shadow-lg);">
                    @for (t of visibleMsgTypes; track t.id) {
                      @if (t.id === 'sticker') {
                        <button (click)="openStickerPicker()"
                          style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;text-align:left;transition:all 0.1s;color:var(--text-primary);">
                          <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
                          <span>{{ t.label }}</span>
                        </button>
                      } @else if (t.id === 'gif') {
                        @if (giphyHasKey) {
                          <button (click)="openGifPicker()"
                            style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;text-align:left;transition:all 0.1s;color:var(--text-primary);">
                            <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
                            <span>{{ t.label }}</span>
                          </button>
                        } @else {
                          <button disabled
                            title="Настройте Giphy API Key в админке"
                            style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;background:transparent;cursor:not-allowed;font-size:13px;font-weight:500;color:var(--text-primary);font-family:inherit;text-align:left;opacity:0.4;">
                            <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
                            <span>{{ t.label }}</span>
                          </button>
                        }
                      } @else {
                        <button (click)="selectType(t.id)"
                          [style.background]="messageType === t.id ? 'var(--accent-light)' : 'transparent'"
                          [style.color]="messageType === t.id ? 'var(--accent)' : 'var(--text-primary)'"
                          style="display:flex;align-items:center;gap:10px;width:100%;padding:6px 10px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;text-align:left;transition:all 0.1s;">
                          <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" [innerHTML]="t.icon"></span>
                          <span>{{ t.label }}</span>
                        </button>
                      }
                    }
                  </div>
                }
              </div>
              <input type="text" [(ngModel)]="messageContent" (keyup.enter)="sendMessage()" (paste)="onPaste($event)"
              style="flex:1;height:36px;box-sizing:border-box;"
              [placeholder]="messageType === 'text' ? 'Напишите сообщение...' : 'Подпись к изображению...'">
              <button (touchstart)="sendMessage()" (click)="sendMessage()" title="Отправить"
              style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:white;cursor:pointer;transition:all 0.2s;">
              <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              </button>
            </div>
            }
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

        <div class="flex justify-between items-center">
          @if (selectedGroup && selectedGroup.created_by === currentUserId) {
          <button (click)="deleteCurrentGroup()"
            style="padding:8px 16px;border-radius:var(--radius-sm);border:1px solid #e74c3c;background:transparent;color:#e74c3c;cursor:pointer;font-size:13px;">
            Удалить группу
          </button>
          }
          <button (click)="showGroupInfo = false"
            style="padding:8px 16px;border-radius:var(--radius-sm);border:1px solid var(--divider);background:transparent;color:var(--text-primary);cursor:pointer;">Закрыть</button>
        </div>
      </div>
    </div>
    }

    @if (showGifPicker) {
      <app-gif-picker (gifSelected)="onGifSelected($event)" />
    }
    @if (showStickerPicker) {
      <app-sticker-picker (stickerSelected)="onStickerSelected($event)" />
    }
  `,
})
export class ChatComponent implements OnInit, OnDestroy {
  users: User[] = [];
  selectedUser: User | null = null;
  messages: Message[] = [];
  messageContent = '';
  messageType: MsgType = 'text';
  msgTypes: { id: MsgType; icon: SafeHtml; label: string }[] = [];

  pollOptions: string[] = ['', ''];
  pollMultiple = false;
  showTypeMenu = false;
  showGifPicker = false;
  showStickerPicker = false;
  mobileChatHeight = computed(() => {
    if (this.keyboardService.isKeyboardOpen()) {
      return 'calc(100dvh - 3.5rem)';
    }
    return 'calc(100dvh - 7rem - env(safe-area-inset-bottom, 0px))';
  });

  openGifPicker() {
    if (!this.giphyHasKey) return;
    this.showTypeMenu = false;
    this.showGifPicker = true;
  }

  openStickerPicker() {
    this.showTypeMenu = false;
    this.showStickerPicker = true;
  }

  onStickerSelected(sticker: { id: number; image_url: string } | undefined) {
    this.showStickerPicker = false;
    if (!sticker) return;
    this.messageContent = String(sticker.id);
    this.messageType = 'sticker';
    this.sendMessage();
  }

  onGifSelected(gif: GiphyResult | undefined) {
    this.showGifPicker = false;
    if (!gif) return;
    this.messageContent = gif.url;
    this.messageType = 'gif';
    this.sendMessage();
  }

  get currentTypeIcon(): SafeHtml {
    return this.msgTypes.find(t => t.id === this.messageType)?.icon || this.sanitizer.bypassSecurityTrustHtml('Aa');
  }

  get currentTypeLabel(): string {
    return this.msgTypes.find(t => t.id === this.messageType)?.label || '';
  }

  selectType(id: MsgType) {
    this.messageType = id;
    this.showTypeMenu = false;
    if (id === 'image') {
      this.triggerFileInput();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (this.showTypeMenu && !target.closest('.type-menu-container')) {
      this.showTypeMenu = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscapePress() {
    this.showTypeMenu = false;
  }

  get visibleMsgTypes(): { id: MsgType; icon: SafeHtml; label: string }[] {
    if (!this.selectedGroup) {
      return this.msgTypes.filter(t => t.id !== 'poll');
    }
    return this.msgTypes;
  }
  selectedFiles: File[] = [];
  previews: string[] = [];
  currentUserId = 0;
  searchQuery = '';
  searchResults: User[] | null = null;
  incomingRequests: any[] = [];
  sendingFriendReq: number | null = null;
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
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
  uploading = signal(false);
  uploadProgress = signal(0);

  @ViewChild('scrollContainerDesktop', { read: ElementRef }) scrollContainerDesktop?: ElementRef<HTMLElement>;
  @ViewChild('scrollContainerMobile', { read: ElementRef }) scrollContainerMobile?: ElementRef<HTMLElement>;

  get displayMessages(): (Message | { _divider: true })[] {
    if (this.unreadDividerIdx < 0) return this.messages;
    const items: (Message | { _divider: true })[] = [];
    for (let i = 0; i < this.messages.length; i++) {
      if (i === this.unreadDividerIdx) {
        items.push({ _divider: true });
      }
      items.push(this.messages[i]);
    }
    return items;
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.scrollContainerDesktop?.nativeElement.scrollTo({ top: this.scrollContainerDesktop.nativeElement.scrollHeight, behavior: 'auto' });
        this.scrollContainerMobile?.nativeElement.scrollTo({ top: this.scrollContainerMobile.nativeElement.scrollHeight, behavior: 'auto' });
      });
    });
  }

  giphyHasKey = false;

  constructor(
    protected api: ApiService,
    private route: ActivatedRoute,
    protected router: Router,
    private crypto: CryptoService,
    private sanitizer: DomSanitizer,
    private keyboardService: KeyboardService,
  ) {
    this.msgTypes = this.buildMsgTypes();
    this.api.getGiphyKey().subscribe({
      next: (res) => this.giphyHasKey = res.has_key,
    });
  }

  private buildMsgTypes(): { id: MsgType; icon: SafeHtml; label: string }[] {
    const raw: { id: MsgType; icon: string; label: string }[] = [
      { id: 'text', icon: 'Aa', label: 'Текст' },
      { id: 'image', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>', label: 'Фото' },
      { id: 'sticker', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>', label: 'Стикер' },
      { id: 'gif', icon: '<span style="font-weight:800;font-size:11px;">GIF</span>', label: 'GIF' },
      { id: 'poll', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>', label: 'Опрос' },
    ];
    return raw.map(t => ({ ...t, icon: this.sanitizer.bypassSecurityTrustHtml(t.icon) }));
  }

  private e2eeReady = false;

  ngOnInit() {
    this.currentUserId = this.api.currentUser()?.id ?? 0;

    this.crypto.init().then(() => {
      this.e2eeReady = true;
    });

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
    this.loadIncomingRequests();
    this.listenWsOnlineEvents();

    this.subscriptions.push(
      this.api.wsMessages$.subscribe(async (data: any) => {
        if (data.type === 'message' && this.selectedUser && (data.from === this.selectedUser.id || data.from === this.currentUserId)) {
          // Skip if this message already exists (e.g., finalized from optimistic send in another tab)
          if (data.id && this.messages.some(m => m.id === data.id)) {
            return;
          }
          let content = data.content;
          if (data.encrypted_content && data.encrypted_iv && this.e2eeReady) {
            const decrypted = await this.crypto.decrypt(this.currentUserId, data.from, data.encrypted_content, data.encrypted_iv);
            if (decrypted !== null) content = decrypted;
          }
          const msg: Message = {
            id: data.id || Date.now(),
            from_user_id: data.from,
            to_user_id: data.to || this.currentUserId,
            content: content,
            msg_type: data.msg_type || 'text',
            is_read: data.is_read,
            created_at: data.created_at || new Date().toISOString(),
            from_user: data.from_name || this.selectedUser.username,
            images: data.images ? data.images.map((url: string) => ({ id: 0, image_url: url })) : undefined,
            poll: data.poll || undefined,
          };
          this.messages.push(msg);
          this.messages = [...this.messages];
          localStorage.setItem(this.messageCacheKey(this.selectedUser.id), JSON.stringify(this.messages));
          this.scrollToBottom();
        }
        if (data.type === 'group_message' && this.selectedGroup && data.group_id === this.selectedGroup.id) {
          // Skip if this message already exists (e.g., finalized from optimistic send)
          if (data.id && this.messages.some(m => m.id === data.id)) {
            return;
          }
          let content = data.content;
          if (data.encrypted_content && data.encrypted_iv && this.e2eeReady) {
            const decrypted = await this.crypto.decryptGroupMessage(data.group_id, data.encrypted_content, data.encrypted_iv);
            if (decrypted !== null) content = decrypted;
          }
          const msg: Message = {
            id: data.id || Date.now(),
            from_user_id: data.from,
            to_user_id: 0,
            group_chat_id: data.group_id,
            content: content,
            msg_type: data.msg_type || 'text',
            created_at: data.created_at || new Date().toISOString(),
            from_user: data.from_name || '',
            images: data.images ? data.images.map((url: string) => ({ id: 0, image_url: url })) : undefined,
            poll: data.poll || undefined,
          };
          this.messages.push(msg);
          this.messages = [...this.messages];
          this.scrollToBottom();
        }
        if (data.type === 'poll_update') {
          const pollId = data.poll_id;
          const msgId = data.message_id || data.group_message_id;
          const idx = this.messages.findIndex(m => (m as any).poll?.id === pollId);
          if (idx >= 0) {
            (this.messages[idx] as any).poll = {
              id: pollId,
              options: data.options,
              total_votes: data.total_votes,
              multiple: data.multiple,
            };
            this.messages = [...this.messages];
          }
        }
        if (data.type === 'friend_request') {
          this.loadIncomingRequests();
        }
        if (data.type === 'friend_request_accepted') {
          this.loadFromServer();
          this.loadIncomingRequests();
        }
        if (data.type === 'group_joined') {
          this.loadGroupChats();
          const groupId = data.group_chat_id;
          if (groupId && !this.selectedGroup) {
            this.resolvePendingGroupChat(groupId);
          }
        }
      })
    );

    // Multi-tab: reload messages when tab becomes visible (catches up on messages
    // sent from other tabs while this tab was in background)
    this.subscriptions.push(
      fromEvent(document, 'visibilitychange').subscribe(() => {
        const user = this.selectedUser;
        if (document.visibilityState === 'visible' && user && !this.selectedGroup) {
          this.api.getMessages(this.currentUserId, user.id).subscribe(async (msgs: Message[]) => {
            const existingIds = new Set(this.messages.map(m => m.id));
            for (const msg of msgs) {
              if (!existingIds.has(msg.id)) {
                const decrypted = await this.decryptMsg(msg, user.id);
                this.messages.push(decrypted);
              }
            }
            if (msgs.length > 0) {
              this.messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
              localStorage.setItem(this.messageCacheKey(user.id), JSON.stringify(this.messages));
              this.scrollToBottom();
            }
          });
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
    this.api.chatHeaderInfo.set(null);
    for (const sub of this.subscriptions) sub.unsubscribe();
    if (this.boundaryTimer) clearTimeout(this.boundaryTimer);
  }

  private async decryptMsg(msg: Message, peerId: number): Promise<Message> {
    if (msg.encrypted_content && msg.encrypted_iv) {
      const decrypted = await this.crypto.decrypt(this.currentUserId, peerId, msg.encrypted_content, msg.encrypted_iv);
      if (decrypted !== null) {
        msg.content = decrypted;
      }
    }
    return msg;
  }

  private messageCacheKey(otherUserId: number): string {
    const ids = [this.currentUserId, otherUserId].sort((a, b) => a - b);
    return `cached_messages_${ids[0]}_${ids[1]}`;
  }

  selectUser(user: User) {
    this.selectedUser = user;
    this.selectedGroup = null;
    this.api.chatHeaderInfo.set({ type: 'user', id: user.id, name: user.username, avatar_url: user.avatar_url, is_admin: user.is_admin });

    const boundary = this.api.unreadBoundaries()[user.id] ?? null;
    this.api.clearUnread(user.id);

    const cached = localStorage.getItem(this.messageCacheKey(user.id));
    this.messages = cached ? JSON.parse(cached) : [];

    this.api.getMessages(this.currentUserId, user.id).subscribe(async (msgs: Message[]) => {
      for (let i = 0; i < msgs.length; i++) {
        msgs[i] = await this.decryptMsg(msgs[i], user.id);
      }
      // Merge with existing messages (e.g. optimistic sends) to avoid race conditions
      const existingIds = new Set(this.messages.map(m => m.id));
      for (const msg of msgs) {
        if (!existingIds.has(msg.id)) {
          this.messages.push(msg);
        }
      }
      this.messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      localStorage.setItem(this.messageCacheKey(user.id), JSON.stringify(this.messages));
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
      // Mark received messages as read
      const unreadIds = msgs.filter(m => m.from_user_id === user.id && !m.is_read).map(m => m.id);
      if (unreadIds.length > 0) {
        this.api.markMessagesRead(unreadIds, user.id).subscribe(() => {
          for (const m of this.messages) {
            if (unreadIds.includes(m.id)) m.is_read = true;
          }
        });
      }
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

  onSearchInput() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    const q = this.searchQuery.trim();
    if (q.length < 1) {
      this.searchResults = null;
      return;
    }
    this.searchTimeout = setTimeout(() => {
      this.api.searchUsers(q).subscribe({
        next: (users) => this.searchResults = users,
        error: () => this.searchResults = [],
      });
    }, 300);
  }

  clearSearch() {
    this.searchQuery = '';
    this.searchResults = null;
  }

  sendFriendReq(userId: number, event: MouseEvent) {
    event.stopPropagation();
    this.sendingFriendReq = userId;
    this.api.sendFriendRequest(userId).subscribe({
      next: (res) => {
        this.sendingFriendReq = null;
        if (res.auto_accepted) {
          this.loadFromServer();
        }
        // Remove from search results
        if (this.searchResults) {
          this.searchResults = this.searchResults.filter(u => u.id !== userId);
        }
      },
      error: () => {
        this.sendingFriendReq = null;
      },
    });
  }

  loadIncomingRequests() {
    this.api.getFriendRequests().subscribe({
      next: (reqs) => this.incomingRequests = reqs,
      error: () => {},
    });
  }

  acceptFriendReq(requestId: number, event: MouseEvent) {
    event.stopPropagation();
    this.api.acceptFriendRequest(requestId).subscribe({
      next: () => {
        this.loadIncomingRequests();
        this.loadFromServer();
      },
      error: () => {},
    });
  }

  rejectFriendReq(requestId: number, event: MouseEvent) {
    event.stopPropagation();
    this.api.rejectFriendRequest(requestId).subscribe({
      next: () => this.loadIncomingRequests(),
      error: () => {},
    });
  }

  private sending = false;

  async sendMessage() {
    if (this.sending) return;
    if (!this.selectedUser && !this.selectedGroup) return;
    if (!this.messageContent.trim() && this.selectedFiles.length === 0) return;
    this.sending = true;
    const type = this.messageType;

    if (type === 'poll') {
      const validOptions = this.pollOptions.filter(o => o.trim());
      if (validOptions.length < 2) {
        this.sending = false;
        return;
      }
    }

    const rawContent = this.messageContent;
    const files = [...this.selectedFiles];

    let encryptedContent: string | undefined;
    let encryptedIV: string | undefined;
    let pushPreview: string | undefined;
    let content = rawContent;

    if (this.selectedUser && this.e2eeReady) {
      const result = await this.crypto.encrypt(this.currentUserId, this.selectedUser.id, rawContent);
      if (result) {
        encryptedContent = result.encrypted;
        encryptedIV = result.iv;
        pushPreview = rawContent.length > 120 ? rawContent.slice(0, 120) + '...' : rawContent;
        content = rawContent;
      }
    }

      if (this.selectedGroup) {
        if (this.e2eeReady && rawContent) {
          const result = await this.crypto.encryptGroupMessage(this.selectedGroup.id, rawContent);
          if (result) {
            encryptedContent = result.encrypted;
            encryptedIV = result.iv;
            pushPreview = rawContent.length > 120 ? rawContent.slice(0, 120) + '...' : rawContent;
            content = rawContent;
          }
        }

        // Optimistic: add message immediately
        const tempId = Date.now();
        const optimisticMsg: Message = {
        id: tempId,
        from_user_id: this.currentUserId,
        to_user_id: 0,
        group_chat_id: this.selectedGroup.id,
        content: content,
        msg_type: type,
        created_at: new Date().toISOString(),
        from_user: this.api.currentUser()?.username ?? '',
        pending: true,
      };
      this.messages.push(optimisticMsg);
      this.messages = [...this.messages];
      this.messageContent = '';
      this.clearFiles();
      this.scrollToBottom();

      const pollOpts = type === 'poll' ? this.pollOptions.filter(o => o.trim()) : undefined;
      const hasFiles = files.length > 0;
      if (hasFiles) {
        this.uploading.set(true);
        this.uploadProgress.set(0);
        this.api.sendGroupMessageWithProgress(this.selectedGroup.id, content, files, type, encryptedContent, encryptedIV, pushPreview, pollOpts, this.pollMultiple)
          .pipe(filter(e => e.type === HttpEventType.UploadProgress || e.type === HttpEventType.Response))
          .subscribe({
            next: (event: any) => {
              if (event.type === HttpEventType.UploadProgress) {
                this.uploadProgress.set(Math.round(100 * event.loaded / event.total));
              } else if (event.type === HttpEventType.Response) {
                this.uploading.set(false);
                this.finalizeOptimistic(tempId, event.body?.id);
              }
            },
            error: () => {
              this.uploading.set(false);
              this.rollbackOptimistic(tempId);
            },
          });
      } else {
        this.api.sendGroupMessage(this.selectedGroup.id, content, files, type, encryptedContent, encryptedIV, pushPreview, pollOpts, this.pollMultiple).subscribe({
          next: (res) => this.finalizeOptimistic(tempId, res.id),
          error: () => this.rollbackOptimistic(tempId),
        });
      }
    } else if (this.selectedUser) {
      // Optimistic: add message immediately
      const tempId = Date.now();
      const optimisticMsg: Message = {
        id: tempId,
        from_user_id: this.currentUserId,
        to_user_id: this.selectedUser.id,
        content: content,
        msg_type: type,
        created_at: new Date().toISOString(),
        from_user: this.api.currentUser()?.username ?? '',
        pending: true,
      };
      this.messages.push(optimisticMsg);
      this.messages = [...this.messages];
      localStorage.setItem(this.messageCacheKey(this.selectedUser.id), JSON.stringify(this.messages));
      this.messageContent = '';
      this.clearFiles();
      this.scrollToBottom();

      const pollOpts = type === 'poll' ? this.pollOptions.filter(o => o.trim()) : undefined;
      const hasFiles = files.length > 0;
      if (hasFiles) {
        this.uploading.set(true);
        this.uploadProgress.set(0);
        this.api.sendMessageWithProgress(this.selectedUser.id, content, files, type, encryptedContent, encryptedIV, pushPreview, pollOpts, this.pollMultiple)
          .pipe(filter(e => e.type === HttpEventType.UploadProgress || e.type === HttpEventType.Response))
          .subscribe({
            next: (event: any) => {
              if (event.type === HttpEventType.UploadProgress) {
                this.uploadProgress.set(Math.round(100 * event.loaded / event.total));
              } else if (event.type === HttpEventType.Response) {
                this.uploading.set(false);
                this.finalizeOptimistic(tempId, event.body?.id);
              }
            },
            error: () => {
              this.uploading.set(false);
              this.rollbackOptimistic(tempId);
            },
          });
      } else {
        this.api.sendMessage(this.selectedUser.id, content, files, type, encryptedContent, encryptedIV, pushPreview, pollOpts, this.pollMultiple).subscribe({
          next: (res) => this.finalizeOptimistic(tempId, res.id),
          error: () => this.rollbackOptimistic(tempId),
        });
      }
    }
    if (type === 'poll' || type === 'sticker') {
      this.pollOptions = ['', ''];
      this.pollMultiple = false;
      this.messageType = 'text';
    }
  }

  private finalizeOptimistic(tempId: number, serverId?: number) {
    this.sending = false;
    const idx = this.messages.findIndex(m => m.id === tempId);
    if (idx !== -1) {
      this.messages[idx].pending = false;
      if (serverId) this.messages[idx].id = serverId;
      if (this.selectedUser) {
        localStorage.setItem(this.messageCacheKey(this.selectedUser.id), JSON.stringify(this.messages));
      }
    }
  }

  private rollbackOptimistic(tempId: number) {
    this.sending = false;
    const idx = this.messages.findIndex(m => m.id === tempId);
    if (idx !== -1) {
      this.messages.splice(idx, 1);
      if (this.selectedUser) {
        localStorage.setItem(this.messageCacheKey(this.selectedUser.id), JSON.stringify(this.messages));
      }
    }
  }

  onPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const remaining = 10 - this.selectedFiles.length;
    let added = 0;
    for (let i = 0; i < items.length && added < remaining; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        this.selectedFiles.push(file);
        const reader = new FileReader();
        reader.onload = (e) => this.previews.push(e.target!.result as string);
        reader.readAsDataURL(file);
        added++;
      }
    }
    if (added > 0) {
      event.preventDefault();
      if (this.messageType !== 'image') {
        this.messageType = 'image';
      }
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

  // ── Polls ──

  addPollOption() {
    if (this.pollOptions.length < 20) {
      this.pollOptions.push('');
    }
  }

  removePollOption(idx: number) {
    if (this.pollOptions.length > 2) {
      this.pollOptions.splice(idx, 1);
    }
  }

  trackPollOption(idx: number, _item: string): number {
    return idx;
  }

  castVote(pollId: number, optionId: number) {
    this.api.castVote(pollId, optionId).subscribe({
      next: (res) => {
        this.updatePollData(pollId, res.options);
      },
    });
  }

  private updatePollData(pollId: number, options: { id: number; vote_count: number; voted: boolean }[]) {
    for (const msg of this.messages) {
      if (msg.poll?.id === pollId) {
        for (const opt of options) {
          const existing = msg.poll.options.find(o => o.id === opt.id);
          if (existing) {
            existing.vote_count = opt.vote_count;
            existing.voted = opt.voted;
          }
        }
        break;
      }
    }
  }

  computeTotalVotes(poll: any): number {
    return poll?.options?.reduce((acc: number, opt: any) => acc + (opt.vote_count || 0), 0) || 0;
  }

  private handlePollUpdate(data: any) {
    if (data.poll_id) {
      this.updatePollData(data.poll_id, data.options);
    }
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
  async selectGroup(group: GroupChat) {
    this.selectedGroup = group;
    this.selectedUser = null;
    this.showMobileChat = true;
    this.api.chatHeaderInfo.set({ type: 'group', id: group.id, name: group.name });
    this.router.navigate(['/chat', 'group', group.id]);

    // Ensure we have the group key and distribute to members without shares
    if (this.e2eeReady) {
      const groupKey = await this.crypto.getGroupKey(group.id);
      if (groupKey) {
        this.distributeGroupKeyToMembers(group.id);
      }
    }

    this.messages = [];
    this.api.getGroupMessages(group.id).subscribe(async (msgs: Message[]) => {
      for (let i = 0; i < msgs.length; i++) {
        msgs[i] = await this.decryptGroupMsg(msgs[i], group.id);
      }
      // Merge with existing messages (e.g. optimistic sends) to avoid race conditions
      const existingIds = new Set(this.messages.map(m => m.id));
      for (const msg of msgs) {
        if (!existingIds.has(msg.id)) {
          this.messages.push(msg);
        }
      }
      this.messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      this.messages = [...this.messages];
      this.scrollToBottom();
    });
  }

  private async distributeGroupKeyToMembers(groupId: number) {
    try {
      const res = await firstValueFrom(this.api.getGroupChat(groupId));
      const myId = this.currentUserId;
      const raw = await this.crypto.getRawGroupKey(groupId);
      if (!raw) return;

      for (const member of res.members) {
        if (member.user_id === myId) continue;
        // Check if share already exists (we can't know without asking server)
        // Just try to upload — server upserts
        const share = await this.crypto.encryptGroupKeyForPeer(raw, member.user_id);
        if (share) {
          this.api.uploadGroupKeyShare(groupId, member.user_id, share.encrypted_key, share.iv)
            .subscribe({ error: () => {} });
        }
      }
    } catch {}
  }

  private async decryptGroupMsg(msg: Message, groupId: number): Promise<Message> {
    if (msg.encrypted_content && msg.encrypted_iv && this.e2eeReady) {
      const decrypted = await this.crypto.decryptGroupMessage(groupId, msg.encrypted_content, msg.encrypted_iv);
      if (decrypted !== null) {
        msg.content = decrypted;
      }
    }
    return msg;
  }

  async createGroup() {
    if (!this.newGroupName.trim()) return;
    this.api.createGroupChat(this.newGroupName.trim()).subscribe({
      next: async (res) => {
        this.showCreateGroup = false;
        this.newGroupName = '';
        this.loadGroupChats();

        // Generate E2EE group key and upload share for self
        if (this.e2eeReady) {
          const rawKeyBytes = await this.crypto.generateGroupKey(res.id);
          if (rawKeyBytes) {
            const selfShare = await this.crypto.encryptGroupKeyForPeer(rawKeyBytes, this.currentUserId);
            if (selfShare) {
              this.api.uploadGroupKeyShare(res.id, this.currentUserId, selfShare.encrypted_key, selfShare.iv)
                .subscribe({ error: (e) => console.warn('Failed to upload group key share:', e) });
            }
          }
        }
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

  deleteCurrentGroup() {
    const group = this.selectedGroup;
    if (!group) return;
    if (!confirm(`Удалить чат "${group.name}"? Сообщения будут безвозвратно удалены.`)) return;
    this.api.deleteGroupChat(group.id).subscribe({
      next: () => {
        this.showGroupInfo = false;
        this.selectedGroup = null;
        this.api.chatHeaderInfo.set(null);
        this.messages = [];
        this.groupChats = this.groupChats.filter(g => g.id !== group.id);
        this.router.navigate(['/chat']);
      },
      error: () => alert('Ошибка удаления группы'),
    });
  }

  private resolvePendingGroupChat(groupId: number) {
    const group = this.groupChats.find((g) => g.id === groupId);
    if (group) {
      this.selectGroup(group);
    }
  }
}
