import { Injectable, signal } from '@angular/core';

export type LogLevel = 'error' | 'warn' | 'info';

export interface LogLine {
  at: number;
  level: LogLevel;
  text: string;
}

/** How many lines are kept. A ring, because a phone has no console and no log file. */
const MAX_LINES = 200;

/**
 * Everything the app can say about itself from inside itself.
 *
 * Built for the case that produced most of this project's complaints: something
 * is wrong on a phone, there is no access to the server, and the only report is
 * "не работает". Until now that meant "посмотри логи на сервере" - useless when
 * the server is exactly what cannot be reached.
 *
 * The console is wrapped here rather than in the diagnostics panel, so lines are
 * collected from the moment the app starts: a failure during sign-in is usually
 * the one that matters, and by the time somebody opens a panel it has happened.
 */
@Injectable({ providedIn: 'root' })
export class DiagnosticsService {
  readonly open = signal(false);
  readonly logs = signal<LogLine[]>([]);
  /** Last decryption outcome, reported by the chat. */
  readonly lastDecrypt = signal<{ ok: boolean; at: number; kind: string } | null>(null);
  /**
   * Bumped on request. The chat watches it with an effect and scrolls; a counter
   * rather than a boolean so two requests in a row are two events.
   */
  readonly scrollToBottomRequest = signal(0);

  #capturing = false;

  constructor() {
    this.captureConsole();
  }

  show(): void {
    this.open.set(true);
  }

  hide(): void {
    this.open.set(false);
  }

  toggle(): void {
    this.open.update((open) => !open);
  }

  log(level: LogLevel, text: string): void {
    // Newest last, capped. Never calls console: this method is called *from* the
    // console wrapper, and a line here would recurse for ever.
    this.logs.update((lines) => {
      const next = [...lines, { at: Date.now(), level, text }];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }

  reportDecrypt(ok: boolean, kind: string): void {
    this.lastDecrypt.set({ ok, at: Date.now(), kind });
  }

  requestScrollToBottom(): void {
    this.scrollToBottomRequest.update((n) => n + 1);
  }

  clear(): void {
    this.logs.set([]);
  }

  /**
   * Wraps `console.error`/`warn` and the global error hooks once per page.
   *
   * The originals are still called: silencing the console to collect it would
   * trade one blind spot for another.
   */
  private captureConsole(): void {
    if (this.#capturing) return;
    this.#capturing = true;

    const originalError = console.error.bind(console);
    const originalWarn = console.warn.bind(console);

    console.error = (...args: unknown[]) => {
      this.log('error', formatArgs(args));
      originalError(...args);
    };
    console.warn = (...args: unknown[]) => {
      this.log('warn', formatArgs(args));
      originalWarn(...args);
    };

    window.addEventListener('error', (event) => {
      this.log('error', `window.error: ${event.message || 'unknown'} ${event.filename || ''}`.trim());
    });
    window.addEventListener('unhandledrejection', (event) => {
      this.log('error', `unhandledrejection: ${formatArgs([event.reason])}`);
    });
  }
}

/** Short, single-line rendering: a log line is one line on a phone. */
function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ')
    .slice(0, 500);
}
