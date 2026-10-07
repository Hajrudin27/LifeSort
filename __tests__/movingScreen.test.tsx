import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

import { MOVING_TEMPLATE_ID } from '@/core/home/moving';
import type { MovingTemplateDefinition } from '@/features/home/movingTemplates';
import i18n from '@/localization/i18n';
import type { MovingItem } from '@/types/household';

let mockCatalog: readonly MovingTemplateDefinition[] | null = null;
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9' }) }));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }), getSession: () => Promise.resolve({ data: { session: null }, error: null }) } },
}));
jest.mock('@/features/home/movingTemplates', () => {
  const actual = jest.requireActual('@/features/home/movingTemplates');
  return {
    ...actual,
    latestSelectableMovingTemplate: (id?: string, catalog?: unknown) =>
      actual.latestSelectableMovingTemplate(id, catalog ?? mockCatalog ?? undefined),
    availableMovingUpgrade: (marker: unknown, items: unknown, catalog?: unknown) =>
      actual.availableMovingUpgrade(marker, items, catalog ?? mockCatalog ?? undefined),
  };
});

import MovingChecklistScreen from '@/app/household/moving';
import { useHouseholdStore } from '@/store/useHouseholdStore';

const marker = { id: MOVING_TEMPLATE_ID, version: 1 };
const ref = (itemId: string, templateVersion = 1) => ({ templateId: MOVING_TEMPLATE_ID, templateVersion, templateItemId: itemId });
let tree: TestRenderer.ReactTestRenderer;
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' | ');
const buttons = () => tree.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function');
const find = (label: string) => buttons().find((node) => [node.props.children].flat().join('') === label ||
  tree.root.findAllByType(Text).some((text) => text.props.children === label && node.findAllByType(Text).includes(text)));
const press = async (label: string) => { const node = find(label); expect(node).toBeDefined(); await act(async () => { node!.props.onPress(); }); };
const render = async () => { await act(async () => { tree = TestRenderer.create(<MovingChecklistScreen />); }); };
const headers = () => tree.root.findAll((node) => node.props.accessibilityRole === 'header' && node.type === Text)
  .map((node) => [node.props.children].flat().join(''));

beforeEach(async () => {
  mockCatalog = null;
  await i18n.changeLanguage('en');
  useHouseholdStore.getState().clearLocal();
});
afterEach(() => { act(() => tree.unmount()); jest.useRealTimers(); });

