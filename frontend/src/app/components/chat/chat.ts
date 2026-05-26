import { Component, OnInit, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, User, Message } from '../../services/api.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <div class="flex gap-4 h-[calc(100vh-8rem)]">
      <div class="w-72 bg-white rounded-xl shadow-sm border p-3 overflow-y-auto shrink-0">
        <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Пользователи</h3>
        @for (user of users; track user.id) {
          <div (click)="selectUser(user)"
            class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors"
            [class.bg-blue-50]="selectedUser?.id === user.id"
            [class.hover:bg-gray-100]="selectedUser?.id !== user.id">
            <div class="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-sm font-medium text-green-600">
              {{ user.username[0] }}
            </div>
            <span class="text-sm">{{ user.username }}</span>
          </div>
        }
      </div>

      <div class="flex-1 bg-white rounded-xl shadow-sm border flex flex-col">
        @if (!selectedUser) {
          <div class="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Выберите пользователя для начала чата
          </div>
        }

        @if (selectedUser) {
          <div class="border-b px-4 py-3">
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
  private ws: WebSocket | null = null;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.currentUserId = this.api.currentUser()?.id ?? 0;

    this.api.getUsers().subscribe((users: User[]) => {
      this.users = users.filter((u) => u.id !== this.currentUserId);
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
