import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ServerCryptoService, ServerEnvelope } from './server-crypto.service';

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function fingerprintOf(publicKey: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', publicKey);
  return bytesB64(new Uint8Array(digest));
}

async function newKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'X25519' } as any, true, ['deriveBits']) as Promise<CryptoKeyPair>;
}

function makeService(http: any): ServerCryptoService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [ServerCryptoService, { provide: HttpClient, useValue: http }],
  });
  return TestBed.inject(ServerCryptoService);
}

/**
 * Produced by `backend/messagecrypto.Seal`, printed once by a throwaway Go
 * program. Hardcoded on purpose: this is the only check that the TypeScript
 * implementation agrees with the Go one. A round trip inside TS would pass even
 * if both sides were wrong in the same way.
 */
const GO_VECTOR = {
  recipient_pkcs8_hex:
    '302e020100300506032b656e04220420030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc',
  plaintext: 'вектор из Go: если TS это откроет, формат совпал',
  envelope: {
    v: 1,
    kid: 'vector-kid',
    eph: 'orG0QTHtwLECqb3djsWoG83Ytv60fE0cOB24RK0VxzA=',
    salt: 'cqOQ6DrkuS6beVLWIbQgtA==',
    wrap_iv: 'mg8hqSpBO1xzxbDn',
    wrapped_key: 'ixPrS6PIwdfuRvL0L6LzNJdOaRr9F4soYG+xb9Lk55opt9wTd2HS4rmaw4TDMBjg',
    content_iv: '83o/JJ4S1Ajy/41Z',
    ciphertext:
      'i33xe1ima0sJhzUq1aqJCOVVlneC5Hj34p5iCpaLhtTug1vrcMzd8KL1OqfNaE3tdpNulH9dR6GiJLUo3N2JeaQkdND3dolERcB61SbObLmd7FwVMWpookE9xJZhaKs0w+E=',
  } as ServerEnvelope,
};

