import { Component, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, GiphyResult } from '../../../services/api.service';
import { Subject, Subscription, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

@Component({
  selector: 'app-gif-picker',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      (click)="close()">
      <div class="bg-[var(--bg-body)] rounded-2xl w-[90%] max-w-[480px] max-h-[80vh] overflow-hidden shadow-2xl"
        (click)="$event.stopPropagation()">
        <div class="flex items-center px-4 py-3 border-b" style="border-color:var(--border-default);">
          <span class="font-semibold text-sm" style="color:var(--text-primary);">GIF</span>
          <span class="ml-2 text-[10px] px-2 py-0.5 rounded-full" style="background:var(--bg-tertiary);color:var(--text-secondary);">Giphy</span>
          <button (click)="close()" class="ml-auto w-7 h-7 flex items-center justify-center rounded-full"
            style="border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:14px;">✕</button>
        </div>

        <div class="px-4 py-2">
          <input type="text" [(ngModel)]="searchQuery" (ngModelChange)="onSearchChange($event)"
            placeholder="Поиск GIF..."
            style="width:100%;box-sizing:border-box;padding:8px 12px;border-radius:999px;border:1px solid var(--border-default);background:var(--bg-tertiary);font-size:13px;color:var(--text-primary);outline:none;font-family:inherit;">
        </div>

        <div class="px-4 pb-4 overflow-y-auto" style="max-height:50vh;">
          @if (loading()) {
            <div class="flex justify-center py-8">
              <span class="text-sm" style="color:var(--text-tertiary);">Загрузка...</span>
            </div>
          } @else if (results().length === 0) {
            <div class="flex justify-center py-8">
              <span class="text-sm" style="color:var(--text-tertiary);">
                {{ searchQuery ? 'Ничего не найдено' : 'Введите запрос для поиска GIF' }}
              </span>
            </div>
          } @else {
            <div class="grid gap-2" style="grid-template-columns:1fr 1fr 1fr;">
              @for (gif of results(); track gif.id) {
                <div class="aspect-square rounded-lg overflow-hidden cursor-pointer bg-cover bg-center"
                  [style.backgroundImage]="'url(' + gif.preview_url + ')'"
                  (click)="selectGif(gif)"
                  style="background-size:cover;">
                </div>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class GifPickerComponent {
  searchQuery = '';
  results = signal<GiphyResult[]>([]);
  loading = signal(false);
  gifSelected = output<GiphyResult | undefined>();

  private searchSubject = new Subject<string>();
  private searchSub?: Subscription;

  constructor(private api: ApiService) {
    this.searchSub = this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((q) => {
        if (!q.trim()) {
          return this.api.getGiphyTrending();
        }
        return this.api.searchGiphy(q);
      }),
    ).subscribe({
      next: (res) => {
        this.results.set(res.results);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });

    this.loading.set(true);
    this.api.getGiphyTrending().subscribe({
      next: (res) => {
        this.results.set(res.results);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onSearchChange(q: string) {
    this.loading.set(true);
    this.searchSubject.next(q);
  }

  selectGif(gif: GiphyResult) {
    this.gifSelected.emit(gif);
  }

  close() {
    this.searchSub?.unsubscribe();
    this.gifSelected.emit(undefined);
  }
}
