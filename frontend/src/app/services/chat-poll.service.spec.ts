import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ChatPollService } from './chat-poll.service';
import { ApiService, Message, Poll } from './api.service';

describe('ChatPollService', () => {
  let service: ChatPollService;
  let api: { castVote: jasmine.Spy };

  beforeEach(() => {
    api = { castVote: jasmine.createSpy('castVote').and.returnValue(of({ message: 'ok', options: [] })) };
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }],
    });
    service = TestBed.inject(ChatPollService);
  });

  function poll(id: number, counts: number[]): Poll {
    return {
      id,
      options: counts.map((c, i) => ({ id: id * 100 + i, text: 'o' + i, vote_count: c, voted: false })),
    } as unknown as Poll;
  }

  it('sums votes across options', () => {
    expect(service.computeTotalVotes(poll(1, [2, 3, 0]))).toBe(5);
    expect(service.computeTotalVotes(null)).toBe(0);
    expect(service.computeTotalVotes({ options: undefined } as unknown as Poll)).toBe(0);
  });

  it('applies counts to the matching poll and leaves the others alone', () => {
    const first = poll(1, [0, 0]);
    const second = poll(2, [7, 7]);
    // The poll being voted in must NOT be first: with the matching one first, a
    // missing id filter still passes, because the loop returns before reaching
    // the other poll. That is exactly how the first version of this test failed
    // to catch the mutation.
    const messages = [{ id: 11, poll: second }, { id: 10, poll: first }] as unknown as Message[];

    service.applyPollData(messages, 1, [
      { id: 100, text: 'o0', vote_count: 4, voted: true } as never,
      { id: 101, text: 'o1', vote_count: 1, voted: false } as never,
    ]);

    expect(first.options[0].vote_count).toBe(4);
    expect(first.options[0].voted).toBeTrue();
    expect(first.options[1].vote_count).toBe(1);
    // A vote in one poll must not rewrite another poll in the same thread.
    expect(second.options[0].vote_count).toBe(7);
  });

  it('ignores option ids that are not in the poll', () => {
    const p = poll(1, [1]);
    const messages = [{ id: 10, poll: p }] as unknown as Message[];

    service.applyPollData(messages, 1, [{ id: 99999, text: 'x', vote_count: 5, voted: true } as never]);

    expect(p.options[0].vote_count).toBe(1);
  });

  it('does nothing when the poll is not in the open thread', () => {
    const messages = [{ id: 10, poll: poll(1, [1]) }] as unknown as Message[];
    expect(() => service.applyPollData(messages, 42, [])).not.toThrow();
  });

  it('delegates the vote to the API', () => {
    service.castVote(5, 6).subscribe();
    expect(api.castVote).toHaveBeenCalledWith(5, 6);
  });
});
