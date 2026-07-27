import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StickerPickerComponent } from './sticker-picker';
import { ApiService } from '../../../services/api.service';
import { of, throwError } from 'rxjs';

describe('StickerPickerComponent', () => {
  let component: StickerPickerComponent;
  let fixture: ComponentFixture<StickerPickerComponent>;
  let mockApi: any;
  let emitted: any = null;

  const mockPacks = [
    { id: 1, name: 'Cats', stickers: [{ id: 10, image_url: '/cat1.png' }, { id: 11, image_url: '/cat2.png' }] },
    { id: 2, name: 'Dogs', stickers: [{ id: 20, image_url: '/dog1.png' }] },
  ];

  function createMockApi() {
    return {
      getStickerPacks: jasmine.createSpy().and.returnValue(of(mockPacks)),
    };
  }

  beforeEach(async () => {
    mockApi = createMockApi();
    emitted = null;

    await TestBed.configureTestingModule({
      imports: [StickerPickerComponent],
      providers: [{ provide: ApiService, useValue: mockApi }],
    }).compileComponents();

    fixture = TestBed.createComponent(StickerPickerComponent);
    component = fixture.componentInstance;
    component.stickerSelected.subscribe(s => emitted = s);
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('loads sticker packs on init', () => {
    expect(mockApi.getStickerPacks).toHaveBeenCalled();
    expect(component.packs().length).toBe(2);
  });

  it('selects first pack by default', () => {
    expect(component.selectedPack()).toBe(1);
  });

  it('renders pack tabs', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Cats');
    expect(compiled.textContent).toContain('Dogs');
  });

  it('renders stickers from first pack', () => {
    expect(component.currentStickers.length).toBe(2);
  });

  it('emits selected sticker', () => {
    component.selectSticker({ id: 10, image_url: '/cat1.png' });
    expect(emitted).toEqual({ id: 10, image_url: '/cat1.png' });
  });

  it('emits undefined on close', () => {
    component.close();
    expect(emitted).toBeUndefined();
  });

  it('shows empty state when no packs', () => {
    mockApi.getStickerPacks.and.returnValue(of([]));
    fixture = TestBed.createComponent(StickerPickerComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Нет стикерпаков');
  });

  it('handles load error gracefully', () => {
    mockApi.getStickerPacks.and.returnValue(throwError(() => ({})));
    fixture = TestBed.createComponent(StickerPickerComponent);
    fixture.detectChanges();
    expect(component.loading()).toBeFalse();
  });
});
