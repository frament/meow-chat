import { Injectable, signal } from '@angular/core';

/**
 * Transient app-wide feedback for actions with no other visible result -
 * copying to the clipboard being the original case. Every copy call used to
 * swallow the promise rejection, so the user got no confirmation at all and no
 * signal that anything had failed.
 *
 * Named "notice" rather than "toast" on purpose: app.ts already has a `.toast`
 * for the in-app new-message popup, and two different concepts sharing a name
 * is how copy feedback ends up inconsistent in the first place.
 */
@Injectable({ providedIn: 'root' })
export class NoticeService {
  private static readonly DEFAULT_MS = 2500;

  readonly message = signal('');
  readonly kind = signal<'info' | 'error'>('info');

  private timer: ReturnType<typeof setTimeout> | null = null;

  show(text: string, kind: 'info' | 'error' = 'info', ms = NoticeService.DEFAULT_MS): void {
    this.message.set(text);
    this.kind.set(kind);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.dismiss(), ms);
  }

  dismiss(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.message.set('');
  }

  /**
   * Copies and confirms, or reports the failure instead of hiding it. Returns
   * whether the text actually made it to the clipboard.
   */
  async copy(text: string, label = 'Скопировано'): Promise<boolean> {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      this.show(label);
      return true;
    } catch {
      this.show('Не удалось скопировать', 'error');
      return false;
    }
  }
}
