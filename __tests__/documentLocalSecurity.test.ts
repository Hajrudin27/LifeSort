import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * APP-055 — what the phone keeps, and what it must not.
 *
 * A filename is not neutral: "divorce-settlement.pdf" or "biopsy-result.pdf" is
 * already the sensitive fact. So `lifesort-documents` is measured the only way
 * that means anything — by reading the raw bytes AsyncStorage holds and looking
 * for the plaintext in them.
 */

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false, isDirectory: false, size: 0 })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-file-system', () => ({
  File: class {
    bytes() { return Promise.reject(new Error('file missing')); }
    create() {}
    write() { return Promise.resolve(); }
  },
}));

jest.mock('expo-notifications', () => ({ cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn(() => Promise.resolve()) }));
jest.mock('@/core/auth/emailVerification', () => ({ clearResendThrottle: jest.fn(() => Promise.resolve()) }));
jest.mock('@/core/auth/reauth', () => ({ clearVerification: jest.fn() }));
jest.mock('@/utils/shared/attachmentSync', () => ({ clearSignedUrlCache: jest.fn() }));
jest.mock('@/utils/shared/attachmentStorage', () => ({ clearAttachmentCache: jest.fn(() => Promise.resolve()) }));
jest.mock('@/utils/shared/attachmentViewerSource', () => ({ clearAttachmentViewerSources: jest.fn() }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) },
    storage: { from: jest.fn(() => ({ createSignedUrl: jest.fn(), upload: jest.fn(), remove: jest.fn() })) },
    from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => ({ order: jest.fn(() => Promise.resolve({ data: [], error: null })) })) })) })),
  },
}));

import { clearLocalUserData } from '@/core/auth/clearLocalUserData';
import { documentMetadataEncryptedStorage } from '@/core/storage/documentCacheStorage';
import { DATA_DOMAINS, localStorageProtectionForSurface, persistenceSurfaceContainsProfileB } from '@/core/storage/dataProfileRegistry';

const KEY = 'lifesort-documents';
const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const DOC = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const FILENAME = 'divorce-settlement-2026.pdf';

const payload = (name = FILENAME) =>
  JSON.stringify({
    state: {
      documents: [{ id: DOC, storagePath: `${USER}/${DOC}`, originalName: name, createdAt: '2026-09-25T09:00:00.000Z' }],
    },
    version: 0,
  });

beforeEach(async () => {
  jest.clearAllMocks();
  mockSecureStore.clear();
  // The adapter blocks writes to a key whose protected read failed, and that
  // block is module state. Removing the key clears it, so one test's deliberate
  // failure does not leak into the next.
  await documentMetadataEncryptedStorage.removeItem(KEY);
  await AsyncStorage.clear();
});

describe('lifesort-documents ligger krypteret', () => {
  it('efterlader hverken filnavn, sti eller bruger-id i klartekst', async () => {
    await documentMetadataEncryptedStorage.setItem(KEY, payload());

    const raw = await AsyncStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    expect(raw).toContain('__lifesort_encrypted_document_metadata__');

    for (const secret of [FILENAME, 'divorce', USER, DOC, `${USER}/${DOC}`, '2026-09-25T09:00:00.000Z']) {
      expect(raw).not.toContain(secret);
    }

    const envelope = JSON.parse(raw!);
    expect(envelope.algorithm).toBe('AES-256-GCM');
    // The key lives in the OS keystore, not beside the data.
    expect(mockSecureStore.has('lifesort-document-cache-key')).toBe(true);
    expect(raw).not.toContain(mockSecureStore.get('lifesort-document-cache-key'));
  });

  it('kan læses tilbage uændret af den samme adapter', async () => {
    await documentMetadataEncryptedStorage.setItem(KEY, payload());
    expect(await documentMetadataEncryptedStorage.getItem(KEY)).toBe(payload());
  });

  it('afviser en payload den ikke genkender, frem for at gætte', async () => {
    await documentMetadataEncryptedStorage.setItem(KEY, payload());
    // A different shape under the same key must not decode into documents.
    await expect(documentMetadataEncryptedStorage.setItem(KEY, JSON.stringify({ state: { notDocuments: [] }, version: 0 })))
      .resolves.toBeUndefined();
    await expect(documentMetadataEncryptedStorage.getItem(KEY)).rejects.toMatchObject({
      name: 'DocumentCacheProtectedDataError',
    });
  });

  it('gemmer aldrig en signeret URL eller en lokal fil-URI', async () => {
    await documentMetadataEncryptedStorage.setItem(KEY, payload());
    const decoded = await documentMetadataEncryptedStorage.getItem(KEY);
    const document = JSON.parse(decoded!).state.documents[0];
    expect(Object.keys(document).sort()).toEqual(['createdAt', 'id', 'originalName', 'storagePath']);
    expect(decoded).not.toContain('http');
    expect(decoded).not.toContain('file://');
  });
});

