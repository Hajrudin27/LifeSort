/// <reference types="node" />

import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isWriteRoute, moduleForPath } from '@/core/modules/moduleRoutes';
import { minorUnits, type MinorUnits } from '@/core/money/minorUnits';
import { evaluatePurchaseImpact, purchaseAmountFromInput } from '@/features/economy/affordability';
import { financialTotalsForMonth } from '@/features/economy/financialReadModel';
import {
  bankFinancialEntries,
  manualExpenseEntries,
  manualIncomeEntries,
  type BankFinancialInput,
} from '@/features/economy/financialSources';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import { supabase } from '@/lib/supabase';
import daEconomy from '@/localization/locales/da/economy.json';
import enEconomy from '@/localization/locales/en/economy.json';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useFoodStore } from '@/store/useFoodStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import type { Expense } from '@/types/expense';

/**
 * APP-044 "Har jeg råd?": the impact of one hypothetical purchase on the current
 * plan. Every plan here comes from the production APP-039 read model, never a
 * hand-made total. See docs/app-044-purchase-impact.md.
 */

const m = minorUnits;
/** Whole kroner → øre, so fixtures read like the amounts in the story. */
const kr = (amount: number) => m(amount * 100);
const MONTH = '2026-09';

function expense(id: string, amountKr: number, date = `${MONTH}-10`): Expense {
  return {
    id, seriesId: id, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null,
    name: 'Synthetic', amount: kr(amountKr), category: 'other', nextPaymentDate: date,
    attachments: [], createdAt: `${date}T00:00:00.000Z`,
  };
}

/** The current plan as the screen gets it: the Economy facade over the production read model. */
function currentPlan(expenses: readonly Expense[], incomeKr?: number, bank: readonly BankFinancialInput[] = []) {
  return economyTotalsForMonth(expenses, incomeKr === undefined ? {} : { [MONTH]: kr(incomeKr) }, MONTH, bank);
}

/** The thrown error as a reviewer would see it: class, code and message. */
function failure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    const { name, code, message } = error as Error & { code?: string };
    return { name, code, message };
  }
  return null;
}

