import { Injectable, signal, computed } from '@angular/core';
import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { Subject, Observable } from 'rxjs';

export interface User {
  id: number;
  username: string;
  email: string;
  avatar_url: string;
  is_admin: boolean;
  is_banned: boolean;
  created_at: string;
  is_online: boolean;
}

export interface PostImage {
  id: number;
  post_id: number;
  image_url: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  reacted: boolean;
}

export interface Post {
  id: number;
  user_id: number;
  content: string;
  created_at: string;
  username: string;
  avatar_url: string;
  is_admin: boolean;
  is_public: boolean;
  images?: PostImage[];
  reactions?: Reaction[];
}

export type MsgType = 'text' | 'image' | 'sticker' | 'gif' | 'poll';

export interface WsMessage {
  type: 'message';
  from: number;
  from_name: string;
  content: string;
  msg_type: MsgType;
  images?: string[];
  created_at: string;
  encrypted_content?: string;
  encrypted_iv?: string;
}

export interface GroupWsMessage {
  type: 'group_message';
  group_id: number;
  from: number;
  from_name: string;
  content: string;
  msg_type: MsgType;
  images?: string[];
  created_at: string;
  encrypted_content?: string;
  encrypted_iv?: string;
}

export type WsMessageType = string;

export interface PollOption {
  id: number;
  poll_id: number;
  text: string;
  vote_count: number;
  voted: boolean;
}

export type WsServerMessage =
  | { type: 'message'; id?: number; from: number; to?: number; from_name: string; content: string; msg_type: MsgType; images?: string[]; created_at: string; encrypted_content?: string; encrypted_iv?: string; sticker_url?: string; poll?: Poll }
  | { type: 'group_message'; group_id: number; id?: number; from: number; from_name: string; content: string; msg_type: MsgType; images?: string[]; created_at: string; encrypted_content?: string; encrypted_iv?: string; sticker_url?: string }
  | { type: 'user_online'; user_id: number }
  | { type: 'user_offline'; user_id: number }
  | { type: 'device_auth_request'; from_device_id: string; device_name?: string }
  | { type: 'device_approved'; device_id: string }
  | { type: 'poll_update'; poll_id: number; message_id?: number; group_message_id?: number; options: PollOption[]; total_votes: number; multiple?: boolean }
  | { type: 'friend_request'; from_user: number; username: string }
  | { type: 'friend_request_accepted'; user_id: number }
  | { type: 'group_joined'; group_chat_id: number; group_name: string }
  | { type: 'error'; message: string };

export interface Poll {
  id: number;
  message_id?: number;
  group_message_id?: number;
  question: string;
  is_multiple_choice: boolean;
  options: PollOption[];
  created_at: string;
}

export interface Message {
  id: number;
  from_user_id: number;
  to_user_id: number;
  content: string;
  msg_type: MsgType;
  group_chat_id?: number;
  created_at: string;
  from_user: string;
  images?: { id: number; image_url: string }[];
  encrypted_content?: string;
  encrypted_iv?: string;
  pending?: boolean;
  poll?: Poll;
}

export interface GroupChat {
  id: number;
  name: string;
  created_by: number;
  created_at: string;
  member_count: number;
}

export interface GroupMember {
  user_id: number;
  username: string;
  avatar_url: string;
}

export interface LoginResponse {
  id: number;
  username: string;
  email: string;
  avatar_url: string;
  is_admin: boolean;
}

export interface InviteToken {
  id: number;
  created_by: number;
  token: string;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  created_at: string;
}

export interface FriendInvite {
  id: number;
  created_by: number;
  token: string;
  used_by: number | null;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: LoginResponse;
}

export interface GiphyResult {
  id: string;
  url: string;
  preview_url: string;
  width: number;
  height: number;
}

export interface GiphySearchResponse {
  results: GiphyResult[];
}

export interface GiphyKeyResponse {
	key: string;
	has_key: boolean;
}

export interface StickerPack {
	id: number;
	name: string;
	created_at: string;
	stickers?: Sticker[];
}

