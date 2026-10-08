import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, StyleSheet, Text, TextInput } from 'react-native';

import i18n from '@/localization/i18n';
import type { Habit } from '@/types/life';

let mockParams: { id?: string } = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => options?.headerRight?.() ?? null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9', accentSoft: '#CCDDF5' }) }));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) } },
}));

import HabitDetailScreen from '@/app/habits/[id]';
import HabitsScreen from '@/app/habits/index';
import NewHabitScreen from '@/app/habits/new';
import { useHabitsStore } from '@/store/useHabitsStore';

const mockRouter = jest.requireMock('expo-router').router as { push: jest.Mock; replace: jest.Mock; back: jest.Mock };
let tree: TestRenderer.ReactTestRenderer;
const nodeText = (node: TestRenderer.ReactTestInstance) => node.findAllByType(Text).map((text) => [text.props.children].flat().join('')).join('');
const rendered = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' | ');
const buttons = () => tree.root.findAll((node) => (node.props.accessibilityRole === 'button' || node.props.accessibilityRole === 'radio') && typeof node.props.onPress === 'function');
const button = (label: string) => buttons().find((node) => nodeText(node) === label || node.props.accessibilityLabel === label);
const press = async (label: string) => {
  const node = button(label);
  expect(node).toBeDefined();
  await act(async () => { node!.props.onPress(); });
};
const withRole = (role: string) => tree.root.findAll((node) => node.props.accessibilityRole === role && typeof node.props.onPress === 'function');
const cell = (labelPart: RegExp) => withRole('checkbox').find((node) => labelPart.test(String(node.props.accessibilityLabel)));
const input = (label: string) => tree.root.findAll((node) => node.type === TextInput && node.props.accessibilityLabel === label)[0];
const type = async (label: string, value: string) => {
  const field = input(label);
  expect(field).toBeDefined();
  await act(async () => { field.props.onChangeText(value); });
};
const render = async (element: React.ReactElement) => { await act(async () => { tree = TestRenderer.create(element); }); };
const habits = () => useHabitsStore.getState().habits;
const isDisabled = (node: TestRenderer.ReactTestInstance) => node.props.accessibilityState?.disabled === true || node.props.disabled === true;
/** Only `Date` is faked, so promises and the AsyncStorage mock keep running for real. */
const setNow = (year: number, month: number, day: number, hour = 12) => jest.useFakeTimers({
  now: new Date(year, month - 1, day, hour),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'performance', 'hrtime'],
});

const EVERY_DAY = { kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] } as const;
const habit = (extra: Partial<Habit> = {}): Habit => ({
  id: 'h1', title: 'Walk', direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-28',
  scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: { kind: 'weekdays', days: [1, 3] } }], logs: [], ...extra,
});
const THURSDAY = [2026, 10, 8] as const;

