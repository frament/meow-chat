import { TestBed, fakeAsync, flushMicrotasks, discardPeriodicTasks } from '@angular/core/testing';
import { signal } from '@angular/core';

import { DiagnosticsComponent } from './diagnostics';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ServerCryptoService } from '../../services/server-crypto.service';
import { DiagnosticsService } from '../../services/diagnostics.service';
import { ChatStorageService } from '../../services/chat-storage.service';

/**
 * The panel exists for the moment when a phone is broken and the server cannot be
 * reached. So the tests are about the three things that make it useful then: it
 * shows what the socket is actually doing, its buttons act instead of decorate,
 * and a copy of the log really leaves the device.
 */
describe('DiagnosticsComponent', () => {
  let sendMessage: jasmine.Spy;
  let retryConnection: jasmine.Spy;
  let clearCaches: jasmine.Spy;
  let diagnostics: {
    open: ReturnType<typeof signal<boolean>>;
    logs: ReturnType<typeof signal<any[]>>;
    lastDecrypt: ReturnType<typeof signal<any>>;
    scrollToBottomRequest: ReturnType<typeof signal<number>>;
    show: jasmine.Spy; hide: jasmine.Spy; toggle: jasmine.Spy;
    log: jasmine.Spy; reportDecrypt: jasmine.Spy; requestScrollToBottom: jasmine.Spy; clear: jasmine.Spy;
  };
  let originalFetch: typeof fetch;

  const api = {
    wsConnected: signal(true),
    wsReadyState: signal(WebSocket.OPEN),
    wsFramesReceived: signal(12),
    wsDuplicateFrames: signal(2),
    wsLastFrameAt: signal(Date.now()),
    wsReconnectAttempts: signal(3),
    currentUser: signal({ id: 7, username: 'me' }),
  };

  beforeEach(async () => {
    sendMessage = jasmine.createSpy('sendMessage').and.returnValue({ subscribe: (o: any) => o.next?.() });
    retryConnection = jasmine.createSpy('retryConnection');
    clearCaches = jasmine.createSpy('clearCaches').and.returnValue(4);

    diagnostics = {
      open: signal(false),
      logs: signal([
        { at: 1_700_000_000_000, level: 'error', text: 'первая ошибка' },
        { at: 1_700_000_001_000, level: 'warn', text: 'второе предупреждение' },
      ]),
      lastDecrypt: signal({ ok: false, at: 1_700_000_002_000, kind: 'dm' }),
      scrollToBottomRequest: signal(0),
      show: jasmine.createSpy('show'),
      hide: jasmine.createSpy('hide'),
      toggle: jasmine.createSpy('toggle'),
      log: jasmine.createSpy('log'),
      reportDecrypt: jasmine.createSpy('reportDecrypt'),
      requestScrollToBottom: jasmine.createSpy('requestScrollToBottom').and.callFake(() =>
        diagnostics.scrollToBottomRequest.update((n) => n + 1),
      ),
      clear: jasmine.createSpy('clear'),
    };

    originalFetch = globalThis.fetch;
    globalThis.fetch = jasmine.createSpy('fetch').and.callFake(async (input: any) => {
      const url = String(input);
      if (url.includes('/api/health')) {
        return { ok: true, status: 200, text: async () => '{"status":"ok"}' } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ connections: 2, messages_sent: 40, write_errors: 1, closed: 3 }),
      } as unknown as Response;
    });

    await TestBed.configureTestingModule({
      imports: [DiagnosticsComponent],
      providers: [
        {
          provide: ApiService,
          useValue: { ...api, sendMessage, retryConnection },
        },
        {
          provide: CryptoService,
          useValue: { hasIdentityKey: async () => true, needsRecovery: signal(false) },
        },
        {
          provide: ServerCryptoService,
          useValue: { isEnabled: () => true, hasAccountKey: () => true },
        },
        { provide: DiagnosticsService, useValue: diagnostics },
        { provide: ChatStorageService, useValue: { clearCaches } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function create() {
    const fixture = TestBed.createComponent(DiagnosticsComponent);
    fixture.detectChanges();
    return fixture;
  }

  /** Runs what the async actions started and re-renders: signals do not repaint by themselves. */
  function settle(fixture: { detectChanges: () => void }) {
    flushMicrotasks();
    fixture.detectChanges();
  }

  it('shows what the socket is doing, including duplicates', fakeAsync(() => {
    const fixture = create();
    flushMicrotasks();

    const text = fixture.nativeElement.textContent as string;
    expect(text).withContext('the panel must say the socket is up').toContain('OPEN');
    expect(text).withContext('frames received').toContain('12');
    expect(text).withContext('the duplicate count is the whole point of that line').toContain('2');
    expect(text).toContain('попыток переподключения 3');

    discardPeriodicTasks();
  }));

  it('probes /api/health and reports the timing', fakeAsync(() => {
    const fixture = create();
    settle(fixture);

    expect(fetch).toHaveBeenCalled();
    const text = fixture.nativeElement.textContent as string;
    expect(text).withContext('a probe that says nothing is useless').toContain('мс');

    discardPeriodicTasks();
  }));

  it('asks the server for its own counters', fakeAsync(() => {
    const fixture = create();
    settle(fixture);
    fixture.componentInstance.checkServer();
    settle(fixture);

    const text = fixture.nativeElement.textContent as string;
    expect(text).withContext('connections from /api/ws-health').toContain('соединений 2');
    expect(text).toContain('ошибок записи 1');

    discardPeriodicTasks();
  }));

  it('sends the test message to the signed-in user, not to nobody', fakeAsync(() => {
    const fixture = create();
    flushMicrotasks();

    fixture.componentInstance.sendSelf();
    flushMicrotasks();

    expect(sendMessage).toHaveBeenCalled();
    expect(sendMessage.calls.mostRecent().args[0])
      .withContext('the recipient is the current user id')
      .toBe(7);

    discardPeriodicTasks();
  }));

  it('clears the chat cache and says how much went', fakeAsync(() => {
    const fixture = create();
    flushMicrotasks();

    fixture.componentInstance.clearCache();
    settle(fixture);

    expect(clearCaches).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Удалено записей кэша: 4');

    discardPeriodicTasks();
  }));

  it('asks the chat to scroll, and says it only works with a thread open', fakeAsync(() => {
    const fixture = create();
    flushMicrotasks();

    fixture.componentInstance.scrollToBottom();
    settle(fixture);

    expect(diagnostics.requestScrollToBottom).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('если открыт чат');

    discardPeriodicTasks();
  }));

  it('copies the log so it can leave the phone', fakeAsync(() => {
    const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const fixture = create();
    flushMicrotasks();

    void fixture.componentInstance.copyLogs();
    flushMicrotasks();

    expect(writeText).toHaveBeenCalled();
    const copied = writeText.calls.mostRecent().args[0] as string;
    expect(copied).withContext('both levels travel').toContain('первая ошибка');
    expect(copied).toContain('второе предупреждение');

    discardPeriodicTasks();
  }));

  it('renders the log newest first, because the last line is the one that matters', fakeAsync(() => {
    const fixture = create();
    flushMicrotasks();

    const lines = (
      Array.from(fixture.nativeElement.querySelectorAll('.diag-line')) as HTMLElement[]
    ).map((el) => el.textContent ?? '');
    expect(lines.length).toBe(2);
    expect(lines[0]).withContext('newest on top').toContain('второе предупреждение');

    discardPeriodicTasks();
  }));
});
