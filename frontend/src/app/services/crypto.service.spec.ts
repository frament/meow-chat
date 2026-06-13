import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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
    ]);
    apiMock.putKey.and.returnValue(of({ message: 'ok' }));
    apiMock.getKey.and.returnValue(of({ public_key: '' }));

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
});
