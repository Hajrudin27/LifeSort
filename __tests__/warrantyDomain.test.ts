import * as Notifications from 'expo-notifications';

/**
 * APP-057 — the warranty's own rules and the reminders derived from them.
 *
 * Dates are calendar dates validated by the one strict parser the app has; nothing
 * is repaired. Reminders derive only from the canonical coverage end, in calendar
 * days, at 09:00 local time — and what they say on a lock screen names nothing.
 *
 * `npm test` pins TZ=Europe/Copenhagen, so the DST cases below are real
 * Copenhagen transitions: 2026-10-25 (CEST→CET) and 2027-03-28 (CET→CEST).
 */

jest.mock('@/core/storage/documentCacheStorage', () => ({
  documentMetadataEncryptedStorage: require('@react-native-async-storage/async-storage'),
  deleteCachedAttachmentFile: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) } },
}));
jest.mock('@/utils/shared/attachmentSync', () => ({
  uploadAttachment: jest.fn(() => Promise.resolve(null)),
  deleteAttachmentRemote: jest.fn(() => Promise.resolve()),
  fetchAttachmentsFor: jest.fn(() => Promise.resolve([])),
}));

import i18n from '@/localization/i18n';
import daWarranties from '@/localization/locales/da/warranties.json';
import enWarranties from '@/localization/locales/en/warranties.json';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import { Warranty } from '@/types/warranty';
import {
  isWarrantyReceiptReference,
  normalizeWarrantySeller,
  warrantyDateProblem,
} from '@/utils/warranty/warrantyDomain';
import {
  cancelWarrantyReminder,
  scheduleWarrantyReminder,
  warrantyReminderOccurrences,
} from '@/utils/warranty/warrantyReminder';

const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock;
const mockCancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;

const RECEIPT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
/** Long before every date used here, so nothing is skipped as past unless a test says so. */
const LONG_AGO = new Date(2026, 0, 1, 0, 0, 0).getTime();

const scheduledCalls = () => mockSchedule.mock.calls.map(([request]) => request);

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('APP-057 canonical warranty dates', () => {
  it('accepts canonical coverage end alone, or with a purchase on or before it', () => {
    expect(warrantyDateProblem({ expiryDate: '2028-06-01' })).toBeNull();
    expect(warrantyDateProblem({ expiryDate: '2028-06-01', purchaseDate: undefined })).toBeNull();
    expect(warrantyDateProblem({ expiryDate: '2028-06-01', purchaseDate: '2026-06-01' })).toBeNull();
    // The same calendar day is allowed: bought and ending on one day is possible.
    expect(warrantyDateProblem({ expiryDate: '2028-06-01', purchaseDate: '2028-06-01' })).toBeNull();
    // A leap day is a real day on either side.
    expect(warrantyDateProblem({ expiryDate: '2028-02-29', purchaseDate: '2028-02-29' })).toBeNull();
    expect(warrantyDateProblem({ expiryDate: '2029-03-01', purchaseDate: '2028-02-29' })).toBeNull();
  });

  it('refuses a purchase after coverage ends, by one day or across years', () => {
    expect(warrantyDateProblem({ expiryDate: '2028-06-01', purchaseDate: '2028-06-02' })).toBe('purchase-after-coverage-end');
    expect(warrantyDateProblem({ expiryDate: '2027-12-31', purchaseDate: '2028-01-01' })).toBe('purchase-after-coverage-end');
  });

  it.each([
    ['2027-02-29', 'not a leap year'],
    ['2028-02-30', 'no such day'],
    ['2027-13-01', 'no such month'],
    ['2027-6-1', 'not zero-padded'],
    ['2027-06-01T00:00:00.000Z', 'a timestamp, not a calendar date'],
    ['', 'empty'],
  ])('refuses %s as a coverage end (%s) and as a purchase date, without repairing it', (value) => {
    expect(warrantyDateProblem({ expiryDate: value })).toBe('invalid-coverage-end');
    expect(warrantyDateProblem({ expiryDate: '2029-01-01', purchaseDate: value })).toBe('invalid-purchase-date');
  });

  it('refuses non-string dates rather than coercing them', () => {
    expect(warrantyDateProblem({ expiryDate: new Date(2028, 5, 1) })).toBe('invalid-coverage-end');
    expect(warrantyDateProblem({ expiryDate: '2028-06-01', purchaseDate: 20260601 })).toBe('invalid-purchase-date');
    expect(warrantyDateProblem({ expiryDate: '2028-06-01', purchaseDate: null })).toBe('invalid-purchase-date');
  });

  it('treats a legacy warranty with none of the new fields as valid', () => {
    const legacy: Warranty = {
      id: '1693000000000-abc',
      name: 'Legacy laptop',
      type: 'warranty',
      expiryDate: '2027-01-31',
      attachments: [],
      createdAt: '2026-01-02T03:04:05.000Z',
    };
    expect(warrantyDateProblem(legacy)).toBeNull();
    expect(legacy.purchaseDate).toBeUndefined();
    expect(legacy.seller).toBeUndefined();
    expect(legacy.receiptDocumentId).toBeUndefined();
  });

  it('keeps seller as trimmed text and treats blank as not recorded', () => {
    expect(normalizeWarrantySeller('  Synthetic shop  ')).toBe('Synthetic shop');
    expect(normalizeWarrantySeller('   ')).toBeUndefined();
    expect(normalizeWarrantySeller(undefined)).toBeUndefined();
    expect(normalizeWarrantySeller(42)).toBeUndefined();
  });

  it('accepts only a document-id shape as a receipt reference', () => {
    expect(isWarrantyReceiptReference(RECEIPT)).toBe(true);
    for (const value of ['', 'receipt.pdf', `${RECEIPT}/x`, '../x', 'https://storage.example/signed', 42, null, undefined]) {
      expect(isWarrantyReceiptReference(value)).toBe(false);
    }
  });
});

