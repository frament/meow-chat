import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ChatGroupService } from './chat-group.service';
import { ApiService, GroupMember, User } from './api.service';

describe('ChatGroupService', () => {
  let service: ChatGroupService;
  let api: Record<string, jasmine.Spy>;

  beforeEach(() => {
    api = {
      getGroupChats: jasmine.createSpy('getGroupChats').and.returnValue(of([])),
      getGroupChat: jasmine.createSpy('getGroupChat').and.returnValue(of({ members: [] })),
      createGroupChat: jasmine.createSpy('createGroupChat').and.returnValue(of({ id: 1, name: 'g' })),
      addGroupMember: jasmine.createSpy('addGroupMember').and.returnValue(of({})),
      createGroupInvite: jasmine.createSpy('createGroupInvite').and.returnValue(of({ token: 't' })),
      deleteGroupChat: jasmine.createSpy('deleteGroupChat').and.returnValue(of({})),
      getFriends: jasmine.createSpy('getFriends').and.returnValue(of([])),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }],
    });
    service = TestBed.inject(ChatGroupService);
  });

  const user = (id: number) => ({ id, username: 'u' + id }) as unknown as User;
  const member = (id: number) => ({ user_id: id }) as unknown as GroupMember;

  /** A candidate list that offers people already in the group, or offers you
   *  yourself, is wrong in a way that looks plausible on screen. */
  it('excludes the current user and existing members from candidates', () => {
    const friends = [user(1), user(2), user(3), user(4)];
    const members = [member(1), member(2)];

    const result = service.friendCandidates(friends, members, 1);

    expect(result.map(f => f.id)).toEqual([3, 4]);
  });

  /** Self must be excluded even when the member list does not contain them yet,
   *  which is what the panel sees before members load. Without this case, a
   *  missing self-filter stays invisible because the member filter hides it. */
  it('excludes the current user even when they are not in the member list', () => {
    const result = service.friendCandidates([user(1), user(2), user(3)], [member(2)], 1);
    expect(result.map(f => f.id)).toEqual([3]);
  });

  it('returns everyone when the group has only me', () => {
    const result = service.friendCandidates([user(1), user(2)], [member(1)], 1);
    expect(result.map(f => f.id)).toEqual([2]);
  });

  it('delegates every call to the API', () => {
    service.list().subscribe();
    service.get(5).subscribe();
    service.create('g').subscribe();
    service.addMember(5, 'bob').subscribe();
    service.createInvite(5).subscribe();
    service.remove(5).subscribe();
    service.friends().subscribe();

    expect(api['getGroupChats']).toHaveBeenCalled();
    expect(api['getGroupChat']).toHaveBeenCalledWith(5);
    expect(api['createGroupChat']).toHaveBeenCalledWith('g');
    expect(api['addGroupMember']).toHaveBeenCalledWith(5, 'bob');
    expect(api['createGroupInvite']).toHaveBeenCalledWith(5);
    expect(api['deleteGroupChat']).toHaveBeenCalledWith(5);
    expect(api['getFriends']).toHaveBeenCalled();
  });
});
