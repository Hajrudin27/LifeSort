import fs from 'fs';
import path from 'path';

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * APP-072 - Cycle (Profile B special-category health data) stays OUT of the plaintext portable
 * backup. "Backup test" for this story means exclusion: the archive is an unencrypted JSON file the
 * user shares, so it can never carry health data. An encrypted portable health backup, loss
 * messaging and protected export are APP-097's (see ADR-0023, docs/data-sdk-inventory.md D7).
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
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })), getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })) }, from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: null }) },
}));

import { BACKUP_PARTICIPANTS } from '@/features/backupParticipants';
import { useCycleStore } from '@/store/useCycleStore';
import { BACKUP_FIELD_SCHEMA, BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

const REPO_ROOT = path.resolve(__dirname, '..');
const source = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

const SENTINEL_DATE = '2031-03-17';
const SENTINEL_END = '2031-03-22';
const SENTINEL_NOTE = 'sentinel-health-note-7f3a9c';
const SENTINEL_ID = 'cycle-sentinel-id-5d21';
const HEALTH_WORDS = /cycle|symptom|pregnan|fertil|menstru|ovulat/i;

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const resetCycle = () =>
  useCycleStore.setState({ cycles: [], symptomLogs: [], avgCycleLength: 28, lutealPhaseLength: 14, reminderEnabled: false, reminderDaysBefore: 1 });
const populateCycle = () =>
  useCycleStore.setState({
    cycles: [{ id: SENTINEL_ID, startDate: SENTINEL_DATE, endDate: SENTINEL_END, createdAt: '2031-03-17T08:00:00.000Z' }],
    symptomLogs: [{ id: 'log-sentinel', date: SENTINEL_DATE, symptoms: ['cramps'], flow: 'heavy', notes: SENTINEL_NOTE }],
    avgCycleLength: 37,
    lutealPhaseLength: 11,
    reminderEnabled: true,
    reminderDaysBefore: 6,
  });

beforeEach(async () => {
  jest.clearAllMocks();
  mockWritten = '';
  mockFileContent = '';
  await AsyncStorage.clear();
  resetCycle();
});

describe('APP-072 export exclusion', () => {
  it('writes no Cycle section and none of the Cycle sentinels through the real export path', async () => {
    populateCycle();

    await exportBackup(BACKUP_PARTICIPANTS);

    const exported = JSON.parse(mockWritten);
    expect(exported.version).toBe(BACKUP_VERSION);
    expect(Object.keys(exported.data).filter((key) => HEALTH_WORDS.test(key))).toEqual([]);
    for (const secret of [SENTINEL_DATE, SENTINEL_END, SENTINEL_NOTE, SENTINEL_ID, 'log-sentinel', 'cramps', 'heavy', 'symptomLogs', 'avgCycleLength', 'lutealPhaseLength', 'reminderDaysBefore']) {
      expect(mockWritten).not.toContain(secret);
    }
  });

  it('is identical with and without Cycle data (it cannot depend on it)', async () => {
    await exportBackup(BACKUP_PARTICIPANTS);
    const empty = JSON.parse(mockWritten);
    populateCycle();
    await exportBackup(BACKUP_PARTICIPANTS);
    const populated = JSON.parse(mockWritten);

    delete empty.exportedAt;
    delete populated.exportedAt;
    expect(populated).toEqual(empty);
  });
});

describe('APP-072 import exclusion', () => {
  const injected = async () => {
    await exportBackup(BACKUP_PARTICIPANTS);
    const base = JSON.parse(mockWritten);
    base.data.cycle = {
      cycles: [{ id: 'injected-cycle', startDate: '2099-01-01', createdAt: '2099-01-01T00:00:00.000Z' }],
      symptomLogs: [{ id: 'injected-log', date: '2099-01-01', symptoms: ['nausea'], notes: 'injected-note-zz' }],
      avgCycleLength: 99,
    };
    base.data.cycles = base.data.cycle.cycles;
    base.data.symptomLogs = base.data.cycle.symptomLogs;
    // The same payload smuggled into stores the archive does know.
    base.data.settings = { language: 'da', cycles: base.data.cycle.cycles, symptomLogs: base.data.cycle.symptomLogs };
    base.data.todos = { todos: [], cycles: base.data.cycle.cycles, avgCycleLength: 99 };
    return JSON.stringify(base);
  };

  it('the parser drops an injected Cycle payload before anything can use it', async () => {
    const parsed = parseBackupFile(await injected());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(Object.keys(parsed.data).filter((key) => HEALTH_WORDS.test(key))).toEqual([]);
      expect(JSON.stringify(parsed.data)).not.toContain('injected-');
    }
  });

  it('leaves the existing Cycle state untouched and copies the payload into no other store', async () => {
    mockFileContent = await injected();
    populateCycle();
    const before = JSON.stringify({
      cycles: useCycleStore.getState().cycles,
      symptomLogs: useCycleStore.getState().symptomLogs,
      avgCycleLength: useCycleStore.getState().avgCycleLength,
      lutealPhaseLength: useCycleStore.getState().lutealPhaseLength,
      reminderEnabled: useCycleStore.getState().reminderEnabled,
      reminderDaysBefore: useCycleStore.getState().reminderDaysBefore,
    });

    const result = await importBackup(BACKUP_PARTICIPANTS);
    await settle();

    expect(result).toMatchObject({ success: true });
    expect(result?.restoredKeys.filter((key) => HEALTH_WORDS.test(key))).toEqual([]);
    const after = JSON.stringify({
      cycles: useCycleStore.getState().cycles,
      symptomLogs: useCycleStore.getState().symptomLogs,
      avgCycleLength: useCycleStore.getState().avgCycleLength,
      lutealPhaseLength: useCycleStore.getState().lutealPhaseLength,
      reminderEnabled: useCycleStore.getState().reminderEnabled,
      reminderDaysBefore: useCycleStore.getState().reminderDaysBefore,
    });
    expect(after).toBe(before);

    // Nothing the import wrote to any persisted store carries the injected values.
    const everything = (await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).map(([key, value]) => `${key}=${value}`).join('\n');
    expect(everything).not.toContain('injected-');
    expect(everything).not.toContain('2099-01-01');
  });

  it('leaves a clean Cycle store clean', async () => {
    mockFileContent = await injected();
    await importBackup(BACKUP_PARTICIPANTS);
    expect(useCycleStore.getState().cycles).toEqual([]);
    expect(useCycleStore.getState().symptomLogs).toEqual([]);
    expect(useCycleStore.getState().avgCycleLength).toBe(28);
  });
});

