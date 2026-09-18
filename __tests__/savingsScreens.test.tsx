import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Modal, Text, TextInput } from 'react-native';

import i18n from '@/localization/i18n';
import daSavings from '@/localization/locales/da/savings.json';
import enSavings from '@/localization/locales/en/savings.json';

/**
 * APP-043 on the savings screens: a deadline can be chosen when a goal is
 * created, a passed deadline is stated rather than hidden behind "one month
 * left", actions the store would refuse are disabled, the history chart has a
 * text alternative, and the "+" button says what it does.
 */

let mockParams: Record<string, string> = {};
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  // Header buttons are real UI: render them where the screen would.
  Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => options?.headerRight?.() ?? null },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/components/DatePickerField', () => (props: object) => require('react').createElement('DatePickerFieldMock', props));
jest.mock('react-native-svg', () => {
  const React = require('react');
  const host = (name: string) => (props: object) => React.createElement(name, props);
  return { __esModule: true, default: host('Svg'), Circle: host('Circle'), Polyline: host('Polyline') };
});

import SavingsGoalDetailScreen from '@/app/savings/[id]';
import AllocateSavingsScreen from '@/app/savings/allocate';
import SavingsGoalsScreen from '@/app/savings/index';
import NewSavingsGoalScreen from '@/app/savings/new';
import SavingsHistoryChart from '@/components/SavingsHistoryChart';
import { minorUnits } from '@/core/money/minorUnits';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import type { SavingsGoal } from '@/types/savingsGoal';
import { getMonthKey } from '@/utils/shared/monthKey';
import { todayIso } from '@/utils/shared/localDate';

const m = minorUnits;
const plain = (value: string) => value.replace(/[  ]/g, ' ');
let tree: TestRenderer.ReactTestRenderer;
const render = (element: React.ReactElement) => {
  act(() => { tree?.unmount(); tree = TestRenderer.create(element); });
};
const t = (key: string, options: Record<string, unknown> = {}) => i18n.t(key, options);
const texts = () => tree.root.findAllByType(Text).map((node) => plain([node.props.children].flat().join('')));
/** Types into the index-th TextInput whose props include `props` (one node per field). */
const type = (props: Record<string, unknown>, value: string, index = 0) => act(() => {
  const fields = tree.root.findAllByType(TextInput)
    .filter((field) => Object.entries(props).every(([key, expected]) => field.props[key] === expected));
  fields[index].props.onChangeText(value);
});
/** The pressable control whose own text (or label) is `label`. */
const control = (label: string) => tree.root.findAll((node) =>
  typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'button' &&
  (node.props.accessibilityLabel === label || node.findAllByType(Text).some((text) => [text.props.children].flat().join('') === label)),
)[0];
const press = (label: string) => act(() => { control(label).props.onPress({ stopPropagation: () => undefined }); });
const goal = (id: string, saved: number, overrides: Partial<SavingsGoal> = {}): SavingsGoal =>
  ({ id, name: `Synthetic ${id}`, icon: 'other', targetAmount: m(1_000_000), savedAmount: m(saved), createdAt: '2026-01-01T00:00:00.000Z', ...overrides });

beforeEach(async () => {
  await Promise.all([useSavingsGoalsStore.persist.rehydrate(), useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate()]);
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  mockParams = {};
  await i18n.changeLanguage('da');
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
});
afterEach(() => { act(() => { tree?.unmount(); }); });

describe('APP-043 new goal: optional deadline at creation', () => {
  it('shows the date field only after the deadline toggle, and saves the chosen date', () => {
    render(<NewSavingsGoalScreen />);
    expect(tree.root.findAllByType('DatePickerFieldMock' as never)).toHaveLength(0);

    press(t('savings.setDeadlineToggle'));
    const field = tree.root.findByType('DatePickerFieldMock' as never);
    expect(field.props.value).toBe(todayIso());
    act(() => { field.props.onChange('2027-06-30'); });
    type({ placeholder: t('savings.namePlaceholder') }, 'Synthetic trip');
    type({ placeholder: t('savings.targetPlaceholder') }, '1500,50');
    press(t('savings.save'));

    expect(useSavingsGoalsStore.getState().goals).toEqual([expect.objectContaining({
      name: 'Synthetic trip', targetAmount: 150_050, savedAmount: 0, deadline: '2027-06-30',
    })]);
  });

  it('saves no deadline when the toggle is off (or turned off again)', () => {
    render(<NewSavingsGoalScreen />);
    press(t('savings.setDeadlineToggle'));
    press(t('savings.setDeadlineToggle'));
    type({ placeholder: t('savings.namePlaceholder') }, 'No deadline');
    type({ placeholder: t('savings.targetPlaceholder') }, '100');
    press(t('savings.save'));
    const [saved] = useSavingsGoalsStore.getState().goals;
    expect(saved.name).toBe('No deadline');
    expect('deadline' in saved).toBe(false);
  });

  it('keeps Save disabled for a zero target', () => {
    render(<NewSavingsGoalScreen />);
    type({ placeholder: t('savings.namePlaceholder') }, 'Zero');
    type({ placeholder: t('savings.targetPlaceholder') }, '0');
    expect(control(t('savings.save')).props.disabled).toBe(true);
  });
});

