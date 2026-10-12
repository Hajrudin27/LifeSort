import React from 'react';
import { Alert, PixelRatio, Switch, Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

/**
 * APP-069 — the Gift planner screens as the user meets them: list, create, edit, purchase switch,
 * removable date, delete confirmation, EN/DA, accessibility and theme smoke.
 */
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) }, from: jest.fn(), rpc: jest.fn() } }));
// The picker is a native wheel; expose its value and onChange so the form can be driven.
jest.mock('@/components/DatePickerField', () => {
  const { View } = require('react-native');
  return function MockDatePickerField(props: Record<string, unknown>) {
    return <View testID="date-field" {...(props as object)} />;
  };
});
jest.mock('@/components/SwipeableRow', () => {
  const { Pressable, View } = require('react-native');
  return function MockSwipeableRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
    return <View>{children}<Pressable accessibilityRole="button" accessibilityLabel="row-delete" onPress={onDelete} /></View>;
  };
});

import { router as mockRouter } from 'expo-router';

import GiftDetailScreen from '@/app/gifts/[id]';
import GiftsScreen from '@/app/gifts/index';
import NewGiftScreen from '@/app/gifts/new';
import { formatDkk } from '@/core/money/format';
import { minorUnits } from '@/core/money/minorUnits';
import i18n from '@/localization/i18n';
import { useGiftsStore } from '@/store/useGiftsStore';
import { useThemeStore } from '@/store/useThemeStore';
import type { Gift } from '@/types/gift';
import { todayIso } from '@/utils/shared/localDate';

const gift = (id: string, patch: Partial<Gift> = {}): Gift => ({
  id, personLabel: `Person ${id}`, idea: `Idea ${id}`, createdAt: '2026-09-01T08:00:00.000Z', ...patch,
});
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
let tree: TestRenderer.ReactTestRenderer;
const render = async (element: React.ReactElement) => {
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(element); });
  await settle();
};
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const input = (label: string) => tree.root.findAllByType(TextInput).find((node) => node.props.accessibilityLabel === label)!;
const hasInput = (label: string) => tree.root.findAllByType(TextInput).some((node) => node.props.accessibilityLabel === label);
const type = async (label: string, value: string) => { await act(async () => { input(label).props.onChangeText(value); }); };
const pressByLabel = async (label: string) => {
  const node = tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  await act(async () => { await node.props.onPress(); });
  await settle();
};
const pressButton = async (label: string) => {
  const node = tree.root.findAllByProps({ label })[0];
  const pressable = node.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function')[0];
  await act(async () => { await pressable.props.onPress(); });
  await settle();
};
const dateField = (label: string) =>
  tree.root.findAll((n) => n.props.testID === 'date-field' && n.props.accessibilityLabel === label && typeof n.props.onChange === 'function')[0];
const hasDateField = (label: string) =>
  tree.root.findAll((n) => n.props.testID === 'date-field' && n.props.accessibilityLabel === label).length > 0;
const purchasedSwitch = () => tree.root.findAllByType(Switch)[0];
const toggle = async (value: boolean) => { await act(async () => { purchasedSwitch().props.onValueChange(value); }); };
const alertSpy = jest.spyOn(Alert, 'alert');
/** Store updates are made inside act, so a mounted screen re-renders as it would for the user. */
const seed = async (state: Partial<ReturnType<typeof useGiftsStore.getState>>) => {
  await act(async () => { useGiftsStore.setState(state); });
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  await i18n.changeLanguage('en');
  useThemeStore.setState({ mode: 'light' });
  await seed({ gifts: [] });
});
afterEach(async () => {
  // Unmount between tests, so the next test's setup does not update a screen nobody is looking at.
  await act(async () => { tree?.unmount(); });
  tree = undefined as never;
});

