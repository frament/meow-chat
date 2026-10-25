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
   * What the thread shows for a message this device cannot decrypt. Named here
   * because merging has to recognise it: a placeholder must never overwrite real
   * text, and real text must never be lost to a placeholder.
   */
  static readonly UNDECRYPTED = '[Зашифрованное сообщение]';

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
        // A placeholder must never win over real text. Without this a message
        // that was decrypted on another device, or turned back into plaintext on
        // the server, stayed "[Зашифрованное сообщение]" in this device's cache
        // for good - the server's text was merged away by id. The reverse is
        // guarded too: real cached text is not replaced by a placeholder when
        // this device happens to be unable to decrypt right now.
        if (
          current.content === ChatThreadService.UNDECRYPTED &&
          msg.content &&
          msg.content !== ChatThreadService.UNDECRYPTED
        ) {
          current.content = msg.content;
        }
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

  /**
   * True when this message id has not been seen yet. `undefined` means the frame
   * carried no id, and such a frame is always accepted: refusing it would drop a
   * message for the sake of an index that does not exist.
   */
  claim(seen: Set<number>, id: number | undefined): boolean {
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }

  /**
   * Confirms an optimistic message: the server's id replaces the temporary one.
   *
   * The id change is the subtle part. Leaving the temporary id in `seen` and the
   * real one out means the next frame for that message looks unclaimed and
   * arrives as a duplicate of what is already on screen.
   *
   * Returns false when the message is no longer in the thread, so the caller can
   * skip persisting for nothing.
   */
  finalizeOptimistic(
    messages: Message[],
    seen: Set<number>,
    tempId: number,
    server?: { id?: number; images?: string[]; sticker_url?: string },
  ): boolean {
    const msg = messages.find(m => m.id === tempId);
    if (!msg) return false;

    msg.pending = false;

    if (server?.id) {
      seen.delete(msg.id);
      msg.id = server.id;
      seen.add(server.id);
    }
    if (server?.images && server.images.length > 0) {
      msg.images = server.images.map(url => ({ id: 0, image_url: url }));
    }
    // A sticker bubble renders sticker_url, and the optimistic one only held the
    // sticker id in `content`. Without this the author sees an empty bubble.
    if (server?.sticker_url) {
      msg.sticker_url = server.sticker_url;
    }
    return true;
  }

  /** Drops an optimistic message the server rejected. */
  rollbackOptimistic(messages: Message[], seen: Set<number>, tempId: number): boolean {
    const idx = messages.findIndex(m => m.id === tempId);
    if (idx === -1) return false;
    seen.delete(tempId);
    messages.splice(idx, 1);
    return true;
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