describe('APP-072 structural guard: Cycle cannot casually join the plaintext archive', () => {
  it('registers no health key or field in the validated backup schema', () => {
    const offending: string[] = [];
    for (const [storeKey, fields] of Object.entries(BACKUP_FIELD_SCHEMA)) {
      if (HEALTH_WORDS.test(storeKey)) offending.push(storeKey);
      for (const field of Object.keys(fields)) if (HEALTH_WORDS.test(field)) offending.push(`${storeKey}.${field}`);
    }
    expect(offending).toEqual([]);
  });

  it('does not import or register the Cycle store in utils/shared/dataBackup.ts', () => {
    const text = source('utils/shared/dataBackup.ts');
    expect(text).not.toMatch(/useCycleStore/);
    expect(text).not.toMatch(/store\/useCycleStore/);
    expect(text).not.toMatch(/^\s*(cycle|cycles|cycleSettings|symptomLogs|pregnancy)\s*:/m);
    expect(text).not.toMatch(/key === ['"]cycle/);
  });

  it('keeps Cycle out of the backup participants', () => {
    expect(BACKUP_PARTICIPANTS.map((participant) => participant.key).filter((key) => HEALTH_WORDS.test(key))).toEqual([]);
    expect(source('features/backupParticipants.ts')).not.toMatch(/useCycleStore/);
  });

  it('does not let the validator itself read the Cycle store or name Cycle fields', () => {
    const text = source('utils/shared/backupValidation.ts');
    expect(text).not.toMatch(/useCycleStore/);
    expect(text).not.toMatch(/\b(symptomLogs|symptom_logs|cycle_settings|avgCycleLength)\b/);
  });
});
