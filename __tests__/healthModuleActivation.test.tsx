import fs from 'fs';
import path from 'path';
import React from 'react';
import { Switch, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * APP-071 — a health module is chosen, never defaulted or inferred (ADR-0059).
 *
 * The rule itself is unit-tested in moduleEnablement.test.ts. This file proves that the surfaces a user
 * actually meets — the choice list, the launcher, the tab bar and the Home snapshots — all read the one shared
 * answer, and that switching Cycle off or on writes the module-choice domain and nothing else.
 */

const mockQueries: string[] = [];
const mockTabScreens: Record<string, Record<string, unknown> | undefined> = {};
let mockRows: { data: unknown[] | null; error: unknown } = { data: [], error: null };
let mockAccount: string | null = null;

jest.mock('expo-router', () => {
  const React = require('react');
  const Tabs = ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  Tabs.Screen = (props: { name: string; options?: Record<string, unknown> }) => {
    mockTabScreens[props.name] = props.options;
    return null;
  };
  return { router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() }, Tabs, Link: ({ children }: { children: React.ReactNode }) => children };
});
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/components/FloatingTabBar', () => () => null);
jest.mock('@/components/useClientOnlyValue', () => ({ useClientOnlyValue: (_server: unknown, client: unknown) => client }));
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: mockAccount ? { user: { id: mockAccount } } : null }) },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: mockAccount ? { id: mockAccount } : null } }) },
    from: (table: string) => {
      mockQueries.push(table);
      return {
        select: () => ({ eq: () => Promise.resolve(mockRows) }),
        upsert: () => Promise.resolve({ error: null }),
      };
    },
  },
}));

import { router as mockRouter } from 'expo-router';

import ModuleLauncherScreen from '@/app/modules';
import TabLayout from '@/app/(tabs)/_layout';
import ModuleChoiceList from '@/components/ModuleChoiceList';
import { isModuleEnabled, type ModuleEnablement } from '@/core/modules/moduleEnablement';
import { useHomeSnapshots, type HomeSnapshotProviders } from '@/core/modules/homeSnapshots';
import { useEnabledModuleIds, useModuleEnabled } from '@/core/modules/useModuleEnabled';
import { createOutbox } from '@/core/sync/outbox';
import i18n from '@/localization/i18n';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';
import { useModuleFlagsStore } from '@/store/useModuleFlagsStore';
import { useHomeLayoutStore } from '@/store/useHomeLayoutStore';

const t = (key: string) => i18n.t(key);
const cycleTitle = () => t('modules.names.cycle');
const tabScreens = () => mockTabScreens;
const text = (node: TestRenderer.ReactTestInstance) => [node.props.children].flat().join('');

let tree: TestRenderer.ReactTestRenderer | undefined;
const render = async (element: React.ReactElement) => {
  await act(async () => { tree = TestRenderer.create(element); });
};
const texts = () => tree!.root.findAllByType(Text).map(text);
const switchFor = (title: string) =>
  tree!.root.findAllByType(Switch).find((node) => node.props.accessibilityLabel === title)!;
const choose = (enablement: ModuleEnablement) => useEnabledModulesStore.setState({ enablement });
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); };

beforeEach(async () => {
  mockQueries.length = 0;
  mockRows = { data: [], error: null };
  mockAccount = null;
  for (const key of Object.keys(mockTabScreens)) delete mockTabScreens[key];
  (mockRouter.push as jest.Mock).mockClear();
  await i18n.changeLanguage('en');
  await AsyncStorage.clear();
  useEnabledModulesStore.getState().clearLocal();
  useModuleFlagsStore.setState({ overrides: {} });
  useHomeLayoutStore.setState({ pinned: [], hidden: [], lastOpenedAt: {} });
});
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = undefined; });

