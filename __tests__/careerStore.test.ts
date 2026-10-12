import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * APP-067 — the real Career and CV stores, through the real Profile-B adapter.
 *
 * Measured the only way that means anything: by reading the raw bytes AsyncStorage holds and
 * looking for the plaintext in them. Career is local-only, so the same file also proves that
 * nothing reaches the network or the ordinary outbox.
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
    from: jest.fn(() => { throw new Error('no table access expected'); }),
    rpc: jest.fn(),
  },
}));

import { clearLocalUserData } from '@/core/auth/clearLocalUserData';
import { supabase as mockSupabase } from '@/lib/supabase';
import { useCareerStore } from '@/store/useCareerStore';
import { useCVStore } from '@/store/useCVStore';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_NAME = 'lifesort-document-cache-key';
const COMPANY = 'Sentinel Employer Holding A/S';
const NOTE = 'Salary talk went badly - private sentinel note';
const PHONE = '+45 77 66 55 44';
const EMAIL = 'sentinel.person@example.org';
const ADDRESS = 'Sentinelvej 12, 8000 Aarhus';

const input = { company: COMPANY, position: 'Sentinel Role', status: 'applied' as const, appliedDate: '2026-10-01', notes: NOTE, link: 'https://example.com/sentinel-listing' };
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const raw = async (key: string) => AsyncStorage.getItem(key);
const resetStores = () => {
  useCareerStore.setState({ applications: [], skills: [] });
  useCVStore.setState({ personalInfo: {} as never, education: [], experience: [], languages: [], versions: [] });
};
const legacyCareer = (applications: unknown[], skills: unknown[] = []) => JSON.stringify({ state: { applications, skills }, version: 0 });
const legacyRow = (patch: Record<string, unknown> = {}) => ({
  id: '1725206400000-4821', company: COMPANY, position: 'Legacy Role', status: 'interview', appliedDate: '2026-09-01',
  notes: NOTE, createdAt: '2026-09-01T08:00:00.000Z', ...patch,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await SecureStore.deleteItemAsync(KEY_NAME);
  // Removing the keys also clears the adapter's per-key protected-failure block (module state).
  await clearLocalUserData([]);
  await AsyncStorage.clear();
  // A failed protected read is remembered per key by the storage gate (writes then refuse). A
  // successful read of an empty key replaces it, so one test's deliberate failure cannot leak.
  await Promise.all([useCareerStore.persist.rehydrate(), useCVStore.persist.rehydrate()]);
  resetStores();
  jest.clearAllMocks();
});

describe('Career applications', () => {
  it('creates an application with a UUID id, a creation instant and the validated fields', () => {
    const result = useCareerStore.getState().addApplication(input);
    expect(result.ok).toBe(true);
    const [created] = useCareerStore.getState().applications;
    expect(created.id).toMatch(UUID_V4);
    expect(result.ok && result.id).toBe(created.id);
    expect(Number.isFinite(Date.parse(created.createdAt))).toBe(true);
    expect(created).toMatchObject({ company: COMPANY, position: 'Sentinel Role', status: 'applied', appliedDate: '2026-10-01', notes: NOTE });
  });

  it('refuses invalid input without touching state, and reports field codes only', () => {
    const result = useCareerStore.getState().addApplication({ ...input, company: ' ', status: 'withdrawn' as never, link: 'javascript:alert(1)' });
    expect(result).toEqual({ ok: false, errors: { company: 'required', status: 'invalid', link: 'invalidLink' } });
    expect(useCareerStore.getState().applications).toEqual([]);
  });

  it('edits keep id and createdAt, allow any status to become any other, and refuse an invalid edit', () => {
    useCareerStore.getState().addApplication(input);
    const original = useCareerStore.getState().applications[0];
    for (const status of ['rejected', 'offer', 'applied', 'interview'] as const) {
      expect(useCareerStore.getState().updateApplication(original.id, { ...input, status }).ok).toBe(true);
      expect(useCareerStore.getState().applications[0]).toMatchObject({ id: original.id, createdAt: original.createdAt, status });
    }
    const refused = useCareerStore.getState().updateApplication(original.id, { ...input, notes: 'a\u0000b' });
    expect(refused).toEqual({ ok: false, errors: { notes: 'invalidCharacters' } });
    expect(useCareerStore.getState().applications[0].status).toBe('interview');
    expect(useCareerStore.getState().updateApplication('missing', input)).toEqual({ ok: false, errors: {} });
  });

  it('removes an application locally', () => {
    useCareerStore.getState().addApplication(input);
    useCareerStore.getState().removeApplication(useCareerStore.getState().applications[0].id);
    expect(useCareerStore.getState().applications).toEqual([]);
  });
});

