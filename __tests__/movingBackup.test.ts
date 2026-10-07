import { BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';

let mockFileContent = '';
let mockWritten = '';
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///synthetic/backup.json' }] })),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///synthetic/',
  readAsStringAsync: jest.fn(() => Promise.resolve(mockFileContent)),
  writeAsStringAsync: jest.fn((_uri: string, content: string) => { mockWritten = content; return Promise.resolve(); }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

import { useHouseholdStore } from '@/store/useHouseholdStore';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

const file = (version: number, household: Record<string, unknown>) =>
  JSON.stringify({ version, exportedAt: '2026-10-07T00:00:00.000Z', data: { household } });
const ref = (itemId: string, templateVersion = 1) => ({ templateId: 'moving-home', templateVersion, templateItemId: itemId });
const marker = { id: 'moving-home', version: 1 };
const legacyRows = [
  { id: 'default-addressChange', label: 'Adresseændring', checked: true },
  { id: 'default-insurance', label: 'Custom edited', checked: false },
  { id: 'default-foo', label: 'Look-alike', checked: true },
  { id: '22222222-2222-4222-8222-222222222222', label: 'Mine', checked: false },
];
const mappedRows = [
  { ...legacyRows[0], templateRef: ref('addressChange') },
  { ...legacyRows[1], templateRef: ref('insurance') },
  legacyRows[2],
  legacyRows[3],
];
const parsedHousehold = (raw: string) => {
  const result = parseBackupFile(raw);
  return result.ok ? result.data.household : result;
};

describe('APP-062 backup v10', () => {
  it('is format 10', () => expect(BACKUP_VERSION).toBe(10));

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('format %i: keeps id/label/checked, maps only the five seed ids and sets the v1 marker', (version) => {
    expect(parsedHousehold(file(version, { movingItems: legacyRows }))).toEqual({
      movingItems: mappedRows, movingTemplate: marker,
    });
  });

  it('a pre-10 empty list stays empty and still receives the v1 marker', () => {
    expect(parsedHousehold(file(9, { movingItems: [] }))).toEqual({ movingItems: [], movingTemplate: marker });
  });

  it('a pre-10 file never imports a marker it cannot have written', () => {
    expect(parsedHousehold(file(9, { movingItems: [], movingTemplate: { id: 'moving-home', version: 5 } })))
      .toEqual({ movingItems: [], movingTemplate: marker });
  });

  it('a pre-10 file without Moving data leaves Moving alone (partial restore)', () => {
    expect(parsedHousehold(file(9, { shoppingItems: [] }))).toEqual({ shoppingItems: [] });
  });

  it('rejects stored provenance, unknown fields and duplicates in a pre-10 file', () => {
    for (const rows of [
      [{ id: 'a', label: 'x', checked: false, templateRef: ref('internet') }],
      [{ id: 'a', label: 'x', checked: false, address: 'Main St 1' }],
      [{ id: 'a', label: 'x', checked: false }, { id: 'a', label: 'y', checked: false }],
      [{ id: 'a', label: 3, checked: false }],
    ]) expect(parsedHousehold(file(9, { movingItems: rows }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('v10 round-trips provenance, custom rows and the marker', () => {
    const household = { movingItems: mappedRows, movingTemplate: { id: 'moving-home', version: 2 } };
    expect(parsedHousehold(file(10, household))).toEqual(household);
  });

  it('v10 preserves an intentionally empty list and an explicit null marker', () => {
    expect(parsedHousehold(file(10, { movingItems: [], movingTemplate: marker }))).toEqual({ movingItems: [], movingTemplate: marker });
    expect(parsedHousehold(file(10, { movingItems: [], movingTemplate: null }))).toEqual({ movingItems: [], movingTemplate: null });
  });

  it('v10 infers nothing: legacy-looking ids without a stored reference stay custom', () => {
    expect(parsedHousehold(file(10, { movingItems: [legacyRows[0]], movingTemplate: null })))
      .toEqual({ movingItems: [legacyRows[0]], movingTemplate: null });
  });

  it('v10 partial restore: missing fields stay absent so the current values are kept', () => {
    expect(parsedHousehold(file(10, { movingItems: mappedRows }))).toEqual({ movingItems: mappedRows });
    expect(parsedHousehold(file(10, { movingTemplate: marker }))).toEqual({ movingTemplate: marker });
  });

  it.each([
    ['a marker with a zero version', { movingItems: [], movingTemplate: { id: 'moving-home', version: 0 } }],
    ['a marker with an extra field', { movingItems: [], movingTemplate: { ...marker, address: 'x' } }],
    ['a non-object marker', { movingItems: [], movingTemplate: 'v1' }],
    ['provenance with a fractional version', { movingItems: [{ id: 'a', label: 'x', checked: false, templateRef: ref('internet', 1.5) }] }],
    ['provenance with a translated-looking item id', { movingItems: [{ id: 'a', label: 'x', checked: false, templateRef: ref('Change address') }] }],
    ['provenance with a missing field', { movingItems: [{ id: 'a', label: 'x', checked: false, templateRef: { templateId: 'moving-home' } }] }],
    ['an address field on a row', { movingItems: [{ id: 'a', label: 'x', checked: false, address: 'Main St 1' }] }],
  ])('v10 rejects %s', (_label, household) => {
    expect(parsedHousehold(file(10, household))).toEqual({ ok: false, error: 'invalid_format' });
  });
});

describe('APP-062 backup through the real store', () => {
  beforeEach(() => useHouseholdStore.getState().clearLocal());

  it('exports items, provenance and marker, and never the catalogue, tasks sync or UI state', async () => {
    useHouseholdStore.setState({ movingItems: mappedRows, movingTemplate: marker, taskSync: { x: { revision: '1', plannedRevision: '1', updatedAt: '', deletedAt: null } } });
    await exportBackup();
    const exported = JSON.parse(mockWritten);
    expect(exported.version).toBe(10);
    expect(exported.data.household.movingItems).toEqual(mappedRows);
    expect(exported.data.household.movingTemplate).toEqual(marker);
    expect(Object.keys(exported.data.household).sort()).toEqual(['movingItems', 'movingTemplate', 'shoppingItems', 'tasks']);
    expect(mockWritten).not.toContain('taskSync');
    expect(mockWritten).not.toContain('lifesortEditorial');
    expect(mockWritten).not.toContain('reviewDueAt');
  });

  it('round-trips through export and import, including an intentionally empty list', async () => {
    for (const state of [
      { movingItems: mappedRows, movingTemplate: marker },
      { movingItems: [], movingTemplate: marker },
      { movingItems: [], movingTemplate: null },
    ]) {
      useHouseholdStore.setState(state);
      await exportBackup();
      useHouseholdStore.getState().clearLocal();
      mockFileContent = mockWritten;
      expect(await importBackup()).toMatchObject({ success: true });
      expect(useHouseholdStore.getState().movingItems).toEqual(state.movingItems);
      expect(useHouseholdStore.getState().movingTemplate).toEqual(state.movingTemplate);
    }
  });

  it('a partial restore keeps the current marker and list', async () => {
    useHouseholdStore.setState({ movingItems: mappedRows, movingTemplate: marker });
    mockFileContent = file(10, { shoppingItems: [] });
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useHouseholdStore.getState().movingItems).toEqual(mappedRows);
    expect(useHouseholdStore.getState().movingTemplate).toEqual(marker);
  });

  it('an old backup restores with mapped provenance and the v1 marker', async () => {
    mockFileContent = file(8, { tasks: [], shoppingItems: [], movingItems: legacyRows });
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useHouseholdStore.getState().movingItems).toEqual(mappedRows);
    expect(useHouseholdStore.getState().movingTemplate).toEqual(marker);
  });

  it('a malformed Moving backup restores nothing', async () => {
    useHouseholdStore.setState({ movingItems: mappedRows, movingTemplate: marker });
    mockFileContent = file(10, { movingItems: [{ id: 'a', label: 'x', checked: false, templateRef: { templateId: 'x' } }] });
    expect(await importBackup()).toMatchObject({ success: false, error: 'invalid_format' });
    expect(useHouseholdStore.getState().movingItems).toEqual(mappedRows);
  });
});