describe('APP-062 Moving screen', () => {
  it('starts empty, explains the source and offers an explicit start (no automatic seeding)', async () => {
    await render();
    expect(useHouseholdStore.getState().movingItems).toEqual([]);
    expect(texts()).toContain('Your checklist is empty');
    expect(texts()).toContain('Version 1');
    expect(texts()).toContain('Source: LifeSort editorial');
    expect(texts()).toContain('Reviewed 2026-10-07 by LifeSort editorial');
    expect(texts()).toContain('These are suggestions, not legal or safety requirements');
    expect(find('Add suggested items')).toBeDefined();
    expect(find('Start a new checklist from suggestions')).toBeUndefined();
  });

  it('copies the suggestions into structured sections on an explicit press', async () => {
    await render();
    await press('Add suggested items');
    expect(headers()).toEqual(expect.arrayContaining(['Administration', 'Utilities']));
    expect(headers()).not.toContain('Your items');
    expect(texts()).toContain('Change address');
    expect(texts()).toContain('Order internet');
    expect(find('Add suggested items')).toBeUndefined();
  });

  it('groups the user\'s own rows under "Your items"', async () => {
    await render();
    await press('Add suggested items');
    act(() => { useHouseholdStore.getState().addMovingItem('Order boxes'); });
    expect(headers()).toEqual(['Moving checklist suggestions', 'Administration', 'Utilities', 'Your items']);
    expect(texts()).toContain('Order boxes');
  });

  it('still offers "Add suggested items" after the user typed their own item first (nothing applied yet)', async () => {
    useHouseholdStore.setState({ movingItems: [{ id: 'mine', label: 'Order boxes', checked: false }], movingTemplate: null });
    await render();
    expect(find('Add suggested items')).toBeDefined();
    await press('Add suggested items');
    expect(useHouseholdStore.getState().movingItems).toHaveLength(6);
    expect(useHouseholdStore.getState().movingItems[0].id).toBe('mine');
    expect(find('Add suggested items')).toBeUndefined();
  });

  it('does not offer a start while a checklist from a template is running', async () => {
    useHouseholdStore.setState({ movingItems: [{ id: 'mine', label: 'Order boxes', checked: false }], movingTemplate: marker });
    await render();
    expect(find('Add suggested items')).toBeUndefined();
    expect(find('Start a new checklist from suggestions')).toBeUndefined();
  });

  it('offers a start-again action only for an emptied checklist that once had a template', async () => {
    useHouseholdStore.setState({ movingItems: [], movingTemplate: marker });
    await render();
    expect(find('Start a new checklist from suggestions')).toBeDefined();
    expect(find('Add suggested items')).toBeUndefined();
    await press('Start a new checklist from suggestions');
    expect(useHouseholdStore.getState().movingItems).toHaveLength(5);
    expect(find('Start a new checklist from suggestions')).toBeUndefined();
  });

  it('shows the review as current inside the review period and due for review after it', async () => {
    jest.useFakeTimers({
      now: new Date('2027-10-07T12:00:00'),
      doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'],
    });
    await render();
    expect(texts()).toContain('Review status: up to date until 2027-10-07');
    act(() => tree.unmount());
    jest.setSystemTime(new Date('2027-10-08T12:00:00'));
    await render();
    expect(texts()).toContain('Review status: due for review since 2027-10-07');
    expect(texts()).not.toContain('up to date');
  });

  it('keeps accessibility roles, labels, state and 44pt targets', async () => {
    useHouseholdStore.setState({
      movingItems: [{ id: 'r1', label: 'Change address', checked: true, templateRef: ref('addressChange') }],
      movingTemplate: marker,
    });
    await render();
    const checkbox = tree.root.find((node) => node.props.accessibilityRole === 'checkbox');
    expect(checkbox.props.accessibilityState).toEqual({ checked: true });
    expect(StyleSheet.flatten(checkbox.props.style).minHeight).toBeGreaterThanOrEqual(44);
    const remove = tree.root.find((node) => node.props.accessibilityLabel === 'Remove Change address from the moving list');
    expect(remove.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(remove.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
    expect(headers()).toEqual(expect.arrayContaining(['Moving checklist suggestions', 'Administration']));
    await act(async () => { checkbox.props.onPress(); });
    expect(useHouseholdStore.getState().movingItems[0].checked).toBe(false);
    await act(async () => { remove.props.onPress(); });
    expect(useHouseholdStore.getState().movingItems).toEqual([]);
  });

  it('a deleted suggestion stays deleted when the screen is rendered again', async () => {
    await render();
    await press('Add suggested items');
    const target = useHouseholdStore.getState().movingItems[0];
    act(() => useHouseholdStore.getState().removeMovingItem(target.id));
    act(() => tree.unmount());
    await render();
    expect(useHouseholdStore.getState().movingItems).toHaveLength(4);
    expect(texts()).not.toContain('Change address');
  });

  it('renders the Danish strings', async () => {
    await act(async () => { await i18n.changeLanguage('da'); });
    await render();
    expect(texts()).toContain('Forslag til flytte-tjekliste');
    expect(texts()).toContain('Kilde: LifeSort-redaktionen');
    expect(texts()).toContain('Det her er forslag, ikke lovkrav eller sikkerhedskrav');
    await press('Tilføj foreslåede punkter');
    expect(headers()).toEqual(expect.arrayContaining(['Administration', 'Forsyning og abonnementer']));
    expect(texts()).toContain('Adresseændring');
  });
});

describe('APP-062 new suggestions on the screen (synthetic v2)', () => {
  const real = jest.requireActual('@/features/home/movingTemplates').MOVING_TEMPLATE_CATALOG[0] as MovingTemplateDefinition;
  const v2: MovingTemplateDefinition = {
    ...real, version: 2,
    items: [...real.items, { id: 'newItem', labelKey: 'internet', section: 'utilities' as const }],
  };
  const rows: MovingItem[] = [{ id: 'r1', label: 'Change address', checked: true, templateRef: ref('addressChange') }];

  it('shows a count, changes nothing until accepted, then adds only the new item', async () => {
    mockCatalog = [real, v2];
    useHouseholdStore.setState({ movingItems: rows, movingTemplate: marker });
    await render();
    expect(texts()).toContain('Version 1');
    expect(find('Add 1 new suggestion')).toBeDefined();
    expect(useHouseholdStore.getState().movingItems).toEqual(rows);
    await press('Add 1 new suggestion');
    expect(useHouseholdStore.getState().movingItems).toHaveLength(2);
    expect(useHouseholdStore.getState().movingItems[0]).toEqual(rows[0]);
    expect(useHouseholdStore.getState().movingTemplate).toEqual({ id: MOVING_TEMPLATE_ID, version: 2 });
    expect(find('Add 1 new suggestion')).toBeUndefined();
  });

  it('shows nothing extra when there is no newer version', async () => {
    useHouseholdStore.setState({ movingItems: rows, movingTemplate: marker });
    await render();
    expect(texts()).not.toContain('new suggestion');
  });
});