describe('list', () => {
  it('shows a neutral empty state and the add button, and no filter or search field', async () => {
    await render(<GiftsScreen />);
    expect(texts()).toContain('No gift ideas yet.');
    expect(texts().join(' ')).not.toMatch(/!|forgot|don't|should/i);
    expect(tree.root.findAllByProps({ label: t('gifts.addButton') }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByType(TextInput)).toEqual([]);
  });

  it('shows two sections, Planned and Purchased, and omits a section that is empty', async () => {
    await seed({ gifts: [gift('a')] });
    await render(<GiftsScreen />);
    expect(texts()).toContain('Planned');
    expect(texts()).not.toContain('Purchased');
    await seed({ gifts: [gift('a'), gift('b', { purchasedOn: '2026-10-01' })] });
    await render(<GiftsScreen />);
    expect(texts()).toContain('Planned');
    expect(texts()).toContain('Purchased');
    const headers = tree.root.findAllByType(Text).filter((n) => n.props.accessibilityRole === 'header');
    expect(headers.map((h) => h.props.children)).toEqual(['Planned', 'Purchased']);
  });

  it('lists Planned in the one deterministic order, and keeps purchased gifts visible below it', async () => {
    await seed({ gifts: [
      gift('undated-new', { createdAt: '2026-09-05T08:00:00.000Z' }),
      gift('later', { occasionDate: '2026-12-24' }),
      gift('bought-old', { purchasedOn: '2026-08-01' }),
      gift('past', { occasionDate: '2000-01-01' }),
      gift('bought-new', { purchasedOn: '2026-10-01' }),
      gift('undated-old', { createdAt: '2026-09-01T08:00:00.000Z' }),
      gift('sooner', { occasionDate: '2026-11-01' }),
    ] });
    await render(<GiftsScreen />);
    const ideas = texts().filter((text) => /^Idea /.test(text));
    expect(ideas).toEqual(['Idea past', 'Idea sooner', 'Idea later', 'Idea undated-new', 'Idea undated-old', 'Idea bought-new', 'Idea bought-old']);
  });

  it('shows the person, occasion, occasion date, budget, purchase date and paid amount, with the purchase in words', async () => {
    await seed({ gifts: [gift('a', {
      occasionLabel: 'Birthday', occasionDate: '2026-12-24', budget: minorUnits(30_000), purchasedOn: '2026-10-01', paid: minorUnits(27_950),
    })] });
    await render(<GiftsScreen />);
    const all = texts().join('\n');
    expect(all).toContain('for Person a');
    expect(all).toContain('Birthday');
    expect(all).toContain('December 24, 2026');
    expect(all).toContain(`Budget ${formatDkk(minorUnits(30_000), 'en-US')}`);
    expect(all).toContain('Purchased October 1, 2026');
    expect(all).toContain(`Paid ${formatDkk(minorUnits(27_950), 'en-US')}`);
  });

  it('formats a date from its own digits, whatever the year', async () => {
    await seed({ gifts: [gift('a', { occasionDate: '0050-03-04' }), gift('b', { occasionDate: '2999-12-31' })] });
    await render(<GiftsScreen />);
    expect(texts().join('\n')).toContain('March 4, 50');
    expect(texts().join('\n')).toContain('December 31, 2999');
  });

  it('describes each row to a screen reader, in words, with the purchase and the amounts', async () => {
    await seed({ gifts: [gift('a', { occasionLabel: 'Birthday', budget: minorUnits(30_000), purchasedOn: '2026-10-01', paid: minorUnits(0) })] });
    await render(<GiftsScreen />);
    const row = tree.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Idea a'))[0];
    expect(row.props.accessibilityLabel).toBe(`Idea a, for Person a, Birthday, Budget ${formatDkk(minorUnits(30_000), 'en-US')}, Purchased October 1, 2026, Paid ${formatDkk(minorUnits(0), 'en-US')}`);
    expect(row.props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete' }]);
  });

  it('opens a gift on press and the create screen from the button', async () => {
    await seed({ gifts: [gift('a')] });
    await render(<GiftsScreen />);
    const row = tree.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Idea a'))[0];
    await act(async () => { row.props.onPress(); });
    expect(mockRouter.push).toHaveBeenCalledWith('/gifts/a');
    await pressButton(t('gifts.addButton'));
    expect(mockRouter.push).toHaveBeenCalledWith('/gifts/new');
  });

  it('asks before deleting from the list, and deletes only after confirmation; a purchased gift\'s history goes with it', async () => {
    await seed({ gifts: [gift('a', { purchasedOn: '2026-10-01', paid: minorUnits(100) })] });
    await render(<GiftsScreen />);
    await pressByLabel('row-delete');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Delete gift idea?');
    expect(message).toBe(t('gifts.deleteConfirmMessage'));
    expect(message).toMatch(/this device only/i);
    expect(message).toMatch(/purchase details/i);
    expect(useGiftsStore.getState().gifts).toHaveLength(1);
    await act(async () => { buttons!.find((b) => b.style === 'cancel')!.onPress?.(); });
    expect(useGiftsStore.getState().gifts).toHaveLength(1);
    await act(async () => { buttons!.find((b) => b.style === 'destructive')!.onPress?.(); });
    expect(useGiftsStore.getState().gifts).toEqual([]);
  });

  it('offers delete to a screen reader as a custom action that asks first', async () => {
    await seed({ gifts: [gift('a')] });
    await render(<GiftsScreen />);
    const row = tree.root.findAll((n) => typeof n.props.onAccessibilityAction === 'function')[0];
    await act(async () => { row.props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } }); });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(useGiftsStore.getState().gifts).toHaveLength(1);
  });
});

