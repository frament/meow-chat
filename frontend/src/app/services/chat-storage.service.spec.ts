import { TestBed } from '@angular/core/testing';
import { ChatStorageService } from './chat-storage.service';
import { Message } from './api.service';

describe('ChatStorageService', () => {
  let service: ChatStorageService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChatStorageService);
  });

  afterEach(() => localStorage.clear());

  /** The key must not depend on who opened the chat, or each side caches alone. */
  it('uses the same message key for both participants', () => {
    expect(service.messageCacheKey(7, 3)).toBe(service.messageCacheKey(3, 7));
    expect(service.messageCacheKey(7, 3)).toBe('cached_messages_3_7');
  });

  it('round-trips messages per conversation', () => {
    const msgs = [{ id: 1, content: 'hello', images: [] }] as unknown as Message[];
    service.writeMessages(1, 2, msgs);

    expect(service.readMessages(1, 2).length).toBe(1);
    // A different conversation is a different key: reading it must not return
    // the first chat's history.
    expect(service.readMessages(1, 3).length).toBe(0);
  });

  /** A pasted image becomes a data URL and can fill the quota on its own. */
  it('strips data URLs before writing', () => {
    const heavy = 'data:image/jpeg;base64,' + 'A'.repeat(100);
    const msgs = [{
      id: 1,
      content: 'pic',
      images: [
        { image_url: heavy },
        { image_url: '/uploads/messages/1.jpg' },
      ],
    }] as unknown as Message[];

    service.writeMessages(1, 2, msgs);

    const stored = service.readMessages(1, 2);
    const first = stored[0] as any;
    expect(first.images.length).toBe(1);
    expect(first.images[0].image_url).toBe('/uploads/messages/1.jpg');
  });

  it('treats a corrupt cache as empty instead of throwing', () => {
    localStorage.setItem(service.messageCacheKey(1, 2), '{not json');
    expect(() => service.readMessages(1, 2)).not.toThrow();
    expect(service.readMessages(1, 2)).toEqual([]);
  });

  it('round-trips users and pinned ids', () => {
    service.writeUsers([{ id: 1, username: 'a' }] as never);
    service.writePinnedIds([4, 5]);

    expect(service.readUsers().length).toBe(1);
    expect(service.readPinnedIds()).toEqual([4, 5]);
  });

  /** Quota failures must not take the conversation down with them. */
  it('survives a failing write', () => {
    spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');
    expect(() => service.writePinnedIds([1])).not.toThrow();
  });
});
