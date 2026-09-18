import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { minorUnits } from '@/core/money/minorUnits';
import i18n from '@/localization/i18n';

/**
 * APP-040 unit boundary on the Economy tab: Economy values are DKK MinorUnits and
 * go through the shared formatter; Food values rendered on the same screen are
 * still major-unit numbers (Food is not migrated) and must keep their display.
 */

jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/components/ExpensePieChart', () => () => null);
jest.mock('@/components/RingProgress', () => () => null);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => require('react').createElement(require('react-native').View, props),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import EconomyScreen from '@/app/(tabs)/economy';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useFoodStore } from '@/store/useFoodStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { getMonthKey } from '@/utils/shared/monthKey';

const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ');
let tree: TestRenderer.ReactTestRenderer;
function renderedText(): string {
  return plain(tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' | '));
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-16T12:00:00Z'));
  const month = getMonthKey(new Date());
  useExpensesStore.setState({
    expenses: [{ id: 'e1', seriesId: 'e1', isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null, name: 'Synthetic', amount: minorUnits(123_450), category: 'other', nextPaymentDate: `${month}-10`, attachments: [], createdAt: `${month}-10T00:00:00.000Z` }],
    categoryBudgets: {},
  });
  useIncomeStore.setState({ incomeByMonth: { [month]: minorUnits(1_000_000) } });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: minorUnits(0) });
  // Food: a monthly budget of 4000 kr. and a 250 kr. purchase this week, as major-unit numbers.
  useFoodStore.setState({ monthlyBudgetByMonth: { [month]: 4000 }, purchases: [{ id: 'p1', amount: 250, date: '2026-09-15T10:00:00.000Z' }] });
  await i18n.changeLanguage('da');
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  jest.useRealTimers();
});

it('formats Economy MinorUnits once and keeps Food major units untouched', async () => {
  await act(async () => { tree = TestRenderer.create(<EconomyScreen />); });
  const text = renderedText();

  // Economy: 123 450 øre spent → 1.234,50 kr.; balance 10.000,00 − 1.234,50 = 8.765,50 kr.
  expect(text).toContain('1.234,50 kr.');
  expect(text).toContain('8.765,50 kr.');
  expect(text).toContain('10.000 kr.');
  expect(text).not.toContain('123.450 kr.');

  // Food on the same screen: 250 kr. of a 4000 kr./5-week budget → "250 kr." and "800 kr.",
  // neither divided by 100 nor multiplied by 100.
  expect(text).toContain('250 kr.');
  expect(text).toContain('800 kr.');
  expect(text).not.toContain('2,50 kr.');
  expect(text).not.toContain('25.000 kr.');
});

it('renders an unsupported derived total of supported expenses exactly instead of throwing', async () => {
  const month = getMonthKey(new Date());
  const expense = (id: string, amount: number) => ({ id, seriesId: id, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null, name: 'Synthetic', amount: minorUnits(amount), category: 'other', nextPaymentDate: `${month}-10`, attachments: [], createdAt: `${month}-10T00:00:00.000Z` });
  useExpensesStore.setState({ expenses: [expense('big-1', 2 ** 33 * 100), expense('big-2', 2 ** 33 * 100 - 1)] });
  useIncomeStore.setState({ incomeByMonth: {} });

  await act(async () => { tree = TestRenderer.create(<EconomyScreen />); });
  // 8 589 934 592,00 + 8 589 934 591,99 = 17 179 869 183,99 kr. — a display-only total.
  expect(renderedText()).toContain('17.179.869.183,99 kr.');
});
