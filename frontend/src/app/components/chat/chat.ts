import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService, User, Message } from '../../services/api.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <input type="file" #fileInput (change)="onFileSelected($event)" accept="image/jpeg,image/png,image/gif,image/webp" multiple style="display:none;">
    <!-- Desktop -->
    <div class="hidden md:flex gap-4 h-[calc(100vh-6rem)]">
      <div class="w-72 card p-3 overflow-y-auto shrink-0">
        @if (getPinnedUsers().length > 0) {
          <h3 class="section-label" style="margin-bottom:12px;">📌 Закреплённые</h3>
          @for (user of getPinnedUsers(); track user.id) {
            <div (click)="openChat(user)"
              class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
              [style.background]="selectedUser?.id === user.id ? 'var(--accent-light)' : 'transparent'"
              [class.hover-bg]="selectedUser?.id !== user.id">
              @if (user.avatar_url) {
                <img [src]="user.avatar_url" class="w-8 h-8 rounded-full object-cover">
              } @else {
                <div class="post-avatar" style="width:32px;height:32px;font-size:13px;">
                  {{ user.username[0] }}
                </div>
              }
              <span class="flex-1 text-sm" style="color:var(--text-primary);">{{ user.username }}</span>
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
            @if (user.avatar_url) {
              <img [src]="user.avatar_url" class="w-8 h-8 rounded-full object-cover">
            } @else {
              <div class="post-avatar" style="width:32px;height:32px;font-size:13px;">
                {{ user.username[0] }}
              </div>
            }
            <span class="flex-1 text-sm" style="color:var(--text-primary);">{{ user.username }}</span>
            @if (user.is_online) {
              <span class="w-2 h-2 rounded-full shrink-0" style="background:#34d399;"></span>
            }
            <button (click)="togglePin(user.id, $event)" class="p-1 text-xs" style="color:var(--text-tertiary);" title="Закрепить">📌</button>
          </div>
        }
      </div>

      <div class="flex-1 card flex flex-col">
        @if (!selectedUser) {
          <div class="flex-1 flex items-center justify-center" style="color:var(--text-tertiary);font-size:14px;">
            Выберите пользователя для начала чата
          </div>
        }

        @if (selectedUser) {
          <div class="flex items-center gap-3 px-4 py-3" style="border-bottom:1px solid var(--divider);">
            <h3 class="font-medium" style="color:var(--text-primary);">{{ selectedUser.username }}</h3>
          </div>

          <div class="flex-1 overflow-y-auto p-4" style="display:flex;flex-direction:column;gap:8px;">
            @for (msg of messages; track msg.id) {
              <div class="flex" [class.justify-end]="msg.from_user_id === currentUserId">
                <div [class.chat-message-outgoing]="msg.from_user_id === currentUserId"
                  [class.chat-message-incoming]="msg.from_user_id !== currentUserId">
                  @if (msg.content) { <p>{{ msg.content }}</p> }
                    @if (msg.images && msg.images.length > 0) {
                    <div class="flex flex-wrap gap-1 mt-1">
                      @for (img of msg.images; track img.id || $index) {
                      <img [src]="img.image_url" class="max-w-[200px] max-h-[200px] rounded-lg object-cover cursor-pointer"
                      (click)="openImage(img.image_url)">
                      }
                    </div>
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
            <div class="chat-input" style="border-top:1px solid var(--divider);padding:12px 16px;display:flex;gap:8px;">
              <button (click)="triggerFileInput()" title="Прикрепить изображение"
              style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:transparent;color:var(--text-tertiary);cursor:pointer;">
              <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              </button>
              <input type="text" [(ngModel)]="messageContent" (keyup.enter)="sendMessage()"
              style="flex:1;height:36px;box-sizing:border-box;" placeholder="Напишите сообщение...">
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
          @if (getPinnedUsers().length > 0) {
            <h3 class="section-label" style="margin-bottom:12px;">📌 Закреплённые</h3>
            @for (user of getPinnedUsers(); track user.id) {
              <div (click)="openChat(user)"
                class="card flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover-bg">
                @if (user.avatar_url) {
                  <img [src]="user.avatar_url" class="w-10 h-10 rounded-full object-cover shrink-0">
                } @else {
                  <div class="post-avatar" style="width:40px;height:40px;font-size:16px;">
                    {{ user.username[0] }}
                  </div>
                }
                <span class="flex-1 text-sm font-medium" style="color:var(--text-primary);">{{ user.username }}</span>
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
              @if (user.avatar_url) {
                <img [src]="user.avatar_url" class="w-10 h-10 rounded-full object-cover shrink-0">
              } @else {
                <div class="post-avatar" style="width:40px;height:40px;font-size:16px;">
                  {{ user.username[0] }}
                </div>
              }
              <span class="flex-1 text-sm font-medium" style="color:var(--text-primary);">{{ user.username }}</span>
              @if (user.is_online) {
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:#34d399;"></span>
              }
              <button (click)="togglePin(user.id, $event)" class="p-1 text-sm" style="color:var(--text-tertiary);" title="Закрепить">📌</button>
            </div>
          }
        </div>
      }

      @if (showMobileChat && selectedUser) {
        <div class="flex flex-col h-[calc(100dvh-7rem)]">
          <div class="flex items-center gap-3 px-4 py-3 shrink-0"
            style="border-bottom:1px solid var(--border-default);background:var(--nav-bg);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);">
            <button (click)="router.navigate(['/chat'])" class="p-1 -ml-1" style="color:var(--text-secondary);">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div class="flex items-center gap-2">
              @if (selectedUser.avatar_url) {
                <img [src]="selectedUser.avatar_url" class="w-7 h-7 rounded-full object-cover">
              } @else {
                <div class="flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold"
                  style="background:var(--avatar-bg);color:var(--avatar-text);">
                  {{ selectedUser.username[0] }}
                </div>
              }
              <h3 class="font-medium text-sm" style="color:var(--text-primary);">{{ selectedUser.username }}</h3>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-4" style="display:flex;flex-direction:column;gap:8px;">
            @for (msg of messages; track msg.id) {
              <div class="flex" [class.justify-end]="msg.from_user_id === currentUserId">
                <div [class.chat-message-outgoing]="msg.from_user_id === currentUserId"
                  [class.chat-message-incoming]="msg.from_user_id !== currentUserId">
                  @if (msg.content) { <p>{{ msg.content }}</p> }
                    @if (msg.images && msg.images.length > 0) {
                    <div class="flex flex-wrap gap-1 mt-1">
                      @for (img of msg.images; track img.id || $index) {
                      <img [src]="img.image_url" class="max-w-[200px] max-h-[200px] rounded-lg object-cover cursor-pointer"
                      (click)="openImage(img.image_url)">
                      }
                    </div>
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
            <div class="chat-input" style="border-top:1px solid var(--divider);padding:12px 16px;display:flex;gap:8px;">
              <button (click)="triggerFileInput()" title="Прикрепить изображение"
              style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:transparent;color:var(--text-tertiary);cursor:pointer;">
              <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              </button>
              <input type="text" [(ngModel)]="messageContent" (keyup.enter)="sendMessage()"
              style="flex:1;height:36px;box-sizing:border-box;" placeholder="Напишите сообщение...">
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
  `,
})
export class ChatComponent implements OnInit, OnDestroy {
  users: User[] = [];
  selectedUser: User | null = null;
  messages: Message[] = [];
  messageContent = '';
  selectedFiles: File[] = [];
  previews: string[] = [];
  currentUserId = 0;
  showMobileChat = false;
  pinnedIds: Set<number> = new Set();
  private subscriptions: Subscription[] = [];

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    protected router: Router,
  ) {}

  ngOnInit() {
    this.currentUserId = this.api.currentUser()?.id ?? 0;

    this.route.paramMap.subscribe((params) => {
      const userId = params.get('userId');
      this.showMobileChat = !!userId;
      if (userId && this.users.length > 0) {
        const user = this.users.find((u) => u.id === Number(userId));
        if (user) {
          this.selectUser(user);
        }
      }
    });

    this.loadFromCache();
    this.loadFromServer();
    this.listenWsOnlineEvents();

    this.subscriptions.push(
      this.api.wsMessages$.subscribe((data) => {
        if (data.type === 'message' && this.selectedUser && data.from === this.selectedUser.id) {
          const msg: Message = {
            id: Date.now(),
            from_user_id: data.from,
            to_user_id: this.currentUserId,
            content: data.content,
            created_at: new Date().toISOString(),
            from_user: data.from_name || this.selectedUser.username,
            images: data.images ? data.images.map((url: string) => ({ id: 0, image_url: url })) : undefined,
          };
          this.messages.push(msg);
          localStorage.setItem(this.messageCacheKey(this.selectedUser.id), JSON.stringify(this.messages));
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
  }

  private messageCacheKey(otherUserId: number): string {
    const ids = [this.currentUserId, otherUserId].sort((a, b) => a - b);
    return `cached_messages_${ids[0]}_${ids[1]}`;
  }

  selectUser(user: User) {
    this.selectedUser = user;

    const cached = localStorage.getItem(this.messageCacheKey(user.id));
    this.messages = cached ? JSON.parse(cached) : [];

    this.api.getMessages(this.currentUserId, user.id).subscribe((msgs: Message[]) => {
      this.messages = msgs;
      localStorage.setItem(this.messageCacheKey(user.id), JSON.stringify(msgs));
    });
  }

  openChat(user: User) {
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
    if ((!this.messageContent.trim() && this.selectedFiles.length === 0) || !this.selectedUser) return;

    const content = this.messageContent;
    const files = [...this.selectedFiles];
    this.api.sendMessage(this.selectedUser.id, content, files).subscribe({
      next: () => {
        const msg: Message = {
          id: Date.now(),
          from_user_id: this.currentUserId,
          to_user_id: this.selectedUser!.id,
          content: content,
          created_at: new Date().toISOString(),
          from_user: this.api.currentUser()?.username ?? '',
        };
        this.messages.push(msg);
        localStorage.setItem(this.messageCacheKey(this.selectedUser!.id), JSON.stringify(this.messages));
        this.messageContent = '';
        this.clearFiles();
      },
    });
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
}
