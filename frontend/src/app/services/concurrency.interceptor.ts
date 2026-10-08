import { HttpErrorResponse, HttpEvent, HttpInterceptorFn } from '@angular/common/http';
import { defer, from, Observable } from 'rxjs';
import { concatMap, tap } from 'rxjs/operators';

/**
 * Limits how many API requests may be in flight at once, and finds that limit
 * instead of assuming one.
 *
 * Why not a constant. The path this app travels is a relay, and the relay's
 * ceiling is not a property of the app: on one measurement three parallel
 * requests went through and the fourth never left the browser, and on a Mac over
 * the same LTE link twenty-five bursts of ten passed untouched. A fixed number is
 * either too low - slow everywhere for no reason - or too high, and a request
 * over the limit silently never departs. Guessing is what sent this investigation
 * down several wrong layers.
 *
 * So it starts at one and behaves like TCP slow start: after a run of successes it
 * opens one more slot, and the first request that never reaches the server drops
 * it back to one. A good link reaches the ceiling in a few round-trips and never
 * notices. A bad one settles at whatever it can actually carry.
 *
 * Any response counts as proof the road is open - including 401 and 500, because
 * a refusal is still an answer, and a server refusing has nothing to do with
 * whether the network works. Only a request that got nothing at all moves the
 * limit back down.
 *
 * Uploads are exempt: they are long by nature, one holding the gate would stall
 * everything behind it, and their slowness says nothing about the path.
 */

/** The most this will ever open. A healthy link should reach it and stay there. */
const MAX_CONCURRENT_REQUESTS = 6;

/** Where it starts. One, because the first thing the app does is ask something. */
const INITIAL_CONCURRENT_REQUESTS = 1;

/** Successes in a row before opening another slot. */
const SUCCESSES_PER_STEP = 2;

let limit = INITIAL_CONCURRENT_REQUESTS;
let streak = 0;
let active = 0;
const waiting: Array<() => void> = [];

/**
 * True when the request never reached the server, as opposed to being refused by
 * it. Only status 0 means that: no response at all, from a timeout or from a
 * connection the relay dropped. A backend may also hand the subscriber the raw
 * failure event, which carries no status - there is no answer in that case either.
 */
function isLost(err: unknown): boolean {
  if (err instanceof HttpErrorResponse) {
    return err.status === 0;
  }
  return true;
}

function onDelivered(): void {
  streak++;
  if (streak < SUCCESSES_PER_STEP || limit >= MAX_CONCURRENT_REQUESTS) return;
  limit++;
  streak = 0;
}

function onLost(): void {
  limit = INITIAL_CONCURRENT_REQUESTS;
  streak = 0;
}

/**
 * Hands the slot straight to the next waiter. `active` is deliberately unchanged:
 * one slot is passed on, not created.
 */
function handOver(): void {
  const next = waiting.shift();
  if (next) next();
}

function releaseSlot(): void {
  handOver();
  // Nobody took it over, so the slot is genuinely free again.
  if (waiting.length === 0) active--;
}

interface Slot {
  promise: Promise<void>;
  /**
   * Called when the request is dropped before it ever starts - unsubscribed while
   * still queued. A waiter left behind would have a slot handed to it later that
   * nobody uses, and the gate would lose one slot for good: after a handful of
   * cancelled requests it stops opening at all.
   */
  abandon(): void;
}

function acquire(): Slot {
  if (active < limit) {
    active++;
    return { promise: Promise.resolve(), abandon: () => releaseSlot() };
  }

  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  let granted = false;
  const entry = () => {
    if (granted) return;
    granted = true;
    resolve();
  };
  waiting.push(entry);

  return {
    promise,
    abandon: () => {
      if (granted) {
        // The slot is already ours; give it back.
        releaseSlot();
        return;
      }
      const i = waiting.indexOf(entry);
      if (i >= 0) waiting.splice(i, 1);
    },
  };
}

export const concurrencyInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.body instanceof FormData) {
    return next(req);
  }

  return defer(() =>
    // A plain Observable rather than a promise chain, so that unsubscribing while
    // the request is still waiting can hand its place in the queue back.
    new Observable<HttpEvent<unknown>>((subscriber) => {
      const slot = acquire();

      const inner = from(slot.promise).pipe(
        concatMap(() => {
          // Один запрос считается один раз. Ответ с кодом не 2xx приходит по
          // этой цепочке и как next, и как error, а tap сообщает оба события
          // отдельно, поэтому защита на каждый обработчик засчитала бы один и тот
          // же ответ дважды и открыла слот после единственного запроса. Флаг
          // общий у обоих обработчиков.
          //
          // Исключение - потеря: раз запрос ни до чего не дошёл, потолок
          // возвращается к единице независимо от того, успел ли next пройти
          // раньше. Порядок событий здесь не должен решать, доверять ли пути.
          let counted = false;
          return next(req).pipe(
            tap({
              next: () => {
                if (counted) return;
                counted = true;
                onDelivered();
              },
              error: (err: unknown) => {
                if (isLost(err)) {
                  counted = true;
                  onLost();
                  return;
                }
                if (counted) return;
                counted = true;
                onDelivered();
              },
            }),
          );
        }),
      );

      const sub = inner.subscribe(subscriber);
      return () => {
        slot.abandon();
        sub.unsubscribe();
      };
    }),
  );
};

/** Exported so a test cannot drift from the value the app actually uses. */
export const MAX_CONCURRENT = MAX_CONCURRENT_REQUESTS;
export const INITIAL_CONCURRENT = INITIAL_CONCURRENT_REQUESTS;
export const SUCCESSES_TO_STEP = SUCCESSES_PER_STEP;

/** Test-only: puts the gate back to its starting state between specs. */
export function resetConcurrency(): void {
  limit = INITIAL_CONCURRENT_REQUESTS;
  streak = 0;
  active = 0;
  waiting.length = 0;
}

/** Test-only: how many slots are open right now. */
export function currentLimit(): number {
  return limit;
}

/** Test-only: how many requests are actually in flight. */
export function inFlight(): number {
  return active;
}