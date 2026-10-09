import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Switch, Text } from 'react-native';

import i18n from '@/localization/i18n';
import type { Habit, HabitSchedule } from '@/types/life';

let mockParams: { id?: string } = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => require('react').createElement(require('react-native').View, props),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9', accentSoft: '#CCDDF5' }) }));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) } },
}));

import HomeScreen from '@/app/(tabs)/index';
import LifeScreen from '@/app/(tabs)/life';
import HabitDetailScreen from '@/app/habits/[id]';
import HabitsScreen from '@/app/habits/index';
import { useHabitPreferencesStore } from '@/store/useHabitPreferencesStore';
import { useHabitsStore } from '@/store/useHabitsStore';

let tree: TestRenderer.ReactTestRenderer;
const rendered = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' | ');
const render = async (element: React.ReactElement) => { await act(async () => { tree = TestRenderer.create(element); }); };
const setNow = (year: number, month: number, day: number, hour = 12) => jest.useFakeTimers({
  now: new Date(year, month - 1, day, hour),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'performance', 'hrtime'],
});
const streakSwitch = () => tree.root.findAllByType(Switch)[0];

const MW: HabitSchedule = { kind: 'weekdays', days: [1, 3] };
const habit = (extra: Partial<Habit> = {}, schedule: HabitSchedule = MW, dates: string[] = []): Habit => ({
  id: 'h1', title: 'Walk', direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-28',
  scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule }], logs: dates.map((date, i) => ({ id: `l${i}`, date })), ...extra,
});
/** Thursday 2026-10-08: Mon 28 Sep, Wed 30 Sep, Mon 5 Oct and Wed 7 Oct are the four scheduled days so far. */
const FOUR = ['2026-09-28', '2026-09-30', '2026-10-05', '2026-10-07'];
const enable = (id = 'h1') => useHabitPreferencesStore.getState().setStreakEnabled(id, true);

const FLAME_OR_PUNITIVE = /🔥|\blost\b|broke|restart|reset|don't break|save your|failed|behind|bad day|longest|\bbest\b|mistet|brudt|nulstil|genstart|bagud|dårlig dag|bedste|længste/i;

beforeEach(async () => {
  jest.useRealTimers();
  setNow(2026, 10, 8);
  mockParams = { id: 'h1' };
  await i18n.changeLanguage('en');
  useHabitsStore.getState().clearLocal();
  useHabitPreferencesStore.getState().clearLocal();
});
afterEach(() => { act(() => tree.unmount()); jest.useRealTimers(); });

