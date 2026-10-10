import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { ChatComponent } from './chat';
import { AdminComponent } from '../admin/admin';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ClockService } from '../../services/clock.service';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

/**
 * Regression cover for the five bugs reported on 2026-10-09.
 *
 * Each test states the reported symptom, then asserts on the code path that was
 * actually changed. Where a fix was "wait for the store instead of testing a
 * flag", the test makes init() resolve late - that timing *is* the bug, and a
 * version that only asserted the happy path would stay green after a revert.
 */

describe('Bug #35: the author does not see their own sticker', () => {
  let component: ChatComponent;
  let mockApi: any;

  const wsMessages$ = new Subject<any>();

  beforeEach(async () => {
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
      wsConnected: signal(true),
      wsMessages$: wsMessages$.asObservable(),
      wsOnlineEvent: new Subject<any>().asObservable(),
      groupInfoRequest$: new Subject<any>().asObservable(),
      getFriendRequests: jasmine.createSpy().and.returnValue(of([])),
      getIncomingRequests: jasmine.createSpy().and.returnValue(of([])),
      syncPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
      getUsers: jasmine.createSpy().and.returnValue(of([])),
      getPinned: jasmine.createSpy().and.returnValue(of({ pinned_user_ids: [] })),
      getGroupChats: jasmine.createSpy().and.returnValue(of([])),
      getGroupMessages: jasmine.createSpy().and.returnValue(of([])),
      getFriends: jasmine.createSpy().and.returnValue(of([])),
      getUserDeviceKeys: jasmine.createSpy().and.returnValue(of([])),
      getGiphyStatus: jasmine.createSpy().and.returnValue(of({ has_key: false })),
      getUnread: jasmine.createSpy().and.returnValue(of({ users: [], groups: [] })),
      hydrateUnread: jasmine.createSpy(),
      clearUnread: jasmine.createSpy(),
      clearUnreadBoundary: jasmine.createSpy(),
      clearGroupUnread: jasmine.createSpy(),
      clearGroupUnreadBoundary: jasmine.createSpy(),
      incrementGroupUnread: jasmine.createSpy(),
      markGroupRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
      markMessagesRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
      getGiphyKey: jasmine.createSpy().and.returnValue(of({ has_key: false })),
      searchUsers: jasmine.createSpy().and.returnValue(of([])),
      sendFriendRequest: jasmine.createSpy().and.returnValue(of({})),
      acceptFriendRequest: jasmine.createSpy().and.returnValue(of({})),
      rejectFriendRequest: jasmine.createSpy().and.returnValue(of({})),
      reportDecryptFailure: jasmine.createSpy().and.returnValue(of({ ok: true })),
      connectWebSocket: jasmine.createSpy(),
      getMessages: jasmine.createSpy().and.returnValue(of({ messages: [], hasMore: false })),
      pinUser: jasmine.createSpy().and.returnValue(of({})),
      unpinUser: jasmine.createSpy().and.returnValue(of({})),
      createGroupInvite: jasmine.createSpy().and.returnValue(of({ token: 't' })),
      deleteGroupChat: jasmine.createSpy().and.returnValue(of({})),
      getGroupChat: jasmine.createSpy().and.returnValue(of({ members: [] })),
      getGroupKeyEpoch: jasmine.createSpy().and.returnValue(of({ epoch: 0 })),
      uploadGroupKeyShare: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      uploadGroupDeviceKeyShare: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      getMyGroupDeviceKeyShare: jasmine.createSpy().and.returnValue(of({ encrypted_key: '', iv: '', epoch: 0 })),
      requestGroupKey: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      // Mirrors the server: sticker_url comes back only for a sticker, so a text
// message cannot pick one up by accident.
      sendMessage: jasmine.createSpy().and.callFake((_to: number, _content: string, _files: any, type: string) =>
        of(type === 'sticker' ? { id: 42, sticker_url: '/uploads/stickers/7.png' } : { id: 44 })),
      sendGroupMessage: jasmine.createSpy().and.callFake((_g: number, _content: string, _files: any, type: string) =>
        of(type === 'sticker' ? { id: 43, sticker_url: '/uploads/stickers/7.png' } : { id: 45 })),
      sendMessageWithProgress: jasmine.createSpy().and.returnValue(of({})),
      sendGroupMessageWithProgress: jasmine.createSpy().and.returnValue(of({})),
    };

    const mockCrypto = {
      init: jasmine.createSpy().and.returnValue(Promise.resolve()),
      fetchPeerPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      getGroupKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      getRawGroupKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      encryptGroupKeyForPeer: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      buildEnvelopes: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      decryptViaEnvelope: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      decrypt: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      decryptGroupMessage: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      encryptGroupMessage: jasmine.createSpy().and.returnValue(Promise.resolve({ encrypted: 'e', iv: 'i' })),
      getCurrentGroupEpoch: jasmine.createSpy().and.returnValue(Promise.resolve(0)),
      setCurrentGroupEpoch: jasmine.createSpy().and.returnValue(Promise.resolve()),
      wrapKeyForDevice: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      wrapKeyForDeviceFromDevice: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
    };

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

    component = TestBed.createComponent(ChatComponent).componentInstance;
  });

  it('shows the sticker immediately in a group, before the response arrives', fakeAsync(async () => {
    component.selectedGroup = { id: 5, name: 'G' } as any;
    component.onStickerSelected({ id: 7, image_url: '/uploads/stickers/7.png' });
    tick();

    const bubble = component.messages.find(m => m.msg_type === 'sticker');
    expect(bubble).toBeTruthy();
    // The template renders sticker_url, not content. An optimistic bubble with
    // only the id in content is an empty image.
    expect(bubble!.sticker_url).toBe('/uploads/stickers/7.png');
  }));

  it('shows the sticker immediately in a direct chat', fakeAsync(async () => {
    component.selectedUser = { id: 2, username: 'ekaterina' } as any;
    component.onStickerSelected({ id: 7, image_url: '/uploads/stickers/7.png' });
    tick();

    const bubble = component.messages.find(m => m.msg_type === 'sticker');
    expect(bubble!.sticker_url).toBe('/uploads/stickers/7.png');
  }));

  it('takes sticker_url from the response, so it is right even if the picker value was lost', fakeAsync(async () => {
    component.selectedGroup = { id: 5, name: 'G' } as any;
    // No picker round trip: the URL is known only to the server.
    (component as any).messageContent = '7';
    (component as any).messageType = 'sticker';
    await component.sendMessage();
    tick();

    const bubble = component.messages.find(m => m.msg_type === 'sticker');
    expect(bubble!.sticker_url).toBe('/uploads/stickers/7.png');
  }));

  it('does not leak the sticker URL into the next, non-sticker message', fakeAsync(async () => {
    component.selectedGroup = { id: 5, name: 'G' } as any;
    component.onStickerSelected({ id: 7, image_url: '/uploads/stickers/7.png' });
    tick();
    component.messageContent = 'привет';
    component.messageType = 'text';
    await component.sendMessage();
    tick();

    const text = component.messages.find(m => m.msg_type === 'text');
    expect(text).toBeTruthy();
    expect(text!.sticker_url).toBeUndefined();
  }));
});

