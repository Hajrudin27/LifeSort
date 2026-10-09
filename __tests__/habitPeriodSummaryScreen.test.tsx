import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import i18n from '@/localization/i18n';
import type { Habit, HabitSchedule } from '@/types/life';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => require('react').createElement(require('react-native').View, props),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9', accentSoft: '#CCDDF5' }) }));

import HabitsScreen from '@/app/habits/index';
import { useHabitsStore } from '@/store/useHabitsStore';

let tree: TestRenderer.ReactTestRenderer;
const rendered = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' | ');
const render = async () => { await act(async () => { tree = TestRenderer.create(<HabitsScreen />); }); };
const setNow = (year: number, month: number, day: number, hour = 12) => jest.useFakeTimers({
  now: new Date(year, month - 1, day, hour),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'performance', 'hrtime'],
});
const radios = () => tree.root.findAll((node) => node.props.accessibilityRole === 'radio' && typeof node.props.label === 'string');
const radio = (label: string) => radios().find((node) => node.props.label === label)!;

const MWF: HabitSchedule = { kind: 'weekdays', days: [1, 3, 5] };
const habit = (schedule: HabitSchedule, dates: string[], extra: Partial<Habit> = {}): Habit => ({
  id: 'h1', title: 'Walk', direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-01',
  scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule }], logs: dates.map((date, i) => ({ id: `l${i}`, date })), ...extra,
});

const PUNITIVE = /great job|bad week|failed|failure|behind|improve|\bbest\b|score|success rate|streak|shame|missed|🔥|godt klaret|dårlig uge|fejlet|bagud|forbedr|bedste|succesrate|misset|i træk/i;

beforeEach(async () => {
  jest.useRealTimers();
  setNow(2026, 10, 8); // Thursday
  await i18n.changeLanguage('en');
  useHabitsStore.getState().clearLocal();
});
afterEach(() => { act(() => tree.unmount()); jest.useRealTimers(); });

