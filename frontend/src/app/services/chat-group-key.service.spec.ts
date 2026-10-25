import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ChatGroupKeyService } from './chat-group-key.service';
import { ApiService } from './api.service';
import { CryptoService } from './crypto.service';

describe('ChatGroupKeyService', () => {
  let service: ChatGroupKeyService;
  let api: Record<string, jasmine.Spy>;
  let crypto: Record<string, jasmine.Spy>;

  beforeEach(() => {
    api = {
      getGroupKeyEpoch: jasmine.createSpy('getGroupKeyEpoch').and.returnValue(of({ epoch: 1 })),
      requestGroupKey: jasmine.createSpy('requestGroupKey').and.returnValue(of({})),
      getGroupChat: jasmine.createSpy('getGroupChat').and.returnValue(of({ members: [] })),
      uploadGroupKeyShare: jasmine.createSpy('uploadGroupKeyShare').and.returnValue(of({})),
      getUserDeviceKeys: jasmine.createSpy('getUserDeviceKeys').and.returnValue(of([])),
      uploadGroupDeviceKeyShare: jasmine.createSpy('uploadGroupDeviceKeyShare').and.returnValue(of({})),
    };
    crypto = {
      getCurrentGroupEpoch: jasmine.createSpy('getCurrentGroupEpoch').and.resolveTo(1),
      setCurrentGroupEpoch: jasmine.createSpy('setCurrentGroupEpoch').and.resolveTo(),
      getGroupKey: jasmine.createSpy('getGroupKey').and.resolveTo({}),
      getRawGroupKey: jasmine.createSpy('getRawGroupKey').and.resolveTo(new Uint8Array([1])),
      encryptGroupKeyForPeer: jasmine.createSpy('encryptGroupKeyForPeer').and.resolveTo({ encrypted_key: 'k', iv: 'i' }),
      wrapKeyForDeviceFromDevice: jasmine.createSpy('wrapKeyForDeviceFromDevice').and.resolveTo({ wrapped_key: 'w', iv: 'i' }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: CryptoService, useValue: crypto },
      ],
    });
    service = TestBed.inject(ChatGroupKeyService);
  });

  describe('syncEpoch', () => {
    /** The race: a stale answer must never move the device backwards. */
    it('does not downgrade when the server reports an older epoch', async () => {
      api['getGroupKeyEpoch'].and.returnValue(of({ epoch: 3 }));
      crypto['getCurrentGroupEpoch'].and.resolveTo(5);
      crypto['getGroupKey'].and.resolveTo({});

      const state = await service.syncEpoch(1);

      expect(crypto['setCurrentGroupEpoch']).not.toHaveBeenCalled();
      expect(state.epoch).toBe(5);
      expect(state.hadKey).toBeTrue();
    });

    it('advances only when the key for the new epoch actually arrived', async () => {
      api['getGroupKeyEpoch'].and.returnValue(of({ epoch: 5 }));
      crypto['getCurrentGroupEpoch'].and.resolveTo(3);
      crypto['getGroupKey'].and.resolveTo({});
      await service.syncEpoch(1);
      expect(crypto['setCurrentGroupEpoch']).toHaveBeenCalledWith(1, 5);

      crypto['setCurrentGroupEpoch'].calls.reset();
      crypto['getGroupKey'].and.resolveTo(null);
      await service.syncEpoch(1);
      // Claiming an epoch without its key makes the device think it can read.
      expect(crypto['setCurrentGroupEpoch']).not.toHaveBeenCalled();
    });

    it('keeps the local epoch when the request fails', async () => {
      api['getGroupKeyEpoch'].and.returnValue(throwError(() => new Error('offline')));
      crypto['getCurrentGroupEpoch'].and.resolveTo(4);

      const state = await service.syncEpoch(1);

      expect(state.epoch).toBe(4);
      expect(crypto['setCurrentGroupEpoch']).not.toHaveBeenCalled();
    });
  });

  describe('requestKeyOnce', () => {
    it('asks at most once per group', () => {
      service.requestKeyOnce(7);
      service.requestKeyOnce(7);
      service.requestKeyOnce(7);
      expect(api['requestGroupKey']).toHaveBeenCalledTimes(1);
    });

    /** A failed request must not lock the group out of ever asking again. */
    it('allows a retry after a failed request', () => {
      api['requestGroupKey'].and.returnValue(throwError(() => new Error('offline')));
      service.requestKeyOnce(7);
      service.requestKeyOnce(7);
      expect(api['requestGroupKey']).toHaveBeenCalledTimes(2);
    });

    it('asks again after allowRequest', () => {
      service.requestKeyOnce(7);
      service.allowRequest(7);
      service.requestKeyOnce(7);
      expect(api['requestGroupKey']).toHaveBeenCalledTimes(2);
    });
  });

  describe('distributeToMembers', () => {
    it('shares with other members and with our own other devices', async () => {
      api['getGroupChat'].and.returnValue(of({ members: [{ user_id: 1 }, { user_id: 2 }] }));
      crypto['getCurrentGroupEpoch'].and.resolveTo(2);

      await service.distributeToMembers(9, 1);

      // User-level share only for the other member, not for ourselves.
      expect(api['uploadGroupKeyShare']).toHaveBeenCalledTimes(1);
      expect(api['uploadGroupKeyShare']).toHaveBeenCalledWith(9, 2, 'k', 'i');
      // Device-level shares for both: the other member's devices and our own.
      expect(api['getUserDeviceKeys']).toHaveBeenCalledWith(2);
      expect(api['getUserDeviceKeys']).toHaveBeenCalledWith(1);
    });

    it('does nothing when we have no raw key', async () => {
      api['getGroupChat'].and.returnValue(of({ members: [{ user_id: 2 }] }));
      crypto['getRawGroupKey'].and.resolveTo(null);

      await service.distributeToMembers(9, 1);

      expect(api['uploadGroupKeyShare']).not.toHaveBeenCalled();
    });
  });
});
