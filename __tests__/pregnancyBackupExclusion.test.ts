import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * APP-076 Phase A — Pregnancy (Profile B special-category health data) stays OUT of the plaintext portable backup,
 * on both sides: an export never mentions it, and a crafted archive cannot hydrate it. Protected portability is
 * APP-097. Same synthetic mocks as cycleBackupExclusion.test.ts.
 */
let mockFileContent = '';
let mockWritten = '';
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///synthetic/backup.json' }] })),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///synthetic/',
  cacheDirectory: 'file:///cache/',
  readAsStringAsync: jest.fn(() => Promise.resolve(mockFileContent)),
  writeAsStringAsync: jest.fn((_uri: string, content: string) => { mockWritten = content; return Promise.resolve(); }),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false, isDirectory: false, size: 0 })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-file-system', () => ({ File: class { bytes() { return Promise.reject(new Error('missing')); } } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(() => Promise.resolve(false)), shareAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })), getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })) }, from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));

import { BACKUP_PARTICIPANTS } from '@/features/backupParticipants';
import { parseBackupFile } from '@/utils/shared/backupValidation';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const NOTE = 'injected-pregnancy-note-9d41';

beforeEach(async () => {
  mockWritten = '';
  mockFileContent = '';
  await AsyncStorage.clear();
});

describe('APP-076 Pregnancy and the plaintext archive', () => {
  it('an export never mentions Pregnancy', async () => {
    await exportBackup(BACKUP_PARTICIPANTS);
    expect(mockWritten).not.toMatch(/pregnan/i);
  });

  it('a crafted archive cannot hydrate Pregnancy: the parser drops it and the import writes no Pregnancy key or value', async () => {
    await exportBackup(BACKUP_PARTICIPANTS);
    const archive = JSON.parse(mockWritten);
    const loot = { id: 'inj-preg-1', method: 'lmp', lmpDate: '2099-01-01', outcomeNotes: NOTE };
    archive.data.pregnancy = { pregnancies: [loot] };
    archive.data.pregnancies = [loot];
    archive.data['lifesort-pregnancy'] = { state: { pregnancies: [loot] }, version: 0 };
    archive.data.settings = { language: 'da', pregnancies: [loot] };
    mockFileContent = JSON.stringify(archive);

    const parsed = parseBackupFile(mockFileContent);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(JSON.stringify(parsed.data)).not.toContain(NOTE);

    expect(await importBackup(BACKUP_PARTICIPANTS)).toMatchObject({ success: true });
    await settle();
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((key) => /pregnan/i.test(key))).toEqual([]);
    const everything = (await AsyncStorage.multiGet(keys)).map(([key, value]) => `${key}=${value}`).join('\n');
    expect(everything).not.toContain(NOTE);
    expect(everything).not.toContain('2099-01-01');
  });
});
