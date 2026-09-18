import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import i18n from '@/localization/i18n';

/**
 * APP-042 on the manual expense screens: the frequency is visible before saving,
 * it is editable, and turning recurrence off stores no frequency.
 */

jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'expense-1' }),
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/components/AttachmentList', () => () => null);
jest.mock('@/components/CategoryPicker', () => () => null);
jest.mock('@/components/DatePickerField', () => () => null);

import NewExpenseScreen from '@/app/expenses/new';
import EditExpenseScreen from '@/app/expenses/edit/[id]';
import { minorUnits } from '@/core/money/minorUnits';
import { useExpensesStore } from '@/store/useExpensesStore';

const m = minorUnits;
let tree: TestRenderer.ReactTestRenderer;
const render = (element: React.ReactElement) => {
  act(() => { tree?.unmount(); tree = TestRenderer.create(element); });
};
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const t = (key: string) => i18n.t(key);
/** The pressable control carrying this accessibility label, as the user would tap it. */
const chip = (label: string) =>
  tree.root.findAllByProps({ accessibilityLabel: label }).find((node) => typeof node.props.onPress === 'function');
const press = (label: string) => act(() => { chip(label)!.props.onPress(); });
const type = (props: object, value: string) => act(() => { tree.root.findAllByProps(props)[0].props.onChangeText(value); });
/** The shared Button component renders its own pressable; press it by its label. */
function pressButton(label: string) {
  const button = tree.root.findAllByProps({ label })[0];
  const pressable = button.findAllByProps({ accessibilityRole: 'button' }).find((node) => typeof node.props.onPress === 'function');
  act(() => { pressable!.props.onPress(); });
}

beforeEach(async () => {
  await useExpensesStore.persist.rehydrate();
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  await i18n.changeLanguage('da');
  // Let every persisted store finish hydrating before anything is rendered.
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
});
// Unmount before the next test resets the stores, so no screen re-renders outside act().
afterEach(() => { act(() => { tree?.unmount(); }); });

describe('APP-042 New expense screen', () => {
  it('hides the frequency until recurrence is on, then shows every option with monthly preselected', () => {
    render(<NewExpenseScreen />);
    expect(texts()).not.toContain(t('expenses.recurrenceFrequencyLabel'));

    press(t('expenses.recurring'));
    expect(texts()).toContain(t('expenses.recurrenceFrequencyLabel'));
    for (const frequency of ['monthly', 'quarterly', 'yearly']) {
      expect(texts()).toContain(t(`expenses.recurrence.${frequency}`));
    }
    // Monthly is selected before the user does anything, and says so without colour.
    expect(chip(t('expenses.recurrence.monthly'))!.props.accessibilityState).toEqual({ selected: true });
    expect(chip(t('expenses.recurrence.yearly'))!.props.accessibilityState).toEqual({ selected: false });
  });

  it('saves the frequency the user selected, and none when recurrence is off', () => {
    render(<NewExpenseScreen />);
    type({ keyboardType: 'decimal-pad' }, '99');
    type({ placeholder: t('expenses.namePlaceholder') }, 'Synthetic');
    press(t('expenses.recurring'));
    press(t('expenses.recurrence.quarterly'));
    expect(chip(t('expenses.recurrence.quarterly'))!.props.accessibilityState).toEqual({ selected: true });

    pressButton(t('expenses.save'));
    expect(useExpensesStore.getState().expenses[0]).toMatchObject({ isRecurring: true, recurrenceFrequency: 'quarterly', amount: 9_900 });

    // Turning recurrence back off on a second expense stores no frequency.
    render(<NewExpenseScreen />);
    type({ keyboardType: 'decimal-pad' }, '50');
    type({ placeholder: t('expenses.namePlaceholder') }, 'Once');
    press(t('expenses.recurring'));
    press(t('expenses.recurring'));
    expect(texts()).not.toContain(t('expenses.recurrenceFrequencyLabel'));
    pressButton(t('expenses.save'));
    expect(useExpensesStore.getState().expenses[1]).toMatchObject({ isRecurring: false, recurrenceFrequency: null });
  });
});

describe('APP-042 Edit expense screen', () => {
  const existing = {
    id: 'expense-1', seriesId: 'expense-1', isRecurring: true, recurrenceFrequency: 'yearly' as const, recurrenceAnchorDay: 15,
    name: 'Synthetic insurance', amount: m(120_000), category: 'bill', nextPaymentDate: '2026-01-15',
    attachments: [], createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('shows the stored frequency as selected and saves a change to it', () => {
    useExpensesStore.setState({ expenses: [existing] });
    render(<EditExpenseScreen />);
    expect(texts()).toContain(t('expenses.recurrenceFrequencyLabel'));
    expect(chip(t('expenses.recurrence.yearly'))!.props.accessibilityState).toEqual({ selected: true });

    press(t('expenses.recurrence.monthly'));
    pressButton(t('expenses.save'));
    expect(useExpensesStore.getState().expenses[0]).toMatchObject({ isRecurring: true, recurrenceFrequency: 'monthly' });
  });

  it('saving a name or frequency change keeps the anchor of a clamped February occurrence', () => {
    // The screen re-sends the date it was opened with. For a 31st schedule shown on
    // 28 February, that must not turn the schedule into the 28th.
    useExpensesStore.setState({
      expenses: [{ ...existing, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 31, nextPaymentDate: '2026-02-28' }],
    });
    render(<EditExpenseScreen />);
    type({ placeholder: t('expenses.namePlaceholder') }, 'Renamed on screen');
    press(t('expenses.recurrence.quarterly'));
    pressButton(t('expenses.save'));
    expect(useExpensesStore.getState().expenses[0]).toMatchObject({
      name: 'Renamed on screen', nextPaymentDate: '2026-02-28', recurrenceFrequency: 'quarterly', recurrenceAnchorDay: 31,
    });

    useExpensesStore.getState().rollForwardMonth('2026-05');
    expect(useExpensesStore.getState().expenses.map((e) => e.nextPaymentDate)).toEqual(['2026-02-28', '2026-05-31']);
  });

  it('clears the frequency when the user turns recurrence off', () => {
    useExpensesStore.setState({ expenses: [existing] });
    render(<EditExpenseScreen />);
    const toggle = tree.root.findAllByProps({ accessibilityLabel: t('expenses.recurring') })
      .find((node) => typeof node.props.onValueChange === 'function')!;
    act(() => { toggle.props.onValueChange(false); });
    expect(texts()).not.toContain(t('expenses.recurrenceFrequencyLabel'));

    pressButton(t('expenses.save'));
    expect(useExpensesStore.getState().expenses[0]).toMatchObject({ isRecurring: false, recurrenceFrequency: null });
  });
});
