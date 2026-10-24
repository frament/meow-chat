import { Injectable } from '@angular/core';
import { Message, User } from './api.service';

/**
 * Everything ChatComponent keeps in localStorage.
 *
 * Extracted on 2026-10-25 as the first service of the round-3 refactor. It is
 * the least entangled piece: pure functions over strings and arrays, no DOM, no
 * signals, no knowledge of which chat is open. That is exactly why it goes
 * first - the component keeps the decisions, the service keeps the keys.
 *
 * Two behaviours here are load-bearing and were easy to get wrong:
 *
 * - The message cache key sorts the two user ids, so both participants write to
 *   and read from the same entry. Keying by "me and them" would give each side
 *   its own cache and neither would ever hit.
 * - Data URLs are stripped before writing. Pasted images become data URLs, and
 *   one of them can fill the localStorage quota on its own; the cache then
 *   fails for every message in that chat, not just the heavy one.
 *
 * Reads never throw: a corrupt or truncated value returns empty rather than
 * breaking the chat. localStorage is a cache, not a source of truth.
 */
@Injectable({ providedIn: 'root' })
export class ChatStorageService {
  private static readonly USERS_KEY = 'cachedUsers';
  private static readonly PINS_KEY = 'cachedPins';

  /** Stable key for a conversation, independent of who asks. */
  messageCacheKey(currentUserId: number, otherUserId: number): string {
    const ids = [currentUserId, otherUserId].sort((a, b) => a - b);
    return `cached_messages_${ids[0]}_${ids[1]}`;
  }

  readMessages(currentUserId: number, otherUserId: number): Message[] {
    return this.readJson<Message[]>(this.messageCacheKey(currentUserId, otherUserId)) ?? [];
  }

  writeMessages(currentUserId: number, otherUserId: number, messages: Message[]): void {
    const clean = messages.map(m => ({
      ...m,
      images: (m.images || []).filter(i => !i.image_url.startsWith('data:')),
    }));
    this.writeJson(this.messageCacheKey(currentUserId, otherUserId), clean);
  }

  readUsers(): User[] {
    return this.readJson<User[]>(ChatStorageService.USERS_KEY) ?? [];
  }

  writeUsers(users: User[]): void {
    this.writeJson(ChatStorageService.USERS_KEY, users);
  }

  readPinnedIds(): number[] {
    return this.readJson<number[]>(ChatStorageService.PINS_KEY) ?? [];
  }

  writePinnedIds(ids: number[]): void {
    this.writeJson(ChatStorageService.PINS_KEY, ids);
  }

  private readJson<T>(key: string): T | null {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A half-written value from a previous crash, or a format we no longer
      // understand. Treat it as "no cache" rather than breaking the thread.
      return null;
    }
  }

  private writeJson(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded. The cache is an optimisation; losing it must not take
      // the conversation with it.
    }
  }
}
