import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService, GroupChat, GroupMember, User } from './api.service';

/**
 * The API-facing half of group chats: listing, members, invites, deletion.
 *
 * Extracted on 2026-10-25. What stays in the component is the part that owns
 * state and keys: `selectGroup` (which thread is open), `reloadOpenGroup`, and
 * the E2EE key distribution. Those are decisions; this service is the calls.
 *
 * `friendCandidates` is pure and lives here because it encodes a rule that was
 * easy to get wrong: a candidate list must exclude the current user and everyone
 * already in the group, or the panel offers to add people who are already there.
 */
@Injectable({ providedIn: 'root' })
export class ChatGroupService {
  private readonly api = inject(ApiService);

  list(): Observable<GroupChat[]> {
    return this.api.getGroupChats();
  }

  get(id: number): Observable<{ members: GroupMember[] }> {
    return this.api.getGroupChat(id);
  }

  create(name: string): Observable<{ id: number; name: string }> {
    return this.api.createGroupChat(name);
  }

  addMember(groupId: number, username: string): Observable<unknown> {
    return this.api.addGroupMember(groupId, username);
  }

  createInvite(groupId: number): Observable<{ token: string }> {
    return this.api.createGroupInvite(groupId);
  }

  remove(groupId: number): Observable<unknown> {
    return this.api.deleteGroupChat(groupId);
  }

  friends(): Observable<User[]> {
    return this.api.getFriends();
  }

  /** Friends who are not me and not already in the group. */
  friendCandidates(friends: User[], members: GroupMember[], currentUserId: number): User[] {
    const memberIds = new Set(members.map(m => m.user_id));
    return friends.filter(f => f.id !== currentUserId && !memberIds.has(f.id));
  }
}
