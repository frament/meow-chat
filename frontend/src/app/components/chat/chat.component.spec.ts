import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ChatComponent } from './chat';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ClockService } from '../../services/clock.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal, computed } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;

  const wsMessages$ = new Subject<any>();
  const wsOnlineEvent = new Subject<{ type: 'user_online' | 'user_offline'; user_id: number }>();
  const groupInfoRequest$ = new Subject<number>();

  const mockApi = {
    currentUser: signal({ id: 1, username: 'test', avatar_url: '' }),
    chatHeaderInfo: signal(null),
    cachedUsers: signal([]),
    cachedPins: signal([]),
    unreadCounts: signal<Record<number, number>>({}),
    unreadBoundaries: signal<Record<number, string>>({}),
    groupUnreadCounts: signal<Record<number, number>>({}),
    groupUnreadBoundaries: signal<Record<number, string>>({}),
    totalUnread: computed(() => 0),
    wsConnected: signal(false),
    wsMessages$: wsMessages$.asObservable(),
    wsOnlineEvent: wsOnlineEvent.asObservable(),
    groupInfoRequest$: groupInfoRequest$.asObservable(),
    selectUser: jasmine.createSpy(),
    getUsers: jasmine.createSpy().and.returnValue(of([])),
    getPinned: jasmine.createSpy().and.returnValue(of({ pinned_user_ids: [] })),
    getMessages: jasmine.createSpy().and.returnValue(of({ messages: [], hasMore: false })),
    sendMessage: jasmine.createSpy().and.returnValue(of({ id: 1 })),
    getGroupChats: jasmine.createSpy().and.returnValue(of([])),
    getFriends: jasmine.createSpy().and.returnValue(of([])),
    getGroupMessages: jasmine.createSpy().and.returnValue(of([])),
    sendGroupMessage: jasmine.createSpy().and.returnValue(of({ id: 1 })),
    pinUser: jasmine.createSpy().and.returnValue(of({})),
    unpinUser: jasmine.createSpy().and.returnValue(of({})),
    createGroupChat: jasmine.createSpy().and.returnValue(of({ id: 1 })),
    getGroupChat: jasmine.createSpy().and.returnValue(of({ members: [] })),
    uploadGroupKeyShare: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    requestGroupKey: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    createGroupInvite: jasmine.createSpy().and.returnValue(of({ token: 'abc' })),
    deleteGroupChat: jasmine.createSpy().and.returnValue(of({})),
    sendMessageWithProgress: jasmine.createSpy().and.returnValue(of({})),
    sendGroupMessageWithProgress: jasmine.createSpy().and.returnValue(of({})),
    clearUnread: jasmine.createSpy(),
    clearUnreadBoundary: jasmine.createSpy(),
    clearGroupUnread: jasmine.createSpy(),
    clearGroupUnreadBoundary: jasmine.createSpy(),
    incrementGroupUnread: jasmine.createSpy(),
    markGroupRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
    getUnread: jasmine.createSpy().and.returnValue(of({ users: [], groups: [] })),
    hydrateUnread: jasmine.createSpy(),
    getGiphyKey: jasmine.createSpy().and.returnValue(of({ has_key: false, key: '' })),
    getGiphyStatus: jasmine.createSpy().and.returnValue(of({ has_key: false })),
    searchUsers: jasmine.createSpy().and.returnValue(of([])),
    sendFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    getFriendRequests: jasmine.createSpy().and.returnValue(of([])),
    acceptFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    rejectFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    reportDecryptFailure: jasmine.createSpy().and.returnValue(of({ ok: true })),
    getUserDeviceKeys: jasmine.createSpy().and.returnValue(of([])),
    uploadGroupDeviceKeyShare: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    getMyGroupDeviceKeyShare: jasmine.createSpy().and.returnValue(of({ encrypted_key: '', iv: '', epoch: 0 })),
    getGroupKeyEpoch: jasmine.createSpy().and.returnValue(of({ epoch: 0 })),
  };

  const mockCrypto = {
    init: jasmine.createSpy().and.returnValue(Promise.resolve()),
    fetchPeerPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
    getGroupKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
    buildEnvelopes: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
    decryptViaEnvelope: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
    wrapKeyForDevice: jasmine.createSpy().and.returnValue(Promise.resolve({ wrapped_key: 'wk', iv: 'iv' })),
    wrapKeyForDeviceFromDevice: jasmine.createSpy().and.returnValue(Promise.resolve({ wrapped_key: 'wk', iv: 'iv' })),
    getCurrentGroupEpoch: jasmine.createSpy().and.returnValue(Promise.resolve(0)),
    setCurrentGroupEpoch: jasmine.createSpy().and.returnValue(Promise.resolve()),
  };

  beforeEach(async () => {
    mockApi.sendMessage.calls.reset();
    mockApi.sendGroupMessage.calls.reset();
    mockApi.requestGroupKey.calls.reset();
    mockApi.uploadGroupKeyShare.calls.reset();
    mockApi.reportDecryptFailure.calls.reset();
    mockApi.wsConnected.set(false);

    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) }, paramMap: of(convertToParamMap({})), url: of([]) } },
        { provide: ClockService, useValue: { now: signal(Date.now()) } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null), url: '' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('opens group info when groupInfoRequest matches selected group', () => {
    (component as any).selectedGroup = { id: 5, name: 'G', member_count: 2 };
    spyOn(component, 'loadGroupInfo');
    groupInfoRequest$.next(5);
    expect(component.loadGroupInfo).toHaveBeenCalled();
    groupInfoRequest$.next(6);
    expect(component.loadGroupInfo).toHaveBeenCalledTimes(1);
  });

  it('renders user list section with friends heading', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const headings = compiled.querySelectorAll('h3');
    const friendsHeading = Array.from(headings).find(h => h.textContent?.includes('Друзья'));
    expect(friendsHeading).toBeTruthy();
  });

  it('renders group chats section heading', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const headings = compiled.querySelectorAll('h3');
    const groupHeading = Array.from(headings).find(h => h.textContent?.includes('Групповые чаты'));
    expect(groupHeading).toBeTruthy();
  });

  it('renders message input area after selecting a user', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector('input[type="text"]');
    expect(input).toBeTruthy();
  }));

  it('renders type toggle button with current type label after selecting a user', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    expect(container).toBeTruthy();
    const toggleBtn = container?.querySelector('button') as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.textContent).toContain('Aa');
  }));

  it('opens popup menu on toggle button click', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    fixture.detectChanges();
    expect(component.showTypeMenu).toBeFalse();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const toggleBtn = container?.querySelector('button') as HTMLButtonElement;
    toggleBtn.click();
    fixture.detectChanges();
    expect(component.showTypeMenu).toBeTrue();
  }));

  it('selects type from popup menu', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    component.showTypeMenu = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const allButtons = container?.querySelectorAll('button') || [];
    const fotoBtn = Array.from(allButtons).find(b => b.textContent?.includes('Фото'));
    expect(fotoBtn).toBeTruthy();
    expect(fotoBtn?.hasAttribute('disabled')).toBeFalse();
    fotoBtn?.click();
    fixture.detectChanges();
    expect(component.messageType).toBe('image');
    expect(component.showTypeMenu).toBeFalse();
  }));

  it('shows disabled gif item in popup when giphy key missing', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    component.showTypeMenu = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const disabledBtns = container?.querySelectorAll('button[disabled]') || [];
    const disabledTexts = Array.from(disabledBtns).map(b => b.textContent?.trim());
    expect(disabledTexts.some(t => t?.includes('GIF'))).toBeTrue();
  }));

  it('shows sticker item in popup', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    component.showTypeMenu = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const container = compiled.querySelector('.type-menu-container') as HTMLElement;
    const btns = container?.querySelectorAll('button') || [];
    const texts = Array.from(btns).map(b => b.textContent?.trim());
    expect(texts.some(t => t?.includes('Стикер'))).toBeTrue();
  }));

  it('renders send button after selecting a user', fakeAsync(() => {
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const sendBtn = compiled.querySelector('button[title="Отправить"]');
    expect(sendBtn).toBeTruthy();
  }));

  it('shows "Выберите чат" when no user or group selected', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Выберите чат');
  });

  it('inserts date separators between messages of different days', () => {
    const today = new Date().toISOString();
    const older = new Date(Date.now() - 3 * 86400000).toISOString();
    component.messages = [
      { id: 1, from_user_id: 2, content: 'old', msg_type: 'text', created_at: older } as any,
      { id: 2, from_user_id: 2, content: 'today', msg_type: 'text', created_at: today } as any,
    ];
    const items: any[] = component.displayMessages;
    const seps = items.filter(i => i._dateSep);
    expect(seps.length).toBe(2);
    expect(seps[1].label).toBe('Сегодня');
  });

  it('does not insert a separator between messages on the same day', () => {
    // Fixed same-day times (not Date.now()-1h) so the test doesn't flip to two
    // dates when the suite runs just after midnight.
    const now = new Date();
    const a = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0).toISOString();
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0, 0).toISOString();
    component.messages = [
      { id: 1, from_user_id: 2, content: 'a', msg_type: 'text', created_at: a } as any,
      { id: 2, from_user_id: 2, content: 'b', msg_type: 'text', created_at: b } as any,
    ];
    const seps = (component.displayMessages as any[]).filter(i => i._dateSep);
    expect(seps.length).toBe(1);
  });

  it('blocks sending when encryption is impossible (no peer key)', fakeAsync(async () => {
    (mockCrypto as any).init = jasmine.createSpy().and.returnValue(Promise.resolve());
    (mockCrypto as any).encrypt = jasmine.createSpy().and.returnValue(Promise.resolve(null));
    component.selectedUser = { id: 2, username: 'friend', email: '', avatar_url: '', is_admin: false, is_banned: false, created_at: '', is_online: false };
    component.messageContent = 'secret text';
    component.messageType = 'text';

    await component.sendMessage();
    tick();

    expect(component.sendError()).toContain('зашифровать');
    expect(mockApi.sendMessage).not.toHaveBeenCalled();
  }));

  it('requests the group key and queues a retry when the group key is missing', fakeAsync(async () => {
    (mockCrypto as any).init = jasmine.createSpy().and.returnValue(Promise.resolve());
    (mockCrypto as any).encryptGroupMessage = jasmine.createSpy().and.returnValue(Promise.resolve(null));
    component.selectedGroup = { id: 5, name: 'G' } as any;
    component.messageContent = 'secret text';
    component.messageType = 'text';

    await component.sendMessage();
    tick();

    expect(mockApi.requestGroupKey).toHaveBeenCalledWith(5);
    expect(component.sendError()).toContain('ключа');
    expect(mockApi.sendGroupMessage).not.toHaveBeenCalled();
    expect((component as any).pendingGroupSend).toEqual({ content: 'secret text', type: 'text' });
  }));

  it('retries the pending group send when the group key becomes ready', fakeAsync(async () => {
    (mockCrypto as any).init = jasmine.createSpy().and.returnValue(Promise.resolve());
    (mockCrypto as any).encryptGroupMessage = jasmine.createSpy().and.returnValue(Promise.resolve(null));
    component.selectedGroup = { id: 5, name: 'G' } as any;
    component.messageContent = 'secret text';
    component.messageType = 'text';
    await component.sendMessage();
    tick();
    expect(mockApi.sendGroupMessage).not.toHaveBeenCalled();

    // Key arrives: next encryption succeeds and the queued message is retried.
    (mockCrypto as any).encryptGroupMessage = jasmine.createSpy().and.returnValue(Promise.resolve({ encrypted: 'x', iv: 'y' }));
    wsMessages$.next({ type: 'group_key_ready', group_chat_id: 5 });
    tick();
    tick();

    expect(mockApi.sendGroupMessage).toHaveBeenCalled();
  }));

  it('reports a group decrypt failure for telemetry', fakeAsync(async () => {
    (mockCrypto as any).decryptGroupMessage = jasmine.createSpy().and.returnValue(Promise.resolve(null));
    (mockCrypto as any).getGroupKey = jasmine.createSpy().and.returnValue(Promise.resolve(null));
    (component as any).e2eeReady = true;
    const msg = {
      id: 1, from_user_id: 2, to_user_id: 0, group_chat_id: 5, content: '',
      msg_type: 'text', created_at: '', from_user: '', encrypted_content: 'x', encrypted_iv: 'y',
    } as any;

    await (component as any).decryptGroupMsg(msg, 5);
    tick();

    expect(msg.content).toBe('[Зашифрованное сообщение]');
    expect(mockApi.reportDecryptFailure).toHaveBeenCalled();
  }));

  it('shares the group key with a member who requests it', fakeAsync(async () => {
    (mockCrypto as any).getRawGroupKey = jasmine.createSpy().and.returnValue(Promise.resolve(new Uint8Array(32)));
    (mockCrypto as any).encryptGroupKeyForPeer = jasmine.createSpy().and.returnValue(Promise.resolve({ encrypted_key: 'ek', iv: 'iv' }));
    component.selectedGroup = { id: 5, name: 'G' } as any;
    (component as any).e2eeReady = true;

    wsMessages$.next({ type: 'group_key_request', group_chat_id: 5, user_id: 7 });
    tick();

    expect(mockApi.uploadGroupKeyShare).toHaveBeenCalledWith(5, 7, 'ek', 'iv');
  }));
});

