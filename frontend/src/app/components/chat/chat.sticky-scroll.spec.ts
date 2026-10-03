import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import { signal } from '@angular/core';
import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

import { ChatComponent } from './chat';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ClockService } from '../../services/clock.service';

/**
 * Thread pinning: .chat-scroll is a flex column and .thread-inner carries
 * margin-top:auto, so a thread shorter than the container sits at the bottom with
 * no JavaScript at all. Scrolling still needs one real scroll once the thread
 * overflows, which is what the ResizeObserver does - and only while the reader is
 * actually at the bottom.
 *
 * ResizeObserver is stubbed rather than awaited because the real one is
 * asynchronous: these tests are about *which* scroll happens, not about layout.
 */
describe('ChatComponent thread pinning', () => {
  let fixture: ComponentFixture<ChatComponent>;
  /** One entry per ResizeObserver the component created, with what it watches. */
  let observers: Array<{ callback: () => void; targets: Element[] }>;
  let observed: HTMLElement[];
  let originalResizeObserver: typeof ResizeObserver | undefined;

  /** Minimal stand-in: the component only ever calls observed callbacks. */
  class StubResizeObserver {
    private readonly targets: Element[] = [];

    constructor(private readonly callback: () => void) {
      observers.push({ callback, targets: this.targets });
    }
    observe(target: Element): void {
      this.targets.push(target);
      if (!observed.includes(target as HTMLElement)) observed.push(target as HTMLElement);
    }
    unobserve(): void {}
    disconnect(): void {}
  }

  /**
   * TestBed geometry is whatever the detached document gives us (usually "no
   * overflow"), so the scroll maths is pinned to numbers the component can read.
   */
  function giveGeometry(el: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop: number): void {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
    Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
  }

  /**
   * The observer watches the inner wrapper, not the scroller: that is the element
   * whose height changes when a message or an image arrives.
   */
  function threadInner(index: number): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.chat-scroll > .thread-inner')[index];
  }

  /**
   * Fires observer `index` the way a resize of `target` would - and only if it is
   * watching that target. Without this guard the stub would happily deliver a
   * callback for a resize nothing was watching, and a test could pass while the
   * observer was pointed at the wrong element.
   */
  function elementResized(index: number, target: Element): void {
    if (!observers[index].targets.includes(target)) {
      throw new Error(`observer #${index} does not watch ${target.className}`);
    }
    observers[index].callback();
  }

  /** Fires the observer for one container the way a grown thread would. */
  function threadGrew(index: number): void {
    elementResized(index, threadInner(index));
  }

  function desktopContainer(): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.chat-scroll')[0];
  }

  beforeEach(async () => {
    observers = [];
    observed = [];
    originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;

    // Anything the component asks for resolves to an empty result; only the
    // signals it reads synchronously need real values.
    const anyApi = new Proxy({} as Record<string, unknown>, {
      get: (_target, prop) => {
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
        if (prop === 'wsMessages$' || prop === 'wsOnlineEvent' || prop === 'groupInfoRequest$') return of();
        return () => of();
      },
    });

    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        { provide: ApiService, useValue: anyApi as unknown as ApiService },
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
    // Both scroll containers sit behind `@if (selectedUser || selectedGroup)`, so
    // the thread has to exist before the first change detection - which is when
    // ngAfterViewInit wires the observers up.
    fixture.componentInstance.selectedUser = {
      id: 2, username: 'friend', email: '', avatar_url: '',
      is_admin: false, is_banned: false, created_at: '', is_online: false,
    } as never;
    fixture.detectChanges();
  });

  afterEach(() => {
    window.ResizeObserver = originalResizeObserver as typeof ResizeObserver;
  });

  it('observes the desktop thread on first render', () => {
    expect(observed).toEqual([threadInner(0), desktopContainer()]);
  });

  it('wires the phone thread up when the layout switches to it', () => {
    // The mobile container is behind `@if (showMobileChat ...)`, so it is not in
    // the DOM yet. Opening the thread on a phone has to attach its own observer -
    // otherwise the phone thread never follows the bottom.
    (fixture.componentInstance as unknown as { showMobileThread(): void }).showMobileThread();
    fixture.detectChanges();
    // afterNextRender is an ApplicationRef hook, so it needs a tick of its own
    // rather than riding along on change detection.
    TestBed.inject(ApplicationRef).tick();

    // Both threads are watched now - the phone one included.
    expect(threadInner(1)).toBeTruthy();
    expect(observed).toContain(threadInner(0));
    expect(observed).toContain(threadInner(1));
  });

  it('holds the bottom while the reader is at the bottom', () => {
    const container = desktopContainer();
    giveGeometry(container, 1000, 400, 600);
    container.dispatchEvent(new Event('scroll'));

    // Thread grows - a message arrives, an image finishes loading.
    Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 1400 });
    threadGrew(0);

    expect(container.scrollTop).toBe(1400);
  });

  it('re-pins when the container itself resizes and the thread does not', () => {
    const container = desktopContainer();
    giveGeometry(container, 1400, 400, 1000);
    container.dispatchEvent(new Event('scroll'));

    // The keyboard: mobileChatHeight grows the phone layout, the thread inside it
    // stays the same size. Only the scroller changed, and the reader was at the
    // bottom, so the bottom has to follow - otherwise the last messages sit under
    // the keyboard.
    Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => 200 });
    elementResized(0, container);

    expect(container.scrollTop).toBe(1400);
  });

  it('leaves the reader alone once they scroll up into earlier history', () => {
    const container = desktopContainer();
    // Thread overflows and the reader scrolls well away from the bottom.
    giveGeometry(container, 1400, 400, 0);
    container.dispatchEvent(new Event('scroll'));

    Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 1800 });
    threadGrew(0);

    // Still reading message 1 of 40 - a new message must not drag them away.
    expect(container.scrollTop).toBe(0);
  });

  it('resumes following once the reader comes back to the bottom', () => {
    const container = desktopContainer();
    giveGeometry(container, 1400, 400, 0);
    container.dispatchEvent(new Event('scroll'));
    Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 1800 });
    threadGrew(0);
    expect(container.scrollTop).toBe(0);

    // Reader scrolls back down, close enough to the bottom to count as following.
    container.scrollTop = 1340;
    container.dispatchEvent(new Event('scroll'));
    Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 2000 });
    threadGrew(0);

    expect(container.scrollTop).toBe(2000);
  });
});
