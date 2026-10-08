import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, TextInput } from 'react-native';

import i18n from '@/localization/i18n';
import type { LifeGoal } from '@/types/life';

let mockParams: { id?: string } = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => options?.headerRight?.() ?? null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9', accentSoft: '#CCDDF5' }) }));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) } },
}));
jest.mock('@/components/DatePickerField', () => {
  const { Text: MockText } = require('react-native');
  return { __esModule: true, default: ({ value }: { value: string }) => <MockText>{`picker:${value}`}</MockText> };
});

import LifeGoalsScreen from '@/app/life-goals/index';
import LifeGoalDetailScreen from '@/app/life-goals/[id]';
import NewLifeGoalScreen from '@/app/life-goals/new';
import RingProgress from '@/components/RingProgress';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { todayIso } from '@/utils/shared/localDate';

const mockRouter = jest.requireMock('expo-router').router as { push: jest.Mock; replace: jest.Mock; back: jest.Mock };
const common = { title: 'Goal', milestones: [], createdAt: '2026-10-01T10:00:00.000Z' };
let tree: TestRenderer.ReactTestRenderer;
const rendered = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' | ');
const nodeText = (node: TestRenderer.ReactTestInstance) => node.findAllByType(Text).map((text) => [text.props.children].flat().join('')).join('');
const buttons = () => tree.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function');
const button = (label: string) => buttons().find((node) => nodeText(node) === label);
const press = async (label: string) => {
  const node = button(label);
  expect(node).toBeDefined();
  await act(async () => { node!.props.onPress(); });
};
const input = (label: string) => tree.root.findAll((node) => node.type === TextInput && node.props.accessibilityLabel === label)[0];
const type = async (label: string, value: string) => {
  const field = input(label);
  expect(field).toBeDefined();
  await act(async () => { field.props.onChangeText(value); });
};
const render = async (element: React.ReactElement) => { await act(async () => { tree = TestRenderer.create(element); }); };
const rings = () => tree.root.findAllByType(RingProgress).map((node) => node.props.progress as number);
const goals = () => useLifeGoalsStore.getState().goals;

beforeEach(async () => {
  mockParams = {};
  mockRouter.push.mockClear(); mockRouter.replace.mockClear(); mockRouter.back.mockClear();
  await i18n.changeLanguage('en');
  useLifeGoalsStore.getState().clearLocal();
});
afterEach(() => { act(() => tree.unmount()); });

