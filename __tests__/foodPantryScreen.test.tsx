import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, Text, TextInput } from 'react-native';
import PantryScreen from '@/app/food/pantry';
import i18n from '@/localization/i18n';
import { useFoodStore } from '@/store/useFoodStore';

jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
}));

let tree: TestRenderer.ReactTestRenderer;
const get = (label: string) => tree.root.findByProps({ accessibilityLabel: label });
const press = async (label: string) => act(async () => { get(label).props.onPress(); });
const input = async (label: string, value: string) => act(async () => { get(label).props.onChangeText(value); });
const text = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' ');

beforeEach(async () => {
  await useFoodStore.persist.rehydrate();
  useFoodStore.setState({ pantryItems: [] });
  await i18n.changeLanguage('da');
  await act(async () => { tree = TestRenderer.create(<PantryScreen />); });
});
afterEach(() => { act(() => { tree.unmount(); }); });

describe('APP-050 Pantry add and edit UI', () => {
  it.each(['da', 'en'])('adds only explicitly entered dates and a quantity/unit pair in %s', async (language) => {
    await act(async () => { await i18n.changeLanguage(language); });
    await input(i18n.t('food.pantryNamePlaceholder'), 'Synthetic milk');
    await input(i18n.t('food.pantryQuantityPlaceholder'), '1,5');
    expect(tree.root.findAllByProps({ label: i18n.t('food.add') }).at(-1)?.props.disabled).toBe(true);
    const units = tree.root.findAll((node) => node.props.accessibilityState?.selected === false && typeof node.props.onPress === 'function');
    await act(async () => { units.find((node) => node.findAllByType(Text).some((textNode) => textNode.props.children === 'ml'))!.props.onPress(); });
    await input(i18n.t('food.pantryDates.purchasedDate'), '2026-02-30');
    expect(tree.root.findAllByProps({ label: i18n.t('food.add') }).at(-1)?.props.disabled).toBe(true);
    await input(i18n.t('food.pantryDates.purchasedDate'), '2026-09-01');
    await act(async () => { tree.root.findAllByProps({ label: i18n.t('food.add') }).at(-1)!.props.onPress(); });
    expect(useFoodStore.getState().pantryItems[0]).toMatchObject({
      name: 'Synthetic milk', quantity: 1.5, unit: 'ml', purchasedDate: '2026-09-01',
    });
    expect(useFoodStore.getState().pantryItems[0]).not.toHaveProperty('expiryDate');
    expect(useFoodStore.getState().pantryItems[0]).not.toHaveProperty('openedDate');
  });

  it('shows legacy text, offers visible edit/delete, and clears optional fields', async () => {
    const legacy = { id: 'old', name: 'Æg', legacyQuantityText: 'ca. halvdelen',
      expiryDate: '2026-10-01', addedAt: '2026-09-01T08:00:00.000Z' };
    await act(async () => { useFoodStore.setState({ pantryItems: [legacy] }); });
    expect(text()).toContain('ca. halvdelen');
    await press(i18n.t('food.pantryEditItem', { name: 'Æg' }));
    expect(get(i18n.t('food.pantryDates.expiryDate')).props.value).toBe('2026-10-01');
    await press(i18n.t('food.pantryClearDate', { field: i18n.t('food.pantryDates.expiryDate') }));
    await input(i18n.t('food.pantryNamePlaceholder'), 'Eggs');
    await act(async () => { tree.root.findByProps({ label: i18n.t('food.save') }).props.onPress(); });
    expect(useFoodStore.getState().pantryItems[0]).toEqual({ ...legacy, name: 'Eggs', expiryDate: undefined });
    expect(get(i18n.t('food.pantryDeleteItem', { name: 'Eggs' }))).toBeTruthy();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await press(i18n.t('food.pantryDeleteItem', { name: 'Eggs' }));
    expect(alert).toHaveBeenCalled();
    await act(async () => { alert.mock.calls[0][2]?.find((button) => button.style === 'destructive')?.onPress?.(); });
    expect(useFoodStore.getState().pantryItems).toEqual([]);
    alert.mockRestore();
  });
});
