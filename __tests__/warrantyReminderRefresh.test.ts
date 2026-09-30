/// <reference types="node" />

import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'fs';
import * as Notifications from 'expo-notifications';
import path from 'path';

/**
 * APP-057 — reminders scheduled by earlier builds are replaced after upgrade.
 *
 * Earlier builds put the product name in the reminder title, and the OS keeps a
 * scheduled notification across an app update. The refresh finds those by their
 * deterministic ids (`warranty-<id>-<30|7|1>`, the only scheme ever shipped),
 * cancels them, and — only where permission was already granted — schedules the
 * generic ones from the canonical coverage end. It reads the local encrypted list,
 * never the network, never asks for permission, and never throws.
 *
 * The OS scheduler is faked as what it is: a map from identifier to request,
 * where scheduling an identifier replaces it and cancelling removes it.
 */

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
// Offline: no session can be fetched and no table can be read. The refresh must not care.
const mockFrom = jest.fn(() => { throw new Error('offline'); });
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(() => Promise.reject(new Error('offline'))) },
    from: (...args: unknown[]) => mockFrom(...(args as [])),
  },
}));
jest.mock('@/utils/shared/attachmentSync', () => ({
  uploadAttachment: jest.fn(() => Promise.resolve(null)),
  deleteAttachmentRemote: jest.fn(() => Promise.resolve()),
  fetchAttachmentsFor: jest.fn(() => Promise.resolve([])),
}));

import { documentMetadataEncryptedStorage } from '@/core/storage/documentCacheStorage';
import i18n from '@/localization/i18n';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import { Warranty } from '@/types/warranty';
import {
  cancelWarrantyReminder,
  refreshWarrantyReminders,
  scheduleWarrantyReminder,
} from '@/utils/warranty/warrantyReminder';

type Request = { identifier: string; content: { title: string; body: string }; trigger: { type: string; date: Date } };

const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock;
const mockCancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const mockGetPermissions = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.Mock;

const REPO_ROOT = path.resolve(__dirname, '..');
const RECEIPT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const SECRETS = ['Hearing aid', 'Private clinic', 'insurance claim', RECEIPT, 'receipt-hearing-aid.pdf'];

/** The OS scheduler: identifier → request. */
const os = new Map<string, Request>();
const snapshot = () => JSON.stringify([...os.entries()].sort(([a], [b]) => a.localeCompare(b)));
const ids = () => [...os.keys()].sort();

/** Exactly what a pre-APP-057 build left behind: the product name in the title. */
function seedOldSchedules(warrantyId: string, name: string) {
  for (const days of [30, 7, 1]) {
    os.set(`warranty-${warrantyId}-${days}`, {
      identifier: `warranty-${warrantyId}-${days}`,
      content: { title: `${name} expires soon`, body: `It expires in ${days} days.` },
      trigger: { type: 'date', date: new Date(2099, 5, 15 - days, 9) },
    });
  }
}

function seedOtherDomains() {
  os.set('trip-packing-t1', { identifier: 'trip-packing-t1', content: { title: 'Pack for Rome', body: '' }, trigger: { type: 'date', date: new Date(2099, 1, 1) } });
  os.set('cycle-period-reminder', { identifier: 'cycle-period-reminder', content: { title: 'x', body: 'y' }, trigger: { type: 'date', date: new Date(2099, 1, 2) } });
}

const granted = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' };
const denied = { granted: false, status: 'denied', canAskAgain: false, expires: 'never' };
const undetermined = { granted: false, status: 'undetermined', canAskAgain: true, expires: 'never' };

/** Wait, one macrotask at a time, until the refresh has actually reached the call being held. */
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(check()).toBe(true);
}

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

beforeEach(async () => {
  jest.clearAllMocks();
  os.clear();
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  mockSchedule.mockImplementation(async (request: Request) => { os.set(request.identifier, request); return request.identifier; });
  mockCancel.mockImplementation(async (identifier: string) => { os.delete(identifier); });
  mockGetPermissions.mockImplementation(async () => granted);
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  // Give any stray rejection a chance to surface before judging.
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled).toEqual([]);
  // An upgrade is never a reason for a permission dialog.
  expect(mockRequestPermissions).not.toHaveBeenCalled();
});

