import { Injectable, signal } from '@angular/core';
import { fromEvent } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private permission = signal<NotificationPermission | null>(null);
  private tabHidden = signal(false);
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;

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
      fromEvent(window, 'pointerdown').subscribe(() => this.init());
    }
  }

  private async init(): Promise<void> {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const res = await fetch('/notification.mp3');
      this.buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
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
    if (!this.ctx || !this.buffer) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.3;
      src.connect(gain).connect(this.ctx.destination);
      src.start();
    } catch {}
  }
}
