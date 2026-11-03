import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ServerCryptoService } from '../../services/server-crypto.service';
import { DiagnosticsService } from '../../services/diagnostics.service';
import { ChatStorageService } from '../../services/chat-storage.service';

interface Probe {
  ok: boolean;
  ms: number;
  detail: string;
}

/**
 * The panel that answers "почему не работает" from the phone itself.
 *
 * Every complaint this project had about the network arrived without a console:
 * no access to the server, no idea which layer failed. The sections follow the
 * questions that were actually asked - is the path alive, is the socket up, are
 * frames duplicating, is the thread stuck above a picture, are the keys here.
 *
 * It is loaded on demand (`@defer` in the app shell), so it costs the first
 * download nothing.
 */
@Component({
  selector: 'app-diagnostics',
  standalone: true,
  template: `
    <div class="diag-backdrop" (click)="close()"></div>
    <div class="diag-panel" role="dialog" aria-label="Диагностика">
      <div class="diag-head">
        <h2>Диагностика</h2>
        <button class="diag-close" (click)="close()" aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="diag-body">
        <!-- Сеть -->
        <section>
          <h3>Сеть</h3>
          <dl>
            <dt>Адрес</dt><dd>{{ selfUrl }}</dd>
            <dt>Приложение считает себя</dt><dd>{{ online() ? 'онлайн' : 'офлайн' }}</dd>
            <dt>Тип связи</dt><dd>{{ connectionType() }}</dd>
            <dt>Проверка /api/health</dt>
            <dd>
              @if (health(); as probe) {
                <span [style.color]="probe.ok ? 'var(--success)' : 'var(--danger)'">
                  {{ probe.ok ? 'ok' : 'ошибка' }} · {{ probe.ms }} мс · {{ probe.detail }}
                </span>
              } @else {
                <span class="muted">не проверялось</span>
              }
            </dd>
            <dt>WebSocket</dt>
            <dd>
              {{ wsStateName() }} ·
              @if (api.wsLastFrameAt() > 0) {
                последний кадр {{ secondsSinceFrame() }} с назад
              } @else {
                кадров не было
              }
              · попыток переподключения {{ api.wsReconnectAttempts() }}
            </dd>
          </dl>
        </section>

        <!-- Сервер -->
        <section>
          <h3>Сервер</h3>
          <dl>
            <dt>Кадров получено</dt><dd>{{ api.wsFramesReceived() }}</dd>
            <dt>С повторяющимся id</dt>
            <dd [style.color]="api.wsDuplicateFrames() > 0 ? 'var(--danger)' : 'inherit'">
              {{ api.wsDuplicateFrames() }}
              @if (api.wsDuplicateFrames() > 0) { <span> — дубли, о которых жаловались</span> }
            </dd>
            <dt>/api/ws-health</dt>
            <dd>
              @if (serverHealth(); as health) {
                {{ health }}
              } @else {
                <span class="muted">не проверялось</span>
              }
            </dd>
          </dl>
        </section>

        <!-- Тред -->
        <section>
          <h3>Прокрутка</h3>
          <dl>
            <dt>Контейнер</dt><dd>{{ scroll().container }}</dd>
            <dt>Позиция</dt><dd>{{ scroll().detail }}</dd>
            <dt>Картинки не загрузились</dt><dd>{{ scroll().imagesPending }}</dd>
          </dl>
        </section>

        <!-- Криптография -->
        <section>
          <h3>Криптография</h3>
          <dl>
            <dt>Ключ сервера прибит</dt><dd>{{ serverCrypto.isEnabled() ? 'да' : 'нет' }}</dd>
            <dt>Ключ аккаунта на устройстве</dt><dd>{{ serverCrypto.hasAccountKey() ? 'есть' : 'нет' }}</dd>
            <dt>Старый ключ E2EE</dt><dd>{{ identityKey() ? 'есть' : 'нет' }}</dd>
            <dt>Нужно восстановление</dt><dd>{{ crypto.needsRecovery() ? 'да' : 'нет' }}</dd>
            <dt>Последняя расшифровка</dt>
            <dd>
              @if (diagnostics.lastDecrypt(); as last) {
                <span [style.color]="last.ok ? 'inherit' : 'var(--danger)'">
                  {{ last.ok ? 'успешно' : 'не удалась' }} · {{ last.kind }} · {{ time(last.at) }}
                </span>
              } @else {
                <span class="muted">не было</span>
              }
            </dd>
          </dl>
        </section>

        <!-- Кнопки -->
        <section>
          <h3>Действия</h3>
          <div class="diag-actions">
            <button class="btn-secondary" (click)="checkHealth()">Проверить /api/health</button>
            <button class="btn-secondary" (click)="checkServer()">Спросить сервер</button>
            <button class="btn-secondary" (click)="reconnect()">Переподключить WS</button>
            <button class="btn-secondary" (click)="scrollToBottom()">Прокрутить вниз</button>
            <button class="btn-secondary" (click)="clearCache()">Очистить кэш чата</button>
            <button class="btn-secondary" (click)="sendSelf()" [disabled]="sendingSelf()">
              {{ sendingSelf() ? 'Отправляем…' : 'Тестовое сообщение себе' }}
            </button>
            <button class="btn-secondary" (click)="copyLogs()">
              {{ copied() ? 'Скопировано' : 'Скопировать логи' }}
            </button>
          </div>
          @if (action(); as note) {
            <p class="diag-note">{{ note }}</p>
          }
        </section>

        <!-- Логи -->
        <section>
          <h3>Логи <span class="muted">({{ diagnostics.logs().length }})</span></h3>
          <div class="diag-logs">
            @for (line of logLines(); track line.at + line.text) {
              <div class="diag-line" [style.color]="line.level === 'error' ? 'var(--danger)' : 'inherit'">
                <span class="muted">{{ time(line.at) }}</span> {{ line.text }}
              </div>
            } @empty {
              <p class="muted">Пусто.</p>
            }
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .diag-backdrop {
      position: fixed; inset: 0; z-index: 1000;
      background: rgba(0, 0, 0, .45);
    }
    .diag-panel {
      position: fixed; z-index: 1001;
      inset: 0;
      margin: auto;
      width: min(680px, 100vw);
      max-height: min(86vh, 760px);
      display: flex; flex-direction: column;
      background: var(--bg-body);
      border: 1px solid var(--dividing);
      border-radius: var(--radius);
      overflow: hidden;
    }
    @media (max-width: 640px) {
      .diag-panel { border-radius: 0; max-height: 100vh; height: 100vh; }
    }
    .diag-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid var(--divider);
    }
    .diag-head h2 { font-size: 16px; font-weight: 700; color: var(--text-primary); }
    .diag-close {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 999px;
      color: var(--text-secondary); background: transparent; border: none; cursor: pointer;
    }
    .diag-body { padding: 12px 16px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
    section h3 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text-tertiary); margin-bottom: 6px; }
    dl { display: grid; grid-template-columns: minmax(120px, 40%) 1fr; gap: 4px 12px; font-size: 13px; }
    dt { color: var(--text-secondary); }
    dd { color: var(--text-primary); word-break: break-word; }
    .muted { color: var(--text-tertiary); }
    .diag-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .diag-note { margin-top: 8px; font-size: 13px; color: var(--text-secondary); }
    .diag-logs { max-height: 240px; overflow-y: auto; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; line-height: 1.5; }
    .diag-line { white-space: pre-wrap; word-break: break-word; padding: 1px 0; }
  `],
})
export class DiagnosticsComponent implements OnInit, OnDestroy {
  readonly api = inject(ApiService);
  readonly crypto = inject(CryptoService);
  readonly serverCrypto = inject(ServerCryptoService);
  readonly diagnostics = inject(DiagnosticsService);
  readonly storage = inject(ChatStorageService);

