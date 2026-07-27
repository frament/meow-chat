import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { GifPickerComponent } from './gif-picker';
import { ApiService } from '../../../services/api.service';
import { of, throwError } from 'rxjs';

describe('GifPickerComponent', () => {
  let component: GifPickerComponent;
  let fixture: ComponentFixture<GifPickerComponent>;
  let mockApi: any;
  let emitted: any = null;

  const trendingResults = {
    results: [
      { id: 'g1', preview_url: '/gif1.gif', url: '/gif1.gif', width: 200, height: 200 },
      { id: 'g2', preview_url: '/gif2.gif', url: '/gif2.gif', width: 200, height: 200 },
    ],
  };

  function createMockApi() {
    return {
      getGiphyTrending: jasmine.createSpy().and.returnValue(of(trendingResults)),
      searchGiphy: jasmine.createSpy().and.returnValue(of(trendingResults)),
    };
  }

  beforeEach(async () => {
    mockApi = createMockApi();
    emitted = null;

    await TestBed.configureTestingModule({
      imports: [GifPickerComponent],
      providers: [{ provide: ApiService, useValue: mockApi }],
    }).compileComponents();

    fixture = TestBed.createComponent(GifPickerComponent);
    component = fixture.componentInstance;
    component.gifSelected.subscribe(g => emitted = g);
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('loads trending gifs on init', () => {
    expect(mockApi.getGiphyTrending).toHaveBeenCalled();
    expect(component.results().length).toBe(2);
  });

  it('renders gif grid', () => {
    expect(component.results().length).toBe(2);
  });

  it('emits selected gif', () => {
    component.selectGif({ id: 'g1', preview_url: '/gif1.gif', url: '/gif1.gif', width: 200, height: 200 });
    expect(emitted).toEqual({ id: 'g1', preview_url: '/gif1.gif', url: '/gif1.gif', width: 200, height: 200 });
  });

  it('emits undefined on close', () => {
    component.close();
    expect(emitted).toBeUndefined();
  });

  it('searches gifs on query change', fakeAsync(() => {
    component.onSearchChange('cat');
    tick(400);
    expect(mockApi.searchGiphy).toHaveBeenCalledWith('cat');
  }));

  it('loads trending when search is empty', fakeAsync(() => {
    component.onSearchChange('  ');
    tick(400);
    expect(mockApi.getGiphyTrending).toHaveBeenCalled();
  }));

  it('handles load error gracefully', () => {
    mockApi.getGiphyTrending.and.returnValue(throwError(() => ({})));
    fixture = TestBed.createComponent(GifPickerComponent);
    fixture.detectChanges();
    expect(component.loading()).toBeFalse();
  });
});