describe('der findes ingen historisk plaintext lifesort-documents', () => {
  const plaintext = payload('lease-agreement.pdf');

  it('migrerer ikke en rå plaintext-payload — den fejler lukket', async () => {
    // Shape alone must not buy trust. The store was born encrypted, so plaintext
    // under its key is not an older version of anything; it is a value nobody can
    // account for, and the only safe reading of that in a protected store is to
    // refuse it.
    await AsyncStorage.setItem(KEY, plaintext);

    await expect(documentMetadataEncryptedStorage.getItem(KEY)).rejects.toMatchObject({
      name: 'DocumentCacheProtectedDataError',
      code: 'migration-failed',
    });
  });

  it('erstatter ikke den plaintext med en frisk krypteret konvolut', async () => {
    await AsyncStorage.setItem(KEY, plaintext);
    await Promise.resolve(documentMetadataEncryptedStorage.getItem(KEY)).catch(() => undefined);

    // The bytes are exactly as they were: nothing was adopted, nothing rewritten.
    expect(await AsyncStorage.getItem(KEY)).toBe(plaintext);
    expect(await AsyncStorage.getItem(KEY)).not.toContain('__lifesort_encrypted_document_metadata__');
  });

  it('blokerer efterfølgende skrivninger frem for at skrive hen over det uforklarede', async () => {
    await AsyncStorage.setItem(KEY, plaintext);
    await Promise.resolve(documentMetadataEncryptedStorage.getItem(KEY)).catch(() => undefined);

    await expect(documentMetadataEncryptedStorage.setItem(KEY, plaintext)).rejects.toMatchObject({
      name: 'DocumentCacheProtectedDataError',
      code: 'write-blocked-after-protected-failure',
    });
    expect(await AsyncStorage.getItem(KEY)).toBe(plaintext);
  });

  it('lader den korrekt krypterede vej være urørt', async () => {
    await documentMetadataEncryptedStorage.setItem(KEY, plaintext);
    expect(await documentMetadataEncryptedStorage.getItem(KEY)).toBe(plaintext);
    expect(await AsyncStorage.getItem(KEY)).toContain('__lifesort_encrypted_document_metadata__');
  });

  it.each(['lifesort-expenses', 'lifesort-warranties', 'lifesort-trips', 'lifesort-career', 'lifesort-cv'])(
    'rører ikke %s, som har en ægte historisk plaintext at opgradere',
    async (legacyKey) => {
      const legacy: Record<string, unknown> = {
        'lifesort-expenses': { expenses: [], seriesStoppedAt: {}, categoryBudgets: {} },
        'lifesort-warranties': { warranties: [] },
        'lifesort-trips': { trips: [], expenses: [], packingItems: [] },
        // APP-067: both held plaintext before they were encrypted.
        'lifesort-career': { applications: [], skills: [] },
        'lifesort-cv': { personalInfo: {}, education: [], experience: [], languages: [], versions: [] },
      }[legacyKey]!;
      const legacyPayload = JSON.stringify({ state: legacy, version: 0 });

      await AsyncStorage.setItem(legacyKey, legacyPayload);
      const read = await documentMetadataEncryptedStorage.getItem(legacyKey);

      // Still migrated in place, and still encrypted afterwards. APP-059/060 now have
      // an intentional inner trip v2; the other two shapes remain unchanged.
      const parsed = JSON.parse(read!);
      if (legacyKey === 'lifesort-trips') {
        expect(parsed).toEqual({
          version: 2,
          state: {
            ...legacy,
            participants: [], myUserId: null,
            financialProjections: [], financialProjectionFreshAt: {}, financialProjectionStatus: {},
            pendingExpenseDrafts: {},
            appliedPackingTemplates: [],
          },
        });
      } else {
        expect(parsed.state).toEqual(legacy);
      }
      expect(await AsyncStorage.getItem(legacyKey)).toContain('__lifesort_encrypted_document_metadata__');
      await documentMetadataEncryptedStorage.removeItem(legacyKey);
    },
  );
});

