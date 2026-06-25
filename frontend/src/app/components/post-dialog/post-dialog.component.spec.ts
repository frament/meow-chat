import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PostDialogComponent } from './post-dialog';
import { ApiService } from '../../services/api.service';
import { signal, computed } from '@angular/core';
import { of, throwError } from 'rxjs';

describe('PostDialogComponent', () => {
  let component: PostDialogComponent;
  let fixture: ComponentFixture<PostDialogComponent>;

  const mockApi = {
    currentUser: signal({ id: 1, username: 'test', avatar_url: '' }),
    getFeed: jasmine.createSpy().and.returnValue(of([])),
    createPost: jasmine.createSpy().and.returnValue(of({ id: 1, message: 'ok' })),
    createPostWithProgress: jasmine.createSpy().and.returnValue(of({})),
    createPostError: jasmine.createSpy(),  // for error simulation
    wsMessages$: of(null),
    totalUnread: computed(() => 0),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PostDialogComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PostDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('is hidden by default', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="dialog-overlay"]')).toBeFalsy();
  });

  it('shows dialog after open()', () => {
    component.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="dialog-overlay"]')).toBeTruthy();
  });

  it('renders textarea in dialog', () => {
    component.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const textarea = compiled.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea?.getAttribute('placeholder')).toContain('нового');
  });

  it('renders public toggle checkbox', () => {
    component.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const checkbox = compiled.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
  });

  it('renders submit button', () => {
    component.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const buttons = compiled.querySelectorAll('button');
    const btn = Array.prototype.find.call(buttons, (b: Element) => b.textContent?.includes('Опубликовать'));
    expect(btn).toBeTruthy();
  });

  it('renders photo picker button', () => {
    component.open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const pickers = compiled.querySelectorAll('button, label');
    const btn = Array.prototype.find.call(pickers, (b: Element) => b.textContent?.includes('Фото'));
    expect(btn).toBeTruthy();
  });

  it('closes on backdrop click', () => {
    component.open();
    fixture.detectChanges();
    const overlay = fixture.nativeElement.querySelector('[data-testid="dialog-overlay"]') as HTMLElement;
    overlay.click();
    fixture.detectChanges();
    expect(component.showDialog()).toBeFalse();
  });

  it('closes on Escape key', () => {
    component.open();
    fixture.detectChanges();
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    document.dispatchEvent(event);
    fixture.detectChanges();
    expect(component.showDialog()).toBeFalse();
  });

  it('closes on close button click', () => {
    component.open();
    fixture.detectChanges();
    const closeBtn = fixture.nativeElement.querySelector('[data-testid="dialog-close"]') as HTMLElement;
    closeBtn.click();
    fixture.detectChanges();
    expect(component.showDialog()).toBeFalse();
  });

  it('calls createPost on submit and emits postCreated', () => {
    const spy = jasmine.createSpy('postCreated');
    component.postCreated.subscribe(spy);
    component.newPostContent = 'Hello world';
    component.open();
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button');
    const btn = Array.prototype.find.call(buttons, (b: Element) => b.textContent?.includes('Опубликовать')) as HTMLElement | undefined;
    btn!.click();
    fixture.detectChanges();
    expect(mockApi.createPost).toHaveBeenCalledWith('Hello world', [], false);
    expect(spy).toHaveBeenCalled();
  });

  it('disables submit when content empty and no files', () => {
    component.open();
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button');
    const btn = Array.prototype.find.call(buttons, (b: Element) => b.textContent?.includes('Опубликовать')) as HTMLButtonElement | undefined;
    expect(btn?.disabled).toBeTrue();
  });

  it('shows centered modal on desktop (hidden sm:block)', () => {
    component.open();
    fixture.detectChanges();
    const modal = fixture.nativeElement.querySelector('[data-testid="dialog-modal"]');
    expect(modal).toBeTruthy();
    expect(modal.classList.contains('hidden')).toBeTrue();
    expect(modal.classList.contains('sm:block')).toBeTrue();
  });

  it('shows bottom sheet on mobile (sm:hidden)', () => {
    component.open();
    fixture.detectChanges();
    const sheet = fixture.nativeElement.querySelector('[data-testid="dialog-sheet"]');
    expect(sheet).toBeTruthy();
    expect(sheet.classList.contains('sm:hidden')).toBeTrue();
  });

  it('resets form after successful post creation (text only)', () => {
    component.newPostContent = 'Hello world';
    component.isPublic = true;
    component.open();
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button');
    const btn = Array.prototype.find.call(buttons, (b: Element) => b.textContent?.includes('Опубликовать')) as HTMLElement | undefined;
    btn!.click();
    fixture.detectChanges();
    expect(component.newPostContent).toBe('');
    expect(component.isPublic).toBeFalse();
  });

  it('shows upload progress bar when uploading', () => {
    component.uploading.set(true);
    component.uploadProgress.set(55);
    component.open();
    fixture.detectChanges();
    const container = fixture.nativeElement.querySelector('[data-testid="dialog-overlay"]');
    expect(container).toBeTruthy();
    // Progress bar renders as a div with inline style containing width percentage
    const allDivs = container!.querySelectorAll('div');
    const foundProgress = Array.prototype.find.call(allDivs, (d: Element) =>
      d.hasAttribute('style') && d.getAttribute('style')!.includes('width:'))
    expect(foundProgress).toBeTruthy();
  });

  it('calls createPostWithProgress when files are selected', () => {
    component.newPostContent = 'Hello';
    component.selectedFiles = [new File([''], 'photo.jpg')];
    component.open();
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button');
    const btn = Array.prototype.find.call(buttons, (b: Element) => b.textContent?.includes('Опубликовать')) as HTMLElement | undefined;
    btn!.click();
    fixture.detectChanges();
    expect(mockApi.createPostWithProgress).toHaveBeenCalled();
  });

  it('stays open on API error', () => {
    mockApi.createPost.and.returnValue(throwError(() => new Error('API error')));
    component.newPostContent = 'Will fail';
    component.open();
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button');
    const btn = Array.prototype.find.call(buttons, (b: Element) => b.textContent?.includes('Опубликовать')) as HTMLElement | undefined;
    btn!.click();
    fixture.detectChanges();
    // Dialog should remain open after error
    expect(component.showDialog()).toBeTrue();
    // Reset createPost mock back to success
    mockApi.createPost.and.returnValue(of({ id: 1, message: 'ok' }));
  });
});