describe('APP-057 warranty reminder refresh', () => {
  it('replaces product-named schedules with generic ones, by their deterministic ids', async () => {
    seedOldSchedules('w1', 'Hearing aid');
    seedOtherDomains();

    const result = await refreshWarrantyReminders(() => [{ id: 'w1', expiryDate: '2099-06-15' }]);

    expect(result).toEqual({ permission: 'granted', cancelled: 3, scheduled: 3, failures: 0 });
    expect(mockCancel.mock.calls.map(([id]) => id).sort()).toEqual(['warranty-w1-1', 'warranty-w1-30', 'warranty-w1-7']);
    for (const id of ['warranty-w1-30', 'warranty-w1-7', 'warranty-w1-1']) {
      expect(os.get(id)!.content.title).toBe('A warranty is expiring soon');
      expect(os.get(id)!.content.body).toMatch(/^It expires in \d+ days?\. Open LifeSort to see which one\.$/);
    }
    expect(snapshot()).not.toContain('Hearing aid');
    // Derived from the canonical coverage end: 30, 7 and 1 days before, 09:00 local.
    expect(['warranty-w1-30', 'warranty-w1-7', 'warranty-w1-1'].map((id) => {
      const date = os.get(id)!.trigger.date;
      return [date.getMonth() + 1, date.getDate(), date.getHours()];
    })).toEqual([[5, 16, 9], [6, 8, 9], [6, 14, 9]]);
  });

  it('touches no other domain\'s notifications', async () => {
    seedOtherDomains();
    const before = { trip: os.get('trip-packing-t1'), cycle: os.get('cycle-period-reminder') };
    await refreshWarrantyReminders(() => [{ id: 'w1', expiryDate: '2099-06-15' }]);
    expect(os.get('trip-packing-t1')).toBe(before.trip);
    expect(os.get('cycle-period-reminder')).toBe(before.cycle);
    expect(mockCancel.mock.calls.every(([id]) => String(id).startsWith('warranty-w1-'))).toBe(true);
  });

  it.each([
    ['denied', denied],
    ['not yet asked', undetermined],
  ])('with permission %s: old schedules are cleared, nothing is scheduled, nothing is asked', async (_label, permission) => {
    mockGetPermissions.mockImplementation(async () => permission);
    seedOldSchedules('w1', 'Hearing aid');
    seedOtherDomains();

    const result = await refreshWarrantyReminders(() => [{ id: 'w1', expiryDate: '2099-06-15' }]);

    expect(result).toEqual({ permission: 'not-granted', cancelled: 3, scheduled: 0, failures: 0 });
    expect(ids()).toEqual(['cycle-period-reminder', 'trip-packing-t1']);
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockGetPermissions).toHaveBeenCalledTimes(1);
  });

  it('when the permission cannot be read, still clears, schedules nothing and does not throw', async () => {
    mockGetPermissions.mockImplementation(async () => { throw new Error('native module unavailable'); });
    seedOldSchedules('w1', 'Hearing aid');

    await expect(refreshWarrantyReminders(() => [{ id: 'w1', expiryDate: '2099-06-15' }]))
      .resolves.toEqual({ permission: 'unknown', cancelled: 3, scheduled: 0, failures: 1 });
    expect(os.size).toBe(0);
  });

  it('contains cancel and schedule failures, including synchronous throws, and carries on', async () => {
    seedOldSchedules('w1', 'Hearing aid');
    seedOldSchedules('w2', 'Private clinic');
    mockCancel.mockImplementation((identifier: string) => {
      if (identifier === 'warranty-w1-7') throw new Error('sync failure');
      if (identifier === 'warranty-w1-1') return Promise.reject(new Error('async failure'));
      os.delete(identifier);
      return Promise.resolve();
    });
    mockSchedule.mockImplementation(async (request: Request) => {
      if (request.identifier === 'warranty-w2-30') throw new Error('schedule failure');
      os.set(request.identifier, request);
      return request.identifier;
    });

    const result = await refreshWarrantyReminders(() => [
      { id: 'w1', expiryDate: '2099-06-15' },
      { id: 'w2', expiryDate: '2099-06-15' },
    ]);

    expect(result).toEqual({ permission: 'granted', cancelled: 4, scheduled: 5, failures: 3 });
    // w1's two uncancellable ids were still replaced by scheduling the same id.
    expect(snapshot()).not.toContain('Hearing aid');
    // w2's 30-day slot could not be rescheduled, but its old text was cancelled.
    expect(os.has('warranty-w2-30')).toBe(false);
    expect(snapshot()).not.toContain('Private clinic');
  });

  it('creates no schedule from an invalid coverage end, nor one in the past', async () => {
    const now = new Date(2027, 5, 8, 10, 0, 0).getTime(); // after 2027-06-15's 7-day reminder
    jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      for (const id of ['bad-leap', 'bad-stamp', 'bad-format', 'past', 'partly-past']) seedOldSchedules(id, 'Secret thing');
      const result = await refreshWarrantyReminders(() => [
        { id: 'bad-leap', expiryDate: '2027-02-29' },
        { id: 'bad-stamp', expiryDate: '2027-06-15T00:00:00.000Z' },
        { id: 'bad-format', expiryDate: '15-06-2027' },
        { id: 'past', expiryDate: '2020-01-01' },
        { id: 'partly-past', expiryDate: '2027-06-15' },
      ]);
      expect(result).toEqual({ permission: 'granted', cancelled: 15, scheduled: 1, failures: 0 });
    } finally {
      jest.restoreAllMocks();
    }
    expect(ids()).toEqual(['warranty-partly-past-1']);
    expect(os.get('warranty-partly-past-1')!.trigger.date.getTime()).toBeGreaterThan(new Date(2027, 5, 8, 10).getTime());
    expect(snapshot()).not.toContain('Secret thing');
  });

  it('is idempotent: running it again leaves exactly the same schedule', async () => {
    seedOldSchedules('w1', 'Hearing aid');
    seedOtherDomains();
    const read = () => [{ id: 'w1', expiryDate: '2099-06-15' }, { id: 'w2', expiryDate: '2099-12-01' }];

    const first = await refreshWarrantyReminders(read);
    const afterFirst = snapshot();
    const second = await refreshWarrantyReminders(read);
    const third = await refreshWarrantyReminders(read);

    expect(snapshot()).toBe(afterFirst);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(ids()).toEqual([
      'cycle-period-reminder', 'trip-packing-t1',
      'warranty-w1-1', 'warranty-w1-30', 'warranty-w1-7',
      'warranty-w2-1', 'warranty-w2-30', 'warranty-w2-7',
    ]);
  });

  it('does nothing and does not throw when the local list cannot be read', async () => {
    seedOldSchedules('w1', 'Hearing aid');
    await expect(refreshWarrantyReminders(() => { throw new Error('store unavailable'); }))
      .resolves.toEqual({ permission: 'unknown', cancelled: 0, scheduled: 0, failures: 0 });
    expect(mockGetPermissions).not.toHaveBeenCalled();
  });

  it('runs in order with user edits: a coverage end changed during the refresh wins', async () => {
    let answerPermission: ((value: unknown) => void) | undefined;
    mockGetPermissions.mockImplementationOnce(() => new Promise((resolve) => { answerPermission = resolve; }));
    // The user's own save may prompt; that is the existing, user-initiated path.
    mockRequestPermissions.mockImplementation(async () => granted);

    const refresh = refreshWarrantyReminders(() => [{ id: 'w1', expiryDate: '2099-06-15' }]);
    try {
      await until(() => answerPermission !== undefined);
      // The refresh is holding its turn; the user's edit arrives now and must wait for it.
      const edit = scheduleWarrantyReminder('w1', '2099-12-01');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(os.size).toBe(0);
      answerPermission!(granted);
      await Promise.all([refresh, edit]);
    } finally {
      answerPermission?.(granted);
      await refresh;
    }

    expect(os.get('warranty-w1-1')!.trigger.date.getMonth() + 1).toBe(11);
    expect(os.get('warranty-w1-1')!.trigger.date.getDate()).toBe(30);
    mockRequestPermissions.mockClear(); // the user-initiated save above is not the upgrade path
  });

  it('runs in order with deletions: a warranty removed during the refresh keeps no reminder', async () => {
    let answerPermission: ((value: unknown) => void) | undefined;
    mockGetPermissions.mockImplementationOnce(() => new Promise((resolve) => { answerPermission = resolve; }));

    const refresh = refreshWarrantyReminders(() => [{ id: 'w1', expiryDate: '2099-06-15' }]);
    try {
      await until(() => answerPermission !== undefined);
      const removal = cancelWarrantyReminder('w1');
      answerPermission!(granted);
      await Promise.all([refresh, removal]);
    } finally {
      answerPermission?.(granted);
      await refresh;
    }

    expect(ids()).toEqual([]);
  });
});

