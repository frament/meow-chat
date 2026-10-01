import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Lets any component (e.g. Settings) trigger the device-linking flow, which is
 * rendered and handled by AppComponent's DeviceAuthComponent.
 */
@Injectable({ providedIn: 'root' })
export class DeviceLinkService {
  private readonly requestSubject = new Subject<void>();
  readonly request$ = this.requestSubject.asObservable();

  start() {
    this.requestSubject.next();
  }
}
