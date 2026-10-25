import { TestBed } from '@angular/core/testing';
import { HttpEventType } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { ChatSendService, SendRequest } from './chat-send.service';
import { ApiService } from './api.service';
import { CryptoService } from './crypto.service';
import { SERVER_CRYPTO_STUB_PROVIDER } from '../testing/server-crypto.stub';
import { ServerCryptoService } from './server-crypto.service';

describe('ChatSendService', () => {
  let service: ChatSendService;
  let api: Record<string, jasmine.Spy>;
  let crypto: Record<string, jasmine.Spy>;

  beforeEach(() => {
    api = {
      sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of({ id: 10 })),
      sendGroupMessage: jasmine.createSpy('sendGroupMessage').and.returnValue(of({ id: 11 })),
      sendMessageWithProgress: jasmine.createSpy('sendMessageWithProgress'),
      sendGroupMessageWithProgress: jasmine.createSpy('sendGroupMessageWithProgress'),
    };
    crypto = {
      init: jasmine.createSpy('init').and.resolveTo(),
      encrypt: jasmine.createSpy('encrypt').and.resolveTo({ encrypted: 'CIPHER', iv: 'IV' }),
      encryptGroupMessage: jasmine.createSpy('encryptGroupMessage').and.resolveTo({ encrypted: 'GCIPHER', iv: 'GIV' }),
      getCurrentGroupEpoch: jasmine.createSpy('getCurrentGroupEpoch').and.resolveTo(7),
      buildEnvelopes: jasmine.createSpy('buildEnvelopes').and.resolveTo({ envelopes: [] }),
    };

    TestBed.configureTestingModule({
      providers: [
        SERVER_CRYPTO_STUB_PROVIDER,
        { provide: ApiService, useValue: api },
        { provide: CryptoService, useValue: crypto },
      ],
    });
    service = TestBed.inject(ChatSendService);
  });

  function req(over: Partial<SendRequest> = {}): SendRequest {
    return {
      target: { userId: 2 },
      currentUserId: 1,
      content: 'привет',
      msgType: 'text',
      files: [],
      pollMultiple: false,
      ...over,
    };
  }

  describe('prepare', () => {
    it('does not encrypt structural types and sends the content as is', async () => {
      const res = await service.prepare(req({ msgType: 'sticker', content: '42' }));

      expect(res.ok).toBeTrue();
      if (!res.ok) return;
      expect(res.prepared.wireContent).toBe('42');
      expect(res.prepared.encryptedContent).toBeUndefined();
      expect(crypto['encrypt']).not.toHaveBeenCalled();
    });

    /** The plaintext must not travel next to the ciphertext. */
    it('empties the wire content for an encrypted direct message', async () => {
      const res = await service.prepare(req());

      expect(res.ok).toBeTrue();
      if (!res.ok) return;
      expect(res.prepared.encryptedContent).toBe('CIPHER');
      expect(res.prepared.encryptedIV).toBe('IV');
      expect(res.prepared.wireContent).toBe('');
      expect(res.prepared.envelope).toBeDefined();
    });

    it('truncates the push preview to 120 characters', async () => {
      const long = 'я'.repeat(200);
      const res = await service.prepare(req({ content: long }));

      if (!res.ok) return;
      expect(res.prepared.pushPreview!.length).toBe(123); // 120 + '...'
      expect(res.prepared.pushPreview!.endsWith('...')).toBeTrue();
    });

    it('carries the group epoch and builds no direct envelope', async () => {
      const res = await service.prepare(req({ target: { groupId: 5 } }));

      expect(res.ok).toBeTrue();
      if (!res.ok) return;
      expect(res.prepared.groupEpoch).toBe(7);
      expect(res.prepared.envelope).toBeUndefined();
      expect(crypto['buildEnvelopes']).not.toHaveBeenCalled();
    });

    /** Never fall back to plaintext: a refused send is better than a clear one. */
    it('reports no-peer-key instead of sending in the clear', async () => {
      crypto['encrypt'].and.resolveTo(null);
      const res = await service.prepare(req());

      expect(res.ok).toBeFalse();
      if (res.ok) return;
      expect(res.reason).toBe('no-peer-key');
    });

    it('distinguishes a missing group key', async () => {
      crypto['encryptGroupMessage'].and.resolveTo(null);
      const res = await service.prepare(req({ target: { groupId: 5 } }));

      expect(res.ok).toBeFalse();
      if (res.ok) return;
      expect(res.reason).toBe('no-group-key');
    });
  });

  describe('deliver', () => {
    const prepared = { wireContent: '', encryptedContent: 'C', encryptedIV: 'I', groupEpoch: 0 };

    it('uses the plain call and emits done for a direct message without files', () => {
      const events: unknown[] = [];
      service.deliver(req(), prepared).subscribe(e => events.push(e));

      expect(api['sendMessage']).toHaveBeenCalled();
      expect(events).toEqual([{ type: 'done', body: { id: 10 } as never }]);
    });

    it('uses the group call when the target is a group', () => {
      service.deliver(req({ target: { groupId: 5 } }), prepared).subscribe();

      expect(api['sendGroupMessage']).toHaveBeenCalled();
      expect(api['sendMessage']).not.toHaveBeenCalled();
    });

    it('maps upload progress to a percentage', () => {
      api['sendMessageWithProgress'].and.returnValue(of(
        { type: HttpEventType.UploadProgress, loaded: 50, total: 200 },
        { type: HttpEventType.Response, body: { id: 12 } },
      ));

      const events: Array<{ type: string; percent?: number }> = [];
      service.deliver(req({ files: [new File(['x'], 'a.jpg')] }), prepared).subscribe(e => events.push(e as never));

      expect(events[0]).toEqual({ type: 'progress', percent: 25 });
      expect(events[1].type).toBe('done');
    });

    /** The caller rolls the optimistic bubble back on this error. */
    it('propagates a failed send to the caller', () => {
      api['sendMessage'].and.returnValue(throwError(() => new Error('offline')));

      let err: unknown;
      service.deliver(req(), prepared).subscribe({ error: e => (err = e) });

      expect(err).toBeDefined();
    });
  });

  describe('when the server scheme is enabled', () => {
    function withLayer(sealForServer: () => Promise<any>): ChatSendService {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: ServerCryptoService, useValue: { isEnabled: () => true, sealForServer } },
          { provide: ApiService, useValue: api },
          { provide: CryptoService, useValue: crypto },
        ],
      });
      return TestBed.inject(ChatSendService);
    }

    it('seals for the server and leaves no plaintext on the wire', async () => {
      const seal = jasmine
        .createSpy('sealForServer')
        .and.resolveTo({ kid: 'srv-1', envelope: { v: 1, kid: 'srv-1' } });
      const service = withLayer(seal);

      const result = await service.prepare(req());

      expect(result.ok).toBeTrue();
      if (!result.ok) return;
      expect(result.prepared.wireContent).toBe('');
      expect(result.prepared.encryptedContent).withContext('the old scheme must not run as well').toBeUndefined();
      expect(JSON.parse(result.prepared.serverEnvelope!)).toEqual({ v: 1, kid: 'srv-1' } as any);
      expect(crypto['encrypt']).not.toHaveBeenCalled();
    });

    it('does not seal a captioned image: the server only accepts envelopes for text', async () => {
      // Sealing here would make the request fail outright - the shape is not
      // supported, and pretending otherwise loses the whole message.
      const seal = jasmine.createSpy('sealForServer').and.resolveTo({ kid: 'srv-1', envelope: { v: 1 } });
      const service = withLayer(seal);

      const result = await service.prepare(req({ msgType: 'image', content: 'подпись' }));

      expect(seal).not.toHaveBeenCalled();
      expect(result.ok).toBeTrue();
    });

    it('refuses to send when sealing fails instead of falling back', async () => {
      const service = withLayer(jasmine.createSpy('sealForServer').and.resolveTo(null));

      const result = await service.prepare(req());

      expect(result.ok).toBeFalse();
      if (result.ok) return;
      expect(result.reason).withContext('a failed seal is an error, not a quiet downgrade').toBe('no-server-key');
      expect(crypto['encrypt']).not.toHaveBeenCalled();
    });
  });
});
