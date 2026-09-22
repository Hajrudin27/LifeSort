import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import WeeklyPlanScreen from '@/app/food/weekly-plan';
import { budgetPeriodForInstant } from '@/core/dates/budgetPeriod';
import i18n from '@/localization/i18n';
import { useFoodStore } from '@/store/useFoodStore';
import type { Recipe } from '@/types/food';

jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } } }));

const recipe: Recipe = { id: 'recipe', name: 'Dinner', mealType: 'dinner', ingredients: [
  { kind: 'family', familyId: 'potato', name: 'Potatoes', quantity: 500, unit: 'g' },
] };
const weekKey = budgetPeriodForInstant(new Date()).weekKey;
let tree: TestRenderer.ReactTestRenderer;
const button = (label: string) => tree.root.findByProps({ label });

beforeEach(async () => {
  await useFoodStore.persist.rehydrate();
  useFoodStore.setState({ recipes: [recipe], pantryItems: [], shoppingItems: [], savedPlans: {},
    globalOffers: [], globalStandardPrices: [], selectedStores: [], purchases: [], monthlyBudgetByMonth: {} });
  await i18n.changeLanguage('da');
  await act(async () => { tree = TestRenderer.create(<WeeklyPlanScreen />); });
});
afterEach(() => { act(() => tree.unmount()); jest.restoreAllMocks(); });

it('requires explicit generation and confirmation before replacing this week’s generated items', async () => {
  expect(useFoodStore.getState().shoppingItems).toEqual([]);
  await act(async () => { button(i18n.t('food.generatePlan')).props.onPress(); });
  expect(useFoodStore.getState().shoppingItems).toEqual([]);
  await act(async () => { button(i18n.t('food.shoppingDerivation.generateAction')).props.onPress(); });
  const first = useFoodStore.getState().shoppingItems;
  expect(first.some((item) => item.kind === 'meal_plan' && item.weekKey === weekKey)).toBe(true);
  await act(async () => { useFoodStore.getState().addShoppingItem('Potatoes'); });
  const manual = useFoodStore.getState().shoppingItems.find((item) => item.kind === 'manual');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await act(async () => { button(i18n.t('food.shoppingDerivation.generateAction')).props.onPress(); });
  expect(alert).toHaveBeenCalledWith(i18n.t('food.shoppingDerivation.replaceTitle'), i18n.t('food.shoppingDerivation.replaceBody'), expect.any(Array));
  expect(useFoodStore.getState().shoppingItems).toContainEqual(manual);
  expect(useFoodStore.getState().shoppingItems.some((item) => item.id === first[0].id)).toBe(true);
  await act(async () => { alert.mock.calls[0][2]?.find((entry) => entry.text === i18n.t('food.shoppingDerivation.replaceAction'))?.onPress?.(); });
  expect(useFoodStore.getState().shoppingItems).toContainEqual(manual);
  expect(useFoodStore.getState().shoppingItems.some((item) => item.id === first[0].id)).toBe(false);
});
