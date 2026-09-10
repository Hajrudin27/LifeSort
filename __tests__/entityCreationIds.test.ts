import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { newEntityId } from '@/core/ids';
import { Expense } from '@/types/expense';

// Exercise the real Zustand persistence/hydration and domain actions without a device.
// Encryption itself is covered by the APP-028/029 suites.
jest.mock('@/core/storage/documentCacheStorage', () => ({
  documentMetadataEncryptedStorage: require('@react-native-async-storage/async-storage'),
  deleteCachedAttachmentFile: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/core/storage/cycleHealthEncryptedStorage', () => ({
  cycleHealthEncryptedStorage: require('@react-native-async-storage/async-storage'),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) } },
}));
jest.mock('@/utils/shared/attachmentSync', () => ({
  uploadAttachment: jest.fn(() => Promise.resolve(null)),
  deleteAttachmentRemote: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/utils/trip/tripReminder', () => ({
  scheduleTripPackingReminder: jest.fn(), cancelTripPackingReminder: jest.fn(),
}));
jest.mock('@/utils/warranty/warrantyReminder', () => ({
  scheduleWarrantyReminder: jest.fn(), cancelWarrantyReminder: jest.fn(),
}));

import { useExpensesStore } from '@/store/useExpensesStore';
import { useTripsStore } from '@/store/useTripsStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { useTodoStore } from '@/store/useTodoStore';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { useHabitsStore } from '@/store/useHabitsStore';
import { useCareerStore } from '@/store/useCareerStore';
import { useCVStore } from '@/store/useCVStore';
import { useCycleStore } from '@/store/useCycleStore';
import { useFoodStore } from '@/store/useFoodStore';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import { scheduleTripPackingReminder } from '@/utils/trip/tripReminder';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const expenseInput = { name: 'Synthetic rent', amount: 100, category: 'bill', nextPaymentDate: '2026-09-01', isRecurring: true };
const tripInput = { name: 'Synthetic trip', startDate: '2027-01-01', endDate: '2027-01-03', budget: null };

function expectFreshIds(records: { id: string }[]) {
  expect(records.length).toBeGreaterThan(0);
  expect(records.every(({ id }) => UUID_V4.test(id))).toBe(true);
  expect(new Set(records.map(({ id }) => id)).size).toBe(records.length);
}

beforeEach(async () => {
  await Promise.all([
    useExpensesStore.persist.rehydrate(), useTripsStore.persist.rehydrate(),
    useSavingsGoalsStore.persist.rehydrate(), useTodoStore.persist.rehydrate(),
    useLifeGoalsStore.persist.rehydrate(), useHabitsStore.persist.rehydrate(),
    useCareerStore.persist.rehydrate(), useCVStore.persist.rehydrate(),
    useCycleStore.persist.rehydrate(), useFoodStore.persist.rehydrate(),
    useHouseholdStore.persist.rehydrate(), useWarrantiesStore.persist.rehydrate(),
  ]);
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useTripsStore.setState({ trips: [], expenses: [], packingItems: [], participants: [] });
  useSavingsGoalsStore.setState({ goals: [], history: [] });
  useTodoStore.setState({ todos: [] });
  useLifeGoalsStore.setState({ goals: [] });
  useHabitsStore.setState({ habits: [] });
  useCareerStore.setState({ applications: [], skills: [] });
  useCVStore.setState({ education: [], experience: [], languages: [], versions: [] });
  useCycleStore.setState({ cycles: [], symptomLogs: [] });
  useFoodStore.setState({ standardPrices: [], purchases: [], pantryItems: [], shoppingItems: [], offers: [], recipes: [] });
  useHouseholdStore.setState({ tasks: [], shoppingItems: [], movingItems: [] });
  useWarrantiesStore.setState({ warranties: [] });
});
afterEach(() => jest.restoreAllMocks());

it('APP-030 creates distinct expense UUIDs in the same clock tick and shares the series ID', () => {
  jest.spyOn(Date, 'now').mockReturnValue(123);
  for (let i = 0; i < 20; i++) useExpensesStore.getState().addExpense(expenseInput);
  const expenses = useExpensesStore.getState().expenses;
  expectFreshIds(expenses);
  expect(expenses.every((e) => e.seriesId === e.id)).toBe(true);
});