describe('the choice list (onboarding and Settings share it)', () => {
  it('renders an unchosen Cycle switch OFF and every ordinary module ON', async () => {
    await render(<ModuleChoiceList />);
    expect(switchFor(cycleTitle()).props.value).toBe(false);
    expect(switchFor(t('modules.names.travel')).props.value).toBe(true);
    expect(switchFor(t('modules.names.economy')).props.value).toBe(true);
  });

  it('never lists an internal module, not even when a remote flag tries to promote it (real renderer: onboarding and Settings share this list)', async () => {
    const shown = () => tree!.root.findAllByType(Switch).map((node) => node.props.accessibilityLabel as string);
    for (const overrides of [{}, { pregnancy: 'available', gifts: 'available' }] as const) {
      useModuleFlagsStore.setState({ overrides: { ...overrides } });
      await render(<ModuleChoiceList />);
      expect(shown()).toContain(t('modules.names.travel'));
      expect(shown()).not.toContain(t('modules.names.pregnancy'));
      expect(shown()).not.toContain(t('modules.names.gifts'));
      expect(texts()).not.toContain(t('modules.descriptions.pregnancy'));
      act(() => tree!.unmount()); tree = undefined;
    }
  });

  it('does not call a missing choice a stored one: nothing is written until the user acts', async () => {
    await render(<ModuleChoiceList />);
    expect(useEnabledModulesStore.getState().enablement).toEqual({});
  });

  it('lets the user switch Cycle on, off and on again — and the switch follows', async () => {
    await render(<ModuleChoiceList />);
    for (const next of [true, false, true]) {
      await act(async () => { switchFor(cycleTitle()).props.onValueChange(next); });
      expect(useEnabledModulesStore.getState().enablement.cycle).toBe(next);
      expect(switchFor(cycleTitle()).props.value).toBe(next);
    }
  });

  it('is the same list on both screens, with no health-specific component', () => {
    const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    for (const file of ['app/onboarding-modules.tsx', 'app/settings/modules.tsx']) {
      expect(read(file)).toContain('<ModuleChoiceList />');
      expect(read(file)).not.toMatch(/cycle|health/i);
    }
    expect(read('components/ModuleChoiceList.tsx')).not.toMatch(/cycle|health|gender/i);
  });
});

describe('the module launcher', () => {
  it('does not list an unchosen Cycle', async () => {
    await render(<ModuleLauncherScreen />);
    expect(texts()).not.toContain(cycleTitle());
    expect(texts()).toContain(t('modules.names.travel'));
  });

  it('lists Cycle once the user has chosen it', async () => {
    choose({ cycle: true });
    await render(<ModuleLauncherScreen />);
    expect(texts()).toContain(cycleTitle());
  });

  it('hides Cycle when the user has switched it off, and keeps the other modules', async () => {
    choose({ cycle: false });
    await render(<ModuleLauncherScreen />);
    expect(texts()).not.toContain(cycleTitle());
    expect(texts()).toContain(t('modules.names.food'));
  });

  it('still lets a kill switch restrict an enabled Cycle: availability is a separate axis', async () => {
    choose({ cycle: true });
    useModuleFlagsStore.setState({ overrides: { cycle: 'hidden' } });
    await render(<ModuleLauncherScreen />);
    expect(texts()).not.toContain(cycleTitle());
  });

  it('agrees with the shared rule for every module, whatever the stored choice', async () => {
    const states: ModuleEnablement[] = [{}, { cycle: true }, { cycle: false }, { travel: false }];
    for (const enablement of states) {
      choose(enablement);
      await render(<ModuleLauncherScreen />);
      const shown = texts();
      for (const moduleId of ['cycle', 'travel', 'food', 'economy', 'habits'] as const) {
        const visible = shown.includes(t(`modules.names.${moduleId}`));
        // A module in the launcher must be one the shared rule enables (the launcher may hide more, never less).
        if (visible) expect(isModuleEnabled(moduleId, enablement)).toBe(true);
      }
      act(() => tree!.unmount());
      tree = undefined;
    }
  });
});

describe('the Cycle tab', () => {
  const cycleHref = () => tabScreens().cycle?.href;

  it('is not in normal tab navigation for an unchosen Cycle (href: null)', async () => {
    await render(<TabLayout />);
    expect(cycleHref()).toBeNull();
  });

  it('is in tab navigation once chosen', async () => {
    choose({ cycle: true });
    await render(<TabLayout />);
    expect(cycleHref()).toBeUndefined();
  });

  it('leaves the tab when switched off', async () => {
    choose({ cycle: false });
    await render(<TabLayout />);
    expect(cycleHref()).toBeNull();
  });

  it('shows the Economy tab as before for a user who never chose anything', async () => {
    await render(<TabLayout />);
    expect(tabScreens().economy?.href).toBeUndefined();
  });

  it('follows a change while mounted', async () => {
    await render(<TabLayout />);
    expect(cycleHref()).toBeNull();
    await act(async () => { choose({ cycle: true }); });
    expect(cycleHref()).toBeUndefined();
    await act(async () => { choose({ cycle: false }); });
    expect(cycleHref()).toBeNull();
  });
});

