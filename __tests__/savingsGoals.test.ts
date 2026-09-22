import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { MoneyError, minorUnits, negateMinorUnits, sumMinorUnits, type MinorUnits } from '@/core/money/minorUnits';
import type { SavingsContribution, SavingsGoal } from '@/types/savingsGoal';

/**
 * APP-043 savings goals: target/current/deadline, no double count, and the
 * balance ↔ history invariant, exercised through the REAL store. Every refused
 * operation is checked against three things at once: in-memory state, the
 * persisted bytes and the server writes. See docs/app-043-savings-goals.md.
 */

type Row = Record<string, unknown>;
type Write = { table: string; op: 'upsert' | 'insert' | 'delete'; payload?: unknown };
const mockWrites: Write[] = [];
const mockRemote: Record<string, Row[] | Row | null> = {};
let mockUserId: string | null = 'synthetic-user';
/** When set, goal upserts stay pending until the test releases them. */
let mockUpsertGate: Promise<void> | null = null;
/** When set, goal upserts resolve with this error, as supabase-js reports a refused write. */
let mockUpsertError: { code: string; message: string } | null = null;

jest.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const rows = () => Promise.resolve({ data: mockRemote[table] ?? [], error: null });
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain, eq: () => chain, in: () => chain,
      delete: () => { mockWrites.push({ table, op: 'delete' }); return chain; },
      single: () => Promise.resolve({ data: mockRemote[table] ?? null, error: mockRemote[table] ? null : { code: 'PGRST116' } }),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => rows().then(resolve, reject),
      upsert: (payload: unknown) => {
        mockWrites.push({ table, op: 'upsert', payload });
        return (mockUpsertGate ?? Promise.resolve()).then(() => ({ error: mockUpsertError }));
      },
      insert: (payload: unknown) => { mockWrites.push({ table, op: 'insert', payload }); return Promise.resolve({ error: null }); },
    });
    return chain;
  };
  return { supabase: { from, auth: { getUser: () => Promise.resolve({ data: { user: mockUserId ? { id: mockUserId } : null } }) } } };
});
jest.mock('@/utils/shared/attachmentSync', () => ({
  uploadAttachment: jest.fn(() => Promise.resolve(null)),
  deleteAttachmentRemote: jest.fn(() => Promise.resolve()),
  fetchAttachmentsFor: jest.fn(() => Promise.resolve([])),
}));
let mockFileContent = '';
let mockWritten = '';
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///synthetic/backup.json' }] })),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///synthetic/',
  readAsStringAsync: jest.fn(() => Promise.resolve(mockFileContent)),
  writeAsStringAsync: jest.fn((_uri: string, content: string) => { mockWritten = content; return Promise.resolve(); }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

import { economyHomeSnapshot } from '@/features/economy/homeSnapshot';
import { economyMonthlyReview } from '@/features/economy/monthlyReview';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { BACKUP_VERSION } from '@/utils/shared/backupValidation';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';
import { getMonthKey } from '@/utils/shared/monthKey';
import {
  allocationMovements,
  applySavingsMovements,
  contributionMovements,
  SavingsRuleError,
  savingsDeadline,
  savingsMovementsAllowed,
  savingsTarget,
  transferMovements,
} from '@/utils/savings/savingsGoalRules';

const m = minorUnits;
const KEY = 'lifesort-savings-goals';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Largest contiguous supported amount (2^33 DKK) and the first unsupported one above it. */
const EDGE = m(2 ** 33 * 100);
const MAX = m(Number.MAX_SAFE_INTEGER);
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const store = () => useSavingsGoalsStore.getState();
const saved = (id: string) => store().goals.find((goal) => goal.id === id)!.savedAmount;
const historyOf = (id: string) => store().history.filter((entry) => entry.goalId === id);
const writesTo = (table: string, op?: Write['op']) =>
  mockWrites.filter((write) => write.table === table && (op === undefined || write.op === op)).map((write) => write.payload);
const goal = (id: string, savedAmount: number, overrides: Partial<SavingsGoal> = {}): SavingsGoal =>
  ({ id, name: `Synthetic ${id}`, icon: 'other', targetAmount: m(100_000), savedAmount: m(savedAmount), createdAt: '2026-09-01T00:00:00.000Z', ...overrides });

/** State, persisted bytes and server writes, captured together. */
async function frozen() {
  await flush();
  const { goals, history, extraSavings } = store();
  return { state: JSON.stringify({ goals, history, extraSavings }), disk: await AsyncStorage.getItem(KEY), writes: JSON.stringify(mockWrites) };
}
/** A refused operation must throw its fixed code and change nothing, anywhere. */
async function expectRefused(action: () => unknown, code: string) {
  const before = await frozen();
  const listener = jest.fn();
  const unsubscribe = useSavingsGoalsStore.subscribe(listener);
  let thrown: unknown;
  try { action(); } catch (error) { thrown = error; }
  unsubscribe();
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(code);
  expect(listener).not.toHaveBeenCalled();
  expect(await frozen()).toEqual(before);
}
/** The invariant APP-043 exists for: every goal's balance is what its own history says. */
function expectBalancesMatchHistory() {
  for (const g of store().goals) {
    expect(sumMinorUnits(historyOf(g.id).map((entry) => entry.amount))).toBe(g.savedAmount);
  }
}

beforeEach(async () => {
  await Promise.all([useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate(), useSavingsGoalsStore.persist.rehydrate()]);
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
  await flush();
  mockWrites.length = 0;
  mockUserId = 'synthetic-user';
  mockUpsertGate = null;
  mockUpsertError = null;
  for (const key of Object.keys(mockRemote)) delete mockRemote[key];
});

describe('APP-043 pure rules', () => {
  const goals = [goal('a', 300), goal('b', 0)];

  it('targets are supported money and strictly positive', () => {
    expect(savingsTarget(m(1))).toBe(1);
    expect(() => savingsTarget(m(0))).toThrow('savings_target_invalid');
    expect(() => savingsTarget(m(-100))).toThrow('savings_target_invalid');
    expect(() => savingsTarget(12.5)).toThrow(MoneyError);
    expect(() => savingsTarget(undefined)).toThrow('money_unsupported_amount');
  });

  it('deadlines are absent or a real calendar date; past dates are legitimate; nothing is normalized', () => {
    expect(savingsDeadline(undefined)).toBeUndefined();
    for (const valid of ['2027-06-30', '2020-01-31', '2028-02-29']) expect(savingsDeadline(valid)).toBe(valid);
    for (const invalid of ['2027-02-29', '2027-02-30', '2027-13-01', '2027-6-1', '2027-06-01T00:00:00.000Z', '', ' 2027-06-01', null, 20270601]) {
      expect(() => savingsDeadline(invalid)).toThrow('savings_deadline_invalid');
    }
  });

  it('builders fix the sign rules: contribution non-zero, transfer and allocation strictly positive', () => {
    expect(contributionMovements('a', m(-50))).toEqual([{ goalId: 'a', amount: -50 }]);
    expect(() => contributionMovements('a', m(0))).toThrow('savings_amount_invalid');
    expect(transferMovements('a', 'b', m(50))).toEqual([{ goalId: 'a', amount: -50 }, { goalId: 'b', amount: 50 }]);
    expect(() => transferMovements('a', 'b', m(0))).toThrow('savings_amount_invalid');
    expect(() => transferMovements('a', 'b', m(-1))).toThrow('savings_amount_invalid');
    expect(() => transferMovements('a', 'a', m(1))).toThrow('savings_transfer_same_goal');
    expect(() => allocationMovements([])).toThrow('savings_allocation_empty');
    expect(() => allocationMovements([{ id: 'a', amount: m(-1) }])).toThrow('savings_amount_invalid');
    expect(() => contributionMovements('a', 12.5 as MinorUnits)).toThrow('money_unsupported_amount');
  });

  it('applying movements refuses unknown and repeated goals, negative results and unsupported results', () => {
    expect(() => applySavingsMovements(goals, [{ goalId: 'missing', amount: m(1) }])).toThrow('savings_goal_not_found');
    expect(() => applySavingsMovements(goals, [{ goalId: 'a', amount: m(1) }, { goalId: 'a', amount: m(1) }])).toThrow('savings_duplicate_goal');
    expect(() => applySavingsMovements(goals, [{ goalId: 'a', amount: m(-301) }])).toThrow('savings_insufficient_balance');
    expect(() => applySavingsMovements([goal('edge', EDGE)], [{ goalId: 'edge', amount: m(1) }])).toThrow('money_unsupported_amount');
    const next = applySavingsMovements(goals, [{ goalId: 'a', amount: m(-300) }]);
    expect(next.map((g) => g.savedAmount)).toEqual([0, 0]);
    expect(next[1]).toBe(goals[1]); // untouched goals are the same objects
    expect(goals[0].savedAmount).toBe(300); // input never mutated
  });

  it('errors carry a fixed code only, never amounts, names, IDs or dates', () => {
    const error = (() => { try { transferMovements('goal-with-a-name', 'goal-with-a-name', m(123_456)); } catch (e) { return e; } })();
    expect(error).toBeInstanceOf(SavingsRuleError);
    expect(JSON.stringify({ message: (error as Error).message, ...(error as object) })).not.toMatch(/123|goal-with/);
  });

  it('form validation mirrors the store without throwing', () => {
    expect(savingsMovementsAllowed(goals, () => contributionMovements('a', m(-300)))).toBe(true);
    expect(savingsMovementsAllowed(goals, () => contributionMovements('a', m(-301)))).toBe(false);
    expect(savingsMovementsAllowed(goals, () => transferMovements('a', 'a', m(1)))).toBe(false);
  });
});

describe('APP-043 goal creation and editing', () => {
  it('a positive target creates a goal with a crypto ID, zero balance and no deadline unless one is given', async () => {
    const id = store().addGoal({ name: 'Synthetic trip', targetAmount: m(150_000), icon: 'travel' });
    expect(id).toMatch(UUID_V4);
    expect(store().goals).toEqual([{ id, name: 'Synthetic trip', icon: 'travel', targetAmount: 150_000, savedAmount: 0, createdAt: expect.any(String) }]);
    expect('deadline' in store().goals[0]).toBe(false);
    await flush();
    expect(writesTo('savings_goals')).toEqual([expect.objectContaining({ id, target_amount: '1500.00', saved_amount: '0.00', deadline: null })]);
  });

  it('an optional deadline is stored in state, on disk and on the server — including one already in the past', async () => {
    const future = store().addGoal({ name: 'Future', targetAmount: m(1_000), icon: 'other', deadline: '2027-06-30' });
    const past = store().addGoal({ name: 'Past', targetAmount: m(1_000), icon: 'other', deadline: '2020-01-31' });
    expect(store().goals.map((g) => g.deadline)).toEqual(['2027-06-30', '2020-01-31']);
    await flush();
    expect(writesTo('savings_goals').map((row: any) => [row.id, row.deadline])).toEqual([[future, '2027-06-30'], [past, '2020-01-31']]);
    expect(JSON.parse((await AsyncStorage.getItem(KEY))!).state.goals.map((g: Row) => g.deadline)).toEqual(['2027-06-30', '2020-01-31']);
  });

  it.each([
    ['zero target', { targetAmount: m(0) }, 'savings_target_invalid'],
    ['negative target', { targetAmount: m(-1) }, 'savings_target_invalid'],
    ['unsupported target', { targetAmount: MAX }, 'money_unsupported_amount'],
    ['impossible deadline', { deadline: '2027-02-30' }, 'savings_deadline_invalid'],
    ['timestamp deadline', { deadline: '2027-06-30T00:00:00.000Z' }, 'savings_deadline_invalid'],
    ['empty deadline', { deadline: '' }, 'savings_deadline_invalid'],
  ])('refuses a %s before any state, disk or server change', async (_name, overrides, code) => {
    store().addGoal({ name: 'Existing', targetAmount: m(1_000), icon: 'other' });
    await expectRefused(() => store().addGoal({ name: 'New', targetAmount: m(1_000), icon: 'other', ...overrides }), code);
  });

  it('editing validates target and deadline, can clear the deadline, and can never touch the balance', async () => {
    const id = store().addGoal({ name: 'Goal', targetAmount: m(1_000), icon: 'other', deadline: '2027-01-15' });
    store().addContribution(id, m(400));
    await expectRefused(() => store().updateGoal(id, { targetAmount: m(0) }), 'savings_target_invalid');
    await expectRefused(() => store().updateGoal(id, { name: 'Renamed', deadline: '2027-01-32' }), 'savings_deadline_invalid');

    store().updateGoal(id, { name: 'Renamed', deadline: undefined });
    expect(store().goals[0]).toMatchObject({ name: 'Renamed', savedAmount: 400 });
    expect(store().goals[0].deadline).toBeUndefined();
    await flush();
    expect(writesTo('savings_goals').at(-1)).toMatchObject({ id, name: 'Renamed', deadline: null });

    // A caller outside TypeScript cannot reach the balance through an edit.
    store().updateGoal(id, { savedAmount: m(-5), targetAmount: m(2_000) } as never);
    expect(store().goals[0]).toMatchObject({ targetAmount: 2_000, savedAmount: 400 });
    expectBalancesMatchHistory();
  });
});

describe('APP-043 contributions and withdrawals', () => {
  it('a deposit changes the balance and the history by exactly the same amount', async () => {
    const id = store().addGoal({ name: 'Goal', targetAmount: m(10_000), icon: 'other' });
    store().addContribution(id, m(2_550));
    expect(saved(id)).toBe(2_550);
    expect(historyOf(id)).toEqual([{ id: expect.stringMatching(UUID_V4), goalId: id, amount: 2_550, date: expect.any(String) }]);
    await flush();
    expect(writesTo('savings_history')).toEqual([[expect.objectContaining({ goal_id: id, amount: '25.50' })]]);
    expect(writesTo('savings_goals').at(-1)).toEqual([expect.objectContaining({ id, saved_amount: '25.50' })]);
  });

  it('a withdrawal changes both by the same magnitude, and a full withdrawal reaches exactly zero', () => {
    const id = store().addGoal({ name: 'Goal', targetAmount: m(10_000), icon: 'other' });
    store().addContribution(id, m(5_000));
    store().addContribution(id, negateMinorUnits(m(1_250)));
    expect(saved(id)).toBe(3_750);
    store().addContribution(id, negateMinorUnits(m(3_750)));
    expect(saved(id)).toBe(0);
    expect(historyOf(id).map((entry) => entry.amount)).toEqual([5_000, -1_250, -3_750]);
    expectBalancesMatchHistory();
  });

  it('a withdrawal larger than the balance is refused atomically: 3.00 DKK held, 50.00 DKK requested', async () => {
    const id = store().addGoal({ name: 'Goal', targetAmount: m(10_000), icon: 'other' });
    store().addContribution(id, m(300));
    await expectRefused(() => store().addContribution(id, negateMinorUnits(m(5_000))), 'savings_insufficient_balance');
    expect(saved(id)).toBe(300);
    expect(historyOf(id).map((entry) => entry.amount)).toEqual([300]);
  });

  it.each([
    ['a missing goal', 'missing', m(100), 'savings_goal_not_found'],
    ['a zero amount', 'existing', m(0), 'savings_amount_invalid'],
    ['a non-integer amount', 'existing', 12.5 as MinorUnits, 'money_unsupported_amount'],
    ['an unsupported amount', 'existing', MAX, 'money_unsupported_amount'],
  ])('refuses %s atomically', async (_name, target, amount, code) => {
    useSavingsGoalsStore.setState({ goals: [goal('existing', 100)], history: [{ id: 'h', goalId: 'existing', amount: m(100), date: '2026-09-01T00:00:00.000Z' }] });
    await expectRefused(() => store().addContribution(target, amount), code);
  });

  it('refuses a deposit whose resulting balance would not be supported money', async () => {
    useSavingsGoalsStore.setState({ goals: [goal('edge', EDGE)], history: [] });
    await expectRefused(() => store().addContribution('edge', m(1)), 'money_unsupported_amount');
  });
});

describe('APP-043 transfers between goals', () => {
  const seed = () => {
    useSavingsGoalsStore.setState({
      goals: [goal('from', 10_000), goal('to', 2_500), goal('edge', EDGE)],
      history: [
        { id: 'h1', goalId: 'from', amount: m(10_000), date: '2026-09-01T00:00:00.000Z' },
        { id: 'h2', goalId: 'to', amount: m(2_500), date: '2026-09-01T00:00:00.000Z' },
        { id: 'h3', goalId: 'edge', amount: EDGE, date: '2026-09-01T00:00:00.000Z' },
      ],
    });
  };

  it('moves exactly the amount, conserves the total and records exactly −amount and +amount', async () => {
    seed();
    store().transferBetweenGoals('from', 'to', m(3_333));
    expect([saved('from'), saved('to')]).toEqual([6_667, 5_833]);
    expect(saved('from') + saved('to')).toBe(12_500);
    const [out, into] = store().history.slice(-2);
    expect(out).toMatchObject({ goalId: 'from', amount: -3_333 });
    expect(into).toMatchObject({ goalId: 'to', amount: 3_333 });
    expect(out.date).toBe(into.date);
    expect(out.id).not.toBe(into.id);
    expectBalancesMatchHistory();
    await flush();
    expect(writesTo('savings_history').at(-1)).toEqual([
      expect.objectContaining({ goal_id: 'from', amount: '-33.33' }),
      expect.objectContaining({ goal_id: 'to', amount: '33.33' }),
    ]);
  });

  it('can move the whole source balance, leaving exactly zero', () => {
    seed();
    store().transferBetweenGoals('from', 'to', m(10_000));
    expect([saved('from'), saved('to')]).toEqual([0, 12_500]);
    expectBalancesMatchHistory();
  });

  it.each([
    ['a missing source', 'missing', 'to', m(100), 'savings_goal_not_found'],
    ['a missing destination', 'from', 'missing', m(100), 'savings_goal_not_found'],
    ['the same goal on both sides', 'from', 'from', m(100), 'savings_transfer_same_goal'],
    ['zero', 'from', 'to', m(0), 'savings_amount_invalid'],
    ['a negative amount', 'from', 'to', m(-100), 'savings_amount_invalid'],
    ['more than the source holds (no value is created)', 'from', 'to', m(10_001), 'savings_insufficient_balance'],
    ['a destination balance that would not be supported', 'from', 'edge', m(1), 'money_unsupported_amount'],
  ])('refuses %s atomically', async (_name, fromId, toId, amount, code) => {
    seed();
    await expectRefused(() => store().transferBetweenGoals(fromId, toId, amount), code);
    expectBalancesMatchHistory();
  });
});

describe('APP-043 distribution across goals', () => {
  const seed = () => useSavingsGoalsStore.setState({ goals: [goal('a', 0), goal('b', 100), goal('c', 0), goal('edge', EDGE)], history: [
    { id: 'hb', goalId: 'b', amount: m(100), date: '2026-09-01T00:00:00.000Z' },
    { id: 'he', goalId: 'edge', amount: EDGE, date: '2026-09-01T00:00:00.000Z' },
  ] });

  it('applies each allocation to its own goal and records each with exactly the same amount', async () => {
    seed();
    store().distributeContributions([{ id: 'a', amount: m(333) }, { id: 'b', amount: m(334) }, { id: 'c', amount: m(333) }]);
    expect(['a', 'b', 'c'].map(saved)).toEqual([333, 434, 333]);
    expect(store().history.slice(-3).map((entry) => [entry.goalId, entry.amount])).toEqual([['a', 333], ['b', 334], ['c', 333]]);
    expectBalancesMatchHistory();
    await flush();
    expect(writesTo('savings_goals', 'upsert').at(-1)).toEqual(['a', 'b', 'c'].map((id) => expect.objectContaining({ id })));
  });

  it('refuses duplicate goal IDs, so history can never say +100 and +200 while the balance moved by 100', async () => {
    seed();
    await expectRefused(() => store().distributeContributions([{ id: 'a', amount: m(100) }, { id: 'a', amount: m(200) }]), 'savings_duplicate_goal');
    expect(saved('a')).toBe(0);
    expect(historyOf('a')).toEqual([]);
  });

  it.each([
    ['a missing goal', [{ id: 'a', amount: m(1) }, { id: 'missing', amount: m(1) }], 'savings_goal_not_found'],
    ['a zero allocation', [{ id: 'a', amount: m(1) }, { id: 'c', amount: m(0) }], 'savings_amount_invalid'],
    ['a negative allocation', [{ id: 'a', amount: m(100) }, { id: 'b', amount: m(-100) }], 'savings_amount_invalid'],
    ['an unsupported resulting balance', [{ id: 'a', amount: m(1) }, { id: 'edge', amount: m(1) }], 'money_unsupported_amount'],
    ['no allocations at all', [], 'savings_allocation_empty'],
  ])('refuses %s atomically — no allocation of the batch is applied', async (_name, allocations, code) => {
    seed();
    await expectRefused(() => store().distributeContributions(allocations), code);
  });
});

describe('APP-043 target/current: overfunding and the balance ↔ history invariant', () => {
  it('a balance may exceed its target; the value is kept exactly', () => {
    const id = store().addGoal({ name: 'Goal', targetAmount: m(10_000), icon: 'other' });
    store().addContribution(id, m(15_001));
    expect(store().goals[0]).toMatchObject({ targetAmount: 10_000, savedAmount: 15_001 });
    store().addContribution(id, negateMinorUnits(m(15_001)));
    expect(saved(id)).toBe(0);
  });

  it('under any mix of accepted and refused operations, every balance equals the sum of its own history', () => {
    const ids = ['g0', 'g1', 'g2'].map((name) => store().addGoal({ name, targetAmount: m(50_000), icon: 'other' }));
    let seedValue = 43;
    const random = (limit: number) => { seedValue = (seedValue * 1_103_515_245 + 12_345) % 2 ** 31; return seedValue % limit; };
    let accepted = 0;
    for (let step = 0; step < 300; step += 1) {
      const a = ids[random(3)];
      const b = ids[random(3)];
      const amount = m(random(20_000) - 5_000);
      const total = sumMinorUnits(store().goals.map((g) => g.savedAmount));
      try {
        switch (random(4)) {
          case 0: store().addContribution(a, amount); break;
          case 1: store().transferBetweenGoals(a, b, amount); expect(sumMinorUnits(store().goals.map((g) => g.savedAmount))).toBe(total); break;
          case 2: store().distributeContributions([{ id: a, amount }, { id: b, amount: m(random(1_000)) }]); break;
          default: store().addContribution(a, negateMinorUnits(amount)); break;
        }
        accepted += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
      for (const g of store().goals) expect(g.savedAmount).toBeGreaterThanOrEqual(0);
      expectBalancesMatchHistory();
    }
    expect(accepted).toBeGreaterThan(50);
  });
});

describe('APP-043 no double count: savings movements are never Economy facts', () => {
  const MONTH = getMonthKey(new Date());
  const totals = () => economyTotalsForMonth(useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth, MONTH);
  const economyFacts = async () => (await economyMonthlyReview(MONTH)).filter((fact) => fact.labelKey === 'review.economySpent' || fact.labelKey === 'review.economyIncome');

  it('contribution, withdrawal, transfer and distribution leave spending, income, balance, Home and Economy rows untouched', async () => {
    useExpensesStore.getState().addExpense({ name: 'Synthetic rent', amount: m(800_000), category: 'bill', nextPaymentDate: `${MONTH}-01`, isRecurring: false, recurrenceFrequency: null });
    useIncomeStore.getState().setIncomeForMonth(MONTH, m(2_500_000));
    const a = store().addGoal({ name: 'A', targetAmount: m(1_000_000), icon: 'other' });
    const b = store().addGoal({ name: 'B', targetAmount: m(1_000_000), icon: 'other' });
    await flush();

    const expectedTotals = totals();
    expect(expectedTotals).toMatchObject({ settledSpending: 800_000, settledIncome: 2_500_000, balance: 1_700_000 });
    const expenses = JSON.stringify(useExpensesStore.getState().expenses);
    const income = JSON.stringify(useIncomeStore.getState().incomeByMonth);
    const home = (await economyHomeSnapshot())?.value;
    const facts = await economyFacts();
    mockWrites.length = 0;

    const operations: [string, () => void][] = [
      ['contribution', () => store().addContribution(a, m(300_000))],
      ['withdrawal', () => store().addContribution(a, negateMinorUnits(m(50_000)))],
      ['transfer', () => store().transferBetweenGoals(a, b, m(100_000))],
      ['distribution', () => store().distributeContributions([{ id: a, amount: m(10_000) }, { id: b, amount: m(20_000) }])],
    ];
    for (const [name, operation] of operations) {
      operation();
      await flush();
      expect({ name, totals: totals() }).toEqual({ name, totals: expectedTotals });
      expect(JSON.stringify(useExpensesStore.getState().expenses)).toBe(expenses);
      expect(JSON.stringify(useIncomeStore.getState().incomeByMonth)).toBe(income);
      expect((await economyHomeSnapshot())?.value).toBe(home);
      expect(await economyFacts()).toEqual(facts);
    }
    // Only savings tables were written; no Expense, income or bank-derived row exists.
    expect(new Set(mockWrites.map((write) => write.table))).toEqual(new Set(['savings_goals', 'savings_history']));
    expect([saved(a), saved(b)]).toEqual([160_000, 120_000]);
    expectBalancesMatchHistory();
  });
});

describe('APP-043 server writes (legacy direct path, now ordered for the history → goal foreign key)', () => {
  it('sends the goal row first and the history rows only after that write has succeeded', async () => {
    const id = store().addGoal({ name: 'Goal', targetAmount: m(10_000), icon: 'other' });
    await flush();
    mockWrites.length = 0;
    let release!: () => void;
    mockUpsertGate = new Promise<void>((resolve) => { release = resolve; });

    store().addContribution(id, m(100));
    await flush();
    expect(mockWrites.map((write) => `${write.table}:${write.op}`)).toEqual(['savings_goals:upsert']);
    release();
    await flush();
    expect(mockWrites.map((write) => `${write.table}:${write.op}`)).toEqual(['savings_goals:upsert', 'savings_history:insert']);
  });

  it.each([
    ['contribution', () => store().addContribution('a', m(25))],
    ['withdrawal', () => store().addContribution('a', m(-25))],
    ['transfer', () => store().transferBetweenGoals('a', 'b', m(50))],
    ['distribution', () => store().distributeContributions([{ id: 'a', amount: m(1) }, { id: 'b', amount: m(1) }])],
  ])('%s: a goal upsert that resolves with an error stops the attempt — no history insert, local state kept', async (_name, operation) => {
    useSavingsGoalsStore.setState({ goals: [goal('a', 100), goal('b', 0)], history: [
      { id: 'h0', goalId: 'a', amount: m(100), date: '2026-09-01T00:00:00.000Z' },
    ] });
    await flush();
    mockWrites.length = 0;
    mockUpsertError = { code: '23514', message: 'synthetic refusal' };

    operation();
    const accepted = JSON.stringify([store().goals, store().history]);
    await flush();

    // The movement was accepted locally (local-first) and stays accepted.
    expect(store().history.length).toBeGreaterThan(1);
    expectBalancesMatchHistory();
    expect(JSON.stringify([store().goals, store().history])).toBe(accepted);
    expect(JSON.parse((await AsyncStorage.getItem(KEY))!).state.history).toEqual(store().history);
    // The goal write was attempted; the history write was not.
    expect(mockWrites.map((write) => `${write.table}:${write.op}`)).toEqual(['savings_goals:upsert']);
  });

  it.each([
    ['transfer', () => store().transferBetweenGoals('a', 'b', m(50))],
    ['distribution', () => store().distributeContributions([{ id: 'a', amount: m(1) }, { id: 'b', amount: m(1) }])],
  ])('%s: one goal upsert with every touched goal, then one history insert', async (_name, operation) => {
    useSavingsGoalsStore.setState({ goals: [goal('a', 100), goal('b', 0), goal('untouched', 0)], history: [] });
    operation();
    await flush();
    expect(mockWrites.map((write) => `${write.table}:${write.op}`)).toEqual(['savings_goals:upsert', 'savings_history:insert']);
    expect((writesTo('savings_goals')[0] as Row[]).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('signed out: movements stay local-first and nothing is sent', async () => {
    mockUserId = null;
    const id = store().addGoal({ name: 'Goal', targetAmount: m(10_000), icon: 'other' });
    store().addContribution(id, m(100));
    await flush();
    expect(saved(id)).toBe(100);
    expect(mockWrites).toEqual([]);
  });

  it('deleting a goal still removes its history locally and on the server, as before', async () => {
    const id = store().addGoal({ name: 'Goal', targetAmount: m(10_000), icon: 'other' });
    store().addContribution(id, m(100));
    await flush();
    mockWrites.length = 0;
    store().removeGoal(id);
    await flush();
    expect(store()).toMatchObject({ goals: [], history: [] });
    expect(mockWrites.map((write) => `${write.table}:${write.op}`)).toEqual(['savings_goals:delete', 'savings_history:delete']);
  });
});

describe('APP-043 persistence: the local schema is unchanged (still v1)', () => {
  it('persists canonical MinorUnits, IDs, history and deadlines, and rehydrates them unchanged', async () => {
    const a = store().addGoal({ name: 'A', targetAmount: m(100_000), icon: 'travel', deadline: '2027-06-01' });
    const b = store().addGoal({ name: 'B', targetAmount: m(1_000), icon: 'other' });
    store().addContribution(a, m(12_345));
    store().transferBetweenGoals(a, b, m(2_345));
    store().distributeContributions([{ id: b, amount: m(5) }]);
    await flush();
    const disk = JSON.parse((await AsyncStorage.getItem(KEY))!);
    expect(disk.version).toBe(1);
    expect(Object.keys(disk.state).sort()).toEqual(['extraSavings', 'goals', 'history']);
    expect(disk.state.goals).toEqual(store().goals);
    expect(disk.state.history).toEqual(store().history);
    expect(disk.state.goals.map((g: Row) => [g.id, g.savedAmount, g.deadline])).toEqual([[a, 10_000, '2027-06-01'], [b, 2_350, undefined]]);
    for (const value of [...disk.state.goals.flatMap((g: Row) => [g.targetAmount, g.savedAmount]), ...disk.state.history.map((h: Row) => h.amount)]) {
      expect(Number.isSafeInteger(value)).toBe(true);
    }

    const before = JSON.stringify(store().goals) + JSON.stringify(store().history);
    useSavingsGoalsStore.setState({ goals: [], history: [] });
    await flush(); // let that write land before the bytes are restored
    await AsyncStorage.setItem(KEY, JSON.stringify(disk));
    await useSavingsGoalsStore.persist.rehydrate();
    expect(JSON.stringify(store().goals) + JSON.stringify(store().history)).toBe(before);
  });

  it('historical v0 data (pre-APP-040) migrates, hydrates and then obeys APP-043 without reinterpretation', async () => {
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures/local-migrations/savings-goals/c73bf68-v0.json'), 'utf8');
    await AsyncStorage.setItem(KEY, raw);
    // The gated storage runs the APP-040 v0 → v1 step on hydration, as at startup.
    await useSavingsGoalsStore.persist.rehydrate();
    expect(JSON.parse((await AsyncStorage.getItem(KEY))!).version).toBe(1);

    // Legacy IDs, deadlines and signed history survive as they were.
    expect(store().goals.map((g) => [g.id, g.savedAmount, g.deadline])).toEqual([
      ['7e6d5c4b-3a29-4180-9f8e-7d6c5b4a3928', 150_030, '2027-06-01'],
      ['1725206400000', 30, undefined],
      ['2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', 0, undefined],
    ]);
    expect(store().history.map((h) => h.amount)).toEqual([10, 20, 200_000, -49_970]);
    expectBalancesMatchHistory();

    await expectRefused(() => store().addContribution('1725206400000', m(-31)), 'savings_insufficient_balance');
    store().transferBetweenGoals('7e6d5c4b-3a29-4180-9f8e-7d6c5b4a3928', '1725206400000', m(30));
    expect(saved('1725206400000')).toBe(60);
    expectBalancesMatchHistory();
  });
});

// APP-043 needed no Savings format change. APP-052 makes the current overall format 6.
describe('APP-043 backup: no Savings format change, Savings round-trips exactly', () => {
  it('exports and re-imports goals with deadlines, overfunding, archive state and signed history', async () => {
    expect(BACKUP_VERSION).toBe(6);
    const a = store().addGoal({ name: 'A', targetAmount: m(1_000), icon: 'car', deadline: '2020-02-29' });
    const b = store().addGoal({ name: 'B', targetAmount: m(500_000), icon: 'home' });
    store().addContribution(a, m(2_500));
    store().transferBetweenGoals(a, b, m(1_000));
    store().addContribution(b, negateMinorUnits(m(400)));
    store().archiveGoal(a);
    store().addExtraSavings(m(99));
    const canonical = JSON.stringify([store().goals, store().history, store().extraSavings]);

    await exportBackup();
    const exported = JSON.parse(mockWritten);
    expect(exported.version).toBe(6);
    expect(exported.data.savingsGoals.goals.map((g: SavingsGoal) => [g.id, g.savedAmount, g.deadline])).toEqual([[a, 1_500, '2020-02-29'], [b, 600, undefined]]);

    useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
    mockFileContent = mockWritten;
    expect(await importBackup()).toMatchObject({ success: true });
    expect(JSON.stringify([store().goals, store().history, store().extraSavings])).toBe(canonical);
  });
});

describe('APP-043 remote hydration keeps its existing merge policy', () => {
  const ingress = (decimal: string) => JSON.parse(`{"v":${decimal}}`).v;

  it('appends unknown goals and history exactly as before — local copies win, nothing is filtered or repaired', async () => {
    const local: SavingsContribution = { id: 'h-local', goalId: 'local', amount: m(100), date: '2026-09-01T00:00:00.000Z' };
    useSavingsGoalsStore.setState({ goals: [goal('local', 100)], history: [local] });
    mockRemote.savings_goals = [
      { id: 'local', name: 'Remote copy', icon: 'other', target_amount: ingress('9.00'), saved_amount: ingress('9.00'), deadline: null, archived: false, created_at: '2026-09-01' },
      { id: 'remote', name: 'Remote', icon: 'travel', target_amount: ingress('100.00'), saved_amount: ingress('2.50'), deadline: '2027-06-01', archived: false, created_at: '2026-09-02' },
    ];
    // An orphan row (its goal is not in either snapshot) is merged as it always was.
    mockRemote.savings_history = [
      { id: 'h-remote', goal_id: 'remote', amount: ingress('2.50'), date: '2026-09-02T00:00:00.000Z' },
      { id: 'h-orphan', goal_id: 'deleted-elsewhere', amount: ingress('-1.00'), date: '2026-09-03T00:00:00.000Z' },
    ];
    await store().fetchFromSupabase();
    expect(store().goals.map((g) => [g.id, g.name, g.savedAmount, g.deadline])).toEqual([
      ['local', 'Synthetic local', 100, undefined],
      ['remote', 'Remote', 250, '2027-06-01'],
    ]);
    expect(store().history.map((h) => [h.id, h.goalId, h.amount])).toEqual([
      ['h-local', 'local', 100], ['h-remote', 'remote', 250], ['h-orphan', 'deleted-elsewhere', -100],
    ]);
  });

  it('still rejects the whole snapshot when one amount is not exact money', async () => {
    mockRemote.savings_goals = [{ id: 'g', name: 'G', icon: 'other', target_amount: ingress('100.00'), saved_amount: ingress('1.005'), deadline: null, archived: false, created_at: '2026-09-01' }];
    mockRemote.savings_history = [];
    await store().fetchFromSupabase();
    expect(store()).toMatchObject({ goals: [], history: [] });
  });
});
