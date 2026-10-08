import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { defaultDetail, isMaskable } from '@/core/modules/homePrivacy';
import { getModule } from '@/core/modules/moduleRegistry';
import { HOME_SNAPSHOT_PROVIDERS } from '@/features/homeSnapshots';
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

import HomeScreen from '@/app/(tabs)/index';
import { useHabitsStore } from '@/store/useHabitsStore';

let tree: TestRenderer.ReactTestRenderer;
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const all = () => texts().join(' | ');
const render = async () => { await act(async () => { tree = TestRenderer.create(<HomeScreen />); }); };
const chip = (title: string) => tree.root.findAll((node) => node.props.accessibilityRole === 'checkbox' && String(node.props.accessibilityLabel).startsWith(`${title},`))[0];
const setNow = (year: number, month: number, day: number, hour = 12) => jest.useFakeTimers({
  now: new Date(year, month - 1, day, hour),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'performance', 'hrtime'],
});

const habit = (id: string, schedule: HabitSchedule, entries: string[] = [], extra: Partial<Habit> = {}): Habit => ({
  id, title: `Habit ${id}`, direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-01',
  scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule }], logs: entries.map((date, i) => ({ id: `${id}-${i}`, date })), ...extra,
});

beforeEach(async () => {
  jest.useRealTimers();
  setNow(2026, 10, 8); // Thursday
  await i18n.changeLanguage('en');
  useHabitsStore.getState().clearLocal();
});
afterEach(() => { act(() => tree.unmount()); jest.useRealTimers(); });

