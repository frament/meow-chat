import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';

export interface User {
  id: number;
  username: string;
  email: string;
  avatar_url: string;
  is_admin: boolean;
  created_at: string;
  is_online: boolean;
}

export interface PostImage {
  id: number;
  post_id: number;
  image_url: string;
}

export interface Post {
  id: number;
  user_id: number;
  content: string;
  created_at: string;
  username: string;
  avatar_url: string;
  is_admin: boolean;
  images?: PostImage[];
}

export interface WsMessage {
  type: 'message';
  from: number;
  from_name: string;
  content: string;
  images?: string[];
  created_at: string;
}

export interface Message {
  id: number;
  from_user_id: number;
  to_user_id: number;
  content: string;
  created_at: string;
  from_user: string;
  images?: { id: number; image_url: string }[];
}

export interface LoginResponse {
  id: number;
  username: string;
  email: string;
  avatar_url: string;
  is_admin: boolean;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: LoginResponse;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly currentUser = signal<LoginResponse | null>(null);
  readonly accessToken = signal<string | null>(null);
  readonly unreadCounts = signal<Record<number, number>>({});
  readonly totalUnread = computed(() => Object.values(this.unreadCounts()).reduce((a, b) => a + b, 0));
  readonly unreadBoundaries = signal<Record<number, string>>({});
  readonly wsOnlineEvent = new Subject<{ type: 'user_online' | 'user_offline'; user_id: number }>();
  readonly wsMessages$ = new Subject<WsMessage>();
  private ws: WebSocket | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnecting = false;
  private baseUrl = '/api';

  constructor(private http: HttpClient) {
    const saved = localStorage.getItem('currentUser');
    const token = localStorage.getItem('accessToken');
    if (saved && token) {
      this.currentUser.set(JSON.parse(saved));
      this.accessToken.set(token);
    }
  }

  register(username: string, email: string, password: string) {
    return this.http.post<{ id: number; message: string }>(
      `${this.baseUrl}/register`,
      { username, email, password }
    );
  }

  login(username: string, password: string) {
    return this.http.post<AuthResponse>(
      `${this.baseUrl}/login`,
      { username, password }
    );
  }

  refreshToken() {
    const refreshToken = localStorage.getItem('refreshToken');
    return this.http.post<{ access_token: string; refresh_token: string }>(
      `${this.baseUrl}/refresh`,
      { refresh_token: refreshToken || '' }
    );
  }

  logout() {
    this.disconnectWebSocket();
    this.http.post(`${this.baseUrl}/logout`, {}).subscribe({ error: () => {} });
    localStorage.removeItem('currentUser');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    this.currentUser.set(null);
    this.accessToken.set(null);
  }

  storeAuth(auth: AuthResponse) {
    localStorage.setItem('accessToken', auth.access_token);
    localStorage.setItem('refreshToken', auth.refresh_token);
    localStorage.setItem('currentUser', JSON.stringify(auth.user));
    this.accessToken.set(auth.access_token);
    this.currentUser.set(auth.user);
    this.connectWebSocket();
  }

  getUsers() {
    return this.http.get<User[]>(`${this.baseUrl}/users`);
  }

  getPinned() {
    return this.http.get<{ pinned_user_ids: number[] }>(`${this.baseUrl}/pinned`);
  }

