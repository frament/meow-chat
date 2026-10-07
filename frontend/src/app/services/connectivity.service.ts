import { Injectable, signal } from '@angular/core';

export interface ConnectionProblem {
  /** What the client can honestly say about what happened. */
  reason: string;
  /** The HTTP status, or 0 when nothing answered at all. */
  status: number;
}

/**
 * Remembers that the server could not be reached, so a screen can say so.
 *
 * The banner used to live only in the chat component. On the feed, in settings and
 * on the login screen a failed request was silent: the page rendered, just empty,
 * with nothing on it saying that the emptiness was not a state of the data. On a
 * flaky link that reads as "the app is broken" rather than as "the request failed",
 * and there is no cue that anything could be done about it.
 *
 * Driven by actual HTTP outcomes rather than `navigator.onLine`. The link can be
 * up and the server still unreachable - measured on LTE: a proxy in front of this
 * app returned 504 after 98 seconds, having never forwarded the request at all -
 * and `onLine` reports the phone's radio, which in that case was perfectly fine.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  readonly problem = signal<ConnectionProblem | null>(null);

  /**
   * Called for every failed request. 4xx is deliberately ignored: 401/403 is an
   * expired session and 404 is a wrong path, and a banner that says "no
   * connection" over either sends people to look at their Wi-Fi for a problem
   * that logging in again would have fixed.
   */
  reportFailure(status: number): void {
    if (status >= 400 && status < 500) return;
    this.problem.set({
      reason: status >= 500
        ? 'Сервер отвечает с ошибкой. Попробуйте ещё раз.'
        : 'Нет связи с сервером. Проверьте подключение к интернету.',
      status,
    });
  }

  /**
   * Called for every answered request. One success is proof enough that the link
   * works; the thing that was broken is no longer broken, and leaving a stale
   * "no connection" up is how a banner trains people to ignore it.
   */
  reportSuccess(): void {
    this.problem.set(null);
  }
}