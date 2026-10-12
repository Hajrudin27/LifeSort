import React from 'react';
import { Platform, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

/**
 * APP-070 — the optional iOS "Choose from Contacts" action on the shared Gift form.
 *
 * The adapter is mocked: this file proves what the FORM does with its normalised result. What the
 * adapter reads from a contact is proved in giftContactPicker.test.ts.
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
jest.mock('@/components/DatePickerField', () => {
  const { View } = require('react-native');
  return function MockDatePickerField(props: Record<string, unknown>) {
    return <View testID="date-field" {...(props as object)} />;
  };
});
jest.mock('@/features/gifts/contacts/pickContactName', () => ({
  ...jest.requireActual('@/features/gifts/contacts/pickContactName'),
  pickContactName: jest.fn(),
}));

import GiftDetailScreen from '@/app/gifts/[id]';
import GiftsScreen from '@/app/gifts/index';
import NewGiftScreen from '@/app/gifts/new';
import { pickContactName } from '@/features/gifts/contacts/pickContactName';
import i18n from '@/localization/i18n';
import { useGiftsStore } from '@/store/useGiftsStore';
import type { Gift } from '@/types/gift';

const mockPick = pickContactName as jest.MockedFunction<typeof pickContactName>;
const t = (key: string) => i18n.t(key);
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
let tree: TestRenderer.ReactTestRenderer;
const render = async (element: React.ReactElement) => {
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(element); });
  await settle();
};
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const input = (label: string) => tree.root.findAllByType(TextInput).find((node) => node.props.accessibilityLabel === label)!;
const person = () => input(t('gifts.personLabel')).props.value as string;
const type = async (label: string, value: string) => { await act(async () => { input(label).props.onChangeText(value); }); };
const contactButtons = () => tree.root.findAll((n) => n.props.accessibilityLabel === t('gifts.chooseContact') && typeof n.props.onPress === 'function');
const chooseContact = async () => {
  await act(async () => { await contactButtons()[0].props.onPress(); });
  await settle();
};
const pressButton = async (label: string) => {
  const node = tree.root.findAllByProps({ label })[0];
  const pressable = node.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function')[0];
  await act(async () => { await pressable.props.onPress(); });
  await settle();
};
const setPlatform = (os: string) => jest.replaceProperty(Platform, 'OS', os as typeof Platform.OS);
const stored = (): Gift => ({ id: 'a', personLabel: 'Original', idea: 'A book', createdAt: '2026-09-01T08:00:00.000Z' });

beforeEach(async () => {
  jest.clearAllMocks();
  mockPick.mockReset();
  mockParams = {};
  setPlatform('ios');
  await i18n.changeLanguage('en');
  await act(async () => { useGiftsStore.setState({ gifts: [] }); });
});
afterEach(async () => {
  await act(async () => { tree?.unmount(); });
  tree = undefined as never;
  jest.restoreAllMocks();
});

describe('iOS: the action is offered and never runs by itself', () => {
  it('shows "Choose from Contacts" beside the Person field, as an accessible button of at least 44 pt, with the static helper text', async () => {
    await render(<NewGiftScreen />);
    const button = contactButtons().find((n) => n.props.accessibilityRole === 'button')!;
    expect(button).toBeDefined();
    expect(button.props.accessibilityHint).toBe(t('gifts.contactHelp'));
    expect(JSON.stringify(button.props.style)).toContain('"minHeight":44');
    expect(texts()).toContain('Opens Contacts so you can pick one person. Only the first and last name are used.');
    // The Person field stays a first-class, typed input.
    expect(input(t('gifts.personLabel'))).toBeDefined();
  });

  it('never calls the adapter on render: not the list, not the create screen, not the edit screen', async () => {
    await render(<GiftsScreen />);
    await render(<NewGiftScreen />);
    await act(async () => { useGiftsStore.setState({ gifts: [stored()] }); });
    mockParams = { id: 'a' };
    await render(<GiftDetailScreen />);
    await type(t('gifts.personLabel'), 'Typed');
    expect(mockPick).not.toHaveBeenCalled();
  });

  it('calls the adapter exactly once per tap, and not again while it is open', async () => {
    let finish: (value: Awaited<ReturnType<typeof pickContactName>>) => void = () => undefined;
    mockPick.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render(<NewGiftScreen />);
    await act(async () => { contactButtons()[0].props.onPress(); });
    await act(async () => { contactButtons()[0].props.onPress(); });
    expect(mockPick).toHaveBeenCalledTimes(1);
    expect(contactButtons()[0].props.disabled).toBe(true);
    await act(async () => { finish({ ok: false, reason: 'cancelled' }); });
    await settle();
    expect(contactButtons()[0].props.disabled).toBe(false);
  });
});

describe('iOS: the outcomes', () => {
  it('a picked name fills the Person field only, and nothing is saved or stored', async () => {
    mockPick.mockResolvedValue({ ok: true, name: 'Alice Smith' });
    await render(<NewGiftScreen />);
    await chooseContact();
    expect(person()).toBe('Alice Smith');
    expect(useGiftsStore.getState().gifts).toEqual([]);
  });

  it('the imported text is ordinary: editable, and the normal Save persists personLabel and nothing contact-related', async () => {
    mockPick.mockResolvedValue({ ok: true, name: 'Alice Smith' });
    await render(<NewGiftScreen />);
    await chooseContact();
    await type(t('gifts.personLabel'), 'Alice S.');
    expect(person()).toBe('Alice S.');
    await type(t('gifts.ideaLabel'), 'A book');
    await pressButton(t('gifts.create'));
    const [created] = useGiftsStore.getState().gifts;
    expect(created).toMatchObject({ personLabel: 'Alice S.', idea: 'A book' });
    expect(Object.keys(created)).toEqual(['id', 'personLabel', 'idea', 'createdAt']);
  });

  it('a picked name is saved as picked when the user leaves it alone', async () => {
    mockPick.mockResolvedValue({ ok: true, name: 'Søren Ørsted' });
    await render(<NewGiftScreen />);
    await chooseContact();
    await type(t('gifts.ideaLabel'), 'A book');
    await pressButton(t('gifts.create'));
    expect(useGiftsStore.getState().gifts[0].personLabel).toBe('Søren Ørsted');
  });

  it('an imported name that fails the normal rules gets the ordinary field error on Save, and is not truncated', async () => {
    const tooLong = 'A'.repeat(101);
    mockPick.mockResolvedValue({ ok: true, name: tooLong });
    await render(<NewGiftScreen />);
    await chooseContact();
    expect(person()).toBe(tooLong);
    await type(t('gifts.ideaLabel'), 'A book');
    await pressButton(t('gifts.create'));
    expect(useGiftsStore.getState().gifts).toEqual([]);
    expect(texts()).toContain(t('gifts.errors.tooLong'));
  });

  it('a picked name clears an earlier error on the Person field', async () => {
    await render(<NewGiftScreen />);
    await type(t('gifts.ideaLabel'), 'A book');
    await pressButton(t('gifts.create'));
    expect(texts()).toContain(t('gifts.errors.required'));
    mockPick.mockResolvedValue({ ok: true, name: 'Alice' });
    await chooseContact();
    expect(texts()).not.toContain(t('gifts.errors.required'));
  });

  it('cancel leaves the Person field as it was, says nothing, and persists nothing', async () => {
    mockPick.mockResolvedValue({ ok: false, reason: 'cancelled' });
    await render(<NewGiftScreen />);
    await type(t('gifts.personLabel'), 'Typed first');
    await chooseContact();
    expect(person()).toBe('Typed first');
    expect(texts().filter((text) => /contact/i.test(text))).toEqual([t('gifts.chooseContact'), t('gifts.contactHelp')]);
    expect(useGiftsStore.getState().gifts).toEqual([]);
  });

  it('no_name leaves the field unchanged and says so neutrally', async () => {
    mockPick.mockResolvedValue({ ok: false, reason: 'no_name' });
    await render(<NewGiftScreen />);
    await type(t('gifts.personLabel'), 'Typed first');
    await chooseContact();
    expect(person()).toBe('Typed first');
    expect(input(t('gifts.personLabel')).props.editable).not.toBe(false);
    expect(texts()).toContain('This contact has no usable name. You can enter one manually.');
  });

  it.each(['unavailable', 'error'] as const)('%s keeps the field unchanged and usable, with brief neutral copy and no prompt', async (reason) => {
    mockPick.mockResolvedValue({ ok: false, reason });
    await render(<NewGiftScreen />);
    await type(t('gifts.personLabel'), 'Typed first');
    await chooseContact();
    expect(person()).toBe('Typed first');
    expect(texts()).toContain(t(`gifts.contactNotice.${reason}`));
    expect(input(t('gifts.personLabel')).props.editable).not.toBe(false);
    expect(mockPick).toHaveBeenCalledTimes(1);
    await type(t('gifts.personLabel'), 'Still typing');
    expect(person()).toBe('Still typing');
  });

  it('a later successful pick removes an earlier notice', async () => {
    mockPick.mockResolvedValueOnce({ ok: false, reason: 'no_name' }).mockResolvedValueOnce({ ok: true, name: 'Alice' });
    await render(<NewGiftScreen />);
    await chooseContact();
    expect(texts()).toContain(t('gifts.contactNotice.no_name'));
    await chooseContact();
    expect(texts()).not.toContain(t('gifts.contactNotice.no_name'));
    expect(person()).toBe('Alice');
  });
});

describe('iOS: new and edit share the form', () => {
  const open = async () => {
    await act(async () => { useGiftsStore.setState({ gifts: [stored()] }); });
    mockParams = { id: 'a' };
    await render(<GiftDetailScreen />);
  };

  it('edit offers the action too, and selecting a name alone does not change the stored gift', async () => {
    mockPick.mockResolvedValue({ ok: true, name: 'Alice Smith' });
    await open();
    expect(person()).toBe('Original');
    await chooseContact();
    expect(person()).toBe('Alice Smith');
    expect(useGiftsStore.getState().gifts).toEqual([stored()]);
  });

  it('leaving without saving leaves the stored gift exactly as it was', async () => {
    mockPick.mockResolvedValue({ ok: true, name: 'Alice Smith' });
    await open();
    await chooseContact();
    await act(async () => { tree.unmount(); });
    expect(useGiftsStore.getState().gifts).toEqual([stored()]);
    tree = undefined as never;
  });

  it('only Save changes it, and then only personLabel (id and createdAt kept, no new key)', async () => {
    mockPick.mockResolvedValue({ ok: true, name: 'Alice Smith' });
    await open();
    await chooseContact();
    await pressButton(t('gifts.save'));
    const [saved] = useGiftsStore.getState().gifts;
    expect(saved).toEqual({ ...stored(), personLabel: 'Alice Smith' });
    expect(Object.keys(saved)).toEqual(['id', 'personLabel', 'idea', 'createdAt']);
  });

  it('a renamed or deleted device contact cannot alter a saved gift: the gift holds a plain string and no reference', async () => {
    mockPick.mockResolvedValue({ ok: true, name: 'Alice' });
    await render(<NewGiftScreen />);
    await chooseContact();
    await type(t('gifts.ideaLabel'), 'A book');
    await pressButton(t('gifts.create'));
    const before = JSON.stringify(useGiftsStore.getState().gifts);
    mockPick.mockResolvedValue({ ok: true, name: 'Alice Smith' }); // the contact is renamed on the device
    await render(<GiftsScreen />);
    expect(JSON.stringify(useGiftsStore.getState().gifts)).toBe(before);
    expect(mockPick).toHaveBeenCalledTimes(1);
  });
});

describe('iOS: Danish', () => {
  it('shows the Danish button, helper text and notices', async () => {
    await i18n.changeLanguage('da');
    mockPick.mockResolvedValue({ ok: false, reason: 'no_name' });
    await render(<NewGiftScreen />);
    expect(contactButtons().length).toBeGreaterThan(0);
    expect(texts()).toContain('Åbner Kontakter, så du kan vælge én person. Kun for- og efternavn bruges.');
    await act(async () => { await contactButtons()[0].props.onPress(); });
    await settle();
    expect(texts()).toContain(i18n.t('gifts.contactNotice.no_name'));
    expect(i18n.t('gifts.chooseContact')).toBe('Vælg fra Kontakter');
  });
});

describe.each(['android', 'web'])('%s: manual entry only', (os) => {
  it('shows no Contacts button or helper text, never calls the adapter, and the Person field works', async () => {
    setPlatform(os);
    await render(<NewGiftScreen />);
    expect(contactButtons().length).toBe(0);
    expect(texts()).not.toContain(t('gifts.contactHelp'));
    await type(t('gifts.personLabel'), 'Anna');
    await type(t('gifts.ideaLabel'), 'A book');
    await pressButton(t('gifts.create'));
    expect(useGiftsStore.getState().gifts[0]).toMatchObject({ personLabel: 'Anna' });
    expect(mockPick).not.toHaveBeenCalled();
  });

  it('the edit screen shows none either', async () => {
    setPlatform(os);
    await act(async () => { useGiftsStore.setState({ gifts: [stored()] }); });
    mockParams = { id: 'a' };
    await render(<GiftDetailScreen />);
    expect(contactButtons().length).toBe(0);
    expect(mockPick).not.toHaveBeenCalled();
  });
});

describe('the locale copy', () => {
  it('has the same contact keys in English and Danish, and none claims permission or a stronger privacy guarantee than is true', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const en = require('@/localization/locales/en/gifts.json');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const da = require('@/localization/locales/da/gifts.json');
    const pick = (file: Record<string, unknown>) => ({ chooseContact: file.chooseContact, contactHelp: file.contactHelp, contactNotice: file.contactNotice });
    expect(Object.keys(pick(en).contactNotice as object)).toEqual(Object.keys(pick(da).contactNotice as object));
    const all = JSON.stringify([pick(en), pick(da)]);
    expect(all).not.toMatch(/permission|tilladelse|settings|indstillinger|only receive|modtager kun|no other/i);
  });
});
