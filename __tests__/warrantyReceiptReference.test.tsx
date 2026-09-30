/// <reference types="node" />

import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

/**
 * APP-057 — the warranty's receipt is a reference, read through a narrow boundary.
 *
 * What is proved here: the boundary hands the warranty domain an id, a name and a
 * date and nothing that locates the file; warranties never import the documents
 * store or its sync module; the field says honestly when there is nothing to link,
 * when the read failed, and when a linked document is gone; and the create screen
 * saves the reference, the seller and the purchase date — refusing a purchase
 * after the coverage ends. Documents stays `internal`.
 */

const mockFrom = jest.fn();
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => mockFrom(table),
  },
}));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  // The detail screen puts its edit action in the header; render it so it can be pressed.
  Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => options?.headerRight?.() ?? null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/components/AttachmentList', () => () => null);
jest.mock('@/components/DatePickerField', () => function MockDatePickerField() { return null; });
jest.mock('@/core/storage/documentCacheStorage', () => ({
  documentMetadataEncryptedStorage: require('@react-native-async-storage/async-storage'),
  deleteCachedAttachmentFile: jest.fn(() => Promise.resolve()),
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

import WarrantyDetailScreen from '@/app/warranties/[id]';
import NewWarrantyScreen from '@/app/warranties/new';
import DatePickerField from '@/components/DatePickerField';
import WarrantyReceiptField from '@/components/WarrantyReceiptField';
import { decodeDocumentReferenceRow, fetchDocumentReferences } from '@/core/documents/documentReferences';
import { getModule, moduleAccess } from '@/core/modules/moduleRegistry';
import i18n from '@/localization/i18n';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const OTHER_USER = '9f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const DOC = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_DOC = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const row = (overrides: Record<string, unknown> = {}) => ({
  id: DOC,
  user_id: USER,
  original_name: 'receipt-lamp.pdf',
  created_at: '2026-09-25T09:00:00.000Z',
  ...overrides,
});

/** A select chain that records what it was asked and answers with `result`. */
function documentsQuery(result: unknown) {
  const calls: Record<string, unknown[]> = {};
  const chain = {
    select: (...args: unknown[]) => { calls.select = args; return chain; },
    eq: (...args: unknown[]) => { calls.eq = args; return chain; },
    order: (...args: unknown[]) => { calls.order = args; return Promise.resolve(result); },
  };
  return { chain, calls };
}

/** Answer `documents` reads with `result`; accept any warranty write the screens sync. */
function routeTables(result: unknown) {
  const query = documentsQuery(result);
  mockFrom.mockImplementation((table: string) =>
    table === 'warranties' ? { upsert: () => Promise.resolve({ error: null }) } : query.chain);
  return query;
}

const t = (key: string) => i18n.t(key);
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};

let tree: TestRenderer.ReactTestRenderer;
const render = async (element: React.ReactElement) => {
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(element); });
  await settle();
};
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
function pressButton(label: string) {
  const button = tree.root.findAllByProps({ label })[0];
  const pressable = button.findAllByProps({ accessibilityRole: 'button' }).find((node) => typeof node.props.onPress === 'function');
  act(() => { pressable!.props.onPress(); });
}
const pressOption = (name: string) => act(() => {
  tree.root.findAllByProps({ accessibilityLabel: name }).find((node) => typeof node.props.onPress === 'function')!.props.onPress();
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockGetUser.mockImplementation(() => Promise.resolve({ data: { user: { id: USER } } }));
  await i18n.changeLanguage('en');
});
afterEach(() => { act(() => { tree?.unmount(); }); });

