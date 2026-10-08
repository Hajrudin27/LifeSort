import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import i18n from '@/localization/i18n';
import type { Habit, HabitSchedule } from '@/types/life';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
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

import LifeScreen from '@/app/(tabs)/life';
import { useHabitsStore } from '@/store/useHabitsStore';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { useTodoStore } from '@/store/useTodoStore';

let tree: TestRenderer.ReactTestRenderer;
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const all = () => texts().join(' | ');
const render = async (element: React.ReactElement) => { await act(async () => { tree = TestRenderer.create(element); }); };
const setNow = (year: number, month: number, day: number, hour = 12) => jest.useFakeTimers({
  now: new Date(year, month - 1, day, hour),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'performance', 'hrtime'],
});

const THURSDAY = 4;
const habit = (id: string, schedule: HabitSchedule, entries: string[] = [], extra: Partial<Habit> = {}): Habit => ({
  id, title: `Habit ${id}`, direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-01',
  scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule }], logs: entries.map((date, i) => ({ id: `${id}-${i}`, date })), ...extra,
});
const onThursday = (...entries: string[]) => habit('thu', { kind: 'weekdays', days: [THURSDAY] }, entries);

beforeEach(async () => {
  jest.useRealTimers();
  setNow(2026, 10, 8); // Thursday
  await i18n.changeLanguage('en');
  useHabitsStore.getState().clearLocal();
  useLifeGoalsStore.getState().clearLocal();
  useTodoStore.setState({ todos: [] });
});
afterEach(() => { act(() => tree.unmount()); jest.useRealTimers(); });

describe('APP-064 Life tab', () => {
  it('shows the factual "completed scheduled habits today / scheduled habits today" and this week\'s entries', async () => {
    useHabitsStore.setState({ habits: [
      onThursday('2026-10-08', '2026-10-05'),
      habit('b', { kind: 'weekdays', days: [THURSDAY] }),
      habit('c', { kind: 'weekdays', days: [1, 2] }, ['2026-10-06']),
    ] });
    await render(<LifeScreen />);
    const list = texts();
    expect(list).toContain('1/2'); // done / scheduled today: only the two Thursday habits are asked for today
    expect(list.filter((entry) => entry === '1/2').length).toBeGreaterThanOrEqual(2); // metric card and module card
    expect(all()).toContain('Habits today');
    expect(all()).toContain('Scheduled habits completed');
    expect(all()).toContain('3 entries this week');
  });

  it('counts only weekday-scheduled habits: weekly and open habits are not "scheduled today"', async () => {
    useHabitsStore.setState({ habits: [
      habit('w', { kind: 'weekly', target: 3 }, ['2026-10-08']),
      habit('o', { kind: 'open' }, ['2026-10-08']),
    ] });
    await render(<LifeScreen />);
    expect(texts()).toContain('0/0');
    expect(all()).toContain('2 entries this week');
    expect(all()).not.toContain('Habits scheduled today');
  });

  it('a habit that has not started yet is not scheduled today', async () => {
    useHabitsStore.setState({ habits: [habit('later', { kind: 'weekdays', days: [THURSDAY] }, [], { startDate: '2026-10-09', scheduleHistory: [{ effectiveFrom: '2026-10-09', schedule: { kind: 'weekdays', days: [THURSDAY] } }] })] });
    await render(<LifeScreen />);
    expect(texts()).toContain('0/0');
  });

  it('shows a neutral focus card while scheduled habits are unmarked, and no verdict', async () => {
    useHabitsStore.setState({ habits: [onThursday(), habit('b', { kind: 'weekdays', days: [THURSDAY] })] });
    await render(<LifeScreen />);
    expect(all()).toContain('Habits scheduled today');
    expect(all()).toContain('2 habits scheduled today are not marked yet.');
    expect(all()).not.toMatch(/streak|restart|rebuild|rhythm|missed|failed|behind/i);
  });

  it('says "1 habit" in the singular', async () => {
    useHabitsStore.setState({ habits: [onThursday()] });
    await render(<LifeScreen />);
    expect(all()).toContain('1 habit scheduled today is not marked yet.');
  });

  it('the focus card falls through once every scheduled habit is marked', async () => {
    useHabitsStore.setState({ habits: [onThursday('2026-10-08')] });
    await render(<LifeScreen />);
    expect(all()).not.toContain('Habits scheduled today');
    expect(all()).toContain('Plan the next small step');
  });

  it('a past scheduled day without an entry never raises the focus card or a miss count', async () => {
    useHabitsStore.setState({ habits: [habit('mon', { kind: 'weekdays', days: [1] })] });
    await render(<LifeScreen />);
    expect(all()).not.toContain('Habits scheduled today');
    expect(all()).not.toMatch(/missed|failed|behind|overdue habit/i);
  });

  it('removes every streak surface: no "Best streak", no flame icon, no restart card', async () => {
    useHabitsStore.setState({ habits: [onThursday('2026-10-08', '2026-10-07', '2026-10-06')] });
    await render(<LifeScreen />);
    expect(all()).not.toMatch(/streak|days in a row|restart/i);
    const icons = tree.root.findAll((node) => typeof node.props.name === 'object' && node.props.name !== null && 'ios' in node.props.name)
      .map((node) => String(node.props.name.ios));
    expect(icons.some((name) => name.includes('flame'))).toBe(false);
  });

  it('is Danish with plural forms', async () => {
    await i18n.changeLanguage('da');
    useHabitsStore.setState({ habits: [onThursday(), habit('b', { kind: 'weekdays', days: [THURSDAY] }, ['2026-10-08'])] });
    await render(<LifeScreen />);
    expect(all()).toContain('Vaner planlagt i dag');
    expect(all()).toContain('1 vane planlagt i dag er ikke markeret endnu.');
    expect(all()).toContain('1 registrering denne uge');
    act(() => tree.unmount());
    useHabitsStore.setState({ habits: [onThursday(), habit('b', { kind: 'weekdays', days: [THURSDAY] }, ['2026-10-08', '2026-10-05'])] });
    await render(<LifeScreen />);
    expect(all()).toContain('2 registreringer denne uge');
  });
});
