import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

export interface User {
  id: number;
  username: string;
  email: string;
  avatar_url: string;
  created_at: string;
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
}

export interface LoginResponse {
  id: number;
  username: string;
  email: string;
  avatar_url: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly currentUser = signal<LoginResponse | null>(null);
  private baseUrl = '/api';

  constructor(private http: HttpClient) {
    const saved = localStorage.getItem('currentUser');
    if (saved) {
      this.currentUser.set(JSON.parse(saved));
    }
  }

  private getHeaders(): HttpHeaders {
    const user = this.currentUser();
    let headers = new HttpHeaders();
    if (user) {
      headers = headers.set('X-User-Id', String(user.id));
    }
    return headers;
  }

  register(username: string, email: string, password: string) {
    return this.http.post<{ id: number; message: string }>(
      `${this.baseUrl}/register`,
      { username, email, password }
    );
  }

  login(username: string, password: string) {
    return this.http.post<LoginResponse>(
      `${this.baseUrl}/login`,
      { username, password }
    );
  }

  getUsers() {
    return this.http.get<User[]>(`${this.baseUrl}/users`);
  }

  getFeed() {
    return this.http.get<Post[]>(`${this.baseUrl}/feed`);
  }

  createPost(content: string, files: File[] = []) {
    const user = this.currentUser();
    const formData = new FormData();
    formData.append('content', content);
    for (const file of files) {
      formData.append('images', file);
    }
    return this.http.post<{ id: number; message: string }>(
      `${this.baseUrl}/posts/${user!.id}`,
      formData,
      { headers: new HttpHeaders().set('X-User-Id', String(user!.id)) }
    );
  }

  getMessages(user1: number, user2: number) {
    return this.http.get<Message[]>(
      `${this.baseUrl}/messages?user1=${user1}&user2=${user2}`,
      { headers: this.getHeaders() }
    );
  }

  sendMessage(toUserId: number, content: string) {
    const user = this.currentUser();
    return this.http.post<{ id: number; message: string }>(
      `${this.baseUrl}/messages/${user!.id}`,
      { to_user_id: toUserId, content },
      { headers: this.getHeaders() }
    );
  }

  uploadAvatar(file: File) {
    const user = this.currentUser();
    const formData = new FormData();
    formData.append('avatar', file);
    return this.http.post<{ avatar_url: string }>(
      `${this.baseUrl}/upload-avatar/${user!.id}`,
      formData,
      { headers: new HttpHeaders().set('X-User-Id', String(user!.id)) }
    );
  }

  updateProfile(username: string, email: string) {
    const user = this.currentUser();
    return this.http.put<LoginResponse>(
      `${this.baseUrl}/profile/${user!.id}`,
      { username, email },
      { headers: this.getHeaders() }
    );
  }

  connectWebSocket(userId: number): WebSocket {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(`${protocol}//${window.location.host}/api/ws/${userId}`);
  }
}