describe('APP-065 streak card on the Habit detail screen', () => {
  it('shows no number and no count when the streak is off, which is the default', async () => {
    useHabitsStore.setState({ habits: [habit({}, MW, FOUR)] });
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('Show a streak for this habit');
    expect(rendered()).not.toMatch(/in a row|streak tracking is on/i);
    expect(streakSwitch().props.value).toBe(false);
  });

  it('shows the current count for an eligible habit that has it on', async () => {
    useHabitsStore.setState({ habits: [habit({}, MW, FOUR)] });
    enable();
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('4 scheduled days completed in a row');
  });

  it('uses the singular for one and "kept" for a quit habit', async () => {
    useHabitsStore.setState({ habits: [habit({ direction: 'quit' }, MW, ['2026-10-07'])] });
    enable();
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('1 scheduled day kept in a row');
    expect(rendered()).not.toContain('completed in a row');
  });

  it('never shows "0": a zero count is a neutral sentence', async () => {
    useHabitsStore.setState({ habits: [habit()] });
    enable();
    await render(<HabitDetailScreen />);
    const text = rendered();
    expect(text).toContain('Streak tracking is on. It starts after a scheduled day is completed.');
    expect(text).not.toMatch(/\b0 scheduled|0-day|\b0\b.*in a row/i);
  });

  it('uses "kept" in the quit zero state', async () => {
    useHabitsStore.setState({ habits: [habit({ direction: 'quit' })] });
    enable();
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('It starts after a scheduled day is kept.');
  });

  it.each<[string, HabitSchedule]>([['weekly', { kind: 'weekly', target: 3 }], ['open', { kind: 'open' }]])(
    'shows no number for a %s habit, only a neutral explanation',
    async (_name, schedule) => {
      useHabitsStore.setState({ habits: [habit({}, schedule, FOUR)] });
      await render(<HabitDetailScreen />);
      expect(rendered()).toContain('Streaks are available for habits scheduled on specific days.');
      expect(rendered()).not.toMatch(/in a row/);
      act(() => tree.unmount());
      enable();
      await render(<HabitDetailScreen />);
      expect(rendered()).toContain('It shows again when the habit is scheduled on specific days.');
      expect(rendered()).not.toMatch(/in a row/);
      expect(useHabitPreferencesStore.getState().isStreakEnabled('h1')).toBe(true); // kept, not deleted
    },
  );

  it('has a proper switch: role, checked state, label, hint and a 44pt target', async () => {
    useHabitsStore.setState({ habits: [habit({}, MW, FOUR)] });
    await render(<HabitDetailScreen />);
    const props = streakSwitch().props;
    expect(props.accessibilityRole).toBe('switch');
    expect(props.accessibilityState).toEqual({ checked: false });
    expect(props.accessibilityLabel).toBe('Show a streak for this habit');
    expect(props.accessibilityHint).toMatch(/only on this device/i);
    expect(props.style).toMatchObject({ minHeight: 44, minWidth: 44 });
    const headers = tree.root.findAll((node) => node.props.accessibilityRole === 'header').map((node) => [node.props.children].flat().join(''));
    expect(headers).toContain('Streak');
  });

  it('turns the streak on for this habit only', async () => {
    useHabitsStore.setState({ habits: [habit({}, MW, FOUR), habit({ id: 'h2', title: 'Read' }, MW, FOUR)] });
    await render(<HabitDetailScreen />);
    await act(async () => { streakSwitch().props.onValueChange(true); });
    expect(useHabitPreferencesStore.getState().streakEnabledHabitIds).toEqual(['h1']);
    expect(rendered()).toContain('4 scheduled days completed in a row');
    expect(streakSwitch().props.accessibilityState).toEqual({ checked: true });
    await act(async () => { streakSwitch().props.onValueChange(false); });
    expect(useHabitPreferencesStore.getState().streakEnabledHabitIds).toEqual([]);
    expect(rendered()).not.toMatch(/in a row/);
  });

  it('has no flame, no punitive wording and no error colour in any state', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../components/HabitStreakCard.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(source).not.toMatch(/danger|error|#[Ff]{2}0|\bred\b|confetti|SymbolView/);
    useHabitsStore.setState({ habits: [habit({}, MW, ['2026-09-28', '2026-10-07'])] }); // a gap
    enable();
    await render(<HabitDetailScreen />);
    expect(rendered()).not.toMatch(FLAME_OR_PUNITIVE);
    const icons = tree.root.findAll((node) => typeof node.props.name === 'object' && node.props.name !== null && 'ios' in node.props.name);
    expect(icons.some((node) => String(node.props.name.ios).includes('flame'))).toBe(false);
  });

  it('speaks Danish with the right plural, and every key exists in both languages', async () => {
    await i18n.changeLanguage('da');
    useHabitsStore.setState({ habits: [habit({}, MW, FOUR)] });
    enable();
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('4 planlagte dage gennemført efter hinanden');
    expect(rendered()).not.toMatch(FLAME_OR_PUNITIVE);
    act(() => tree.unmount());
    useHabitsStore.setState({ habits: [habit({ direction: 'quit' }, MW, ['2026-10-07'])] });
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('1 planlagt dag holdt efter hinanden');

    const keys = (lang: string) => Object.keys(require(`../localization/locales/${lang}/habits.json`).streak).sort();
    expect(keys('da')).toEqual(keys('en'));
    expect(keys('en')).toEqual(expect.arrayContaining(['countBuild_one', 'countBuild_other', 'countQuit_one', 'countQuit_other', 'zeroBuild', 'zeroQuit', 'ineligible', 'ineligibleEnabled']));
  });
});

describe('APP-065 every other surface stays streak-free, even with a streak turned on', () => {
  beforeEach(() => {
    useHabitsStore.setState({ habits: [habit({}, { kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] }, ['2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05'])] });
    enable();
  });

  it('the Habits list', async () => {
    await render(<HabitsScreen />);
    expect(rendered()).toContain('Walk');
    expect(rendered()).not.toMatch(/streak|in a row|🔥/i);
  });

  it('Home', async () => {
    await render(<HomeScreen />);
    expect(rendered()).not.toMatch(/streak|in a row|🔥/i);
  });

  it('Life', async () => {
    await render(<LifeScreen />);
    expect(rendered()).not.toMatch(/streak|in a row|🔥/i);
  });
});
