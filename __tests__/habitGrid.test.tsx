import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import i18n from '@/localization/i18n';
import type { Habit } from '@/types/life';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'h1' }),
}));
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9', accentSoft: '#CCDDF5' }) }));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) } },
}));

import HabitMonthCalendar from '@/components/HabitMonthCalendar';
import HabitScheduleChooser from '@/components/HabitScheduleChooser';
import HabitWeekRow from '@/components/HabitWeekRow';
import {
  CARD_BORDER, CARD_PADDING, CELL_INSET, columnWidth, GRID_BLEED, GRID_COLUMNS, MIN_TARGET,
  NARROWEST_FULL_TARGET_SCREEN, SCREEN_PADDING,
} from '@/components/habitGrid';
import { sharedStyles } from '@/constants/sharedStyles';
import { useHabitsStore } from '@/store/useHabitsStore';

const habit: Habit = {
  id: 'h1', title: 'Walk', direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-28',
  scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: { kind: 'weekdays', days: [1, 3] } }], logs: [],
};
let tree: TestRenderer.ReactTestRenderer | undefined;
const unmount = () => { if (tree) act(() => tree!.unmount()); tree = undefined; };
const style = (node: TestRenderer.ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};
/** The nearest ancestor that draws a grid row: the one that bleeds into the card. */
const rowOf = (node: TestRenderer.ReactTestInstance) => {
  for (let current = node.parent; current; current = current.parent) {
    if (style(current).marginHorizontal === -GRID_BLEED) return current;
  }
  return undefined;
};
const checkboxes = () => tree!.root.findAll((node) => node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function');

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date(2026, 9, 8, 12), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'performance', 'hrtime'] });
  await i18n.changeLanguage('en');
  useHabitsStore.setState({ habits: [habit] });
});
afterEach(() => { unmount(); jest.useRealTimers(); });

describe('seven-column grid geometry (APP-064 accessibility)', () => {
  it('uses the real layout numbers: these constants are the screen and card padding the grids sit in', () => {
    expect(SCREEN_PADDING).toBe(sharedStyles.formContainer.padding);
    expect(SCREEN_PADDING).toBe(sharedStyles.formContainerScroll.padding);
    expect(CARD_BORDER).toBe(1);
    expect(CARD_PADDING).toBe(16);
    expect(GRID_COLUMNS).toBe(7);
    expect(MIN_TARGET).toBe(44);
  });

  it('a column is at least 44pt wide from a 358pt-wide screen upward, and the threshold is stated exactly', () => {
    // (W - 2*16 - 2*1 - 2*16 + 2*8) / 7 >= 44  <=>  W >= 358
    expect(NARROWEST_FULL_TARGET_SCREEN).toBe(358);
    for (const [width, label] of [[360, 'small Android'], [375, 'iPhone SE / mini'], [390, 'iPhone 14'], [393, 'iPhone 15'], [412, 'Pixel 7'], [430, 'Pro Max']] as const) {
      expect({ label, ok: columnWidth(width) >= MIN_TARGET }).toEqual({ label, ok: true });
    }
    expect(columnWidth(358)).toBeGreaterThanOrEqual(44);
    expect(columnWidth(357)).toBeLessThan(44);
  });

  it('is honest below that: a 320pt-wide phone does NOT get a 44pt-wide column (recorded for manual QA, not claimed)', () => {
    expect(columnWidth(320)).toBeCloseTo(38.57, 1);
    expect(columnWidth(320)).toBeLessThan(MIN_TARGET);
  });

  it('the old layout would not have met it on common phones (the reason for the bleed)', () => {
    const oldWidth = (w: number) => (w - 2 * 16 - 2 * 1 - 2 * 16 - 6 * 4) / 7; // 16pt card padding, 4pt gaps between cells
    expect(oldWidth(390)).toBeCloseTo(42.86, 1);
    expect(oldWidth(360)).toBeLessThan(40);
  });

  it('the week row bleeds into the card and has no gap between tap areas', async () => {
    await act(async () => { tree = TestRenderer.create(<HabitWeekRow habit={habit} today="2026-10-08" />); });
    const cells = checkboxes();
    expect(cells).toHaveLength(7);
    const row = rowOf(cells[0])!;
    expect(row).toBeDefined();
    expect(style(row)).toMatchObject({ flexDirection: 'row', marginHorizontal: -GRID_BLEED });
    expect(style(row).gap).toBeUndefined();
    expect(new Set(cells.map(rowOf)).size).toBe(1);
    for (const cell of cells) expect(style(cell)).toMatchObject({ flex: 1, minHeight: MIN_TARGET, padding: CELL_INSET });
  });

  it('the month calendar and the weekday chooser use the same geometry', async () => {
    await act(async () => { tree = TestRenderer.create(<HabitMonthCalendar habit={habit} />); });
    const weeks = new Set(checkboxes().map(rowOf));
    expect(weeks.has(undefined)).toBe(false);
    expect(weeks.size).toBeGreaterThanOrEqual(5);
    for (const week of weeks) expect(style(week!)).toMatchObject({ flexDirection: 'row', marginHorizontal: -GRID_BLEED });
    for (const cell of checkboxes()) expect(style(cell)).toMatchObject({ minHeight: MIN_TARGET, padding: CELL_INSET });
    unmount();

    await act(async () => {
      tree = TestRenderer.create(<HabitScheduleChooser value={{ choice: 'selectedDays', days: [1], weeklyText: '' }} onChange={() => undefined} />);
    });
    const days = checkboxes();
    expect(days).toHaveLength(7);
    expect(new Set(days.map(rowOf)).size).toBe(1);
    expect(style(rowOf(days[0])!)).toMatchObject({ flexDirection: 'row', marginHorizontal: -GRID_BLEED });
    for (const day of days) expect(style(day)).toMatchObject({ minHeight: MIN_TARGET, padding: CELL_INSET });
  });

  it('the grid containers are transparent, so the bleed cannot show as a band on the card (dark mode)', async () => {
    await act(async () => { tree = TestRenderer.create(<HabitWeekRow habit={habit} today="2026-10-08" />); });
    expect(style(rowOf(checkboxes()[0])!).backgroundColor).toBeUndefined();
  });
});
