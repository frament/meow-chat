import { Component, OnInit, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, User, Message } from '../../services/api.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <!-- Desktop -->
    <div class="hidden md:flex gap-4 h-[calc(100vh-6rem)]">
      <div class="w-72 card p-3 overflow-y-auto shrink-0">
        <h3 class="section-label" style="margin-bottom:12px;">Пользователи</h3>
        @for (user of users; track user.id) {
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
            <span class="text-sm" style="color:var(--text-primary);">{{ user.username }}</span>
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
                  <p>{{ msg.content }}</p>
                  <p class="text-xs mt-1 opacity-70">{{ msg.created_at | date:'HH:mm' }}</p>
                </div>
              </div>
            }
          </div>

          <div class="chat-input" style="border-top:1px solid var(--divider);padding:12px 16px;display:flex;gap:8px;">
            <input type="text" [(ngModel)]="messageContent" (keyup.enter)="sendMessage()"
              style="flex:1;height:36px;box-sizing:border-box;" placeholder="Напишите сообщение...">
            <button (click)="sendMessage()" title="Отправить"
              style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;border-radius:var(--radius-sm);background:var(--accent-gradient);color:white;cursor:pointer;transition:all 0.2s;">
              <svg style="width:20px;height:20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        }
      </div>
    </div>

    <!-- Mobile -->
    <div class="md:hidden">
      @if (!showMobileChat) {
        <div class="px-4 py-6 pb-20">
          <h3 class="section-label" style="margin-bottom:12px;">Пользователи</h3>
          @for (user of users; track user.id) {
            <div (click)="openChat(user)"
              class="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover-bg"
              style="border-bottom:1px solid var(--divider);">
              @if (user.avatar_url) {
                <img [src]="user.avatar_url" class="w-10 h-10 rounded-full object-cover shrink-0">
              } @else {
                <div class="post-avatar" style="width:40px;height:40px;font-size:16px;">
                  {{ user.username[0] }}
                </div>
              }
              <span class="text-sm font-medium" style="color:var(--text-primary);">{{ user.username }}</span>
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
                  <p>{{ msg.content }}</p>
                  <p class="text-xs mt-1 opacity-70">{{ msg.created_at | date:'HH:mm' }}</p>
                </div>
              </div>
            }
          </div>

          <div class="chat-input" style="border-top:1px solid var(--divider);padding:12px 16px;display:flex;gap:8px;">
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
  `,
})
export class ChatComponent implements OnInit, OnDestroy {
  users: User[] = [];
  selectedUser: User | null = null;
  messages: Message[] = [];
  messageContent = '';
  currentUserId = 0;
  showMobileChat = false;
  private ws: WebSocket | null = null;

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

    this.api.getUsers().subscribe((users: User[]) => {
      this.users = users.filter((u) => u.id !== this.currentUserId);
      const userId = this.route.snapshot.paramMap.get('userId');
      if (userId) {
        const user = this.users.find((u) => u.id === Number(userId));
        if (user) {
          this.selectUser(user);
        }
      }
    });

    this.connectWebSocket();
  }

  ngOnDestroy() {
    this.ws?.close();
  }

  connectWebSocket() {
    this.ws = this.api.connectWebSocket();

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message' && this.selectedUser) {
        if (data.from === this.selectedUser.id) {
          this.messages.push({
            id: Date.now(),
            from_user_id: data.from,
            to_user_id: this.currentUserId,
            content: data.content,
            created_at: new Date().toISOString(),
            from_user: this.selectedUser.username,
          });
        }
      }
    };
  }

  selectUser(user: User) {
    this.selectedUser = user;
    this.api.getMessages(this.currentUserId, user.id).subscribe((msgs: Message[]) => {
      this.messages = msgs;
    });
  }

  openChat(user: User) {
    this.router.navigate(['/chat', user.id]);
  }

  sendMessage() {
    if (!this.messageContent.trim() || !this.selectedUser) return;

    this.api.sendMessage(this.selectedUser.id, this.messageContent).subscribe({
      next: () => {
        this.messages.push({
          id: Date.now(),
          from_user_id: this.currentUserId,
          to_user_id: this.selectedUser!.id,
          content: this.messageContent,
          created_at: new Date().toISOString(),
          from_user: this.api.currentUser()?.username ?? '',
        });
        this.messageContent = '';
      },
    });
  }
}
