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
  @Input() mobileChatHeight = '';

  /** Two-way: the markup still binds `[(ngModel)]="searchQuery"`. */
  @Input() searchQuery = '';
  @Output() searchQueryChange = new EventEmitter<string>();

  @Output() openChatRequested = new EventEmitter<User>();
  @Output() selectGroupRequested = new EventEmitter<GroupChat>();
  @Output() togglePinRequested = new EventEmitter<{ id: number; event: MouseEvent }>();
  @Output() sendFriendRequestRequested = new EventEmitter<{ id: number; event: MouseEvent }>();
  @Output() acceptFriendRequestRequested = new EventEmitter<{ id: number; event: MouseEvent }>();
  @Output() rejectFriendRequestRequested = new EventEmitter<{ id: number; event: MouseEvent }>();
  @Output() searchInput = new EventEmitter<void>();
  @Output() searchCleared = new EventEmitter<void>();
  @Output() loadGroupInfoRequested = new EventEmitter<void>();
  @Output() createGroupRequested = new EventEmitter<void>();

  // One template, two looks. Each getter returns exactly the string the old
  // branch used, so the merge is provable by diff rather than by guessing at
  // md: utilities. Step B removed the second copy of the markup; these are what
  // remains of the differences.
  get searchInputStyle(): string {
    return this.mobile
      ? 'width:100%;box-sizing:border-box;height:38px;padding-left:34px;font-size:14px;border-radius:12px;'
      : 'width:100%;box-sizing:border-box;height:34px;padding-left:30px;font-size:13px;';
  }

  get searchIconStyle(): string {
    return this.mobile
      ? 'position:absolute;left:10px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--text-tertiary);'
      : 'position:absolute;left:8px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-tertiary);';
  }

  get clearButtonStyle(): string {
    return this.mobile
      ? 'position:absolute;right:8px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:14px;padding:2px;'
      : 'position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:12px;padding:2px;';
  }

  get searchResultsBoxStyle(): string {
    return this.mobile ? '' : 'margin-bottom:8px;';
  }

  get notFoundStyle(): string {
    return this.mobile
      ? 'color:var(--text-tertiary);padding:8px 4px;'
      : 'color:var(--text-tertiary);padding:4px 0;';
  }

  /** A plain row: search results, friend requests. */
  get rowClass(): string {
    return this.mobile
      ? 'card flex items-center gap-3 p-3 rounded-lg'
      : 'flex items-center gap-2 p-2 rounded-lg';
  }

  /** A row that can be clicked: groups and users. */
  get clickableRowClass(): string {
    return this.rowClass + ' cursor-pointer transition-colors';
  }

  get rowGap(): string {
    return this.mobile ? '6px' : '4px';
  }

  get avatarClass(): string {
    return this.mobile ? 'w-10 h-10' : 'w-8 h-8';
  }

  get avatarPlaceholderClass(): string {
    return this.mobile
      ? 'flex items-center justify-center w-10 h-10 rounded-full text-sm font-semibold'
      : 'post-avatar';
  }

  get avatarPlaceholderStyle(): string {
    return this.mobile
      ? 'background:var(--avatar-bg);color:var(--avatar-text);'
      : 'width:32px;height:32px;font-size:13px;';
  }

  get nameClass(): string {
    return this.mobile ? 'flex-1 text-sm font-medium' : 'flex-1 text-sm truncate';
  }

  get sectionGap(): string {
    return this.mobile ? '6px' : '8px';
  }

  get addFriendButtonStyle(): string {
    return this.mobile
      ? 'padding:6px 14px;border-radius:var(--radius-sm);border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-weight:500;'
      : 'padding:4px 10px;border-radius:var(--radius-sm);border:none;background:var(--accent-gradient);color:white;cursor:pointer;font-weight:500;';
  }

  get requestButtonStyle(): string {
    return this.mobile
      ? 'padding:6px 12px;border-radius:var(--radius-sm);border:none;background:#27ae60;color:white;cursor:pointer;font-weight:500;'
      : 'padding:4px 8px;border-radius:var(--radius-sm);border:none;background:#27ae60;color:white;cursor:pointer;font-weight:500;';
  }

  get rejectButtonStyle(): string {
    return this.mobile
      ? 'padding:6px 12px;border-radius:var(--radius-sm);border:1px solid var(--border-default);background:transparent;color:var(--text-tertiary);cursor:pointer;'
      : 'padding:4px 8px;border-radius:var(--radius-sm);border:1px solid var(--border-default);background:transparent;color:var(--text-tertiary);cursor:pointer;';
  }

  get dividerStyle(): string {
    return this.mobile ? '' : 'margin:8px 0;';
  }

  // The markup calls these by name; they forward and do nothing else.
  openChat(user: User): void {
    this.openChatRequested.emit(user);
  }

  selectGroup(group: GroupChat): void {
    this.selectGroupRequested.emit(group);
  }

  togglePin(id: number, event: MouseEvent): void {
    this.togglePinRequested.emit({ id, event });
  }

  sendFriendReq(id: number, event: MouseEvent): void {
    this.sendFriendRequestRequested.emit({ id, event });
  }

  acceptFriendReq(id: number, event: MouseEvent): void {
    this.acceptFriendRequestRequested.emit({ id, event });
  }

  rejectFriendReq(id: number, event: MouseEvent): void {
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