beforeEach(async () => {
  jest.useRealTimers();
  setNow(...THURSDAY);
  mockParams = {};
  mockRouter.push.mockClear(); mockRouter.replace.mockClear(); mockRouter.back.mockClear();
  await i18n.changeLanguage('en');
  useHabitsStore.getState().clearLocal();
});
afterEach(() => { act(() => tree.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });

describe('APP-064 new habit screen', () => {
  it('offers both directions with a plain explanation of what marking means, and the four schedule choices', async () => {
    await render(<NewHabitScreen />);
    for (const label of ['Habit to build', 'Habit to quit', 'Every day', 'Selected days', 'Times a week', 'No fixed schedule']) {
      expect(button(label)).toBeDefined();
    }
    expect(rendered()).toContain('You mark a day when you did it.');
    await press('Habit to quit');
    expect(rendered()).toContain('You mark a day when you kept your commitment and held off.');
  });

  it('has no start-date picker and no streak or health wording', async () => {
    await render(<NewHabitScreen />);
    expect(rendered()).not.toMatch(/start date|streak|restart|failed|bad day|medical|withdraw|treatment|relapse/i);
    expect(tree.root.findAll((node) => node.props.accessibilityRole === 'adjustable').length).toBe(0);
  });

  it('exposes the schedule as a radio group and the weekdays as checkboxes with full names', async () => {
    await render(<NewHabitScreen />);
    expect(tree.root.findAll((node) => node.props.accessibilityRole === 'radiogroup').length).toBeGreaterThan(0);
    const radios = withRole('radio');
    expect(radios.map((node) => nodeText(node))).toEqual(expect.arrayContaining(['Habit to build', 'Every day', 'Selected days']));
    expect(radios.find((node) => nodeText(node) === 'Every day')!.props.accessibilityState).toMatchObject({ checked: true });
    await press('Selected days');
    const days = withRole('checkbox').map((node) => node.props.accessibilityLabel);
    expect(days).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  });

  it('keeps Save disabled for a blank title and never reaches the store', async () => {
    await render(<NewHabitScreen />);
    expect(isDisabled(button('Save')!)).toBe(true);
    await act(async () => { button('Save')!.props.onPress(); }); // even a forced press must not create anything
    expect(habits()).toEqual([]);
  });

  it('saves "every day" by default: all seven weekdays, build, counting from today', async () => {
    await render(<NewHabitScreen />);
    await type('Title (e.g. Run for 20 minutes)', '  Morning walk ');
    expect(isDisabled(button('Save')!)).toBe(false);
    await press('Save');
    expect(habits()).toMatchObject([{
      title: 'Morning walk', direction: 'build', startDate: '2026-10-08',
      scheduleHistory: [{ effectiveFrom: '2026-10-08', schedule: EVERY_DAY }], logs: [],
    }]);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('selected days: blocked until a day is picked, then saved in ascending order; a quit habit keeps its direction', async () => {
    await render(<NewHabitScreen />);
    await type('Title (e.g. Run for 20 minutes)', 'No sugar');
    await press('Habit to quit');
    await press('Selected days');
    expect(rendered()).toContain('Pick at least one day.');
    expect(isDisabled(button('Save')!)).toBe(true);
    const pick = async (name: string) => act(async () => { withRole('checkbox').find((node) => node.props.accessibilityLabel === name)!.props.onPress(); });
    await pick('Wednesday');
    await pick('Monday');
    expect(rendered()).not.toContain('Pick at least one day.');
    await press('Save');
    expect(habits()).toMatchObject([{ direction: 'quit', scheduleHistory: [{ schedule: { kind: 'weekdays', days: [1, 3] } }] }]);
  });

  it('times a week: only 1 to 7 is accepted, anything else is announced and blocks Save', async () => {
    await render(<NewHabitScreen />);
    await type('Title (e.g. Run for 20 minutes)', 'Gym');
    await press('Times a week');
    expect(isDisabled(button('Save')!)).toBe(true);
    for (const bad of ['0', '8', '9', '2.5', 'a', '-1', ' ', '12']) {
      await type('Times per week (1–7)', bad);
      expect(isDisabled(button('Save')!)).toBe(true);
      await act(async () => { button('Save')!.props.onPress(); });
      expect(habits()).toEqual([]);
    }
    await type('Times per week (1–7)', 'x');
    expect(rendered()).toContain('Enter a whole number from 1 to 7.');
    await type('Times per week (1–7)', '3');
    expect(rendered()).not.toContain('Enter a whole number');
    await press('Save');
    expect(habits()).toMatchObject([{ scheduleHistory: [{ schedule: { kind: 'weekly', target: 3 } }] }]);
  });

  it('no fixed schedule is selectable for a new habit', async () => {
    await render(<NewHabitScreen />);
    await type('Title (e.g. Run for 20 minutes)', 'Read');
    await press('No fixed schedule');
    await press('Save');
    expect(habits()).toMatchObject([{ scheduleHistory: [{ schedule: { kind: 'open' } }] }]);
  });

  it('works in Danish', async () => {
    await i18n.changeLanguage('da');
    await render(<NewHabitScreen />);
    for (const label of ['Vane jeg vil opbygge', 'Vane jeg vil af med', 'Hver dag', 'Valgte dage', 'Gange om ugen', 'Ingen fast tidsplan']) {
      expect(button(label)).toBeDefined();
    }
    expect(rendered()).toContain('Du markerer en dag, når du har gjort det.');
  });
});

describe('APP-064 habits list', () => {
  it('shows the empty state', async () => {
    await render(<HabitsScreen />);
    expect(rendered()).toContain('No habits yet');
  });

  it('summarises each schedule kind and today in neutral words, with no streak and no miss count', async () => {
    useHabitsStore.setState({ habits: [
      habit({ id: 'a', title: 'Mon+Wed' }),
      habit({ id: 'b', title: 'Everyday', scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: EVERY_DAY as never }] }),
      habit({ id: 'c', title: 'Weekly', scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: { kind: 'weekly', target: 3 } }] }),
      habit({ id: 'd', title: 'Open', scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: { kind: 'open' } }] }),
    ] });
    await render(<HabitsScreen />);
    const text = rendered();
    for (const expected of ['Mon, Wed', 'Every day', '3 times a week', 'No fixed schedule', 'Not scheduled today', 'Scheduled today', 'No entry today']) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(/streak|in a row|missed|failed|broken/i);
  });

  it('announces a change that is waiting for Monday', async () => {
    useHabitsStore.setState({ habits: [habit({ scheduleHistory: [
      { effectiveFrom: '2026-09-28', schedule: { kind: 'weekdays', days: [1, 3] } },
      { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 3 } },
    ] })] });
    await render(<HabitsScreen />);
    expect(rendered()).toMatch(/From Oct 12: 3 times a week/);
    expect(rendered()).toContain('Mon, Wed');
  });

  it('draws the ISO week with a full spoken label on every real date', async () => {
    useHabitsStore.setState({ habits: [habit({ logs: [{ id: 'l', date: '2026-10-05' }] })] });
    await render(<HabitsScreen />);
    const labels = withRole('checkbox').map((node) => String(node.props.accessibilityLabel));
    expect(labels).toEqual([
      'Monday, October 5, scheduled, completed',
      'Tuesday, October 6, not scheduled, no entry',
      'Wednesday, October 7, scheduled, not completed',
      'Thursday, October 8, not scheduled, no entry',
      'Friday, October 9, upcoming',
      'Saturday, October 10, upcoming',
      'Sunday, October 11, upcoming',
    ]);
  });

  it('marks and clears a real date, and refuses upcoming days', async () => {
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitsScreen />);
    const friday = () => cell(/Friday, October 9/)!;
    expect(isDisabled(friday())).toBe(true);
    await act(async () => { friday().props.onPress(); });
    expect(habits()[0].logs).toEqual([]);

    const wednesday = () => cell(/Wednesday, October 7/)!;
    expect(wednesday().props.accessibilityState).toMatchObject({ checked: false, disabled: false });
    expect(wednesday().props.accessibilityHint).toBe('Double tap to mark this day as completed.');
    await act(async () => { wednesday().props.onPress(); });
    expect(habits()[0].logs).toMatchObject([{ date: '2026-10-07' }]);
    expect(wednesday().props.accessibilityState).toMatchObject({ checked: true });
    expect(wednesday().props.accessibilityHint).toBe('Double tap to clear this day.');
    await act(async () => { wednesday().props.onPress(); });
    expect(habits()[0].logs).toEqual([]);
  });

  it('a quit habit says "kept", never "completed"', async () => {
    useHabitsStore.setState({ habits: [habit({ direction: 'quit', logs: [{ id: 'l', date: '2026-10-05' }] })] });
    await render(<HabitsScreen />);
    expect(String(cell(/Monday, October 5/)!.props.accessibilityLabel)).toBe('Monday, October 5, scheduled, kept');
    expect(String(cell(/Wednesday, October 7/)!.props.accessibilityLabel)).toBe('Wednesday, October 7, scheduled, not marked as kept');
  });

  it('disables days before the habit started', async () => {
    useHabitsStore.setState({ habits: [habit({ startDate: '2026-10-07', scheduleHistory: [{ effectiveFrom: '2026-10-07', schedule: { kind: 'open' } }] })] });
    await render(<HabitsScreen />);
    const tuesday = cell(/Tuesday, October 6/)!;
    expect(String(tuesday.props.accessibilityLabel)).toBe('Tuesday, October 6, before start');
    expect(isDisabled(tuesday)).toBe(true);
  });

  it('every cell is a 44pt-tall checkbox and the glyphs tell the states apart without colour', async () => {
    useHabitsStore.setState({ habits: [habit({ logs: [{ id: 'l', date: '2026-10-05' }] })] });
    await render(<HabitsScreen />);
    const week = withRole('checkbox');
    expect(week).toHaveLength(7);
    for (const node of week) expect(StyleSheet.flatten(node.props.style).minHeight).toBeGreaterThanOrEqual(44);
    const glyphs = week.map((node) => node.findAllByType(Text).map((text) => text.props.children)[1]);
    expect(glyphs[0]).toBe('✓'); // completed
    expect(glyphs[2]).toBe('–'); // scheduled Wednesday, not completed
    expect(glyphs[1]).toBe('·'); // nothing expected
  });

  it('is in Danish too, with full Danish date labels', async () => {
    await i18n.changeLanguage('da');
    useHabitsStore.setState({ habits: [habit({ logs: [{ id: 'l', date: '2026-10-05' }] })] });
    await render(<HabitsScreen />);
    expect(String(withRole('checkbox')[0].props.accessibilityLabel)).toBe('mandag 5. oktober, planlagt, gennemført');
    expect(rendered()).toContain('man, ons');
  });

  it('opens the detail screen from the title', async () => {
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitsScreen />);
    const title = buttons().find((node) => nodeText(node).startsWith('Walk'));
    expect(title).toBeDefined();
    await act(async () => { title!.props.onPress(); });
    expect(mockRouter.push).toHaveBeenCalledWith('/habits/h1');
  });
});