  readonly selfUrl = `${window.location.protocol}//${window.location.host}`;
  readonly health = signal<Probe | null>(null);
  readonly serverHealth = signal<string | null>(null);
  readonly identityKey = signal(false);
  readonly action = signal<string | null>(null);
  readonly copied = signal(false);
  readonly sendingSelf = signal(false);
  readonly now = signal(Date.now());
  readonly scroll = signal({ container: 'нет открытого треда', detail: '—', imagesPending: 0 });

  #timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    // The panel shows "seconds since the last frame", so it needs a clock that
    // ticks faster than the app's one-minute ClockService.
    this.#timer = setInterval(() => {
      this.now.set(Date.now());
      this.measureScroll();
    }, 1000);

    void this.crypto.hasIdentityKey().then((has) => this.identityKey.set(has)).catch(() => {});
    this.measureScroll();
    void this.checkHealth();
  }

  ngOnDestroy(): void {
    if (this.#timer) clearInterval(this.#timer);
  }

  close(): void {
    this.diagnostics.hide();
  }

  online(): boolean {
    return navigator.onLine;
  }

  connectionType(): string {
    const connection = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number; rtt?: number } })
      .connection;
    if (!connection) return 'браузер не сообщает';
    const parts = [connection.effectiveType, connection.downlink ? `${connection.downlink} Мбит/с` : null,
      connection.rtt ? `${connection.rtt} мс` : null].filter(Boolean);
    return parts.join(' · ') || 'нет данных';
  }

  wsStateName(): string {
    const state = this.api.wsReadyState();
    const names: Record<number, string> = {
      [WebSocket.CONNECTING]: 'CONNECTING',
      [WebSocket.OPEN]: 'OPEN',
      [WebSocket.CLOSING]: 'CLOSING',
      [WebSocket.CLOSED]: 'CLOSED',
    };
    return `${this.api.wsConnected() ? 'подключён' : 'не подключён'} (${names[state] ?? state})`;
  }

  /** Wall-clock time of a moment, short enough to sit in a log line. */
  time(at: number): string {
    return new Date(at).toLocaleTimeString();
  }

  secondsSinceFrame(): number {
    const last = this.api.wsLastFrameAt();
    if (!last) return 0;
    return Math.max(0, Math.round((this.now() - last) / 1000));
  }

  logLines(): { at: number; level: string; text: string }[] {
    return [...this.diagnostics.logs()].reverse();
  }

  async checkHealth(): Promise<void> {
    const started = performance.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      // fetch, not HttpClient: this measures the path, not the app's own queue and
      // retry policies. When the question is "does anything reach the server",
      // those policies are part of what is being tested, not a given.
      const response = await fetch(`${this.selfUrl}/api/health`, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);
      const detail = await response.text();
      this.health.set({ ok: response.ok, ms: Math.round(performance.now() - started), detail: detail.slice(0, 120) });
    } catch (error) {
      this.health.set({
        ok: false,
        ms: Math.round(performance.now() - started),
        detail: (error as Error)?.name === 'AbortError' ? 'таймаут 10 с' : 'нет ответа',
      });
    }
  }

  async checkServer(): Promise<void> {
    try {
      const response = await fetch(`${this.selfUrl}/api/ws-health`, { cache: 'no-store' });
      if (!response.ok) {
        this.serverHealth.set(`HTTP ${response.status}`);
        return;
      }
      const data = (await response.json()) as Record<string, number>;
      this.serverHealth.set(
        `соединений ${data['connections']} · отправлено ${data['messages_sent']} · ` +
          `ошибок записи ${data['write_errors']} · закрыто ${data['closed']}`,
      );
    } catch {
      this.serverHealth.set('нет ответа');
    }
  }

  reconnect(): void {
    this.api.retryConnection();
    this.action.set('Переподключение запрошено.');
  }

  scrollToBottom(): void {
    this.diagnostics.requestScrollToBottom();
    this.action.set('Прокрутка запрошена: сработает, если открыт чат.');
  }

  clearCache(): void {
    const removed = this.storage.clearCaches();
    this.action.set(removed ? `Удалено записей кэша: ${removed}.` : 'Кэш чата и так пуст.');
  }

  sendSelf(): void {
    const me = this.api.currentUser();
    if (!me) {
      this.action.set('Нет пользователя: сначала войдите.');
      return;
    }
    this.sendingSelf.set(true);
    this.api.sendMessage(me.id, `Диагностика: проверка ${new Date().toLocaleTimeString()}`, [], 'text').subscribe({
      next: () => {
        this.sendingSelf.set(false);
        this.action.set('Сообщение себе отправлено. Если оно не появилось в чате, смотрите WS выше.');
      },
      error: (error) => {
        this.sendingSelf.set(false);
        this.action.set(`Отправка не удалась: HTTP ${error?.status ?? '—'}.`);
      },
    });
  }

  async copyLogs(): Promise<void> {
    const text = this.logLines()
      .map((line) => `${new Date(line.at).toISOString()} ${line.level} ${line.text}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text || 'логов нет');
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.action.set('Буфер обмена недоступен — логи видны в списке.');
    }
  }

  /**
   * Measures the open thread from the live DOM.
   *
   * Reading it from here rather than from the chat component is deliberate: the
   * question is what the browser actually did with the thread, and the component
   * only knows what it asked for.
   */
  private measureScroll(): void {
    const container = document.querySelector('.chat-scroll') as HTMLElement | null;
    const thread = document.querySelector('.thread-inner') as HTMLElement | null;
    if (!container || !thread) {
      this.scroll.set({ container: 'нет открытого треда', detail: '—', imagesPending: 0 });
      return;
    }
    const fromBottom = Math.round(container.scrollHeight - container.scrollTop - container.clientHeight);
    const images = thread.querySelectorAll('img');
    let pending = 0;
    images.forEach((image) => {
      if (!image.complete || image.naturalWidth === 0) pending++;
    });
    this.scroll.set({
      container: `${container.clientWidth}×${container.clientHeight}, содержимое ${container.scrollHeight}`,
      detail: `scrollTop ${Math.round(container.scrollTop)} · до низа ${fromBottom} px`,
      imagesPending: pending,
    });
  }
}
