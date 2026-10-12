import React from 'react';
import { Alert, Linking, PixelRatio, Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

/**
 * APP-067 — the Career application screens as the user meets them: list, create, edit, detail,
 * delete confirmation, link safety, EN/DA, accessibility and theme smoke.
 */
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  // The detail screen puts its edit action in the header; render it so it can be pressed.
  Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => options?.headerRight?.() ?? null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) }, from: jest.fn(), rpc: jest.fn() } }));
jest.mock('@/core/storage/documentCacheStorage', () => ({
  documentMetadataEncryptedStorage: require('@react-native-async-storage/async-storage'),
}));
// The picker is a native wheel; expose its value and onChange so the form can be driven.
jest.mock('@/components/DatePickerField', () => {
  const { View } = require('react-native');
  return function MockDatePickerField(props: Record<string, unknown>) {
    return <View testID="date-field" {...(props as object)} />;
  };
});
jest.mock('@/components/SwipeableRow', () => {
  const { Pressable, View } = require('react-native');
  return function MockSwipeableRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
    return <View>{children}<Pressable accessibilityRole="button" accessibilityLabel="row-delete" onPress={onDelete} /></View>;
  };
});

import { router as mockRouter } from 'expo-router';

import Chip from '@/components/Chip';
import ApplicationDetailScreen from '@/app/career/applications/[id]';
import ApplicationsScreen from '@/app/career/applications/index';
import NewApplicationScreen from '@/app/career/applications/new';
import i18n from '@/localization/i18n';
import { useCareerStore } from '@/store/useCareerStore';
import { useThemeStore } from '@/store/useThemeStore';
import type { JobApplication } from '@/types/career';
import { parseBackupFile } from '@/utils/shared/backupValidation';

const app = (id: string, patch: Partial<JobApplication> = {}): JobApplication => ({
  id, company: `Company ${id}`, position: `Role ${id}`, status: 'applied', appliedDate: '2026-09-01', createdAt: '2026-09-01T08:00:00.000Z', ...patch,
});
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
let tree: TestRenderer.ReactTestRenderer;
const render = async (element: React.ReactElement) => {
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(element); });
  await settle();
};
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const input = (label: string) => tree.root.findAllByType(TextInput).find((node) => node.props.accessibilityLabel === label)!;
const type = async (label: string, value: string) => { await act(async () => { input(label).props.onChangeText(value); }); };
const pressByLabel = async (label: string) => {
  const node = tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  await act(async () => { await node.props.onPress(); });
  await settle();
};
const pressButton = async (label: string) => {
  const node = tree.root.findAllByProps({ label })[0];
  const pressable = node.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function')[0];
  await act(async () => { await pressable.props.onPress(); });
  await settle();
};
const alertSpy = jest.spyOn(Alert, 'alert');
const openUrl = jest.spyOn(Linking, 'openURL');

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  await i18n.changeLanguage('en');
  useThemeStore.setState({ mode: 'light' });
  useCareerStore.setState({ applications: [], skills: [] });
  openUrl.mockResolvedValue(true as never);
});
afterAll(() => tree?.unmount());

