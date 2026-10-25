import { Injectable } from '@angular/core';
import { Message } from './api.service';

/** A message, or one of the two separators the thread renders between them. */
export type DisplayItem =
  | Message
  | { _divider: true }
  | { _dateSep: true; label: string };

/**
 * Turns a stored thread into the list the template renders: a date separator
 * when the day changes, and the "new messages" divider at the unread boundary.
 *
 * Extracted on 2026-10-25. It is a pure function of (messages, divider index,
 * now), which is what makes it worth a service: the day labels depend on the
 * current date, and a getter that reads `new Date()` inside the component can
 * only be tested by freezing the clock.
 */
@Injectable({ providedIn: 'root' })
export class ChatThreadService {
  /**
   * @param messages in chronological order
   * @param unreadDividerIdx index in `messages` before which the divider goes,
   *   or a negative number for "no divider"
   * @param now injected so "Сегодня" and "Вчера" are deterministic in tests
   */
  buildDisplayItems(messages: Message[], unreadDividerIdx: number, now: Date = new Date()): DisplayItem[] {
    const items: DisplayItem[] = [];
    let lastDay = '';

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const day = this.dayKey(m.created_at);

      // One separator per day, not per message: the key is the calendar day in
      // local time, so a chat that runs past midnight gets two.
      if (day !== lastDay) {
        items.push({ _dateSep: true, label: this.dayLabel(m.created_at, now) });
        lastDay = day;
      }

      if (i === unreadDividerIdx) {
        items.push({ _divider: true });
      }

      items.push(m);
    }

    return items;
  }

  /**
   * Merges freshly fetched messages into the open thread.
   *
   * The thread can already hold messages the fetch does not: an optimistic send
   * that has not been confirmed yet, and anything that arrived over the socket
   * while the request was in flight. Replacing the list would drop them, which
   * is why this merges by id instead of assigning.
   *
   * Existing messages keep their object identity so the DOM for an already
   * rendered bubble is not rebuilt; only `is_read` is refreshed, which is the
   * field the read receipt shows.
   *
   * Returns the sorted list and the ids that were new, so the caller can update
   * its own "already seen" index without walking the list again.
   */
  mergeMessages(existing: Message[], incoming: Message[]): { messages: Message[]; addedIds: number[] } {
    const byId = new Map<number, Message>();
    for (const m of existing) byId.set(m.id, m);

    const addedIds: number[] = [];
    for (const msg of incoming) {
      const current = byId.get(msg.id);
      if (current) {
        current.is_read = msg.is_read;
        continue;
      }
      byId.set(msg.id, msg);
      addedIds.push(msg.id);
    }

    const messages = [...byId.values()].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    return { messages, addedIds };
  }

  dayKey(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  dayLabel(iso: string, now: Date = new Date()): string {
    const d = new Date(iso);
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);

    if (diffDays === 0) return 'Сегодня';
    if (diffDays === 1) return 'Вчера';

    const opts: Intl.DateTimeFormatOptions = d.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' };
    return d.toLocaleDateString('ru-RU', opts);
  }
}
