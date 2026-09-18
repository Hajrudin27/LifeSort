import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n from '@/localization/i18n';

/**
 * APP-044 on screen: the current plan, a factual result for one hypothetical
 * purchase, visible assumptions, and a purchase that is never saved or sent.
 * See docs/app-044-purchase-impact.md.
 */

const mockWrites: { table: string; payload: unknown }[] = [];
/** Rows the server holds, per table, for the real fetchFromSupabase path. */
const mockRemote: Record<string, Record<string, unknown>[]> = {};
jest.mock('@/lib/supabase', () => {
  const from = jest.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain, eq: () => chain, in: () => chain, delete: () => chain,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve({ data: mockRemote[table] ?? [], error: null }).then(resolve, reject),
      upsert: (payload: unknown) => { mockWrites.push({ table, payload }); return Promise.resolve({ error: null }); },
      insert: (payload: unknown) => { mockWrites.push({ table, payload }); return Promise.resolve({ error: null }); },
    });
    return chain;
  });
  // Signed in, so any write the screen caused would really be attempted.
  return { supabase: { from, auth: { getUser: () => Promise.resolve({ data: { user: { id: 'synthetic-user' } } }) } } };
});
jest.mock('@/utils/shared/attachmentSync', () => ({
  uploadAttachment: jest.fn(() => Promise.resolve(null)),
  deleteAttachmentRemote: jest.fn(() => Promise.resolve()),
  fetchAttachmentsFor: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/components/ExpensePieChart', () => () => null);
jest.mock('@/components/RingProgress', () => () => null);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => require('react').createElement(require('react-native').View, props),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import EconomyScreen from '@/app/(tabs)/economy';
import PurchaseImpactScreen from '@/app/economy/affordability';
import type { RecurrenceFrequency } from '@/core/economy/recurrence';
import { minorUnits } from '@/core/money/minorUnits';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import { supabase } from '@/lib/supabase';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import type { Expense } from '@/types/expense';
import { router } from 'expo-router';

const m = minorUnits;
const kr = (amount: number) => m(amount * 100);
const MONTH = '2026-09';
/** The seven limitations APP-044 must show: month, registered data, forecast, credit, savings, not saved, same figures. */
const REQUIRED_ASSUMPTIONS = ['currentMonth', 'registered', 'noForecast', 'noCredit', 'savings', 'notSaved', 'sameFigures'];

const oneTime = (id: string, amountKr: number, date = `${MONTH}-10`): Expense => ({
  id, seriesId: id, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null,
  name: `Synthetic ${id}`, amount: kr(amountKr), category: 'other', nextPaymentDate: date,
  attachments: [], createdAt: `${date}T00:00:00.000Z`,
});
const recurring = (id: string, amountKr: number, date: string, frequency: RecurrenceFrequency): Expense => ({
  ...oneTime(id, amountKr, date), category: 'bill', isRecurring: true, recurrenceFrequency: frequency,
  recurrenceAnchorDay: Number(date.slice(8)),
});
const setPlan = (incomeKr: number | null, expenses: Expense[]) => {
  useIncomeStore.setState({ incomeByMonth: incomeKr === null ? {} : { [MONTH]: kr(incomeKr) } });
  useExpensesStore.setState({ expenses });
};

let tree: TestRenderer.ReactTestRenderer | undefined;
const plain = (value: string) => value.replace(/[  ]/g, ' ');
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const texts = () => tree!.root.findAllByType(Text).map((node) => plain([node.props.children].flat().join('')));
/** Real timers: lets hydration, the materialization and any sync attempt run to the end. */
const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function open(element: React.ReactElement = <PurchaseImpactScreen />) {
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(element); });
  await settle();
}
/** Like `open`, and records the visible texts of every commit, the first one included. */
async function openRecordingCommits(element: React.ReactElement = <PurchaseImpactScreen />): Promise<string[][]> {
  const commits: string[][] = [];
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(<></>); });
  await act(async () => {
    tree!.update(<React.Profiler id="commits" onRender={() => { commits.push(texts()); }}>{element}</React.Profiler>);
  });
  await settle();
  return commits;
}
const type = (value: string) => act(() => { tree!.root.findByType(TextInput).props.onChangeText(value); });
/** The pressable control whose own text is `label`, as the user would tap it. */
const control = (label: string) => tree!.root.findAll((node) =>
  typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'button' &&
  node.findAllByType(Text).some((text) => [text.props.children].flat().join('') === label))[0];
