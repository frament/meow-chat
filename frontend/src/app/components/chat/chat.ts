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
      <div class="w-72 bg-white rounded-xl shadow-sm border p-3 overflow-y-auto shrink-0 hidden md:block"
        [class.hidden]="showMobileChat">
        <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Пользователи</h3>
        @for (user of users; track user.id) {
          <div (click)="openChat(user)"
            class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
            [class.bg-blue-50]="selectedUser?.id === user.id"
            [class.hover:bg-gray-100]="selectedUser?.id !== user.id">
            @if (user.avatar_url) {
              <img [src]="user.avatar_url" class="w-8 h-8 rounded-full object-cover">
            } @else {
              <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-sm font-medium text-green-600 shrink-0">
                {{ user.username[0] }}
              </div>
            }
            <span class="text-sm">{{ user.username }}</span>
          </div>
        }
      </div>

      <!-- Mobile-only fullscreen user list -->
      <div class="w-full bg-white rounded-xl shadow-sm border p-3 overflow-y-auto md:hidden"
        [class.hidden]="showMobileChat">
        <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Пользователи</h3>
        @for (user of users; track user.id) {
          <div (click)="openChat(user)"
            class="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors border-b border-gray-100 last:border-0">
            @if (user.avatar_url) {
              <img [src]="user.avatar_url" class="w-10 h-10 rounded-full object-cover shrink-0">
            } @else {
              <div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-sm font-medium text-green-600 shrink-0">
                {{ user.username[0] }}
              </div>
            }
            <span class="text-sm font-medium">{{ user.username }}</span>
          </div>
        }
      </div>

      <!-- Chat area: hidden on mobile when no user selected / user list shown -->
      <div class="flex-1 bg-white rounded-xl shadow-sm border flex flex-col"
        [class.hidden]="!showMobileChat && !selectedUser">
        @if (!selectedUser) {
          <div class="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Выберите пользователя для начала чата
          </div>
        }

        @if (selectedUser) {
          <div class="border-b px-4 py-3 flex items-center gap-3">
            <button (click)="router.navigate(['/chat'])" class="md:hidden p-1 -ml-1 text-gray-500 hover:text-gray-700">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h3 class="font-medium">{{ selectedUser.username }}</h3>
          </div>

          <div class="flex-1 overflow-y-auto p-4 space-y-3">
            @for (msg of messages; track msg.id) {
              <div class="flex" [class.justify-end]="msg.from_user_id === currentUserId">
                <div class="max-w-[70%] rounded-xl px-3 py-2 text-sm"
                  [class.bg-blue-600]="msg.from_user_id === currentUserId"
                  [class.text-white]="msg.from_user_id === currentUserId"
                  [class.bg-gray-100]="msg.from_user_id !== currentUserId">
                  <p>{{ msg.content }}</p>
                  <p class="text-xs mt-1 opacity-70">{{ msg.created_at | date:'HH:mm' }}</p>
                </div>
              </div>
            }
          </div>

          <div class="border-t p-3">
            <div class="flex gap-2">
              <input type="text" [(ngModel)]="messageContent" (keyup.enter)="sendMessage()"
                class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Напишите сообщение...">
              <button (click)="sendMessage()"
                class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm">
                Отправить
              </button>
            </div>
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