export interface Sticker {
	id: number;
	pack_id: number;
	image_url: string;
	sort_order: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly currentUser = signal<LoginResponse | null>(null);
  readonly accessToken = signal<string | null>(null);
  readonly unreadCounts = signal<Record<number, number>>({});
  readonly totalUnread = computed(() => Object.values(this.unreadCounts()).reduce((a, b) => a + b, 0));
  readonly unreadBoundaries = signal<Record<number, string>>({});
  private readonly wsOnlineEventSubject = new Subject<{ type: 'user_online' | 'user_offline'; user_id: number }>();
  readonly wsOnlineEvent = this.wsOnlineEventSubject.asObservable();
  private readonly wsMessagesSubject = new Subject<WsServerMessage>();
  readonly wsMessages$ = this.wsMessagesSubject.asObservable();
  readonly wsConnected = signal(false);
  private ws: WebSocket | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnecting = false;
  private wsRetryCount = 0;
  private wsConnecting = false;
  private readonly WS_MAX_RETRY_DELAY = 30000;
  private readonly WS_INITIAL_RETRY_DELAY = 1000;
  private readonly WS_MAX_RETRIES = 20;
  private readonly WS_SLOW_POLL_DELAY = 60000;
  private baseUrl = '/api';

  constructor(private http: HttpClient) {
    const saved = localStorage.getItem('currentUser');
    const token = localStorage.getItem('accessToken');
    if (saved && token && saved !== 'undefined') {
      try {
        const user = JSON.parse(saved);
        if (user && typeof user === 'object' && user.id) {
          this.currentUser.set(user);
          this.accessToken.set(token);
        }
      } catch {}
    }

    // PWA/Standalone: when user returns to the app, reset retry state and reconnect
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.currentUser()) {
        this.resetRetryState();
      }
    });
  }

  retryConnection(): void {
    this.wsRetryCount = 0;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.wsRetryTimer) {
        clearTimeout(this.wsRetryTimer);
        this.wsRetryTimer = null;
      }
      this.wsReconnecting = false;
      this.wsConnecting = false;
      this.connectWebSocket();
    }
  }

  private resetRetryState(): void {
    this.retryConnection();
  }

  register(username: string, email: string, password: string, inviteToken: string) {
    return this.http.post<{ id: number; message: string }>(
      `${this.baseUrl}/register`,
      { username, email, password, invite_token: inviteToken }
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
    if (this.accessToken()) {
      this.http.post(`${this.baseUrl}/logout`, {}).subscribe({ error: () => {} });
    }
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

  createPost(content: string, files: File[] = [], isPublic = false) {
    const formData = new FormData();
    formData.append('content', content);
    formData.append('is_public', isPublic ? 'true' : 'false');
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

  sendMessage(toUserId: number, content: string, files: File[] = [], msgType: MsgType = 'text', encryptedContent?: string, encryptedIV?: string, pushPreview?: string, pollOptions?: string[], pollMultiple?: boolean) {
    const formData = new FormData();
    formData.append('to_user_id', String(toUserId));
    formData.append('content', content);
    formData.append('type', msgType);
    if (encryptedContent) formData.append('encrypted_content', encryptedContent);
    if (encryptedIV) formData.append('encrypted_iv', encryptedIV);
    if (pushPreview) formData.append('push_preview', pushPreview);
    if (pollOptions) {
      for (const opt of pollOptions) {
        formData.append('poll_options[]', opt);
      }
    }
    if (pollMultiple) formData.append('poll_multiple', 'true');
    for (const file of files) {
      formData.append('images', file);
    }
    return this.http.post<{ id: number; message: string }>(
      `${this.baseUrl}/messages`,
      formData
    );
  }

  // Group chats
  createGroupChat(name: string) {
    return this.http.post<{ id: number; name: string }>(
      `${this.baseUrl}/group-chats`, { name }
    );
  }

  getGroupChats() {
    return this.http.get<GroupChat[]>(`${this.baseUrl}/group-chats`);
  }

  getGroupChat(id: number) {
    return this.http.get<{ group: GroupChat; members: GroupMember[] }>(
      `${this.baseUrl}/group-chats/${id}`
    );
  }

  addGroupMember(groupId: number, username: string) {
    return this.http.post(`${this.baseUrl}/group-chats/${groupId}/members`, { username });
  }

  removeGroupMember(groupId: number, userId: number) {
    return this.http.delete(`${this.baseUrl}/group-chats/${groupId}/members/${userId}`);
  }

  createGroupInvite(groupId: number, maxUses?: number, expiresIn?: string) {
    let params = `?max_uses=${maxUses ?? 0}`;
    if (expiresIn) params += `&expires_in=${expiresIn}`;
    return this.http.post<{ token: string }>(
      `${this.baseUrl}/group-chats/${groupId}/invites${params}`, {}
    );
  }

  getGroupInvite(token: string) {
    return this.http.get<{ group_chat_id: number; group_name: string; token: string }>(
      `${this.baseUrl}/group-chat-invites/${token}`
    );
  }

  joinGroupViaInvite(token: string) {
    return this.http.post<{ message: string; group_chat_id: number; group_name: string }>(
      `${this.baseUrl}/group-chat-invites/${token}/join`, {}
    );
  }

  getGroupMessages(groupId: number) {
    return this.http.get<Message[]>(
      `${this.baseUrl}/group-chat-messages/${groupId}`
    );
  }

  sendGroupMessage(groupId: number, content: string, files: File[] = [], msgType: MsgType = 'text', encryptedContent?: string, encryptedIV?: string, pushPreview?: string, pollOptions?: string[], pollMultiple?: boolean) {
    const formData = new FormData();
    formData.append('group_chat_id', String(groupId));
    formData.append('content', content);
    formData.append('type', msgType);
    if (encryptedContent) formData.append('encrypted_content', encryptedContent);
    if (encryptedIV) formData.append('encrypted_iv', encryptedIV);
    if (pushPreview) formData.append('push_preview', pushPreview);
    if (pollOptions) {
      for (const opt of pollOptions) {
        formData.append('poll_options[]', opt);
      }
    }
    if (pollMultiple) formData.append('poll_multiple', 'true');
    for (const file of files) {
      formData.append('images', file);
    }
    return this.http.post<{ id: number; message: string }>(
      `${this.baseUrl}/group-chat-messages`,
      formData
    );
  }

  // Upload methods with progress reporting
  sendMessageWithProgress(toUserId: number, content: string, files: File[] = [], msgType: MsgType = 'text', encryptedContent?: string, encryptedIV?: string, pushPreview?: string, pollOptions?: string[], pollMultiple?: boolean) {
    const formData = new FormData();
    formData.append('to_user_id', String(toUserId));
    formData.append('content', content);
    formData.append('type', msgType);
    if (encryptedContent) formData.append('encrypted_content', encryptedContent);
    if (encryptedIV) formData.append('encrypted_iv', encryptedIV);
    if (pushPreview) formData.append('push_preview', pushPreview);
    if (pollOptions) {
      for (const opt of pollOptions) {
        formData.append('poll_options[]', opt);
      }
    }
    if (pollMultiple) formData.append('poll_multiple', 'true');
    for (const file of files) {
      formData.append('images', file);
    }
    return this.http.post<HttpEvent<any>>(`${this.baseUrl}/messages`, formData, {
      reportProgress: true,
      observe: 'events',
    });
  }

  sendGroupMessageWithProgress(groupId: number, content: string, files: File[] = [], msgType: MsgType = 'text', encryptedContent?: string, encryptedIV?: string, pushPreview?: string, pollOptions?: string[], pollMultiple?: boolean) {
    const formData = new FormData();
    formData.append('group_chat_id', String(groupId));
    formData.append('content', content);
    formData.append('type', msgType);
    if (encryptedContent) formData.append('encrypted_content', encryptedContent);
    if (encryptedIV) formData.append('encrypted_iv', encryptedIV);
    if (pushPreview) formData.append('push_preview', pushPreview);
    if (pollOptions) {
      for (const opt of pollOptions) {
        formData.append('poll_options[]', opt);
      }
    }
    if (pollMultiple) formData.append('poll_multiple', 'true');
    for (const file of files) {
      formData.append('images', file);
    }
    return this.http.post<HttpEvent<any>>(`${this.baseUrl}/group-chat-messages`, formData, {
      reportProgress: true,
      observe: 'events',
    });
  }

  createPostWithProgress(content: string, files: File[] = [], isPublic = false) {
    const formData = new FormData();
    formData.append('content', content);
    formData.append('is_public', isPublic ? 'true' : 'false');
    for (const file of files) {
      formData.append('images', file);
    }
    return this.http.post<HttpEvent<any>>(`${this.baseUrl}/posts`, formData, {
      reportProgress: true,
      observe: 'events',
    });
  }

  uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append('avatar', file);
    return this.http.post<{ avatar_url: string }>(
      `${this.baseUrl}/upload-avatar`,
      formData,
      { reportProgress: true, observe: 'events' }
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
    return this.http.get<{
      files: { name: string; path: string; size: number; is_dir: boolean; mod_time: string }[];
      disk: { total: number; used: number; free: number; total_gb: number; used_gb: number; free_gb: number; used_pct: number };
    }>(`${this.baseUrl}/admin/files`);
  }

  getAdminGroupChats() {
    return this.http.get<{ id: number; name: string; created_by: number; created_by_username: string; member_count: number; created_at: string }[]>(
      `${this.baseUrl}/admin/group-chats`
    );
  }

  adminDeleteGroupChat(id: number) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/admin/group-chats/${id}`);
  }

  searchGiphy(query: string, offset = 0, limit = 20) {
    return this.http.get<GiphySearchResponse>(`${this.baseUrl}/giphy/search`, {
      params: { q: query, offset, limit },
    });
  }

  getGiphyTrending(offset = 0, limit = 20) {
    return this.http.get<GiphySearchResponse>(`${this.baseUrl}/giphy/trending`, {
      params: { offset, limit },
    });
  }

  getGiphyKey() {
    return this.http.get<GiphyKeyResponse>(`${this.baseUrl}/admin/settings/giphy-key`);
  }

  updateGiphyKey(key: string) {
    return this.http.put<{ ok: boolean }>(`${this.baseUrl}/admin/settings/giphy-key`, { key });
  }

  // ── Stickers ──

  getStickerPacks() {
    return this.http.get<StickerPack[]>(`${this.baseUrl}/sticker-packs`);
  }

  adminCreateStickerPack(name: string) {
    return this.http.post<{ id: number; name: string }>(`${this.baseUrl}/admin/sticker-packs`, { name });
  }

  adminRenameStickerPack(id: number, name: string) {
    return this.http.put<{ message: string }>(`${this.baseUrl}/admin/sticker-packs/${id}`, { name });
  }

  adminDeleteStickerPack(id: number) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/admin/sticker-packs/${id}`);
  }

  adminUploadSticker(packId: number, file: File) {
    const fd = new FormData();
    fd.append('sticker', file);
    return this.http.post<{ id: number; image_url: string }>(
      `${this.baseUrl}/admin/sticker-packs/${packId}/stickers`, fd,
    );
  }

  adminDeleteSticker(packId: number, stickerId: number) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/admin/sticker-packs/${packId}/stickers/${stickerId}`);
  }

  adminBlockUser(id: number) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/admin/users/${id}/block`, {});
  }

  adminUnblockUser(id: number) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/admin/users/${id}/unblock`, {});
  }

  adminDeleteUser(id: number) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/admin/users/${id}`);
  }

  adminDeleteFile(path: string) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/admin/files`, { body: { path } });
  }

  deleteGroupChat(id: number) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/group-chats/${id}`);
  }

  // ── Backup & Restore ──

  checkHealth() {
    return this.http.get<{ status: string }>(`${this.baseUrl}/health`);
  }

  getBackupSettings() {
    return this.http.get<{ backup_dir: string }>(`${this.baseUrl}/admin/backup/settings`);
  }

  updateBackupSettings(backupDir: string) {
    return this.http.put<{ message: string }>(`${this.baseUrl}/admin/backup/settings`, { backup_dir: backupDir });
  }

  getBackups() {
    return this.http.get<{ filename: string; size_bytes: number; created_at: string }[]>(
      `${this.baseUrl}/admin/backup/backups`
    );
  }

  createBackup() {
    return this.http.post<{ filename: string; size_bytes: number; created_at: string }>(
      `${this.baseUrl}/admin/backup/backup`, {}
    );
  }

  downloadBackupUrl(filename: string): string {
    return `${this.baseUrl}/admin/backup/backups/${filename}`;
  }

  uploadBackup(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ filename: string }>(
      `${this.baseUrl}/admin/backup/backups/upload`,
      fd,
      { reportProgress: true, observe: 'events' }
    );
  }

  deleteBackup(filename: string) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/admin/backup/backups/${filename}`);
  }

  restoreBackup(filename: string) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/admin/backup/backups/${filename}/restore`, {});
  }

  createInvite(maxUses = 1) {
    return this.http.post<{ token: string }>(`${this.baseUrl}/invites`, { max_uses: maxUses });
  }

  getMyInvites() {
    return this.http.get<InviteToken[]>(`${this.baseUrl}/invites`);
  }

  deleteInvite(id: number) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/invites/${id}`);
  }

  checkInvite(token: string) {
    return this.http.get<{ valid: boolean; reason?: string; created_by: number; creator: string }>(
      `${this.baseUrl}/invite/${token}`
    );
  }

  createFriendInvite() {
    return this.http.post<{ token: string }>(`${this.baseUrl}/friend-invites`, {});
  }

  checkFriendInvite(token: string) {
    return this.http.get<{ valid: boolean; reason?: string; created_by: number; creator: string }>(
      `${this.baseUrl}/friend-invite/${token}`
    );
  }

  acceptFriendInvite(token: string) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/friend-invite/${token}/accept`, {});
  }

  getFriends() {
    return this.http.get<User[]>(`${this.baseUrl}/friends`);
  }

  removeFriend(id: number) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/friends/${id}`);
  }

  searchUsers(query: string) {
    return this.http.get<User[]>(`${this.baseUrl}/users/search`, { params: { q: query } });
  }

  sendFriendRequest(userId: number) {
    return this.http.post<{ message: string; auto_accepted?: boolean }>(`${this.baseUrl}/friend-requests/${userId}`, {});
  }

  getFriendRequests() {
    return this.http.get<{ id: number; from_user: number; username: string; avatar_url: string; status: string; created_at: string }[]>(
      `${this.baseUrl}/friend-requests`
    );
  }

  acceptFriendRequest(requestId: number) {
    return this.http.post<{ message: string }>(`${this.baseUrl}/friend-requests/${requestId}/accept`, {});
  }

  rejectFriendRequest(requestId: number) {
    return this.http.delete<{ message: string }>(`${this.baseUrl}/friend-requests/${requestId}`);
  }

  deletePost(id: number) {
    return this.http.delete(`${this.baseUrl}/posts/${id}`);
  }

  toggleReaction(postId: number, emoji: string) {
    return this.http.post<{ action: string; emoji: string }>(
      `${this.baseUrl}/posts/${postId}/react`,
      { emoji }
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
    if (this.wsConnecting) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.ws) this.ws.close();
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = this.accessToken();
    if (!token) return;

    this.wsConnecting = true;

    try {
      this.ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?token=${token}`);
    } catch {
      this.wsConnecting = false;
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.wsConnecting = false;
      this.wsConnected.set(true);
      this.wsRetryCount = 0;
    };

    this.ws.onmessage = (event) => {
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      // Route ALL message types through wsMessages$ for component consumption
      this.wsMessagesSubject.next(data);

      // Also route online/offline events through dedicated subject for convenience
      if (data.type === 'user_online' || data.type === 'user_offline') {
        this.wsOnlineEventSubject.next(data);
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.wsConnecting = false;
      this.wsConnected.set(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {};
  }

  private isJwtExpired(token: string): boolean {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64));
      return Date.now() >= payload.exp * 1000;
    } catch {
      return true;
    }
  }

  private scheduleReconnect(): void {
    if (this.wsReconnecting || this.wsRetryTimer) return;
    if (!this.accessToken()) return;

    this.wsReconnecting = true;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    // After WS_MAX_RETRIES attempts, switch to slow-poll (60s) for PWA support
    const delay = this.wsRetryCount < this.WS_MAX_RETRIES
      ? Math.min(this.WS_INITIAL_RETRY_DELAY * Math.pow(2, this.wsRetryCount), this.WS_MAX_RETRY_DELAY)
      : this.WS_SLOW_POLL_DELAY;
    const jitter = Math.random() * 1000;

    this.wsRetryCount++;
    this.wsRetryTimer = setTimeout(() => {
      this.wsRetryTimer = null;
      this.wsReconnecting = false;

      const token = this.accessToken();
      if (!token) return;

      if (this.isJwtExpired(token)) {
        this.refreshToken().subscribe({
          next: (res) => {
            this.accessToken.set(res.access_token);
            localStorage.setItem('accessToken', res.access_token);
            localStorage.setItem('refreshToken', res.refresh_token);
            this.connectWebSocket();
          },
          error: () => {
            this.logout();
          },
        });
      } else {
        this.connectWebSocket();
      }
    }, delay + jitter);
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

  // E2EE keys
  putKey(publicKey: string) {
    return this.http.put<{ message: string }>(`${this.baseUrl}/keys`, { public_key: publicKey });
  }

  getKey(userId: number) {
    return this.http.get<{ public_key: string }>(`${this.baseUrl}/keys/${userId}`);
  }

  // Group E2EE key shares
  uploadGroupKeyShare(groupId: number, userId: number, encryptedKey: string, iv: string) {
    return this.http.post<{ message: string }>(
      `${this.baseUrl}/group-chats/${groupId}/keys`,
      { user_id: userId, encrypted_key: encryptedKey, iv },
    );
  }

  getMyGroupKeyShare(groupId: number) {
    return this.http.get<{ encrypted_key: string; iv: string }>(
      `${this.baseUrl}/group-chats/${groupId}/my-key`,
    );
  }

  // WebAuthn (FaceID/TouchID)
  webauthnHasCredentials(username: string) {
    return this.http.post<{ has_credentials: boolean }>(
      `${this.baseUrl}/webauthn/has-credentials`,
      { username }
    );
  }

  webauthnBeginRegistration() {
    return this.http.post<{ session_id: string; options: any }>(
      `${this.baseUrl}/webauthn/begin-registration`,
      {}
    );
  }

  webauthnFinishRegistration(sessionId: string, credential: any) {
    return this.http.post<{ message: string }>(
      `${this.baseUrl}/webauthn/finish-registration`,
      { session_id: sessionId, credential }
    );
  }

  webauthnBeginLogin(username: string) {
    return this.http.post<{ session_id: string; options: any }>(
      `${this.baseUrl}/webauthn/begin-login`,
      { username }
    );
  }

  webauthnFinishLogin(sessionId: string, credential: any) {
    return this.http.post<AuthResponse>(
      `${this.baseUrl}/webauthn/finish-login`,
      { session_id: sessionId, credential }
    );
  }

  webauthnListCredentials() {
    return this.http.get<{ id: number; created_at: string }[]>(
      `${this.baseUrl}/webauthn/credentials`
    );
  }

  webauthnRemoveCredential(id: number) {
    return this.http.delete<{ message: string }>(
      `${this.baseUrl}/webauthn/credentials/${id}`
    );
  }

  // Federation admin
  getFederationServers() {
    return this.http.get<any[]>(`${this.baseUrl}/admin/federation/servers`);
  }

  getFederationServer(id: number) {
    return this.http.get<any>(`${this.baseUrl}/admin/federation/servers/${id}`);
  }

  createFederationInvite(maxUses = 1) {
    return this.http.post<{ token: string; invite_url: string }>(
      `${this.baseUrl}/admin/federation/invites`, { max_uses: maxUses }
    );
  }

  connectFederation(inviteUrl: string) {
    return this.http.post<{ message: string }>(
      `${this.baseUrl}/admin/federation/connect`, { invite_url: inviteUrl }
    );
  }

  updateFederationServer(id: number, data: { name?: string; disk_cache_limit?: number }) {
    return this.http.put<{ message: string }>(
      `${this.baseUrl}/admin/federation/servers/${id}`, data
    );
  }

  pingFederationServer(id: number) {
    return this.http.post<{ status: string; message: string }>(
      `${this.baseUrl}/admin/federation/servers/${id}/ping`, {}
    );
  }

  blockFederationServer(id: number) {
    return this.http.post<{ message: string }>(
      `${this.baseUrl}/admin/federation/servers/${id}/block`, {}
    );
  }

  unblockFederationServer(id: number) {
    return this.http.post<{ message: string }>(
      `${this.baseUrl}/admin/federation/servers/${id}/unblock`, {}
    );
  }

  deleteFederationServer(id: number) {
    return this.http.delete<{ message: string }>(
      `${this.baseUrl}/admin/federation/servers/${id}`
    );
  }

  clearFederationCache(serverId: number) {
    return this.http.delete<{ message: string }>(
      `${this.baseUrl}/admin/federation/cache/${serverId}`
    );
  }

  restoreFederation(peerUrl: string) {
    return this.http.post<{ message: string }>(
      `${this.baseUrl}/admin/federation/restore`, { peer_url: peerUrl }
    );
  }

  syncFederationStickers(serverId: number) {
    return this.http.post<{ message: string }>(
      `${this.baseUrl}/admin/federation/servers/${serverId}/sync-stickers`, {}
    );
  }

  // ── Updates ──

  getVersion() {
    return this.http.get<{ version: string }>(`${this.baseUrl}/version`);
  }

  checkUpdate() {
    return this.http.get<{
      update_available: boolean;
      current_version: string;
      latest_version: string;
      download_url: string;
      release_notes_url: string;
      error?: string;
    }>(`${this.baseUrl}/check-update`);
  }

  // ── Device Management ──

  registerDevice(name: string, publicKey: string, deviceId: string) {
    return this.http.post(`${this.baseUrl}/devices/register`, {
      device_name: name,
      device_public_key: publicKey,
      device_id: deviceId,
    });
  }

  getDevices() {
    return this.http.get<any[]>(`${this.baseUrl}/devices`);
  }

  removeDevice(deviceId: string) {
    return this.http.delete(`${this.baseUrl}/devices/${deviceId}`);
  }

  // ── Device Auth Request ──

  createAuthRequest(name: string, publicKey: string, deviceId: string) {
    return this.http.post<{ id: number }>(`${this.baseUrl}/devices/auth-request`, {
      device_name: name,
      device_public_key: publicKey,
      device_id: deviceId,
    });
  }

  getAuthRequests() {
    return this.http.get<any[]>(`${this.baseUrl}/devices/auth-requests`);
  }

  getAuthRequest(id: number) {
    return this.http.get<{ status: string; encrypted_key: string; iv: string }>(
      `${this.baseUrl}/devices/auth/${id}`
    );
  }

  approveAuthRequest(id: number, encryptedKey: string, iv: string) {
    return this.http.post(`${this.baseUrl}/devices/auth/${id}/approve`, {
      encrypted_key: encryptedKey,
      iv,
    });
  }

  denyAuthRequest(id: number) {
    return this.http.delete(`${this.baseUrl}/devices/auth/${id}`);
  }

  // ── Key Backup & Recovery ──

  uploadKeyBackup(encryptedKey: string, iv: string, salt: string, hashIterations = 100000) {
    return this.http.post(`${this.baseUrl}/devices/backup-keys`, {
      encrypted_key: encryptedKey,
      iv,
      salt,
      hash_iterations: hashIterations,
    });
  }

  recoverKeys(method: 'password' | 'phrase', input: string) {
    return this.http.post<{ identity_key_jwk: string }>(`${this.baseUrl}/devices/recover`, {
      method,
      input,
    });
  }

  generateRecoveryPhrase() {
    return this.http.post<{ phrase: string; phrase_hash: string }>(
      `${this.baseUrl}/devices/recovery-phrase`, {}
    );
  }

  setRecoveryPhraseBackup(encryptedKey: string, iv: string, salt: string) {
    return this.http.post(`${this.baseUrl}/devices/recovery-phrase/set`, {
      encrypted_key: encryptedKey,
      iv,
      salt,
    });
  }

  getRecoveryPhraseStatus() {
    return this.http.get<{ has_recovery_phrase: boolean }>(
      `${this.baseUrl}/devices/recovery-phrase`
    );
  }

  // ── Polls ──

  castVote(pollId: number, optionId: number) {
    return this.http.post<{ message: string; options: PollOption[] }>(
      `${this.baseUrl}/polls/${pollId}/vote`,
      { option_id: optionId }
    );
  }

  disconnectWebSocket(): void {
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);
    this.wsRetryTimer = null;
    this.wsReconnecting = false;
    this.wsConnected.set(false);
    this.ws?.close();
    this.ws = null;
  }
}