describe('list', () => {
  it('shows a neutral empty state and the add button', async () => {
    await render(<ApplicationsScreen />);
    expect(texts()).toContain(t('career.emptyState'));
    expect(t('career.emptyState')).toBe('No applications yet');
    expect(tree.root.findAllByProps({ label: t('career.addButton') }).length).toBeGreaterThan(0);
  });

  it('lists applications in the one deterministic order, whatever the stored order', async () => {
    useCareerStore.setState({ applications: [
      app('b', { appliedDate: '2026-09-01', createdAt: '2026-09-01T08:00:00.000Z' }),
      app('e', { appliedDate: '2026-08-01' }),
      app('d', { appliedDate: '2026-09-05' }),
      app('a', { appliedDate: '2026-09-01', createdAt: '2026-09-01T08:00:00.000Z' }),
      app('c', { appliedDate: '2026-09-01', createdAt: '2026-09-01T09:00:00.000Z' }),
    ] });
    await render(<ApplicationsScreen />);
    const roles = texts().filter((text) => /^Role [a-e]$/.test(text));
    expect(roles).toEqual(['Role d', 'Role c', 'Role a', 'Role b', 'Role e']);
  });

  it('filters locally by company or role, and says so when nothing matches', async () => {
    useCareerStore.setState({ applications: [app('a', { company: 'Maersk' }), app('b', { company: 'Novo' })] });
    await render(<ApplicationsScreen />);
    await type(t('career.searchLabel'), 'maer');
    expect(texts()).toContain('Role a');
    expect(texts()).not.toContain('Role b');
    await type(t('career.searchLabel'), 'zzz');
    expect(texts()).toContain(t('career.noMatches'));
  });

  it('never filters on notes', async () => {
    useCareerStore.setState({ applications: [app('a', { notes: 'secret sentinel' })] });
    await render(<ApplicationsScreen />);
    await type(t('career.searchLabel'), 'sentinel');
    expect(texts()).not.toContain('Role a');
  });

  it('asks before deleting from the list, and deletes only after confirmation', async () => {
    useCareerStore.setState({ applications: [app('a')] });
    await render(<ApplicationsScreen />);
    await pressByLabel('row-delete');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe(t('career.deleteConfirmTitle'));
    expect(message).toBe(t('career.deleteConfirmMessage'));
    expect(message).toMatch(/this device only/i);
    expect(useCareerStore.getState().applications).toHaveLength(1);
    // Cancelling changes nothing.
    buttons!.find((b) => b.style === 'cancel')!.onPress?.();
    expect(useCareerStore.getState().applications).toHaveLength(1);
    buttons!.find((b) => b.style === 'destructive')!.onPress?.();
    expect(useCareerStore.getState().applications).toEqual([]);
  });

  it('describes each row to a screen reader, with the status in words', async () => {
    useCareerStore.setState({ applications: [app('a', { status: 'interview' })] });
    await render(<ApplicationsScreen />);
    const row = tree.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Role a'))[0];
    expect(row.props.accessibilityLabel).toBe('Role a, Company a, 2026-09-01, Interview');
  });
});

describe('create', () => {
  const fill = async (patch: Record<string, string> = {}) => {
    const values = { company: 'Acme', position: 'Engineer', link: '', notes: '', ...patch };
    await type(t('career.companyLabel'), values.company);
    await type(t('career.positionLabel'), values.position);
    await type(t('career.linkLabel'), values.link);
    await type(t('career.notesLabel'), values.notes);
  };

  it('labels every field, and the status radios say which one is selected', async () => {
    await render(<NewApplicationScreen />);
    for (const label of ['companyLabel', 'positionLabel', 'linkLabel', 'notesLabel']) expect(input(t(`career.${label}`))).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'date-field' }).props.accessibilityLabel).toBe(t('career.appliedDateLabel'));
    const radios = tree.root.findAllByType(Chip);
    expect(radios).toHaveLength(4);
    expect(radios.map((r) => r.props.accessibilityState.checked)).toEqual([true, false, false, false]);
    for (const radio of radios) expect(JSON.stringify(radio.props.style)).toContain('"minHeight":44');
  });

  it('creates an application and goes back', async () => {
    await render(<NewApplicationScreen />);
    await fill({ link: 'https://example.com/job', notes: 'First line\nSecond line' });
    await pressButton(t('career.save'));
    const [created] = useCareerStore.getState().applications;
    expect(created).toMatchObject({ company: 'Acme', position: 'Engineer', status: 'applied', link: 'https://example.com/job', notes: 'First line\nSecond line' });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('shows an error under each invalid field, creates nothing, and clears an error once the field is edited', async () => {
    await render(<NewApplicationScreen />);
    await fill({ company: '   ', position: 'p'.repeat(201), link: 'javascript:alert(1)', notes: 'n'.repeat(10_001) });
    await pressButton(t('career.save'));
    expect(useCareerStore.getState().applications).toEqual([]);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(texts()).toEqual(expect.arrayContaining([t('career.errors.required'), t('career.errors.tooLong'), t('career.errors.invalidLink'), t('career.saveFailed')]));
    expect(input(t('career.companyLabel')).props.accessibilityHint).toBe(t('career.errors.required'));
    await type(t('career.companyLabel'), 'Acme');
    expect(input(t('career.companyLabel')).props.accessibilityHint).toBeUndefined();
    expect(texts()).not.toContain(t('career.errors.required'));
  });

  it('refuses a future date typed through the picker', async () => {
    await render(<NewApplicationScreen />);
    await fill();
    await act(async () => { tree.root.findByProps({ testID: 'date-field' }).props.onChange('2099-01-01'); });
    await pressButton(t('career.save'));
    expect(useCareerStore.getState().applications).toEqual([]);
    expect(texts()).toContain(t('career.errors.future'));
  });

  it('uses the right keyboards: url for the link, a multiline field for notes, no autocorrect on the link', async () => {
    await render(<NewApplicationScreen />);
    expect(input(t('career.linkLabel')).props).toMatchObject({ keyboardType: 'url', autoCapitalize: 'none', autoCorrect: false });
    expect(input(t('career.notesLabel')).props.multiline).toBe(true);
    expect(input(t('career.companyLabel')).props.multiline).toBeFalsy();
  });

  it('counts notes against the limit', async () => {
    await render(<NewApplicationScreen />);
    await type(t('career.notesLabel'), 'abc');
    expect(texts()).toContain('3 / 10000');
  });
});

