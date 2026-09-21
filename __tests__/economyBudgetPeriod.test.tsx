/// <reference types="node" />

import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

import i18n from '@/localization/i18n';
import { emulateUtcHost } from './helpers/utcHost';

/**
 * APP-045 on the Economy side: Home's Economy card, the Economy tab and APP-044
 * use the same Copenhagen month, prepare this month's recurring costs through one
 * path, and treat missing income as unknown rather than 0 kr.
 * See docs/app-045-budget-periods.md.
 */

jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/components/ExpensePieChart', () => () => null);
jest.mock('@/components/RingProgress', () => () => null);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => require('react').createElement(require('react-native').View, props),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import EconomyScreen from '@/app/(tabs)/economy';
import PurchaseImpactScreen from '@/app/economy/affordability';
import IncomeScreen from '@/app/expenses/income';
import type { RecurrenceFrequency } from '@/core/economy/recurrence';
import { formatDkk } from '@/core/money/format';
import { minorUnits } from '@/core/money/minorUnits';
import { useHomeSnapshots, type HomeSnapshotProviders } from '@/core/modules/homeSnapshots';
import { economyHomeSnapshot } from '@/features/economy/homeSnapshot';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useFoodStore } from '@/store/useFoodStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import type { Expense } from '@/types/expense';

/** Sunday 31 May 2026 in UTC; Monday 1 June 2026, 00:30, in Copenhagen. */
const T = '2026-05-31T22:30:00.000Z';
const JUNE = '2026-06';
const MAY = '2026-05';
const REPO_ROOT = path.resolve(__dirname, '..');

const m = minorUnits;
const kr = (amount: number) => m(amount * 100);
const oneTime = (id: string, amountKr: number, date: string): Expense => ({
  id, seriesId: id, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null,
  name: `Synthetic ${id}`, amount: kr(amountKr), category: 'other', nextPaymentDate: date,
  attachments: [], createdAt: `${date}T00:00:00.000Z`,
});
const recurring = (id: string, amountKr: number, date: string, frequency: RecurrenceFrequency): Expense => ({
  ...oneTime(id, amountKr, date), category: 'bill', isRecurring: true, recurrenceFrequency: frequency,
  recurrenceAnchorDay: Number(date.slice(8)),
});
const instancesIn = (month: string, seriesId: string) =>
  useExpensesStore.getState().expenses.filter((expense) => expense.seriesId === seriesId && expense.nextPaymentDate.startsWith(month));
const junePlan = () => economyTotalsForMonth(useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth, JUNE);

let tree: TestRenderer.ReactTestRenderer | undefined;
let restoreHost: (() => void) | undefined;
const plain = (value: string) => value.replace(/[  ]/g, ' ');
const t = (key: string) => plain(i18n.t(key));
const texts = () => tree!.root.findAllByType(Text).map((node) => plain([node.props.children].flat().join('')));
const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function render(element: React.ReactElement) {
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(element); });
  await settle();
}
/** Renders `element` and records the visible texts of every commit, the first one included. */
async function renderRecordingCommits(element: React.ReactElement): Promise<string[][]> {
  const commits: string[][] = [];
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(<></>); });
  await act(async () => {
    tree!.update(<React.Profiler id="commits" onRender={() => { commits.push(texts()); }}>{element}</React.Profiler>);
  });
  await settle();
  return commits;
}
const home = async () => {
  const snapshot = await economyHomeSnapshot(new Date(T));
  return snapshot && { ...snapshot, value: snapshot.value && plain(snapshot.value) };
};

beforeEach(async () => {
  await Promise.all([
    useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate(),
    useSavingsGoalsStore.persist.rehydrate(), useFoodStore.persist.rehydrate(),
  ]);
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
  useFoodStore.setState({ monthlyBudgetByMonth: {}, purchases: [] });
  await i18n.changeLanguage('da');
  await settle();
  jest.useFakeTimers({
    now: new Date(T),
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
      'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
      'hrtime', 'performance'],
  });
  // The device pretends to be in UTC, where it is still Sunday 31 May.
  restoreHost = emulateUtcHost();
});
afterEach(async () => {
  act(() => { tree?.unmount(); });
  tree = undefined;
  restoreHost?.();
  jest.useRealTimers();
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {} });
  await settle();
});