const headers = () => tree!.root.findAllByType(Text)
  .filter((node) => node.props.accessibilityRole === 'header')
  .map((node) => [node.props.children].flat().join(''));
const septemberOf = (seriesId: string) => useExpensesStore.getState().expenses
  .filter((expense) => expense.seriesId === seriesId && expense.nextPaymentDate.startsWith(MONTH));

beforeEach(async () => {
  // Only the clock is fixed; timers stay real so persistence and sync can settle.
  jest.useFakeTimers({
    now: new Date('2026-09-16T12:00:00Z'),
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
      'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
      'hrtime', 'performance'],
  });
  await Promise.all([useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate(), useSavingsGoalsStore.persist.rehydrate()]);
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
  await i18n.changeLanguage('da');
  await settle();
  for (const table of Object.keys(mockRemote)) delete mockRemote[table];
  mockWrites.length = 0;
  (supabase.from as jest.Mock).mockClear();
  (router.push as jest.Mock).mockClear();
});
afterEach(async () => {
  act(() => { tree?.unmount(); });
  tree = undefined;
  // Leave only valid, supported data on disk for the next test's hydration.
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  await settle();
  jest.useRealTimers();
});

describe('APP-044 entry point', () => {
  it('the Economy tab opens the screen from a quick action', async () => {
    await open(<EconomyScreen />);
    expect(texts()).toContain(t('economy.affordability.entrySubtitle'));
    act(() => { control(t('economy.affordability.title')).props.onPress(); });
    expect(router.push).toHaveBeenCalledWith('/economy/affordability');
  });
});

describe('APP-044 the current plan', () => {
  it("shows this month's registered income, spending and what is left, and no result before an amount", async () => {
    useIncomeStore.setState({ incomeByMonth: { [MONTH]: kr(20_000), '2026-08': kr(99_000) } });
    useExpensesStore.setState({ expenses: [oneTime('rent', 6_000), oneTime('august', 1_000, '2026-08-10')] });
    await open();
    expect(texts()).toEqual(expect.arrayContaining([
      'Registreret indkomst', '20.000 kr.', 'Registrerede udgifter', '6.000 kr.', 'Tilbage før købet', '14.000 kr.',
    ]));
    expect(texts()).not.toContain(t('economy.affordability.resultTitle'));
    expect(texts()).not.toContain(t('economy.affordability.amountInvalid'));
  });

  it('follows the stores live, like the Economy overview', async () => {
    setPlan(20_000, [oneTime('rent', 6_000)]);
    await open();
    await type('1000');
    expect(texts()).toContain('Ud fra din nuværende plan har du 13.000 kr. tilbage i denne måned efter købet.');
    await act(async () => { useExpensesStore.setState({ expenses: [oneTime('rent', 6_000), oneTime('dentist', 2_000)] }); });
    expect(texts()).toContain('12.000 kr.');
    expect(texts()).toContain('Ud fra din nuværende plan har du 11.000 kr. tilbage i denne måned efter købet.');
  });
});