describe('APP-064 Home tab', () => {
  it('has no streak hero, however long the run of entries', async () => {
    useHabitsStore.setState({ habits: [habit('a', { kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] }, ['2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05'])] });
    await render();
    expect(all()).not.toMatch(/streak|🔥|in a row/i);
  });

  it('"Habits today" uses the canonical status: marking is an explicit outcome and a second tap clears it', async () => {
    useHabitsStore.setState({ habits: [habit('a', { kind: 'weekdays', days: [4] })] });
    await render();
    expect(chip('Habit a').props.accessibilityLabel).toBe('Habit a, Scheduled today');
    expect(chip('Habit a').props.accessibilityState).toMatchObject({ checked: false });
    await act(async () => { chip('Habit a').props.onPress(); });
    expect(useHabitsStore.getState().habits[0].logs).toMatchObject([{ date: '2026-10-08' }]);
    expect(chip('Habit a').props.accessibilityState).toMatchObject({ checked: true });
    expect(chip('Habit a').props.accessibilityLabel).toBe('Habit a, Completed today');
    await act(async () => { chip('Habit a').props.onPress(); });
    expect(useHabitsStore.getState().habits[0].logs).toEqual([]);
  });

  it('a quit habit reads "Kept today"', async () => {
    useHabitsStore.setState({ habits: [habit('q', { kind: 'weekdays', days: [4] }, ['2026-10-08'], { direction: 'quit' })] });
    await render();
    expect(chip('Habit q').props.accessibilityLabel).toBe('Habit q, Kept today');
  });

  it('weekly and open habits can be marked today too, and say nothing is expected', async () => {
    useHabitsStore.setState({ habits: [habit('w', { kind: 'weekly', target: 3 }), habit('o', { kind: 'open' })] });
    await render();
    expect(chip('Habit w').props.accessibilityLabel).toBe('Habit w, No entry today');
    await act(async () => { chip('Habit o').props.onPress(); });
    expect(useHabitsStore.getState().habits[1].logs).toMatchObject([{ date: '2026-10-08' }]);
  });

  it('cannot mark a habit that starts tomorrow (the chip is disabled)', async () => {
    useHabitsStore.setState({ habits: [habit('later', { kind: 'open' }, [], { startDate: '2026-10-09', scheduleHistory: [{ effectiveFrom: '2026-10-09', schedule: { kind: 'open' } }] })] });
    await render();
    expect(chip('Habit later').props.accessibilityState).toMatchObject({ disabled: true });
    expect(chip('Habit later').props.accessibilityLabel).toContain('Starts Oct 9');
  });

  it('summarises only scheduled habits: "X of Y scheduled today"', async () => {
    useHabitsStore.setState({ habits: [
      habit('a', { kind: 'weekdays', days: [4] }, ['2026-10-08']),
      habit('b', { kind: 'weekdays', days: [4] }),
      habit('c', { kind: 'weekly', target: 2 }, ['2026-10-08']),
    ] });
    await render();
    expect(all()).toContain('1 of 2 scheduled today');
  });

  it('shows no summary line when nothing is scheduled today', async () => {
    useHabitsStore.setState({ habits: [habit('w', { kind: 'weekly', target: 2 })] });
    await render();
    expect(all()).not.toContain('scheduled today');
  });

  it('this week: weekdays show completed scheduled of scheduled, weekly shows against the target, open shows a count', async () => {
    useHabitsStore.setState({ habits: [
      habit('d', { kind: 'weekdays', days: [1, 3, 5] }, ['2026-10-05', '2026-10-07', '2026-10-06']),
      habit('w', { kind: 'weekly', target: 3 }, ['2026-10-05', '2026-10-06']),
      habit('o', { kind: 'open' }, ['2026-10-05']),
    ] });
    await render();
    const text = all();
    expect(text).toContain('2 of 3 scheduled days this week · 1 more entry on other days');
    expect(text).toContain('2 of 3 this week');
    expect(text).toContain('1 entry this week');
    expect(text).not.toMatch(/\/7/);
  });

  it('this week does not count last week or an entry dated in the future', async () => {
    useHabitsStore.setState({ habits: [habit('o', { kind: 'open' }, ['2026-10-04', '2026-10-09', '2099-01-01'])] });
    await render();
    expect(all()).toContain('0 entries this week');
  });

  it('a weekly change that waits for Monday does not change this week\'s card, and takes over on that Monday', async () => {
    const pending = habit('p', { kind: 'weekdays', days: [1, 3] }, ['2026-10-05'], {
      scheduleHistory: [
        { effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [1, 3] } },
        { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 3 } },
      ],
    });
    useHabitsStore.setState({ habits: [pending] });
    await render();
    expect(all()).toContain('1 of 2 scheduled days this week'); // Thursday 8 October: still Monday + Wednesday
    expect(all()).not.toContain('of 3 this week');
    act(() => tree.unmount());
    setNow(2026, 10, 12); // the Monday it takes effect
    await render();
    expect(all()).toContain('0 of 3 this week');
    expect(all()).not.toContain('scheduled days this week');
  });

  it('a schedule changed in the middle of the week is counted day by day on the card', async () => {
    const changed = habit('c', { kind: 'weekdays', days: [1, 2] }, ['2026-10-05', '2026-10-07'], {
      scheduleHistory: [
        { effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [1, 2] } },
        { effectiveFrom: '2026-10-07', schedule: { kind: 'weekdays', days: [3, 4] } },
      ],
    });
    useHabitsStore.setState({ habits: [changed] });
    await render();
    // Mon + Tue under the old schedule, Wed + Thu under the new one: four scheduled days, two with an entry.
    expect(all()).toContain('2 of 4 scheduled days this week');
  });

  it('turns over on Monday', async () => {
    setNow(2026, 10, 12);
    useHabitsStore.setState({ habits: [habit('o', { kind: 'open' }, ['2026-10-11'])] });
    await render();
    expect(all()).toContain('0 entries this week');
  });

  it('is Danish', async () => {
    await i18n.changeLanguage('da');
    useHabitsStore.setState({ habits: [habit('d', { kind: 'weekdays', days: [4] }, [])] });
    await render();
    expect(all()).toContain('0 af 1 planlagt i dag');
    expect(all()).toContain('0 af 1 planlagte dage denne uge');
  });
});

describe('APP-064 classification', () => {
  it('Habits are personal, not ordinary, and therefore maskable wherever a card exists', () => {
    expect(getModule('habits').sensitivity).toEqual(['personal']);
    expect(getModule('habits').sensitivity).not.toContain('ordinary');
    expect(isMaskable(getModule('habits').sensitivity[0])).toBe(true);
  });

  it('masking belongs to a Home SNAPSHOT TILE (docs/home-snapshots.md); Habits has none, so classification alone masks nothing here', async () => {
    // The Today and Week cards are Home's own content, like to-do titles and the trip names in invitations.
    const provider = (HOME_SNAPSHOT_PROVIDERS as Record<string, (() => Promise<{ sensitivity: string } | null>) | undefined>).habits;
    if (provider) {
      // If a Habits tile is ever added, it must carry the module's classification and so be maskable.
      const snapshot = await provider();
      expect(snapshot?.sensitivity).toBe('personal');
    } else {
      expect(Object.keys(HOME_SNAPSHOT_PROVIDERS)).not.toContain('habits');
    }
    // `personal` shows in full by default (only health starts masked), so reclassifying changes no visible default.
    expect(defaultDetail('personal')).toBe('full');
    expect(defaultDetail('ordinary')).toBe('full');
    expect(isMaskable('ordinary')).toBe(false);
    expect(isMaskable('personal')).toBe(true);
  });
});