// ── The report: opening a chat with no network left the thread at the very top
  // and nothing recovered when the network came back.

describe('ChatComponent: loading a thread over a failing network', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;
  let mockApi: any;

  const ekaterina = {
    id: 2,
    username: 'ekaterina',
    email: 'e@example.com',
    avatar_url: '',
    is_admin: false,
    is_banned: false,
    created_at: new Date().toISOString(),
    is_online: true,
  };

  function message(id: number, from: number, content: string, minutesAgo: number) {
    return {
      id,
      from_user_id: from,
      to_user_id: from === 1 ? 2 : 1,
      content,
      msg_type: 'text',
      created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      from_user: from === 1 ? 'me' : 'ekaterina',
      is_read: true,
    };
  }

  beforeEach(async () => {
    // selectUser seeds itself from localStorage, and persistCache writes there.
    // Left shared between specs, user 2's cache from one test would suppress the
    // next test's messages by id, and the merge would look broken rather than the
    // cache doing its job.
    localStorage.clear();

    mockApi = {
      currentUser: signal({ id: 1, username: 'me', avatar_url: '' }),
      chatHeaderInfo: signal(null),
      cachedUsers: signal([]),
      cachedPins: signal([]),
      unreadCounts: signal<Record<number, number>>({}),
      unreadBoundaries: signal<Record<number, string>>({}),
      groupUnreadCounts: signal<Record<number, number>>({}),
      groupUnreadBoundaries: signal<Record<number, string>>({}),
      totalUnread: computed(() => 0),
      wsConnected: signal(false),
      wsMessages$: new Subject<any>().asObservable(),
      wsOnlineEvent: new Subject<any>().asObservable(),
      groupInfoRequest$: new Subject<number>().asObservable(),
      getUsers: jasmine.createSpy().and.returnValue(of([])),
      getPinned: jasmine.createSpy().and.returnValue(of({ pinned_user_ids: [] })),
      getGroupChats: jasmine.createSpy().and.returnValue(of([])),
      getGroupMessages: jasmine.createSpy().and.returnValue(of([])),
      getFriends: jasmine.createSpy().and.returnValue(of([])),
      getIncomingRequests: jasmine.createSpy().and.returnValue(of([])),
      getFriendRequests: jasmine.createSpy().and.returnValue(of([])),
      getUserDeviceKeys: jasmine.createSpy().and.returnValue(of([])),
      getGiphyStatus: jasmine.createSpy().and.returnValue(of({ has_key: false })),
      getUnread: jasmine.createSpy().and.returnValue(of({ users: [], groups: [] })),
      hydrateUnread: jasmine.createSpy(),
      clearUnread: jasmine.createSpy(),
      clearUnreadBoundary: jasmine.createSpy(),
      clearGroupUnread: jasmine.createSpy(),
      clearGroupUnreadBoundary: jasmine.createSpy(),
      incrementGroupUnread: jasmine.createSpy(),
      markMessagesRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
      markGroupRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
      searchUsers: jasmine.createSpy().and.returnValue(of([])),
      sendFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      acceptFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      rejectFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      reportDecryptFailure: jasmine.createSpy().and.returnValue(of({ ok: true })),
      connectWebSocket: jasmine.createSpy(),
      // The default: the network is down. Every test overrides this explicitly so
      // that no test can accidentally pass on a working connection.
      getMessages: jasmine.createSpy().and.returnValue(throwError(() => new Error('network down'))),
    };

    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: CryptoService, useValue: { init: jasmine.createSpy().and.returnValue(Promise.resolve()) } },
        { provide: ClockService, useValue: { now: signal(Date.now()) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) }, paramMap: of(convertToParamMap({})), url: of([]) } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null), url: '' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('reports a failed load instead of looking like an empty thread', async () => {
    component.selectUser(ekaterina);
    await fixture.whenStable();

    // The bug: getMessages had no error callback, so the failure was invisible and
    // the thread kept showing whatever the cache held - the top of the
    // conversation, indistinguishable from "this is all there is".
    expect(component.messagesLoadFailed()).toBe(true);
  });

  it('scrolls to the bottom once a load succeeds', async () => {
    const scroll = spyOn<any>(component, 'scrollToBottom');
    mockApi.getMessages.and.returnValue(of([message(1, 2, 'старое', 60), message(2, 2, 'новое', 1)]));

    component.selectUser(ekaterina);
    await fixture.whenStable();

    expect(component.messagesLoadFailed()).toBe(false);
    expect(scroll).toHaveBeenCalled();
  });

  it('refetches and scrolls when the websocket comes back', async () => {
    // Open while down: fails, flag set.
    component.selectUser(ekaterina);
    await fixture.whenStable();
    expect(component.messagesLoadFailed()).toBe(true);

    const callsWhileDown = mockApi.getMessages.calls.count();

    // The network returns. Nothing was sent while it was down, so there is no
    // frame to catch up from - the only thing that can fix this is a refetch.
    mockApi.getMessages.and.returnValue(
      of([message(1, 2, 'пока меня не было', 30), message(2, 2, 'вернулись?', 1)]),
    );
    mockApi.wsConnected.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockApi.getMessages.calls.count()).toBeGreaterThan(callsWhileDown);
    expect(component.messages.some(m => m.content === 'вернулись?')).toBe(true);
    expect(component.messagesLoadFailed()).toBe(false);
  });

  it('does not refetch on the initial connect', async () => {
    mockApi.getMessages.and.returnValue(of([message(1, 2, 'привет', 5)]));
    component.selectUser(ekaterina);
    await fixture.whenStable();

    const callsAfterOpen = mockApi.getMessages.calls.count();

    // wsConnected flipping true the first time is just the socket opening, not a
    // recovery. Without the false -> true filter this would refetch every time
    // the chat was opened.
    mockApi.wsConnected.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockApi.getMessages.calls.count()).toBe(callsAfterOpen);
  });

  it('retry re-requests the thread and clears the failure', async () => {
    component.selectUser(ekaterina);
    await fixture.whenStable();
    expect(component.messagesLoadFailed()).toBe(true);

    mockApi.getMessages.and.returnValue(of([message(1, 2, 'наконец-то', 1)]));
    component.retryLoadMessages();
    await fixture.whenStable();

    expect(component.messagesLoadFailed()).toBe(false);
    expect(component.messages.some(m => m.content === 'наконец-то')).toBe(true);
  });

  it('reloads when the already open conversation is clicked again', async () => {
    mockApi.getMessages.and.returnValue(of([message(1, 2, 'привет', 5)]));
    component.selectUser(ekaterina);
    await fixture.whenStable();

    const before = mockApi.getMessages.calls.count();
    component.openChat(ekaterina);
    await fixture.whenStable();

    // Angular ignores navigation to the route already active, so the click used to
    // do nothing at all. Re-selecting the open conversation should still refetch.
    expect(mockApi.getMessages.calls.count()).toBeGreaterThan(before);
  });
});