describe('APP-064 habit detail', () => {
  beforeEach(() => { mockParams = { id: 'h1' }; });

  it('shows direction, schedule, start, today, the week fact and a direction-specific mark button', async () => {
    useHabitsStore.setState({ habits: [habit({ logs: [{ id: 'l', date: '2026-10-05' }] })] });
    await render(<HabitDetailScreen />);
    const text = rendered();
    for (const expected of ['Habit to build', 'Mon, Wed', 'Counting from Sep 28', 'Not scheduled today', '1 of 2 scheduled days this week']) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(/streak|in a row|log today/i);
    expect(button('Mark completed')).toBeDefined();
  });

  it('marks and clears today from the button; a quit habit says "kept"', async () => {
    useHabitsStore.setState({ habits: [habit({ direction: 'quit' })] });
    await render(<HabitDetailScreen />);
    await press('Mark kept');
    expect(habits()[0].logs).toMatchObject([{ date: '2026-10-08' }]);
    expect(rendered()).toContain('Kept today');
    await press('Clear kept');
    expect(habits()[0].logs).toEqual([]);
    expect(button('Mark kept')).toBeDefined();
  });

  it('weekly habits show "N of target this week"; open habits show an entry count with no denominator', async () => {
    useHabitsStore.setState({ habits: [habit({ scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: { kind: 'weekly', target: 3 } }], logs: [{ id: 'a', date: '2026-10-05' }, { id: 'b', date: '2026-10-06' }] })] });
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('2 of 3 this week');
    act(() => tree.unmount());
    useHabitsStore.setState({ habits: [habit({ scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: { kind: 'open' } }], logs: [{ id: 'a', date: '2026-10-05' }] })] });
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('1 entry this week');
  });

  it('shows the history calendar for the current month with a legend, and moves between months with real targets', async () => {
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('October 2026');
    expect(withRole('checkbox').length).toBeGreaterThanOrEqual(31);
    for (const word of ['✓ Completed / kept', '– Not completed', '○ Scheduled today', '· Nothing expected', '┄ Upcoming']) expect(rendered()).toContain(word);
    const previous = button('Previous month')!;
    const next = button('Next month')!;
    expect(isDisabled(next)).toBe(true); // nothing after today's month
    expect(isDisabled(previous)).toBe(false); // September holds the start date
    for (const nav of [previous, next]) {
      const style = StyleSheet.flatten(nav.props.style);
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
    await act(async () => { previous.props.onPress(); });
    expect(rendered()).toContain('September 2026');
    expect(isDisabled(button('Previous month')!)).toBe(true); // the start month is the first month
    // Days before the 28th are before the start.
    expect(String(cell(/Sunday, September 27/)!.props.accessibilityLabel)).toBe('Sunday, September 27, before start');
    expect(isDisabled(cell(/Sunday, September 27/)!)).toBe(true);
  });

  it('lets the user correct any earlier day in the calendar', async () => {
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitDetailScreen />);
    await act(async () => { button('Previous month')!.props.onPress(); });
    await act(async () => { cell(/Tuesday, September 29/)!.props.onPress(); });
    expect(habits()[0].logs).toMatchObject([{ date: '2026-09-29' }]);
    await act(async () => { cell(/Tuesday, September 29/)!.props.onPress(); });
    expect(habits()[0].logs).toEqual([]);
  });

  it('can reach and clear an entry dated in the future that arrived from elsewhere', async () => {
    useHabitsStore.setState({ habits: [habit({ logs: [{ id: 'f', date: '2026-12-05' }] })] });
    await render(<HabitDetailScreen />);
    for (let i = 0; i < 2; i += 1) await act(async () => { button('Next month')!.props.onPress(); });
    expect(rendered()).toContain('December 2026');
    const future = cell(/Saturday, December 5/)!;
    expect(String(future.props.accessibilityLabel)).toBe('Saturday, December 5, upcoming, completed');
    expect(isDisabled(future)).toBe(false);
    await act(async () => { future.props.onPress(); });
    expect(habits()[0].logs).toEqual([]);
  });

  it('shows a message for a habit that no longer exists', async () => {
    mockParams = { id: 'missing' };
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('No habits yet');
  });

  it('works in Danish', async () => {
    await i18n.changeLanguage('da');
    useHabitsStore.setState({ habits: [habit({ direction: 'quit' })] });
    await render(<HabitDetailScreen />);
    expect(rendered()).toContain('Vane jeg vil af med');
    expect(rendered()).toContain('oktober 2026');
    expect(button('Markér som holdt')).toBeDefined();
    expect(rendered()).toContain('Tæller fra 28. sep.');
  });
});