it('mints fresh recurrence instance IDs, preserves series/month deduplication and stop/edit behavior', () => {
  const store = useExpensesStore.getState();
  const rootId = store.addExpense(expenseInput);
  store.rollForwardMonth('2026-10');
  store.rollForwardMonth('2026-10');
  store.rollForwardMonth('2026-11');
  const instances = useExpensesStore.getState().expenses;
  expect(instances).toHaveLength(3);
  expectFreshIds(instances);
  expect(instances.every((e) => e.seriesId === rootId)).toBe(true);
  const october = instances.find((e) => e.nextPaymentDate === '2026-10-01')!;
  store.updateExpense(october.id, { amount: 200 });
  store.rollForwardMonth('2026-11');
  const november = useExpensesStore.getState().expenses.find((e) => e.nextPaymentDate === '2026-11-01')!;
  expect(november.amount).toBe(200);
  expect(november.id).not.toBe(instances[2].id);
  expect(november.seriesId).toBe(rootId);
  store.deleteRecurringFromMonth(rootId, '2026-11');
  store.rollForwardMonth('2026-12');
  expect(useExpensesStore.getState().expenses).toHaveLength(2);
});

it('keeps trip references and reminder IDs, while copied packing items get new IDs', async () => {
  const store = useTripsStore.getState();
  const firstId = store.addTrip(tripInput, [{ label: 'Passport', category: 'other' }]);
  const copiedId = store.addTrip(tripInput, [], firstId);
  store.addPackingItem(copiedId, 'Coat', 'other');
  const expenseId = await store.addTripExpense({ tripId: copiedId, name: 'Train', amount: 25, category: 'transport' });
  const state = useTripsStore.getState();
  expectFreshIds([...state.trips, ...state.packingItems, ...state.expenses]);
  expect(state.packingItems.map((p) => p.tripId)).toEqual([firstId, copiedId, copiedId]);
  expect(state.expenses[0]).toMatchObject({ id: expenseId, tripId: copiedId });
  expect(scheduleTripPackingReminder).toHaveBeenCalledWith(copiedId, tripInput.name, tripInput.startDate);
});

it('gives savings contributions independent IDs while preserving both goal references', () => {
  const store = useSavingsGoalsStore.getState();
  const first = store.addGoal({ name: 'First', targetAmount: 100, icon: 'other' });
  const second = store.addGoal({ name: 'Second', targetAmount: 100, icon: 'other' });
  store.addContribution(first, 50);
  store.distributeContributions([{ id: first, amount: 10 }, { id: second, amount: 20 }]);
  store.transferBetweenGoals(first, second, 5);
  const state = useSavingsGoalsStore.getState();
  expectFreshIds([...state.goals, ...state.history]);
  expect(state.history.map((h) => h.goalId)).toEqual([first, first, second, first, second]);
});

