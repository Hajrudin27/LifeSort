import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { router } from 'expo-router';
import PantryScreen from '@/app/food/pantry';
import i18n from '@/localization/i18n';
import { useFoodStore } from '@/store/useFoodStore';
import type { Recipe } from '@/types/food';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/utils/shared/localDate', () => ({
  ...jest.requireActual('@/utils/shared/localDate'), todayIso: () => '2026-09-21',
}));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
}));

const recipe: Recipe = { id: 'recipe-1', name: 'Egg dinner', mealType: 'dinner', ingredients: [
  { kind: 'unlinked', name: 'Eggs', quantity: 3, unit: 'piece' },
  { kind: 'unlinked', name: 'Milk', quantity: 100, unit: 'ml' },
  { kind: 'unlinked', name: 'Bread', quantity: 1, unit: 'piece' },
] };
let tree: TestRenderer.ReactTestRenderer;
const renderedText = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' ');

beforeEach(async () => {
  jest.clearAllMocks();
  await useFoodStore.persist.rehydrate();
  useFoodStore.setState({ pantryItems: [], recipes: [], shoppingItems: [], savedPlans: {} });
  await i18n.changeLanguage('da');
  await act(async () => { tree = TestRenderer.create(<PantryScreen />); });
});
afterEach(() => { act(() => { tree.unmount(); }); });

describe('APP-051 Pantry read-only section', () => {
  it.each(['da', 'en'])('renders explicit use-soon evidence, unconfirmed ingredients and neutral past expiry in %s', async (language) => {
    await act(async () => { await i18n.changeLanguage(language); });
    await act(async () => { useFoodStore.setState({
      recipes: [recipe], pantryItems: [
        { id: 'soon', name: 'Eggs', expiryDate: '2026-09-22', addedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'other', name: 'Milk', addedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'past', name: 'Yogurt', expiryDate: '2026-09-20', addedAt: '2026-01-01T00:00:00.000Z' },
      ],
    }); });
    const output = renderedText();
    expect(output).toContain(i18n.t('food.useSoon.title'));
    expect(output).toContain('Eggs');
    expect(output).toContain(i18n.t('food.useSoon.registeredExpiry', { date: '2026-09-22' }));
    expect(output).toContain(i18n.t('food.useSoon.otherPantryMatches', { items: 'Milk' }));
    expect(output).toContain(i18n.t('food.useSoon.notConfirmed', { count: 1 }));
    expect(output).toContain(i18n.t('food.useSoon.datePassed'));
    expect(output).toContain(i18n.t('food.useSoon.context'));
    expect(output).toContain(i18n.t('food.useSoon.checkLabel'));
  });

  it('shows an empty suggestion state when no eligible recipe matches', async () => {
    await act(async () => { useFoodStore.setState({ recipes: [recipe], pantryItems: [
      { id: 'past', name: 'Eggs', expiryDate: '2026-09-20', addedAt: '2026-01-01T00:00:00.000Z' },
    ] }); });
    expect(renderedText()).toContain(i18n.t('food.useSoon.noSuggestions'));
    expect(tree.root.findAllByProps({ accessibilityLabel: i18n.t('food.useSoon.openRecipe', { name: recipe.name }) })).toHaveLength(0);
  });

  it('opens the existing recipe detail route without changing Food state', async () => {
    await act(async () => { useFoodStore.setState({ recipes: [recipe], pantryItems: [
      { id: 'soon', name: 'Eggs', expiryDate: '2026-09-21', addedAt: '2026-01-01T00:00:00.000Z' },
    ] }); });
    const before = useFoodStore.getState();
    await act(async () => { tree.root.findByProps({ accessibilityLabel: i18n.t('food.useSoon.openRecipe', { name: recipe.name }) }).props.onPress(); });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/food/recipes/[id]', params: { id: recipe.id } });
    expect(useFoodStore.getState()).toEqual(before);
  });
});
