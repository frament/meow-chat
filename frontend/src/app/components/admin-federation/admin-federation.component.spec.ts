import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminFederationComponent } from './admin-federation';
import { ApiService } from '../../services/api.service';
import { of } from 'rxjs';

describe('AdminFederationComponent', () => {
  let component: AdminFederationComponent;
  let fixture: ComponentFixture<AdminFederationComponent>;

  const mockApi = {
    getFederationServers: jasmine.createSpy().and.returnValue(of([
      { id: 1, name: 'Peer1', base_url: 'https://peer1.example.com', status: 'active', cache_bytes: 1024, cache_count: 5, disk_cache_limit: 512 },
    ])),
    pingFederationServer: jasmine.createSpy().and.returnValue(of({ status: 'active', message: 'pong' })),
    blockFederationServer: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    unblockFederationServer: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    clearFederationCache: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    deleteFederationServer: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    createFederationInvite: jasmine.createSpy().and.returnValue(of({ token: 'inv', invite_url: 'https://example.com/invite?token=inv' })),
    connectFederation: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    restoreFederation: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
    updateFederationServer: jasmine.createSpy().and.returnValue(of({ message: 'ok' })),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminFederationComponent],
      providers: [
        { provide: ApiService, useValue: mockApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminFederationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders server list with name and status', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Peer1');
    expect(compiled.textContent).toContain('active');
    expect(compiled.textContent).toContain('1 КБ');
  });

  it('shows connect modal when showConnect is set', () => {
    component.showConnect = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Подключиться к серверу');
    expect(compiled.querySelector('input')).toBeTruthy();
  });
});
