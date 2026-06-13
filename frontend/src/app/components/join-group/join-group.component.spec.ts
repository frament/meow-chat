import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JoinGroupComponent } from './join-group';
import { ApiService } from '../../services/api.service';
import { CryptoService } from '../../services/crypto.service';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

describe('JoinGroupComponent', () => {
  let component: JoinGroupComponent;
  let fixture: ComponentFixture<JoinGroupComponent>;

  const mockApi = {
    currentUser: signal({ id: 1, username: 'test', email: 't@t.com', avatar_url: '' }),
    getGroupInvite: jasmine.createSpy().and.returnValue(of({ group_chat_id: 5, group_name: 'My Group', token: 'token' })),
    joinGroupViaInvite: jasmine.createSpy().and.returnValue(of({ message: 'ok', group_chat_id: 5, group_name: 'My Group' })),
  };

  const mockCrypto = {
    init: jasmine.createSpy().and.returnValue(Promise.resolve()),
    getGroupKey: jasmine.createSpy().and.returnValue(Promise.resolve()),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JoinGroupComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), navigateByUrl: jasmine.createSpy(), createUrlTree: jasmine.createSpy(), serializeUrl: jasmine.createSpy(), events: of(null) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: { token: 'invite123' } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(JoinGroupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders group name and join button for valid token', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(component.loading).toBeFalse();
    expect(component.groupName).toBe('My Group');
    expect(compiled.textContent).toContain('Приглашение в группу');
    expect(compiled.textContent).toContain('My Group');
    expect(compiled.textContent).toContain('Присоединиться');
  });
});