describe('APP-057 document reference boundary', () => {
  it('decodes only id, name and date, whatever else a row carries', () => {
    const decoded = decodeDocumentReferenceRow(row({
      storage_path: `${USER}/${DOC}`,
      signed_url: 'https://storage.example/signed',
      deletion_requested_at: '2026-09-25T09:00:00.000Z',
    }), USER);
    expect(decoded).toEqual({ id: DOC, originalName: 'receipt-lamp.pdf', createdAt: '2026-09-25T09:00:00.000Z' });
    expect(Object.keys(decoded!).sort()).toEqual(['createdAt', 'id', 'originalName']);
  });

  it.each([
    [{ user_id: OTHER_USER }, 'another account'],
    [{ id: 'not-a-uuid' }, 'an id that is not a document id'],
    [{ original_name: '   ' }, 'an unusable name'],
    [{ created_at: 'yesterday' }, 'an unreadable date'],
  ])('drops a row with %o (%s)', (overrides: Record<string, unknown>, _reason: string) => {
    expect(decodeDocumentReferenceRow(row(overrides), USER)).toBeNull();
  });

  it('reads only this account\'s rows, never selects the storage path, and returns them newest first', async () => {
    const query = routeTables({ data: [row(), row({ id: OTHER_DOC, user_id: OTHER_USER })], error: null });

    await expect(fetchDocumentReferences()).resolves.toEqual([
      { id: DOC, originalName: 'receipt-lamp.pdf', createdAt: '2026-09-25T09:00:00.000Z' },
    ]);
    expect(mockFrom).toHaveBeenCalledWith('documents');
    expect(query.calls.select).toEqual(['id, user_id, original_name, created_at']);
    expect(String(query.calls.select[0])).not.toContain('storage_path');
    expect(query.calls.eq).toEqual(['user_id', USER]);
    expect(query.calls.order).toEqual(['created_at', { ascending: false }]);
  });

  it('tells an empty account apart from a failed read', async () => {
    routeTables({ data: [], error: null });
    await expect(fetchDocumentReferences()).resolves.toEqual([]);

    routeTables({ data: null, error: { message: 'relation does not exist' } });
    await expect(fetchDocumentReferences()).resolves.toBeNull();

    mockFrom.mockImplementation(() => { throw new Error('offline'); });
    await expect(fetchDocumentReferences()).resolves.toBeNull();
  });

  it('asks nothing without a session', async () => {
    mockGetUser.mockImplementation(() => Promise.resolve({ data: { user: null } }));
    await expect(fetchDocumentReferences()).resolves.toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('touches no bytes, no Storage and no signed URL', () => {
    const source = read('core/documents/documentReferences.ts');
    for (const forbidden of ['storage_path', 'storagePath', 'storage.from', 'createSignedUrl', 'documentSync', 'useDocumentsStore', 'warrant']) {
      expect(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toContain(forbidden);
    }
  });
});

describe('APP-057 architecture', () => {
  const WARRANTY_FILES = [
    'app/warranties/index.tsx',
    'app/warranties/new.tsx',
    'app/warranties/[id].tsx',
    'app/warranties/view-image.tsx',
    'components/WarrantyReceiptField.tsx',
    'store/useWarrantiesStore.ts',
    'types/warranty.ts',
    'utils/warranty/warrantyDomain.ts',
    'utils/warranty/warrantyReminder.ts',
    'utils/warranty/warrantyTypeIcon.ts',
  ];

  it('no warranty file imports the documents store or the documents sync module', () => {
    for (const file of WARRANTY_FILES) {
      const source = read(file);
      expect(source).not.toMatch(/useDocumentsStore|@\/store\/useDocumentsStore|core\/documents\/documentSync/);
    }
  });

  it('the documents core imports nothing from warranties', () => {
    for (const file of fs.readdirSync(path.join(REPO_ROOT, 'core/documents'))) {
      expect(read(`core/documents/${file}`)).not.toMatch(/from ['"]@\/(store\/useWarrantiesStore|utils\/warranty|app\/warranties|types\/warranty)/);
    }
  });

  it('only the receipt field reads document references, and warranty state holds an id only', () => {
    const readers = WARRANTY_FILES.filter((file) => read(file).includes('core/documents/documentReferences'));
    expect(readers).toEqual(['components/WarrantyReceiptField.tsx']);
    expect(read('types/warranty.ts')).not.toMatch(/storagePath|originalName|signedUrl|DocumentReference/);
    // The store keeps legacy attachment paths (a separate, untouched model); what it
    // must not do is read the documents table or hold a document's name or URL.
    expect(read('store/useWarrantiesStore.ts')).not.toMatch(/from\(['"]documents['"]\)|storage_path|originalName|signedUrl|createSignedUrl/);
  });

  it('Documents stays internal: APP-057 activates nothing', () => {
    expect(getModule('documents').availability).toBe('internal');
    expect(moduleAccess('documents').canOpenModule).toBe(false);
    expect(getModule('warranties').availability).toBe('available');
    // The field never navigates to the Documents module.
    expect(read('components/WarrantyReceiptField.tsx')).not.toMatch(/expo-router|['"`]\/documents/);
  });
});

describe('APP-057 receipt field', () => {
  const references = (result: unknown) => routeTables(result);

  it('says there is nothing to link when the account has no documents', async () => {
    references({ data: [], error: null });
    const onChange = jest.fn();
    await render(<WarrantyReceiptField onChange={onChange} />);

    expect(texts()).toContain(t('warranties.receiptNone'));
    pressButton(t('warranties.receiptChoose'));
    expect(texts()).toContain(t('warranties.receiptEmpty'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never shows a failed read as "no documents", and can retry', async () => {
    references({ data: null, error: { message: 'offline' } });
    await render(<WarrantyReceiptField onChange={jest.fn()} />);
    pressButton(t('warranties.receiptChoose'));
    expect(texts()).toContain(t('warranties.receiptLoadFailed'));
    expect(texts()).not.toContain(t('warranties.receiptEmpty'));

    references({ data: [row()], error: null });
    pressButton(t('warranties.receiptRetry'));
    await settle();
    expect(texts()).toContain('receipt-lamp.pdf');
  });

  it('links a chosen document by id, and can remove the link', async () => {
    references({ data: [row(), row({ id: OTHER_DOC, original_name: 'other.pdf' })], error: null });
    const onChange = jest.fn();
    await render(<WarrantyReceiptField onChange={onChange} />);

    pressButton(t('warranties.receiptChoose'));
    pressOption('other.pdf');
    expect(onChange).toHaveBeenLastCalledWith(OTHER_DOC);

    await render(<WarrantyReceiptField value={OTHER_DOC} onChange={onChange} />);
    expect(texts()).toContain('other.pdf');
    pressButton(t('warranties.receiptRemove'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('says so when a linked document no longer exists', async () => {
    references({ data: [row()], error: null });
    await render(<WarrantyReceiptField value={OTHER_DOC} />);
    expect(texts()).toContain(t('warranties.receiptUnavailable'));
    // Read-only: nothing to change here.
    expect(tree.root.findAllByProps({ label: t('warranties.receiptRemove') })).toEqual([]);
  });

  it('does not claim a document is gone when the list could not be read', async () => {
    references({ data: null, error: { message: 'offline' } });
    await render(<WarrantyReceiptField value={DOC} />);
    expect(texts()).toContain(t('warranties.receiptLinked'));
    expect(texts()).not.toContain(t('warranties.receiptUnavailable'));
  });

  it('asks nothing when shown read-only with no link', async () => {
    await render(<WarrantyReceiptField />);
    expect(texts()).toContain(t('warranties.receiptNone'));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('shows no path, account id or URL', async () => {
    references({ data: [row({ storage_path: `${USER}/${DOC}` })], error: null });
    await render(<WarrantyReceiptField value={DOC} onChange={jest.fn()} />);
    pressButton(t('warranties.receiptChange'));
    const shown = texts().join('\n');
    for (const secret of [USER, DOC, `${USER}/${DOC}`, 'https://']) expect(shown).not.toContain(secret);
  });
});

describe('APP-057 create screen', () => {
  beforeEach(async () => {
    await useWarrantiesStore.persist.rehydrate();
    useWarrantiesStore.setState({ warranties: [] });
    routeTables({ data: [row()], error: null });
  });

  const datePickers = () => tree.root.findAllByType(DatePickerField);
  const saveButton = () => tree.root.findAllByProps({ label: t('warranties.save') })[0];

  it('saves product, seller, purchase date, coverage end and the receipt reference', async () => {
    await render(<NewWarrantyScreen />);
    act(() => { tree.root.findAllByProps({ placeholder: t('warranties.namePlaceholder') })[0].props.onChangeText('Synthetic lamp'); });
    act(() => { tree.root.findAllByProps({ placeholder: t('warranties.sellerPlaceholder') })[0].props.onChangeText(' Synthetic shop '); });
    // The purchase-date picker is the only one on screen until a custom coverage end is chosen.
    act(() => { datePickers()[0].props.onChange('2026-05-01'); });
    pressButton(t('warranties.receiptChoose'));
    pressOption('receipt-lamp.pdf');

    pressButton(t('warranties.save'));

    const [saved] = useWarrantiesStore.getState().warranties;
    expect(saved).toMatchObject({
      name: 'Synthetic lamp',
      seller: 'Synthetic shop',
      purchaseDate: '2026-05-01',
      receiptDocumentId: DOC,
      expiryDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(Object.keys(saved)).not.toContain('receiptName');
  });

  it('refuses a purchase date after the coverage ends, and says why', async () => {
    await render(<NewWarrantyScreen />);
    act(() => { tree.root.findAllByProps({ placeholder: t('warranties.namePlaceholder') })[0].props.onChangeText('Lamp'); });
    act(() => { datePickers()[0].props.onChange('2099-01-01'); });

    expect(texts()).toContain(t('warranties.dateProblems.purchase-after-coverage-end'));
    expect(saveButton().props.disabled).toBe(true);
    pressButton(t('warranties.save'));
    expect(useWarrantiesStore.getState().warranties).toEqual([]);
  });

  it('keeps a warranty without the optional facts as it always was', async () => {
    await render(<NewWarrantyScreen />);
    act(() => { tree.root.findAllByProps({ placeholder: t('warranties.namePlaceholder') })[0].props.onChangeText('Plain'); });
    pressButton(t('warranties.save'));

    const [saved] = useWarrantiesStore.getState().warranties;
    expect(saved.name).toBe('Plain');
    expect([saved.purchaseDate, saved.seller, saved.receiptDocumentId]).toEqual([undefined, undefined, undefined]);
  });
});

describe('APP-057 detail and edit screen', () => {
  const LEGACY = {
    id: '1693000000000-abc',
    name: 'Legacy laptop',
    type: 'warranty' as const,
    expiryDate: '2099-01-31',
    attachments: [],
    createdAt: '2026-01-02T03:04:05.000Z',
  };
  const datePickers = () => tree.root.findAllByType(DatePickerField);
  const openEdit = () => act(() => {
    tree.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
      && node.findAllByType(Text).some((text) => text.props.children === t('warranties.edit')))[0].props.onPress();
  });

  beforeEach(async () => {
    mockParams = { id: LEGACY.id };
    await useWarrantiesStore.persist.rehydrate();
    routeTables({ data: [row()], error: null });
  });
  afterAll(() => { mockParams = {}; });

  it('shows a legacy warranty honestly: nothing invented, nothing fetched', async () => {
    useWarrantiesStore.setState({ warranties: [LEGACY] });
    await render(<WarrantyDetailScreen />);

    expect(texts().filter((text) => text === t('warranties.notSet'))).toHaveLength(2);
    expect(texts()).toContain(t('warranties.receiptNone'));
    expect(texts()).toContain(`${t('warranties.expiryLabel')}: 2099-01-31`);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('shows the seller, purchase date and linked receipt by its name', async () => {
    useWarrantiesStore.setState({ warranties: [{ ...LEGACY, seller: 'Synthetic shop', purchaseDate: '2098-01-31', receiptDocumentId: DOC }] });
    await render(<WarrantyDetailScreen />);
    expect(texts()).toEqual(expect.arrayContaining(['Synthetic shop', '2098-01-31', 'receipt-lamp.pdf']));
  });

  it('edits the new facts, refuses a purchase after the coverage ends, and clears the link', async () => {
    useWarrantiesStore.setState({ warranties: [{ ...LEGACY, receiptDocumentId: DOC }] });
    await render(<WarrantyDetailScreen />);
    openEdit();
    await settle();

    // Purchase date, then coverage end, in the edit form.
    act(() => { datePickers()[0].props.onChange('2099-02-01'); });
    expect(texts()).toContain(t('warranties.dateProblems.purchase-after-coverage-end'));
    expect(tree.root.findAllByProps({ label: t('warranties.save') })[0].props.disabled).toBe(true);

    act(() => { datePickers()[0].props.onChange('2098-12-24'); });
    act(() => { tree.root.findAllByProps({ placeholder: t('warranties.sellerPlaceholder') })[0].props.onChangeText('Shop'); });
    pressButton(t('warranties.receiptRemove'));
    pressButton(t('warranties.save'));

    const [saved] = useWarrantiesStore.getState().warranties;
    expect(saved).toMatchObject({ name: 'Legacy laptop', expiryDate: '2099-01-31', purchaseDate: '2098-12-24', seller: 'Shop' });
    expect(saved.receiptDocumentId).toBeUndefined();
  });
});