describe('APP-063 new goal screen', () => {
  it('offers exactly the four types with a plain-language hint, and nothing about money or schedules', async () => {
    await render(<NewLifeGoalScreen />);
    for (const label of ['Done / not done', 'Count', 'Amount', 'Duration']) expect(button(label)).toBeDefined();
    expect(rendered()).toContain('One outcome');
    expect(rendered()).not.toMatch(/currency|kroner|dkk|usd|weekly|daily|streak/i);
  });

  it('saves a binary goal and opens it; a blank title is blocked with an announced error', async () => {
    await render(<NewLifeGoalScreen />);
    await press('Save');
    expect(goals()).toEqual([]);
    expect(rendered()).toContain('Enter a title.');
    expect(tree.root.findAll((node) => node.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
    await type('Title (e.g. Learn to play guitar)', '  Get my licence ');
    await press('Save');
    expect(goals()).toMatchObject([{ type: 'binary', title: 'Get my licence', completed: false }]);
    expect(mockRouter.replace).toHaveBeenCalledWith(`/life-goals/${goals()[0].id}`);
  });

  it('count: validates the target in the field and then saves integers', async () => {
    await render(<NewLifeGoalScreen />);
    await press('Count');
    await type('Title (e.g. Learn to play guitar)', 'Read books');
    await press('Save');
    expect(goals()).toEqual([]);
    expect(rendered()).toContain('Enter a whole number of 1 or more.');
    await type('Target', '12');
    await type('Progress so far (optional)', '3');
    await press('Save');
    expect(goals()).toMatchObject([{ type: 'count', target: 12, current: 3 }]);
  });

  it('count: refuses a decimal target', async () => {
    await render(<NewLifeGoalScreen />);
    await press('Count');
    await type('Title (e.g. Learn to play guitar)', 'Read');
    await type('Target', '2.5');
    await press('Save');
    expect(goals()).toEqual([]);
  });

  it('amount: needs a unit, accepts a decimal comma, stores hundredths, explains it is not money', async () => {
    await render(<NewLifeGoalScreen />);
    await press('Amount');
    expect(rendered()).toContain('This is a measurement, not money');
    await type('Title (e.g. Learn to play guitar)', 'Run');
    await type('Target', '100,5');
    await press('Save');
    expect(goals()).toEqual([]);
    expect(rendered()).toContain('Enter a unit of 1–24 characters.');
    await type('Unit', ' km ');
    await type('Progress so far (optional)', '2.25');
    await press('Save');
    expect(goals()).toMatchObject([{ type: 'amount', target: 10_050, current: 225, unit: 'km' }]);
  });

  it('amount: a third decimal is refused', async () => {
    await render(<NewLifeGoalScreen />);
    await press('Amount');
    await type('Title (e.g. Learn to play guitar)', 'Run');
    await type('Unit', 'km');
    await type('Target', '1.234');
    await press('Save');
    expect(goals()).toEqual([]);
    expect(rendered()).toContain('at most two decimals');
  });

  it('duration: hours and minutes become integer minutes', async () => {
    await render(<NewLifeGoalScreen />);
    await press('Duration');
    await type('Title (e.g. Learn to play guitar)', 'Study Danish');
    await type('Target: Hours', '100');
    await press('Save');
    expect(goals()).toMatchObject([{ type: 'duration', target: 6000, current: 0 }]);
  });

  it('duration: minutes above 59 are refused', async () => {
    await render(<NewLifeGoalScreen />);
    await press('Duration');
    await type('Title (e.g. Learn to play guitar)', 'Study');
    await type('Target: Hours', '1');
    await type('Target: Minutes', '75');
    await press('Save');
    expect(goals()).toEqual([]);
    expect(rendered()).toContain('minutes 0–59');
  });

  it('accepting today in the picker saves today (the old bug dropped it), and the deadline can be removed', async () => {
    await render(<NewLifeGoalScreen />);
    await type('Title (e.g. Learn to play guitar)', 'Dated');
    expect(rendered()).not.toContain('picker:');
    await press('+ Deadline (optional)');
    expect(rendered()).toContain(`picker:${todayIso()}`);
    await press('Save');
    expect(goals()[0].deadline).toBe(todayIso());

    act(() => tree.unmount());
    useLifeGoalsStore.getState().clearLocal();
    await render(<NewLifeGoalScreen />);
    await type('Title (e.g. Learn to play guitar)', 'Undated');
    await press('+ Deadline (optional)');
    await press('Remove deadline');
    expect(rendered()).not.toContain('picker:');
    await press('Save');
    expect('deadline' in goals()[0]).toBe(false);
  });

  it('switching type clears stale errors and keeps the chosen type visible as selected', async () => {
    await render(<NewLifeGoalScreen />);
    await press('Count');
    await press('Save');
    expect(rendered()).toContain('Enter a title.');
    await press('Amount');
    expect(rendered()).not.toContain('Enter a title.');
    expect(button('Amount')!.props.accessibilityState).toEqual({ selected: true });
  });

  it('renders in Danish', async () => {
    await act(async () => { await i18n.changeLanguage('da'); });
    await render(<NewLifeGoalScreen />);
    for (const label of ['Gjort / ikke gjort', 'Antal', 'Mængde', 'Varighed']) expect(button(label)).toBeDefined();
    await press('Mængde');
    expect(rendered()).toContain('Det her er en måling, ikke penge');
    await press('Gem');
    expect(rendered()).toContain('Skriv en titel.');
  });
});

describe('APP-063 detail screen', () => {
  const open = async (goal: LifeGoal) => {
    useLifeGoalsStore.setState({ goals: [goal] });
    mockParams = { id: goal.id };
    await render(<LifeGoalDetailScreen />);
  };
  const edit = async () => press('Edit');

  it('shows the real numbers and the canonical ring for a count goal, clamping the ring above target', async () => {
    await open({ ...common, id: 'c', type: 'count', target: 12, current: 7 });
    expect(rendered()).toContain('7 / 12');
    expect(rings()[0]).toBeCloseTo(7 / 12, 12);
    act(() => tree.unmount());
    await open({ ...common, id: 'c', type: 'count', target: 12, current: 30 });
    expect(rendered()).toContain('30 / 12');
    expect(rendered()).toContain('Target reached');
    expect(rings()[0]).toBe(1);
  });

  it.each([
    ['amount', { type: 'amount', target: 10_000, current: 2550, unit: 'km' } as const, '25.5 / 100 km', 0.255],
    ['duration', { type: 'duration', target: 6000, current: 90 } as const, '1 h 30 min / 100 h', 0.015],
  ])('shows %s in its own units', async (_label, fields, text, ratio) => {
    await open({ ...common, id: 'x', ...fields } as LifeGoal);
    expect(rendered()).toContain(text);
    expect(rings()[0]).toBeCloseTo(ratio, 12);
  });

  it('shows amounts with a decimal comma in Danish', async () => {
    await act(async () => { await i18n.changeLanguage('da'); });
    await open({ ...common, id: 'a', type: 'amount', target: 10_000, current: 2550, unit: 'km' });
    expect(rendered()).toContain('25,5 / 100 km');
  });

  it('sets the current value absolutely and keeps it exact', async () => {
    await open({ ...common, id: 'c', type: 'count', target: 12, current: 7 });
    await type('Update progress', '9');
    await press('Save progress');
    expect(goals()[0]).toMatchObject({ current: 9 });
    expect(rendered()).toContain('9 / 12');
    await type('Update progress', '-1');
    await press('Save progress');
    expect(goals()[0]).toMatchObject({ current: 9 });
    expect(rendered()).toContain('Enter a whole number of 0 or more.');
  });

  it('sets an amount progress with a decimal and a duration progress in hours and minutes', async () => {
    await open({ ...common, id: 'a', type: 'amount', target: 10_000, current: 0, unit: 'km' });
    await type('Update progress', '12,34');
    await press('Save progress');
    expect(goals()[0]).toMatchObject({ current: 1234 });
    act(() => tree.unmount());
    await open({ ...common, id: 'd', type: 'duration', target: 6000, current: 0 });
    await type('Update progress: Hours', '2');
    await type('Update progress: Minutes', '15');
    await press('Save progress');
    expect(goals()[0]).toMatchObject({ current: 135 });
  });

  it('binary: mark as done and reopen; milestones neither complete nor reopen it', async () => {
    await open({ ...common, id: 'b', type: 'binary', completed: false, milestones: [{ id: 'm', title: 'Step', completed: true }] });
    expect(rendered()).toContain('Not done yet');
    expect(rendered()).toContain('1 / 1 milestone');
    expect(rings()[0]).toBe(0);
    await press('Mark as done');
    expect(goals()[0]).toMatchObject({ completed: true });
    expect(rings()[0]).toBe(1);
    await press('Reopen');
    expect(goals()[0]).toMatchObject({ completed: false });
  });

  it('milestones are checkboxes with state, 44pt targets and labelled remove controls', async () => {
    await open({ ...common, id: 'b', type: 'binary', completed: false, milestones: [{ id: 'm', title: 'Book test', completed: false }] });
    const box = tree.root.find((node) => node.props.accessibilityRole === 'checkbox');
    expect(box.props.accessibilityState).toEqual({ checked: false });
    expect(StyleSheet.flatten(box.props.style).minHeight).toBeGreaterThanOrEqual(44);
    const remove = tree.root.find((node) => node.props.accessibilityLabel === 'Remove milestone Book test');
    expect(StyleSheet.flatten(remove.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
    await act(async () => { box.props.onPress(); });
    expect(goals()[0].milestones[0].completed).toBe(true);
    expect(goals()[0]).toMatchObject({ completed: false });
    await act(async () => { remove.props.onPress(); });
    expect(goals()[0].milestones).toEqual([]);
  });

  it('adds a milestone from the input', async () => {
    await open({ ...common, id: 'c', type: 'count', target: 3, current: 1 });
    await type('New milestone', '  First step ');
    await press('Add');
    expect(goals()[0].milestones).toMatchObject([{ title: 'First step', completed: false }]);
    expect(goals()[0]).toMatchObject({ current: 1 });
  });

  it('edits title, target, unit and clears the deadline; the type cannot change', async () => {
    await open({ ...common, id: 'a', type: 'amount', target: 10_000, current: 500, unit: 'km', deadline: '2026-12-01' });
    await edit();
    expect(rendered()).toContain('The goal type cannot be changed');
    expect(rendered()).toContain('picker:2026-12-01');
    await type('Title (e.g. Learn to play guitar)', 'Run further');
    await type('Unit', 'miles');
    await type('Target', '50,5');
    await press('Remove deadline');
    await press('Save');
    expect(goals()[0]).toEqual({
      id: 'a', title: 'Run further', milestones: [], createdAt: common.createdAt, type: 'amount', target: 5050, current: 500, unit: 'miles',
    });
  });

  it('refuses an invalid edit and keeps the goal unchanged', async () => {
    await open({ ...common, id: 'c', type: 'count', target: 12, current: 7 });
    await edit();
    await type('Target', '0');
    await press('Save');
    expect(goals()[0]).toMatchObject({ target: 12 });
    expect(rendered()).toContain('Enter a whole number of 1 or more.');
  });

  it('lowering the target below current completes the goal; no screen offers a type change', async () => {
    await open({ ...common, id: 'c', type: 'count', target: 12, current: 7 });
    await edit();
    await type('Target', '5');
    await press('Save');
    expect(rendered()).toContain('Target reached');
    expect(rings()[0]).toBe(1);
    expect(buttons().map(nodeText).filter((label) => ['Count', 'Amount', 'Duration', 'Done / not done'].includes(label))).toEqual([]);
  });

  it('shows a passed deadline neutrally and does not change anything', async () => {
    await open({ ...common, id: 'c', type: 'count', target: 12, current: 7, deadline: '2019-01-01' });
    expect(rendered()).toContain('Deadline: 2019-01-01');
    expect(rendered()).not.toMatch(/overdue|late|missed|failed/i);
    expect(goals()[0]).toMatchObject({ current: 7 });
  });

  it('shows a safe state for a missing goal', async () => {
    mockParams = { id: 'gone' };
    await render(<LifeGoalDetailScreen />);
    expect(rendered()).toContain('No goals yet');
  });
});

describe('APP-063 list screen', () => {
  const list: LifeGoal[] = [
    { ...common, id: 'open', title: 'Open binary', type: 'binary', completed: false,
      milestones: [{ id: '1', title: 'a', completed: true }, { id: '2', title: 'b', completed: true }, { id: '3', title: 'c', completed: false }] },
    { ...common, id: 'done', title: 'Done binary', type: 'binary', completed: true },
    { ...common, id: 'count', title: 'Books', type: 'count', target: 12, current: 6 },
    { ...common, id: 'over', title: 'Overshot', type: 'count', target: 2, current: 5 },
  ];
  const titles = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).filter((text) => list.some((goal) => goal.title === text));

  it('uses canonical progress and completion; milestones are secondary text and never drive the ring', async () => {
    useLifeGoalsStore.setState({ goals: list });
    await render(<LifeGoalsScreen />);
    // Active filter: completed binary and the goal at/above target are hidden.
    expect(titles()).toEqual(['Open binary', 'Books']);
    expect(rings()).toEqual([0, 0.5]);
    expect(rendered()).toContain('2 / 3 milestones');
    expect(rendered()).toContain('6 / 12');
    await press('Show completed');
    expect(titles()).toEqual(['Open binary', 'Done binary', 'Books', 'Overshot']);
    expect(rings()).toEqual([0, 1, 0.5, 1]);
    expect(rendered()).toContain('5 / 2');
  });

  it('shows the empty state and navigates to new and detail screens', async () => {
    await render(<LifeGoalsScreen />);
    expect(rendered()).toContain('No goals yet');
    await press('+ Add goal');
    expect(mockRouter.push).toHaveBeenCalledWith('/life-goals/new');
  });
});