describe('listen over historisk plaintext er lukket og præcis (APP-067)', () => {
  // These stores are encrypted-required or born-encrypted; none had plaintext history. Only the five
  // keys named above may be upgraded in place, however recognisable the shape of another payload is.
  it.each([
    ['lifesort-todos', { todos: [] }],
    ['lifesort-habits', { habits: [] }],
    ['lifesort-household', { tasks: [] }],
    ['lifesort-cycle', { cycles: [], symptomLogs: [] }],
    ['lifesort-skill-categories', { categories: [] }],
    ['lifesort-career-applications', { applications: [], skills: [] }],
  ])('opgraderer ikke en rå plaintext under %s', async (key, state) => {
    const plaintext = JSON.stringify({ state, version: 0 });
    await AsyncStorage.setItem(key, plaintext);
    await expect(documentMetadataEncryptedStorage.getItem(key)).rejects.toMatchObject({ name: 'DocumentCacheProtectedDataError' });
    expect(await AsyncStorage.getItem(key)).toBe(plaintext);
    await documentMetadataEncryptedStorage.removeItem(key);
  });

  it.each([
    ['lifesort-career', { applications: 'x', skills: [] }],
    ['lifesort-career', { applications: [] }],
    ['lifesort-cv', { personalInfo: [], education: [], experience: [], languages: [], versions: [] }],
    ['lifesort-cv', { personalInfo: {}, education: [], experience: [], languages: [] }],
  ])('afviser en forkert formet %s uden at gætte', async (key, state) => {
    const plaintext = JSON.stringify({ state, version: 0 });
    await AsyncStorage.setItem(key, plaintext);
    await expect(documentMetadataEncryptedStorage.getItem(key)).rejects.toMatchObject({ name: 'DocumentCacheProtectedDataError' });
    expect(await AsyncStorage.getItem(key)).toBe(plaintext);
    await documentMetadataEncryptedStorage.removeItem(key);
  });
});

