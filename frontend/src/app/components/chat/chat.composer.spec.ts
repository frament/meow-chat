import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';

import { signal } from '@angular/core';
import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';

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
  // The proxy below answers every property read, so `() => jasmine.createSpy()`
  // would hand out a fresh spy each time and an assertion would inspect a
  // different object from the one the component called. It is created once.
  let apiSendMessage: jasmine.Spy;
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
    apiSendMessage = jasmine.createSpy('api.sendMessage').and.returnValue(of({ id: 99 }));
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
        if (prop === 'sendMessage') return apiSendMessage;
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

  /** Pretends the device is one thing or the other. */
  function pretendPointer(coarse: boolean, hover: boolean): void {
    spyOn(window, 'matchMedia').and.callFake((query: string) => ({
      matches: query.includes('pointer: coarse') ? coarse : hover,
    }) as MediaQueryList);
  }

  it('sends on a plain Enter with a hardware keyboard', () => {
    pretendPointer(false, true);
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    composer().dispatchEvent(event);
    expect(sendMessage).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not send on Shift+Enter, and lets the newline through', () => {
    pretendPointer(false, true);
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
    composer().dispatchEvent(event);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves Enter alone on a phone keyboard, so a paragraph is possible', () => {
    // The reported bug: a software keyboard has no Shift, so Shift+Enter is
    // unreachable and taking Enter for "send" left no way to break a line.
    pretendPointer(true, false);
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    composer().dispatchEvent(event);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('still sends on Enter when a touchscreen laptop also has a keyboard', () => {
    // Coarse pointer *and* hover: a real keyboard is present, so Enter sends.
    pretendPointer(true, true);
    composer().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(sendMessage).toHaveBeenCalled();
  });

  it('ignores every other key', () => {
    pretendPointer(false, true);
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

  function sendButtons(): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button[title="Отправить"]'),
    );
  }

  /**
   * The poll composer had no send button at all: the template renders the poll
   * fields in the @if branch and the send button only in the @else, so choosing
   * "poll" left the user with inputs and no way to send them. Reported as "the
   * button is hidden behind the bottom nav on mobile"; it was not hidden, it was
   * not rendered, on either layout.
   */
  it('renders a send button while composing a poll', () => {
    component.messageType = 'poll';
    fixture.detectChanges();

    const buttons = sendButtons();
    expect(buttons.length)
      .withContext('a poll composer with no send button cannot be used')
      .toBeGreaterThan(0);

    buttons[0].click();
    expect(sendMessage).toHaveBeenCalled();
  });

  it('renders the poll send button in the phone layout too', () => {
    (component as unknown as { showMobileChat: boolean }).showMobileChat = true;
    component.messageType = 'poll';
    fixture.detectChanges();

    // Both panes render here, and both had to be fixed: the markup exists twice,
    // and a fix applied to one copy has silently missed the other before.
    expect(sendButtons().length).toBeGreaterThanOrEqual(2);
  });

  it('sends a poll with its question and options', async () => {
    sendMessage.and.callThrough();

    component.messageType = 'poll';
    component.messageContent = 'Куда идём?';
    component.pollOptions = ['Парк', 'Кино'];
    await component.sendMessage();

    expect(apiSendMessage).toHaveBeenCalled();
    const args = apiSendMessage.calls.mostRecent().args;
    expect(args[3]).withContext('message type').toBe('poll');
    expect(args[1]).withContext('question travels as content').toBe('Куда идём?');
    expect(args[7]).withContext('options').toEqual(['Парк', 'Кино']);
  });

  it('refuses a poll with fewer than two options and says why', async () => {
    sendMessage.and.callThrough();
    apiSendMessage.calls.reset();

    component.messageType = 'poll';
    component.messageContent = 'Вопрос';
    component.pollOptions = ['один', '   '];
    await component.sendMessage();

    expect(apiSendMessage).not.toHaveBeenCalled();
    // Returning silently left the user pressing a button that did nothing.
    expect(component.sendError()).toContain('минимум два варианта');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent)
      .withContext('the reason must be visible while composing a poll')
      .toContain('минимум два варианта');
  });

  /**
   * The optimistic bubble must not survive a failed send: the user would see a
   * message that never reached anyone, with no way to tell.
   *
   * A sticker is used on purpose - structural types skip encryption, so this
   * exercises the send/rollback path without standing up the crypto mock.
   */
  it('rolls the optimistic bubble back when the send fails', async () => {
    sendMessage.and.callThrough();
    apiSendMessage.and.returnValue(throwError(() => new Error('offline')));

    component.messageType = 'sticker';
    component.messageContent = '42';
    const before = component.messages.length;

    await component.sendMessage();

    expect(component.messages.length)
      .withContext('the failed message must be removed, not left pending')
      .toBe(before);
    expect((component as unknown as { sending: boolean }).sending).toBeFalse();
  });
});
