import { ServerCryptoService } from '../services/server-crypto.service';

/**
 * Stand-in for the encryption layer in specs that are not about encryption.
 *
 * Provided explicitly rather than letting the real service be created: it needs
 * HttpClient and a pinned key, and a spec that mounts the chat should fail on its
 * own assertion, not with NG0201 about a collaborator it never asked for.
 *
 * `isEnabled` is false so every wired path keeps its old behaviour. A spec that
 * wants the new layer flips it and supplies the rest.
 */
export const SERVER_CRYPTO_STUB_PROVIDER = {
  provide: ServerCryptoService,
  useValue: {
    isEnabled: () => false,
    openMany: async (messages: unknown[]) => messages,
    ensureAccountKey: async () => undefined,
    hasAccountKey: () => false,
    getAccountPublicKey: () => null,
    sealForServer: async () => null,
    openFromServer: async () => null,
    fetchServerKey: async () => null,
  },
};
