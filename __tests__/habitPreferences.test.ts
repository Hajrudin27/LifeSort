import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'fs';
import path from 'path';

import '@/features/habits/habitRemoval';
import { LOCAL_STORE_RESETS } from '@/features/localStores';
import type { Habit } from '@/types/life';

// The app-lock store pulls in an ESM-only crypto package; this test never runs PBKDF2.
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) } },
}));

import { sanitizeStreakEnabledHabitIds, useHabitPreferencesStore } from '@/store/useHabitPreferencesStore';
import { onHabitRemoved, useHabitsStore } from '@/store/useHabitsStore';

const KEY = 'lifesort-habit-preferences';
const prefs = () => useHabitPreferencesStore.getState();
const habit = (id: string): Habit => ({
  id, title: `Habit ${id}`, direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-28',
  scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: { kind: 'weekdays', days: [1] } }], logs: [],
});

beforeEach(async () => {
  prefs().clearLocal();
  useHabitsStore.getState().clearLocal();
  await AsyncStorage.clear();
});

describe('APP-065 per-habit streak preference', () => {
  it('is off for every habit by default, including habits that already exist', () => {
    useHabitsStore.setState({ habits: [habit('a'), habit('b')] });
    expect(prefs().isStreakEnabled('a')).toBe(false);
    expect(prefs().isStreakEnabled('b')).toBe(false);
    expect(prefs().streakEnabledHabitIds).toEqual([]);
  });

  it('turns on and off for one habit without touching another', () => {
    prefs().setStreakEnabled('a', true);
    expect(prefs().isStreakEnabled('a')).toBe(true);
    expect(prefs().isStreakEnabled('b')).toBe(false);
    prefs().setStreakEnabled('b', true);
    prefs().setStreakEnabled('a', false);
    expect(prefs().isStreakEnabled('a')).toBe(false);
    expect(prefs().isStreakEnabled('b')).toBe(true);
  });

  it('does not duplicate an id when enabled twice', () => {
    prefs().setStreakEnabled('a', true);
    prefs().setStreakEnabled('a', true);
    expect(prefs().streakEnabledHabitIds).toEqual(['a']);
  });

  it('a new habit starts off', () => {
    const id = useHabitsStore.getState().addHabit({ title: 'Walk', direction: 'build', schedule: { kind: 'open' } });
    expect(prefs().isStreakEnabled(id)).toBe(false);
  });

  it('persists only the list of ids, never a streak number', async () => {
    prefs().setStreakEnabled('a', true);
    await new Promise((resolve) => setImmediate(resolve));
    const raw = await AsyncStorage.getItem(KEY);
    expect(JSON.parse(raw!).state).toEqual({ streakEnabledHabitIds: ['a'] });
  });

  it.each([
    ['a string', 'yes'],
    ['a boolean', true],
    ['an object', { a: true }],
    ['null', null],
    ['numbers', [1, 2]],
    ['an empty id', ['a', '']],
    ['a mixed list', ['a', true]],
  ])('fails closed on a corrupted value: %s', async (_name, value) => {
    expect(sanitizeStreakEnabledHabitIds(value)).toEqual([]);
    await AsyncStorage.setItem(KEY, JSON.stringify({ state: { streakEnabledHabitIds: value }, version: 0 }));
    await useHabitPreferencesStore.persist.rehydrate();
    expect(prefs().streakEnabledHabitIds).toEqual([]);
    expect(prefs().isStreakEnabled('a')).toBe(false);
  });

  it('fails closed when the key is missing from a stored object, and keeps valid ids and ignores unknown ones', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ state: {}, version: 0 }));
    await useHabitPreferencesStore.persist.rehydrate();
    expect(prefs().streakEnabledHabitIds).toEqual([]);
    await AsyncStorage.setItem(KEY, JSON.stringify({ state: { streakEnabledHabitIds: ['a', 'gone', 'a'] }, version: 0 }));
    await useHabitPreferencesStore.persist.rehydrate();
    expect(prefs().streakEnabledHabitIds).toEqual(['a', 'gone']);
    expect(prefs().isStreakEnabled('a')).toBe(true);
  });

  it('removes the preference when its habit is deleted, and only that one', () => {
    useHabitsStore.setState({ habits: [habit('a'), habit('b')] });
    prefs().setStreakEnabled('a', true);
    prefs().setStreakEnabled('b', true);
    useHabitsStore.getState().removeHabit('a');
    expect(prefs().streakEnabledHabitIds).toEqual(['b']);
  });

  it('keeps the deletion when a removal listener throws, and still notifies the others', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    const offBad = onHabitRemoved(() => { throw new Error('boom'); });
    const offGood = onHabitRemoved((habitId) => seen.push(habitId));
    prefs().setStreakEnabled('a', true);
    useHabitsStore.setState({ habits: [{ id: 'a' } as never, { id: 'b' } as never] });
    useHabitsStore.getState().removeHabit('a');
    offBad(); offGood(); warn.mockRestore();
    expect(useHabitsStore.getState().habits.map((habit) => habit.id)).toEqual(['b']);
    expect(seen).toEqual(['a']);
    expect(prefs().streakEnabledHabitIds).toEqual([]);
  });

  it('is loaded by the app root: _layout imports the auth store, which imports the logout registry, which loads the removal link', () => {
    const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    expect(read('app/_layout.tsx')).toContain("@/store/useAuthStore");
    expect(read('store/useAuthStore.ts')).toContain("@/features/localStores");
    expect(read('features/localStores.ts')).toContain("@/features/habits/habitRemoval");
  });

  it('is reset by the logout registry, which owns the key', async () => {
    prefs().setStreakEnabled('a', true);
    const entry = LOCAL_STORE_RESETS.find((candidate) => candidate.key === KEY);
    expect(entry).toBeDefined();
    await entry!.reset();
    expect(prefs().streakEnabledHabitIds).toEqual([]);
  });
});
