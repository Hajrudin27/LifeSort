import AsyncStorage from '@react-native-async-storage/async-storage';
import { minorUnits } from '@/core/money/minorUnits';
import { isSupportedMoney } from '@/core/money/supportedMoney';
import { economyHomeSnapshot } from '@/features/economy/homeSnapshot';
import { economyMonthlyReview } from '@/features/economy/monthlyReview';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { getExpenseTrend, getIncomeTrend } from '@/utils/expense/economyInsights';
import { categoryTotalForMonth, totalForMonth } from '@/utils/expense/expenseStats';

/** APP-040: store amounts are DKK MinorUnits; displayed values are localized (test language: da). */
const m = minorUnits;
const MONTH = '2026-09';
const input = { name: 'Synthetic expense', amount: m(50_000), category: 'other', nextPaymentDate: '2026-09-10', isRecurring: false };
const plain = (text: string | undefined) => text?.replace(/[\u00a0\u202f]/g, ' ');
function totals() {
  return economyTotalsForMonth(useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth, MONTH);
}
async function homeValue() {
  return plain((await economyHomeSnapshot())?.value);
}
async function reviewParams(labelKey: string) {
  const params = (await economyMonthlyReview(MONTH)).find((fact) => fact.labelKey === labelKey)?.params;
  return params && Object.fromEntries(Object.entries(params).map(([key, value]) => [key, typeof value === 'string' ? plain(value) : value]));
}

beforeEach(async () => {
  await Promise.all([useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate(), useSavingsGoalsStore.persist.rehydrate()]);
  useExpensesStore.setState({ expenses: [], categoryBudgets: {}, seriesStoppedAt: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-13T12:00:00Z'));
});
afterEach(() => jest.useRealTimers());

it('APP-039 actual manual create/edit/delete and income actions update derived monthly consumers', async () => {
  const id = useExpensesStore.getState().addExpense(input);
  useIncomeStore.getState().setIncomeForMonth(MONTH, m(200_000));
  expect(totals()).toMatchObject({ settledSpending: 50_000, settledIncome: 200_000, balance: 150_000 });
  expect(await homeValue()).toBe('1.500 kr.');
  expect(await reviewParams('review.economySpent')).toEqual({ amount: '500 kr.', count: 1 });
  expect(await reviewParams('review.economyIncome')).toEqual({ amount: '2.000 kr.' });

  useExpensesStore.getState().updateExpense(id, { amount: m(20_050) });
  expect(totals().balance).toBe(179_950);
  expect(await homeValue()).toBe('1.799,50 kr.');
  useExpensesStore.getState().removeExpense(id);
  expect(totals().settledSpending).toBe(0);
  expect(await homeValue()).toBe('2.000 kr.');
  expect((await economyMonthlyReview(MONTH)).some((fact) => fact.labelKey === 'review.economySpent')).toBe(false);
});

it('APP-039 consumers use identity reconciliation rather than independent raw sums', async () => {
  useExpensesStore.getState().addExpense(input);
  const expenses = useExpensesStore.getState().expenses;
  useExpensesStore.setState({ expenses: [...expenses, ...expenses] });
  useIncomeStore.setState({ incomeByMonth: { [MONTH]: m(200_000) } });
  expect(await homeValue()).toBe('1.500 kr.');
  expect(await reviewParams('review.economySpent')).toEqual({ amount: '500 kr.', count: 1 });
  const repeated = useExpensesStore.getState().expenses;
  expect(totalForMonth(repeated, MONTH)).toBe(50_000);
  expect(categoryTotalForMonth(repeated, MONTH, 'other')).toBe(50_000);
  expect(getExpenseTrend(repeated, 1, 'da-DK')[0].value).toBe(50_000);
  expect(getIncomeTrend(useIncomeStore.getState().incomeByMonth, 1, 'da-DK')[0].value).toBe(200_000);
});

it('APP-040 upgrades the historical v0 incomeByMonth envelope once through the real store hydration', async () => {
  const legacy = JSON.stringify({ state: { incomeByMonth: { '2026-08': 1800, [MONTH]: 2000.5 } }, version: 0 });
  await AsyncStorage.setItem('lifesort-income-v2', legacy);
  await useIncomeStore.persist.rehydrate();
  expect(useIncomeStore.getState().incomeByMonth).toEqual({ '2026-08': 180_000, [MONTH]: 200_050 });
  expect(JSON.parse((await AsyncStorage.getItem('lifesort-income-v2'))!)).toEqual({
    state: { incomeByMonth: { '2026-08': 180_000, [MONTH]: 200_050 } }, version: 1,
  });
  // A second hydration reads v1 as-is: no second scaling.
  await useIncomeStore.persist.rehydrate();
  expect(useIncomeStore.getState().incomeByMonth[MONTH]).toBe(200_050);
  expect(totals().settledIncome).toBe(200_050);
  expect(await homeValue()).toBe('2.000,50 kr.');
});

it('APP-039 preserves savings and transfer behavior separately from income/spending', async () => {
  useIncomeStore.setState({ incomeByMonth: { [MONTH]: m(200_000) } });
  useSavingsGoalsStore.setState({
    goals: [
      { id: 'g1', name: 'Synthetic reserve', icon: 'other', targetAmount: m(100_000), savedAmount: m(50_000), createdAt: '2026-09-01' },
      { id: 'g2', name: 'Synthetic goal', icon: 'other', targetAmount: m(100_000), savedAmount: m(0), createdAt: '2026-09-01' },
    ],
  });
  useSavingsGoalsStore.getState().transferBetweenGoals('g1', 'g2', m(20_000));
  expect(totals()).toMatchObject({ settledSpending: 0, settledIncome: 200_000 });
  expect((await economyMonthlyReview(MONTH)).map((fact) => fact.labelKey)).toEqual(['review.economyIncome']);
  expect(await economyHomeSnapshot()).toMatchObject({ helperParams: { percent: 25 } });
  expect(await homeValue()).toBe('2.000 kr.');
});

it('APP-040 displays a derived total of supported amounts that is not itself supported persisted money', async () => {
  // Two persisted amounts, each supported, whose monthly total is outside the persistence subset.
  const edge = m(2 ** 33 * 100);
  useExpensesStore.getState().addExpense({ ...input, amount: edge });
  useExpensesStore.getState().addExpense({ ...input, name: 'Synthetic second', amount: m(2 ** 33 * 100 - 1) });
  const spending = totals().settledSpending;
  expect(spending).toBe(1_717_986_918_399);
  expect(isSupportedMoney(spending)).toBe(false);
  expect(isSupportedMoney(totals().balance)).toBe(false);

  // Home (balance = −spending, no income) and the monthly review format it exactly instead of throwing.
  expect(await homeValue()).toBe('-17.179.869.183,99 kr.');
  expect(await reviewParams('review.economySpent')).toEqual({ amount: '17.179.869.183,99 kr.', count: 2 });
  // Nothing derived was persisted: the stored expenses are the two supported inputs.
  expect(useExpensesStore.getState().expenses.map((expense) => expense.amount)).toEqual([edge, edge - 1]);
});
