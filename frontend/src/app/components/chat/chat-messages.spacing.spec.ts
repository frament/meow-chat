import { TestBed } from '@angular/core/testing';
import { ChatMessagesComponent } from './chat-messages.component';
import { ApiService } from '../../services/api.service';
import { ChatPollService } from '../../services/chat-poll.service';

/**
 * Messages need air between them.
 *
 * The spacing used to come from the parent's `gap`, which stopped applying the
 * moment the list became a component: the messages are children of its host now,
 * and an inline host stacks them with no gap at all. Reported on prod as
 * "между сообщениями в чате нет вертикального отступа".
 */
describe('ChatMessagesComponent spacing', () => {
  it('lays messages out as a column with a gap', () => {
    TestBed.configureTestingModule({
      imports: [ChatMessagesComponent],
      providers: [
        { provide: ApiService, useValue: {} },
        { provide: ChatPollService, useValue: { computeTotalVotes: () => 0 } },
      ],
    });

    const fixture = TestBed.createComponent(ChatMessagesComponent);
    fixture.componentInstance.items = [
      { id: 1, from_user_id: 2, content: 'раз', created_at: '2026-10-31T10:00:00', is_read: true },
      { id: 2, from_user_id: 2, content: 'два', created_at: '2026-10-31T10:00:01', is_read: true },
    ] as any;
    fixture.detectChanges();

    const style = getComputedStyle(fixture.nativeElement as HTMLElement);
    expect(style.display).withContext('an inline host stacks children flush').toBe('flex');
    expect(style.flexDirection).toBe('column');
    expect(style.gap).toBe('8px');
  });
});
