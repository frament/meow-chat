import { DestroyRef, Injectable, signal } from '@angular/core';

/**
 * A minute-resolution clock, for anything that renders relative time.
 *
 * The reason this exists: a pipe that reads `Date.now()` inside itself does not
 * re-run. Angular only recomputes a pure pipe when one of its *arguments*
 * changes, and a function call on the wall clock is not an argument. So
 * "5 minutes ago" stayed on screen until the next `last_seen` arrived from a
 * WebSocket event or a refetch, which for a user who left twenty minutes ago is
 * never.
 *
 * Making the pipe impure instead would fix the staleness and cost more than it
 * looks: impure pipes run on every change detection pass, which in a list of a
 * hundred people is a hundred string builds several times a second to produce
 * the same text. Passing the time in as an argument keeps the pipe pure, so the
 * work happens once a minute and only for the rows on screen.
 *
 * It ticks only while the tab is visible. A hidden tab is not showing anyone a
 * stale time, and a phone left face-up on a table with the app open is exactly
 * the case where a timer nobody sees is pure waste.
 */
@Injectable({ providedIn: 'root' })
export class ClockService {
  private readonly current = signal(Date.now());
  readonly now = this.current.asReadonly();

  private readonly tick = setInterval(() => this.refresh(), 60_000);

  constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => clearInterval(this.tick));
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', this.onVisibility));
    }
  }

  /**
   * Nudges the clock. The next minute boundary is close enough for text that only
   * changes once a minute, and asking for a prompt update means returning to the
   * tab shows the right time immediately rather than up to a minute late.
   */
  refresh(): void {
    this.current.set(Date.now());
  }

  private readonly onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.refresh();
    }
  };
}
