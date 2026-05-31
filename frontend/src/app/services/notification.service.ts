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
    this.playSound();
    try {
      const n = new Notification(title, options);
      return n;
    } catch {
      return null;
    }
  }

  private playSound(): void {
    try {
      const ctx = new AudioContext();
      const g = ctx.createGain();
      g.connect(ctx.destination);
      g.gain.value = 0.15;

      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 660;
      o.connect(g);
      o.start();
      o.stop(ctx.currentTime + 0.15);
    } catch {}
  }
}