describe('APP-057 reminders from the canonical coverage end', () => {
  it('derives 30, 7 and 1 days before, in calendar days, at 09:00 local time', () => {
    const occurrences = warrantyReminderOccurrences('2027-06-15', LONG_AGO);
    expect(occurrences.map(({ daysBefore, date }) => [daysBefore, date])).toEqual([
      [30, '2027-05-16'],
      [7, '2027-06-08'],
      [1, '2027-06-14'],
    ]);
    for (const { date, trigger } of occurrences) {
      const [year, month, day] = date.split('-').map(Number);
      expect([trigger.getFullYear(), trigger.getMonth() + 1, trigger.getDate()]).toEqual([year, month, day]);
      expect([trigger.getHours(), trigger.getMinutes(), trigger.getSeconds(), trigger.getMilliseconds()]).toEqual([9, 0, 0, 0]);
    }
  });

  it('crosses the autumn DST change without moving a reminder to another day or hour', () => {
    // 2026-10-25 03:00 CEST becomes 02:00 CET.
    const occurrences = warrantyReminderOccurrences('2026-10-26', LONG_AGO);
    expect(occurrences.map(({ date, trigger }) => [date, trigger.toISOString()])).toEqual([
      ['2026-09-26', '2026-09-26T07:00:00.000Z'], // CEST, UTC+2
      ['2026-10-19', '2026-10-19T07:00:00.000Z'], // CEST, UTC+2
      ['2026-10-25', '2026-10-25T08:00:00.000Z'], // the change day, already CET, UTC+1
    ]);
  });

  it('crosses the spring DST change without moving a reminder to another day or hour', () => {
    // 2027-03-28 02:00 CET becomes 03:00 CEST.
    const occurrences = warrantyReminderOccurrences('2027-03-29', LONG_AGO);
    expect(occurrences.map(({ date, trigger }) => [date, trigger.toISOString()])).toEqual([
      ['2027-02-27', '2027-02-27T08:00:00.000Z'], // CET, UTC+1
      ['2027-03-22', '2027-03-22T08:00:00.000Z'], // CET, UTC+1
      ['2027-03-28', '2027-03-28T07:00:00.000Z'], // the change day, already CEST, UTC+2
    ]);
  });

  it('counts back across month ends and leap days as the calendar has them', () => {
    expect(warrantyReminderOccurrences('2028-03-01', LONG_AGO).map(({ date }) => date))
      .toEqual(['2028-01-31', '2028-02-23', '2028-02-29']);
    expect(warrantyReminderOccurrences('2027-03-01', LONG_AGO).map(({ date }) => date))
      .toEqual(['2027-01-30', '2027-02-22', '2027-02-28']);
    expect(warrantyReminderOccurrences('2027-01-01', LONG_AGO).map(({ date }) => date))
      .toEqual(['2026-12-02', '2026-12-25', '2026-12-31']);
  });

  it('skips reminders whose time has passed, including one due exactly now', () => {
    const now = new Date(2027, 5, 8, 10, 0, 0).getTime(); // after the 7-day reminder's 09:00
    expect(warrantyReminderOccurrences('2027-06-15', now).map(({ daysBefore }) => daysBefore)).toEqual([1]);
    const exactly = new Date(2027, 5, 14, 9, 0, 0).getTime();
    expect(warrantyReminderOccurrences('2027-06-15', exactly)).toEqual([]);
    expect(warrantyReminderOccurrences('2020-01-01', Date.now())).toEqual([]);
  });

  it('derives nothing from a coverage end that is not a canonical calendar date', () => {
    for (const value of ['2027-02-29', '2027-06-15T00:00:00.000Z', '15-06-2027', '']) {
      expect(warrantyReminderOccurrences(value, LONG_AGO)).toEqual([]);
    }
  });

  it('schedules with generic copy only: no product, seller, note or document in the request', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(LONG_AGO);
    try {
      await scheduleWarrantyReminder('warranty-1', '2027-06-15');
    } finally {
      jest.restoreAllMocks();
    }

    expect(scheduledCalls()).toHaveLength(3);
    for (const request of scheduledCalls()) {
      expect(request.content.title).toBe('A warranty is expiring soon');
      expect(request.trigger).toEqual({ type: Notifications.SchedulableTriggerInputTypes.DATE, date: expect.any(Date) });
    }
    expect(scheduledCalls().map((request) => request.content.body)).toEqual([
      'It expires in 30 days. Open LifeSort to see which one.',
      'It expires in 7 days. Open LifeSort to see which one.',
      'It expires in 1 day. Open LifeSort to see which one.',
    ]);
    expect(scheduledCalls().map((request) => request.identifier))
      .toEqual(['warranty-warranty-1-30', 'warranty-warranty-1-7', 'warranty-warranty-1-1']);
  });

  it('speaks Danish generically too, with correct plurals', async () => {
    await i18n.changeLanguage('da');
    jest.spyOn(Date, 'now').mockReturnValue(LONG_AGO);
    try {
      await scheduleWarrantyReminder('warranty-1', '2027-06-15');
    } finally {
      jest.restoreAllMocks();
    }
    expect(scheduledCalls()[0].content.title).toBe('En garanti udløber snart');
    expect(scheduledCalls().map((request) => request.content.body)).toEqual([
      'Den udløber om 30 dage. Åbn LifeSort for at se hvilken.',
      'Den udløber om 7 dage. Åbn LifeSort for at se hvilken.',
      'Den udløber om 1 dag. Åbn LifeSort for at se hvilken.',
    ]);
  });

  it('reschedules from the new coverage end, cancelling every earlier reminder first', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(LONG_AGO);
    try {
      await scheduleWarrantyReminder('warranty-1', '2027-06-15');
      mockSchedule.mockClear();
      mockCancel.mockClear();
      await scheduleWarrantyReminder('warranty-1', '2027-12-01');
    } finally {
      jest.restoreAllMocks();
    }

    expect(mockCancel.mock.calls.map(([id]) => id).sort())
      .toEqual(['warranty-warranty-1-1', 'warranty-warranty-1-30', 'warranty-warranty-1-7']);
    // Cancelling happens before anything new is scheduled.
    expect(Math.max(...mockCancel.mock.invocationCallOrder)).toBeLessThan(Math.min(...mockSchedule.mock.invocationCallOrder));
    expect(scheduledCalls().map((request) => (request.trigger.date as Date).toISOString())).toEqual([
      '2027-11-01T08:00:00.000Z',
      '2027-11-24T08:00:00.000Z',
      '2027-11-30T08:00:00.000Z',
    ]);
  });

  it('cancels old reminders and schedules none when the coverage end is not canonical', async () => {
    await scheduleWarrantyReminder('warranty-1', '2027-02-29');
    expect(mockCancel).toHaveBeenCalledTimes(3);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('cancels all three reminders for a warranty', async () => {
    await cancelWarrantyReminder('warranty-1');
    expect(mockCancel.mock.calls.map(([id]) => id).sort())
      .toEqual(['warranty-warranty-1-1', 'warranty-warranty-1-30', 'warranty-warranty-1-7']);
  });
});

