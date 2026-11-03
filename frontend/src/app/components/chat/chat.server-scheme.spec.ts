import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { signal } from '@angular/core';
import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';

import { ChatComponent } from './chat';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ServerCryptoService } from '../../services/server-crypto.service';
import { ClockService } from '../../services/clock.service';

/**
 * A message sent under the server scheme reaches the reader over the socket.
 *
 * Its text is not in `content`: the row holds only at-rest ciphertext, and the
 * frame carries the text wrapped to the reader's own key. The client's socket
 * handler had no branch for that field, so a live thread showed an empty bubble
 * and only a reload produced text - reported from prod on 2026-10-25, right after
 * the pin was switched on.
 *
 * The fallback matters as much: an envelope that cannot be opened, or an account
 * without a key, must be *said*, not left as blank space that reads as deleted
 * history.
 */
describe('ChatComponent server-scheme frames', () => {
  let component: ChatComponent;
  let wsMessages$: Subject<any>;
  let openFromServer: jasmine.Spy;
  let ensureAccountKey: jasmine.Spy;

  /** A direct message from user 2 whose text only exists inside the envelope. */
  function frame(id: number): any {
    return {
      type: 'message',
      id,
      from: 2,
      to: 1,
      from_name: 'ekaterina',
      content: '',
      server_envelope: { v: 1, kid: 'reader-key', eph: 'e', salt: 's' },
      msg_type: 'text',
      created_at: '2026-10-25T17:59:12Z',
    };
  }

  beforeEach(async () => {
    wsMessages$ = new Subject<any>();
    openFromServer = jasmine.createSpy('openFromServer').and.resolveTo('привет из конверта');
    ensureAccountKey = jasmine.createSpy('ensureAccountKey').and.resolveTo(undefined);

    const mockCrypto = {
      init: jasmine.createSpy().and.returnValue(Promise.resolve()),
      decrypt: jasmine.createSpy().and.returnValue(Promise.resolve(null)),
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
        if (prop === 'getMessages') return () => of([]);
        if (prop === 'getUsers') return () => of([]);
        if (prop === 'getPinned') return () => of({ pinned_user_ids: [] });
        return () => of();
      },
    });

    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        {
          provide: ServerCryptoService,
          useValue: {
            isEnabled: () => true,
            openMany: async (messages: unknown[]) => messages,
            ensureAccountKey,
            hasAccountKey: () => true,
            getAccountPublicKey: () => null,
            sealForServer: async () => null,
            openFromServer,
            fetchServerKey: async () => null,
          },
        },
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

    const fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.selectedUser = {
      id: 2, username: 'ekaterina', email: '', avatar_url: '',
      is_admin: false, is_banned: false, created_at: '', is_online: true,
    } as never;
    (component as unknown as { currentUserId: number }).currentUserId = 1;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('shows the text of a sealed message instead of an empty bubble', fakeAsync(() => {
    wsMessages$.next(frame(901));
    flushMicrotasks();

    const message = component.messages.find((m) => m.id === 901);
    expect(message).withContext('the frame must reach the thread').toBeDefined();
    expect(message!.content)
      .withContext('an empty bubble is what the user reported')
      .toBe('привет из конверта');
    expect(message!.needs_key).toBeFalsy();
    expect(openFromServer).toHaveBeenCalledWith(frame(901).server_envelope);
    // The key is loaded before opening: after a reload nothing else has done it
    // yet, and opening without it always fails.
    expect(ensureAccountKey).toHaveBeenCalled();
  }));

  it('says the key is missing instead of leaving the bubble blank', fakeAsync(() => {
    openFromServer.and.resolveTo(null);

    wsMessages$.next(frame(902));
    flushMicrotasks();

    const message = component.messages.find((m) => m.id === 902);
    expect(message).toBeDefined();
    expect(message!.content).toBe('');
    expect(message!.needs_key)
      .withContext('blank space reads as deleted history')
      .toBeTrue();
  }));

  it('passes on what the server said when the account has no key', fakeAsync(() => {
    const withoutKey = frame(903);
    delete withoutKey.server_envelope;
    withoutKey.needs_key = true;

    wsMessages$.next(withoutKey);
    flushMicrotasks();

    const message = component.messages.find((m) => m.id === 903);
    expect(message).toBeDefined();
    expect(message!.needs_key).toBeTrue();
    expect(openFromServer).not.toHaveBeenCalled();
  }));
});