describe('Bug #36: group messages arrive "encrypted" right after login', () => {
  let component: ChatComponent;
  let mockApi: any;
  let resolveInit: () => void;
  let decryptGroupMessage: jasmine.Spy;

  const wsMessages$ = new Subject<any>();

  beforeEach(async () => {
    localStorage.clear();

    // The late resolution *is* the bug: crypto.init() finishing after the first
    // messages were handled. Everything below depends on that ordering.
    //
    // init() returns the *same* pending promise on every call, which is what the
    // real service does (it memoises) and what makes the ordering bite. An
    // earlier version resolved the gate on the first call - which ngOnInit makes
    // before any message arrives - so the race was silently disarmed and these
    // tests passed against the unfixed code too.
    const initPromise = new Promise<void>(res => { resolveInit = () => res(); });
    const init = () => initPromise;

    decryptGroupMessage = jasmine.createSpy().and.returnValue(Promise.resolve('расшифровано'));

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
      wsConnected: signal(true),
      wsMessages$: wsMessages$.asObservable(),
      wsOnlineEvent: new Subject<any>().asObservable(),
      groupInfoRequest$: new Subject<any>().asObservable(),
      getFriendRequests: jasmine.createSpy().and.returnValue(of([])),
      getIncomingRequests: jasmine.createSpy().and.returnValue(of([])),
      syncPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
      getUsers: jasmine.createSpy().and.returnValue(of([])),
      getPinned: jasmine.createSpy().and.returnValue(of({ pinned_user_ids: [] })),
      getGroupChats: jasmine.createSpy().and.returnValue(of([])),
      getGroupMessages: jasmine.createSpy().and.returnValue(of([])),
      getFriends: jasmine.createSpy().and.returnValue(of([])),
      getUserDeviceKeys: jasmine.createSpy().and.returnValue(of([])),
      getGiphyStatus: jasmine.createSpy().and.returnValue(of({ has_key: false })),
      getUnread: jasmine.createSpy().and.returnValue(of({ users: [], groups: [] })),
      hydrateUnread: jasmine.createSpy(),
      clearUnread: jasmine.createSpy(),
      clearUnreadBoundary: jasmine.createSpy(),
      clearGroupUnread: jasmine.createSpy(),
      clearGroupUnreadBoundary: jasmine.createSpy(),
      incrementGroupUnread: jasmine.createSpy(),
      markGroupRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
      markMessagesRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
      getGiphyKey: jasmine.createSpy().and.returnValue(of({ has_key: false })),
      searchUsers: jasmine.createSpy().and.returnValue(of([])),
      sendFriendRequest: jasmine.createSpy().and.returnValue(of({})),
      acceptFriendRequest: jasmine.createSpy().and.returnValue(of({})),
      rejectFriendRequest: jasmine.createSpy().and.returnValue(of({})),
      reportDecryptFailure: jasmine.createSpy().and.returnValue(of({ ok: true })),
      connectWebSocket: jasmine.createSpy(),
      getMessages: jasmine.createSpy().and.returnValue(of({ messages: [], hasMore: false })),
      pinUser: jasmine.createSpy().and.returnValue(of({})),
      unpinUser: jasmine.createSpy().and.returnValue(of({})),
      createGroupInvite: jasmine.createSpy().and.returnValue(of({ token: 't' })),
      deleteGroupChat: jasmine.createSpy().and.returnValue(of({})),
      getGroupChat: jasmine.createSpy().and.returnValue(of({ members: [] })),
      getGroupKeyEpoch: jasmine.createSpy().and.returnValue(of({ epoch: 0 })),
      uploadGroupKeyShare: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      uploadGroupDeviceKeyShare: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      getMyGroupDeviceKeyShare: jasmine.createSpy().and.returnValue(of({ encrypted_key: '', iv: '', epoch: 0 })),
      requestGroupKey: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    };

    const mockCrypto = {
      init: jasmine.createSpy().and.callFake(init),
      fetchPeerPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      getGroupKey: jasmine.createSpy().and.returnValue(Promise.resolve({} as any)),
      getRawGroupKey: jasmine.createSpy().and.returnValue(Promise.resolve(new Uint8Array(32))),
      encryptGroupKeyForPeer: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      buildEnvelopes: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      decryptViaEnvelope: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      decrypt: jasmine.createSpy().and.returnValue(Promise.resolve('расшифровано')),
      decryptGroupMessage: decryptGroupMessage as any,
      getCurrentGroupEpoch: jasmine.createSpy().and.returnValue(Promise.resolve(0)),
      setCurrentGroupEpoch: jasmine.createSpy().and.returnValue(Promise.resolve()),
      wrapKeyForDevice: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      wrapKeyForDeviceFromDevice: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
    };

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

    const fixture = TestBed.createComponent(ChatComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('decrypts an incoming group frame even though init() has not resolved yet', fakeAsync(async () => {
    component.selectedGroup = { id: 5, name: 'G' } as any;
    component.currentUserId = 1;

    // The frame lands while crypto is still initialising.
    wsMessages$.next({
      type: 'group_message', group_id: 5, id: 77, from: 2, from_name: 'ekaterina',
      content: '', msg_type: 'text', created_at: new Date().toISOString(),
      encrypted_content: 'aaa', encrypted_iv: 'bbb', epoch: 0,
    });
    tick();

    // Only now does the store finish opening.
    resolveInit();
    tick();
    tick();

    const msg = component.messages.find(m => m.id === 77);
    expect(msg).toBeTruthy();
    expect(msg!.content).toBe('расшифровано');
    expect(msg!.content).not.toBe('[Зашифрованное сообщение]');
  }));

  it('decrypts a group refetch that runs while init() is still pending', fakeAsync(async () => {
    // A different caller of decryptGroupMsg: the refetch after a reconnect or a
    // tab returning to the foreground. selectGroup awaits cryptoReady() first,
    // so testing only that path would let a flag-gated decryptGroupMsg pass -
    // this one has no such wait in front of it.
    const encrypted = {
      id: 91, from_user_id: 2, to_user_id: 0, group_chat_id: 5, content: '',
      msg_type: 'text', created_at: new Date().toISOString(), from_user: 'ekaterina',
      encrypted_content: 'aaa', encrypted_iv: 'bbb', epoch: 0,
    };
    component.selectedGroup = { id: 5, name: 'G' } as any;
    component.messages = [];
    mockApi.getGroupMessages.and.returnValue(of([encrypted as any]));

    (component as any).reloadOpenGroup();
    tick();

    resolveInit();
    tick();
    tick();

    const msg = component.messages.find(m => m.id === 91);
    expect(msg).toBeTruthy();
    expect(msg!.content).toBe('расшифровано');
  }));

  it('decrypts a loaded group history that arrived before init() resolved', fakeAsync(async () => {
    const encrypted = {
      id: 90, from_user_id: 2, to_user_id: 0, group_chat_id: 5, content: '',
      msg_type: 'text', created_at: new Date().toISOString(), from_user: 'ekaterina',
      encrypted_content: 'aaa', encrypted_iv: 'bbb', epoch: 0,
    };
    mockApi.getGroupMessages.and.returnValue(of([encrypted as any]));

    const done = component.selectGroup({ id: 5, name: 'G' } as any);
    tick();
    resolveInit();
    await done;
    tick();
    tick();

    const msg = component.messages.find(m => m.id === 90);
    expect(msg).toBeTruthy();
    expect(msg!.content).toBe('расшифровано');
  }));

  it('still pulls the group key when a group is opened before init() resolved', fakeAsync(async () => {
    // The whole key-sync block used to sit under `if (this.e2eeReady)`, so a
    // group opened right after login never even asked for the key.
    const done = component.selectGroup({ id: 5, name: 'G' } as any);
    tick();
    resolveInit();
    await done;
    tick();

    expect(mockApi.getGroupKeyEpoch).toHaveBeenCalledWith(5);
  }));
});

describe('Bug #38: a group message that only arrived as a push never showed up', () => {
  let component: ChatComponent;
  let fixture: any;
  let mockApi: any;
  let mockCrypto: any;
  const wsMessages$ = new Subject<any>();

  beforeEach(async () => {
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
      // The describe's own subject: an event pushed into a different one never
      // reaches the component, and the test fails for a reason unrelated to
      // the code under test.
      wsMessages$: wsMessages$.asObservable(),
      wsOnlineEvent: new Subject<any>().asObservable(),
      groupInfoRequest$: new Subject<any>().asObservable(),
      getFriendRequests: jasmine.createSpy().and.returnValue(of([])),
      getIncomingRequests: jasmine.createSpy().and.returnValue(of([])),
      syncPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
      getUsers: jasmine.createSpy().and.returnValue(of([])),
      getPinned: jasmine.createSpy().and.returnValue(of({ pinned_user_ids: [] })),
      getGroupChats: jasmine.createSpy().and.returnValue(of([])),
      getGroupMessages: jasmine.createSpy().and.returnValue(of([])),
      getFriends: jasmine.createSpy().and.returnValue(of([])),
      getUserDeviceKeys: jasmine.createSpy().and.returnValue(of([])),
      getGiphyStatus: jasmine.createSpy().and.returnValue(of({ has_key: false })),
      getUnread: jasmine.createSpy().and.returnValue(of({ users: [], groups: [] })),
      hydrateUnread: jasmine.createSpy(),
      clearUnread: jasmine.createSpy(),
      clearUnreadBoundary: jasmine.createSpy(),
      clearGroupUnread: jasmine.createSpy(),
      clearGroupUnreadBoundary: jasmine.createSpy(),
      incrementGroupUnread: jasmine.createSpy(),
      markGroupRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
      markMessagesRead: jasmine.createSpy().and.returnValue(of({ ok: true })),
      getGiphyKey: jasmine.createSpy().and.returnValue(of({ has_key: false })),
      searchUsers: jasmine.createSpy().and.returnValue(of([])),
      sendFriendRequest: jasmine.createSpy().and.returnValue(of({})),
      acceptFriendRequest: jasmine.createSpy().and.returnValue(of({})),
      rejectFriendRequest: jasmine.createSpy().and.returnValue(of({})),
      reportDecryptFailure: jasmine.createSpy().and.returnValue(of({ ok: true })),
      connectWebSocket: jasmine.createSpy(),
      getMessages: jasmine.createSpy().and.returnValue(of({ messages: [], hasMore: false })),
      pinUser: jasmine.createSpy().and.returnValue(of({})),
      unpinUser: jasmine.createSpy().and.returnValue(of({})),
      createGroupInvite: jasmine.createSpy().and.returnValue(of({ token: 't' })),
      deleteGroupChat: jasmine.createSpy().and.returnValue(of({})),
      getGroupChat: jasmine.createSpy().and.returnValue(of({ members: [] })),
      getGroupKeyEpoch: jasmine.createSpy().and.returnValue(of({ epoch: 0 })),
      uploadGroupKeyShare: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      uploadGroupDeviceKeyShare: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      getMyGroupDeviceKeyShare: jasmine.createSpy().and.returnValue(of({ encrypted_key: '', iv: '', epoch: 0 })),
      requestGroupKey: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
      sendGroupMessageWithProgress: jasmine.createSpy().and.returnValue(
        of({ type: 4, body: { id: 77 } }),
      ),
      sendMessageWithProgress: jasmine.createSpy().and.returnValue(
        of({ type: 4, body: { id: 78 } }),
      ),
    };

    mockCrypto = {
      init: jasmine.createSpy().and.returnValue(Promise.resolve()),
      fetchPeerPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      getGroupKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      getRawGroupKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      encryptGroupKeyForPeer: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      buildEnvelopes: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      decryptViaEnvelope: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      decrypt: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      decryptGroupMessage: jasmine.createSpy().and.returnValue(Promise.resolve('из сервера')),
      getCurrentGroupEpoch: jasmine.createSpy().and.returnValue(Promise.resolve(0)),
      setCurrentGroupEpoch: jasmine.createSpy().and.returnValue(Promise.resolve()),
      wrapKeyForDevice: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      wrapKeyForDeviceFromDevice: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
    };

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
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  function groupMessage(id: number, text: string) {
    return {
      id, from_user_id: 2, to_user_id: 0, group_chat_id: 5, content: text,
      msg_type: 'text', created_at: new Date().toISOString(), from_user: 'ekaterina',
    };
  }

  it('refetches the open group thread when the tab becomes visible again', fakeAsync(async () => {
    await component.selectGroup({ id: 5, name: 'G' } as any);
    tick();
    mockApi.getGroupMessages.calls.reset();
    mockApi.getGroupMessages.and.returnValue(of([groupMessage(500, 'пока тебя не было')]));

    // Hidden tab: the WS write failed server-side, so a push was sent instead.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    tick();
    tick();

    expect(component.messages.some(m => m.id === 500)).toBe(true);
  }));

  it('refetches the open group thread when the socket reconnects', async () => {
    // Open while down: the load fails, so the flag is set. Same starting point
    // as the direct-chat recovery test that already passes.
    mockApi.getGroupMessages.and.returnValue(throwError(() => new Error('network down')));
    await component.selectGroup({ id: 5, name: 'G' } as any);
    await fixture.whenStable();

    const callsWhileDown = mockApi.getGroupMessages.calls.count();

    mockApi.getGroupMessages.and.returnValue(of([groupMessage(501, 'пропущенное')]));

    // The network returns. Nothing arrived over the socket while it was down, so
    // there is no frame to catch up from - only a refetch can fix this.
    mockApi.wsConnected.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockApi.getGroupMessages.calls.count()).toBeGreaterThan(callsWhileDown);
    expect(component.messages.some(m => m.id === 501)).toBe(true);
  });

  it('makes the failed-load retry button work for a group, not only direct chats', fakeAsync(async () => {
    await component.selectGroup({ id: 5, name: 'G' } as any);
    tick();
    mockApi.getGroupMessages.calls.reset();
    mockApi.getGroupMessages.and.returnValue(of([groupMessage(502, 'ещё одно')]));

    component.retryLoadMessages();
    tick();
    tick();

    expect(component.messages.some(m => m.id === 502)).toBe(true);
  }));

  // ── Reading a group whose key we do not have ────────────────────
  //
  // Reported from a fresh browser on Windows: a new device, a new identity
  // key, and the group thread showed [Зашифрованное сообщение] through reloads
  // and re-logins. The request for the key was only ever sent when *sending*
  // failed to encrypt - so a member who only ever read never got one. The
  // server log confirmed it: five consecutive decrypt_failures with
  // detail=no_group_key right after that login.

  it('asks for the group key when opening a group we cannot decrypt', async () => {
    (mockCrypto as any).getGroupKey = jasmine.createSpy().and.returnValue(Promise.resolve(null));
    (mockCrypto as any).getRawGroupKey = jasmine.createSpy().and.returnValue(Promise.resolve(null));

    await component.selectGroup({ id: 5, name: 'G' } as any);
    await fixture.whenStable();

    expect(mockApi.requestGroupKey).toHaveBeenCalledWith(5);
  });

  it('does not ask again on every reopen once the key has arrived', async () => {
    (mockCrypto as any).getGroupKey = jasmine.createSpy().and.returnValue(Promise.resolve(null));
    (mockCrypto as any).getRawGroupKey = jasmine.createSpy().and.returnValue(Promise.resolve(null));

    await component.selectGroup({ id: 5, name: 'G' } as any);
    await fixture.whenStable();
    mockApi.requestGroupKey.calls.reset();

    // Reopening the same group must not re-ask: the request goes out over the
    // websocket to every member, and each of them re-wraps the key on receipt.
    await component.selectGroup({ id: 5, name: 'G' } as any);
    await fixture.whenStable();

    expect(mockApi.requestGroupKey).not.toHaveBeenCalled();
  });

  it('asks again after group_key_ready, so a later loss is recoverable', async () => {
    (mockCrypto as any).getGroupKey = jasmine.createSpy().and.returnValue(Promise.resolve(null));
    (mockCrypto as any).getRawGroupKey = jasmine.createSpy().and.returnValue(Promise.resolve(null));

    await component.selectGroup({ id: 5, name: 'G' } as any);
    await fixture.whenStable();
    expect((component as any).keyRequestedForRead.has(5)).toBe(true);

    wsMessages$.next({ type: 'group_key_ready', group_chat_id: 5 });
    // The subscription does not await the async handler, so give it its own turn.
    await new Promise(resolve => setTimeout(resolve, 0));

    expect((component as any).keyRequestedForRead.has(5)).toBe(false);
  });

  it('does not ask when the key is already available', async () => {
    (mockCrypto as any).getGroupKey = jasmine.createSpy().and.returnValue(Promise.resolve({} as any));
    (mockCrypto as any).getRawGroupKey = jasmine.createSpy().and.returnValue(Promise.resolve(new Uint8Array(32)));

    await component.selectGroup({ id: 5, name: 'G' } as any);
    await fixture.whenStable();

    expect(mockApi.requestGroupKey).not.toHaveBeenCalled();
  });

  // ── #4: the optimistic image bubble ─────────────────────────────
  //
  // "Images do not always appear for the sender right away." The composer
  // preview is read with a FileReader and reader.onload fires *after* the
  // current turn, so picking a file and sending in the same turn copied an
  // empty `previews` into the bubble, which then went out blank.

  it('has the image in the bubble when send follows the pick immediately', async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], { type: 'image/png' });
    const file = new File([blob], 'photo.png', { type: 'image/png' });

    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    await component.onFileSelected({ target: input } as unknown as Event);

    component.selectedGroup = { id: 5, name: 'G' } as any;
    component.messageType = 'image';
    component.messageContent = '';
    await component.sendMessage();
    await new Promise(resolve => setTimeout(resolve, 0));

    const bubble = component.messages.find(m => m.msg_type === 'image');
    expect(bubble).toBeTruthy();
    expect(bubble!.images?.length).toBeGreaterThan(0);
    expect(bubble!.images![0].image_url.startsWith('data:image/')).toBe(true);
  });

  it('keeps an in-flight optimistic message instead of replacing the thread', fakeAsync(async () => {
    component.selectedGroup = { id: 5, name: 'G' } as any;
    // Something the user just sent, still pending.
    component.messages = [{ id: 900, from_user_id: 1, to_user_id: 0, group_chat_id: 5, content: 'мой текст', msg_type: 'text', created_at: new Date().toISOString(), from_user: 'me', pending: true } as any];
    (component as any).seenMessageIds = new Set([900]);
    mockApi.getGroupMessages.and.returnValue(of([groupMessage(503, 'пока тебя не было')]));

    await (component as any).reloadOpenGroup();
    tick();

    expect(component.messages.some(m => m.id === 900)).toBe(true);
    expect(component.messages.some(m => m.id === 503)).toBe(true);
  }));
});