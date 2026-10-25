import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CryptoService } from './crypto.service';
import { ApiService } from './api.service';

describe('CryptoService', () => {
  let service: CryptoService;
  let apiMock: jasmine.SpyObj<ApiService>;
  let store: Map<string, any>;

  beforeEach(() => {
    store = new Map();

    apiMock = jasmine.createSpyObj('ApiService', [
      'putKey',
      'getKey',
      'getMyGroupKeyShare',
      'getGroupChat',
      'getUserDeviceKeys',
      'getMyGroupDeviceKeyShare',
      'getAccountKey',
    ]);
    // Default: the account has no key yet, so init() may create one. Individual
    // tests override this to describe a device that lost its copy.
    apiMock.getAccountKey.and.returnValue(throwError(() => ({ status: 404 })));
    apiMock.putKey.and.returnValue(of({ message: 'ok' }));
    apiMock.getKey.and.returnValue(of({ public_key: '' }));
    apiMock.getUserDeviceKeys.and.returnValue(of([]));

    (apiMock as any).currentUser = () => ({ id: 1, username: 'test' });

    spyOn(CryptoService.prototype as any, 'get').and.callFake(
      (key: string) => Promise.resolve(store.get(key) ?? null),
    );
    spyOn(CryptoService.prototype as any, 'set').and.callFake(
      (key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      },
    );

    TestBed.configureTestingModule({
      providers: [
        CryptoService,
        { provide: ApiService, useValue: apiMock },
      ],
    });

    service = TestBed.inject(CryptoService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('hasIdentityKey should return false before init', async () => {
    expect(await service.hasIdentityKey()).toBeFalse();
  });

  it('init should generate an identity key', async () => {
    expect(await service.hasIdentityKey()).toBeFalse();

    await service.init();

    expect(await service.hasIdentityKey()).toBeTrue();
    expect(store.has('identityKeyJWK')).toBeTrue();
    expect(store.has('publicKeySPKI')).toBeTrue();
  });

  it('does not generate a key when the account already has one', async () => {
    // This is the guarantee: a device that lost its copy must not replace the
    // account key, because every message encrypted to the previous one becomes
    // unreadable on every device, in both directions.
    apiMock.getAccountKey.and.returnValue(of({ public_key: 'someone-elses-key' }));

    await service.init();

    expect(await service.hasIdentityKey()).withContext('must not create a key here').toBeFalse();
    expect(store.has('identityKeyJWK')).toBeFalse();
    expect(apiMock.putKey).withContext('must not overwrite the account key').not.toHaveBeenCalled();
    expect(service.needsRecovery()).withContext('the recovery form opens on this').toBeTrue();
  });

  it('does not generate a key when the check itself fails', async () => {
    // Offline or a proxy in the way: "I could not ask" is not "there is no key".
    // Generating on that answer would be the damaging choice.
    apiMock.getAccountKey.and.returnValue(throwError(() => new Error('network down')));

    await service.init();

    expect(await service.hasIdentityKey()).toBeFalse();
    expect(apiMock.putKey).not.toHaveBeenCalled();
  });

  it('creates the first key and uploads it when the account has none', async () => {
    await service.init();

    expect(await service.hasIdentityKey()).toBeTrue();
    expect(apiMock.putKey).toHaveBeenCalledTimes(1);
    expect(service.needsRecovery()).withContext('nothing to recover').toBeFalse();
  });

  it('importIdentityKey clears needsRecovery', async () => {
    apiMock.getAccountKey.and.returnValue(of({ public_key: 'k' }));
    await service.init();
    expect(service.needsRecovery()).toBeTrue();

    const keyPair = (await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    )) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    await service.importIdentityKey(JSON.stringify(jwk));

    expect(service.needsRecovery()).withContext('the form must not come back').toBeFalse();
  });

  it('getPublicKey should return a valid base64 string after init', async () => {
    await service.init();

    const pubKey = await service.getPublicKey();
    expect(pubKey).toBeTruthy();
    expect(typeof pubKey).toBe('string');
    expect(pubKey!.length).toBeGreaterThan(0);

    expect(() => atob(pubKey!)).not.toThrow();
  });

  it('importIdentityKey should import a JWK and store both public and private keys', async () => {
    const keyPair = (await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    )) as CryptoKeyPair;

    const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    await service.importIdentityKey(JSON.stringify(jwk));

    expect(await service.hasIdentityKey()).toBeTrue();
    const pubKey = await service.getPublicKey();
    expect(pubKey).toBeTruthy();
    expect(typeof pubKey).toBe('string');
    expect(pubKey!.length).toBeGreaterThan(0);
  });

  it('should encrypt and decrypt a message roundtrip using ECDH + AES-GCM', async () => {
    const alicePair = (await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    )) as CryptoKeyPair;

    const bobPair = (await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    )) as CryptoKeyPair;

    const aliceJwk = await crypto.subtle.exportKey('jwk', alicePair.privateKey);
    store.set('identityKeyJWK', aliceJwk);

    const aliceSpki = await crypto.subtle.exportKey('spki', alicePair.publicKey);
    store.set(
      'publicKeySPKI',
      btoa(String.fromCharCode(...new Uint8Array(aliceSpki))),
    );

    const bobSpki = await crypto.subtle.exportKey('spki', bobPair.publicKey);
    apiMock.getKey.and.returnValue(
      of({ public_key: btoa(String.fromCharCode(...new Uint8Array(bobSpki))) }),
    );

    await service.init();

    const plaintext = 'Hello, secret world! Тест 123 🎉';
    const result = await service.encrypt(1, 2, plaintext);

    expect(result).not.toBeNull();
    expect(result!.encrypted).toBeTruthy();
    expect(result!.iv).toBeTruthy();

    const decrypted = await service.decrypt(
      1,
      2,
      result!.encrypted,
      result!.iv,
    );
    expect(decrypted).toBe(plaintext);
  });

  it('encrypt should return null when peer key is unavailable', async () => {
    await service.init();

    apiMock.getKey.and.throwError('Not found');
    const result = await service.encrypt(1, 99, 'test');
    expect(result).toBeNull();
  });

  it('wraps and unwraps a content key for a device', async () => {
    await service.init();
    await service.ensureDeviceKeyPair();
    const identityPub = (await service.getPublicKey())!;
    const devicePub = await service.getDevicePublicKeySPKI();
    expect(devicePub).toBeTruthy();

    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const enc = await service.encryptWithRawKey(rawKey, 'envelope secret');

    const wrapped = await service.wrapKeyForDevice(rawKey, devicePub);
    expect(wrapped).not.toBeNull();

    const unwrapped = await service.unwrapKeyFromDevice(wrapped!.wrapped_key, wrapped!.iv, identityPub);
    expect(unwrapped).not.toBeNull();
    expect(Array.from(unwrapped!)).toEqual(Array.from(rawKey));

    const plain = await service.decryptWithRawKey(unwrapped!, enc.encrypted, enc.iv);
    expect(plain).toBe('envelope secret');
  });

  it('builds and reads a DM envelope roundtrip', async () => {
    await service.init();
    await service.ensureDeviceKeyPair();
    const devicePub = await service.getDevicePublicKeySPKI();
    const identityPub = (await service.getPublicKey())!;

    apiMock.getUserDeviceKeys.and.returnValue(of([
      { device_id: service.deviceId, device_public_key: devicePub, device_name: 'self' },
    ]));
    apiMock.getKey.and.returnValue(of({ public_key: identityPub }));

    const payload = await service.buildEnvelopes('hello envelope', 2);
    expect(payload).not.toBeNull();
    expect(payload!.envelopes.length).toBe(1);

    const plain = await service.decryptViaEnvelope(
      payload!.envelopes, payload!.env_content, payload!.env_iv, 1, payload!.sender_device_id,
    );
    expect(plain).toBe('hello envelope');
  });
});
