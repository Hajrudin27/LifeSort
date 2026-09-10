/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearLocalUserData } from '@/core/auth/clearLocalUserData';
import {
  DEVICE_SCOPED_KEYS,
  isOwnedKey,
  userDataKeys,
} from '@/core/storage/localDataScopes';
import { LOCAL_STORE_RESETS } from '@/features/localStores';

/**
 * APP-021 — når nogen logger ud, skal alt deres være væk.
 *
 * Den vigtigste test er ikke, at de kendte stores ryddes: det er, at en store,
 * ingen har husket, også bliver ryddet.
 */

// PIN-modulet trækker en ESM-only krypto-pakke ind. En oprydningstest skal
// ikke køre PBKDF2 — den skal se, at nøglen bliver slettet.
jest.mock('@/utils/auth/pinAuth', () => ({
  clearLocalPin: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/core/storage/cycleHealthEncryptedStorage', () => ({
  clearCycleHealthEncryptionKey: jest.fn(() => Promise.resolve()),
  withCycleHealthEncryptedStorageCleanup: jest.fn((cleanup: () => Promise<unknown>) => cleanup()),
}));

jest.mock('@/core/storage/documentCacheStorage', () => ({
  clearDocumentCacheEncryptionKey: jest.fn(() => Promise.resolve()),
  clearPersistentAttachmentCache: jest.fn(() => Promise.resolve()),
  clearTemporaryAttachmentCache: jest.fn(() => Promise.resolve()),
  withDocumentCacheCleanup: jest.fn((cleanup: () => Promise<unknown>) => cleanup()),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: true })),
  deleteAsync: jest.fn(() => Promise.resolve()),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  copyAsync: jest.fn(() => Promise.resolve()),
}));

const REPO_ROOT = path.resolve(__dirname, '..');

/** Persist-nøglerne, som de faktisk står i hver store. */
function persistedStoreKeys(): { file: string; key: string }[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'store'))
    .filter((file) => file.endsWith('.ts'))
    .map((file) => {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'store', file), 'utf8');
      const match = source.match(/name:\s*['"]([^'"]+)['"]/);
      return match ? { file: `store/${file}`, key: match[1] } : null;
    })
    .filter((entry): entry is { file: string; key: string } => entry !== null);
}

describe('ingen store bliver glemt', () => {
  const stores = persistedStoreKeys();

  it('finder de persisterede stores', () => {
    expect(stores.length).toBeGreaterThan(15);
  });

  it('bruger nøgler, oprydningen genkender som vores', () => {
    // En store med et navn uden for vores præfikser ville blive liggende for
    // evigt, fordi fejningen ikke rører fremmede nøgler.
    const unknown = stores.filter((store) => !isOwnedKey(store.key));
    expect(unknown).toEqual([]);
  });

  it('har enten en nulstilling eller en grund til at blive', () => {
    const covered = new Set(LOCAL_STORE_RESETS.map((entry) => entry.key));
    const missing = stores.filter((store) => !covered.has(store.key) && !(store.key in DEVICE_SCOPED_KEYS));
    expect(missing.map((store) => store.file)).toEqual([]);
  });

  it('nulstiller ikke noget, der ikke findes', () => {
    // En forældet linje ville se ud som dækning uden at være det.
    const actual = new Set(stores.map((store) => store.key));
    const stale = LOCAL_STORE_RESETS.filter((entry) => !actual.has(entry.key));
    expect(stale.map((entry) => entry.key)).toEqual([]);
  });

  it('begrunder hver undtagelse', () => {
    for (const [key, reason] of Object.entries(DEVICE_SCOPED_KEYS)) {
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(20);
      expect(isOwnedKey(key)).toBe(true);
    }
  });
});

describe('hvad fejningen tager', () => {
  it('tager alt vores, der ikke hører til enheden', () => {
    const keys = ['lifesort-expenses', 'lifesort-cycle', 'sync-status', 'lifesort-home-layout'];
    expect(userDataKeys(keys).sort()).toEqual(keys.sort());
  });

  it('lader sprog og kill switches stå', () => {
    expect(userDataKeys(['lifesort-settings', 'lifesort-module-flags'])).toEqual([]);
  });

  it('rører ikke andres nøgler i AsyncStorage', () => {
    // Expo og andre biblioteker deler lageret med os.
    expect(userDataKeys(['EXPO_CONSTANTS', 'some-other-lib', 'firebase:foo'])).toEqual([]);
  });

  it('fanger en store, ingen har meldt ind', () => {
    // Selve pointen: en ny store med vores præfiks bliver ryddet, også selvom
    // den mangler i features/localStores.ts.
    expect(userDataKeys(['lifesort-noget-nyt-nogen-har-lavet'])).toEqual(['lifesort-noget-nyt-nogen-har-lavet']);
  });
});

