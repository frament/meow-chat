import { Injectable, signal } from '@angular/core';
import { fromEvent } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private permission = signal<NotificationPermission | null>(null);
  private tabHidden = signal(false);
  private audio: HTMLAudioElement | null = null;
  private unlocked = false;

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
      fromEvent(window, 'pointerdown').subscribe(() => this.unlockAudio());
    }
  }

  private unlockAudio(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const src = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(ctx.destination);
      src.start();
      src.stop(ctx.currentTime + 0.01);
    } catch {}
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
      const n = new Notification(title, { ...options, silent: true });
      return n;
    } catch {
      return null;
    }
  }

  private playSound(): void {
    try {
      if (!this.audio) {
        this.audio = new Audio('/notification.mp3');
        this.audio.volume = 0.3;
      }
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
    } catch {}
  }
}
