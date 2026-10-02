import { TestBed } from '@angular/core/testing';
import { ClockService } from './clock.service';

describe('ClockService', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('starts at the current time', () => {
    const clock = TestBed.inject(ClockService);
    const before = Date.now();
    const now = clock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('moves forward when nudged', () => {
    const clock = TestBed.inject(ClockService);
    const first = clock.now();
    // The real tick is a minute away, which no test should wait for. refresh() is
    // the same code path the visibility handler uses.
    clock.refresh();
    expect(clock.now()).toBeGreaterThanOrEqual(first);
  });

  it('exposes now as a signal, not a plain value', () => {
    const clock = TestBed.inject(ClockService);
    // The templates bind to clock.now() so that change detection re-runs the
    // pipe. A getter returning a field would not do that.
    expect(typeof clock.now).toBe('function');
    expect(typeof clock.now()).toBe('number');
  });

  it('is provided in root, so a single timer serves the whole app', () => {
    // The chat list and the admin table both read it. A per-component provider
    // would mean one timer per component, and the two would drift apart.
    const a = TestBed.inject(ClockService);
    const b = TestBed.inject(ClockService);
    expect(a).toBe(b);
  });
});
