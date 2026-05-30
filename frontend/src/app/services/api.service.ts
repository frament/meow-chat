import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';

export interface User {
  id: number;
  username: string;
  email: string;
  avatar_url: string;
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
  images?: PostImage[];
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
  readonly wsOnlineEvent = new Subject<{ type: 'user_online' | 'user_offline'; user_id: number }>();
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

  getVapidPublicKey() {
    return this.http.get<{ publicKey: string }>(`${this.baseUrl}/push/vapid-public-key`);
  }

  pushSubscribe(subscription: PushSubscriptionJSON) {
    return this.http.post(`${this.baseUrl}/push/subscribe`, {
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh,
      auth: subscription.keys?.auth,
    });
  }

  pushUnsubscribe(endpoint: string) {
    return this.http.delete(`${this.baseUrl}/push/subscribe`, {
      body: { endpoint },
    });
  }

  connectWebSocket(): WebSocket {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = this.accessToken();
    return new WebSocket(`${protocol}//${window.location.host}/api/ws?token=${token}`);
  }
}