describe('detail and edit', () => {
  const open = async (patch: Partial<JobApplication> = {}) => {
    useCareerStore.setState({ applications: [app('a', patch)] });
    mockParams = { id: 'a' };
    await render(<ApplicationDetailScreen />);
  };

  it('changes the status, edits multiline notes, and keeps id and creation time', async () => {
    await open({ notes: 'old' });
    await pressByLabel(t('career.edit'));
    await act(async () => { tree.root.findAllByType(Chip).filter((n) => n.props.accessibilityState?.checked === false)[1].props.onPress(); });
    await type(t('career.notesLabel'), 'new first\nnew second');
    await pressButton(t('career.save'));
    expect(useCareerStore.getState().applications[0]).toMatchObject({ id: 'a', createdAt: '2026-09-01T08:00:00.000Z', status: 'offer', notes: 'new first\nnew second' });
  });

  it('shows validation errors when an edit is invalid and keeps the stored data', async () => {
    await open();
    await pressByLabel(t('career.edit'));
    await type(t('career.companyLabel'), '');
    await pressButton(t('career.save'));
    expect(texts()).toContain(t('career.errors.required'));
    expect(useCareerStore.getState().applications[0].company).toBe('Company a');
  });

  it('opens a valid http(s) link', async () => {
    await open({ link: 'https://example.com/job' });
    await pressByLabel(`${t('career.openLink')}: https://example.com/job`);
    expect(openUrl).toHaveBeenCalledWith('https://example.com/job');
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'lifesort://settings', 'intent://x#Intent;end', 'example.com'])(
    'never opens a legacy link %s: it is shown as text with a plain explanation',
    async (link) => {
      await open({ link });
      expect(texts()).toContain(link);
      expect(texts()).toContain(t('career.invalidLinkNotOpened'));
      expect(tree.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('career.openLink'))).length).toBe(0);
      expect(openUrl).not.toHaveBeenCalled();
    },
  );

  describe('a row restored from a pre-APP-067 backup', () => {
    const legacy = (patch: Record<string, unknown>) => {
      const result = parseBackupFile(JSON.stringify({ version: 12, exportedAt: '2026-09-01T00:00:00.000Z', data: { career: { applications: [{
        id: 'a', company: 'Company a', position: 'Role a', status: 'applied', appliedDate: '2026-09-01', createdAt: '2026-09-01T08:00:00.000Z', ...patch,
      }] } } }));
      if (!result.ok) throw new Error('a legacy backup row must restore');
      useCareerStore.setState({ applications: result.data.career!.applications as JobApplication[] });
      mockParams = { id: 'a' };
    };
    const typeLink = async (value: string) => { await type(t('career.linkLabel'), value); };

    it('shows a scheme-less link as inert text and never opens it', async () => {
      legacy({ link: 'linkedin.com/jobs/123' });
      await render(<ApplicationDetailScreen />);
      expect(texts()).toContain('linkedin.com/jobs/123');
      expect(texts()).toContain(t('career.invalidLinkNotOpened'));
      expect(tree.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('career.openLink'))).length).toBe(0);
      expect(openUrl).not.toHaveBeenCalled();
    });

    it('editing it applies the current rules: the link must be corrected before anything else can be saved', async () => {
      legacy({ link: 'linkedin.com/jobs/123' });
      await render(<ApplicationDetailScreen />);
      await pressByLabel(t('career.edit'));
      await type(t('career.notesLabel'), 'a harmless edit');
      await pressButton(t('career.save'));
      expect(texts()).toContain(t('career.errors.invalidLink'));
      expect(useCareerStore.getState().applications[0]).toMatchObject({ link: 'linkedin.com/jobs/123' });
      expect(useCareerStore.getState().applications[0].notes).toBeUndefined();

      await typeLink('https://linkedin.com/jobs/123');
      await pressButton(t('career.save'));
      expect(useCareerStore.getState().applications[0]).toMatchObject({ link: 'https://linkedin.com/jobs/123', notes: 'a harmless edit' });
    });

    it('editing a row whose notes exceed the new limit asks for a shorter note, and keeps the original until then', async () => {
      const long = 'n'.repeat(12_000);
      legacy({ notes: long });
      await render(<ApplicationDetailScreen />);
      expect(texts()).toContain(long);
      await pressByLabel(t('career.edit'));
      await pressButton(t('career.save'));
      expect(texts()).toContain(t('career.errors.tooLong'));
      expect(useCareerStore.getState().applications[0].notes).toBe(long);
      await type(t('career.notesLabel'), 'short');
      await pressButton(t('career.save'));
      expect(useCareerStore.getState().applications[0].notes).toBe('short');
    });
  });

  it('asks before deleting from the detail screen, and goes back after confirmation', async () => {
    await open();
    await pressButton(t('career.delete'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][1]).toBe(t('career.deleteConfirmMessage'));
    expect(useCareerStore.getState().applications).toHaveLength(1);
    alertSpy.mock.calls[0][2]!.find((b) => b.style === 'destructive')!.onPress?.();
    expect(useCareerStore.getState().applications).toEqual([]);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('says plainly when the application no longer exists', async () => {
    mockParams = { id: 'gone' };
    await render(<ApplicationDetailScreen />);
    expect(texts()).toContain(t('career.notFound'));
  });
});