describe('Career og CV ligger krypteret (APP-067)', () => {
  const NOTE = 'private interview note sentinel';
  const COMPANY = 'Sentinel Employer ApS';
  const PHONE = '+45 11 22 33 44';
  const career = JSON.stringify({ state: { applications: [{ id: 'a', company: COMPANY, position: 'Role', status: 'offer', appliedDate: '2026-10-01', notes: NOTE, createdAt: '2026-10-01T08:00:00.000Z' }], skills: [] }, version: 0 });
  const cv = JSON.stringify({ state: { personalInfo: { fullName: 'Sentinel', phone: PHONE, email: 'sentinel@example.org', location: 'Sentinelvej 1' }, education: [], experience: [], languages: [], versions: [] }, version: 0 });

  it.each([['lifesort-career', career, [NOTE, COMPANY, '2026-10-01']], ['lifesort-cv', cv, [PHONE, 'sentinel@example.org', 'Sentinelvej 1']]])(
    'efterlader intet i klartekst under %s, og kan læses tilbage',
    async (key, payloadValue, secrets) => {
      await documentMetadataEncryptedStorage.setItem(key, payloadValue);
      const stored = await AsyncStorage.getItem(key);
      expect(stored).toContain('__lifesort_encrypted_document_metadata__');
      for (const secret of secrets) expect(stored).not.toContain(secret);
      expect(await documentMetadataEncryptedStorage.getItem(key)).toBe(payloadValue);
      await documentMetadataEncryptedStorage.removeItem(key);
    },
  );

  it.each([['lifesort-career', career, NOTE], ['lifesort-cv', cv, PHONE]])(
    'opgraderer plaintext under %s på stedet, og efterlader ingen klartekst',
    async (key, payloadValue, secret) => {
      await AsyncStorage.setItem(key, payloadValue);
      expect(await documentMetadataEncryptedStorage.getItem(key)).toBe(payloadValue);
      const stored = await AsyncStorage.getItem(key);
      expect(stored).toContain('__lifesort_encrypted_document_metadata__');
      expect(stored).not.toContain(secret);
      await documentMetadataEncryptedStorage.removeItem(key);
    },
  );

  it.each([['lifesort-career', career], ['lifesort-cv', cv]])('fejler lukket på en beskadiget konvolut under %s og blokerer skrivning', async (key, payloadValue) => {
    await documentMetadataEncryptedStorage.setItem(key, payloadValue);
    const envelope = JSON.parse((await AsyncStorage.getItem(key))!);
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
    const corrupt = JSON.stringify(envelope);
    await AsyncStorage.setItem(key, corrupt);

    await expect(documentMetadataEncryptedStorage.getItem(key)).rejects.toMatchObject({ code: 'ciphertext-authentication-failed' });
    await expect(documentMetadataEncryptedStorage.setItem(key, payloadValue)).rejects.toMatchObject({ code: 'write-blocked-after-protected-failure' });
    expect(await AsyncStorage.getItem(key)).toBe(corrupt);
    await documentMetadataEncryptedStorage.removeItem(key);
  });

  it.each([['lifesort-career', career], ['lifesort-cv', cv]])('fejler lukket når nøglen mangler under %s', async (key, payloadValue) => {
    await documentMetadataEncryptedStorage.setItem(key, payloadValue);
    const encrypted = await AsyncStorage.getItem(key);
    mockSecureStore.clear();

    await expect(documentMetadataEncryptedStorage.getItem(key)).rejects.toMatchObject({ code: 'key-missing' });
    await expect(documentMetadataEncryptedStorage.setItem(key, payloadValue)).rejects.toMatchObject({ code: 'write-blocked-after-protected-failure' });
    expect(await AsyncStorage.getItem(key)).toBe(encrypted);
    await documentMetadataEncryptedStorage.removeItem(key);
  });

  it('kontoskifte fjerner begge og ødelægger nøglen, så en gammel konvolut ikke kan læses igen', async () => {
    await documentMetadataEncryptedStorage.setItem('lifesort-career', career);
    await documentMetadataEncryptedStorage.setItem('lifesort-cv', cv);
    const oldCareer = await AsyncStorage.getItem('lifesort-career');

    await clearLocalUserData([]);

    expect(await AsyncStorage.getItem('lifesort-career')).toBeNull();
    expect(await AsyncStorage.getItem('lifesort-cv')).toBeNull();
    expect(mockSecureStore.has('lifesort-document-cache-key')).toBe(false);
    await AsyncStorage.setItem('lifesort-career', oldCareer!);
    await expect(documentMetadataEncryptedStorage.getItem('lifesort-career')).rejects.toMatchObject({ name: 'DocumentCacheProtectedDataError' });
    await documentMetadataEncryptedStorage.removeItem('lifesort-career');
  });
});

