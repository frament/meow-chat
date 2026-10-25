import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { GroupChat, Poll } from '../../services/api.service';
import { MdPipe } from '../../pipes/md.pipe';
import { ChatPollService } from '../../services/chat-poll.service';

/**
 * The message list: unread divider, date separators, bubbles, polls, images,
 * stickers and the optimistic upload bar.
 *
 * Extracted from ChatComponent on 2026-10-24, and it is the one piece that
 * needed no `mobile` input at all: the desktop and mobile blocks were byte for
 * byte identical except for a single leading space on one line. That is the
 * whole reason this was worth doing first - the two copies could have drifted,
 * and one of them already had.
 *
 * The scroll containers (`#scrollContainerDesktop`, `#threadInnerDesktop` and
 * their mobile twins) deliberately stay in the parent. The sticky-bottom logic
 * is a ResizeObserver on those elements, it is documented in AGENTS.md as
 * load-bearing, and `chat.sticky-scroll.spec.ts` pins it. Moving the elements
 * here would mean moving that logic and rewriting the test for no gain.
 */
@Component({
  selector: 'app-chat-messages',
  standalone: true,
  imports: [DatePipe, MdPipe],
  templateUrl: './chat-messages.component.html',
})
export class ChatMessagesComponent {
  private readonly polls = inject(ChatPollService);

  @Input() items: unknown[] = [];
  @Input() currentUserId = 0;
  @Input() selectedGroup: GroupChat | null = null;
  @Input() uploadProgress = 0;
  @Input() uploading = false;

  @Output() openImageRequested = new EventEmitter<string>();
  @Output() voteRequested = new EventEmitter<{ pollId: number; optionId: number }>();

  // Names match what the moved markup already called.
  openImage(url: string): void {
    this.openImageRequested.emit(url);
  }

  castVote(pollId: number, optionId: number): void {
    this.voteRequested.emit({ pollId, optionId });
  }

  /** True when this bubble belongs to the reader. Used for contrast decisions
   *  inside the bubble, where the incoming palette does not apply. */
  isOutgoing(item: unknown): boolean {
    return (item as { from_user_id?: number })?.from_user_id === this.currentUserId;
  }

  /** Total votes across a poll's options, for the percentage bars. */
  computeTotalVotes(poll: Poll | null | undefined): number {
    return this.polls.computeTotalVotes(poll);
  }
}