describe('Home snapshots', () => {
  const Probe = ({ providers }: { providers: HomeSnapshotProviders }) => {
    const { snapshots } = useHomeSnapshots(providers);
    return <Text>{snapshots.map((snapshot) => snapshot.moduleId).join(',')}</Text>;
  };
  const card = (moduleId: 'cycle' | 'travel') => async () => ({
    moduleId, titleKey: 'k', priority: 'normal' as const, sensitivity: moduleId === 'cycle' ? ('health' as const) : ('personal' as const), route: `/${moduleId}`,
  });
  const providers = () => ({ cycle: jest.fn(card('cycle')), travel: jest.fn(card('travel')) });

  it('does not ask Cycle for a card when it is unchosen', async () => {
    const p = providers();
    await render(<Probe providers={p} />);
    await flush();
    expect(p.cycle).not.toHaveBeenCalled();
    expect(p.travel).toHaveBeenCalled();
    expect(texts()).toEqual(['travel']);
  });

  it('shows the Cycle card once chosen', async () => {
    choose({ cycle: true });
    const p = providers();
    await render(<Probe providers={p} />);
    await flush();
    expect(p.cycle).toHaveBeenCalled();
    expect(texts()[0]).toContain('cycle');
  });

  it('does not ask for a card when switched off', async () => {
    choose({ cycle: false });
    const p = providers();
    await render(<Probe providers={p} />);
    await flush();
    expect(p.cycle).not.toHaveBeenCalled();
  });
});

describe('hooks', () => {
  const Probe = () => {
    const cycle = useModuleEnabled('cycle');
    const ids = useEnabledModuleIds();
    return <Text>{`${cycle}|${ids.includes('cycle')}`}</Text>;
  };

  it('useModuleEnabled and useEnabledModuleIds agree for each state', async () => {
    const cases: [ModuleEnablement, string][] = [[{}, 'false|false'], [{ cycle: true }, 'true|true'], [{ cycle: false }, 'false|false']];
    for (const [enablement, expected] of cases) {
      choose(enablement);
      await render(<Probe />);
      expect(texts()).toEqual([expected]);
      act(() => tree!.unmount());
      tree = undefined;
    }
  });
});

describe('server rows and the account lifecycle', () => {
  beforeEach(() => { mockAccount = 'a'; });
  const fetchChoices = async (rows: unknown[]) => {
    mockRows = { data: rows, error: null };
    await act(async () => { await useEnabledModulesStore.getState().fetchFromSupabase(); });
  };

  it('a fetch that has no Cycle row leaves Cycle off, and does not turn health on', async () => {
    await fetchChoices([{ module_id: 'travel', enabled: true }]);
    expect(isModuleEnabled('cycle', useEnabledModulesStore.getState().enablement)).toBe(false);
  });

  it('a fetched true row (the APP-071 preservation row, or a choice from another device) enables Cycle', async () => {
    await fetchChoices([{ module_id: 'cycle', enabled: true }]);
    expect(isModuleEnabled('cycle', useEnabledModulesStore.getState().enablement)).toBe(true);
  });

  it('a fetched false row keeps Cycle off', async () => {
    await fetchChoices([{ module_id: 'cycle', enabled: false }]);
    expect(isModuleEnabled('cycle', useEnabledModulesStore.getState().enablement)).toBe(false);
  });

  it('a malformed row does not enable Cycle', async () => {
    await fetchChoices([{ module_id: 'cycle', enabled: 'true' }, { module_id: 'cycle' }, null]);
    expect(isModuleEnabled('cycle', useEnabledModulesStore.getState().enablement)).toBe(false);
  });

  it('logging out clears the choice, so the next account starts with Cycle off', async () => {
    choose({ cycle: true });
    expect(isModuleEnabled('cycle', useEnabledModulesStore.getState().enablement)).toBe(true);
    useEnabledModulesStore.getState().clearLocal();
    expect(isModuleEnabled('cycle', useEnabledModulesStore.getState().enablement)).toBe(false);
    expect(useEnabledModulesStore.getState().enablement).toEqual({});
  });

  it('an offline choice survives a stale fetch that does not know it yet', async () => {
    await act(async () => { useEnabledModulesStore.getState().setModuleEnabled('cycle', true); });
    await flush();
    await fetchChoices([]);
    expect(useEnabledModulesStore.getState().enablement.cycle).toBe(true);
  });
});

