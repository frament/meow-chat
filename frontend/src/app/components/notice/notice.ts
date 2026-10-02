import { Component, inject } from '@angular/core';
import { NoticeService } from '../../services/notice.service';

@Component({
  selector: 'app-notice',
  standalone: true,
  template: `
    @if (notice.message()) {
      <div
        class="notice"
        [class.notice-error]="notice.kind() === 'error'"
        role="status"
        aria-live="polite">
        {{ notice.message() }}
      </div>
    }
  `,
  styles: [`
    .notice {
      position: fixed;
      left: 50%;
      bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%);
      z-index: 1000;
      max-width: calc(100vw - 32px);
      padding: 12px 18px;
      border-radius: 12px;
      background: var(--bg-surface);
      border: 1px solid var(--divider);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      color: var(--text-primary);
      font-size: 14px;
      line-height: 1.4;
      text-align: center;
      pointer-events: none;
      animation: notice-in 0.18s ease-out;
    }
    .notice-error {
      border-color: #e74c3c;
      color: #e74c3c;
    }
    @keyframes notice-in {
      from { opacity: 0; transform: translate(-50%, 8px); }
      to   { opacity: 1; transform: translate(-50%, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .notice { animation: none; }
    }
  `],
})
export class NoticeComponent {
  readonly notice = inject(NoticeService);
}