it('covers each other migrated store, nested records, and CV references', () => {
  useTodoStore.getState().addTodo({ title: 'Task', importance: 'low' });
  const goal = useLifeGoalsStore.getState().addGoal({ title: 'Goal' });
  useLifeGoalsStore.getState().addSubGoal(goal, 'Step');
  useHabitsStore.getState().addHabit({ title: 'Habit', direction: 'build' });
  useHabitsStore.getState().toggleLogForDate(useHabitsStore.getState().habits[0].id, '2026-09-10');
  useCareerStore.getState().addApplication({ company: 'Example', position: 'Role', status: 'applied', appliedDate: '2026-09-10' });
  useCareerStore.getState().addSkill({ name: 'Writing', category: 'soft', level: 'beginner' });
  const cv = useCVStore.getState();
  cv.addEducation({ school: 'School', degree: 'Degree', startDate: '2020-01' });
  cv.addExperience({ company: 'Example', position: 'Role', startDate: '2021-01' });
  cv.addLanguage('Danish', 'native');
  const refs = {
    educationIds: [useCVStore.getState().education[0].id], experienceIds: [useCVStore.getState().experience[0].id],
    languageIds: [useCVStore.getState().languages[0].id], skillIds: [useCareerStore.getState().skills[0].id],
  };
  cv.addVersion({ name: 'CV', theme: 'navy', ...refs });
  expect(useCVStore.getState().versions[0]).toMatchObject(refs);
  useCycleStore.getState().startPeriod('2026-09-01');
  useCycleStore.getState().logSymptoms('2026-09-01', ['cramps']);
  const food = useFoodStore.getState();
  food.addStandardPrice({ productName: 'Milk', store: 'Example', price: 10 });
  food.addPurchase(10);
  food.addPantryItem({ name: 'Milk' });
  food.addShoppingItem('Milk');
  food.addOffer({ productName: 'Milk', store: 'Example', price: 8, weekKey: '2026-W37' });
  food.addRecipe({ name: 'Meal', mealType: 'dinner', ingredients: [] });
  const home = useHouseholdStore.getState();
  home.addTask({ kind: 'cleaning', title: 'Clean', frequency: 'weekly' });
  home.addShoppingItem('Soap');
  home.addMovingItem('Pack');
  useWarrantiesStore.getState().addWarranty({ name: 'Device', type: 'warranty', expiryDate: '2027-09-01' });
  const f = useFoodStore.getState(), c = useCVStore.getState(), h = useHouseholdStore.getState();
  expectFreshIds([
    ...useTodoStore.getState().todos, ...useLifeGoalsStore.getState().goals, ...useLifeGoalsStore.getState().goals[0].subGoals,
    ...useHabitsStore.getState().habits, ...useHabitsStore.getState().habits[0].logs,
    ...useCareerStore.getState().applications, ...useCareerStore.getState().skills,
    ...c.education, ...c.experience, ...c.languages, ...c.versions,
    ...useCycleStore.getState().cycles, ...useCycleStore.getState().symptomLogs,
    ...f.standardPrices, ...f.purchases, ...f.pantryItems, ...f.shoppingItems, ...f.offers, ...f.recipes,
    ...h.tasks, ...h.shoppingItems, ...h.movingItems, ...useWarrantiesStore.getState().warranties,
  ]);
});

it.each([false, true])('hydrates, updates and deletes legacy expense/attachment IDs (series present: %s)', async (hasSeries) => {
  const legacyId = '1725206400000';
  const attachmentId = '1725206400001';
  // Older persisted JSON can omit seriesId even though the current type requires it.
  const legacy = {
    ...expenseInput, id: legacyId, ...(hasSeries ? { seriesId: legacyId } : {}),
    attachments: [{ id: attachmentId, uri: 'file:///legacy.jpg', name: 'legacy.jpg', kind: 'image' }],
    createdAt: '2024-09-01T00:00:00.000Z',
  } as Expense;
  await AsyncStorage.setItem('lifesort-expenses', JSON.stringify({ version: 0, state: { expenses: [legacy], seriesStoppedAt: {}, categoryBudgets: {} } }));
  await useExpensesStore.persist.rehydrate();
  const store = useExpensesStore.getState();
  expect(store.expenses).toEqual([legacy]);
  store.updateExpense(legacyId, { name: 'Updated' });
  store.rollForwardMonth('2026-10');
  store.rollForwardMonth('2026-11');
  store.rollForwardMonth('2026-11');
  const children = useExpensesStore.getState().expenses.filter((e) => e.id !== legacyId);
  expect(children).toHaveLength(2);
  expectFreshIds(children);
  expect(children.every((e) => e.seriesId === legacyId && e.attachments.length === 0)).toBe(true);
  store.addAttachment(legacyId, { id: newEntityId(), uri: 'file:///new.jpg', name: 'new.jpg', kind: 'image' });
  store.removeAttachment(legacyId, attachmentId);
  expect(useExpensesStore.getState().expenses[0]).toMatchObject({ id: legacyId, name: 'Updated' });
  expect(useExpensesStore.getState().expenses[0].attachments).toHaveLength(1);
  await useExpensesStore.persist.rehydrate();
  expect(useExpensesStore.getState().expenses[0].id).toBe(legacyId);
  store.removeExpense(legacyId);
  expect(useExpensesStore.getState().expenses.some((e) => e.id === legacyId)).toBe(false);
});

it('does not insert an entity when crypto fails', () => {
  (randomUUID as jest.MockedFunction<typeof randomUUID>).mockImplementationOnce(() => { throw new Error('crypto unavailable'); });
  expect(() => useExpensesStore.getState().addExpense(expenseInput)).toThrow('crypto unavailable');
  expect(useExpensesStore.getState().expenses).toEqual([]);
});
