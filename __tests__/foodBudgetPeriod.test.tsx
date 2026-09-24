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
import { familyIngredient, unlinkedIngredient } from '@/core/food/ingredients';
import { foodBudgetFacts, previousFoodWeekKey } from '@/features/food/budgetReadModel';
import { assessFoodPlanBudget } from '@/features/food/planBudgetAssessment';
import { foodHomeSnapshot } from '@/features/food/homeSnapshot';
import { foodMonthlyReview } from '@/features/food/monthlyReview';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useFoodStore } from '@/store/useFoodStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import type { GlobalOffer, GlobalStandardPrice, GroceryPurchase } from '@/types/food';
import { findBestGlobalPrice } from '@/utils/food/priceLookup';
import { offerEvidence, summarizePrices, unavailablePrice } from '@/utils/food/priceEvidence';

/** Sunday 31 May 2026 in UTC; Monday 1 June 2026, 00:30, in Copenhagen. */
const T = '2026-05-31T22:30:00.000Z';
const BUDGETS = { '2026-05': 3100, '2026-06': 3000 };
const PURCHASES: GroceryPurchase[] = [
  { id: 'after-midnight', amount: 150, date: '2026-05-31T22:10:00.000Z' }, // Copenhagen Mon 1 June, 2026-W23
  { id: 'before-midnight', amount: 90, date: '2026-05-31T21:50:00.000Z' }, // Copenhagen Sun 31 May, 2026-W22
  { id: 'earlier', amount: 70, date: '2026-05-29T10:00:00.000Z' }, // 2026-W22
];
const catalogueOffer = (overrides: Partial<GlobalOffer> = {}): GlobalOffer => ({
  id: 'catalogue-offer', standardPriceId: 'catalogue-standard', productId: 'catalogue-product', productName: 'Pasta',
  ingredientFamilyId: 'pasta', store: 'Netto', offerPrice: 5, referencePrice: 12,
  validFrom: '2026-06-01', validTo: '2026-06-01', published: true, licenceCleared: true, memberCondition: null,
  ...overrides,
});
const catalogueStandard = (overrides: Partial<GlobalStandardPrice> = {}): GlobalStandardPrice => ({
  id: 'catalogue-standard', productId: 'catalogue-product', productName: 'Pasta', ingredientFamilyId: 'pasta',
  store: 'Netto', price: 12, ...overrides,
});
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
    const recipe = { id: 'r1', name: 'Synthetic pasta', mealType: 'dinner' as const, ingredients: [unlinkedIngredient('pasta', 500, 'g')] };
    const offer = (weekKey: string) => ({ id: `o-${weekKey}`, productName: 'Pasta', price: 10, store: 'Netto', weekKey, source: 'manual' as const });
    useFoodStore.setState({ recipes: [recipe], offers: [offer('2026-W22')] });
    await render(<RecipesScreen />);
    expect(texts()).not.toContain(t('food.matchedThisWeek', { matched: 1, total: 1 }));

    await act(async () => { useFoodStore.setState({ offers: [offer('2026-W23')] }); });
    expect(texts()).toContain(t('food.matchedThisWeek', { matched: 1, total: 1 }));
  });

  it("treats a Danish campaign as active on its Copenhagen dates", async () => {
    const campaign = (day: string) => catalogueOffer({ id: `g-${day}`, validFrom: day, validTo: day });
    const standard = [catalogueStandard({ id: 's1' })];
    const pasta = familyIngredient('pasta', 'pasta', 500, 'g');
    expect(findBestGlobalPrice(pasta, [campaign('2026-06-01')], standard, ['Netto'])).toMatchObject({ source: 'offer', price: 5 });
    expect(findBestGlobalPrice(pasta, [campaign('2026-05-31')], standard, ['Netto'])).toMatchObject({ source: 'standard', price: 12 });

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

describe('APP-048 visible estimates', () => {
  it.each(['da', 'en'])('keeps partial/unknown/stale states visible in %s and refreshes an existing plan', async (language) => {
    await i18n.changeLanguage(language);
    const recipe = { id: 'price-recipe', name: 'Synthetic meal', mealType: 'dinner' as const,
      ingredients: [familyIngredient('pasta', 'pasta', 100, 'g'), unlinkedIngredient('salt', 1, 'g')] };
    const offer = catalogueOffer({ id: 'offer', productName: 'pasta' });
    useFoodStore.setState({ recipes: [recipe], pantryItems: [], globalOffers: [offer], selectedStores: ['Netto'], savedPlans: { '2026-W23': [{ day: 0, mealType: 'dinner', recipeId: recipe.id }] } });
    await render(<WeeklyPlanScreen />);
    expect(texts().join('\n')).toContain(t('food.priceEvidence.count_missing', { count: 1 }));
    expect(texts().join('\n')).toContain(t('food.priceEvidence.current'));
    expect(texts().join('\n')).toContain('2026-06-01');
    expect(texts().join('\n')).toContain(language === 'da' ? 'Delsum for kendte priser' : 'Known-price subtotal');

    await act(async () => { useFoodStore.setState({ globalOffers: [{ ...offer, validFrom: '2026-05-01', validTo: '2026-05-31' }] }); });
    expect(texts().join('\n')).toContain(t('food.priceEvidence.stale'));
    expect(texts().join('\n')).toContain(t('food.priceEvidence.estimate_unavailable'));
    expect(texts().join('\n')).not.toContain(t('food.priceEvidence.current'));

    await act(async () => { useFoodStore.setState({ globalStandardPrices: [catalogueStandard({ id: 's', productName: 'pasta' })] }); });
    expect(texts().join('\n')).toContain(t('food.priceEvidence.unknown'));
    expect(texts().join('\n')).not.toContain('2026-05-31');
  });
});

describe('APP-048 campaign rollover while open', () => {
  it('stops displaying an expired offer without a catalogue update', async () => {
    let refresh: (() => void) | undefined;
    const timer = jest.spyOn(global, 'setInterval').mockImplementation(((callback: () => void) => {
      refresh = callback;
      return 1;
    }) as typeof setInterval);
    try {
      useFoodStore.setState({ selectedStores: ['Netto'], globalOffers: [catalogueOffer({ id: 'one-day', productName: 'Synthetic pasta' })] });
      await render(<OffersScreen />);
      expect(texts()).toContain('Synthetic pasta');
      expect(refresh).toBeDefined();
      jest.setSystemTime(new Date('2026-06-01T22:00:00Z'));
      await act(async () => { refresh!(); });
      expect(texts()).not.toContain('Synthetic pasta');
    } finally {
      timer.mockRestore();
    }
  });
});

describe('APP-053 offer-aware UI semantics', () => {
  it.each(['da', 'en'])('shows a current conditional plan opportunity with dates and factual qualifiers in %s', async (language) => {
    await i18n.changeLanguage(language);
    const recipe = { id: 'offer-aware', name: 'Egg meal', mealType: 'dinner' as const,
      ingredients: [familyIngredient('egg', language === 'da' ? 'Æg' : 'Eggs', 24, 'piece')] };
    const current = catalogueOffer({ productName: 'Egg carton', ingredientFamilyId: 'egg', memberCondition: 'Member card',
      validFrom: '2026-06-01', validTo: '2026-06-01' });
    useFoodStore.setState({ recipes: [recipe], globalOffers: [current], selectedStores: ['Netto'], pantryItems: [] });
    await render(<WeeklyPlanScreen />);
    const generate = tree!.root.findAllByProps({ label: t('food.generatePlan') })[0]
      .findAllByProps({ accessibilityRole: 'button' }).find((node) => typeof node.props.onPress === 'function')!;
    await act(async () => { generate.props.onPress(); });
    const visible = texts().join('\n');
    expect(visible).toContain(t('food.offerAware.potentialSaving', { amount: new Intl.NumberFormat(language === 'da' ? 'da-DK' : 'en-US', { style: 'currency', currency: 'DKK' }).format(7) }));
    expect(visible).toContain(t('food.offerAware.requires', { condition: 'Member card' }));
    expect(visible).toContain('2026-06-01');
    expect(visible).toContain(t('food.offerAware.referenceUnknown'));
    expect(visible).toContain(t('food.priceEvidence.estimate_unavailable'));
  });

  it('shows only authoritative current offers and exposes member conditions as text', async () => {
    useFoodStore.setState({ selectedStores: ['Netto'], globalOffers: [
      catalogueOffer({ id: 'valid', productName: 'Visible', memberCondition: 'Club card' }),
      catalogueOffer({ id: 'draft', productName: 'Draft', published: false as true }),
      catalogueOffer({ id: 'uncleared', productName: 'Unlicensed', licenceCleared: false as true }),
    ] });
    await render(<OffersScreen />);
    expect(texts()).toContain('Visible');
    expect(texts()).not.toContain('Draft');
    expect(texts()).not.toContain('Unlicensed');
    expect(texts().join('\n')).toContain(t('food.offerAware.requires', { condition: 'Club card' }));
  });
});

describe('APP-049 one Food budget and the remaining weekly planning envelope', () => {
  it('keeps four-week, five-week, and ISO week-year allocation in the existing Food contract', () => {
    const read = (date: string, monthly: number) => foodBudgetFacts({
      period: budgetPeriodForCalendarDate(date)!, monthlyBudgetByMonth: { [date.slice(0, 7)]: monthly }, purchases: [],
    });
    expect(read('2027-02-10', 1000)).toMatchObject({ hasBudget: true, weeklyBudget: 250, remaining: 250 });
    expect(read('2026-09-10', 4000)).toMatchObject({ hasBudget: true, weeklyBudget: 800, remaining: 800 });
    expect(read('2027-01-01', 1000)).toMatchObject({ weekKey: '2026-W53', weeklyBudget: 200, remaining: 200 });
  });

  it('distinguishes no budget, explicit zero, and an already overspent week', () => {
    const noBudget = facts([], {});
    const zeroBudget = facts([], { '2026-06': 0 });
    const overspent = facts([{ id: 'p', amount: 650, date: T }]);
    expect(noBudget).toMatchObject({ hasBudget: false });
    expect(assessFoodPlanBudget(noBudget, summarizePrices([]))).toEqual({ status: 'no_budget' });
    expect(zeroBudget).toMatchObject({ hasBudget: true, weeklyBudget: 0, remaining: 0 });
    expect(assessFoodPlanBudget(zeroBudget, summarizePrices([]))).toEqual({ status: 'current_within', remaining: 0, knownSubtotal: 0 });
    expect(overspent).toMatchObject({ weeklyBudget: 600, spentThisWeek: 650, remaining: -50 });
    expect(assessFoodPlanBudget(overspent, summarizePrices([unavailablePrice()]))).toEqual({ status: 'already_over', remaining: -50 });
  });

  it('compares current evidence with remaining allocation and never confirms a partial estimate', () => {
    const current = offerEvidence(catalogueOffer({ id: 'o', offerPrice: 400, referencePrice: 500 }), new Date(T));
    const remaining = facts(); // 600 allocated - 150 purchased = 450
    expect(assessFoodPlanBudget(remaining, summarizePrices([current]))).toEqual({ status: 'current_within', remaining: 450, knownSubtotal: 400 });
    expect(assessFoodPlanBudget(remaining, summarizePrices([current, unavailablePrice()]))).toEqual({ status: 'partial_within', remaining: 450, knownSubtotal: 400 });
    expect(assessFoodPlanBudget(remaining, summarizePrices([unavailablePrice()]))).toEqual({ status: 'price_unavailable', remaining: 450 });
    const moreSpent = facts([{ id: 'p', amount: 300, date: T }]);
    expect(assessFoodPlanBudget(moreSpent, summarizePrices([current]))).toEqual({ status: 'current_above', remaining: 300, knownSubtotal: 400 });
    expect(assessFoodPlanBudget(moreSpent, summarizePrices([current, unavailablePrice()]))).toEqual({ status: 'partial_above', remaining: 300, knownSubtotal: 400 });
  });

  it.each(['da', 'en'])('keeps Food, weekly plan, Home and Economy in agreement as Food facts change in %s', async (language) => {
    await i18n.changeLanguage(language);
    const recipe = { id: 'food-budget-recipe', name: 'Synthetic pasta', mealType: 'dinner' as const, ingredients: [familyIngredient('pasta', 'pasta', 100, 'g')] };
    const price = catalogueOffer({ productName: 'pasta', offerPrice: 400, referencePrice: 500 });
    useFoodStore.setState({ recipes: [recipe], globalOffers: [price], selectedStores: ['Netto'], pantryItems: [] });
    // An Economy category budget, even one called groceries, is not Food's budget.
    useExpensesStore.setState({ categoryBudgets: { groceries: 1 as never } });

    await render(<WeeklyPlanScreen />);
    expect(texts()).toContain('600 kr.');
    expect(texts()).toContain(t('food.weeklyRemaining', { amount: '450' }));
    const generate = tree!.root.findAllByProps({ label: t('food.generatePlan') })[0]
      .findAllByProps({ accessibilityRole: 'button' }).find((node) => typeof node.props.onPress === 'function')!;
    await act(async () => { generate.props.onPress(); });
    expect(texts().join('\n')).toContain(language === 'da' ? 'Estimat med aktuelle prisoplysninger:' : 'Current-price estimate');
    expect(await foodHomeSnapshot(new Date(T))).toMatchObject({ value: '450 kr.' });

    await act(async () => { useFoodStore.setState({ monthlyBudgetByMonth: { '2026-06': 4000 } }); });
    expect(texts()).toContain('800 kr.');
    expect(texts()).toContain(t('food.weeklyRemaining', { amount: '650' }));
    expect(await foodHomeSnapshot(new Date(T))).toMatchObject({ value: '650 kr.' });
    await render(<FoodScreen />);
    expect(texts()).toEqual(expect.arrayContaining(['150 / 800 kr.', t('food.weeklyRemaining', { amount: '650' })]));
    await render(<EconomyScreen />);
    const foodCurrency = new Intl.NumberFormat(language === 'da' ? 'da-DK' : 'en-US', {
      style: 'currency', currency: 'DKK', maximumFractionDigits: 0,
    });
    expect(texts()).toContain(t('economy.foodSubtitle', { amount: foodCurrency.format(150), budget: foodCurrency.format(800) }));

    await act(async () => { useFoodStore.setState({ purchases: [...PURCHASES, { id: 'new', amount: 300, date: T }] }); });
    expect(texts()).toContain(t('economy.foodSubtitle', { amount: foodCurrency.format(450), budget: foodCurrency.format(800) }));
    expect(await foodHomeSnapshot(new Date(T))).toMatchObject({ value: '350 kr.' });
    await render(<WeeklyPlanScreen />);
    expect(texts()).toContain(t('food.weeklyRemaining', { amount: '350' }));
    expect(texts()).toContain('800 kr.');
    expect(texts().join('\n')).toContain(language === 'da' ? 'overstiger de' : 'exceeds the');
  });

  it('lets the Food budget form persist an explicit zero rather than treating it as missing', async () => {
    await render(<FoodBudgetScreen />);
    await act(async () => { tree!.root.findByType(TextInput).props.onChangeText('0'); });
    const button = tree!.root.findAllByProps({ label: t('food.save') })[0];
    const pressable = button.findAllByProps({ accessibilityRole: 'button' }).find((node) => typeof node.props.onPress === 'function')!;
    expect(pressable.props.accessibilityState?.disabled).not.toBe(true);
    await act(async () => { pressable.props.onPress(); });
    expect(useFoodStore.getState().monthlyBudgetByMonth['2026-06']).toBe(0);
  });
});
