import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GroupChat, User } from '../../services/api.service';
import { LastSeenPipe } from '../../pipes/last-seen.pipe';
import { ClockService } from '../../services/clock.service';
import { ApiService } from '../../services/api.service';

/**
 * The chat list: search, incoming friend requests, groups, pinned users, everyone
 * else.
 *
 * Extracted from ChatComponent on 2026-10-12 as step A of the round-3 refactor,
 * and deliberately without touching the markup: the desktop and mobile variants
 * both moved here verbatim and are chosen by `mobile`. Appearance therefore did
 * not change, and the existing specs are the proof.
 *
 * Step B is to collapse the two variants into one. That is visual work and has
 * to be checked on a phone and on a desktop after each change; it is not done
 * here.
 *
 * The method names match what the markup already called (`openChat(user)`,
 * `togglePin(id, event)`, ...) so the moved template did not have to be
 * rewritten. Each one forwards to an output: the component renders the list, the
 * parent owns what selecting and pinning mean.
 */
@Component({
  selector: 'app-chat-list',
  standalone: true,
  imports: [FormsModule, LastSeenPipe],
  templateUrl: './chat-list.component.html',
})
export class ChatListComponent {
  readonly api = inject(ApiService);
  readonly clock = inject(ClockService);

  /** Which of the two variants to render. Step B removes this input. */
  @Input() mobile = false;

  @Input() pinnedUsers: User[] = [];
  @Input() unpinnedUsers: User[] = [];
  @Input() groupChats: GroupChat[] = [];
  @Input() selectedUser: User | null = null;
  @Input() selectedGroup: GroupChat | null = null;
  @Input() incomingRequests: any[] = [];
  @Input() sendingFriendReq: number | null = null;
  @Input() searchResults: User[] | null = null;
  @Input() mobileChatHeight = 0;

  /** Two-way: the markup still binds `[(ngModel)]="searchQuery"`. */
  @Input() searchQuery = '';
  @Output() searchQueryChange = new EventEmitter<string>();

  @Output() openChatRequested = new EventEmitter<User>();
  @Output() selectGroupRequested = new EventEmitter<GroupChat>();
  @Output() togglePinRequested = new EventEmitter<{ id: number; event: Event }>();
  @Output() sendFriendRequestRequested = new EventEmitter<{ id: number; event: Event }>();
  @Output() acceptFriendRequestRequested = new EventEmitter<{ id: number; event: Event }>();
  @Output() rejectFriendRequestRequested = new EventEmitter<{ id: number; event: Event }>();
  @Output() searchInput = new EventEmitter<void>();
  @Output() searchCleared = new EventEmitter<void>();
  @Output() loadGroupInfoRequested = new EventEmitter<void>();
  @Output() createGroupRequested = new EventEmitter<void>();

  // The markup calls these by name; they forward and do nothing else.
  openChat(user: User): void {
    this.openChatRequested.emit(user);
  }

  selectGroup(group: GroupChat): void {
    this.selectGroupRequested.emit(group);
  }

  togglePin(id: number, event: Event): void {
    this.togglePinRequested.emit({ id, event });
  }

  sendFriendReq(id: number, event: Event): void {
    this.sendFriendRequestRequested.emit({ id, event });
  }

  acceptFriendReq(id: number, event: Event): void {
    this.acceptFriendRequestRequested.emit({ id, event });
  }

  rejectFriendReq(id: number, event: Event): void {
    this.rejectFriendRequestRequested.emit({ id, event });
  }

  onSearchInput(): void {
    this.searchInput.emit();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchQueryChange.emit(this.searchQuery);
    this.searchCleared.emit();
  }

  loadGroupInfo(): void {
    this.loadGroupInfoRequested.emit();
  }

  openCreateGroup(): void {
    this.createGroupRequested.emit();
  }
}