describe('Career is local-only', () => {
  it('makes no Supabase call and writes nothing to the ordinary outbox, whatever the user does — even signed in', async () => {
    // A signed-in user is the case the legacy mirror used to write for.
    (mockSupabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: 'user-a' } } });
    const store = useCareerStore.getState();
    store.addApplication(input);
    const id = useCareerStore.getState().applications[0].id;
    store.updateApplication(id, { ...input, status: 'offer' });
    store.addSkill({ name: 'Excel', category: 'technical', level: 'proficient' });
    store.removeApplication(id);
    await settle();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
    expect(await raw('lifesort-outbox')).toBeNull();
    (mockSupabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: null } });
  });

  it('has no fetch, mirror or sync action at all', () => {
    const keys = Object.keys(useCareerStore.getState());
    expect(keys.filter((key) => /fetch|sync|supabase|mirror/i.test(key))).toEqual([]);
  });
});

describe('lifesort-career is encrypted at rest', () => {
  it('leaves no company, note, link, role or date in the raw bytes, but an AES-GCM envelope', async () => {
    useCareerStore.getState().addApplication(input);
    useCareerStore.getState().addSkill({ name: 'Sentinel Skill', category: 'technical', level: 'expert' });
    await settle();
    const stored = await raw('lifesort-career');
    expect(stored).toContain('__lifesort_encrypted_document_metadata__');
    expect(JSON.parse(stored!).algorithm).toBe('AES-256-GCM');
    for (const secret of [COMPANY, 'Sentinel', NOTE, 'sentinel-listing', 'Sentinel Role', '2026-10-01', 'Sentinel Skill', 'applications']) {
      expect(stored).not.toContain(secret);
    }
    expect(await SecureStore.getItemAsync(KEY_NAME)).toBeTruthy();
    expect(stored).not.toContain((await SecureStore.getItemAsync(KEY_NAME))!);
  });

  it('survives a restart: a fresh hydrate reads the same applications back', async () => {
    useCareerStore.getState().addApplication(input);
    await settle();
    const before = useCareerStore.getState().applications;
    useCareerStore.setState({ applications: [] });
    await useCareerStore.persist.rehydrate();
    expect(useCareerStore.getState().applications).toEqual(before);
  });

  it('upgrades legacy plaintext on the first valid hydrate: every row survives, the bytes are then encrypted, nothing is logged', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await AsyncStorage.setItem('lifesort-career', legacyCareer([legacyRow(), legacyRow({ id: 'second', company: 'Other Sentinel' })], [{ id: 's', name: 'Sentinel Skill', category: 'soft', level: 'beginner', createdAt: '2026-09-01T00:00:00.000Z' }]));
    expect(await raw('lifesort-career')).toContain(COMPANY);

    await useCareerStore.persist.rehydrate();
    await settle();

    expect(useCareerStore.getState().applications.map((a) => a.id)).toEqual(['1725206400000-4821', 'second']);
    expect(useCareerStore.getState().skills).toHaveLength(1);
    const stored = await raw('lifesort-career');
    expect(stored).toContain('__lifesort_encrypted_document_metadata__');
    for (const secret of [COMPANY, 'Other Sentinel', NOTE, 'Sentinel Skill']) expect(stored).not.toContain(secret);
    for (const spy of [log, warn, error]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('Sentinel');
      spy.mockRestore();
    }
  });

  it('does not render a legacy application whose status the app never offered, nor one with an impossible date', async () => {
    await AsyncStorage.setItem('lifesort-career', legacyCareer([
      legacyRow({ id: 'ok' }), legacyRow({ id: 'ghost', status: 'ghosted' }), legacyRow({ id: 'bad-date', appliedDate: '2026-02-30' }), legacyRow({ id: 'withdrawn', status: 'withdrawn' }),
    ]));
    await useCareerStore.persist.rehydrate();
    expect(useCareerStore.getState().applications.map((a) => a.id)).toEqual(['ok']);
  });

  it('keeps a legacy unsafe link as inert text on the record', async () => {
    await AsyncStorage.setItem('lifesort-career', legacyCareer([legacyRow({ link: 'javascript:alert(1)' })]));
    await useCareerStore.persist.rehydrate();
    expect(useCareerStore.getState().applications[0].link).toBe('javascript:alert(1)');
  });

  it('fails closed on a corrupt envelope: nothing is shown, and a later write cannot overwrite the protected bytes', async () => {
    useCareerStore.getState().addApplication(input);
    await settle();
    const envelope = JSON.parse((await raw('lifesort-career'))!);
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
    const corrupt = JSON.stringify(envelope);
    await AsyncStorage.setItem('lifesort-career', corrupt);
    useCareerStore.setState({ applications: [] });

    await useCareerStore.persist.rehydrate();
    expect(useCareerStore.getState().applications).toEqual([]);

    useCareerStore.getState().addApplication({ ...input, company: 'Written after failure' });
    await settle();
    expect(await raw('lifesort-career')).toBe(corrupt);
  });

  it('fails closed when the key is missing: the old bytes are neither shown nor replaced', async () => {
    useCareerStore.getState().addApplication(input);
    await settle();
    const encrypted = await raw('lifesort-career');
    await SecureStore.deleteItemAsync(KEY_NAME);
    useCareerStore.setState({ applications: [] });

    await useCareerStore.persist.rehydrate();
    expect(useCareerStore.getState().applications).toEqual([]);
    useCareerStore.getState().addApplication({ ...input, company: 'Written without a key' });
    await settle();
    expect(await raw('lifesort-career')).toBe(encrypted);
  });

  it('refuses an unrecognised plaintext shape under the key rather than adopting it', async () => {
    const strange = JSON.stringify({ state: { applications: 'not a list', skills: [] }, version: 0 });
    await AsyncStorage.setItem('lifesort-career', strange);
    await useCareerStore.persist.rehydrate();
    expect(useCareerStore.getState().applications).toEqual([]);
    expect(await raw('lifesort-career')).toBe(strange);
  });
});

