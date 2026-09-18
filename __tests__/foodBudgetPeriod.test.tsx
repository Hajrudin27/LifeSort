import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

import i18n from '@/localization/i18n';
import { emulateUtcHost } from './helpers/utcHost';

/**
 * APP-045 on the Food side: one pure read model, one Copenhagen period, and the
 * same facts on the Food overview, the weekly plan, Home and the Economy tab's
 * Food card. See docs/app-045-budget-periods.md.
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
import FoodBudgetScreen from '@/app/food/budget';
import FoodScreen from '@/app/food/index';
import OffersScreen from '@/app/food/offers';
import RecipesScreen from '@/app/food/recipes/index';
import WeeklyPlanScreen from '@/app/food/weekly-plan';
import { budgetPeriodForCalendarDate, budgetPeriodForInstant } from '@/core/dates/budgetPeriod';
import { foodBudgetFacts, previousFoodWeekKey } from '@/features/food/budgetReadModel';
import { foodHomeSnapshot } from '@/features/food/homeSnapshot';
import { foodMonthlyReview } from '@/features/food/monthlyReview';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useFoodStore } from '@/store/useFoodStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import type { GroceryPurchase } from '@/types/food';
import { findBestGlobalPrice } from '@/utils/food/priceLookup';

/** Sunday 31 May 2026 in UTC; Monday 1 June 2026, 00:30, in Copenhagen. */
const T = '2026-05-31T22:30:00.000Z';
const BUDGETS = { '2026-05': 3100, '2026-06': 3000 };
const PURCHASES: GroceryPurchase[] = [
  { id: 'after-midnight', amount: 150, date: '2026-05-31T22:10:00.000Z' }, // Copenhagen Mon 1 June, 2026-W23
  { id: 'before-midnight', amount: 90, date: '2026-05-31T21:50:00.000Z' }, // Copenhagen Sun 31 May, 2026-W22
  { id: 'earlier', amount: 70, date: '2026-05-29T10:00:00.000Z' }, // 2026-W22
];
/**
 * The Copenhagen facts at T. June 2026 touches five ISO weeks: 3000 / 5 = 600.
 * A device deriving the period from its own UTC clock would instead show May,
 * 2026-W22, 3100 / 5 = 620 and 160 spent.
 */
const EXPECTED = {
  monthKey: '2026-06', weekKey: '2026-W23', hasBudget: true,
  monthlyBudget: 3000, weeklyBudget: 600, spentThisWeek: 150, remaining: 450,
};

let tree: TestRenderer.ReactTestRenderer | undefined;
let restoreHost: (() => void) | undefined;
const plain = (value: string) => value.replace(/[  ]/g, ' ');
const t = (key: string, options?: Record<string, unknown>) => plain(i18n.t(key, options));
const texts = () => tree!.root.findAllByType(Text).map((node) => plain([node.props.children].flat().join('')));
const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function render(element: React.ReactElement) {
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(element); });
  await settle();
}
const facts = (purchases: readonly GroceryPurchase[] = PURCHASES, monthlyBudgetByMonth: Record<string, number> = BUDGETS) =>
  foodBudgetFacts({ period: budgetPeriodForInstant(new Date(T)), monthlyBudgetByMonth, purchases });

beforeEach(async () => {
  await Promise.all([useFoodStore.persist.rehydrate(), useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate()]);
  useFoodStore.setState({ monthlyBudgetByMonth: BUDGETS, purchases: PURCHASES, offers: [], globalOffers: [], globalStandardPrices: [], selectedStores: [], savedPlans: {} });
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  await i18n.changeLanguage('da');
  await settle();
  // Only the clock is fixed, and the device pretends to be in UTC.
  jest.useFakeTimers({
    now: new Date(T),
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
      'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
      'hrtime', 'performance'],
  });
  restoreHost = emulateUtcHost();
});
afterEach(async () => {
  act(() => { tree?.unmount(); });
  tree = undefined;
  restoreHost?.();
  jest.useRealTimers();
  await settle();
});

describe('APP-045 the Food read model', () => {
  it('derives the monthly and weekly budget, the week spent and what remains, from the Copenhagen period', () => {
    expect(new Date(T).getDate()).toBe(31); // the emulated device says 31 May
    expect(facts()).toEqual(EXPECTED);
  });

  it('keeps the unchanged formula: monthly budget ÷ ISO weeks touching the month', () => {
    const at = (dateKey: string, budget: number) =>
      foodBudgetFacts({ period: budgetPeriodForCalendarDate(dateKey)!, monthlyBudgetByMonth: { [dateKey.slice(0, 7)]: budget }, purchases: [] });
    expect(at('2027-02-10', 1000)).toMatchObject({ weeklyBudget: 250, remaining: 250 }); // four weeks
    expect(at('2026-09-10', 4000)).toMatchObject({ weeklyBudget: 800 }); // five weeks
    expect(at('2027-01-10', 1000)).toMatchObject({ weeklyBudget: 200 }); // five, including 2026-W53
  });

  it('reports no budget without inventing one, and keeps a set 0 kr. budget as a budget', () => {
    expect(facts(PURCHASES, {})).toEqual({ monthKey: '2026-06', weekKey: '2026-W23', hasBudget: false, spentThisWeek: 150 });
    expect(facts(PURCHASES, { '2026-06': 0 })).toMatchObject({ hasBudget: true, weeklyBudget: 0, remaining: -150 });
  });

  it('places a purchase by its Copenhagen date, not its UTC or host date, at a week boundary', () => {
    const week = (date: string) => facts([{ id: 'p', amount: 10, date }]).spentThisWeek;
    // Monday 1 June 2026 starts at 31 May 22:00 UTC in Copenhagen.
    expect(week('2026-05-31T21:59:59.999Z')).toBe(0);
    expect(week('2026-05-31T22:00:00.000Z')).toBe(10);
    expect(week('2026-06-01T00:30:00+02:00')).toBe(10);
  });

  it('keeps a legacy date-only purchase on its written date, and ignores dates it cannot place', () => {
    const spent = (date: string) => facts([{ id: 'p', amount: 10, date }]).spentThisWeek;
    expect(spent('2026-06-01')).toBe(10);
    expect(spent('2026-05-31')).toBe(0);
    for (const date of ['not a date', '2026-06-01T10:00:00', '']) expect(spent(date)).toBe(0);
  });

  it('names last week, across a year boundary too', () => {
    expect(previousFoodWeekKey(budgetPeriodForInstant(new Date(T)))).toBe('2026-W22');
    expect(previousFoodWeekKey(budgetPeriodForCalendarDate('2027-01-04')!)).toBe('2026-W53');
  });
});