describe('APP-057 refresh from the encrypted local list, offline', () => {
  const PRIVATE: Warranty = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Hearing aid model X',
    type: 'warranty',
    expiryDate: '2099-06-15',
    notes: 'Paid with the insurance claim',
    purchaseDate: '2098-06-15',
    seller: 'Private clinic',
    receiptDocumentId: RECEIPT,
    attachments: [{ id: 'att-1', uri: 'file:///doc/attachments/att-1.lsenc', name: 'receipt-hearing-aid.pdf', kind: 'document' }],
    createdAt: '2026-01-02T03:04:05.000Z',
  };
  const LEGACY: Warranty = {
    id: '1693000000000-abc',
    name: 'Legacy laptop',
    type: 'warranty',
    expiryDate: '2099-01-31',
    attachments: [],
    createdAt: '2025-01-02T03:04:05.000Z',
  };

  beforeEach(async () => {
    await AsyncStorage.clear();
    await documentMetadataEncryptedStorage.setItem('lifesort-warranties',
      JSON.stringify({ state: { warranties: [PRIVATE, LEGACY] }, version: 0 }));
    await useWarrantiesStore.persist.rehydrate();
  });

  it('sanitizes old schedules for every warranty in the decrypted list, without the network', async () => {
    expect(useWarrantiesStore.getState().warranties.map((w) => w.id)).toEqual([PRIVATE.id, LEGACY.id]);
    seedOldSchedules(PRIVATE.id, PRIVATE.name);
    seedOldSchedules(LEGACY.id, LEGACY.name);

    await useWarrantiesStore.getState().refreshReminders();

    expect(mockFrom).not.toHaveBeenCalled();
    expect(ids()).toHaveLength(6);
    const everything = snapshot();
    for (const secret of [...SECRETS, 'Legacy laptop', 'Hearing aid model X']) expect(everything).not.toContain(secret);
    expect([...os.values()].every((request) => request.content.title === 'A warranty is expiring soon')).toBe(true);
    // The store itself is unchanged by a refresh.
    expect(useWarrantiesStore.getState().warranties).toEqual([PRIVATE, LEGACY]);
  });

  it('with permission not granted, leaves no old text behind and asks nothing', async () => {
    mockGetPermissions.mockImplementation(async () => denied);
    seedOldSchedules(PRIVATE.id, PRIVATE.name);

    await useWarrantiesStore.getState().refreshReminders();

    expect(os.size).toBe(0);
  });
});