describe('APP-066 summary card on the Habits list', () => {
  it('shows nothing when there are no habits: the empty state stays the only card', async () => {
    await render();
    expect(rendered()).toContain('No habits yet');
    expect(rendered()).not.toContain('so far');
    expect(radios()).toHaveLength(0);
  });

  it('opens on the current week and shows deterministic week facts, with "so far" in the wording', async () => {
    useHabitsStore.setState({ habits: [habit(MWF, ['2026-10-05', '2026-10-06', '2026-10-02'])] });
    await render();
    expect(rendered()).toContain('This week so far');
    expect(rendered()).toContain('1 of 2 scheduled commitments recorded so far'); // Mon done, Wed not; Friday and Thursday are not resolved
    expect(rendered()).toContain('1 additional habit entry'); // Tuesday was not scheduled
    expect(radio('Week').props.accessibilityState).toEqual({ checked: true, selected: true });
    expect(radio('Month').props.accessibilityState).toEqual({ checked: false, selected: false });
  });

  it('switches to the month and shows month facts', async () => {
    useHabitsStore.setState({ habits: [habit(MWF, ['2026-10-05', '2026-10-06', '2026-10-02'])] });
    await render();
    await act(async () => { radio('Month').props.onPress(); });
    expect(rendered()).toContain('This month so far');
    expect(rendered()).toContain('2 of 3 scheduled commitments recorded so far'); // Fri 2, Mon 5 done; Wed 7 not
    expect(rendered()).toContain('1 additional habit entry');
    expect(radio('Month').props.accessibilityState).toEqual({ checked: true, selected: true });
    expect(radio('Week').props.accessibilityState).toEqual({ checked: false, selected: false });
  });

  it('is a labelled radio group with 44pt targets and a visible text label per option', async () => {
    useHabitsStore.setState({ habits: [habit(MWF, [])] });
    await render();
    const group = tree.root.findAll((node) => node.props.accessibilityRole === 'radiogroup');
    expect(group[0].props.accessibilityLabel).toBe('Period');
    for (const label of ['Week', 'Month']) {
      const flat = [radio(label).props.style].flat(5).filter(Boolean).reduce((acc: object, part: object) => ({ ...acc, ...part }), {}) as { minHeight?: number };
      expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    }
    expect(tree.root.findAll((node) => node.props.accessibilityRole === 'header').length).toBeGreaterThan(0);
  });

  it('shows a factual 0 of M, never hiding resolved data and never scoring it', async () => {
    useHabitsStore.setState({ habits: [habit(MWF, [])] });
    await render();
    expect(rendered()).toContain('0 of 2 scheduled commitments recorded so far');
    expect(rendered()).not.toMatch(PUNITIVE);
    expect(rendered()).not.toMatch(/%/);
  });

  it('uses the singular for one scheduled commitment', async () => {
    useHabitsStore.setState({ habits: [habit(MWF, ['2026-10-05'], { startDate: '2026-10-05' })] });
    setNow(2026, 10, 6);
    await render();
    expect(rendered()).toContain('1 of 1 scheduled commitment recorded so far');
  });

  it('counts weekly and open habits as entries only, with no denominator', async () => {
    useHabitsStore.setState({ habits: [habit({ kind: 'weekly', target: 3 }, ['2026-10-05', '2026-10-06']), { ...habit({ kind: 'open' }, ['2026-10-07']), id: 'h2' }] });
    await render();
    expect(rendered()).toContain('3 additional habit entries');
    expect(rendered()).not.toContain('scheduled commitment');
  });

  it('shows a neutral empty state when nothing is scheduled and nothing is recorded, per period', async () => {
    useHabitsStore.setState({ habits: [habit({ kind: 'open' }, [])] });
    await render();
    expect(rendered()).toContain('No habit activity recorded this week.');
    await act(async () => { radio('Month').props.onPress(); });
    expect(rendered()).toContain('No habit activity recorded this month.');
    expect(rendered()).not.toMatch(PUNITIVE);
  });

  it('does not show a pending scheduled day as anything', async () => {
    useHabitsStore.setState({ habits: [habit(MWF, [], { startDate: '2026-10-07' })] });
    setNow(2026, 10, 7); // Wednesday, scheduled, no entry yet
    await render();
    expect(rendered()).toContain('No habit activity recorded this week.');
  });

  it('speaks Danish with proper plurals', async () => {
    await i18n.changeLanguage('da');
    useHabitsStore.setState({ habits: [habit(MWF, ['2026-10-05', '2026-10-06', '2026-10-07'])] });
    await render();
    expect(rendered()).toContain('Denne uge indtil nu');
    expect(rendered()).toContain('2 af 2 planlagte forpligtelser registreret indtil nu');
    expect(rendered()).toContain('1 ekstra vaneregistrering');
    expect(radio('Uge')).toBeDefined();
    expect(radio('Måned')).toBeDefined();
    await act(async () => { tree.unmount(); });
    setNow(2026, 10, 6);
    useHabitsStore.setState({ habits: [habit(MWF, ['2026-10-05'], { startDate: '2026-10-05' })] });
    await render();
    expect(rendered()).toContain('1 af 1 planlagt forpligtelse registreret indtil nu');
  });

  it('has no punitive, score or streak wording in any summary string, English or Danish', () => {
    for (const lang of ['en', 'da']) {
      const strings = JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, `../localization/locales/${lang}/habits.json`), 'utf8')).summary);
      expect(strings).not.toMatch(PUNITIVE);
      expect(strings).not.toMatch(/%|\d\s*\/\s*\d|[\u{1F300}-\u{1FAFF}☀-➿]/u);
    }
  });

  it('keeps the same keys in English and Danish', () => {
    const keys = (lang: string) => {
      const flat = (value: unknown, prefix: string): string[] => value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, inner]) => flat(inner, `${prefix}.${key}`)) : [prefix];
      return flat(JSON.parse(fs.readFileSync(path.join(__dirname, `../localization/locales/${lang}/habits.json`), 'utf8')).summary, 'summary').sort();
    };
    expect(keys('da')).toEqual(keys('en'));
  });
});
