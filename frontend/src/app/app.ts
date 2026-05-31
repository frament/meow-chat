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
  readonly #sub = new Subscription();

  constructor() {
    if (this.#sw.isEnabled) {
      this.#sw.versionUpdates
        .pipe(filter(evt => evt.type === 'VERSION_READY'))
        .subscribe(() => this.updateAvailable.set(true));

      this.#sub.add(
        fromEvent(window, 'focus').subscribe(() => this.#sw.checkForUpdate())
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
      this.#api.wsMessages$.subscribe((msg) => {
        const isHidden = document.hidden;
        const isCorrectChat = this.#router.url.startsWith(`/chat/${msg.from}`);
        if (isHidden || !isCorrectChat) {
          const n = this.#notif.show(
            `New message from ${msg.from_name || 'Someone'}`,
            {
              body: msg.content || (msg.images?.length ? '[Image]' : ''),
              icon: '/favicon.ico',
              tag: `chat-${msg.from}`,
              data: { url: `/chat/${msg.from}`, senderId: msg.from },
            }
          );
          if (n) {
            n.onclick = () => {
              window.focus();
              this.#router.navigate(['/chat', msg.from]);
              n.close();
            };
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

  applyUpdate() {
    this.#sw.activateUpdate().then(() => document.location.reload());
  }
}
