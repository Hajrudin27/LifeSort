/**
 * Testopsætning.
 *
 * AsyncStorage er et native-modul og findes ikke under Jest. Pakkens egen mock
 * bruges, så en test kan importere en store — og dermed også en feature, der
 * læser sin egen store — uden en enhed.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockSecureStore = new Map();

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
  getItemAsync: jest.fn((key) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn((key, value) => {
    mockSecureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  }),
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('expo-crypto', () => {
  const {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
    randomUUID,
  } = require('crypto');

  const digestAlgorithms = {
    'SHA-1': 'sha1',
    'SHA-256': 'sha256',
    'SHA-384': 'sha384',
    'SHA-512': 'sha512',
    MD5: 'md5',
  };

  class AESEncryptionKey {
    constructor(keyBytes) {
      this.mockKey = keyBytes;
    }

    static generate() {
      return Promise.resolve(new AESEncryptionKey(randomBytes(32)));
    }

    static import(value, encoding = 'base64') {
      return Promise.resolve(new AESEncryptionKey(Buffer.from(value, encoding)));
    }

    encoded(encoding = 'base64') {
      return Promise.resolve(this.mockKey.toString(encoding));
    }

    bytes() {
      return Promise.resolve(new Uint8Array(this.mockKey));
    }
  }

  class AESSealedData {
    constructor(combinedBytes, ivLength, tagLength) {
      this.mockCombinedBytes = combinedBytes;
      this.ivLength = ivLength;
      this.tagLength = tagLength;
    }

    static fromCombined(value, config = { ivLength: 12, tagLength: 16 }) {
      return new AESSealedData(Buffer.from(value, 'base64'), config.ivLength, config.tagLength);
    }

    combined(encoding = 'bytes') {
      if (encoding === 'base64') return Promise.resolve(this.mockCombinedBytes.toString('base64'));
      return Promise.resolve(new Uint8Array(this.mockCombinedBytes));
    }

    bytes() {
      return this.mockCombinedBytes;
    }
  }

  return {
    CryptoDigestAlgorithm: {
      SHA1: 'SHA-1',
      SHA256: 'SHA-256',
      SHA384: 'SHA-384',
      SHA512: 'SHA-512',
      MD5: 'MD5',
    },
    CryptoEncoding: {
      HEX: 'hex',
      BASE64: 'base64',
    },
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync: jest.fn(async (plaintext, key, options = {}) => {
      const rawKey = Buffer.from(await key.bytes());
      const iv = randomBytes(options.nonce?.length ?? 12);
      const tagLength = options.tagLength ?? 16;
      const cipher = createCipheriv('aes-256-gcm', rawKey, iv, { authTagLength: tagLength });
      if (options.additionalData) cipher.setAAD(Buffer.from(options.additionalData));
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
      const tag = cipher.getAuthTag();
      return AESSealedData.fromCombined(Buffer.concat([iv, ciphertext, tag]).toString('base64'), {
        ivLength: iv.length,
        tagLength: tag.length,
      });
    }),
    aesDecryptAsync: jest.fn(async (sealed, key, options = {}) => {
      const combined = sealed.bytes();
      const iv = combined.subarray(0, sealed.ivLength);
      const tag = combined.subarray(combined.length - sealed.tagLength);
      const ciphertext = combined.subarray(sealed.ivLength, combined.length - sealed.tagLength);
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(await key.bytes()), iv, {
        authTagLength: sealed.tagLength,
      });
      if (options.additionalData) decipher.setAAD(Buffer.from(options.additionalData));
      decipher.setAuthTag(tag);
      return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
    }),
    digestStringAsync: jest.fn((algorithm, value, options = { encoding: 'hex' }) => {
      const nodeAlgorithm = digestAlgorithms[algorithm];
      if (!nodeAlgorithm) return Promise.reject(new Error(`Unsupported digest algorithm: ${algorithm}`));
      return Promise.resolve(createHash(nodeAlgorithm).update(value).digest(options.encoding ?? 'hex'));
    }),
    getRandomBytes: jest.fn((count) => new Uint8Array(randomBytes(count))),
    getRandomBytesAsync: jest.fn((count) => Promise.resolve(new Uint8Array(randomBytes(count)))),
    getRandomValues: jest.fn((typedArray) => {
      new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength).set(
        randomBytes(typedArray.byteLength),
      );
      return typedArray;
    }),
    randomUUID: jest.fn(() => randomUUID()),
  };
});

// Supabase-klienten oprettes ved import og vil ellers forsøge at nå nettet.
// Testene her rører ikke serveren; de handler om det lokale.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      upsert: () => Promise.resolve({ error: null }),
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));

/**
 * expo-notifications er et native-modul. Flere stores trækker en påmindelses-
 * util ind ved import, og den kalder setNotificationHandler med det samme — så
 * mocken skal have hele fladen, ikke bare det den enkelte test bruger.
 */
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