describe('APP-064 editing a habit', () => {
  beforeEach(() => { mockParams = { id: 'h1' }; });
  const openEdit = async () => { await press('Edit'); };
  const pickDay = async (name: string) => act(async () => { withRole('checkbox').find((node) => node.props.accessibilityLabel === name)!.props.onPress(); });

  it('prefills the title, direction and current schedule', async () => {
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitDetailScreen />);
    await openEdit();
    expect(input('Title (e.g. Run for 20 minutes)').props.value).toBe('Walk');
    expect(withRole('radio').find((node) => nodeText(node) === 'Selected days')!.props.accessibilityState).toMatchObject({ checked: true });
    expect(withRole('checkbox').filter((node) => node.props.accessibilityState?.checked).map((node) => node.props.accessibilityLabel)).toEqual(['Monday', 'Wednesday']);
  });

  it('a weekday change on a Wednesday applies today and says so', async () => {
    setNow(2026, 10, 7);
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitDetailScreen />);
    await openEdit();
    await pickDay('Friday');
    expect(rendered()).toContain('A new schedule applies from today. Earlier days keep the schedule they had.');
    await press('Save');
    expect(habits()[0].scheduleHistory).toEqual([
      { effectiveFrom: '2026-09-28', schedule: { kind: 'weekdays', days: [1, 3] } },
      { effectiveFrom: '2026-10-07', schedule: { kind: 'weekdays', days: [1, 3, 5] } },
    ]);
  });

  it('a weekly change on a Wednesday applies next Monday and says so; the pending change is shown afterwards', async () => {
    setNow(2026, 10, 7);
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitDetailScreen />);
    await openEdit();
    await press('Times a week');
    await type('Times per week (1–7)', '3');
    expect(rendered()).toContain('Changes to weekly schedules apply next Monday.');
    await press('Save');
    expect(habits()[0].scheduleHistory).toEqual([
      { effectiveFrom: '2026-09-28', schedule: { kind: 'weekdays', days: [1, 3] } },
      { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 3 } },
    ]);
    expect(rendered()).toContain('From Oct 12: 3 times a week');
    expect(rendered()).toContain('Mon, Wed'); // this week still follows the old schedule
  });

  it('a weekly change on a Monday applies today', async () => {
    setNow(2026, 10, 5);
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitDetailScreen />);
    await openEdit();
    await press('Times a week');
    await type('Times per week (1–7)', '2');
    expect(rendered()).toContain('A new schedule applies from today.');
    expect(rendered()).not.toContain('apply next Monday');
    await press('Save');
    expect(habits()[0].scheduleHistory[1]).toEqual({ effectiveFrom: '2026-10-05', schedule: { kind: 'weekly', target: 2 } });
  });

  it('shows no effective-date note when the schedule is unchanged, and keeps Save off for an invalid one', async () => {
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitDetailScreen />);
    await openEdit();
    expect(rendered()).not.toMatch(/applies from today|apply next Monday/);
    await press('Selected days');
    await pickDay('Monday');
    await pickDay('Wednesday');
    expect(isDisabled(button('Save')!)).toBe(true);
    expect(rendered()).toContain('Pick at least one day.');
  });

  it('the direction can be changed while there are no entries', async () => {
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitDetailScreen />);
    await openEdit();
    await press('Habit to quit');
    await press('Save');
    expect(habits()[0].direction).toBe('quit');
  });

  it('the direction is locked once an entry exists, and the screen explains why', async () => {
    useHabitsStore.setState({ habits: [habit({ logs: [{ id: 'l', date: '2026-10-05' }] })] });
    await render(<HabitDetailScreen />);
    await openEdit();
    const quit = withRole('radio').find((node) => nodeText(node) === 'Habit to quit')!;
    expect(isDisabled(quit)).toBe(true);
    expect(rendered()).toContain("The type can't be changed once a day has been marked.");
    await act(async () => { quit.props.onPress(); });
    await press('Save');
    expect(habits()[0].direction).toBe('build');
  });

  it('renames the habit', async () => {
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitDetailScreen />);
    await openEdit();
    await type('Title (e.g. Run for 20 minutes)', '  Evening walk ');
    await press('Save');
    expect(habits()[0].title).toBe('Evening walk');
  });

  it('deletes only after confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    useHabitsStore.setState({ habits: [habit()] });
    await render(<HabitDetailScreen />);
    await openEdit();
    await press('Delete');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(habits()).toHaveLength(1);
    const buttonsArg = alert.mock.calls[0][2]!;
    act(() => buttonsArg.find((entry) => entry.style === 'destructive')!.onPress!());
    expect(habits()).toEqual([]);
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
