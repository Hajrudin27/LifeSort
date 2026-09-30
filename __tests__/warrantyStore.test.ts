import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * APP-057 — the warranty record on its way to and from the server, and on disk.
 *
 * The column names stay (`name` is the product, `expiry_date` the coverage end);
 * three nullable facts are added; old rows and old encrypted payloads have none of
 * them and nothing is invented for them. A receipt reference to a document the
 * database no longer knows is dropped — only it, and only locally after the server
 * said so — so the rest of an edit is not lost with it.
 *
 * The encrypted adapter is the real APP-029 one: legacy hydration is proved
 * through the same bytes-on-disk path a device takes.
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

const mockUpsert = jest.fn();
const mockSelect = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11' } } })),
    },
    from: jest.fn((table: string) => ({
      upsert: (row: unknown) => mockUpsert(table, row),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      select: (columns: string) => ({ eq: (column: string, value: string) => mockSelect(table, columns, column, value) }),
    })),
  },
}));
jest.mock('@/utils/shared/attachmentSync', () => ({
  uploadAttachment: jest.fn(() => Promise.resolve(null)),
  deleteAttachmentRemote: jest.fn(() => Promise.resolve()),
  fetchAttachmentsFor: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@/utils/warranty/warrantyReminder', () => ({
  scheduleWarrantyReminder: jest.fn(() => Promise.resolve()),
  cancelWarrantyReminder: jest.fn(() => Promise.resolve()),
}));

import { documentMetadataEncryptedStorage } from '@/core/storage/documentCacheStorage';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import { Warranty } from '@/types/warranty';
import { scheduleWarrantyReminder } from '@/utils/warranty/warrantyReminder';

const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const RECEIPT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_RECEIPT = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const KEY = 'lifesort-warranties';

const mockSchedule = scheduleWarrantyReminder as jest.Mock;
const STALE_REFERENCE = {
  code: '23503',
  message: 'insert or update on table "warranties" violates foreign key constraint "warranties_receipt_document_fkey"',
};

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const upsertedRows = () => mockUpsert.mock.calls.filter(([table]) => table === 'warranties').map(([, row]) => row);
const state = () => useWarrantiesStore.getState();
const find = (id: string) => state().warranties.find((w) => w.id === id);

