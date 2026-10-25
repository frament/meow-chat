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

  describe('mergeMessages', () => {
    const m = (id: number, iso: string, isRead = false) =>
      ({ id, created_at: iso, is_read: isRead, content: 'm' + id }) as unknown as Message;

    it('adds new messages and keeps the thread sorted', () => {
      const existing = [m(1, '2026-10-25T10:00:00')];
      const incoming = [m(3, '2026-10-25T12:00:00'), m(2, '2026-10-25T11:00:00')];

      const { messages, addedIds } = service.mergeMessages(existing, incoming);

      expect(messages.map(x => x.id)).toEqual([1, 2, 3]);
      expect(addedIds).toEqual([3, 2]);
    });

    /** An optimistic send is not in the server's answer yet; losing it would
     *  make the message the user just sent disappear from the screen. */
    it('keeps messages the fetch does not know about', () => {
      const optimistic = { id: -1, created_at: '2026-10-25T13:00:00', content: 'unsent' } as unknown as Message;
      const existing = [m(1, '2026-10-25T10:00:00'), optimistic];

      const { messages, addedIds } = service.mergeMessages(existing, [m(2, '2026-10-25T11:00:00')]);

      expect(messages.map(x => x.id)).toEqual([1, 2, -1]);
      expect(addedIds).toEqual([2]);
    });

    // Recovery on prod made this concrete: 16 messages were turned back into
    // plaintext on the server, and every device that had them cached kept the
    // placeholder - mergeMessages only ever copied is_read across. The text
    // existed and could not be seen.
    it('replaces a cached placeholder with real text from the server', () => {
      const cached = { id: 1, created_at: '2026-10-25T10:00:00', is_read: true, content: '[Зашифрованное сообщение]' } as unknown as Message;
      const fromServer = { id: 1, created_at: '2026-10-25T10:00:00', is_read: true, content: 'Прием прием' } as unknown as Message;

      const { messages } = service.mergeMessages([cached], [fromServer]);

      expect(messages[0].content).toBe('Прием прием');
    });

    it('keeps real cached text when the server answer is a placeholder', () => {
      // The device could decrypt once and cannot now: the text it already holds
      // is strictly better than the placeholder.
      const cached = { id: 1, created_at: '2026-10-25T10:00:00', content: 'настоящий текст' } as unknown as Message;
      const fromServer = { id: 1, created_at: '2026-10-25T10:00:00', content: '[Зашифрованное сообщение]' } as unknown as Message;

      const { messages } = service.mergeMessages([cached], [fromServer]);

      expect(messages[0].content).toBe('настоящий текст');
    });

    it('does not duplicate an id that is already in the thread', () => {
      const existing = [m(1, '2026-10-25T10:00:00')];
      const { messages, addedIds } = service.mergeMessages(existing, [m(1, '2026-10-25T10:00:00')]);

      expect(messages.length).toBe(1);
      expect(addedIds).toEqual([]);
    });

    it('refreshes the read flag on an existing message', () => {
      const existing = [m(1, '2026-10-25T10:00:00', false)];
      const { messages } = service.mergeMessages(existing, [m(1, '2026-10-25T10:00:00', true)]);

      expect(messages[0].is_read).toBeTrue();
      // Same object, so the rendered bubble is not rebuilt.
      expect(messages[0]).toBe(existing[0]);
    });

    it('returns the existing thread unchanged for an empty answer', () => {
      const existing = [m(1, '2026-10-25T10:00:00')];
      const { messages, addedIds } = service.mergeMessages(existing, []);

      expect(messages.map(x => x.id)).toEqual([1]);
      expect(addedIds).toEqual([]);
    });
  });

  describe('optimistic send bookkeeping', () => {
    const m = (id: number, extra: Record<string, unknown> = {}) =>
      ({ id, created_at: '2026-10-25T10:00:00', content: 'x', ...extra }) as unknown as Message;

    it('claim rejects a duplicate id and accepts a missing one', () => {
      const seen = new Set<number>();
      expect(service.claim(seen, 1)).toBeTrue();
      expect(service.claim(seen, 1)).toBeFalse();
      // A frame with no id is always accepted.
      expect(service.claim(seen, undefined)).toBeTrue();
    });

    /** The temporary id must leave `seen` and the real one enter it, or the next
     *  frame for this message arrives as a duplicate of what is on screen. */
    it('finalize replaces the temp id in the message and in the seen index', () => {
      const seen = new Set<number>([-1]);
      const messages = [m(-1, { pending: true })];

      const found = service.finalizeOptimistic(messages, seen, -1, { id: 42, sticker_url: '/s.png' });

      expect(found).toBeTrue();
      expect(messages[0].id).toBe(42);
      expect(messages[0].pending).toBeFalse();
      expect(messages[0].sticker_url).toBe('/s.png');
      expect(seen.has(-1)).toBeFalse();
      expect(seen.has(42)).toBeTrue();
    });

    it('finalize reports a message that is no longer in the thread', () => {
      expect(service.finalizeOptimistic([m(1)], new Set(), -1)).toBeFalse();
    });

    it('rollback removes the message and forgets its temp id', () => {
      const seen = new Set<number>([-1]);
      const messages = [m(1), m(-1)];

      expect(service.rollbackOptimistic(messages, seen, -1)).toBeTrue();
      expect(messages.map(x => x.id)).toEqual([1]);
      expect(seen.has(-1)).toBeFalse();
    });

    it('rollback is a no-op for an unknown temp id', () => {
      expect(service.rollbackOptimistic([m(1)], new Set(), -9)).toBeFalse();
    });
  });
});