describe('APP-043 goal detail', () => {
  it('states a passed deadline as a fact and shows no monthly requirement for it', () => {
    useSavingsGoalsStore.setState({ goals: [goal('late', 100_000, { deadline: '2026-01-15' })] });
    mockParams = { id: 'late' };
    render(<SavingsGoalDetailScreen />);
    expect(texts()).toContain(t('savings.paceDeadlinePassed', { date: '15. januar 2026' }));
    expect(texts().some((line) => line.startsWith('For at nå din deadline'))).toBe(false);
  });

  it('shows the monthly requirement for a deadline still ahead', () => {
    useSavingsGoalsStore.setState({ goals: [goal('ahead', 0, { deadline: '2099-12-31' })] });
    mockParams = { id: 'ahead' };
    render(<SavingsGoalDetailScreen />);
    expect(texts().some((line) => line.startsWith('For at nå din deadline'))).toBe(true);
    expect(texts().some((line) => line.startsWith('Deadlinen var'))).toBe(false);
  });

  it('disables withdrawing more than the balance, and enables the exact balance', () => {
    useSavingsGoalsStore.setState({ goals: [goal('small', 300), goal('other', 0)] });
    mockParams = { id: 'small' };
    render(<SavingsGoalDetailScreen />);
    const amountFields = { placeholder: t('savings.addMoneyPlaceholder') };
    type(amountFields, '50', 1);
    expect(control(t('savings.withdraw')).props.disabled).toBe(true);
    type(amountFields, '3', 1);
    expect(control(t('savings.withdraw')).props.disabled).toBe(false);
    press(t('savings.withdraw'));
    expect(useSavingsGoalsStore.getState().goals[0].savedAmount).toBe(0);
    expect(useSavingsGoalsStore.getState().history.map((entry) => entry.amount)).toEqual([-300]);
  });
});

describe('APP-043 allocation screen', () => {
  beforeEach(() => {
    useIncomeStore.setState({ incomeByMonth: { [getMonthKey(new Date())]: m(100_000) } });
    useSavingsGoalsStore.setState({ goals: [goal('a', 0), goal('b', 0)] });
  });

  it('treats a negative amount as invalid instead of letting it lower the allocated total', () => {
    render(<AllocateSavingsScreen />);
    type({ placeholder: '0' }, '1500', 0);
    type({ placeholder: '0' }, '-600', 1);
    expect(control(t('savings.distribute')).props.disabled).toBe(true);
  });

  it('distributes valid amounts through the store with matching history', () => {
    render(<AllocateSavingsScreen />);
    type({ placeholder: '0' }, '400', 0);
    type({ placeholder: '0' }, '0', 1);
    press(t('savings.distribute'));
    const state = useSavingsGoalsStore.getState();
    expect(state.goals.map((g) => g.savedAmount)).toEqual([40_000, 0]);
    expect(state.history.map((entry) => [entry.goalId, entry.amount])).toEqual([['a', 40_000]]);
  });

  it('labels each amount field with its goal', () => {
    render(<AllocateSavingsScreen />);
    expect(tree.root.findAllByProps({ accessibilityLabel: t('savings.a11y.allocationAmount', { name: 'Synthetic a' }) }).length).toBeGreaterThan(0);
  });
});

describe('APP-043 savings overview "+" button', () => {
  it.each(['da', 'en'])('(%s) is labelled for extra savings and opens that modal in the same language', async (language) => {
    await i18n.changeLanguage(language);
    render(<SavingsGoalsScreen />);
    expect(tree.root.findAllByProps({ accessibilityLabel: t('savings.a11y.addGoal') })).toHaveLength(0);
    expect(tree.root.findByType(Modal).props.visible).toBe(false);
    press(t('savings.a11y.addExtraSavings'));
    expect(tree.root.findByType(Modal).props.visible).toBe(true);
    expect(texts()).toContain(t('savings.addExtraTitle'));
    expect(texts()).toContain(t('savings.addExtraHint'));
  });
});

describe('APP-043 history chart text alternative', () => {
  const history = [
    { id: 'h1', goalId: 'g', amount: m(100_000), date: '2026-09-01T10:00:00.000Z' },
    { id: 'h3', goalId: 'g', amount: m(-25_050), date: '2026-09-12T10:00:00.000Z' },
    { id: 'h2', goalId: 'g', amount: m(50_000), date: '2026-09-05T10:00:00.000Z' },
  ];

  it('(da) exposes the charted facts as its accessibility label and as visible text', () => {
    render(<SavingsHistoryChart contributions={history} />);
    const chart = tree.root.findByProps({ accessibilityRole: 'image' });
    const expected = '3 bevægelser fra 1. sep. 2026 til 12. sep. 2026: samlet 1.249,50 kr. (lagt ind 1.500 kr., taget ud 250,50 kr.)';
    expect(plain(chart.props.accessibilityLabel)).toBe(expected);
    expect(chart.props.accessible).toBe(true);
    expect(texts()).toContain(expected);
  });

  it('(en) uses the singular for one movement', async () => {
    await i18n.changeLanguage('en');
    render(<SavingsHistoryChart contributions={[history[0]]} />);
    expect(plain(tree.root.findByProps({ accessibilityRole: 'image' }).props.accessibilityLabel))
      .toBe('1 movement on Sep 1, 2026: net DKK 1,000 (added DKK 1,000, taken out DKK 0)');
  });

  it('keeps the existing empty state', () => {
    render(<SavingsHistoryChart contributions={[]} />);
    expect(texts()).toEqual([t('savings.noHistory')]);
  });
});

describe('APP-043 savings locale', () => {
  const keys = (value: object, prefix = ''): string[] => Object.entries(value).flatMap(([key, inner]) =>
    typeof inner === 'object' && inner !== null ? keys(inner, `${prefix}${key}.`) : [`${prefix}${key}`]);

  it('Danish and English have exactly the same keys', () => {
    expect(keys(enSavings).sort()).toEqual(keys(daSavings).sort());
  });

  it('the English extra-savings copy is English, not the Danish text', () => {
    for (const key of ['addExtraTitle', 'addExtraHint'] as const) {
      expect(enSavings[key]).not.toBe(daSavings[key]);
      expect(enSavings[key]).not.toMatch(/[æøå]|Tilføj|Beløbet/);
    }
  });
});
