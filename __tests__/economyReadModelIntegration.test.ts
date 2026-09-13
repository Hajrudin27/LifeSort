import AsyncStorage from '@react-native-async-storage/async-storage';
import { economyHomeSnapshot } from '@/features/economy/homeSnapshot';
import { economyMonthlyReview } from '@/features/economy/monthlyReview';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { getExpenseTrend, getIncomeTrend } from '@/utils/expense/economyInsights';
import { categoryTotalForMonth, totalForMonth } from '@/utils/expense/expenseStats';

const MONTH = '2026-09';
const input = { name: 'Synthetic expense', amount: 500, category: 'other', nextPaymentDate: '2026-09-10', isRecurring: false };
function totals() {
  return economyTotalsForMonth(useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth, MONTH);
}

beforeEach(async () => {
  await Promise.all([useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate(), useSavingsGoalsStore.persist.rehydrate()]);
  useExpensesStore.setState({ expenses: [], categoryBudgets: {}, seriesStoppedAt: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: 0 });
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-13T12:00:00Z'));
});
afterEach(() => jest.useRealTimers());

it('APP-039 actual manual create/edit/delete and income actions update derived monthly consumers', async () => {
  const id = useExpensesStore.getState().addExpense(input);
  useIncomeStore.getState().setIncomeForMonth(MONTH, 2000);
  expect(totals()).toMatchObject({ settledSpending: 500, settledIncome: 2000, balance: 1500 });
  expect(await economyHomeSnapshot()).toMatchObject({ value: '1500 kr.' });
  expect(await economyMonthlyReview(MONTH)).toEqual(expect.arrayContaining([
    expect.objectContaining({ labelKey: 'review.economySpent', params: { amount: '500', count: 1 } }),
    expect.objectContaining({ labelKey: 'review.economyIncome', params: { amount: '2000' } }),
  ]));

  useExpensesStore.getState().updateExpense(id, { amount: 200 });
  expect(totals().balance).toBe(1800);
  expect(await economyHomeSnapshot()).toMatchObject({ value: '1800 kr.' });
  useExpensesStore.getState().removeExpense(id);
  expect(totals().settledSpending).toBe(0);
  expect(await economyHomeSnapshot()).toMatchObject({ value: '2000 kr.' });
  expect((await economyMonthlyReview(MONTH)).some((fact) => fact.labelKey === 'review.economySpent')).toBe(false);
});

it('APP-039 consumers use identity reconciliation rather than independent raw sums', async () => {
  useExpensesStore.getState().addExpense(input);
  const expenses = useExpensesStore.getState().expenses;
  useExpensesStore.setState({ expenses: [...expenses, ...expenses] });
  useIncomeStore.setState({ incomeByMonth: { [MONTH]: 2000 } });
  expect(await economyHomeSnapshot()).toMatchObject({ value: '1500 kr.' });
  expect(await economyMonthlyReview(MONTH)).toEqual(expect.arrayContaining([
    expect.objectContaining({ labelKey: 'review.economySpent', params: { amount: '500', count: 1 } }),
  ]));
  const repeated = useExpensesStore.getState().expenses;
  expect(totalForMonth(repeated, MONTH)).toBe(500);
  expect(categoryTotalForMonth(repeated, MONTH, 'other')).toBe(500);
  expect(getExpenseTrend(repeated, 1, 'da-DK')[0].value).toBe(500);
  expect(getIncomeTrend(useIncomeStore.getState().incomeByMonth, 1, 'da-DK')[0].value).toBe(2000);
});

it('APP-039 reads the existing incomeByMonth storage envelope without a version or shape migration', async () => {
  await AsyncStorage.setItem('lifesort-income-v2', JSON.stringify({
    state: { incomeByMonth: { '2026-08': 1800, [MONTH]: 2000 } }, version: 0,
  }));
  await useIncomeStore.persist.rehydrate();
  expect(useIncomeStore.getState().incomeByMonth).toEqual({ '2026-08': 1800, [MONTH]: 2000 });
  expect(totals().settledIncome).toBe(2000);
  expect(await economyHomeSnapshot()).toMatchObject({ value: '2000 kr.' });
});

it('APP-039 preserves savings and transfer behavior separately from income/spending', async () => {
  useIncomeStore.setState({ incomeByMonth: { [MONTH]: 2000 } });
  useSavingsGoalsStore.setState({
    goals: [
      { id: 'g1', name: 'Synthetic reserve', icon: 'other', targetAmount: 1000, savedAmount: 500, createdAt: '2026-09-01' },
      { id: 'g2', name: 'Synthetic goal', icon: 'other', targetAmount: 1000, savedAmount: 0, createdAt: '2026-09-01' },
    ],
  });
  useSavingsGoalsStore.getState().transferBetweenGoals('g1', 'g2', 200);
  expect(totals()).toMatchObject({ settledSpending: 0, settledIncome: 2000 });
  expect((await economyMonthlyReview(MONTH)).map((fact) => fact.labelKey)).toEqual(['review.economyIncome']);
  expect(await economyHomeSnapshot()).toMatchObject({ value: '2000 kr.', helperParams: { percent: 25 } });
});