describe('kontoskifte', () => {
  it('fjerner dokumentmetadata, så den næste bruger ikke arver dem', async () => {
    await documentMetadataEncryptedStorage.setItem(KEY, payload());
    await AsyncStorage.setItem('lifesort-habits', JSON.stringify({ state: { habits: [] }, version: 0 }));
    await AsyncStorage.setItem('lifesort-settings', JSON.stringify({ state: { language: 'da' }, version: 0 }));

    await clearLocalUserData([{ key: KEY, reset: () => undefined }]);

    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    // The sweep is by prefix, so an unrelated user store goes too...
    expect(await AsyncStorage.getItem('lifesort-habits')).toBeNull();
    // ...while the device-scoped language choice deliberately stays (ADR-0017).
    expect(await AsyncStorage.getItem('lifesort-settings')).not.toBeNull();
    // And the encryption key is destroyed, so the old bytes are unreadable anyway.
    expect(mockSecureStore.has('lifesort-document-cache-key')).toBe(false);
  });

  it('lader ikke en ny bruger genskabe den forriges nøgle og læse gamle bytes', async () => {
    await documentMetadataEncryptedStorage.setItem(KEY, payload());
    const before = await AsyncStorage.getItem(KEY);

    await clearLocalUserData([]);

    // Put the old ciphertext back as a stale-device simulation; a fresh key
    // cannot authenticate it, so it fails closed instead of decoding.
    await AsyncStorage.setItem(KEY, before!);
    await expect(documentMetadataEncryptedStorage.getItem(KEY)).rejects.toMatchObject({
      name: 'DocumentCacheProtectedDataError',
    });
  });
});

describe('klassificeringen af Career og CV (APP-067)', () => {
  it('career.applications og career.cv er Profile B med krypteringskrav; career.skills deler den krypterede nøgle', () => {
    for (const id of ['career.applications', 'career.cv']) {
      expect(DATA_DOMAINS.find((d) => d.id === id)).toMatchObject({
        profile: 'B', encryptedLocalPersistenceRequired: true, plaintextLocalPersistenceAllowed: false,
      });
    }
    expect(DATA_DOMAINS.find((d) => d.id === 'career.skills')).toMatchObject({ profile: 'A', expectsServerSync: false });
    for (const surface of ['async-storage:lifesort-career', 'async-storage:lifesort-cv']) {
      expect(persistenceSurfaceContainsProfileB(surface)).toBe(true);
      expect(localStorageProtectionForSurface(surface)).toBe('encrypted-required');
    }
  });

  it('ansøgninger er lokale: ingen serversynkronisering forventes, og ingen tvetydig note er tilbage', () => {
    const applications = DATA_DOMAINS.find((d) => d.id === 'career.applications')!;
    expect(applications.expectsServerSync).toBe(false);
    expect('ambiguous' in applications).toBe(false);
    expect('ambiguous' in DATA_DOMAINS.find((d) => d.id === 'career.cv')!).toBe(false);
  });
});

describe('klassificeringen', () => {
  it('er registreret som Profile B med krypteringskrav', () => {
    const domain = DATA_DOMAINS.find((d) => d.id === 'documents.files');
    expect(domain).toMatchObject({
      profile: 'B',
      module: 'documents',
      expectsServerSync: true,
      encryptedLocalPersistenceRequired: true,
      plaintextLocalPersistenceAllowed: false,
    });
    expect(persistenceSurfaceContainsProfileB('async-storage:lifesort-documents')).toBe(true);
    expect(localStorageProtectionForSurface('async-storage:lifesort-documents')).toBe('encrypted-required');
  });

  it('registrerer præcis de fysiske flader APP-055 og APP-056 faktisk opretter', () => {
    const domain = DATA_DOMAINS.find((d) => d.id === 'documents.files')!;
    expect([...domain.storageSurfaces].sort()).toEqual([
      'async-storage:lifesort-documents',
      'secure-store:lifesort-document-cache-key',
      'supabase-storage-bucket:documents',
      // APP-056's tombstones: server-only, and never cached on the device.
      'supabase-table:document_deletion_tombstones',
      'supabase-table:documents',
    ]);
    // The picker's temporary copy is transient interoperability data, not a
    // canonical persistence surface, so it is deliberately absent.
    expect(domain.storageSurfaces.some((surface) => surface.startsWith('filesystem:'))).toBe(false);
  });
});
