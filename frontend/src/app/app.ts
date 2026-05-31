import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { SwUpdate, SwPush } from '@angular/service-worker';
import { interval, fromEvent, filter, tap, Subscription } from 'rxjs';
import { ApiService } from './services/api.service';
import { NotificationService } from './services/notification.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    @if (updateAvailable()) {
      <div class="update-banner">
        <span>Доступна новая версия</span>
        <button (click)="applyUpdate()">Обновить</button>
      </div>
    }
    @if (toast(); as t) {
      <div class="toast" (click)="openChat(t.from)">
        <div class="toast-avatar"><span>{{ t.from_name[0] }}</span></div>
        <div class="toast-body">
          <strong>{{ t.from_name }}</strong>
          <span>{{ t.body }}</span>
        </div>
      </div>
    }
    <router-outlet />
  `,
  styles: [`
    .update-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 10px 16px;
      background: #1d4ed8;
      color: #fff;
      font-size: 14px;
    }
    .update-banner button {
      background: #fff;
      color: #1d4ed8;
      border: none;
      border-radius: 6px;
      padding: 4px 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .toast {
      position: fixed;
      top: 16px;
      left: 16px;
      right: 16px;
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      background: var(--bg-surface);
      color: var(--text-primary);
      border: 1px solid var(--border-default);
      border-radius: 14px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15);
      cursor: pointer;
      animation: slideIn 0.3s ease;
      max-width: 400px;
      margin: 0 auto;
    }
    .toast-avatar {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: var(--accent-gradient);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .toast-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }
    .toast-body strong {
      font-size: 13px;
    }
    .toast-body span {
      font-size: 12px;
      opacity: 0.7;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @keyframes slideIn {
      from { transform: translateY(-20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `],
})
export class App implements OnInit, OnDestroy {
  readonly #sw = inject(SwUpdate);
  readonly #swPush = inject(SwPush);
  readonly #api = inject(ApiService);
  readonly #notif = inject(NotificationService);
  readonly #router = inject(Router);
  readonly #theme = inject(ThemeService);
  readonly updateAvailable = signal(false);
  readonly toast = signal<{ from: number; from_name: string; body: string } | null>(null);
  readonly #sub = new Subscription();
  #toastTimer: ReturnType<typeof setTimeout> | null = null;
  #badgeCount = 0;

  constructor() {
    if (this.#sw.isEnabled) {
      this.#sw.versionUpdates
        .pipe(filter(evt => evt.type === 'VERSION_READY'))
        .subscribe(() => this.updateAvailable.set(true));

      this.#sub.add(
        fromEvent(window, 'focus').subscribe(() => {
          this.#sw.checkForUpdate();
          this.#clearBadge();
        })
      );

      this.#sub.add(
        interval(30 * 60 * 1000)
          .pipe(tap(() => this.#sw.checkForUpdate()))
          .subscribe()
      );
    }
  }

  ngOnInit() {
    this.#sub.add(
      this.#router.events.subscribe(() => {
        if (this.#router.url.startsWith('/chat')) this.#clearBadge();
      })
    );

    this.#sub.add(
      this.#api.wsMessages$.subscribe((msg) => {
        const isHidden = document.hidden;
        const isCorrectChat = this.#router.url.startsWith(`/chat/${msg.from}`);
        if (isHidden || !isCorrectChat) {
          const n = this.#notif.show(
            `New message from ${msg.from_name || 'Someone'}`,
            {
              body: msg.content || (msg.images?.length ? '[Image]' : ''),
              icon: '/favicon.png',
              tag: `chat-${msg.from}`,
              data: { url: `/chat/${msg.from}`, senderId: msg.from },
            }
          );
          this.#badgeCount++;
          this.#setBadge(this.#badgeCount);

          if (n) {
            n.onclick = () => {
              this.#clearBadge();
              window.focus();
              this.#router.navigate(['/chat', msg.from]);
              n.close();
            };
          } else if (!document.hidden) {
            if (this.#toastTimer) clearTimeout(this.#toastTimer);
            this.toast.set({
              from: msg.from,
              from_name: msg.from_name || 'Someone',
              body: msg.content || (msg.images?.length ? '[Image]' : ''),
            });
            this.#toastTimer = setTimeout(() => this.toast.set(null), 4000);
          }
        }
      })
    );

    if (!this.#swPush.isEnabled) return;

    this.#api.getVapidPublicKey().subscribe({
      next: (keys) => {
        this.#swPush.requestSubscription({ serverPublicKey: keys.publicKey }).then(sub => {
          this.#api.pushSubscribe(sub.toJSON()).subscribe();
        }).catch(() => {});
      },
    });
  }

  ngOnDestroy() {
    this.#sub.unsubscribe();
  }

  openChat(userId: number) {
    this.#clearBadge();
    this.toast.set(null);
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.#router.navigate(['/chat', userId]);
  }

  async #setBadge(count: number): Promise<void> {
    try {
      if ('setAppBadge' in navigator) {
        await (navigator as any).setAppBadge(count);
      }
    } catch {}
  }

  async #clearBadge(): Promise<void> {
    this.#badgeCount = 0;
    try {
      if ('clearAppBadge' in navigator) {
        await (navigator as any).clearAppBadge();
      }
    } catch {}
  }

  applyUpdate() {
    this.#sw.activateUpdate().then(() => document.location.reload());
  }
}