describe('APP-044 the result', () => {
  it('shows no result, and says why, for text that is not a purchase amount', async () => {
    setPlan(20_000, [oneTime('rent', 6_000)]);
    await open();
    for (const text of ['0', '0,00', '-500', 'abc', '12,345', '1.000,50', '8589934592,01', '9'.repeat(20)]) {
      type(text);
      expect([text, texts().includes(t('economy.affordability.resultTitle'))]).toEqual([text, false]);
      expect(texts()).not.toContain(t('economy.affordability.afterLabel'));
      expect(texts()).toContain(t('economy.affordability.amountInvalid'));
    }
    // An empty field is not an error, and still no result.
    type('');
    expect(texts()).not.toContain(t('economy.affordability.amountInvalid'));
    expect(texts()).not.toContain(t('economy.affordability.resultTitle'));
  });

  it('states a result within the plan as a plain fact, including an exact zero', async () => {
    setPlan(20_000, [oneTime('rent', 10_000)]);
    await open();
    type('2000');
    expect(texts()).toEqual(expect.arrayContaining([
      'Inden for månedens plan', 'Køb', '2.000 kr.', 'Tilbage efter købet', '8.000 kr.',
      'Ud fra din nuværende plan har du 8.000 kr. tilbage i denne måned efter købet.',
    ]));
    type('10000');
    expect(texts()).toContain('Inden for månedens plan');
    expect(texts()).toContain('Ud fra din nuværende plan har du 0 kr. tilbage i denne måned efter købet.');
  });

  it('states a result below zero as a plain fact, also when the plan already is below zero', async () => {
    setPlan(20_000, [oneTime('rent', 19_000)]);
    await open();
    type('1500');
    expect(texts()).toEqual(expect.arrayContaining([
      'Over månedens plan', '-500 kr.',
      'Din nuværende plan har 1.000 kr. tilbage i denne måned. Efter købet vil den være 500 kr. under nul.',
    ]));

    await act(async () => { useExpensesStore.setState({ expenses: [oneTime('rent', 20_500)] }); });
    type('500');
    expect(texts()).toEqual(expect.arrayContaining([
      '-500 kr.', 'Over månedens plan', '-1.000 kr.',
      'Din nuværende plan er allerede 500 kr. under nul. Efter købet vil den være 1.000 kr. under nul.',
    ]));
  });

  it('says the plan is incomplete without income, and never shows a remaining balance', async () => {
    useIncomeStore.setState({ incomeByMonth: { '2026-08': kr(20_000) } }); // last month only
    useExpensesStore.setState({ expenses: [oneTime('rent', 6_000)] });
    await open();
    expect(texts()).toEqual(expect.arrayContaining(['Ikke registreret', 'Kræver månedens indkomst']));
    type('500');
    expect(texts()).toEqual(expect.arrayContaining([
      'Indkomst ikke registreret',
      'Månedens indkomst er ikke registreret, så LifeSort kan ikke regne ud, hvad der vil være tilbage. Tilføj månedens indkomst for at se, hvad købet betyder.',
    ]));
    expect(texts()).not.toContain(t('economy.affordability.afterLabel'));
    // Missing income is not zero income: no "0 − 6.000 − 500" anywhere.
    expect(texts().filter((line) => /-\d/.test(line))).toEqual([]);

    act(() => { control(t('expenses.addIncome')).props.onPress(); });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/expenses/income', params: { month: MONTH } });
  });

  it('shows a fixed message instead of a number when the result would be unsafe', async () => {
    useIncomeStore.setState({ incomeByMonth: { [MONTH]: m(0) } });
    useExpensesStore.setState({ expenses: [{ ...oneTime('edge', 0), amount: m(Number.MAX_SAFE_INTEGER) }] });
    await open();
    type('0,01');
    expect(texts()).toContain(t('economy.affordability.cannotCalculate'));
    expect(texts()).not.toContain(t('economy.affordability.resultTitle'));
    expect(texts().filter((line) => /NaN|Infinity/.test(line))).toEqual([]);
  });

  it('(en) uses the same neutral wording, with no verdict or advice anywhere on the screen', async () => {
    await i18n.changeLanguage('en');
    setPlan(20_000, [oneTime('rent', 19_000)]);
    await open();
    type('1500');
    expect(texts()).toEqual(expect.arrayContaining([
      'Over this month\'s plan',
      'Your current plan has DKK 1,000 left this month. After the purchase, it would be DKK 500 below zero.',
    ]));
    type('500');
    expect(texts()).toContain('Based on your current plan, you would have DKK 500 left this month after the purchase.');
    expect(texts().filter((line) => /afford|safe to|\bshould\b|recommend|good purchase|bad purchase|loan (for|to)|use your savings/i.test(line))).toEqual([]);
  });
});