describe('APP-045 Home, the Economy tab and APP-044 agree on the month', () => {
  beforeEach(() => {
    useIncomeStore.setState({ incomeByMonth: { [JUNE]: kr(20_000), [MAY]: kr(99_000) } });
    useExpensesStore.setState({ expenses: [oneTime('june-rent', 6_000, '2026-06-10'), oneTime('may-bill', 1_000, '2026-05-10')] });
  });

  it('shows the June plan everywhere, exactly the APP-039 totals for that explicit month', async () => {
    const explicit = economyTotalsForMonth(useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth, JUNE);
    expect(explicit).toMatchObject({ settledIncome: kr(20_000), settledSpending: kr(6_000), balance: kr(14_000), hasIncome: true });
    const balance = plain(formatDkk(explicit.balance, 'da-DK'));
    expect(balance).toBe('14.000 kr.');

    expect(await home()).toMatchObject({ value: balance });

    await render(<EconomyScreen />);
    expect(texts()).toEqual(expect.arrayContaining(['20.000 kr.', '6.000 kr.', balance]));
    expect(texts()).not.toContain('99.000 kr.');

    await render(<PurchaseImpactScreen />);
    expect(texts()).toEqual(expect.arrayContaining(['juni 2026', '20.000 kr.', '6.000 kr.', balance]));
  });

  it('registers income for the Copenhagen month when no month is given', async () => {
    await render(<IncomeScreen />);
    await act(async () => { tree!.root.findByType(TextInput).props.onChangeText('21000'); });
    const button = tree!.root.findAllByProps({ label: t('expenses.save') })[0];
    const pressable = button.findAllByProps({ accessibilityRole: 'button' }).find((node) => typeof node.props.onPress === 'function')!;
    await act(async () => { pressable.props.onPress(); });
    expect(useIncomeStore.getState().incomeByMonth).toEqual({ [JUNE]: kr(21_000), [MAY]: kr(99_000) });
  });
});

