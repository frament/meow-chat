import { Injectable, inject } from '@angular/core';
import { Message, Poll, PollOption } from './api.service';
import { ApiService } from './api.service';

/**
 * Poll logic that is not tied to a view.
 *
 * Extracted on 2026-10-25. It owns the API call and the pure parts: merging new
 * counts into the open thread, and summing votes for the counters.
 *
 * The message list stays in the component and is passed in. That is on purpose:
 * the component decides which thread is open and which messages belong to it,
 * and a service that owned the array would have to be told about every thread
 * switch, cache load and optimistic send. Passing the array keeps one owner.
 *
 * The merge mutates in place, exactly as the component used to, so the rendered
 * bubbles update without the component having to rebuild the list.
 */
@Injectable({ providedIn: 'root' })
export class ChatPollService {
  private readonly api = inject(ApiService);

  castVote(pollId: number, optionId: number) {
    return this.api.castVote(pollId, optionId);
  }

  /**
   * Applies fresh counts to the poll with this id, wherever it appears in the
   * open thread. Only the matching poll is touched: a thread can hold several,
   * and a vote in one must not rewrite the others.
   */
  applyPollData(messages: Message[], pollId: number, options: PollOption[]): void {
    for (const msg of messages) {
      if (msg.poll?.id !== pollId) continue;
      for (const opt of options) {
        const existing = msg.poll.options.find(o => o.id === opt.id);
        if (existing) {
          existing.vote_count = opt.vote_count;
          existing.voted = opt.voted;
        }
      }
      return;
    }
  }

  computeTotalVotes(poll: Poll | null | undefined): number {
    return poll?.options?.reduce((acc, opt) => acc + (opt.vote_count || 0), 0) || 0;
  }
}