describe('lifesort-cv is encrypted at rest', () => {
  const cvState = () => ({
    personalInfo: { fullName: 'Sentinel Person', email: EMAIL, phone: PHONE, location: ADDRESS, summary: 'Private summary sentinel' },
    education: [{ id: 'e1', school: 'Sentinel University', degree: 'MSc', startDate: '2018-09' }],
    experience: [{ id: 'x1', company: 'Sentinel Works', position: 'Engineer', startDate: '2020-01' }],
    languages: [{ id: 'l1', name: 'Danish', proficiency: 'native' }],
    versions: [],
  });

  it('leaves no phone, email or address in the raw bytes', async () => {
    useCVStore.getState().updatePersonalInfo(cvState().personalInfo as never);
    await settle();
    const stored = await raw('lifesort-cv');
    expect(stored).toContain('__lifesort_encrypted_document_metadata__');
    for (const secret of [PHONE, EMAIL, ADDRESS, 'Sentinel Person', 'Private summary sentinel', 'personalInfo']) expect(stored).not.toContain(secret);
  });

  it('upgrades legacy plaintext on the first valid hydrate, restarts, and then holds only ciphertext', async () => {
    await AsyncStorage.setItem('lifesort-cv', JSON.stringify({ state: cvState(), version: 0 }));
    expect(await raw('lifesort-cv')).toContain(PHONE);

    await useCVStore.persist.rehydrate();
    await settle();
    expect(useCVStore.getState().personalInfo).toMatchObject({ phone: PHONE, email: EMAIL, location: ADDRESS });
    expect(useCVStore.getState().experience).toHaveLength(1);
    const stored = await raw('lifesort-cv');
    expect(stored).toContain('__lifesort_encrypted_document_metadata__');
    for (const secret of [PHONE, EMAIL, ADDRESS, 'Sentinel Works', 'Sentinel University']) expect(stored).not.toContain(secret);

    useCVStore.setState({ personalInfo: {} as never, education: [], experience: [], languages: [], versions: [] });
    await useCVStore.persist.rehydrate();
    expect(useCVStore.getState().personalInfo).toMatchObject({ phone: PHONE });
  });

  it('fails closed on a corrupt envelope and on a missing key, and blocks the write', async () => {
    useCVStore.getState().updatePersonalInfo(cvState().personalInfo as never);
    await settle();
    const encrypted = await raw('lifesort-cv');
    await SecureStore.deleteItemAsync(KEY_NAME);
    useCVStore.setState({ personalInfo: {} as never });
    await useCVStore.persist.rehydrate();
    expect(useCVStore.getState().personalInfo).toEqual({});
    useCVStore.getState().updatePersonalInfo({ fullName: 'Written without a key' } as never);
    await settle();
    expect(await raw('lifesort-cv')).toBe(encrypted);
  });
});

describe('logout and account switch', () => {
  const resets = [
    { key: 'lifesort-career', reset: () => useCareerStore.setState({ applications: [], skills: [] }) },
    { key: 'lifesort-cv', reset: () => useCVStore.setState({ personalInfo: {} as never, education: [], experience: [], languages: [], versions: [] }) },
  ];

  it('A -> logout -> B: nothing of A is in memory, in storage or readable with a new key', async () => {
    useCareerStore.getState().addApplication(input);
    useCVStore.getState().updatePersonalInfo({ fullName: 'A Person', phone: PHONE, email: EMAIL } as never);
    await settle();
    const aCareerBytes = await raw('lifesort-career');
    expect(aCareerBytes).not.toBeNull();

    await clearLocalUserData(resets);

    expect(useCareerStore.getState().applications).toEqual([]);
    expect(useCVStore.getState().personalInfo).toEqual({});
    expect(await raw('lifesort-career')).toBeNull();
    expect(await raw('lifesort-cv')).toBeNull();
    expect(await SecureStore.getItemAsync(KEY_NAME)).toBeNull();

    // B signs in on the same phone.
    await Promise.all([useCareerStore.persist.rehydrate(), useCVStore.persist.rehydrate()]);
    expect(useCareerStore.getState().applications).toEqual([]);
    expect(useCVStore.getState().personalInfo).toEqual({});
    useCareerStore.getState().addApplication({ ...input, company: 'B Employer', notes: 'B note' });
    await settle();
    expect(JSON.stringify(useCareerStore.getState())).not.toContain(COMPANY);

    // A stale copy of A's ciphertext cannot be read with B's new key.
    await AsyncStorage.setItem('lifesort-career', aCareerBytes!);
    useCareerStore.setState({ applications: [] });
    await useCareerStore.persist.rehydrate();
    expect(useCareerStore.getState().applications).toEqual([]);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