describe('log ud rydder faktisk op', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('fjerner brugerens nøgler fra disken og beholder enhedens', async () => {
    await AsyncStorage.multiSet([
      ['lifesort-expenses', '{"expenses":[{"amount":9999}]}'],
      ['lifesort-cycle', '{"cycles":[{"startDate":"2026-08-01"}]}'],
      ['sync-status', '{"failures":{"cycle":{}}}'],
      ['lifesort-settings', '{"language":"da"}'],
      ['lifesort-module-flags', '{"overrides":{}}'],
      ['EXPO_SOMETHING', 'ikke vores'],
    ]);

    await clearLocalUserData([]);

    const remaining = [...(await AsyncStorage.getAllKeys())].sort();
    expect(remaining).toEqual(['EXPO_SOMETHING', 'lifesort-module-flags', 'lifesort-settings']);
  });

  it('aflyser alle planlagte påmindelser', async () => {
    // Ellers kan en cyklus-påmindelse dukke op på en telefon, hvor kontoen
    // blev logget ud af for en uge siden (fund D5).
    const Notifications = require('expo-notifications');
    await clearLocalUserData([]);
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalled();
  });

  it('sletter de lokale vedhæftninger', async () => {
    // Kvitteringer og garantibilleder blev tidligere liggende (fund D4).
    const { clearPersistentAttachmentCache, clearTemporaryAttachmentCache } = require('@/core/storage/documentCacheStorage');
    await clearLocalUserData([]);
    expect(clearPersistentAttachmentCache).toHaveBeenCalled();
    expect(clearTemporaryAttachmentCache).toHaveBeenCalled();
  });

  it('sletter PIN-koden', async () => {
    // Ellers ville den næste bruger kunne låse appen op med den forriges kode.
    const { clearLocalPin } = require('@/utils/auth/pinAuth');
    await clearLocalUserData([]);
    expect(clearLocalPin).toHaveBeenCalled();
  });

  it('sletter cykluslagerets krypteringsnøgle', async () => {
    const { clearCycleHealthEncryptionKey } = require('@/core/storage/cycleHealthEncryptedStorage');
    await clearLocalUserData([]);
    expect(clearCycleHealthEncryptionKey).toHaveBeenCalled();
  });

  it('sletter dokumentcache-lagerets krypteringsnøgle', async () => {
    const { clearDocumentCacheEncryptionKey } = require('@/core/storage/documentCacheStorage');
    await clearLocalUserData([]);
    expect(clearDocumentCacheEncryptionKey).toHaveBeenCalled();
  });

  it('holder cykluslagerets oprydningsvindue rundt om nulstilling, diskfejning og nøglesletning', async () => {
    const events: string[] = [];
    const {
      clearCycleHealthEncryptionKey,
      withCycleHealthEncryptedStorageCleanup,
    } = require('@/core/storage/cycleHealthEncryptedStorage');
    const {
      clearDocumentCacheEncryptionKey,
      withDocumentCacheCleanup,
    } = require('@/core/storage/documentCacheStorage');

    withCycleHealthEncryptedStorageCleanup.mockImplementationOnce(async (cleanup: () => Promise<unknown>) => {
      events.push('begin-cycle-cleanup');
      try {
        return await cleanup();
      } finally {
        events.push('finish-cycle-cleanup');
      }
    });
    clearCycleHealthEncryptionKey.mockImplementationOnce(async () => {
      events.push('clear-cycle-key');
    });
    withDocumentCacheCleanup.mockImplementationOnce(async (cleanup: () => Promise<unknown>) => {
      events.push('begin-document-cleanup');
      try {
        return await cleanup();
      } finally {
        events.push('finish-document-cleanup');
      }
    });
    clearDocumentCacheEncryptionKey.mockImplementationOnce(async () => {
      events.push('clear-document-key');
    });

    await AsyncStorage.setItem('lifesort-cycle', '{"state":{"cycles":[]}}');
    const originalMultiRemove = (AsyncStorage.multiRemove as jest.Mock).getMockImplementation();
    (AsyncStorage.multiRemove as jest.Mock).mockImplementationOnce(async (keys: readonly string[]) => {
      events.push('remove-user-storage');
      return originalMultiRemove?.(keys);
    });

    await clearLocalUserData([
      {
        key: 'lifesort-cycle',
        reset: () => {
          events.push('reset-cycle-store');
        },
      },
    ]);

    expect(events).toEqual([
      'begin-cycle-cleanup',
      'begin-document-cleanup',
      'reset-cycle-store',
      'remove-user-storage',
      'clear-document-key',
      'clear-cycle-key',
      'finish-document-cleanup',
      'finish-cycle-cleanup',
    ]);
  });

  it('nulstiller hukommelsen, ikke kun disken', async () => {
    // Uden det ser den næste bruger de gamle tal, indtil appen genstartes.
    const reset = jest.fn();
    await clearLocalUserData([{ key: 'lifesort-test', reset }]);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('lader ikke en fejlende store stoppe resten', async () => {
    const good = jest.fn();
    const bad = jest.fn(() => {
      throw new Error('nej');
    });

    await expect(
      clearLocalUserData([
        { key: 'lifesort-a', reset: bad },
        { key: 'lifesort-b', reset: good },
      ]),
    ).resolves.toBeUndefined();

    expect(good).toHaveBeenCalled();
  });
});