const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeEach(async () => {
  await Promise.all([
    useExpensesStore.persist.rehydrate(),
    useIncomeStore.persist.rehydrate(),
    useSavingsGoalsStore.persist.rehydrate(),
  ]);
  useExpensesStore.setState({ expenses: [], categoryBudgets: {}, seriesStoppedAt: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
  useFoodStore.setState({ monthlyBudgetByMonth: {}, purchases: [] });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('APP-044 the purchase impact on a known plan', () => {
  it('leaves money in the plan: 10.000 before, 2.000 purchase, 8.000 after', () => {
    const plan = currentPlan([expense('rent', 5_000)], 15_000);
    expect(plan.balance).toBe(kr(10_000));
    expect(evaluatePurchaseImpact(plan, kr(2_000))).toEqual({
      status: 'within-current-plan', purchaseAmount: kr(2_000), balanceBefore: kr(10_000), balanceAfter: kr(8_000),
    });
  });

  it('treats an exact zero as within the plan, with no warning threshold before it', () => {
    const plan = currentPlan([expense('rent', 5_000)], 7_500);
    expect(evaluatePurchaseImpact(plan, kr(2_500))).toEqual({
      status: 'within-current-plan', purchaseAmount: kr(2_500), balanceBefore: kr(2_500), balanceAfter: m(0),
    });
    // One øre more is below zero.
    expect(evaluatePurchaseImpact(plan, m(250_001))).toMatchObject({ status: 'over-current-plan', balanceAfter: -1 });
  });

  it('puts the plan below zero when the purchase is larger than what is left', () => {
    const plan = currentPlan([expense('rent', 9_000)], 10_000);
    expect(evaluatePurchaseImpact(plan, kr(1_500))).toEqual({
      status: 'over-current-plan', purchaseAmount: kr(1_500), balanceBefore: kr(1_000), balanceAfter: kr(-500),
    });
  });

  it('accepts a plan that is already below zero and only reports how far it would go', () => {
    const plan = currentPlan([expense('rent', 10_500)], 10_000);
    expect(plan.balance).toBe(kr(-500));
    expect(evaluatePurchaseImpact(plan, kr(500))).toEqual({
      status: 'over-current-plan', purchaseAmount: kr(500), balanceBefore: kr(-500), balanceAfter: kr(-1_000),
    });
  });

  it('keeps the whole income as the plan when nothing is spent', () => {
    const plan = currentPlan([], 20_000);
    expect(plan).toMatchObject({ settledSpending: 0, expenseCount: 0, hasIncome: true });
    expect(evaluatePurchaseImpact(plan, kr(2_000))).toEqual({
      status: 'within-current-plan', purchaseAmount: kr(2_000), balanceBefore: kr(20_000), balanceAfter: kr(18_000),
    });
  });

  it('reads no clock: the same plan and amount give the same result at any time', () => {
    const plan = Object.freeze(currentPlan([expense('rent', 5_000)], 15_000));
    jest.useFakeTimers({ now: new Date('2026-09-30T23:59:59') });
    const atMonthEnd = evaluatePurchaseImpact(plan, kr(2_000));
    jest.setSystemTime(new Date('2031-01-01T00:00:00'));
    expect(evaluatePurchaseImpact(plan, kr(2_000))).toEqual(atMonthEnd);
  });
});

describe('APP-044 missing income makes the plan incomplete', () => {
  it('calculates nothing and invents no income when this month has none registered', () => {
    const plan = currentPlan([expense('rent', 1_000)]);
    expect(plan.hasIncome).toBe(false);
    expect(evaluatePurchaseImpact(plan, kr(100))).toEqual({ status: 'plan-incomplete', purchaseAmount: kr(100) });

    // Income for another month does not make this month's plan known.
    const lastMonthOnly = economyTotalsForMonth([expense('rent', 1_000)], { '2026-08': kr(20_000) }, MONTH);
    expect(evaluatePurchaseImpact(lastMonthOnly, kr(100))).toEqual({ status: 'plan-incomplete', purchaseAmount: kr(100) });
  });

  it('treats a registered zero income as a known plan, following the existing hasIncome contract', () => {
    expect(evaluatePurchaseImpact(currentPlan([expense('rent', 1_000)], 0), kr(100))).toEqual({
      status: 'over-current-plan', purchaseAmount: kr(100), balanceBefore: kr(-1_000), balanceAfter: kr(-1_100),
    });
  });
});

describe('APP-044 the purchase amount', () => {
  it('rejects zero, negative and unsupported amounts with fixed, value-free codes', () => {
    for (const plan of [currentPlan([], 20_000), currentPlan([])]) {
      for (const amount of [0, -1, -200_000]) {
        expect(failure(() => evaluatePurchaseImpact(plan, amount as MinorUnits))).toEqual({
          name: 'PurchaseImpactError', code: 'purchase_amount_invalid', message: 'purchase_amount_invalid',
        });
      }
      // 8.589.934.592,01 kr. is APP-040's first unsupported positive amount.
      for (const amount of [2 ** 33 * 100 + 1, Number.MAX_SAFE_INTEGER, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(failure(() => evaluatePurchaseImpact(plan, amount as MinorUnits))).toEqual({
          name: 'MoneyError', code: 'money_unsupported_amount', message: 'money_unsupported_amount',
        });
      }
    }
    // The largest supported amount is a valid purchase.
    expect(evaluatePurchaseImpact(currentPlan([], 20_000), m(2 ** 33 * 100))).toMatchObject({ status: 'over-current-plan' });
  });

  it('fails closed on unsafe arithmetic instead of clamping or overflowing', () => {
    // A registered zero income and one extreme amount put the plan at the edge of the safe range.
    const plan = currentPlan([{ ...expense('edge', 0), amount: m(Number.MAX_SAFE_INTEGER) }], 0);
    expect(plan.balance).toBe(-Number.MAX_SAFE_INTEGER);
    expect(failure(() => evaluatePurchaseImpact(plan, m(1)))).toEqual({
      name: 'MoneyError', code: 'money_unsafe_arithmetic', message: 'money_unsafe_arithmetic',
    });
  });

  it('parses form text with the APP-040 parser, exactly and without floating point', () => {
    expect(purchaseAmountFromInput('2500')).toBe(250_000);
    expect(purchaseAmountFromInput('12,5')).toBe(1_250);
    expect(purchaseAmountFromInput('12.50')).toBe(1_250);
    expect(purchaseAmountFromInput(' 0,01 ')).toBe(1);
    expect(purchaseAmountFromInput('8589934592')).toBe(858_993_459_200);
  });

  it('gives no amount for empty, malformed, zero, negative, unsafe or unsupported text', () => {
    const rejected = ['', '   ', 'abc', '12abc', '1 000', '1.000,50', '12,345', '0', '0,00', '-5', '-0,01', '9'.repeat(20), '8589934592,01'];
    expect(rejected.filter((text) => purchaseAmountFromInput(text) !== null)).toEqual([]);
  });
});

describe('APP-044 inherits the APP-039 semantics of the current plan', () => {
  const INCOME = 20_000;
  const bank = (id: string, kind: BankFinancialInput['kind'], amountKr: number, extra: Partial<BankFinancialInput> = {}): BankFinancialInput =>
    ({ id, kind, amountMinor: kr(amountKr), currency: 'DKK', date: `${MONTH}-12`, status: 'booked', ...extra });

  it('a booked expense lowers the plan by exactly its amount', () => {
    expect(evaluatePurchaseImpact(currentPlan([], INCOME), kr(1_000))).toMatchObject({ balanceBefore: kr(20_000), balanceAfter: kr(19_000) });
    expect(evaluatePurchaseImpact(currentPlan([expense('rent', 6_000)], INCOME), kr(1_000)))
      .toMatchObject({ balanceBefore: kr(14_000), balanceAfter: kr(13_000) });
  });

  it('a refund reduces settled spending', () => {
    const plan = currentPlan([expense('rent', 6_000)], INCOME, [bank('refund-1', 'refund', 500)]);
    expect(plan.settledSpending).toBe(kr(5_500));
    expect(evaluatePurchaseImpact(plan, kr(1_000))).toMatchObject({ balanceBefore: kr(14_500), balanceAfter: kr(13_500) });
  });

  it('a transfer is not spending', () => {
    const withTransfer = currentPlan([expense('rent', 6_000)], INCOME, [bank('transfer-1', 'transfer', -3_000)]);
    expect(evaluatePurchaseImpact(withTransfer, kr(1_000)))
      .toEqual(evaluatePurchaseImpact(currentPlan([expense('rent', 6_000)], INCOME), kr(1_000)));
  });

  it('a pending bank debit is not settled spending', () => {
    const plan = currentPlan([], INCOME, [bank('pending-1', 'debit', -2_000, { status: 'pending' })]);
    expect(plan.settledSpending).toBe(0);
    expect(evaluatePurchaseImpact(plan, kr(1_000))).toMatchObject({ balanceBefore: kr(20_000), balanceAfter: kr(19_000) });
  });

  it('counts an explicitly linked manual and bank copy of one payment once, and a repeated snapshot once', () => {
    // APP-039: a caller with trusted link evidence enriches the manual entries and
    // passes them with the bank entries to the same core the facade uses.
    const linkedManual = manualExpenseEntries([expense('manual-rent', 6_000)]).map((entry) => ({ ...entry, correlationId: 'link-1' }));
    const plan = financialTotalsForMonth([
      ...linkedManual,
      ...manualIncomeEntries({ [MONTH]: kr(INCOME) }),
      ...bankFinancialEntries([bank('bank-rent', 'debit', -6_000, { correlationId: 'link-1' })]),
    ], MONTH);
    expect(plan.settledSpending).toBe(kr(6_000));
    expect(evaluatePurchaseImpact(plan, kr(1_000))).toMatchObject({ balanceBefore: kr(14_000), balanceAfter: kr(13_000) });

    const rent = expense('rent', 6_000);
    expect(evaluatePurchaseImpact(currentPlan([rent, rent], INCOME), kr(1_000))).toMatchObject({ balanceBefore: kr(14_000) });
  });

  it('works on manual Economy alone: no bank source, no session and no server request', () => {
    const from = jest.spyOn(supabase, 'from');
    useExpensesStore.getState().addExpense({
      name: 'Synthetic rent', amount: kr(6_000), category: 'bill', nextPaymentDate: `${MONTH}-01`, isRecurring: false, recurrenceFrequency: null,
    });
    useIncomeStore.getState().setIncomeForMonth(MONTH, kr(INCOME));
    const { expenses } = useExpensesStore.getState();
    const { incomeByMonth } = useIncomeStore.getState();
    const plan = economyTotalsForMonth(expenses, incomeByMonth, MONTH);
    expect(plan).toEqual(economyTotalsForMonth(expenses, incomeByMonth, MONTH, []));
    expect(evaluatePurchaseImpact(plan, kr(1_000))).toEqual({
      status: 'within-current-plan', purchaseAmount: kr(1_000), balanceBefore: kr(14_000), balanceAfter: kr(13_000),
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('savings goals, extra savings, category budgets and Food budgets do not change the plan', () => {
    useExpensesStore.setState({ expenses: [expense('rent', 6_000)] });
    useIncomeStore.setState({ incomeByMonth: { [MONTH]: kr(INCOME) } });
    const plan = () => economyTotalsForMonth(useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth, MONTH);
    const before = evaluatePurchaseImpact(plan(), kr(1_000));

    const goal = useSavingsGoalsStore.getState().addGoal({ name: 'Synthetic buffer', icon: 'other', targetAmount: kr(10_000) });
    useSavingsGoalsStore.getState().addContribution(goal, kr(4_000));
    useSavingsGoalsStore.getState().addExtraSavings(kr(750));
    useExpensesStore.getState().setCategoryBudget('other', kr(2_000));
    useFoodStore.setState({ monthlyBudgetByMonth: { [MONTH]: 4000 } });

    expect(evaluatePurchaseImpact(plan(), kr(1_000))).toEqual(before);
    expect(before).toMatchObject({ balanceBefore: kr(14_000), balanceAfter: kr(13_000) });
  });
});

describe('APP-044 evaluating a purchase has no side effects', () => {
  async function storage() {
    const keys = [...(await AsyncStorage.getAllKeys())].sort();
    return Object.fromEntries(await AsyncStorage.multiGet(keys));
  }

  it('adds no expense, changes no income or savings, writes no storage and calls no server', async () => {
    useExpensesStore.getState().addExpense({
      name: 'Synthetic rent', amount: kr(6_000), category: 'bill', nextPaymentDate: `${MONTH}-01`, isRecurring: false, recurrenceFrequency: null,
    });
    useIncomeStore.getState().setIncomeForMonth(MONTH, kr(20_000));
    const goal = useSavingsGoalsStore.getState().addGoal({ name: 'Synthetic buffer', icon: 'other', targetAmount: kr(10_000) });
    useSavingsGoalsStore.getState().addContribution(goal, kr(1_000));
    await flush();

    const state = () => JSON.stringify([
      useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth,
      useSavingsGoalsStore.getState().goals, useSavingsGoalsStore.getState().history, useSavingsGoalsStore.getState().extraSavings,
    ]);
    const stateBefore = state();
    const storageBefore = await storage();
    const from = jest.spyOn(supabase, 'from');

    const plan = economyTotalsForMonth(useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth, MONTH);
    for (const amount of [1, 100_000, 1_400_000, 2_000_000, 5_000_000]) evaluatePurchaseImpact(plan, m(amount));
    await flush();

    expect(state()).toBe(stateBefore);
    expect(await storage()).toEqual(storageBefore);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('APP-044 boundaries', () => {
  const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const importsOf = (file: string) => [...read(file).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

  it('the calculation is pure: money primitives and APP-039 types only, and no clock', () => {
    const outside = importsOf('features/economy/affordability.ts')
      .filter((specifier) => !specifier.startsWith('@/core/money/') && specifier !== './financialReadModel');
    expect(outside).toEqual([]);
    const code = read('features/economy/affordability.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bDate\b|\bperformance\b|Math\.random/);
  });

  it('the screen reads only the Economy expense and income stores: no savings, Food, server or storage client', () => {
    const imports = importsOf('app/economy/affordability.tsx');
    expect(imports.filter((specifier) => specifier.startsWith('@/store/')).sort()).toEqual(['@/store/useExpensesStore', '@/store/useIncomeStore']);
    expect(imports.filter((specifier) => /supabase|async-storage|secure-store/i.test(specifier))).toEqual([]);
  });

  it('belongs to the Economy module, and its path is not classified as a write route', () => {
    // Path classification only: opening the screen can still write through the
    // inherited APP-042 materialization (docs/app-044-purchase-impact.md, Maintenance).
    expect(moduleForPath('/economy/affordability')).toBe('economy');
    expect(isWriteRoute('/economy/affordability')).toBe(false);
  });
});

describe('APP-044 copy', () => {
  type Tree = { [key: string]: string | Tree };
  const leaves = (value: Tree, prefix = ''): [string, string][] => Object.entries(value).flatMap(([key, inner]) =>
    typeof inner === 'string' ? [[`${prefix}${key}`, inner] as [string, string]] : leaves(inner, `${prefix}${key}.`));
  const placeholders = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();

  it('Danish and English Economy copy have the same keys and the same placeholders', () => {
    const da = new Map(leaves(daEconomy as Tree));
    const en = new Map(leaves(enEconomy as Tree));
    expect([...en.keys()].sort()).toEqual([...da.keys()].sort());
    for (const [key, text] of da) expect([key, placeholders(en.get(key)!)]).toEqual([key, placeholders(text)]);
  });

  it('no APP-044 text gives a verdict, advice or a credit suggestion', () => {
    const verdicts = {
      en: /afford|safe to|\bshould\b|recommend|good purchase|bad purchase|take a loan|use (your )?credit|use your savings|instal+ments|you can(not|'t) (buy|spend)/i,
      da: /anbefal|\bbør\b|sikkert at|godt køb|dårligt køb|tag et lån|brug (din )?kredit|brug (din )?opsparing|afbetal|\bhar (ikke )?råd\b|kan (ikke )?købe/i,
    };
    expect(leaves(enEconomy.affordability as Tree).filter(([, text]) => verdicts.en.test(text))).toEqual([]);
    expect(leaves(daEconomy.affordability as Tree).filter(([, text]) => verdicts.da.test(text))).toEqual([]);
  });
});