describe('create', () => {
  const fill = async (patch: Record<string, string> = {}) => {
    const values = { person: 'Anna', idea: 'A book about birds', ...patch };
    await type(t('gifts.personLabel'), values.person);
    await type(t('gifts.ideaLabel'), values.idea);
  };

  it('labels every field, marks only the optional ones as optional, and shows no purchase fields yet', async () => {
    await render(<NewGiftScreen />);
    for (const label of ['personLabel', 'ideaLabel', 'occasionLabel', 'budgetLabel']) expect(hasInput(t(`gifts.${label}`))).toBe(true);
    expect(t('gifts.personLabel')).not.toMatch(/optional/i);
    expect(t('gifts.ideaLabel')).not.toMatch(/optional/i);
    for (const label of ['occasionLabel', 'occasionDateLabel', 'budgetLabel', 'paidLabel']) expect(t(`gifts.${label}`)).toMatch(/optional/i);
    expect(hasInput(t('gifts.paidLabel'))).toBe(false);
    expect(hasDateField(t('gifts.purchaseDateLabel'))).toBe(false);
  });

  it('creates a gift with only the required fields and goes back', async () => {
    await render(<NewGiftScreen />);
    await fill();
    await pressButton(t('gifts.create'));
    const [created] = useGiftsStore.getState().gifts;
    expect(created).toMatchObject({ personLabel: 'Anna', idea: 'A book about birds' });
    expect(Object.keys(created)).toEqual(['id', 'personLabel', 'idea', 'createdAt']);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('creates a gift with every planning field, reading the budget as exact minor units', async () => {
    await render(<NewGiftScreen />);
    await fill();
    await type(t('gifts.occasionLabel'), 'Birthday');
    await pressByLabel(t('gifts.addDateA11y'));
    await act(async () => { dateField(t('gifts.occasionDateLabel')).props.onChange('2026-12-24'); });
    await type(t('gifts.budgetLabel'), '249,50');
    await pressButton(t('gifts.create'));
    expect(useGiftsStore.getState().gifts[0]).toMatchObject({ occasionLabel: 'Birthday', occasionDate: '2026-12-24', budget: 24_950 });
  });

  it('shows an error under each invalid field, creates nothing, and clears an error once the field is edited', async () => {
    await render(<NewGiftScreen />);
    await fill({ person: '   ', idea: 'i'.repeat(201) });
    await type(t('gifts.budgetLabel'), '-5');
    await pressButton(t('gifts.create'));
    expect(useGiftsStore.getState().gifts).toEqual([]);
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(texts()).toEqual(expect.arrayContaining([t('gifts.errors.required'), t('gifts.errors.tooLong'), t('gifts.errors.negative'), t('gifts.saveFailed')]));
    expect(input(t('gifts.personLabel')).props.accessibilityHint).toBe(t('gifts.errors.required'));
    await type(t('gifts.personLabel'), 'Anna');
    expect(input(t('gifts.personLabel')).props.accessibilityHint).toBeUndefined();
    expect(texts()).not.toContain(t('gifts.errors.required'));
  });

  it('refuses a control character without echoing it back', async () => {
    await render(<NewGiftScreen />);
    await fill({ person: 'Sentinel\nPerson' });
    await pressButton(t('gifts.create'));
    expect(texts()).toContain(t('gifts.errors.invalidCharacters'));
    expect(texts().join('\n')).not.toContain('Sentinel');
  });

  it('announces money as DKK and uses a decimal keyboard for both amounts', async () => {
    await render(<NewGiftScreen />);
    expect(t('gifts.budgetLabel')).toMatch(/DKK/);
    expect(input(t('gifts.budgetLabel')).props.keyboardType).toBe('decimal-pad');
    await toggle(true);
    expect(t('gifts.paidLabel')).toMatch(/DKK/);
    expect(input(t('gifts.paidLabel')).props.keyboardType).toBe('decimal-pad');
  });

  it('keeps Budget and Paid apart: different labels, different helper text', async () => {
    await render(<NewGiftScreen />);
    await toggle(true);
    expect(texts()).toContain(t('gifts.budgetHelp'));
    expect(texts()).toContain(t('gifts.paidHelp'));
    expect(t('gifts.budgetHelp')).not.toBe(t('gifts.paidHelp'));
    expect(input(t('gifts.budgetLabel'))).not.toBe(input(t('gifts.paidLabel')));
  });

  it('shows a single-line field as single-line, so a pasted line break is not kept', async () => {
    await render(<NewGiftScreen />);
    for (const label of ['personLabel', 'ideaLabel', 'occasionLabel']) expect(input(t(`gifts.${label}`)).props.multiline).toBeFalsy();
  });
});

describe('the purchase switch', () => {
  it('is an accessible switch with its state exposed and written out, not carried by colour', async () => {
    await render(<NewGiftScreen />);
    expect(purchasedSwitch().props).toMatchObject({ accessibilityRole: 'switch', accessibilityLabel: 'Purchased', value: false });
    expect(purchasedSwitch().props.accessibilityState).toEqual({ checked: false });
    expect(texts()).toContain('Not purchased');
    await toggle(true);
    expect(purchasedSwitch().props.accessibilityState).toEqual({ checked: true });
    expect(texts()).toContain('Purchased');
    expect(texts()).not.toContain('Not purchased');
    expect(JSON.stringify(purchasedSwitch().props.style)).toContain('"minHeight":44');
  });

  it('prefills today as a visible convenience, and saves it only when the user saves', async () => {
    await render(<NewGiftScreen />);
    await type(t('gifts.personLabel'), 'Anna');
    await type(t('gifts.ideaLabel'), 'A book');
    await toggle(true);
    expect(dateField(t('gifts.purchaseDateLabel')).props.value).toBe(todayIso());
    expect(useGiftsStore.getState().gifts).toEqual([]);
    await type(t('gifts.paidLabel'), '149,95');
    await pressButton(t('gifts.create'));
    expect(useGiftsStore.getState().gifts[0]).toMatchObject({ purchasedOn: todayIso(), paid: 14_995 });
  });

  it('lets the user change the purchase date, and refuses a future one', async () => {
    await render(<NewGiftScreen />);
    await type(t('gifts.personLabel'), 'Anna');
    await type(t('gifts.ideaLabel'), 'A book');
    await toggle(true);
    await act(async () => { dateField(t('gifts.purchaseDateLabel')).props.onChange('2999-01-01'); });
    await pressButton(t('gifts.create'));
    expect(useGiftsStore.getState().gifts).toEqual([]);
    expect(texts()).toContain(t('gifts.errors.future'));
    await act(async () => { dateField(t('gifts.purchaseDateLabel')).props.onChange('2026-09-30'); });
    expect(texts()).not.toContain(t('gifts.errors.future'));
    await pressButton(t('gifts.create'));
    expect(useGiftsStore.getState().gifts[0].purchasedOn).toBe('2026-09-30');
  });

  it('says a purchase is not an expense, before and after switching it on', async () => {
    await render(<NewGiftScreen />);
    expect(texts()).toContain('Not added to your expenses.');
    await toggle(true);
    expect(texts()).toContain('Not added to your expenses.');
  });

  it('sends no purchase when it is switched back off, even after a date and an amount were typed', async () => {
    await render(<NewGiftScreen />);
    await type(t('gifts.personLabel'), 'Anna');
    await type(t('gifts.ideaLabel'), 'A book');
    await toggle(true);
    await type(t('gifts.paidLabel'), '100');
    await toggle(false);
    expect(hasInput(t('gifts.paidLabel'))).toBe(false);
    await pressButton(t('gifts.create'));
    const [created] = useGiftsStore.getState().gifts;
    expect(created).not.toHaveProperty('purchasedOn');
    expect(created).not.toHaveProperty('paid');
  });

  it('zero is a real paid amount', async () => {
    await render(<NewGiftScreen />);
    await type(t('gifts.personLabel'), 'Anna');
    await type(t('gifts.ideaLabel'), 'A gift from a friend');
    await toggle(true);
    await type(t('gifts.paidLabel'), '0');
    await pressButton(t('gifts.create'));
    expect(useGiftsStore.getState().gifts[0]).toMatchObject({ paid: 0 });
    expect(useGiftsStore.getState().gifts[0]).toHaveProperty('paid');
  });
});

describe('the occasion date can be removed', () => {
  it('starts without a date and offers an accessible "Add date" action of at least 44 pt', async () => {
    await render(<NewGiftScreen />);
    expect(hasDateField(t('gifts.occasionDateLabel'))).toBe(false);
    const add = tree.root.findAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t('gifts.addDateA11y') && typeof n.props.onPress === 'function')[0];
    expect(add.props.accessibilityRole).toBe('button');
    expect(JSON.stringify(add.props.style)).toContain('"minHeight":44');
  });

  it('shows the date once added, with an accessible "Remove date" action; removing it brings "Add date" back', async () => {
    await render(<NewGiftScreen />);
    await pressByLabel(t('gifts.addDateA11y'));
    expect(dateField(t('gifts.occasionDateLabel')).props.value).toBe(todayIso());
    const remove = tree.root.findAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Remove date' && typeof n.props.onPress === 'function')[0];
    expect(remove.props.accessibilityRole).toBe('button');
    expect(JSON.stringify(remove.props.style)).toContain('"minHeight":44');
    await pressByLabel('Remove date');
    expect(hasDateField(t('gifts.occasionDateLabel'))).toBe(false);
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === t('gifts.addDateA11y')).length).toBeGreaterThan(0);
  });

  it('a removed date is not saved, and a kept date is', async () => {
    await render(<NewGiftScreen />);
    await type(t('gifts.personLabel'), 'Anna');
    await type(t('gifts.ideaLabel'), 'A book');
    await pressByLabel(t('gifts.addDateA11y'));
    await pressByLabel('Remove date');
    await pressButton(t('gifts.create'));
    expect(useGiftsStore.getState().gifts[0]).not.toHaveProperty('occasionDate');
  });

  it('gives the date picker a year window wide enough for any stored date', async () => {
    await seed({ gifts: [gift('a', { occasionDate: '1850-06-01', purchasedOn: '2150-01-01' })] });
    mockParams = { id: 'a' };
    await render(<GiftDetailScreen />);
    const occasion = dateField(t('gifts.occasionDateLabel')).props;
    expect(Number(todayIso().slice(0, 4)) - occasion.yearsBack).toBeLessThanOrEqual(1850);
    const purchase = dateField(t('gifts.purchaseDateLabel')).props;
    expect(Number(todayIso().slice(0, 4)) + purchase.yearsForward).toBeGreaterThanOrEqual(2150);
  });
});