describe('APP-057 lifecycle wiring', () => {
  const layout = fs.readFileSync(path.join(REPO_ROOT, 'app/_layout.tsx'), 'utf8');

  it('the root layout refreshes after the local list is hydrated, for a signed-in user, apart from the fetch', () => {
    const effect = layout.match(/useEffect\(\(\) => \{\n\s+if \(!session\) return;[\s\S]*?\}, \[session\?\.user\.id\]\);/);
    expect(effect).not.toBeNull();
    expect(effect![0]).toMatch(/whenStoreHydrated\(useWarrantiesStore\)[\s\S]*refreshWarrantyReminders\(\)/);
    expect(effect![0]).toMatch(/\.catch\(\(\) => undefined\)/);
    expect(effect![0]).not.toMatch(/fetchWarranties/);
  });

  it('nothing refreshes at import time', () => {
    const store = fs.readFileSync(path.join(REPO_ROOT, 'store/useWarrantiesStore.ts'), 'utf8');
    const reminder = fs.readFileSync(path.join(REPO_ROOT, 'utils/warranty/warrantyReminder.ts'), 'utf8');
    // Only the explicit store action calls it, and only the root layout calls that.
    expect(store.match(/refreshWarrantyReminders\(/g)).toHaveLength(1);
    expect(store).toMatch(/refreshReminders: async \(\) => \{\n\s+await refreshWarrantyReminders\(\(\) => get\(\)\.warranties\);/);
    expect(reminder).not.toMatch(/^refreshWarrantyReminders\(/m);
    // The refresh path never requests permission.
    const refreshBody = reminder.slice(reminder.indexOf('export function refreshWarrantyReminders'));
    expect(refreshBody).not.toContain('requestPermissionsAsync');
  });
});
