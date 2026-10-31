import { TestBed } from '@angular/core/testing';
import { ChatMessagesComponent } from './chat-messages.component';
import { ApiService } from '../../services/api.service';
import { ChatPollService } from '../../services/chat-poll.service';

/**
 * Who voted is the poll author's business.
 *
 * The endpoint refuses everyone else (handlers/polls_test.go), and the control
 * that opens the list must not be offered either - a button that always fails is
 * its own kind of lie.
 */
describe('ChatMessagesComponent poll voters', () => {
  function render(fromUserId: number) {
    const api = jasmine.createSpyObj('ApiService', ['getPollVotes']);
    api.getPollVotes.and.returnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { subscribe: ({ next }: any) => next({ options: [] }) } as any,
    );

    TestBed.configureTestingModule({
      imports: [ChatMessagesComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ChatPollService, useValue: { computeTotalVotes: () => 1 } },
      ],
    });

    const fixture = TestBed.createComponent(ChatMessagesComponent);
    const component = fixture.componentInstance;
    component.currentUserId = 1;
    // Items are flat messages with optional _divider/_dateSep markers, not
    // wrapped ones. The first version of this fixture used a wrapper, rendered
    // nothing, and made the "hides it" assertion pass for the wrong reason.
    component.items = [
      {
        id: 10,
        from_user_id: fromUserId,
        to_user_id: fromUserId === 1 ? 2 : 1,
        content: 'Вопрос',
        created_at: '2026-10-31T10:00:00',
        is_read: true,
        msg_type: 'poll',
        poll: {
          id: 5,
          question: 'Кто?',
          is_multiple_choice: false,
          options: [{ id: 1, poll_id: 5, text: 'Я', vote_count: 1, voted: false }],
        },
      },
    ] as any;
    fixture.detectChanges();
    return { fixture, api };
  }

  it('offers "кто голосовал" to the author', () => {
    const { fixture } = render(1);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // Without this the next test could pass because nothing rendered at all.
    expect(text).withContext('the poll must render at all').toContain('Вопрос');
    expect(text).toContain('кто голосовал');
  });

  it('does not offer it to anyone else', () => {
    // The prod report: names of voters were visible to everybody in the chat.
    const { fixture } = render(2);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).withContext('the poll must render at all').toContain('Вопрос');
    expect(text)
      .withContext('a control that can only fail must not be shown')
      .not.toContain('кто голосовал');
  });
});
