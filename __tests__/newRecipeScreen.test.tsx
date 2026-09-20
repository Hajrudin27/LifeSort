import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

/**
 * APP-047 on screen: creating a recipe still works, and every ingredient is
 * saved with a structured quantity and unit — never an opaque amount, and never
 * with a family guessed from the typed name.
 */

jest.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, { upsert: () => Promise.resolve({ error: null }) });
  return { supabase: { from: () => chain, auth: { getUser: () => Promise.resolve({ data: { user: null } }) } } };
});
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));

import NewRecipeScreen from '@/app/food/recipes/new';
import i18n from '@/localization/i18n';
import { useFoodStore } from '@/store/useFoodStore';
import { router } from 'expo-router';

let tree: TestRenderer.ReactTestRenderer;
const t = (key: string) => i18n.t(key);
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const input = (placeholder: string, index = 0) =>
  tree.root.findAllByType(TextInput).filter((node) => node.props.placeholder === placeholder)[index];
const type = (placeholder: string, value: string, index = 0) => act(() => { input(placeholder, index).props.onChangeText(value); });
const controls = (label: string) => tree.root.findAll((node) =>
  typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'button' &&
  node.findAllByType(Text).some((text) => [text.props.children].flat().join('') === label));
const saveButton = () => controls(t('food.save'))[0];
const userRecipes = () => useFoodStore.getState().recipes.filter((recipe) => !recipe.id.startsWith('seed-'));

beforeEach(async () => {
  await useFoodStore.persist.rehydrate();
  useFoodStore.setState({ recipes: useFoodStore.getState().recipes.filter((recipe) => recipe.id.startsWith('seed-')) });
  await i18n.changeLanguage('da');
  (router.back as jest.Mock).mockClear();
  await act(async () => { tree = TestRenderer.create(<NewRecipeScreen />); });
});
afterEach(() => { act(() => { tree.unmount(); }); });

describe('APP-047 new recipe form', () => {
  it('saves typed quantities and the chosen unit as the user’s own unlinked ingredients', () => {
    type(t('food.recipeNamePlaceholder'), 'Synthetic soup');
    type(t('food.ingredientPlaceholder'), ' Æg ');
    type(t('food.ingredientQuantityPlaceholder'), '1,5');
    act(() => { controls('stk')[0].props.onPress(); });
    act(() => { controls(t('food.addIngredient'))[0].props.onPress(); });
    type(t('food.ingredientPlaceholder'), 'Synthetic stock', 1);
    type(t('food.ingredientQuantityPlaceholder'), '250', 1);
    act(() => { controls('ml')[1].props.onPress(); });

    expect(saveButton().props.disabled).toBe(false);
    act(() => { saveButton().props.onPress(); });

    expect(router.back).toHaveBeenCalled();
    expect(userRecipes()).toEqual([expect.objectContaining({
      name: 'Synthetic soup',
      mealType: 'dinner',
      // "Æg" is a seed ingredient's exact name: the form still links no family.
      ingredients: [
        { kind: 'unlinked', name: 'Æg', quantity: 1.5, unit: 'piece' },
        { kind: 'unlinked', name: 'Synthetic stock', quantity: 250, unit: 'ml' },
      ],
    })]);
  });

  it('defaults a new row to grams and ignores rows without a name', () => {
    type(t('food.recipeNamePlaceholder'), 'Synthetic rice');
    type(t('food.ingredientPlaceholder'), 'Synthetic rice');
    type(t('food.ingredientQuantityPlaceholder'), '70');
    act(() => { controls(t('food.addIngredient'))[0].props.onPress(); });
    act(() => { saveButton().props.onPress(); });
    expect(userRecipes()[0].ingredients).toEqual([{ kind: 'unlinked', name: 'Synthetic rice', quantity: 70, unit: 'g' }]);
  });

  it('will not save a named ingredient without a valid quantity, and says what is needed', () => {
    type(t('food.recipeNamePlaceholder'), 'Synthetic soup');
    type(t('food.ingredientPlaceholder'), 'Salt');
    expect(texts()).toContain(t('food.ingredientQuantityHint'));
    for (const value of ['', '0', 'efter smag', '1.000', '-2']) {
      type(t('food.ingredientQuantityPlaceholder'), value);
      expect([value, saveButton().props.disabled]).toEqual([value, true]);
      expect(texts()).toContain(t('food.ingredientQuantityHint'));
    }
    type(t('food.ingredientQuantityPlaceholder'), '2');
    expect(saveButton().props.disabled).toBe(false);
    expect(texts()).not.toContain(t('food.ingredientQuantityHint'));
    expect(userRecipes()).toEqual([]);
  });

  it('offers exactly the supported units, labelled for screen readers', () => {
    const units = ['g', 'ml', 'stk'].map((label) => controls(label)[0]);
    expect(units.map((unit) => unit.props.accessibilityLabel)).toEqual(['Gram', 'Milliliter', 'Stykker']);
    expect(input(t('food.ingredientQuantityPlaceholder')).props.keyboardType).toBe('decimal-pad');
  });
});