describe('APP-045 every Food surface shows the same facts for the same instant', () => {
  it('Home card', async () => {
    expect(await foodHomeSnapshot(new Date(T))).toMatchObject({ value: '450 kr.', helperKey: 'home.foodSnapshotHelper', priority: 'normal' });
    // Called without an instant it reads the (fixed) clock, and agrees.
    expect(await foodHomeSnapshot()).toMatchObject({ value: '450 kr.' });
  });

  it('Food overview', async () => {
    await render(<FoodScreen />);
    expect(texts()).toEqual(expect.arrayContaining(['150 / 600 kr.', t('food.weeklyRemaining', { amount: '450' })]));
  });

  it('Economy tab Food card', async () => {
    await render(<EconomyScreen />);
    expect(texts()).toContain(t('economy.foodSubtitle', { amount: '150 kr.', budget: '600 kr.' }));
  });

  it('weekly plan', async () => {
    await render(<WeeklyPlanScreen />);
    expect(texts()).toEqual(expect.arrayContaining(['600 kr.', '3000 kr.']));
  });

  it('the budget form saves to the Copenhagen month', async () => {
    await render(<FoodBudgetScreen />);
    await act(async () => { tree!.root.findByType(TextInput).props.onChangeText('2800'); });
    const button = tree!.root.findAllByProps({ label: t('food.save') })[0];
    const pressable = button.findAllByProps({ accessibilityRole: 'button' }).find((node) => typeof node.props.onPress === 'function')!;
    await act(async () => { pressable.props.onPress(); });
    expect(useFoodStore.getState().monthlyBudgetByMonth).toEqual({ '2026-05': 3100, '2026-06': 2800 });
  });
});

describe('APP-045 weekly plan and current offers use the Copenhagen week and date', () => {
  it('saves a generated plan under the Copenhagen week', async () => {
    await render(<WeeklyPlanScreen />);
    const button = tree!.root.findAllByProps({ label: t('food.generatePlan') })[0];
    const pressable = button.findAllByProps({ accessibilityRole: 'button' }).find((node) => typeof node.props.onPress === 'function')!;
    await act(async () => { pressable.props.onPress(); });
    expect(Object.keys(useFoodStore.getState().savedPlans)).toEqual(['2026-W23']);
  });

  it("matches recipes against this Copenhagen week's offers only", async () => {
    const recipe = { id: 'r1', name: 'Synthetic pasta', mealType: 'dinner' as const, ingredients: [{ name: 'pasta', amount: '500 g' }] };
    const offer = (weekKey: string) => ({ id: `o-${weekKey}`, productName: 'Pasta', price: 10, store: 'Netto', weekKey, source: 'manual' as const });
    useFoodStore.setState({ recipes: [recipe], offers: [offer('2026-W22')] });
    await render(<RecipesScreen />);
    expect(texts()).not.toContain(t('food.matchedThisWeek', { matched: 1, total: 1 }));

    await act(async () => { useFoodStore.setState({ offers: [offer('2026-W23')] }); });
    expect(texts()).toContain(t('food.matchedThisWeek', { matched: 1, total: 1 }));
  });

  it("treats a Danish campaign as active on its Copenhagen dates", async () => {
    const campaign = (day: string) => ({ id: `g-${day}`, productName: 'Pasta', store: 'Netto', offerPrice: 5, validFrom: day, validTo: day });
    const standard = [{ id: 's1', productName: 'Pasta', store: 'Netto', price: 12 }];
    expect(findBestGlobalPrice('pasta', [campaign('2026-06-01')], standard, ['Netto'])).toMatchObject({ source: 'offer', price: 5 });
    expect(findBestGlobalPrice('pasta', [campaign('2026-05-31')], standard, ['Netto'])).toMatchObject({ source: 'standard', price: 12 });

    useFoodStore.setState({ globalOffers: [campaign('2026-06-01'), { ...campaign('2026-05-31'), productName: 'Ris' }], selectedStores: ['Netto'] });
    await render(<OffersScreen />);
    expect(texts()).toContain('Pasta');
    expect(texts()).not.toContain('Ris');
  });
});

describe('APP-045 the Food monthly review keeps its month and places purchases in Copenhagen', () => {
  it('counts a purchase in the month it happened in Copenhagen, and a date-only one as written', async () => {
    useFoodStore.setState({
      purchases: [
        { id: 'sep', amount: 400, date: '2026-08-31T22:30:00.000Z' }, // 1 September in Copenhagen
        { id: 'aug', amount: 250, date: '2026-08-31' },
      ],
    });
    const spent = async (monthKey: string) =>
      (await foodMonthlyReview(monthKey)).find((fact) => fact.labelKey === 'review.foodSpent')?.params;
    expect(await spent('2026-09')).toEqual({ amount: '400', count: 1 });
    expect(await spent('2026-08')).toEqual({ amount: '250', count: 1 });
  });
});