describe('switching Cycle off or on never touches Cycle data', () => {
  const CYCLE_KEY = 'lifesort-cycle';
  const CYCLE_BLOB = '{"state":{"cycles":[{"id":"c1","startDate":"2026-09-01"}]},"version":0}';
  const CYCLE_TABLES = ['cycles', 'symptom_logs', 'cycle_settings', 'health_conditions', 'symptom_glossary'];

  beforeEach(() => { mockAccount = 'a'; });

  it('writes one module-choice mutation per switch and leaves the Cycle persistence path byte-for-byte alone', async () => {
    await AsyncStorage.setItem(CYCLE_KEY, CYCLE_BLOB);
    const store = useEnabledModulesStore.getState();

    await act(async () => { store.setModuleEnabled('cycle', true); });
    await flush();
    await act(async () => { store.setModuleEnabled('cycle', false); });
    await flush();
    await act(async () => { store.setModuleEnabled('cycle', true); });
    await flush();

    // The encrypted Cycle store key is untouched: same value, not removed, not rewritten.
    expect(await AsyncStorage.getItem(CYCLE_KEY)).toBe(CYCLE_BLOB);

    // Only the module-choice domain was queued, and each entry carries just the boolean.
    const queued = await createOutbox('a').list();
    expect(queued.length).toBeGreaterThan(0);
    for (const entry of queued) {
      expect(entry.dataDomain).toBe('core.module-choice');
      expect(entry.entityType).toBe('module-choice');
      expect(entry.entityId).toBe('cycle');
      expect(entry.payload).toEqual({ enabled: expect.any(Boolean) });
    }

    // No Cycle table was read or written.
    expect(mockQueries.filter((table) => CYCLE_TABLES.includes(table))).toEqual([]);
  });

  it('switching off does not delete or even read the stored Cycle data', async () => {
    await AsyncStorage.setItem(CYCLE_KEY, CYCLE_BLOB);
    const removeItem = jest.spyOn(AsyncStorage, 'removeItem');
    const multiRemove = jest.spyOn(AsyncStorage, 'multiRemove');
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    try {
      choose({ cycle: true });
      getItem.mockClear();
      await act(async () => { useEnabledModulesStore.getState().setModuleEnabled('cycle', false); });
      await flush();
      expect(removeItem).not.toHaveBeenCalledWith(CYCLE_KEY);
      for (const call of multiRemove.mock.calls) expect(call[0]).not.toContain(CYCLE_KEY);
      expect(getItem.mock.calls.map((call) => call[0])).not.toContain(CYCLE_KEY);
      expect(await AsyncStorage.getItem(CYCLE_KEY)).toBe(CYCLE_BLOB);
    } finally {
      removeItem.mockRestore();
      multiRemove.mockRestore();
      getItem.mockRestore();
    }
  });

  it('the module-choice store has no way to reach Cycle: no import of the Cycle store or its key', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../store/useEnabledModulesStore.ts'), 'utf8');
    expect(source).not.toMatch(/useCycleStore|cycleHealthEncryptedStorage|lifesort-cycle/);
    expect(source).not.toMatch(/\bcycles?\b/i);
  });

  it('a signed-in toggle is only ever a Cycle-independent write to user_modules', async () => {
    await act(async () => { useEnabledModulesStore.getState().setModuleEnabled('cycle', true); });
    await flush();
    expect(mockQueries.filter((table) => table !== 'user_modules')).toEqual([]);
  });
});