describe("APP-045 this month's recurring costs are prepared before the Economy snapshot", () => {
  beforeEach(() => {
    useIncomeStore.setState({ incomeByMonth: { [JUNE]: kr(20_000) } });
  });

  it('Home materializes the due bill before it computes the card, and only once', async () => {
    useExpensesStore.setState({ expenses: [recurring('rent', 8_000, '2026-05-01', 'monthly')] });
    expect(junePlan().settledSpending).toBe(0); // no screen has materialized June yet

    expect(await home()).toMatchObject({ value: '12.000 kr.' });
    expect(instancesIn(JUNE, 'rent').map((expense) => expense.nextPaymentDate)).toEqual(['2026-06-01']);

    for (let i = 0; i < 3; i += 1) expect(await home()).toMatchObject({ value: '12.000 kr.' });
    expect(instancesIn(JUNE, 'rent')).toHaveLength(1);

    await render(<EconomyScreen />);
    expect(texts()).toContain('12.000 kr.');
    expect(instancesIn(JUNE, 'rent')).toHaveLength(1);
  });

  // June: 20.000 kr. income and 1.000 kr. of groceries. Without June's rent the
  // plan reads 1.000 kr. spent and 19.000 kr. left; with it, 9.000 and 11.000.
  const groceries = () => oneTime('groceries', 1_000, '2026-06-05');
  const WITHOUT_RENT = ['1.000 kr.', '19.000 kr.', plain(i18n.t('economy.expensesSubtitle', { amount: formatDkk(kr(1_000), 'da-DK') }))];
  const unpreparedFigures = (commit: string[]) => commit.filter((text) => WITHOUT_RENT.includes(text));
  const preparing = () => ['…', t('economy.preparingMonth')];

  it('the Economy tab never presents June before its recurring costs are prepared', async () => {
    useExpensesStore.setState({ expenses: [recurring('rent', 8_000, '2026-05-01', 'monthly'), groceries()] });

    const commits = await renderRecordingCommits(<EconomyScreen />);

    // The first commit comes before any pass: it says it is loading, which is not "no income".
    expect(commits[0]).toEqual(expect.arrayContaining(preparing()));
    expect(commits[0]).not.toContain(t('economy.noIncome'));
    expect(commits[0]).toContain('20.000 kr.'); // income needs no preparation and stays visible
    expect(commits.map(unpreparedFigures)).toEqual(commits.map(() => []));

    expect(instancesIn(JUNE, 'rent').map((expense) => expense.nextPaymentDate)).toEqual(['2026-06-01']);
    expect(texts()).toEqual(expect.arrayContaining(['9.000 kr.', '11.000 kr.', '20.000 kr.']));
    expect(texts()).not.toContain('…');
  });

  it('a new Expenses snapshot on the open Economy tab is not ready until that snapshot is prepared', async () => {
    useExpensesStore.setState({ expenses: [groceries()] });
    const commits = await renderRecordingCommits(<EconomyScreen />);
    // Prepared (nothing was due): the figures are final for this snapshot.
    expect(texts()).toEqual(expect.arrayContaining(['1.000 kr.', '19.000 kr.']));
    expect(texts()).not.toContain('…');

    // A late source update (such as the startup fetch) brings an older series in,
    // on the same mounted tab.
    commits.length = 0;
    await act(async () => {
      useExpensesStore.setState((state) => ({ expenses: [...state.expenses, recurring('rent', 8_000, '2026-04-01', 'monthly')] }));
    });
    await settle();

    // The render that first observes the new snapshot is already not ready, and
    // no commit shows the plan without the due rent.
    expect(commits[0]).toEqual(expect.arrayContaining(preparing()));
    expect(commits.map(unpreparedFigures)).toEqual(commits.map(() => []));
    expect(instancesIn(JUNE, 'rent').map((expense) => expense.nextPaymentDate)).toEqual(['2026-06-01']);
    expect(texts()).toEqual(expect.arrayContaining(['9.000 kr.', '11.000 kr.']));
    expect(texts()).not.toContain('…');

    // Income needs no preparation: the tab stays ready and updates at once.
    commits.length = 0;
    await act(async () => { useIncomeStore.setState({ incomeByMonth: { [JUNE]: kr(21_000) } }); });
    await settle();
    expect(commits.filter((commit) => commit.includes('…'))).toEqual([]);
    expect(texts()).toContain('12.000 kr.');

    // A new array with nothing due: one no-op pass, ready again, no second instance, no loop.
    commits.length = 0;
    await act(async () => { useExpensesStore.setState((state) => ({ expenses: [...state.expenses] })); });
    await settle();
    expect(commits.length).toBeLessThan(5);
    expect(instancesIn(JUNE, 'rent')).toHaveLength(1);
    expect(texts()).toEqual(expect.arrayContaining(['9.000 kr.', '12.000 kr.']));
    expect(texts()).not.toContain('…');
  });
});

describe('APP-045 missing income is not zero income on Home', () => {
  beforeEach(() => {
    useExpensesStore.setState({ expenses: [oneTime('groceries', 2_000, '2026-06-05')] });
  });

  it("shows no balance without this month's income, as the Economy tab does", async () => {
    useIncomeStore.setState({ incomeByMonth: { [MAY]: kr(99_000) } }); // another month only
    expect(await home()).toMatchObject({ value: '—', helperKey: 'home.moneySnapshotMissingIncome', priority: 'normal' });
    expect(i18n.t('home.moneySnapshotMissingIncome')).not.toBe('home.moneySnapshotMissingIncome');

    await render(<EconomyScreen />);
    expect(texts()).toContain(t('economy.noIncome'));
    expect(texts()).not.toContain('-2.000 kr.');
  });

  it('treats a registered 0 kr. income as known, so the negative balance is a real result', async () => {
    useIncomeStore.setState({ incomeByMonth: { [JUNE]: m(0) } });
    expect(await home()).toMatchObject({ value: '-2.000 kr.', helperKey: 'home.moneySnapshotHelper', priority: 'urgent' });
  });
});

