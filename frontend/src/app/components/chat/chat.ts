import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, signal, computed, effect, EffectRef, HostListener, inject, Injector, runInInjectionContext, afterNextRender } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, firstValueFrom, fromEvent } from 'rxjs';
import { HttpEventType } from '@angular/common/http';
import { filter } from 'rxjs/operators';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService, User, Message, MsgType, GroupChat, GroupMember, GiphyResult, EnvelopePayload, Poll } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { KeyboardService } from '../../services/keyboard.service';
import { NoticeService } from '../../services/notice.service';
import { ClockService } from '../../services/clock.service';
import { GifPickerComponent } from './gif-picker/gif-picker';
import { StickerPickerComponent } from './sticker-picker/sticker-picker';
import { ChatListComponent } from './chat-list.component';
import { ChatMessagesComponent } from './chat-messages.component';
import { ChatComposerComponent } from './chat-composer.component';
import { ChatStorageService } from '../../services/chat-storage.service';
import { ChatPollService } from '../../services/chat-poll.service';
import { ChatThreadService, DisplayItem } from '../../services/chat-thread.service';
import { ServerCryptoService } from '../../services/server-crypto.service';
import { ChatAttachmentService } from '../../services/chat-attachment.service';
import { ChatSendService, SendRequest } from '../../services/chat-send.service';
import { ChatGroupService } from '../../services/chat-group.service';
import { ChatGroupKeyService } from '../../services/chat-group-key.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [ FormsModule, GifPickerComponent, StickerPickerComponent, ChatListComponent, ChatMessagesComponent, ChatComposerComponent],
  templateUrl: './chat.html',
})
export class ChatComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly notice = inject(NoticeService);
  private readonly storage = inject(ChatStorageService);
  private readonly polls = inject(ChatPollService);
  private readonly thread = inject(ChatThreadService);
  private readonly serverCrypto = inject(ServerCryptoService);
  private readonly attachments = inject(ChatAttachmentService);
  private readonly sends = inject(ChatSendService);
  private readonly groups = inject(ChatGroupService);
  private readonly groupKeys = inject(ChatGroupKeyService);

  users: User[] = [];
  selectedUser: User | null = null;
  messages: Message[] = [];
  messageContent = '';
  messageType: MsgType = 'text';
  msgTypes: { id: MsgType; icon: SafeHtml; label: string }[] = [];

  pollOptions: string[] = ['', ''];
  pollMultiple = false;
  showGifPicker = false;
  showStickerPicker = false;
  mobileChatHeight = computed(() => {
    if (this.keyboardService.isKeyboardOpen()) {
      return 'calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))';
    }
    return 'calc(100dvh - 7rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))';
  });

  openGifPicker() {
    if (!this.giphyHasKey) return;
    this.showGifPicker = true;
  }

  openStickerPicker() {
    this.showStickerPicker = true;
  }

  onStickerSelected(sticker: { id: number; image_url: string } | undefined) {
    this.showStickerPicker = false;
    if (!sticker) return;
    this.messageContent = String(sticker.id);
    this.messageType = 'sticker';
    // Remembered for the optimistic bubble: the template renders sticker_url,
    // and the response only arrives after the request does. finalizeOptimistic
    // still sets it, so a lost/failed URL still ends up correct.
    this.pendingStickerURL = sticker.image_url;
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
    if (id === 'image') {
      this.triggerFileInput();
    }
  }

  // The type menu's open state, its outside-click and Escape handlers live in
  // ChatComposerComponent: they are about the menu, and the menu renders there.

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
  groupFriendCandidates: User[] = [];
  inviteToken = '';
  inviteUrl = '';
  showQR = false;
  private subscriptions: Subscription[] = [];
  // Kept so ngOnDestroy can release them, like the subscriptions above.
  private effects: EffectRef[] = [];
  private readonly injector = inject(Injector);
  private boundaryTimer: ReturnType<typeof setTimeout> | null = null;
  // A group message that failed only because the group key wasn't available yet.
  // Retried automatically once the key arrives (group_key_ready WS event).
  private pendingGroupSend: { content: string; type: MsgType } | null = null;
  // Sticker image URL from the picker, consumed by the next optimistic bubble.
  private pendingStickerURL: string | null = null;
  // Telemetry: conversations we already reported as undecryptable this session.
  private reportedDecryptFailures = new Set<string>();
  uploading = signal(false);

  /**
   * Set when loading the thread failed, so the UI can say so and offer a retry.
   *
   * It did not exist, and that is why a network failure looked like an empty
   * conversation: getMessages has no error callback, so a failed request left
   * the cached messages on screen and scrollToBottom was never called. Coming
   * back onto wifi did not help either - nothing refetched, because the reload
   * hung off visibilitychange (which does not fire when only the network
   * changes) while the websocket reconnect refetched nothing.
   */
  readonly messagesLoadFailed = signal(false);

  /** What actually went wrong, as far as the client can tell. */
  readonly loadFailureReason = signal('Не удалось загрузить сообщения — нет связи или сервер недоступен.');

  private noteLoadFailure(status?: number): void {
    this.messagesLoadFailed.set(true);
    if (status === 401 || status === 403) {
      // The interceptor refreshes the token and retries; if it reaches here the
      // session is gone. Saying "no network" and offering "retry" would send
      // someone looking at their Wi-Fi for a problem that is a login.
      this.loadFailureReason.set('Сессия истекла — нужно войти заново. Повтор не поможет.');
    } else if (status === 404) {
      this.loadFailureReason.set('Чат не найден на сервере.');
    } else if (typeof status === 'number' && status >= 500) {
      this.loadFailureReason.set('Сервер отвечает с ошибкой. Попробуйте ещё раз.');
    } else {
      this.loadFailureReason.set('Не удалось загрузить сообщения — нет связи или сервер недоступен.');
    }
  }

  private noteLoadSuccess(): void {
    this.messagesLoadFailed.set(false);
  }
  uploadProgress = signal(0);
  sendError = signal('');

  @ViewChild('scrollContainerDesktop', { read: ElementRef }) scrollContainerDesktop?: ElementRef<HTMLElement>;
  @ViewChild('scrollContainerMobile', { read: ElementRef }) scrollContainerMobile?: ElementRef<HTMLElement>;
  @ViewChild('threadInnerDesktop', { read: ElementRef }) threadInnerDesktop?: ElementRef<HTMLElement>;
  @ViewChild('threadInnerMobile', { read: ElementRef }) threadInnerMobile?: ElementRef<HTMLElement>;

  get displayMessages(): DisplayItem[] {
    return this.thread.buildDisplayItems(this.messages, this.unreadDividerIdx);
  }

  /**
   * Pins the thread to the bottom, once the layout has settled.
   *
   * The CSS does most of the work: .chat-scroll is a flex column and .thread-inner
   * carries margin-top:auto, so a thread shorter than its container sits against
   * the bottom with no JavaScript at all - and stays there through image loads,
   * font swaps and re-renders, which is where the old version kept missing.
   *
   * What CSS cannot do is scroll: once the thread is taller than the container,
   * margin-top:auto computes to zero and the scroll position is whatever the
   * browser last had. So a thread that overflows - or that started short and grew -
   * still needs one real scroll, which is this. A ResizeObserver on the inner
   * wrapper does it, so it fires whenever anything changes the height without
   * anyone having to remember to call.
   *
   * Both halves are needed. CSS alone jumps from the bottom to the top the moment
   * a short thread overflows; JS alone is what missed the bottom in the first
   * place.
   */
  /**
   * Ids already accepted into `messages`, as a Set.
   *
   * The old check was `this.messages.some(m => m.id === data.id)`, which scans the
   * whole thread on every frame and, worse, ran *before* the decryption awaits. Two
   * frames for the same message arriving back to back both passed the check and
   * both were pushed once their awaits resolved - which is how one message came to
   * be shown three times.
   */
  private seenMessageIds = new Set<number>();

  /** Rebuilds the set from the current thread, e.g. after switching chats. */
  private reindexSeen(): void {
    this.seenMessageIds = new Set(this.messages.map(m => m.id));
  }

  /**
   * Claims an id. Returns false when it is already claimed or was never supplied.
   *
   * Called *after* decryption, immediately before the push, so the window the old
   * code lost between its check and its push is closed. A frame without an id is
   * not deduplicated - the server always sends one, and a synthetic Date.now() id
   * would collide with the next one.
   */
  private claimMessage(id: number | undefined): boolean {
    return this.thread.claim(this.seenMessageIds, id);
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.scrollContainers().forEach(c => c.scrollTo({ top: c.scrollHeight, behavior: 'auto' }));
      });
    });
  }

  private scrollContainers(): HTMLElement[] {
    return [this.scrollContainerDesktop?.nativeElement, this.scrollContainerMobile?.nativeElement]
      .filter((el): el is HTMLElement => !!el && el.offsetParent !== null);
  }

  /**
   * Starts keeping the thread at the bottom, but only while the reader is there.
   *
   * `nearBottom` is tracked from the container's own scroll events, so it holds the
   * answer as it was *before* the thread grew. Reading it inside the resize
   * callback would be too late: the browser has already moved the scroll position
   * and the measurement would say "not at the bottom" for a reader who never left.
   *
   * The consequence is that an incoming message no longer yanks the view down while
   * someone is reading earlier history, which is a change in behaviour and the
   * reason this is a spike.
   */
  private startStickyBottom(): void {
    this.stickyDisposers.forEach(d => d());
    this.stickyDisposers = [];

    this.setupSticky(
      this.scrollContainerDesktop?.nativeElement,
      this.threadInnerDesktop?.nativeElement,
    );
    this.setupSticky(
      this.scrollContainerMobile?.nativeElement,
      this.threadInnerMobile?.nativeElement,
    );
  }

  private setupSticky(container: HTMLElement | undefined, inner: HTMLElement | undefined): void {
    if (!container || !inner || typeof ResizeObserver === 'undefined') return;

    let nearBottom = true;

    const onScroll = () => {
      nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    };
    container.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      if (nearBottom) container.scrollTop = container.scrollHeight;
    });
    observer.observe(inner);
    // The container too, because its height changes without the thread's height
    // changing - and that is exactly what the keyboard does. mobileChatHeight
    // grows the phone layout when isKeyboardOpen flips, which leaves the thread's
    // own size untouched: watching only the inner wrapper would leave the last
    // messages under the keyboard, which is the bug this was meant to end.
    // Same mechanism covers a rotated device and a collapsing browser toolbar.
    observer.observe(container);

    this.stickyDisposers.push(() => {
      container.removeEventListener('scroll', onScroll);
      observer.disconnect();
    });
  }

  private stickyDisposers: Array<() => void> = [];

  giphyHasKey = false;

  constructor(
    protected api: ApiService,
    private route: ActivatedRoute,
    protected router: Router,
    private crypto: CryptoService,
    private sanitizer: DomSanitizer,
    private keyboardService: KeyboardService,
    protected clock: ClockService,
  ) {
    this.msgTypes = this.buildMsgTypes();
    this.api.getGiphyStatus().subscribe({
      next: (res) => this.giphyHasKey = res.has_key,
      error: () => { this.giphyHasKey = false; },
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

  /**
   * Waits for the crypto store to be usable instead of asking whether it is.
   *
   * e2eeReady was set from a .then() and every decryption path consulted it
   * *before* trying, so a message arriving in that window was rendered as
   * "[Зашифрованное сообщение]" and never decrypted afterwards. init() is
   * idempotent (it memoises its promise), so awaiting it is cheap and correct
   * on every path - including the ones that used to check the flag and skip.
   */
  private async cryptoReady(): Promise<void> {
    await this.crypto.init();
    this.e2eeReady = true;
  }

  ngOnInit() {
    this.currentUserId = this.api.currentUser()?.id ?? 0;

    // Warm the store up front so the first decryption does not wait on it, but
    // nothing may branch on the outcome: every consumer awaits cryptoReady().
    this.cryptoReady();

    this.route.paramMap.subscribe((params) => {
      const userId = params.get('userId');
      const groupId = params.get('groupId');
      if (userId || groupId) {
        this.showMobileThread();
      } else {
        this.showMobileChat = false;
      }
      if (groupId && this.groupChats.length > 0) {
        this.resolvePendingGroupChat(Number(groupId));
      } else if (userId && this.users.length > 0) {
        const user = this.users.find((u) => u.id === Number(userId));
        if (user) {
          this.selectUser(user);
        }
      }
    });

    this.subscriptions.push(
      this.api.groupInfoRequest$.subscribe((groupId) => {
        if (this.selectedGroup && groupId === this.selectedGroup.id) {
          this.loadGroupInfo();
        }
      })
    );

    this.loadFromCache();
    this.loadFromServer();
    this.loadGroupChats();
    this.loadIncomingRequests();
    this.listenWsOnlineEvents();

    this.subscriptions.push(
      this.api.wsMessages$.subscribe(async (data: any) => {
        if (data.type === 'message' && this.selectedUser && (data.from === this.selectedUser.id || data.from === this.currentUserId)) {
          // Skip own messages (already handled via optimistic send + API response)
          if (data.from === this.currentUserId) return;
          let content = data.content;
          let decryptedOk = true;
          if (data.env_content && data.envelopes?.length) {
            const viaEnv = await this.crypto.decryptViaEnvelope(data.envelopes, data.env_content, data.env_iv, data.from, data.sender_device_id);
            if (viaEnv !== null) content = viaEnv;
          }
          if (!content && data.encrypted_content && data.encrypted_iv) {
            decryptedOk = false;
            await this.cryptoReady();
            const decrypted = await this.crypto.decrypt(this.currentUserId, data.from, data.encrypted_content, data.encrypted_iv);
            if (decrypted !== null) { content = decrypted; decryptedOk = true; }
            if (!content) content = '[Зашифрованное сообщение]';
          }
          if (!decryptedOk) this.reportDecryptFailure('dm', { peer_id: data.from, msg_type: data.msg_type });
          // Claimed here, after decryption and immediately before the push. Three
          // frames for one message arrive nearly together; each awaits the key
          // first, and they would all have passed a check made before those awaits.
          if (!this.claimMessage(data.id)) return;
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
            // The fields above are copied one by one, and sticker_url was not in
            // the list: a sticker arriving over the socket became a bubble with an
            // <img> pointing at undefined - invisible until the thread was
            // reloaded from GET /api/messages, which does return it.
            sticker_url: data.sticker_url,
          };
          this.messages.push(msg);
          this.messages = [...this.messages];
          this.persistCache(this.selectedUser.id);
          this.scrollToBottom();
          if (data.id && !document.hidden) {
            this.api.markMessagesRead([data.id], this.selectedUser.id).subscribe({
              next: () => { msg.is_read = true; },
              error: () => {},
            });
          }
        }
        if (data.type === 'group_message' && this.selectedGroup && data.group_id === this.selectedGroup.id) {
          // Skip own messages (already handled via optimistic send + API response)
          if (data.from === this.currentUserId) return;
          let content = data.content;
          if (data.encrypted_content && data.encrypted_iv) {
            let decryptedOk = false;
            await this.cryptoReady();
            const decrypted = await this.crypto.decryptGroupMessage(data.group_id, data.encrypted_content, data.encrypted_iv, data.epoch ?? 0);
            if (decrypted !== null) { content = decrypted; decryptedOk = true; }
            if (!content) content = '[Зашифрованное сообщение]';
            if (!decryptedOk) this.reportDecryptFailure('group', { group_id: data.group_id, msg_type: data.msg_type });
          }
          // Same reason as in direct messages: claim after the awaits, before the push.
          if (!this.claimMessage(data.id)) return;
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
            // Same omission as in the direct-chat branch above.
            sticker_url: data.sticker_url,
          };
          this.messages.push(msg);
          this.messages = [...this.messages];
          this.scrollToBottom();
          if (!document.hidden) {
            const gid = this.selectedGroup.id;
            this.api.markGroupRead(gid).subscribe({ error: () => {} });
            this.api.clearGroupUnread(gid);
          }
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
        if ((data.type === 'group_member_added' || data.type === 'group_key_request') && data.group_chat_id) {
          // Someone needs the group key — share it if this client holds it.
          this.distributeGroupKeyToMember(data.group_chat_id, data.user_id);
        }
        if (data.type === 'group_key_ready' && this.selectedGroup && data.group_chat_id === this.selectedGroup.id) {
          this.onGroupKeyReady(data.group_chat_id);
        }
        if (data.type === 'device_revoked') {
          this.rotateGroupKeys(data.device_id);
        }
        if (data.type === 'mark_read') {
          for (const m of this.messages) {
            if (data.message_ids.includes(m.id)) m.is_read = true;
          }
          if (this.selectedUser) {
            this.persistCache(this.selectedUser.id);
          }
        }
      })
    );

    // Multi-tab: reload messages when tab becomes visible (catches up on messages
    // sent from other tabs while this tab was in background)
    this.subscriptions.push(
      fromEvent(document, 'visibilitychange').subscribe(() => {
        // Either kind of open thread, not just direct chats: a group left open in
        // a background tab missed every frame sent while it was hidden.
        if (document.visibilityState === 'visible' && (this.selectedUser || this.selectedGroup)) {
          this.reloadOpenThread();
        }
      })
    );

    // Coming back from a dead network. visibilitychange does not cover this: moving
    // between LTE and wifi changes the network while the tab stays visible, so no
    // event fires and a thread that failed to load simply stayed at the top of the
    // cache. The websocket reconnect that eventually succeeded refetched nothing
    // either - it only reopened the socket - and by then the other side had not sent
    // anything new, so there was no frame to catch up from.
    //
    // wsConnected is the signal that flips on recovery. It is filtered to false ->
    // true so the initial connect does not refetch a thread that was just loaded.
    let wasConnected = this.api.wsConnected();
    let everConnected = wasConnected;
    // runInInjectionContext because effect() throws outside one, and ngOnInit is
    // not one - the compiler accepts this and the runtime does not.
    this.effects.push(
      runInInjectionContext(this.injector, () =>
        effect(() => {
          const connected = this.api.wsConnected();
          // Two cases, and the signal alone cannot tell them apart: the socket
          // opening for the first time on a normal launch, and the socket opening
          // for the first time *because the phone was offline when the app
          // started*. Both are false -> true with no prior connection.
          //
          // They differ in what needs doing about it. The first has just loaded
          // the thread and wants nothing. The second left a thread stuck at the
          // top of its cache, and a failed load is the thing that says so - either
          // the load failed, or we had a working session that dropped.
          if (connected && !wasConnected && (everConnected || this.messagesLoadFailed())) {
            this.reloadOpenThread();
          }
          if (connected) everConnected = true;
          wasConnected = connected;
        })
      )
    );
  }

  /**
   * Refetches the open thread and settles it at the bottom.
   *
   * Shared by the visibility handler and the reconnect handler: both mean the same
   * thing, "you may be looking at something stale".
   */
  private reloadOpenThread(): void {
    const user = this.selectedUser;
    if (this.selectedGroup) {
      this.reloadOpenGroup();
      return;
    }
    if (!user) return;

    this.api.getMessages(this.currentUserId, user.id).subscribe({
      next: async (msgs: Message[]) => {
        // Cleared here, not only in selectUser: a recovery that arrives over the
        // websocket goes through this path, and without it the "failed to load"
        // banner stayed up over messages that had just loaded.
        this.noteLoadSuccess();
        const existingIds = new Set(this.messages.map(m => m.id));
        for (const msg of msgs) {
          if (!existingIds.has(msg.id)) {
            // Claim as well: the WS frame for one of these may arrive right after
            // the load, and the index has to already know about it.
            this.seenMessageIds.add(msg.id);
            this.messages.push(await this.decryptMsg(msg, user.id));
          } else {
            const existing = this.messages.find(m => m.id === msg.id);
            if (existing) existing.is_read = msg.is_read;
          }
        }
        // Scrolled regardless of whether anything was new. After a failed load the
        // retry can return the same rows, and the thread still has to end up at the
        // bottom - the alternative was a thread stuck at the top of its own cache.
        if (msgs.length > 0) {
          this.messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          this.persistCache(user.id);
        }
        this.scrollToBottom();

        const unreadIds = this.messages.filter(m => m.from_user_id === user.id && !m.is_read).map(m => m.id);
        if (unreadIds.length > 0) {
          this.api.markMessagesRead(unreadIds, user.id).subscribe({
            error: () => {},
            next: () => {
              for (const m of this.messages) {
                if (unreadIds.includes(m.id)) m.is_read = true;
              }
            },
          });
        }
      },
      error: (err) => this.noteLoadFailure(err?.status),
    });
  }

  /**
   * The group counterpart of reloadOpenThread, and the fix for messages that
   * only ever arrived as a push.
   *
   * A push is sent exactly when the WS write failed, so the frame was never
   * delivered and nothing put the message into `messages`. The direct-chat
   * recovery above covered that case; this one used to bail out on
   * `this.selectedGroup`, leaving the group thread stale until the user
   * re-selected it or reloaded the page.
   *
   * Merged rather than replaced, and the unread boundary is recomputed the same
   * way selectGroup does it: this runs while a thread is open, so the optimistic
   * sends in flight have to survive it.
   */
  private reloadOpenGroup(): void {
    const group = this.selectedGroup;
    if (!group) return;

    this.api.getGroupMessages(group.id).subscribe({
      error: (err) => this.noteLoadFailure(err?.status),
      next: async (msgs: Message[]) => {
        this.noteLoadSuccess();
        // Decrypt only what we do not already have, then let the shared merge
        // sort and place it. This used to be a near-copy of the direct-chat
        // refetch, and the copies could drift.
        const known = new Set(this.messages.map(m => m.id));
        const fresh = msgs.filter(m => !known.has(m.id));
        for (let i = 0; i < fresh.length; i++) {
          fresh[i] = await this.decryptGroupMsg(fresh[i], group.id);
        }
        const merged = this.thread.mergeMessages(this.messages, await this.serverCrypto.openMany(fresh));
        for (const id of merged.addedIds) this.seenMessageIds.add(id);
        this.messages = merged.messages;
        if (!document.hidden) {
          this.api.markGroupRead(group.id).subscribe({ error: () => {} });
          this.api.clearGroupUnread(group.id);
        }
        this.scrollToBottom();
      },
    });
  }

  private loadFromCache() {
    const users = this.storage.readUsers();
    if (users.length > 0) {
      this.users = users.filter((u) => u.id !== this.currentUserId);
    }
    const pins = this.storage.readPinnedIds();
    if (pins.length > 0) {
      this.pinnedIds = new Set<number>(pins);
    }
    // Opening a deep link such as /chat/2 must work offline. resolvePendingChat
    // used to be called only from the successful branch of getUsers, so with no
    // network it never ran at all - the friend row was right there on screen and
    // the chat pane stayed on "choose a chat".
    this.resolvePendingChat();
  }

  private loadFromServer() {
    // Error callbacks throughout: without them a failed request threw out of the
    // subscription and surfaced as an unhandled error in the console, which is
    // what the offline case looks like - not as "no connection", as a stream of
    // AppErrors. The cached lists stay on screen instead.
    this.api.getUsers().subscribe({
      next: (users: User[]) => {
        this.users = users.filter((u) => u.id !== this.currentUserId);
        this.storage.writeUsers(users);
        this.resolvePendingChat();
      },
      error: () => this.resolvePendingChat(),
    });
    this.api.getPinned().subscribe({
      next: (res) => {
        this.pinnedIds = new Set(res.pinned_user_ids);
        this.storage.writePinnedIds(res.pinned_user_ids);
      },
      error: () => {},
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

  /**
   * Switches the phone layout to the thread view and re-wires the sticky bottom.
   *
   * The mobile container only exists once showMobileChat is set, which on a phone
   * happens *after* ngAfterViewInit has run - so wiring there alone leaves the
   * phone thread without an observer. afterNextRender waits for the container to
   * actually be in the DOM.
   */
  private showMobileThread(): void {
    this.showMobileChat = true;
    runInInjectionContext(this.injector, () => {
      afterNextRender(() => this.startStickyBottom());
    });
  }

  ngAfterViewInit(): void {
    // After the view exists, so the two scroll containers and their wrappers can be
    // measured and observed. The desktop layout is hidden by CSS on a phone and the
    // mobile one hidden on a desktop, hence the offsetParent check inside.
    this.startStickyBottom();
  }

  ngOnDestroy() {
    this.stickyDisposers.forEach(d => d());
    this.stickyDisposers = [];
    this.effects.forEach(e => e.destroy());
    this.effects = [];
    this.api.chatHeaderInfo.set(null);
    for (const sub of this.subscriptions) sub.unsubscribe();
    if (this.boundaryTimer) clearTimeout(this.boundaryTimer);
  }

  /** Best-effort telemetry when a message can't be decrypted (migration safety net). */
  private async reportDecryptFailure(scope: 'dm' | 'group', opts: { peer_id?: number; group_id?: number; msg_type?: string } = {}) {
    const key = `${scope}:${opts.peer_id ?? 0}:${opts.group_id ?? 0}`;
    if (this.reportedDecryptFailures.has(key) || this.reportedDecryptFailures.size >= 30) return;
    this.reportedDecryptFailures.add(key);
    let detail = 'decrypt_failed';
    try {
      if (scope === 'dm' && opts.peer_id) {
        detail = (await this.crypto.fetchPeerPublicKey(opts.peer_id)) ? 'decrypt_failed' : 'no_peer_key';
      } else if (scope === 'group' && opts.group_id) {
        detail = (await this.crypto.getGroupKey(opts.group_id)) ? 'decrypt_failed' : 'no_group_key';
      }
    } catch {}
    this.api.reportDecryptFailure({ scope, ...opts, detail }).subscribe({ error: () => {} });
  }

  private async decryptMsg(msg: Message, peerId: number): Promise<Message> {
    if (msg.env_content && msg.envelopes?.length) {
      const viaEnv = await this.crypto.decryptViaEnvelope(msg.envelopes, msg.env_content, msg.env_iv, msg.from_user_id, msg.sender_device_id);
      if (viaEnv !== null) {
        msg.content = viaEnv;
        return msg;
      }
    }
    if (msg.encrypted_content && msg.encrypted_iv) {
      const decrypted = await this.crypto.decrypt(this.currentUserId, peerId, msg.encrypted_content, msg.encrypted_iv);
      if (decrypted !== null) {
        msg.content = decrypted;
      } else {
        if (!msg.content) msg.content = '[Зашифрованное сообщение]';
        this.reportDecryptFailure('dm', { peer_id: peerId, msg_type: msg.msg_type });
      }
    }
    return msg;
  }

  private persistCache(peerId: number) {
    this.storage.writeMessages(this.currentUserId, peerId, this.messages);
  }

  selectUser(user: User) {
    this.selectedUser = user;
    this.selectedGroup = null;
    this.api.chatHeaderInfo.set({ type: 'user', id: user.id, name: user.username, avatar_url: user.avatar_url, is_admin: user.is_admin });

    const boundary = this.api.unreadBoundaries()[user.id] ?? null;
    this.api.clearUnread(user.id);

    this.messages = this.storage.readMessages(this.currentUserId, user.id);
    // Switching threads replaces the list wholesale, so the index of claimed ids
    // has to follow it - otherwise ids from the previous chat would suppress
    // messages in this one.
    this.reindexSeen();

    this.noteLoadSuccess();
    this.api.getMessages(this.currentUserId, user.id).subscribe({
      next: async (msgs: Message[]) => {
      for (let i = 0; i < msgs.length; i++) {
        msgs[i] = await this.decryptMsg(msgs[i], user.id);
      }
      // Merge with existing messages (e.g. optimistic sends) to avoid race conditions
      const merged = this.thread.mergeMessages(this.messages, await this.serverCrypto.openMany(msgs));
      for (const id of merged.addedIds) this.seenMessageIds.add(id);
      this.messages = merged.messages;
      this.persistCache(user.id);
      if (boundary) {
        const idx = this.messages.findIndex(m => new Date(m.created_at) >= new Date(boundary));
        this.unreadDividerIdx = idx >= 0 ? idx : -1;
        if (this.boundaryTimer) clearTimeout(this.boundaryTimer);
        this.boundaryTimer = setTimeout(() => {
          this.api.clearUnreadBoundary(user.id);
          this.boundaryTimer = null;
        }, 30000);
      } else {
        this.unreadDividerIdx = -1;
      }
      // Unconditionally, not only when the response had rows: after a failed load
      // the retry that succeeds can legitimately return nothing new, and the
      // thread still has to settle at the bottom.
      this.scrollToBottom();
      // Mark received messages as read
      const unreadIds = msgs.filter(m => m.from_user_id === user.id && !m.is_read).map(m => m.id);
      if (unreadIds.length > 0) {
        this.api.markMessagesRead(unreadIds, user.id).subscribe({
          error: () => {},
          next: () => {
            for (const m of this.messages) {
              if (unreadIds.includes(m.id)) m.is_read = true;
            }
          },
        });
      }
      },
      error: () => {
        // Without this the failure was invisible: the callback above never ran, so
        // scrollToBottom was never called and the cached thread stayed put looking
        // like the whole conversation rather than like a failure.
        this.noteLoadFailure();
      },
    });
  }

  /** Retries the thread that failed to load. */
  retryLoadMessages(): void {
    const group = this.selectedGroup;
    if (group) {
      this.reloadOpenGroup();
      return;
    }
    const user = this.selectedUser;
    if (user) this.selectUser(user);
  }

  openChat(user: User) {
    this.selectedGroup = null;
    // Navigate only when the route actually changes. Angular ignores navigation to
    // the route you are already on, so clicking the open conversation did nothing
    // at all - no reload of the thread, no error, just no response to the click.
    if (this.selectedUser?.id !== user.id || this.router.url !== `/chat/${user.id}`) {
      this.router.navigate(['/chat', user.id]);
    }
    if (this.selectedUser?.id === user.id) {
      this.reloadOpenThread();
    }
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
    this.storage.writePinnedIds([...this.pinnedIds]);
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

  /**
   * Enter sends, Shift+Enter inserts a newline.
   *
   * This was an `<input>`, which has no newline at all - so "new paragraph" on a
   * phone was impossible and Enter was the only way out. It was reported as an
   * iPhone problem; it was not one, and no iOS setting changes it.
   *
   * keydown rather than keyup: keyup fires after the character is already in the
   * field, which meant the newline stayed behind on every send.
   */
  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    // A hardware keyboard: Enter sends, Shift+Enter is a paragraph break.
    if (!this.usesSoftwareKeyboard()) {
      if (event.shiftKey) return;
      event.preventDefault();
      this.sendMessage();
      return;
    }
    // A phone keyboard has no Shift, so Shift+Enter is unreachable and Enter is
    // the only way to break a line. Taking Enter for "send" left no way to make a
    // paragraph at all - which is what iOS users reported. Enter inserts the
    // newline there; the send button sends.
  }

  /**
   * Whether the on-screen keyboard is the thing being used.
   *
   * A coarse pointer means touch, and touch means the software keyboard, which has
   * no modifiers. A desktop with a touchscreen reports both; there a real keyboard
   * is present too, so Enter can safely send - the pointer check is on its own not
   * enough, hence the hover test, which only a device with a real pointer passes.
   */
  private usesSoftwareKeyboard(): boolean {
    return window.matchMedia('(pointer: coarse)').matches
      && !window.matchMedia('(hover: hover)').matches;
  }

  /** Grows with the content up to the CSS max-height, then scrolls. */
  autoGrowComposer(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

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
        // Silently returning left the user pressing send and seeing nothing.
        // The banner lives in the poll branch too, because the normal one is in
        // the @else and is not rendered while composing a poll.
        this.sendError.set('В опросе нужно минимум два варианта');
        return;
      }
    }

    const rawContent = this.messageContent;
    const files = [...this.selectedFiles];
    const previewUrls = [...this.previews];

    this.sendError.set('');

    const req: SendRequest = {
      target: this.selectedGroup
        ? { groupId: this.selectedGroup.id }
        : { userId: this.selectedUser!.id },
      currentUserId: this.currentUserId,
      content: rawContent,
      msgType: type,
      files,
      pollOptions: type === 'poll' ? this.pollOptions.filter(o => o.trim()) : undefined,
      pollMultiple: this.pollMultiple,
    };

    const prep = await this.sends.prepare(req);
    if (!prep.ok) {
      this.sending = false;
      if (prep.reason === 'no-group-key') {
        // Ask the members for the key and retry by itself; this is not an error
        // the user caused, so it must not look like a dead end.
        this.pendingGroupSend = { content: rawContent, type };
        this.api.requestGroupKey(req.target.groupId!).subscribe({ error: () => {} });
        this.sendError.set('Нет ключа чата. Запросили у участников — отправим автоматически…');
      } else if (prep.reason === 'no-account-key') {
        // The password is only in hand at sign-in, so there is no way to create
        // the key from here. Saying what to do beats "encryption failed".
        this.sendError.set('Шифрование включилось недавно. Выйдите и войдите снова — после входа ключ создастся, и сообщение отправится.');
      } else {
        this.sendError.set('Не удалось зашифровать: у собеседника нет ключа шифрования');
      }
      return;
    }

    // Optimistic bubble: the user sees the message before the server answers.
    const tempId = Date.now();
    const optimisticMsg: Message = {
      id: tempId,
      from_user_id: this.currentUserId,
      to_user_id: this.selectedUser?.id ?? 0,
      content: rawContent,
      msg_type: type,
      created_at: new Date().toISOString(),
      from_user: this.api.currentUser()?.username ?? '',
      pending: true,
      images: type === 'image' ? previewUrls.map(p => ({ id: 0, image_url: p })) : undefined,
      sticker_url: type === 'sticker' ? (this.pendingStickerURL ?? undefined) : undefined,
    };
    if (this.selectedGroup) {
      optimisticMsg.group_chat_id = this.selectedGroup.id;
    }
    this.messages.push(optimisticMsg);
    this.messages = [...this.messages];
    if (this.selectedUser) {
      this.persistCache(this.selectedUser.id);
    }
    this.messageContent = '';
    this.pendingStickerURL = null;
    this.clearFiles();
    this.scrollToBottom();

    if (files.length > 0) {
      this.uploading.set(true);
      this.uploadProgress.set(0);
    }

    this.sends.deliver(req, prep.prepared).subscribe({
      next: (event) => {
        if (event.type === 'progress') {
          this.uploadProgress.set(event.percent);
          return;
        }
        this.uploading.set(false);
        this.finalizeOptimistic(tempId, event.body);
      },
      error: () => {
        this.uploading.set(false);
        this.rollbackOptimistic(tempId);
      },
    });

    if (type === 'poll' || type === 'sticker') {
      this.pollOptions = ['', ''];
      this.pollMultiple = false;
      this.messageType = 'text';
    }
    if (type === 'image') {
      this.messageType = 'text';
    }
    this.resetComposerHeight();
  }

  /** An empty composer must be one row tall again, not stay stretched. */
  private resetComposerHeight(): void {
    const els = document.querySelectorAll<HTMLTextAreaElement>('textarea[rows="1"]');
    els.forEach((el) => {
      el.style.height = 'auto';
      el.style.height = '';
    });
  }

  private finalizeOptimistic(tempId: number, server?: any) {
    this.sending = false;
    const found = this.thread.finalizeOptimistic(this.messages, this.seenMessageIds, tempId, server);
    if (found && this.selectedUser) {
      this.persistCache(this.selectedUser.id);
    }
  }

  private rollbackOptimistic(tempId: number) {
    this.sending = false;
    const removed = this.thread.rollbackOptimistic(this.messages, this.seenMessageIds, tempId);
    if (removed && this.selectedUser) {
      this.persistCache(this.selectedUser.id);
    }
  }

  async onPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files = await this.attachments.fromClipboard(
      items, this.attachments.remainingSlots(this.selectedFiles.length));
    for (const mem of files) {
      this.selectedFiles.push(mem);
      this.previews.push(await this.attachments.readPreview(mem));
    }
    if (files.length > 0) {
      event.preventDefault();
      if (this.messageType !== 'image') {
        this.messageType = 'image';
      }
    }
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    const files = await this.attachments.fromFileList(
      input.files, this.attachments.remainingSlots(this.selectedFiles.length));
    for (const mem of files) {
      this.selectedFiles.push(mem);
      this.previews.push(await this.attachments.readPreview(mem));
    }
    input.value = '';
  }

  /**
   * Reads the file for the composer preview.
   *
   * Returns the data URL rather than pushing it: `reader.onload` fires after
   * the current turn, and sending in the same turn used to copy `previews`
   * before any of them existed - so the optimistic bubble went out with no
   * images and stayed blank until a reload. Awaited by the picker before it
   * returns, which is what puts the images in the bubble.
   */
  removeFile(index: number) {
    this.selectedFiles.splice(index, 1);
    this.previews.splice(index, 1);
    if (this.selectedFiles.length === 0 && this.messageType === 'image') {
      this.messageType = 'text';
    }
  }

  private clearFiles() {
    this.selectedFiles = [];
    this.previews = [];
    if (this.messageType === 'image') {
      this.messageType = 'text';
    }
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
    this.polls.castVote(pollId, optionId).subscribe({
      next: (res) => this.polls.applyPollData(this.messages, pollId, res.options),
    });
  }

  computeTotalVotes(poll: Poll): number {
    return this.polls.computeTotalVotes(poll);
  }

  private handlePollUpdate(data: any) {
    if (data.poll_id) {
      this.polls.applyPollData(this.messages, data.poll_id, data.options);
    }
  }

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;
  triggerFileInput() {
    this.fileInputRef?.nativeElement.click();
  }

  /** Full-screen viewer. Opening a new tab loses the conversation and, on a
   *  phone, drops the user out of the PWA entirely. */
  readonly viewerUrl = signal<string | null>(null);

  openImage(url: string) {
    this.viewerUrl.set(url);
  }

  closeViewer() {
    this.viewerUrl.set(null);
  }

  @HostListener('document:keydown.escape')
  onViewerEscape() {
    if (this.viewerUrl()) this.closeViewer();
  }

  encodeURI(url: string): string {
    return encodeURIComponent(url);
  }

  // Group chat methods
  async selectGroup(group: GroupChat) {
    this.selectedGroup = group;
    this.selectedUser = null;
    this.showMobileThread();
    this.api.chatHeaderInfo.set({ type: 'group', id: group.id, name: group.name });
    this.router.navigate(['/chat', 'group', group.id]);

    const boundary = this.api.groupUnreadBoundaries()[group.id] ?? null;
    this.api.clearGroupUnread(group.id);
    this.api.markGroupRead(group.id).subscribe({ error: () => {} });

    // Sync the newest key epoch, ensure we have the group key, and distribute.
    // Awaited rather than guarded by the readiness flag: opening a group right
    // after login used to skip this whole block, so the thread loaded with no
    // key available and came back encrypted.
    await this.cryptoReady();
    {
      const keyState = await this.groupKeys.syncEpoch(group.id);
      if (keyState.hadKey) {
        this.groupKeys.distributeToMembers(group.id, this.currentUserId);
        this.refreshOwnGroupKeyShare(group.id);
      } else {
        // No key and nobody asked for it. The request used to be sent only when
        // *sending* failed to encrypt - so a member who only ever read the chat
        // never got one, and the thread stayed "[Зашифрованное сообщение]"
        // forever, across reloads and re-logins.
        this.groupKeys.requestKeyOnce(group.id);
      }
    }

    this.messages = [];
    this.reindexSeen();
    this.api.getGroupMessages(group.id).subscribe({
      error: (err) => {
        // Same bug the direct chats had: a failed request never reached the
        // callback, so nothing scrolled and the thread sat at the top looking
        // empty. The banner and its retry belong to the group thread too.
        this.noteLoadFailure(err?.status);
      },
      next: async (msgs: Message[]) => {
      this.noteLoadSuccess();
      for (let i = 0; i < msgs.length; i++) {
        msgs[i] = await this.decryptGroupMsg(msgs[i], group.id);
      }
      // Merge with existing messages (e.g. optimistic sends) to avoid race conditions
      const merged = this.thread.mergeMessages(this.messages, await this.serverCrypto.openMany(msgs));
      for (const id of merged.addedIds) this.seenMessageIds.add(id);
      this.messages = merged.messages;
      if (boundary) {
        const idx = this.messages.findIndex(m => new Date(m.created_at) >= new Date(boundary));
        this.unreadDividerIdx = idx >= 0 ? idx : -1;
        if (this.boundaryTimer) clearTimeout(this.boundaryTimer);
        this.boundaryTimer = setTimeout(() => {
          this.api.clearGroupUnreadBoundary(group.id);
          this.boundaryTimer = null;
        }, 30000);
      } else {
        this.unreadDividerIdx = -1;
      }
      this.scrollToBottom();
      },
    });
  }

  /**
   * Asks the other members for the group key when we are only reading.
   *
   * Once per group per session: the request goes out over the websocket to every
   * member with an open socket, and re-sending it on every reload or every chat
   * switch would have each of them re-wrap the key for us all over again.
   * `group_key_ready` clears the flag when the key actually lands.
   */
  private requestGroupKeyForRead(groupId: number) {
    this.groupKeys.requestKeyOnce(groupId);
  }

  private async distributeGroupKeyToMembers(groupId: number) {
    await this.groupKeys.distributeToMembers(groupId, this.currentUserId);
  }

  /**
   * Rotate group keys to a new epoch and distribute them to all remaining
   * devices, excluding the revoked one. This cryptographically revokes a removed
   * device from future group messages.
   */
  private async rotateGroupKeys(revokedDeviceId: string) {
    await this.cryptoReady();
    try {
      const groups = await firstValueFrom(this.api.getGroupChats());
      for (const g of groups) {
        const currentEpoch = await this.crypto.getCurrentGroupEpoch(g.id);
        const have = await this.crypto.getRawGroupKey(g.id, currentEpoch);
        if (!have) continue; // not a key holder for this group
        const newEpoch = currentEpoch + 1;
        const newRaw = await this.crypto.generateGroupKey(g.id, newEpoch);
        if (!newRaw) continue;
        const info = await firstValueFrom(this.api.getGroupChat(g.id));
        for (const member of info.members) {
          const devices = await firstValueFrom(this.api.getUserDeviceKeys(member.user_id));
          for (const d of devices || []) {
            if (!d.device_id || !d.device_public_key || d.device_id === revokedDeviceId) continue;
            const wrapped = await this.crypto.wrapKeyForDeviceFromDevice(newRaw, d.device_public_key);
            if (wrapped) {
              this.api.uploadGroupDeviceKeyShare(g.id, member.user_id, d.device_id, wrapped.wrapped_key, wrapped.iv, newEpoch)
                .subscribe({ error: () => {} });
            }
          }
        }
      }
    } catch {}
  }

  /**
   * Re-publish our own group-key share for the current identity key. After a new
   * device is linked (it adopts the same identity key) this is what lets it fetch
   * and decrypt the group key; the original self-share can be stale after a key
   * reset. No-op if we don't hold the raw group key.
   */
  private async refreshOwnGroupKeyShare(groupId: number) {
    try {
      const epoch = await this.crypto.getCurrentGroupEpoch(groupId);
      const raw = await this.crypto.getRawGroupKey(groupId, epoch);
      if (!raw) return;
      const share = await this.crypto.encryptGroupKeyForPeer(raw, this.currentUserId);
      if (share) {
        this.api.uploadGroupKeyShare(groupId, this.currentUserId, share.encrypted_key, share.iv)
          .subscribe({ error: () => {} });
      }
    } catch {}
  }

  /** Encrypt the group key for a single member (used on key requests / member add). */
  private async distributeGroupKeyToMember(groupId: number, memberId: number) {
    if (!memberId || memberId === this.currentUserId) return;
    await this.cryptoReady();
    try {
      const epoch = await this.crypto.getCurrentGroupEpoch(groupId);
      const raw = await this.crypto.getRawGroupKey(groupId, epoch);
      if (!raw) return; // we don't have the key — someone else will share it
      const share = await this.crypto.encryptGroupKeyForPeer(raw, memberId);
      if (share) {
        this.api.uploadGroupKeyShare(groupId, memberId, share.encrypted_key, share.iv)
          .subscribe({ error: () => {} });
      }
      await this.groupKeys.distributeToMemberDevices(groupId, memberId, raw, epoch);
    } catch {}
  }

  /**
   * A group key became available (e.g. another linked device just published the
   * self-share): retry any blocked send and re-decrypt history that was shown
   * as encrypted.
   */
  private async onGroupKeyReady(groupId: number) {
    // The key we asked for is here, so a later loss must be able to ask again.
    this.groupKeys.allowRequest(groupId);
    this.retryPendingGroupSend();
    if (!this.messages.some(m => m.content === '[Зашифрованное сообщение]')) return;
    // Picks up a possibly newer epoch and reports whether a usable key exists.
    const keyState = await this.groupKeys.syncEpoch(groupId);
    if (!keyState.hadKey) return;
    this.api.getGroupMessages(groupId).subscribe({
      error: (err) => this.noteLoadFailure(err?.status),
      next: async (msgs: Message[]) => {
      this.noteLoadSuccess();
      for (let i = 0; i < msgs.length; i++) {
        msgs[i] = await this.decryptGroupMsg(msgs[i], groupId);
      }
      this.messages = msgs;
      this.scrollToBottom();
      },
    });
  }

  /** Retry a group message that was blocked on a missing key. */
  private retryPendingGroupSend() {
    const pending = this.pendingGroupSend;
    if (!pending || !this.selectedGroup) return;
    this.pendingGroupSend = null;
    this.messageContent = pending.content;
    this.messageType = pending.type;
    this.sendError.set('');
    this.sendMessage();
  }

  private async decryptGroupMsg(msg: Message, groupId: number): Promise<Message> {
    if (msg.encrypted_content && msg.encrypted_iv) {
      // Awaited, not tested: a thread loaded before init() finished used to skip
      // decryption entirely and render every message as encrypted.
      await this.cryptoReady();
      const decrypted = await this.crypto.decryptGroupMessage(groupId, msg.encrypted_content, msg.encrypted_iv, msg.epoch ?? 0);
      if (decrypted !== null) {
        msg.content = decrypted;
      } else {
        if (!msg.content) msg.content = '[Зашифрованное сообщение]';
        this.reportDecryptFailure('group', { group_id: groupId, msg_type: msg.msg_type });
      }
    }
    return msg;
  }

  async createGroup() {
    if (!this.newGroupName.trim()) return;
    this.groups.create(this.newGroupName.trim()).subscribe({
      // A creation that failed must say so, otherwise the dialog closes on a
      // success that never happened.
      error: (err) => this.notice.show(err?.error?.error || 'Не удалось создать группу.', 'error'),
      next: async (res) => {
        this.showCreateGroup = false;
        this.newGroupName = '';
        this.loadGroupChats();

        // Generate E2EE group key and upload share for self.
        // Awaited: creating a group in the first moments after login used to
        // leave it with no key at all - and that group stays undecryptable for
        // everyone, since nobody has a key to share.
        await this.cryptoReady();
        {
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
    this.groups.list().subscribe({
      // An offline sidebar is not a reason to throw out of the subscription: the
      // cached list stays and the failure is not a blank panel.
      error: () => {},
      next: (groups: GroupChat[]) => {
      this.groupChats = groups;
      const groupId = this.route.snapshot.paramMap.get('groupId');
      if (groupId && !this.selectedGroup) {
        this.resolvePendingGroupChat(Number(groupId));
      }
      },
    });
  }

  loadGroupInfo() {
    if (!this.selectedGroup) return;
    this.groups.get(this.selectedGroup.id).subscribe({
      error: () => { this.showGroupInfo = false; },
      next: (res) => {
      this.groupMembers = res.members;
      this.showGroupInfo = true;
      this.loadFriendCandidates();
      },
    });
  }

  private loadFriendCandidates() {
    if (!this.selectedGroup || this.selectedGroup.created_by !== this.currentUserId) {
      this.groupFriendCandidates = [];
      return;
    }
    this.groups.friends().subscribe({
      error: () => {},
      next: (friends) => {
        this.groupFriendCandidates = this.groups.friendCandidates(friends, this.groupMembers, this.currentUserId);
      },
    });
  }

  addFriendToGroup(friend: User) {
    if (!this.selectedGroup) return;
    this.groups.addMember(this.selectedGroup.id, friend.username).subscribe({
      next: () => {
        this.groupMembers = [...this.groupMembers, {
          user_id: friend.id,
          username: friend.username,
          avatar_url: friend.avatar_url || '',
        }];
        this.groupFriendCandidates = this.groupFriendCandidates.filter((f) => f.id !== friend.id);
        // Share the group E2EE key with the new member right away.
        this.distributeGroupKeyToMember(this.selectedGroup!.id, friend.id);
      },
      error: (err) => {
        // It used to remove the person from the list, which reads as "added" while
        // nothing happened. Now it says what happened, and leaves them there so the
        // tap can be repeated.
        this.notice.show(err?.error?.error || 'Не удалось добавить участника.', 'error');
      },
    });
  }

  createInvite() {
    if (!this.selectedGroup) return;
    this.inviteToken = '';
    this.groups.createInvite(this.selectedGroup.id).subscribe({
      error: (err) => this.notice.show(err?.error?.error || 'Не удалось создать приглашение.', 'error'),
      next: (res) => {
        this.inviteToken = res.token;
        const baseUrl = window.location.origin;
        this.inviteUrl = `${baseUrl}/join-group?token=${res.token}`;
      },
    });
  }

  copyInviteLink() {
    this.notice.copy(this.inviteUrl, 'Ссылка-приглашения скопирована');
  }

  deleteCurrentGroup() {
    const group = this.selectedGroup;
    if (!group) return;
    if (!confirm(`Удалить чат "${group.name}"? Сообщения будут безвозвратно удалены.`)) return;
    this.groups.remove(group.id).subscribe({
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