function legacyWarranty(overrides: Partial<Warranty> = {}): Warranty {
  return {
    id: '1693000000000-abc',
    name: 'Legacy laptop',
    type: 'warranty',
    expiryDate: '2027-01-31',
    notes: 'kept in drawer',
    attachments: [],
    createdAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

let consoleSpies: jest.SpyInstance[] = [];

beforeEach(async () => {
  jest.clearAllMocks();
  mockUpsert.mockImplementation(() => Promise.resolve({ error: null }));
  mockSelect.mockImplementation(() => Promise.resolve({ data: [], error: null }));
  await AsyncStorage.clear();
  await useWarrantiesStore.persist.rehydrate();
  useWarrantiesStore.setState({ warranties: [] });
  await settle();
  jest.clearAllMocks();
  mockUpsert.mockImplementation(() => Promise.resolve({ error: null }));
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => jest.spyOn(console, method));
});

afterEach(() => {
  // Nothing in these flows logs — not a product, a seller, a note or a document id.
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

describe('APP-057 create and update', () => {
  it('sends the new facts under their columns, keeping name and expiry_date as they were', async () => {
    const id = state().addWarranty({
      name: 'Synthetic lamp',
      type: 'warranty',
      expiryDate: '2028-06-01',
      notes: 'note',
      purchaseDate: '2026-06-01',
      seller: '  Synthetic shop  ',
      receiptDocumentId: RECEIPT,
    });
    await settle();

    expect(id).toEqual(expect.any(String));
    expect(upsertedRows()).toEqual([{
      id,
      user_id: USER,
      name: 'Synthetic lamp',
      type: 'warranty',
      expiry_date: '2028-06-01',
      notes: 'note',
      purchase_date: '2026-06-01',
      seller: 'Synthetic shop',
      receipt_document_id: RECEIPT,
      created_at: expect.any(String),
    }]);
    expect(find(id!)).toMatchObject({ purchaseDate: '2026-06-01', seller: 'Synthetic shop', receiptDocumentId: RECEIPT });
    // Reminders are asked for with the id and the coverage end — nothing else.
    expect(mockSchedule.mock.calls).toEqual([[id, '2028-06-01']]);
  });

  it('sends null for facts that were not recorded, and invents none', async () => {
    const id = state().addWarranty({ name: 'Plain', type: 'receipt', expiryDate: '2028-06-01', seller: '   ' });
    await settle();

    const [row] = upsertedRows();
    expect(row).toMatchObject({ purchase_date: null, seller: null, receipt_document_id: null, notes: null });
    expect(find(id!)!.purchaseDate).toBeUndefined();
    expect(find(id!)!.seller).toBeUndefined();
    expect(find(id!)!.receiptDocumentId).toBeUndefined();
  });

  it.each([
    [{ expiryDate: '2027-02-29' }, 'impossible coverage end'],
    [{ expiryDate: '2028-06-01T00:00:00.000Z' }, 'timestamp as coverage end'],
    [{ purchaseDate: '2027-6-1' }, 'unpadded purchase date'],
    [{ purchaseDate: '2028-06-02' }, 'purchase after coverage end'],
    [{ receiptDocumentId: 'receipt.pdf' }, 'a filename as reference'],
    [{ receiptDocumentId: `${USER}/${RECEIPT}` }, 'a storage path as reference'],
  ])('refuses %o (%s): nothing stored, synced or scheduled', async (bad: Partial<Warranty>, _reason: string) => {
    const id = state().addWarranty({ name: 'X', type: 'warranty', expiryDate: '2028-06-01', ...bad });
    await settle();
    expect(id).toBeNull();
    expect(state().warranties).toEqual([]);
    expect(upsertedRows()).toEqual([]);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('accepts a purchase on the coverage end day and on a leap day', () => {
    expect(state().addWarranty({ name: 'A', type: 'warranty', expiryDate: '2028-06-01', purchaseDate: '2028-06-01' })).not.toBeNull();
    expect(state().addWarranty({ name: 'B', type: 'warranty', expiryDate: '2028-02-29', purchaseDate: '2028-02-29' })).not.toBeNull();
  });

  it('updates, links and clears the new facts; a rule-breaking update changes nothing', async () => {
    useWarrantiesStore.setState({ warranties: [legacyWarranty()] });

    expect(state().updateWarranty('1693000000000-abc', {
      purchaseDate: '2026-01-15', seller: 'Shop', receiptDocumentId: RECEIPT,
    })).toBe(true);
    expect(find('1693000000000-abc')).toMatchObject({
      name: 'Legacy laptop', expiryDate: '2027-01-31', purchaseDate: '2026-01-15', seller: 'Shop', receiptDocumentId: RECEIPT,
    });

    const before = find('1693000000000-abc');
    expect(state().updateWarranty('1693000000000-abc', { expiryDate: '2026-01-14' })).toBe(false);
    expect(state().updateWarranty('1693000000000-abc', { purchaseDate: '2027-02-29' })).toBe(false);
    expect(state().updateWarranty('1693000000000-abc', { receiptDocumentId: 'not-a-document' })).toBe(false);
    expect(state().updateWarranty('missing', { notes: 'x' })).toBe(false);
    expect(find('1693000000000-abc')).toBe(before);

    expect(state().updateWarranty('1693000000000-abc', {
      purchaseDate: undefined, seller: undefined, receiptDocumentId: undefined,
    })).toBe(true);
    await settle();
    expect(find('1693000000000-abc')!.receiptDocumentId).toBeUndefined();
    expect(upsertedRows().at(-1)).toMatchObject({
      name: 'Legacy laptop', expiry_date: '2027-01-31', purchase_date: null, seller: null, receipt_document_id: null,
    });
  });

  it('keeps a legacy record without the new fields editable, and sends them as null', async () => {
    useWarrantiesStore.setState({ warranties: [legacyWarranty()] });
    expect(state().updateWarranty('1693000000000-abc', { notes: 'moved to shelf' })).toBe(true);
    await settle();

    expect(Object.keys(find('1693000000000-abc')!).filter((key) => ['purchaseDate', 'receiptDocumentId'].includes(key)))
      .toEqual([]);
    expect(upsertedRows()).toEqual([{
      id: '1693000000000-abc',
      user_id: USER,
      name: 'Legacy laptop',
      type: 'warranty',
      expiry_date: '2027-01-31',
      notes: 'moved to shelf',
      purchase_date: null,
      seller: null,
      receipt_document_id: null,
      created_at: '2026-01-02T03:04:05.000Z',
    }]);
  });

  it('renewing moves the coverage end a year and reschedules from it, keeping the purchase date', async () => {
    useWarrantiesStore.setState({ warranties: [legacyWarranty({ purchaseDate: '2026-01-15' })] });
    expect(state().renewWarranty('1693000000000-abc')).toBe('2028-01-31');
    await settle();
    expect(find('1693000000000-abc')).toMatchObject({ expiryDate: '2028-01-31', purchaseDate: '2026-01-15' });
    expect(mockSchedule.mock.calls).toEqual([['1693000000000-abc', '2028-01-31']]);
  });
});

describe('APP-057 a receipt reference the database no longer knows', () => {
  it('drops only that reference, locally, and sends the rest of the edit again', async () => {
    useWarrantiesStore.setState({ warranties: [legacyWarranty({ receiptDocumentId: RECEIPT })] });
    mockUpsert
      .mockImplementationOnce(() => Promise.resolve({ error: STALE_REFERENCE }))
      .mockImplementation(() => Promise.resolve({ error: null }));

    expect(state().updateWarranty('1693000000000-abc', { notes: 'edited while the receipt was deleted elsewhere' })).toBe(true);
    await settle();

    expect(upsertedRows()).toHaveLength(2);
    expect(upsertedRows()[0]).toMatchObject({ receipt_document_id: RECEIPT, notes: 'edited while the receipt was deleted elsewhere' });
    expect(upsertedRows()[1]).toMatchObject({ receipt_document_id: null, notes: 'edited while the receipt was deleted elsewhere' });
    expect(find('1693000000000-abc')!.receiptDocumentId).toBeUndefined();
    expect(find('1693000000000-abc')!.notes).toBe('edited while the receipt was deleted elsewhere');
  });

  it('does not drop a reference the user changed in the meantime', async () => {
    useWarrantiesStore.setState({ warranties: [legacyWarranty({ receiptDocumentId: RECEIPT })] });
    let answer!: (value: unknown) => void;
    mockUpsert.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));

    state().updateWarranty('1693000000000-abc', { notes: 'first' });
    await settle();
    // Before the stale answer arrives, the user links a different document.
    state().updateWarranty('1693000000000-abc', { receiptDocumentId: OTHER_RECEIPT });
    answer({ error: STALE_REFERENCE });
    await settle();

    expect(find('1693000000000-abc')!.receiptDocumentId).toBe(OTHER_RECEIPT);
    // The stale answer triggers no resend with a cleared reference over the new one.
    expect(upsertedRows().filter((row) => (row as { receipt_document_id: unknown }).receipt_document_id === null)).toEqual([]);
  });

  it.each([
    [{ code: '23503', message: 'violates foreign key constraint "warranties_user_id_fkey"' }, 'another foreign key'],
    [{ code: '23514', message: 'violates check constraint "warranties_purchase_not_after_coverage_end"' }, 'a check'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'an auth failure'],
    [{ message: 'Network request failed' }, 'a network failure'],
  ])('keeps the reference on any other failure (%o, %s)', async (error: { code?: string; message: string }, _reason: string) => {
    useWarrantiesStore.setState({ warranties: [legacyWarranty({ receiptDocumentId: RECEIPT })] });
    mockUpsert.mockImplementation(() => Promise.resolve({ error }));

    state().updateWarranty('1693000000000-abc', { notes: 'x' });
    await settle();

    expect(find('1693000000000-abc')!.receiptDocumentId).toBe(RECEIPT);
    expect(upsertedRows()).toHaveLength(1);
  });
});

describe('APP-057 fetch', () => {
  it('asks for the new columns and maps them; null stays absent and nothing is invented', async () => {
    mockSelect.mockImplementation(() => Promise.resolve({
      error: null,
      data: [
        {
          id: 'new-full', name: 'Phone', type: 'warranty', expiry_date: '2028-06-01', notes: null,
          purchase_date: '2026-06-01', seller: 'Shop', receipt_document_id: RECEIPT, created_at: '2026-06-01T10:00:00+00:00',
        },
        {
          id: 'new-legacy', name: 'Old row', type: 'insurance', expiry_date: '2027-01-01', notes: 'n',
          purchase_date: null, seller: null, receipt_document_id: null, created_at: '2025-01-01T10:00:00+00:00',
        },
      ],
    }));

    await state().fetchFromSupabase();
    await settle();

    expect(mockSelect).toHaveBeenCalledWith('warranties',
      'id, name, type, expiry_date, notes, purchase_date, seller, receipt_document_id, created_at', 'user_id', USER);
    expect(find('new-full')).toEqual({
      id: 'new-full', name: 'Phone', type: 'warranty', expiryDate: '2028-06-01', notes: undefined,
      purchaseDate: '2026-06-01', seller: 'Shop', receiptDocumentId: RECEIPT,
      attachments: [], createdAt: '2026-06-01T10:00:00+00:00',
    });
    const legacy = find('new-legacy')!;
    expect(legacy).toMatchObject({ name: 'Old row', expiryDate: '2027-01-01', notes: 'n' });
    expect([legacy.purchaseDate, legacy.seller, legacy.receiptDocumentId]).toEqual([undefined, undefined, undefined]);
    // Reminders come from the coverage end alone.
    expect(mockSchedule.mock.calls).toEqual([['new-full', '2028-06-01'], ['new-legacy', '2027-01-01']]);
  });

  it('still only appends unknown rows — the existing merge semantics are unchanged', async () => {
    useWarrantiesStore.setState({ warranties: [legacyWarranty()] });
    mockSelect.mockImplementation(() => Promise.resolve({
      error: null,
      data: [{
        id: '1693000000000-abc', name: 'Changed elsewhere', type: 'warranty', expiry_date: '2029-01-01', notes: null,
        purchase_date: '2026-01-01', seller: 'Elsewhere', receipt_document_id: RECEIPT, created_at: '2026-01-02T03:04:05.000Z',
      }],
    }));

    await state().fetchFromSupabase();
    await settle();

    // APP-057 does not redesign warranty sync: a known id keeps its local values.
    expect(find('1693000000000-abc')).toEqual(legacyWarranty());
  });
});

describe('APP-057 local persistence', () => {
  it('hydrates an encrypted v0 payload written before APP-057, with the new fields absent', async () => {
    const before057 = JSON.stringify({ state: { warranties: [legacyWarranty()] }, version: 0 });
    await documentMetadataEncryptedStorage.setItem(KEY, before057);
    expect(await AsyncStorage.getItem(KEY)).not.toContain('Legacy laptop');

    await useWarrantiesStore.persist.rehydrate();

    expect(state().warranties).toEqual([legacyWarranty()]);
    expect(find('1693000000000-abc')!.purchaseDate).toBeUndefined();
    expect(find('1693000000000-abc')!.receiptDocumentId).toBeUndefined();
  });

  it('writes the new fields inside the same encrypted v0 envelope and reads them back', async () => {
    state().addWarranty({
      name: 'Encrypted lamp', type: 'warranty', expiryDate: '2028-06-01',
      purchaseDate: '2026-06-01', seller: 'Private seller', receiptDocumentId: RECEIPT,
    });
    await settle();

    const raw = (await AsyncStorage.getItem(KEY))!;
    for (const plaintext of ['Encrypted lamp', 'Private seller', RECEIPT, '2026-06-01']) {
      expect(raw).not.toContain(plaintext);
    }
    const decrypted = JSON.parse((await documentMetadataEncryptedStorage.getItem(KEY))!);
    expect(decrypted.version).toBe(0);
    expect(decrypted.state.warranties[0]).toMatchObject({
      purchaseDate: '2026-06-01', seller: 'Private seller', receiptDocumentId: RECEIPT,
    });
    // An id, and nothing that would locate or name the document.
    expect(JSON.stringify(decrypted)).not.toMatch(/storagePath|storage_path|signed|originalName|https?:/);
  });
});
