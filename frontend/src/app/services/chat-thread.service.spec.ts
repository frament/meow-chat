import { TestBed } from '@angular/core/testing';
import { ChatThreadService, DisplayItem } from './chat-thread.service';
import { Message } from './api.service';

describe('ChatThreadService', () => {
  let service: ChatThreadService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChatThreadService);
  });

  function msg(id: number, iso: string): Message {
    return { id, created_at: iso, content: 'm' + id } as unknown as Message;
  }

  const today = new Date(2026, 9, 25, 12, 0, 0);

  it('returns nothing for an empty thread', () => {
    expect(service.buildDisplayItems([], -1, today)).toEqual([]);
  });

  it('adds one date separator per day, not per message', () => {
    const items = service.buildDisplayItems([
      msg(1, '2026-10-25T10:00:00'),
      msg(2, '2026-10-25T11:00:00'),
      msg(3, '2026-10-25T12:00:00'),
    ], -1, today);

    const seps = items.filter(i => '_dateSep' in i);
    expect(seps.length).toBe(1);
    expect(items.length).toBe(4);
  });

  it('separates a thread that runs past midnight', () => {
    const items = service.buildDisplayItems([
      msg(1, '2026-10-24T23:59:00'),
      msg(2, '2026-10-25T00:01:00'),
    ], -1, today);

    const labels = items.filter(i => '_dateSep' in i).map(i => (i as { label: string }).label);
    expect(labels).toEqual(['Вчера', 'Сегодня']);
  });

  it('puts the unread divider before the message at that index', () => {
    const items = service.buildDisplayItems([
      msg(1, '2026-10-25T10:00:00'),
      msg(2, '2026-10-25T11:00:00'),
    ], 1, today);

    const dividerIdx = items.findIndex(i => '_divider' in i);
    expect(dividerIdx).toBeGreaterThan(-1);
    // The divider sits between message 1 and message 2, and the date separator
    // is not repeated for message 2.
    expect((items[dividerIdx + 1] as Message).id).toBe(2);
    expect((items[dividerIdx - 1] as Message).id).toBe(1);
  });

  it('omits the divider for a negative index', () => {
    const items = service.buildDisplayItems([msg(1, '2026-10-25T10:00:00')], -1, today);
    expect(items.some(i => '_divider' in i)).toBeFalse();
  });

  it('labels today, yesterday and older dates', () => {
    expect(service.dayLabel('2026-10-25T08:00:00', today)).toBe('Сегодня');
    expect(service.dayLabel('2026-10-24T08:00:00', today)).toBe('Вчера');
    // Older date, same year: no year in the label.
    const older = service.dayLabel('2026-09-30T08:00:00', today);
    expect(older).toContain('30');
    expect(older).not.toContain('2026');
  });
});