describe('APP-057 reminder privacy end to end', () => {
  beforeEach(async () => {
    await useWarrantiesStore.persist.rehydrate();
    useWarrantiesStore.setState({ warranties: [] });
  });

  it('a warranty with product, seller, notes and a receipt schedules reminders that mention none of them', async () => {
    const id = useWarrantiesStore.getState().addWarranty({
      name: 'Hearing aid model X',
      type: 'warranty',
      expiryDate: '2099-06-15',
      notes: 'Paid with the insurance claim',
      purchaseDate: '2098-06-15',
      seller: 'Private clinic',
      receiptDocumentId: RECEIPT,
    });
    expect(id).not.toBeNull();
    // The schedule call is fire-and-forget from the store; let it finish.
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scheduledCalls()).toHaveLength(3);
    const everything = JSON.stringify(scheduledCalls());
    for (const secret of ['Hearing aid', 'Private clinic', 'insurance claim', RECEIPT, 'receipt']) {
      expect(everything).not.toContain(secret);
    }
    // Derived from the coverage end alone.
    expect(scheduledCalls().map((request) => (request.trigger.date as Date).getDate())).toEqual([16, 8, 14]);
  });

  it('changing the coverage end through the store reschedules from the new date', async () => {
    const id = useWarrantiesStore.getState().addWarranty({ name: 'X', type: 'warranty', expiryDate: '2099-06-15' })!;
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    mockSchedule.mockClear();

    expect(useWarrantiesStore.getState().updateWarranty(id, { expiryDate: '2099-12-01' })).toBe(true);
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scheduledCalls().map((request) => {
      const date = request.trigger.date as Date;
      return [date.getMonth() + 1, date.getDate(), date.getHours()];
    })).toEqual([[11, 1, 9], [11, 24, 9], [11, 30, 9]]);
  });
});

describe('APP-057 copy', () => {
  const keysOf = (value: object, prefix = ''): string[] =>
    Object.entries(value).flatMap(([key, child]) =>
      child && typeof child === 'object' ? keysOf(child, `${prefix}${key}.`) : [`${prefix}${key}`]);

  it('has the same warranty keys in Danish and English', () => {
    expect(keysOf(daWarranties).sort()).toEqual(keysOf(enWarranties).sort());
  });

  it('keeps no reminder template that could interpolate a product name', () => {
    for (const locale of [daWarranties, enWarranties] as Record<string, unknown>[]) {
      expect(locale.reminderTitle).toBeUndefined();
      expect(locale.reminderBody).toBeUndefined();
      for (const key of Object.keys(locale).filter((k) => k.startsWith('reminderGeneric'))) {
        expect(String(locale[key])).not.toMatch(/\{\{(?!count\}\})/);
      }
    }
  });

  it('has a message for every date problem in both languages', () => {
    for (const problem of ['invalid-coverage-end', 'invalid-purchase-date', 'purchase-after-coverage-end']) {
      for (const language of ['da', 'en']) {
        const key = `warranties.dateProblems.${problem}`;
        expect(i18n.t(key, { lng: language })).not.toBe(key);
      }
    }
  });
});