describe('APP-044 assumptions and accessibility', () => {
  it('shows every required assumption without any interaction, and keeps them with a result', async () => {
    setPlan(20_000, []);
    await open();
    const shown = () => REQUIRED_ASSUMPTIONS.filter((key) => texts().includes(t(`economy.affordability.assumptions.${key}`)));
    expect(shown()).toEqual(REQUIRED_ASSUMPTIONS);
    expect(texts()).toContain(t('economy.affordability.intro'));
    type('100');
    expect(shown()).toEqual(REQUIRED_ASSUMPTIONS);
  });

  it('labels the amount field and the income action, marks the sections as headers, and names the status in text', async () => {
    setPlan(null, []);
    await open();
    const field = tree!.root.findByType(TextInput);
    expect(field.props.accessibilityLabel).toBe('Købets beløb i kroner');
    expect(field.props.keyboardType).toBe('decimal-pad');
    expect(headers()).toEqual([t('economy.affordability.planTitle'), t('economy.affordability.assumptionsTitle')]);

    type('100');
    expect(headers()).toEqual([
      t('economy.affordability.planTitle'), t('economy.affordability.resultTitle'), t('economy.affordability.assumptionsTitle'),
    ]);
    expect(texts()).toContain(t('economy.affordability.status.incomplete'));
    expect(control(t('expenses.addIncome')).props.accessibilityRole).toBe('button');
  });
});

describe('APP-044 includes this month\'s recurring costs through APP-042', () => {
  it('materializes a due monthly bill for this month only, and counts it in the plan', async () => {
    setPlan(20_000, [recurring('rent', 8_000, '2026-06-15', 'monthly')]);
    const totals = () => economyTotalsForMonth(useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth, MONTH);
    // Without materialization this month's rent is missing from the canonical totals.
    expect(totals().settledSpending).toBe(0);

    await open();
    expect(septemberOf('rent')).toEqual([expect.objectContaining({
      nextPaymentDate: '2026-09-15', amount: kr(8_000), recurrenceFrequency: 'monthly', recurrenceAnchorDay: 15,
    })]);
    // Only the current month: the skipped months are not generated.
    expect(useExpensesStore.getState().expenses.map((expense) => expense.nextPaymentDate).sort()).toEqual(['2026-06-15', '2026-09-15']);
    expect(totals().settledSpending).toBe(kr(8_000));
    expect(texts()).toContain('12.000 kr.');
    type('2000');
    expect(texts()).toContain('Ud fra din nuværende plan har du 10.000 kr. tilbage i denne måned efter købet.');
  });

  it('repeated visits and evaluations never duplicate the instance', async () => {
    setPlan(20_000, [recurring('rent', 8_000, '2026-08-15', 'monthly')]);
    await open();
    for (const value of ['1', '2000', '19999', '']) type(value);
    await open();
    await open();
    expect(septemberOf('rent')).toHaveLength(1);
    expect(texts()).toContain('12.000 kr.');
  });

  it('keeps APP-042 cadence: not-due quarterly and stopped series add nothing, a due yearly bill is counted', async () => {
    setPlan(20_000, [
      recurring('insurance', 3_000, '2026-07-20', 'quarterly'), // next due in October
      recurring('licence', 1_200, '2025-09-30', 'yearly'), // due 30 September 2026
      recurring('gym', 300, '2026-08-05', 'monthly'), // stopped from September
    ]);
    useExpensesStore.setState({ seriesStoppedAt: { gym: MONTH } });
    await open();
    expect(['insurance', 'licence', 'gym'].map((id) => septemberOf(id).map((expense) => expense.nextPaymentDate)))
      .toEqual([[], ['2026-09-30'], []]);
    expect(texts()).toContain('18.800 kr.');
  });

  it('materializes a recurring series that arrives after the first pass, on the same open screen', async () => {
    setPlan(20_000, [oneTime('groceries', 1_500)]);
    const commits = await openRecordingCommits();
    type('1000');
    const withoutRent = ['18.500 kr.', 'Ud fra din nuværende plan har du 17.500 kr. tilbage i denne måned efter købet.'];
    expect(texts()).toEqual(expect.arrayContaining(withoutRent));

    // The startup fetch is not awaited before routes render. It finishes now,
    // with an August rent series this device has not seen before.
    mockRemote.expenses = [{
      id: 'rent', series_id: 'rent', is_recurring: true, recurrence_frequency: 'monthly', recurrence_anchor_day: 1,
      name: 'Synthetic rent', amount: 8000, category: 'bill', next_payment_date: '2026-08-01', created_at: '2026-08-01T00:00:00.000Z',
    }];
    mockWrites.length = 0;
    commits.length = 0;
    await act(async () => { await useExpensesStore.getState().fetchFromSupabase(); });
    await settle();

    // Re-preparation: the render that first sees the fetched Expenses shows no
    // plan and no result, and no commit shows the plan or result without the rent.
    expect(commits[0]).toContain(t('economy.affordability.loading'));
    expect(commits[0]).not.toContain(t('economy.affordability.resultTitle'));
    expect(commits.map((commit) => commit.filter((text) => withoutRent.includes(text)))).toEqual(commits.map(() => []));

    expect(septemberOf('rent')).toEqual([expect.objectContaining({
      nextPaymentDate: '2026-09-01', amount: kr(8_000), recurrenceFrequency: 'monthly', recurrenceAnchorDay: 1,
    })]);
    expect(texts()).toContain('10.500 kr.');
    expect(texts()).toContain('Ud fra din nuværende plan har du 9.500 kr. tilbage i denne måned efter købet.');
    // Through the existing APP-042 path: one upsert, of the one new instance.
    expect(mockWrites).toEqual([
      { table: 'expenses', payload: [expect.objectContaining({ series_id: 'rent', next_payment_date: '2026-09-01' })] },
    ]);

    // Later renders, evaluations and store updates add nothing: the same remote
    // snapshot again still yields a new Expenses array. Typing runs no pass.
    const materialize = jest.spyOn(useExpensesStore.getState(), 'rollForwardMonth');
    for (const value of ['2000', '1', '']) type(value);
    await settle();
    expect(materialize).not.toHaveBeenCalled();
    materialize.mockRestore();
    act(() => { useIncomeStore.setState({ incomeByMonth: { [MONTH]: kr(21_000) } }); });
    await act(async () => { await useExpensesStore.getState().fetchFromSupabase(); });
    await settle();
    expect(septemberOf('rent')).toHaveLength(1);
    expect(texts()).toContain('11.500 kr.');
  });
});

