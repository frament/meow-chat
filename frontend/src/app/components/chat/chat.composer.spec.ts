import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';

import { signal } from '@angular/core';
import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';

import { ChatComponent } from './chat';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ClockService } from '../../services/clock.service';

/**
 * The composer was an `<input type="text">`, which has no newline at all, so "new
 * paragraph" on a phone was impossible and Enter was the only way out. Reported as
 * an iPhone problem; it was not one, and no iOS setting changes it.
 */
describe('ChatComponent composer', () => {
  let fixture: ComponentFixture<ChatComponent>;
  let component: ChatComponent;
  let sendMessage: jasmine.Spy;
  let mockApi: Record<string, unknown>;

  function composers(): HTMLTextAreaElement[] {
    // Karma mounts the component itself as the fixture root - there is no
    // <app-chat> element around it.
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLTextAreaElement>('textarea[rows="1"]'),
    );
  }

  function composer(): HTMLTextAreaElement {
    return composers()[0];
  }

  beforeEach(async () => {
    const wsMessages$ = new Subject<any>();
    mockApi = new Proxy({} as Record<string, unknown>, {
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
        { provide: ApiService, useValue: mockApi as unknown as ApiService },
        { provide: CryptoService, useValue: { init: () => Promise.resolve() } },
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
            navigate: () => {}, navigateByUrl: () => {}, createUrlTree: () => ({}),
            serializeUrl: () => '', events: of(null), url: '',
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.selectedUser = {
      id: 2, username: 'friend', email: '', avatar_url: '',
      is_admin: false, is_banned: false, created_at: '', is_online: false,
    } as never;
    fixture.detectChanges();

    sendMessage = spyOn(component, 'sendMessage').and.resolveTo();
  });

  it('is a textarea, not an input — an input cannot hold a newline', () => {
    // The desktop pane renders here; the phone pane sits behind
    // @if (showMobileChat ...), so it is checked separately below.
    const el = composer();
    expect(el).toBeTruthy();
    expect(el.tagName).toBe('TEXTAREA');
    // No message field may be left as an <input> - that is what made a paragraph
    // break impossible. The remaining inputs are search and poll options, which
    // are single-line by nature.
    const inputs = (fixture.nativeElement as HTMLElement).querySelectorAll('input[type="text"]');
    inputs.forEach((i) => {
      expect((i as HTMLInputElement).placeholder || '').not.toContain('Напишите сообщение');
    });
  });

  it('uses a textarea in the phone layout too, not only on desktop', () => {
    // Both panes were an <input> and both had to change. Checking the rendered
    // desktop pane alone would miss the phone one - which is the layout that was
    // actually broken, so it gets rendered here on purpose.
    (component as unknown as { showMobileChat: boolean }).showMobileChat = true;
    fixture.detectChanges();

    const found = composers();
    expect(found.length).toBe(2);
    found.forEach((el) => expect(el.tagName).toBe('TEXTAREA'));

    // And no message field anywhere is still an <input>.
    const messageInputs = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'input[placeholder*="Напишите сообщение"], input[placeholder*="Подпись к изображению"]',
    );
    expect(messageInputs.length).toBe(0);
  });

  it('sends on a plain Enter', () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    composer().dispatchEvent(event);
    expect(sendMessage).toHaveBeenCalled();
  });

  it('does not send on Shift+Enter, and lets the newline through', () => {
    // This is the whole point of the change: a paragraph break on a phone.
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
    composer().dispatchEvent(event);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores every other key', () => {
    for (const key of ['a', 'Tab', 'ArrowDown', 'Escape']) {
      sendMessage.calls.reset();
      composer().dispatchEvent(new KeyboardEvent('keydown', { key }));
      expect(sendMessage).not.toHaveBeenCalled();
    }
  });

  it('grows with the content', fakeAsync(() => {
    const el = composer();
    // jsdom-less browser: scrollHeight is 0, so assert the wiring rather than the
    // resulting pixel height - the latter is layout, and layout is what the CSS
    // max-height and field-sizing are for.
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 140 });
    el.dispatchEvent(new Event('input'));
    tick();
    expect(el.style.height).toBe('140px');
  }));

  it('has room to grow but does not eat the thread', () => {
    // max-height keeps a long message from covering the conversation; the thread
    // is pinned by the sticky-bottom work, and this is its counterpart.
    const el = composer();
    expect(el.style.maxHeight).toBe('140px');
    expect(el.style.resize).toBe('none');
  });
  it('tells an expired session apart from a network failure', () => {
    // The banner used to say "no connection" for everything and offered "retry",
    // which cannot help a 401: the interceptor already tried the refresh, and
    // reaching here means the session is gone.
    (component as any).noteLoadFailure(401);
    expect(component.messagesLoadFailed()).toBe(true);
    expect(component.loadFailureReason()).toContain('войти заново');

    (component as any).noteLoadFailure(503);
    expect(component.loadFailureReason()).toContain('Сервер');

    (component as any).noteLoadFailure(404);
    expect(component.loadFailureReason()).toContain('не найден');

    (component as any).noteLoadFailure(0);
    expect(component.loadFailureReason()).toContain('нет связи');

    (component as any).noteLoadSuccess();
    expect(component.messagesLoadFailed()).toBe(false);
  });

  it('shows the reason for a failed group thread load, and recovers', () => {
    // Same bug the direct chats had: a failed request never reached the callback,
    // so nothing scrolled and the group thread looked empty rather than broken.
    (component as any).noteLoadFailure(undefined);
    expect(component.messagesLoadFailed()).toBe(true);
    (component as any).noteLoadSuccess();
    expect(component.messagesLoadFailed()).toBe(false);
  });
});