describe('language', () => {
  it('renders the same screens in Danish with Danish labels, errors and confirmations', async () => {
    await i18n.changeLanguage('da');
    await render(<NewApplicationScreen />);
    expect(input('Firma')).toBeTruthy();
    expect(input('Stilling')).toBeTruthy();
    await pressButton(t('career.save'));
    expect(texts()).toContain('Feltet skal udfyldes.');
    expect(t('career.deleteConfirmMessage')).toMatch(/kun på denne enhed/);
    expect(t('life.careerMetricLabel')).toBe('Åbne ansøgninger');
  });

  it('has an English and a Danish string for every Career key it uses', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const en = require('@/localization/locales/en/career.json'); const da = require('@/localization/locales/da/career.json');
    const flatten = (value: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(value).flatMap(([key, v]) => (typeof v === 'object' && v !== null ? flatten(v as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`]));
    expect(flatten(da).sort()).toEqual(flatten(en).sort());
  });
});

describe('theme and text size', () => {
  it('renders in the dark theme', async () => {
    useThemeStore.setState({ mode: 'dark' });
    useCareerStore.setState({ applications: [app('a', { link: 'https://example.com', notes: 'n' })] });
    await render(<ApplicationsScreen />);
    expect(texts()).toContain('Role a');
    mockParams = { id: 'a' };
    await render(<ApplicationDetailScreen />);
    await render(<NewApplicationScreen />);
    expect(input(t('career.notesLabel'))).toBeTruthy();
  });

  it('lets text scale: no screen disables font scaling, and everything still renders at 2x', async () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    useCareerStore.setState({ applications: [app('a', { link: 'https://example.com', notes: 'n' })] });
    mockParams = { id: 'a' };
    for (const element of [<ApplicationsScreen key="l" />, <ApplicationDetailScreen key="d" />, <NewApplicationScreen key="n" />]) {
      await render(element);
      expect(tree.root.findAll((n) => n.props.allowFontScaling === false)).toEqual([]);
      expect(tree.root.findAllByType(Text).length).toBeGreaterThan(0);
    }
  });
});
