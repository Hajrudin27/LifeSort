import AsyncStorage from '@react-native-async-storage/async-storage';

import { BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';

/**
 * APP-067 backup format 13: Career applications (they hold private notes) and the CV (it holds
 * phone, email and address) are Profile B and never enter a plaintext archive. Older files may
 * still be restored, but only through the canonical decoder, and they land in encrypted storage.
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
  supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) }, from: jest.fn(), rpc: jest.fn() },
}));

import { useCareerStore } from '@/store/useCareerStore';
import { useCVStore } from '@/store/useCVStore';
import { openableLink } from '@/features/career/domain/application';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

const NOTE = 'private backup note sentinel';
const COMPANY = 'Backup Sentinel Employer';
const PHONE = '+45 55 44 33 22';
const row = (patch: Record<string, unknown> = {}) => ({
  id: 'app-1', company: COMPANY, position: 'Engineer', status: 'interview', appliedDate: '2026-09-01',
  link: 'https://example.com/job', notes: NOTE, createdAt: '2026-09-01T08:00:00.000Z', ...patch,
});
const file = (version: number, data: Record<string, unknown>) =>
  JSON.stringify({ version, exportedAt: '2026-10-09T00:00:00.000Z', data });
const career = (version: number, applications: unknown, extra: Record<string, unknown> = {}) =>
  file(version, { career: { applications, ...extra } });
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const resetStores = () => {
  useCareerStore.setState({ applications: [], skills: [] });
  useCVStore.setState({ personalInfo: {} as never, education: [], experience: [], languages: [], versions: [] });
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockWritten = '';
  await AsyncStorage.clear();
  await Promise.all([useCareerStore.persist.rehydrate(), useCVStore.persist.rehydrate()]);
  resetStores();
});

describe('format', () => {
  it('is 13', () => expect(BACKUP_VERSION).toBe(13));
  it('refuses a newer format', () => {
    expect(parseBackupFile(career(14, []))).toEqual({ ok: false, error: 'unsupported_version' });
  });
});

describe('a new export', () => {
  it('carries skills but never an application, a note, a company or any CV content', async () => {
    useCareerStore.getState().addApplication({ company: COMPANY, position: 'Engineer', status: 'offer', appliedDate: '2026-09-01', notes: NOTE, link: 'https://example.com/job' });
    useCareerStore.getState().addSkill({ name: 'Excel', category: 'technical', level: 'expert' });
    useCVStore.setState({ personalInfo: { fullName: 'Sentinel Person', phone: PHONE, email: 'sentinel@example.org', location: 'Sentinelvej 1' } as never });

    await exportBackup();
    const exported = JSON.parse(mockWritten);

    expect(exported.version).toBe(13);
    expect(Object.keys(exported.data.career)).toEqual(['skills']);
    expect(exported.data.career.skills).toHaveLength(1);
    expect('cv' in exported.data).toBe(false);
    for (const secret of [COMPANY, NOTE, PHONE, 'sentinel@example.org', 'Sentinelvej', 'example.com/job', 'applications', 'personalInfo']) {
      expect(mockWritten).not.toContain(secret);
    }
  });

  it('is accepted by its own parser', async () => {
    await exportBackup();
    expect(parseBackupFile(mockWritten)).toMatchObject({ ok: true, version: 13 });
  });

  it('says in both languages that applications and CV are not included, and never promises "all" data', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const en = require('@/localization/locales/en/backup.json').exportDescription as string;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const da = require('@/localization/locales/da/backup.json').exportDescription as string;
    expect(en).toMatch(/job applications and CV details.*not included/i);
    expect(da).toMatch(/jobansøgninger og CV-oplysninger.*ikke med/i);
    expect(en).not.toMatch(/\ball your data\b/i);
    expect(da).not.toMatch(/\balle dine data\b/i);
  });

  it('exports through an explicit whitelist for career and for cv', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require('fs').readFileSync(require('path').join(__dirname, '../utils/shared/dataBackup.ts'), 'utf8');
    expect(source).toContain("key === 'career'");
    expect(source).toContain("key === 'cv'");
    expect(source).toContain('data[key] = { skills: useCareerStore.getState().skills }');
  });
});

describe('an older file', () => {
  it.each([1, 7, 12])('format %i: valid applications are restored through the canonical decoder', (version) => {
    const result = parseBackupFile(career(version, [row(), row({ id: 'app-2', link: undefined, notes: undefined, status: 'rejected' })]));
    expect(result.ok && result.data.career?.applications).toEqual([
      row(),
      { id: 'app-2', company: COMPANY, position: 'Engineer', status: 'rejected', appliedDate: '2026-09-01', createdAt: '2026-09-01T08:00:00.000Z' },
    ]);
  });

  it('format 12: CV content still restores', () => {
    const cv = { personalInfo: { fullName: 'A', phone: PHONE }, education: [], experience: [], languages: [], versions: [] };
    expect(parseBackupFile(file(12, { cv }))).toMatchObject({ ok: true, data: { cv } });
  });

  it.each([
    ['an unknown status', row({ status: 'ghosted' })],
    ['a status that was never offered', row({ status: 'withdrawn' })],
    ['an impossible date', row({ appliedDate: '2026-02-30' })],
    ['a date with a time', row({ appliedDate: '2026-09-01T00:00:00Z' })],
    ['a missing company', row({ company: undefined })],
    ['a blank role', row({ position: '  ' })],
    ['a non-string note', row({ notes: 5 })],
    ['an invalid creation time', row({ createdAt: 'yesterday' })],
    ['an unknown extra field', row({ salary: 100 })],
    ['a non-object row', 'string'],
    ['a null row', null],
  ])('formats 1, 7 and 12 reject the whole file for %s', (_label, bad) => {
    for (const version of [1, 7, 12]) {
      expect(parseBackupFile(career(version, [row({ id: 'fine' }), bad]))).toEqual({ ok: false, error: 'invalid_format' });
    }
  });

  // The previous Career form enforced no limit and no link rule, so a backup it wrote may hold all of these.
  const LEGACY = [
    ['a link typed without a scheme', row({ link: 'linkedin.com/jobs/123' })],
    ['a javascript link', row({ link: 'javascript:alert(1)' })],
    ['a file link', row({ link: 'file:///etc/passwd' })],
    ['a link over 2048', row({ link: `https://example.com/${'a'.repeat(3000)}` })],
    ['a company over 200', row({ company: 'c'.repeat(500) })],
    ['a position over 200', row({ position: 'p'.repeat(201) })],
    ['a note over 10,000', row({ notes: 'n'.repeat(20_000) })],
    ['a NUL in a note', row({ notes: 'a\u0000b' })],
  ] as const;

  it.each([1, 7, 12])('format %i: a historical value above a new APP-067 limit, or a non-http link, is restored exactly and never normalised', (version) => {
    for (const [, legacy] of LEGACY) {
      const result = parseBackupFile(career(version, [row({ id: 'other' }), legacy]));
      expect(result.ok && result.data.career?.applications).toEqual([row({ id: 'other' }), legacy]);
    }
    const result = parseBackupFile(career(version, [row({ link: 'linkedin.com/jobs/123' })]));
    expect((result.ok && (result.data.career?.applications as { link?: string }[])[0].link)).toBe('linkedin.com/jobs/123');
  });

  it('does not accept a historical value in a malformed row: a bad status next to a legacy link still refuses everything', () => {
    expect(parseBackupFile(career(12, [row({ link: 'linkedin.com/jobs/123' }), row({ id: 'x', status: 'ghosted' })]))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('rejects a repeated id and a non-array', () => {
    expect(parseBackupFile(career(12, [row(), row()]))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseBackupFile(career(12, { not: 'a list' }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('never reports any of the rejected text', () => {
    expect(JSON.stringify(parseBackupFile(career(12, [row({ status: 'ghosted' })])))).not.toContain(COMPANY);
    expect(JSON.stringify(parseBackupFile(career(12, [row({ status: 'ghosted' })])))).not.toContain(NOTE);
  });
});

describe('format 13 and newer exclude the payload by definition', () => {
  it('accepts skills only', () => {
    const skills = [{ id: 's', name: 'Excel', category: 'technical', level: 'expert', createdAt: '2026-09-01T00:00:00.000Z' }];
    expect(parseBackupFile(file(13, { career: { skills } }))).toMatchObject({ ok: true, data: { career: { skills } } });
  });

  it('rejects a file that claims format 13 yet carries applications or CV content', () => {
    expect(parseBackupFile(career(13, [row()]))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseBackupFile(career(13, []))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseBackupFile(file(13, { cv: { personalInfo: { phone: PHONE } } }))).toEqual({ ok: false, error: 'invalid_format' });
  });
});

describe('restore through the real stores', () => {
  it('restores a legacy file into the stores, and the bytes at rest are encrypted', async () => {
    mockFileContent = file(12, {
      career: { applications: [row()], skills: [] },
      cv: { personalInfo: { fullName: 'Restored Person', phone: PHONE }, education: [], experience: [], languages: [], versions: [] },
    });
    expect(await importBackup()).toMatchObject({ success: true, restoredKeys: expect.arrayContaining(['career', 'cv']) });
    await settle();

    expect(useCareerStore.getState().applications).toEqual([row()]);
    expect(useCVStore.getState().personalInfo).toMatchObject({ phone: PHONE });
    for (const key of ['lifesort-career', 'lifesort-cv']) {
      const stored = await AsyncStorage.getItem(key);
      expect(stored).toContain('__lifesort_encrypted_document_metadata__');
      for (const secret of [COMPANY, NOTE, PHONE, 'Restored Person']) expect(stored).not.toContain(secret);
    }
  });

  it('restores a format-12 file with a scheme-less link and oversize text into the stores, preserved and encrypted at rest', async () => {
    const legacy = row({ id: 'legacy', link: 'linkedin.com/jobs/123', company: 'c'.repeat(500), notes: 'n'.repeat(20_000) });
    mockFileContent = file(12, { career: { applications: [legacy], skills: [] } });
    expect(await importBackup()).toMatchObject({ success: true, restoredKeys: expect.arrayContaining(['career']) });
    await settle();

    expect(useCareerStore.getState().applications).toEqual([legacy]);
    expect(openableLink(useCareerStore.getState().applications[0].link)).toBeNull();
    const stored = await AsyncStorage.getItem('lifesort-career');
    expect(stored).toContain('__lifesort_encrypted_document_metadata__');
    expect(stored).not.toContain('linkedin.com');
  });

  it('a malformed Career section restores nothing at all and leaves the current data', async () => {
    useCareerStore.getState().addApplication({ company: 'Current', position: 'Role', status: 'applied', appliedDate: '2026-09-01' });
    const before = useCareerStore.getState().applications;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFileContent = file(12, { career: { applications: [row({ status: 'ghosted' })], skills: [] }, todos: { todos: [] } });

    expect(await importBackup()).toMatchObject({ success: false, error: 'invalid_format' });
    expect(useCareerStore.getState().applications).toBe(before);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(COMPANY);
    spy.mockRestore();
  });

  it('a format 13 restore leaves existing applications and CV untouched', async () => {
    useCareerStore.getState().addApplication({ company: 'Current', position: 'Role', status: 'applied', appliedDate: '2026-09-01' });
    useCVStore.setState({ personalInfo: { fullName: 'Current Person' } as never });
    mockFileContent = file(13, { career: { skills: [] } });
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useCareerStore.getState().applications).toHaveLength(1);
    expect(useCVStore.getState().personalInfo).toMatchObject({ fullName: 'Current Person' });
  });
});