describe('ServerCryptoService', () => {
  it('opens an envelope produced by the Go implementation', async () => {
    const service = makeService({});
    (service as any).accountPrivate = await crypto.subtle.importKey(
      'pkcs8',
      hexBytes(GO_VECTOR.recipient_pkcs8_hex),
      { name: 'X25519' } as any,
      true,
      ['deriveBits']
    );

    const text = await service.openFromServer(GO_VECTOR.envelope);
    expect(text).withContext('TS must read what Go wrote; otherwise the format diverged').toBe(GO_VECTOR.plaintext);
  });

  it('rejects a tampered envelope instead of returning garbage', async () => {
    const service = makeService({});
    (service as any).accountPrivate = await crypto.subtle.importKey(
      'pkcs8',
      hexBytes(GO_VECTOR.recipient_pkcs8_hex),
      { name: 'X25519' } as any,
      true,
      ['deriveBits']
    );

    const tampered: ServerEnvelope = { ...GO_VECTOR.envelope };
    const raw = atob(tampered.ciphertext);
    tampered.ciphertext = btoa(raw.slice(0, -1) + String.fromCharCode(raw.charCodeAt(raw.length - 1) ^ 0xff));

    expect(await service.openFromServer(tampered)).toBeNull();
  });

  it('seals for the server and opens with the matching private key', async () => {
    const serverKey = await newKeyPair();
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKey.publicKey));
    const fingerprint = await fingerprintOf(publicRaw);

    const service = makeService({
      get: () => of({ kid: 'srv-1', public_key: bytesB64(publicRaw), fingerprint }),
    });
    (service as any).pinned = fingerprint;

    const sealed = await service.sealForServer('текст для сервера');
    expect(sealed).withContext('sealing must succeed with a matching pin').not.toBeNull();
    expect(sealed!.kid).toBe('srv-1');
    expect(sealed!.envelope.v).toBe(1);

    // Opening with the server's own key is the inverse operation, so this checks
    // the whole wrap/unwrap path rather than just its shape.
    (service as any).accountPrivate = serverKey.privateKey;
    expect(await service.openFromServer(sealed!.envelope)).toBe('текст для сервера');
  });

  it('refuses to seal when the pin is not configured', async () => {
    const service = makeService({ get: () => of({ kid: 'x', public_key: '', fingerprint: '' }) });
    (service as any).pinned = '';

    expect(await service.sealForServer('x')).withContext('no pin means no encryption, not plaintext').toBeNull();
  });

  it('refuses to seal when the server key does not match the pin', async () => {
    const serverKey = await newKeyPair();
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKey.publicKey));
    const fingerprint = await fingerprintOf(publicRaw);

    const service = makeService({
      get: () => of({ kid: 'srv-1', public_key: bytesB64(publicRaw), fingerprint }),
    });
    // A different pin: this is a substituted key, and continuing would encrypt to
    // whoever is in the middle.
    (service as any).pinned = await fingerprintOf(new Uint8Array(32).fill(9));

    await expectAsync(service.sealForServer('x')).toBeRejectedWithError('SERVER_KEY_MISMATCH');
  });

  it('does not create a second account key when the server already has one', async () => {
    let posted = false;
    const service = makeService({
      get: () => of({ public_key: bytesB64(new Uint8Array(32).fill(3)), wrapped_private_key: 'Zm9v', kdf_salt: bytesB64(new Uint8Array(16)) }),
      post: () => {
        posted = true;
        return of({});
      },
    });

    // Wrong password for the stored key: the device cannot open it, and must not
    // register a new one - the server refuses that, and trying looks like a bug.
    await service.ensureAccountKey('не тот пароль');

    expect(posted).withContext('a second key must never be registered silently').toBeFalse();
    expect(service.hasAccountKey()).toBeFalse();
  });

  it('opens a thread in place and flags what it cannot open', async () => {
    const service = makeService({});
    (service as any).accountPrivate = await crypto.subtle.importKey(
      'pkcs8',
      hexBytes(GO_VECTOR.recipient_pkcs8_hex),
      { name: 'X25519' } as any,
      true,
      ['deriveBits']
    );

    const broken: ServerEnvelope = { ...GO_VECTOR.envelope, ciphertext: btoa('short') };
    const opened = await service.openMany([
      { id: 1, server_envelope: GO_VECTOR.envelope },
      { id: 2, server_envelope: broken },
      { id: 3, content: 'старое сообщение' },
    ]);

    expect(opened[0].content).toBe(GO_VECTOR.plaintext);
    expect(opened[0].needs_key).withContext('an opened message is not keyless').toBeUndefined();
    expect(opened[0].server_envelope).withContext('the envelope must not survive into the UI').toBeUndefined();

    expect(opened[1].content).toBe('');
    expect(opened[1].needs_key).withContext('unreadable must be visible, not an empty bubble').toBeTrue();

    expect(opened[2].content).withContext('messages of the old scheme pass through untouched').toBe('старое сообщение');
  });


  it('does not keep a local key the account no longer has', async () => {
    // The device holds an old key while the server has a different one - what an
    // admin password reset leaves behind. Keeping the local copy means wrapping
    // to a key the server no longer has.
    //
    // The storage lives in IndexedDB, which made the first version of this test
    // worthless: the write did not survive into the read, the code took the same
    // path with and without the fix, and the mutation went unnoticed. Spying on
    // the two storage methods tests the decision instead of the browser.
    const stale = await newKeyPair();
    const stalePriv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', stale.privateKey));
    const stalePub = new Uint8Array(await crypto.subtle.exportKey('raw', stale.publicKey));

    const serverKey = await newKeyPair();
    const serverPub = new Uint8Array(await crypto.subtle.exportKey('raw', serverKey.publicKey));

    const service = makeService({
      get: () => of({
        public_key: bytesB64(serverPub),
        // Wrapped with a password this test does not know: unopenable, exactly
        // what a reset looks like to a device that still holds the old key.
        wrapped_private_key: btoa('not-a-real-blob'),
        kdf_salt: bytesB64(new Uint8Array(16).fill(1)),
      }),
      post: () => of({}),
    });

    (service as any).readStored = async () => ({ priv: stalePriv, pub: stalePub });
    (service as any).writeStored = jasmine.createSpy('writeStored').and.resolveTo();

    await service.ensureAccountKey('пароль');

    expect(service.getAccountPublicKey())
      .withContext('the stale key must not become the account key')
      .not.toBe(bytesB64(stalePub));
    expect(service.hasAccountKey())
      .withContext('an unopenable account key means no usable key, not the old one')
      .toBeFalse();
  });
});
