import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';

import { ChatComponent } from './chat';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ClockService } from '../../services/clock.service';

/**
 * One message arriving three times was reported from production.
 *
 * The server sends a frame to every connection a recipient holds - correct for
 * "phone and laptop at once" - and leaked sockets mean more than one. So the
 * client has to be the thing that deduplicates. It was not: the check
 * `messages.some(m => m.id === data.id)` ran *before* the decryption awaits, while
 * the push came after them. Three frames for one message each passed the check
 * and each was pushed once its await resolved.
 *
 * These tests drive the real subscription with three frames in a row, which is
 * what the server does when a recipient holds several sockets.
 */
describe('ChatComponent duplicate suppression', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;
  let wsMessages$: Subject<any>;
  /** One resolver per call - keeping only the last meant the earlier frames'
   *  promises never settled, so nothing was ever pushed and the assertion below
   *  passed for the wrong reason. */
  let decryptResolvers: Array<(v: string | null) => void> = [];
  let decryptStarted: number;

  /** A direct message from user 2, encrypted so decryption has to run. */
  function frame(id: number) {
    return {
      type: 'message',
      id,
      from: 2,
      to: 1,
      from_name: 'ekaterina',
      content: '',
      encrypted_content: 'enc',
      encrypted_iv: 'iv',
      msg_type: 'text',
      created_at: '2026-10-05T10:00:00Z',
    };
  }

  beforeEach(async () => {
    wsMessages$ = new Subject<any>();
    decryptStarted = 0;
    decryptResolvers = [];

    // Decryption that only settles when the test says so. This is the whole point:
    // the frames have to overlap on the await to reproduce the race at all.
    const mockCrypto = {
      init: jasmine.createSpy().and.returnValue(Promise.resolve()),
      decrypt: jasmine.createSpy().and.callFake(() => {
        decryptStarted++;
        return new Promise<string | null>((resolve) => {
          decryptResolvers.push(resolve);
        });
      }),
      decryptGroupMessage: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      fetchPeerPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      syncPublicKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
      getGroupKey: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      buildEnvelopes: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      decryptViaEnvelope: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      wrapKeyForDevice: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      wrapKeyForDeviceFromDevice: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
      getCurrentGroupEpoch: jasmine.createSpy().and.returnValue(0),
      setCurrentGroupEpoch: jasmine.createSpy(),
    };

    const anyApi = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (prop === 'currentUser') return signal({ id: 1, username: 'me', avatar_url: '' });
        if (prop === 'chatHeaderInfo') return signal(null);
        if (prop === 'cachedUsers') return signal([]);
        if (prop === 'cachedPins') return signal([]);
        if (prop === 'unreadCounts') return signal<Record<number, number>>({});
        if (prop === 'unreadBoundaries') return signal<Record<number, string>>({});
        if (prop === 'groupUnreadCounts') return signal<Record<number, number>>({});
        if (prop === 'groupUnreadBoundaries') return signal<Record<number, string>>({});
        if (prop === 'totalUnread') return signal(0);
        if (prop === 'wsConnected') return signal(false);
        if (prop === 'wsMessages$') return wsMessages$.asObservable();
        if (prop === 'wsOnlineEvent' || prop === 'groupInfoRequest$') return of();
        // getMessages resolves to a list - the component iterates it.
        if (prop === 'getMessages') return () => of([]);
        if (prop === 'getUsers') return () => of([]);
        if (prop === 'getPinned') return () => of({ pinned_user_ids: [] });
        return () => of();
      },
    });

    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        { provide: ApiService, useValue: anyApi as unknown as ApiService },
        { provide: CryptoService, useValue: mockCrypto },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({}) },
            paramMap: of(convertToParamMap({})),
            url: of([]),
          },
        },
        { provide: ClockService, useValue: { now: signal(Date.now()) } },
        {
          provide: Router,
          useValue: {
            navigate: () => {},
            navigateByUrl: () => {},
            createUrlTree: () => ({}),
            serializeUrl: () => '',
            events: of(null),
            url: '',
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.selectedUser = {
      id: 2, username: 'ekaterina', email: '', avatar_url: '',
      is_admin: false, is_banned: false, created_at: '', is_online: true,
    } as never;
    (component as unknown as { currentUserId: number }).currentUserId = 1;
    (component as unknown as { e2eeReady: boolean }).e2eeReady = true;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('shows one message when three frames for it arrive back to back', fakeAsync(() => {
    // Three sockets, one message - exactly what the logs showed on production.
    wsMessages$.next(frame(777));
    wsMessages$.next(frame(777));
    wsMessages$.next(frame(777));
    tick();

    // All three reached decryption before any of them settled. If the old check
    // were still in place, this is exactly where it would let all three through.
    // The tick above is what the frames need now that decryption first awaits
    // cryptoReady() - it is one more await on the way, not one fewer.
    expect(decryptStarted).toBe(3);

    // Let every one of them settle - not just the last.
    expect(decryptResolvers.length).toBe(3);
    decryptResolvers.forEach((resolve) => resolve('Привет'));
    decryptResolvers = [];
    tick();

    const copies = (component as unknown as { messages: any[] }).messages
      .filter((m) => m.id === 777);
    expect(copies.length).toBe(1);
  }));

  it('keeps distinct messages that share a payload', fakeAsync(() => {
    wsMessages$.next(frame(1));
    tick();
    decryptResolvers.forEach((r) => r('одно'));
    decryptResolvers = [];
    tick();

    wsMessages$.next(frame(2));
    tick();
    decryptResolvers.forEach((r) => r('два'));
    decryptResolvers = [];
    tick();

    const messages = (component as unknown as { messages: any[] }).messages;
    expect(messages.filter((m) => m.id === 1).length).toBe(1);
    expect(messages.filter((m) => m.id === 2).length).toBe(1);
  }));

  it('does not reshow a message the thread was just loaded with', fakeAsync(() => {
    // The load claims its ids; a frame arriving right after must not add a copy.
    (component as unknown as { seenMessageIds: Set<number> }).seenMessageIds.add(900);

    wsMessages$.next(frame(900));
    tick();

    const messages = (component as unknown as { messages: any[] }).messages;
    expect(messages.filter((m) => m.id === 900).length).toBe(0);
  }));

  it('follows the server id when an optimistic send is confirmed', fakeAsync(() => {
    // A sent message is shown immediately under a temporary id, then the server
    // assigns the real one. If the index kept the temporary id, a later frame for
    // the real id would look unclaimed and turn into a duplicate.
    (component as unknown as { seenMessageIds: Set<number> }).seenMessageIds.add(555);
    (component as unknown as { messages: any[] }).messages.push({ id: 555, from_user_id: 1, content: 'x' });

    (component as any).finalizeOptimistic(555, { id: 556 });

    const seen = (component as unknown as { seenMessageIds: Set<number> }).seenMessageIds;
    expect(seen.has(555)).toBe(false);
    expect(seen.has(556)).toBe(true);
  }));

  it('releases the id when an optimistic send is rolled back', fakeAsync(() => {
    (component as unknown as { seenMessageIds: Set<number> }).seenMessageIds.add(42);
    (component as unknown as { messages: any[] }).messages.push({ id: 42, from_user_id: 1, content: 'x', pending: true });

    (component as any).rollbackOptimistic(42);

    const seen = (component as unknown as { seenMessageIds: Set<number> }).seenMessageIds;
    expect(seen.has(42)).toBe(false);
    expect((component as unknown as { messages: any[] }).messages.length).toBe(0);
  }));

  it('starts a fresh index when switching to another chat', fakeAsync(() => {
    // The new chat has a cached thread of its own, so the index has to be built
    // from *that* - and the previous chat's ids have to be gone.
    localStorage.setItem('cached_messages_1_7', JSON.stringify([
      { id: 2222, from_user_id: 7, to_user_id: 1, content: 'in the new chat', msg_type: 'text', created_at: '', from_user: 'other' },
    ]));
    (component as unknown as { seenMessageIds: Set<number> }).seenMessageIds.add(1234);

    component.selectUser({
      id: 7, username: 'other', email: '', avatar_url: '',
      is_admin: false, is_banned: false, created_at: '', is_online: false,
    } as never);
    tick();

    const seen = (component as unknown as { seenMessageIds: Set<number> }).seenMessageIds;
    expect(seen.has(1234)).toBe(false);          // previous chat
    expect(seen.has(2222)).toBe(true);           // new chat's own cached thread
  }));

  it('suppresses duplicates in group threads too', fakeAsync(() => {
    component.selectedGroup = { id: 5, name: 'G', member_count: 2 } as never;
    component.selectedUser = null as never;
    (component as unknown as { messages: any[] }).messages = [];

    const groupFrame = () => ({
      type: 'group_message',
      id: 4242,
      from: 2,
      group_id: 5,
      content: '',
      encrypted_content: 'enc',
      encrypted_iv: 'iv',
      msg_type: 'text',
      created_at: '2026-10-05T10:00:00Z',
    });

    wsMessages$.next(groupFrame());
    wsMessages$.next(groupFrame());
    tick();
    tick();

    const messages = (component as unknown as { messages: any[] }).messages;
    expect(messages.filter((m) => m.id === 4242).length).toBe(1);
  }));
});