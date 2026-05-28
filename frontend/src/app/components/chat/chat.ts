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
    <div class="flex gap-4 h-[calc(100vh-8rem)] md:h-[calc(100vh-6rem)]">
      <!-- User list: hidden on mobile when chat is open -->
      <div class="w-72 card p-3 overflow-y-auto shrink-0 hidden md:block"
        [class.hidden]="showMobileChat">
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

      <!-- Mobile-only fullscreen user list -->
      <div class="w-full card p-3 overflow-y-auto md:hidden"
        [class.hidden]="showMobileChat">
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

      <!-- Chat area -->
      <div class="flex-1 card flex flex-col"
        [class.hidden]="!showMobileChat && !selectedUser">
        @if (!selectedUser) {
          <div class="flex-1 flex items-center justify-center" style="color:var(--text-tertiary);font-size:14px;">
            Выберите пользователя для начала чата
          </div>
        }

        @if (selectedUser) {
          <div class="flex items-center gap-3 px-4 py-3" style="border-bottom:1px solid var(--divider);">
            <button (click)="router.navigate(['/chat'])" class="md:hidden p-1 -ml-1" style="color:var(--text-secondary);">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
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
              style="flex:1;" placeholder="Напишите сообщение...">
            <button (click)="sendMessage()" class="btn-primary">
              Отправить
            </button>
          </div>
        }
      </div>
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
    this.ws = this.api.connectWebSocket(this.currentUserId);

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
