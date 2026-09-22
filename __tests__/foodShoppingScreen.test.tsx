import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import ShoppingListScreen from '@/app/food/shopping-list';
import { deriveShoppingList } from '@/features/food/shoppingListDerivation';
import i18n from '@/localization/i18n';
import { useFoodStore } from '@/store/useFoodStore';
import type { Recipe } from '@/types/food';

jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } } }));

const recipe: Recipe = { id: 'recipe', name: 'Potato dinner', mealType: 'dinner', ingredients: [
  { kind: 'family', familyId: 'potato', name: 'Potatoes', quantity: 500, unit: 'g' },
] };
const requirement = deriveShoppingList([{ day: 0, mealType: 'dinner', recipe }])[0];
let tree: TestRenderer.ReactTestRenderer;
const get = (label: string) => tree.root.findByProps({ accessibilityLabel: label });
const press = async (label: string) => act(async () => { get(label).props.onPress(); });
const rendered = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' ');

beforeEach(async () => {
  await useFoodStore.persist.rehydrate();
  useFoodStore.setState({ shoppingItems: [], recipes: [recipe] });
  await i18n.changeLanguage('da');
  await act(async () => { tree = TestRenderer.create(<ShoppingListScreen />); });
});
afterEach(() => { act(() => tree.unmount()); });

describe('APP-052 shopping list UI', () => {
  it.each(['da', 'en'])('shows current amount and source, with accessible edit/check/delete in %s', async (language) => {
    await act(async () => { await i18n.changeLanguage(language); });
    await act(async () => { useFoodStore.getState().materializeShoppingList('2026-W39', [requirement]); });
    const item = useFoodStore.getState().shoppingItems[0];
    expect(rendered()).toContain('500');
    expect(get(i18n.t('food.shoppingDerivation.editItem', { name: 'Potatoes' }))).toBeTruthy();
    expect(get(i18n.t('food.a11y.removeShoppingItem', { item: 'Potatoes' }))).toBeTruthy();
    expect(get('Potatoes').props.accessibilityRole).toBe('checkbox');
    await press(i18n.t('food.shoppingDerivation.showSources', { name: 'Potatoes' }));
    expect(rendered()).toContain('Potato dinner');
    await press(i18n.t('food.shoppingDerivation.editItem', { name: 'Potatoes' }));
    await act(async () => { get(i18n.t('food.shoppingDerivation.label')).props.onChangeText('Extra potatoes'); });
    await act(async () => { get(i18n.t('food.shoppingDerivation.amount')).props.onChangeText('600'); });
    await press(i18n.t('food.save'));
    expect(useFoodStore.getState().shoppingItems[0]).toMatchObject({ label: 'Extra potatoes', amount: { quantity: 600 }, provenance: [{ quantity: 500 }] });
    expect(rendered()).toContain('600');
    expect(rendered()).toContain('500');
    await press('Extra potatoes');
    expect(useFoodStore.getState().shoppingItems[0].checked).toBe(true);
    await press(i18n.t('food.a11y.removeShoppingItem', { item: 'Extra potatoes' }));
    expect(useFoodStore.getState().shoppingItems).toEqual([]);
    expect(item.id).toBeTruthy();
  });

  it('shows a neutral missing-source message and keeps manual add available', async () => {
    await act(async () => { useFoodStore.getState().materializeShoppingList('2026-W39', [requirement]); useFoodStore.setState({ recipes: [] }); });
    await press(i18n.t('food.shoppingDerivation.showSources', { name: 'Potatoes' }));
    expect(rendered()).toContain(i18n.t('food.shoppingDerivation.missingRecipe'));
    await act(async () => { get(i18n.t('food.newShoppingItemPlaceholder')).props.onChangeText('Potatoes'); });
    await act(async () => { get(i18n.t('food.newShoppingItemPlaceholder')).props.onSubmitEditing(); });
    expect(useFoodStore.getState().shoppingItems).toMatchObject([
      { kind: 'meal_plan', label: 'Potatoes' }, { kind: 'manual', label: 'Potatoes' },
    ]);
  });

  it.each(['da', 'en'])('keeps edited legacy artifact text separate from the original source in %s', async (language) => {
    const legacyRecipe: Recipe = { id: 'legacy-recipe', name: 'Legacy dinner', mealType: 'dinner', ingredients: [
      { kind: 'legacy', name: 'Sauce', amount: 'ca. halvdelen' },
    ] };
    const legacyRequirement = deriveShoppingList([{ day: 0, mealType: 'dinner', recipe: legacyRecipe }])[0];
    await act(async () => {
      await i18n.changeLanguage(language);
      useFoodStore.setState({ recipes: [legacyRecipe] });
      useFoodStore.getState().materializeShoppingList('2026-W39', [legacyRequirement]);
    });
    expect(rendered()).toContain(i18n.t('food.shoppingDerivation.legacyAmount', { text: 'ca. halvdelen', count: 1 }));
    await press(i18n.t('food.shoppingDerivation.showSources', { name: 'Sauce' }));
    expect(rendered()).toContain('Legacy dinner');
    expect(rendered()).toContain('ca. halvdelen');
    const generated = useFoodStore.getState().shoppingItems[0];
    if (generated.kind !== 'meal_plan') throw new Error('Expected generated shopping item');
    const originalProvenance = structuredClone(generated.provenance);

    await press(i18n.t('food.shoppingDerivation.editItem', { name: 'Sauce' }));
    await act(async () => { get(i18n.t('food.shoppingDerivation.amount')).props.onChangeText('2 pakker'); });
    await press(i18n.t('food.save'));

    expect(rendered()).toContain(i18n.t('food.shoppingDerivation.legacyAmount', { text: '2 pakker', count: 1 }));
    const sourceLine = tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''))
      .find((line) => line.includes('Legacy dinner'));
    expect(sourceLine).toContain('ca. halvdelen');
    expect(sourceLine).not.toContain('2 pakker');
    expect(useFoodStore.getState().shoppingItems[0]).toMatchObject({
      identity: { kind: 'legacy' }, amount: { kind: 'legacy', text: '2 pakker', repetitions: 1 },
      provenance: originalProvenance,
    });
    expect(rendered()).not.toMatch(/Original text|Oprindelig tekst/);
  });
});