describe('edit', () => {
  const open = async (patch: Partial<Gift> = {}) => {
    await seed({ gifts: [gift('a', patch)] });
    mockParams = { id: 'a' };
    await render(<GiftDetailScreen />);
  };

  it('opens with every stored field filled in, including the purchase', async () => {
    await open({ occasionLabel: 'Birthday', occasionDate: '2026-12-24', budget: minorUnits(24_950), purchasedOn: '2026-10-01', paid: minorUnits(27_900) });
    expect(input(t('gifts.personLabel')).props.value).toBe('Person a');
    expect(input(t('gifts.ideaLabel')).props.value).toBe('Idea a');
    expect(input(t('gifts.occasionLabel')).props.value).toBe('Birthday');
    expect(dateField(t('gifts.occasionDateLabel')).props.value).toBe('2026-12-24');
    expect(input(t('gifts.budgetLabel')).props.value).toBe('249.50');
    expect(purchasedSwitch().props.value).toBe(true);
    expect(dateField(t('gifts.purchaseDateLabel')).props.value).toBe('2026-10-01');
    expect(input(t('gifts.paidLabel')).props.value).toBe('279');
  });

  it('writes the money back the way the language writes it: a decimal comma in Danish', async () => {
    await i18n.changeLanguage('da');
    await open({ budget: minorUnits(24_950) });
    expect(input(t('gifts.budgetLabel')).props.value).toBe('249,50');
  });

  it('saves a correction, keeping id and creation time, and goes back', async () => {
    await open({ budget: minorUnits(1_000) });
    await type(t('gifts.ideaLabel'), 'A better idea');
    await type(t('gifts.budgetLabel'), '');
    await pressButton(t('gifts.save'));
    expect(useGiftsStore.getState().gifts[0]).toMatchObject({ id: 'a', createdAt: '2026-09-01T08:00:00.000Z', idea: 'A better idea' });
    expect(useGiftsStore.getState().gifts[0]).not.toHaveProperty('budget');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('marks a gift purchased by switching it on and saving; the date shown is the date saved', async () => {
    await open();
    await toggle(true);
    await act(async () => { dateField(t('gifts.purchaseDateLabel')).props.onChange('2026-10-02'); });
    await type(t('gifts.paidLabel'), '59,90');
    await pressButton(t('gifts.save'));
    expect(useGiftsStore.getState().gifts[0]).toMatchObject({ purchasedOn: '2026-10-02', paid: 5_990 });
  });

  it('un-purchases by switching it off and saving: the date and the paid amount are removed', async () => {
    await open({ purchasedOn: '2026-10-01', paid: minorUnits(5_000), budget: minorUnits(6_000) });
    await toggle(false);
    await pressButton(t('gifts.save'));
    const saved = useGiftsStore.getState().gifts[0];
    expect(saved).not.toHaveProperty('purchasedOn');
    expect(saved).not.toHaveProperty('paid');
    expect(saved.budget).toBe(6_000);
  });

  it('shows validation errors when an edit is invalid and keeps the stored data', async () => {
    await open();
    await type(t('gifts.ideaLabel'), '');
    await pressButton(t('gifts.save'));
    expect(texts()).toContain(t('gifts.errors.required'));
    expect(useGiftsStore.getState().gifts[0].idea).toBe('Idea a');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('does not refuse an unchanged future purchase date when only the idea is edited', async () => {
    await open({ purchasedOn: '2999-01-01' });
    await type(t('gifts.ideaLabel'), 'Renamed');
    await pressButton(t('gifts.save'));
    expect(useGiftsStore.getState().gifts[0]).toMatchObject({ idea: 'Renamed', purchasedOn: '2999-01-01' });
  });

  it('asks before deleting, says it is on this device only, and goes back after confirmation', async () => {
    await open({ purchasedOn: '2026-10-01' });
    await pressButton(t('gifts.delete'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][1]).toBe(t('gifts.deleteConfirmMessage'));
    expect(useGiftsStore.getState().gifts).toHaveLength(1);
    await act(async () => { alertSpy.mock.calls[0][2]!.find((b) => b.style === 'cancel')!.onPress?.(); });
    expect(useGiftsStore.getState().gifts).toHaveLength(1);
    await act(async () => { alertSpy.mock.calls[0][2]!.find((b) => b.style === 'destructive')!.onPress?.(); });
    expect(useGiftsStore.getState().gifts).toEqual([]);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('says plainly when the gift no longer exists', async () => {
    mockParams = { id: 'gone' };
    await render(<GiftDetailScreen />);
    expect(texts()).toContain(t('gifts.notFound'));
  });
});

describe('language', () => {
  it('renders the list in Danish: sections, the neutral empty state, a decimal-comma amount and a Danish date', async () => {
    await i18n.changeLanguage('da');
    await render(<GiftsScreen />);
    expect(texts()).toContain('Ingen gaveidéer endnu.');
    await seed({ gifts: [gift('a', { occasionDate: '2026-12-24', budget: minorUnits(24_950) }), gift('b', { purchasedOn: '2026-10-01', paid: minorUnits(5_000) })] });
    await render(<GiftsScreen />);
    const all = texts().join('\n');
    expect(all).toContain('Planlagt');
    expect(all).toContain('Købt');
    expect(all).toContain('til Person a');
    expect(all).toContain('24. december 2026');
    expect(all).toContain(`Budget ${formatDkk(minorUnits(24_950), 'da-DK')}`);
    expect(all).toContain('Købt 1. oktober 2026');
    expect(formatDkk(minorUnits(24_950), 'da-DK')).toContain('249,50');
  });

  it('renders the create screen in Danish with Danish labels, errors, the note and the confirmation', async () => {
    await i18n.changeLanguage('da');
    await render(<NewGiftScreen />);
    expect(hasInput('Person')).toBe(true);
    expect(hasInput('Gaveidé')).toBe(true);
    expect(texts()).toContain('Ikke tilføjet til dine udgifter.');
    await pressButton(t('gifts.create'));
    expect(texts()).toContain('Feltet skal udfyldes.');
    expect(t('gifts.deleteConfirmMessage')).toMatch(/kun på denne enhed/);
  });
});

describe('theme and text size', () => {
  it('renders every screen in the dark theme', async () => {
    useThemeStore.setState({ mode: 'dark' });
    await seed({ gifts: [gift('a', { budget: minorUnits(100), purchasedOn: '2026-10-01' })] });
    await render(<GiftsScreen />);
    expect(texts()).toContain('Idea a');
    mockParams = { id: 'a' };
    await render(<GiftDetailScreen />);
    await render(<NewGiftScreen />);
    expect(hasInput(t('gifts.personLabel'))).toBe(true);
  });

  it('lets text scale: no screen disables font scaling, no text is truncated, and everything renders at 2x', async () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    await seed({ gifts: [gift('a', { occasionLabel: 'x'.repeat(100), budget: minorUnits(100), purchasedOn: '2026-10-01', paid: minorUnits(100) })] });
    mockParams = { id: 'a' };
    for (const element of [<GiftsScreen key="l" />, <GiftDetailScreen key="d" />, <NewGiftScreen key="n" />]) {
      await render(element);
      expect(tree.root.findAll((n) => n.props.allowFontScaling === false)).toEqual([]);
      expect(tree.root.findAll((n) => n.props.numberOfLines !== undefined)).toEqual([]);
      expect(tree.root.findAllByType(Text).length).toBeGreaterThan(0);
    }
  });
});