describe('APP-045 Home collects its cards at one instant', () => {
  it('passes the same instant to every provider', async () => {
    const seen: (Date | undefined)[] = [];
    const providers: HomeSnapshotProviders = {
      economy: async (now) => { seen.push(now); return null; },
      food: async (now) => { seen.push(now); return null; },
    };
    function Probe() {
      useHomeSnapshots(providers);
      return null;
    }
    await render(<Probe />);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeInstanceOf(Date);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[0]!.toISOString()).toBe(T);
  });
});

describe('APP-045 boundaries', () => {
  const importsOf = (file: string) =>
    [...fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').matchAll(/import\s+(?:type\s+)?(?:\{([^}]*)\}|[\w*\s,]+)?\s*from\s+['"]([^'"]+)['"]/g)]
      .map((match) => ({ names: (match[1] ?? '').split(',').map((name) => name.trim()).filter(Boolean), from: match[2] }));

  it('Economy current surfaces consume a Food read model, never a Food date helper', () => {
    const economyFiles = [
      'app/(tabs)/economy.tsx', 'app/economy/affordability.tsx', 'app/economy/insights.tsx',
      ...fs.readdirSync(path.join(REPO_ROOT, 'features/economy')).map((file) => `features/economy/${file}`),
    ];
    const reachingFoodTime = economyFiles.flatMap((file) =>
      importsOf(file).filter(({ from }) => from.startsWith('@/utils/food/')).map(({ from }) => `${file} -> ${from}`));
    expect(reachingFoodTime).toEqual([]);
  });

  it('the canonical period lives in core and knows neither Food nor Economy', () => {
    expect(importsOf('core/dates/budgetPeriod.ts').map(({ from }) => from)).toEqual(['@/utils/shared/localDate']);
  });

  it('the Food read model builds on the core period and nothing stateful', () => {
    expect(importsOf('features/food/budgetReadModel.ts').map(({ from }) => from).sort()).toEqual(['@/core/dates/budgetPeriod', '@/types/food']);
  });

  it('leaves one ISO-week algorithm: Food keeps only its weekday labels', () => {
    expect(Object.keys(require('@/utils/food/foodWeek'))).toEqual(['getWeekdayNames']);
  });

  it('current-period surfaces take their period from core/dates, not host-local month helpers', () => {
    const CURRENT_PERIOD_FILES = [
      'app/(tabs)/economy.tsx', 'app/(tabs)/index.tsx', 'app/economy/affordability.tsx', 'app/economy/insights.tsx',
      'app/expenses/income.tsx', 'app/savings/index.tsx', 'app/savings/allocate.tsx',
      'app/food/index.tsx', 'app/food/budget.tsx', 'app/food/weekly-plan.tsx', 'app/food/offers.tsx',
      'app/food/recipes/index.tsx', 'app/food/recipes/[id].tsx',
      'features/economy/homeSnapshot.ts', 'features/food/homeSnapshot.ts', 'utils/food/priceLookup.ts',
      'utils/food/priceEvidence.ts',
    ];
    const offenders = CURRENT_PERIOD_FILES.flatMap((file) => {
      const imports = importsOf(file);
      const hostLocal = imports.filter(({ from, names }) =>
        (from === '@/utils/shared/monthKey' && names.includes('getMonthKey')) ||
        (from === '@/utils/shared/localDate' && names.includes('todayIso')));
      // APP-048: price consumers delegate campaign dates to one evidence function.
      // Keep consumers in this gate and require that provider itself to use core.
      const evidenceConsumer = ['app/food/offers.tsx', 'utils/food/priceLookup.ts'].includes(file);
      const usesCore = evidenceConsumer
        ? imports.some(({ from, names }) => from === '@/utils/food/priceEvidence' && names.includes('offerEvidence'))
        : imports.some(({ from }) => from === '@/core/dates/budgetPeriod');
      return [...hostLocal.map(({ from }) => `${file} -> ${from}`), ...(usesCore ? [] : [`${file} -> (no core/dates)`])];
    });
    expect(offenders).toEqual([]);
  });
});
