import { Component, OnInit, output, signal } from '@angular/core';
import { ApiService, StickerPack } from '../../../services/api.service';

@Component({
  selector: 'app-sticker-picker',
  standalone: true,
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      (click)="close()">
      <div class="bg-[var(--bg-body)] rounded-2xl w-[90%] max-w-[420px] max-h-[80vh] overflow-hidden shadow-2xl flex flex-col"
        (click)="$event.stopPropagation()">

        <div class="flex items-center px-4 py-3 border-b shrink-0" style="border-color:var(--border-default);">
          <span class="font-semibold text-sm" style="color:var(--text-primary);">Стикеры</span>
          <button (click)="close()" class="ml-auto w-7 h-7 flex items-center justify-center rounded-full"
            style="border:none;background:var(--bg-tertiary);color:var(--text-secondary);cursor:pointer;font-size:14px;">✕</button>
        </div>

        @if (loading()) {
          <div class="flex justify-center py-8">
            <span class="text-sm" style="color:var(--text-tertiary);">Загрузка...</span>
          </div>
        } @else if (packs().length === 0) {
          <div class="flex justify-center py-8">
            <span class="text-sm" style="color:var(--text-tertiary);">Нет стикерпаков</span>
          </div>
        } @else {
          <div class="flex gap-1 px-4 pt-2 pb-1 overflow-x-auto shrink-0" style="border-bottom:1px solid var(--border-default);">
            @for (pack of packs(); track pack.id; let i = $index) {
              <button (click)="selectedPack.set(pack.id)"
                [style.background]="selectedPack() === pack.id ? 'var(--accent-light)' : 'transparent'"
                [style.color]="selectedPack() === pack.id ? 'var(--accent)' : 'var(--text-secondary)'"
                style="padding:4px 10px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;font-family:inherit;transition:all 0.1s;">
                {{ pack.name }}
              </button>
            }
          </div>

          <div class="overflow-y-auto" style="max-height:50vh;">
            @if (currentStickers().length === 0) {
              <div class="flex justify-center py-8">
                <span class="text-sm" style="color:var(--text-tertiary);">В этом пака нет стикеров</span>
              </div>
            } @else {
              <div class="grid p-3 gap-2" style="grid-template-columns:repeat(3, 1fr);">
                @for (s of currentStickers(); track s.id) {
                  <div class="aspect-square rounded-xl overflow-hidden cursor-pointer bg-cover bg-center hover:scale-105 transition-transform"
                    [style.backgroundImage]="'url(' + s.image_url + ')'"
                    (click)="selectSticker(s)"
                    style="background-size:cover;background-color:var(--bg-tertiary);">
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class StickerPickerComponent implements OnInit {
  packs = signal<StickerPack[]>([]);
  loading = signal(false);
  selectedPack = signal<number>(0);
  stickerSelected = output<{ id: number; image_url: string } | undefined>();

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadPacks();
  }

  private loadPacks() {
    this.loading.set(true);
    this.api.getStickerPacks().subscribe({
      next: (packs) => {
        this.packs.set(packs);
        if (packs.length > 0) {
          this.selectedPack.set(packs[0].id);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  get currentStickers() {
    return this.packs().find(p => p.id === this.selectedPack())?.stickers || [];
  }

  selectSticker(s: { id: number; image_url: string }) {
    this.stickerSelected.emit(s);
  }

  close() {
    this.stickerSelected.emit(undefined);
  }
}