// Opening a deep link with no network needs a route that already carries the id,
// which is why it gets its own TestBed rather than the shared one.
describe('ChatComponent: deep link while offline', () => {
  const ekaterina = {
    id: 2, username: 'ekaterina', email: 'e@example.com', avatar_url: '', is_admin: false,
    is_banned: false, created_at: '', is_online: true,
  };
  const me = {
    id: 1, username: 'me', email: 'm@example.com', avatar_url: '', is_admin: false,
    is_banned: false, created_at: '', is_online: true,
  };

  it('opens the chat from the cached user list', async () => {
    localStorage.setItem('cachedUsers', JSON.stringify([me, ekaterina]));

    const api: any = {
      currentUser: signal(me),
      chatHeaderInfo: signal(null),
      cachedUsers: signal([]), cachedPins: signal([]),
      unreadCounts: signal({}), unreadBoundaries: signal({}),
      groupUnreadCounts: signal({}), groupUnreadBoundaries: signal({}),
      totalUnread: computed(() => 0),
      wsConnected: signal(false),
      wsMessages$: new Subject<any>().asObservable(),
      wsOnlineEvent: new Subject<any>().asObservable(),
      groupInfoRequest$: new Subject<number>().asObservable(),
      getUsers: jasmine.createSpy().and.returnValue(throwError(() => new Error('offline'))),
      getPinned: jasmine.createSpy().and.returnValue(of({ pinned_user_ids: [] })),
      getGroupChats: jasmine.createSpy().and.returnValue(of([])),
      getGroupMessages: jasmine.createSpy().and.returnValue(of([])),
      getFriends: jasmine.createSpy().and.returnValue(of([])),
      getIncomingRequests: jasmine.createSpy().and.returnValue(of([])),
      getFriendRequests: jasmine.createSpy().and.returnValue(of([])),
      getUserDeviceKeys: jasmine.createSpy().and.returnValue(of([])),
      getGiphyStatus: jasmine.createSpy().and.returnValue(of({ has_key: false })),
      getUnread: jasmine.createSpy().and.returnValue(of({ users: [], groups: [] })),
      hydrateUnread: jasmine.createSpy(),
      clearUnread: jasmine.createSpy(), clearUnreadBoundary: jasmine.createSpy(),
      clearGroupUnread: jasmine.createSpy(), clearGroupUnreadBoundary: jasmine.createSpy(),
      incrementGroupUnread: jasmine.createSpy(),
      markMessagesRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
      markGroupRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
      searchUsers: jasmine.createSpy().and.returnValue(of([])),
      sendFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      acceptFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      rejectFriendRequest: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      reportDecryptFailure: jasmine.createSpy().and.returnValue(of({ ok: true })),
      getMessages: jasmine.createSpy().and.returnValue(throwError(() => new Error('offline'))),
    };

    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: CryptoService, useValue: { init: jasmine.createSpy().and.returnValue(Promise.resolve()) } },
        { provide: ClockService, useValue: { now: signal(Date.now()) } },
        { provide: ActivatedRoute, useValue: {
            snapshot: { paramMap: convertToParamMap({ userId: '2' }) },
            paramMap: of(convertToParamMap({ userId: '2' })),
            url: of(['/chat', '2']),
          } },
        { provide: Router, useValue: {
            navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(),
            createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(),
            events: of(null), url: '/chat/2',
          } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ChatComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;

    // Before the fix, resolvePendingChat ran only inside the successful branch of
    // getUsers. Offline it never ran: the friend row was on screen, and the pane
    // said "choose a chat" instead.
    expect(component.selectedUser?.id).toBe(ekaterina.id);
    // And the thread load failing has to say so rather than look like an empty chat.
    expect(component.messagesLoadFailed()).toBe(true);
  });
});
