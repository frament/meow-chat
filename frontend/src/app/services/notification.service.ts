import { Injectable, signal } from '@angular/core';
import { fromEvent } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private permission = signal<NotificationPermission | null>(null);
  private tabHidden = signal(false);

  constructor() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      this.permission.set('granted');
    }
    if (typeof document !== 'undefined') {
      fromEvent(document, 'visibilitychange').subscribe(() => {
        this.tabHidden.set(document.hidden);
      });
    }
    if (typeof window !== 'undefined') {
      fromEvent(window, 'blur').subscribe(() => this.tabHidden.set(true));
      fromEvent(window, 'focus').subscribe(() => this.tabHidden.set(false));
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') {
      this.permission.set('granted');
      return true;
    }
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    this.permission.set(result);
    return result === 'granted';
  }

  get isTabHidden(): boolean {
    return this.tabHidden();
  }

  show(title: string, options?: NotificationOptions): Notification | null {
    if (this.permission() !== 'granted' && Notification.permission !== 'granted') return null;
    try {
      const n = new Notification(title, options);
      return n;
    } catch {
      return null;
    }
  }
}