  pinUser(id: number) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/pin/${id}`, {});
  }

  unpinUser(id: number) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/pin/${id}`);
  }

  getFeed() {
    return this.http.get<Post[]>(`${this.baseUrl}/feed`);
  }

  createPost(content: string, files: File[] = []) {
    const formData = new FormData();
    formData.append('content', content);
    for (const file of files) {
      formData.append('images', file);
    }
    return this.http.post<{ id: number; message: string }>(
      `${this.baseUrl}/posts`,
      formData
    );
  }

  getMessages(user1: number, user2: number) {
    return this.http.get<Message[]>(
      `${this.baseUrl}/messages?user1=${user1}&user2=${user2}`
    );
  }

  sendMessage(toUserId: number, content: string, files: File[] = []) {
    const formData = new FormData();
    formData.append('to_user_id', String(toUserId));
    formData.append('content', content);
    for (const file of files) {
      formData.append('images', file);
    }
    return this.http.post<{ id: number; message: string }>(
      `${this.baseUrl}/messages`,
      formData
    );
  }

  uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append('avatar', file);
    return this.http.post<{ avatar_url: string }>(
      `${this.baseUrl}/upload-avatar`,
      formData
    );
  }

  updateProfile(username: string, email: string) {
    return this.http.put<LoginResponse>(
      `${this.baseUrl}/profile`,
      { username, email }
    );
  }

  getAdminUsers() {
    return this.http.get<User[]>(`${this.baseUrl}/admin/users`);
  }

  adminMakeAdmin(id: number) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/admin/users/${id}/make-admin`, {});
  }

  adminRemoveAdmin(id: number) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/admin/users/${id}/remove-admin`, {});
  }

  getAdminFiles() {
    return this.http.get<{ name: string; path: string; size: number; is_dir: boolean; mod_time: string }[]>(
      `${this.baseUrl}/admin/files`
    );
  }

  getVapidPublicKey() {
    return this.http.get<{ publicKey: string }>(`${this.baseUrl}/push/vapid-public-key`);
  }

  pushSubscribe(subscription: PushSubscriptionJSON) {
    return this.http.post(`${this.baseUrl}/push/subscribe`, {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.['p256dh'],
      auth: subscription.keys?.['auth'],
    });
  }

  pushUnsubscribe(endpoint: string) {
    return this.http.delete(`${this.baseUrl}/push/subscribe`, {
      body: { endpoint },
    });
  }

  connectWebSocket(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.ws) this.ws.close();
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = this.accessToken();
    if (!token) return;

    this.ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?token=${token}`);

    this.ws.onmessage = (event) => {
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.type === 'message') {
        this.wsMessages$.next(data as WsMessage);
      }

      if (data.type === 'user_online' || data.type === 'user_offline') {
        this.wsOnlineEvent.next(data);
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private isJwtExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return Date.now() >= payload.exp * 1000;
    } catch {
      return true;
    }
  }

  private scheduleReconnect(): void {
    if (this.wsReconnecting || this.wsRetryTimer) return;
    if (!this.accessToken()) return;

    this.wsReconnecting = true;
    this.wsRetryTimer = setTimeout(() => {
      this.wsRetryTimer = null;

      const token = this.accessToken();
      if (!token) { this.wsReconnecting = false; return; }

      if (this.isJwtExpired(token)) {
        this.refreshToken().subscribe({
          next: (res) => {
            this.accessToken.set(res.access_token);
            localStorage.setItem('accessToken', res.access_token);
            localStorage.setItem('refreshToken', res.refresh_token);
            this.wsReconnecting = false;
            this.connectWebSocket();
          },
          error: () => {
            this.wsReconnecting = false;
            this.logout();
          },
        });
      } else {
        this.wsReconnecting = false;
        this.connectWebSocket();
      }
    }, 3000);
  }

  incrementUnread(userId: number, createdAt?: string): void {
    this.unreadCounts.update(c => ({ ...c, [userId]: (c[userId] ?? 0) + 1 }));
    if (createdAt && !this.unreadBoundaries()[userId]) {
      this.unreadBoundaries.update(b => ({ ...b, [userId]: createdAt }));
    }
  }

  clearUnread(userId: number): void {
    this.unreadCounts.update(c => {
      if (!c[userId]) return c;
      const next = { ...c };
      delete next[userId];
      return next;
    });
  }

  clearUnreadBoundary(userId: number): void {
    this.unreadBoundaries.update(b => {
      if (!b[userId]) return b;
      const next = { ...b };
      delete next[userId];
      return next;
    });
  }

  disconnectWebSocket(): void {
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);
    this.wsRetryTimer = null;
    this.wsReconnecting = false;
    this.ws?.close();
    this.ws = null;
  }
}