describe('APP-044 the purchase is never saved, synced or sent', () => {
  async function storage() {
    const keys = [...(await AsyncStorage.getAllKeys())].sort();
    return Object.fromEntries(await AsyncStorage.multiGet(keys));
  }

  it('typing amounts changes no store, no storage and sends nothing; only APP-042 materialization wrote', async () => {
    setPlan(20_000, [recurring('rent', 8_000, '2026-08-01', 'monthly'), oneTime('groceries', 1_500)]);
    useSavingsGoalsStore.setState({
      goals: [{ id: 'buffer', name: 'Synthetic buffer', icon: 'other', targetAmount: kr(10_000), savedAmount: kr(2_000), createdAt: '2026-09-01T00:00:00.000Z' }],
      history: [{ id: 'h1', goalId: 'buffer', amount: kr(2_000), date: '2026-09-01T00:00:00.000Z' }],
      extraSavings: kr(500),
    });
    await settle();
    mockWrites.length = 0;
    (supabase.from as jest.Mock).mockClear();

    await open();
    // Opening the screen materialized September's rent: the user's schedule, not the purchase.
    expect(mockWrites).toEqual([{ table: 'expenses', payload: [expect.objectContaining({ series_id: 'rent', next_payment_date: '2026-09-01', amount: '8000.00' })] }]);

    const state = () => JSON.stringify([
      useExpensesStore.getState(), useIncomeStore.getState().incomeByMonth,
      useSavingsGoalsStore.getState().goals, useSavingsGoalsStore.getState().history, useSavingsGoalsStore.getState().extraSavings,
    ]);
    const stateBefore = state();
    const storageBefore = await storage();
    mockWrites.length = 0;
    (supabase.from as jest.Mock).mockClear();
    const materialize = jest.spyOn(useExpensesStore.getState(), 'rollForwardMonth');

    for (const value of ['1', '12,50', '8000', '10500', '20000', '999999']) type(value);
    await settle();

    expect(materialize).not.toHaveBeenCalled();
    expect(state()).toBe(stateBefore);
    expect(await storage()).toEqual(storageBefore);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockWrites).toEqual([]);

    // Control: even a pass that materializes nothing rewrites the encrypted
    // Expenses bytes (zustand persist, fresh IV), so unchanged storage above also
    // proves no materialization ran while typing.
    materialize.mockRestore();
    useExpensesStore.getState().rollForwardMonth(MONTH);
    await settle();
    expect(state()).toBe(stateBefore);
    expect(await storage()).not.toEqual(storageBefore);
  });
});
