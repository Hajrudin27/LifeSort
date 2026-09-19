/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import { BudgetPeriodError } from '@/core/dates/budgetPeriod';
import { MoneyError, minorUnits, type MinorUnits } from '@/core/money/minorUnits';
import { settledSpendingChange, type SpendingChangeFact } from '@/features/economy/explainableInsights';
import type { BankFinancialInput } from '@/features/economy/financialSources';
import * as monthlyTotals from '@/features/economy/monthlyTotals';
import type { Expense } from '@/types/expense';

import daEconomy from '@/localization/locales/da/economy.json';
import enEconomy from '@/localization/locales/en/economy.json';

/**
 * APP-046: the approved facts about the change in APP-039 settled spending
 * between the two latest completed Copenhagen budget months.
 * See docs/app-046-explainable-insights.md.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const m = minorUnits;
const kr = (amount: number) => m(amount * 100);
const CURRENT = '2026-09';

const expense = (id: string, amount: MinorUnits, date: string): Expense => ({
  id, seriesId: id, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null,
  name: `Synthetic ${id}`, amount, category: 'other', nextPaymentDate: date,
  attachments: [], createdAt: `${date}T00:00:00.000Z`,
});
const bank = (id: string, kind: BankFinancialInput['kind'], amountMinor: MinorUnits, date: string,
  status: BankFinancialInput['status'] = 'booked', correlationId?: string): BankFinancialInput =>
  ({ id, kind, amountMinor, currency: 'DKK', date, status, ...(correlationId ? { correlationId } : {}) });

const change = (fact: SpendingChangeFact) => {
  if (fact.kind !== 'settled-spending-change') throw new Error(`expected a change, got ${fact.kind}`);
  return fact;
};

afterEach(() => jest.restoreAllMocks());

describe('APP-046 settled spending change', () => {
  it('latest higher than previous: absolute difference, direction and counts', () => {
    const fact = change(settledSpendingChange({
      currentMonthKey: CURRENT,
      expenses: [expense('a1', kr(3_000), '2026-08-02'), expense('a2', kr(2_200), '2026-08-20'), expense('j1', kr(4_000), '2026-07-10')],
    }));
    expect(fact).toMatchObject({
      latest: { monthKey: '2026-08', settledSpending: kr(5_200), expenseCount: 2 },
      previous: { monthKey: '2026-07', settledSpending: kr(4_000), expenseCount: 1 },
      absoluteDelta: kr(1_200),
      direction: 'higher',
    });
  });

  it('latest lower than previous', () => {
    const fact = change(settledSpendingChange({
      currentMonthKey: CURRENT,
      expenses: [expense('a', kr(1_000), '2026-08-05'), expense('j', kr(1_750), '2026-07-05')],
    }));
    expect(fact).toMatchObject({ absoluteDelta: kr(750), direction: 'lower' });
  });

  it('equal registered spending is unchanged, with a zero difference', () => {
    const fact = change(settledSpendingChange({
      currentMonthKey: CURRENT,
      expenses: [expense('a', kr(900), '2026-08-05'), expense('j1', kr(400), '2026-07-05'), expense('j2', kr(500), '2026-07-06')],
    }));
    expect(fact).toMatchObject({ absoluteDelta: m(0), direction: 'unchanged', latest: { expenseCount: 1 }, previous: { expenseCount: 2 } });
  });

  it('a previous month with nothing registered still gives the absolute difference, with no percentage', () => {
    const fact = change(settledSpendingChange({ currentMonthKey: CURRENT, expenses: [expense('a', kr(1_000), '2026-08-05')] }));
    expect(fact).toMatchObject({
      previous: { monthKey: '2026-07', settledSpending: m(0), expenseCount: 0 },
      absoluteDelta: kr(1_000),
      direction: 'higher',
    });
    // Absolute change only: nothing in the fact is a ratio.
    expect(JSON.stringify(fact)).not.toMatch(/percent|ratio|share/i);
  });

  it('two silent months are "no registered spending", not a known zero', () => {
    const fact = settledSpendingChange({ currentMonthKey: CURRENT, expenses: [expense('open', kr(500), '2026-09-02')] });
    expect(fact.kind).toBe('no-registered-spending');
    expect(fact).not.toHaveProperty('direction');
    expect(fact).not.toHaveProperty('absoluteDelta');
    expect(fact).toMatchObject({ latest: { monthKey: '2026-08', expenseCount: 0 }, previous: { monthKey: '2026-07', expenseCount: 0 } });
  });

  it('registered entries that net to 0 kr. are a registered result, not silence', () => {
    const fact = change(settledSpendingChange({
      currentMonthKey: CURRENT,
      expenses: [expense('plus', kr(100), '2026-08-02'), expense('minus', kr(-100), '2026-08-03')],
    }));
    expect(fact).toMatchObject({ latest: { settledSpending: m(0), expenseCount: 2 }, direction: 'unchanged' });
  });

  it('keeps negative settled spending exactly, never clamped to zero', () => {
    const fact = change(settledSpendingChange({
      currentMonthKey: CURRENT,
      expenses: [expense('neg', kr(-300), '2026-08-02'), expense('j', kr(200), '2026-07-02')],
    }));
    expect(fact).toMatchObject({ latest: { settledSpending: kr(-300) }, absoluteDelta: kr(500), direction: 'lower' });
  });

  it('uses checked MinorUnits arithmetic: exact at the edge of the safe range, and fails closed beyond it', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const exact = change(settledSpendingChange({
      currentMonthKey: CURRENT,
      expenses: [expense('big', m(max), '2026-08-02'), expense('one', m(1), '2026-07-02')],
    }));
    expect(exact.absoluteDelta).toBe(max - 1);
    const oneOre = change(settledSpendingChange({
      currentMonthKey: CURRENT,
      expenses: [expense('a', m(100_001), '2026-08-02'), expense('j', m(100_000), '2026-07-02')],
    }));
    expect(oneOre).toMatchObject({ absoluteDelta: m(1), direction: 'higher' });

    const unsafe = () => settledSpendingChange({
      currentMonthKey: CURRENT,
      expenses: [expense('big', m(max), '2026-08-02'), expense('neg', m(-max), '2026-07-02')],
    });
    expect(unsafe).toThrow(MoneyError);
    expect(unsafe).toThrow('money_unsafe_arithmetic');
  });

  it('never compares the open month: an entry in it changes nothing', () => {
    const base = [expense('a', kr(1_000), '2026-08-05'), expense('j', kr(800), '2026-07-05')];
    const withOpen = [...base, expense('open', kr(99_999), '2026-09-01'), expense('open2', kr(5), '2026-09-30')];
    const fact = change(settledSpendingChange({ currentMonthKey: CURRENT, expenses: withOpen }));
    expect(fact.latest.monthKey).toBe('2026-08');
    expect(fact.previous.monthKey).toBe('2026-07');
    expect(fact.coverage.openMonthKey).toBe(CURRENT);
    expect(fact).toEqual(settledSpendingChange({ currentMonthKey: CURRENT, expenses: base }));
  });

  it('crosses the year boundary through the APP-045 month arithmetic', () => {
    const expenses = [expense('dec', kr(700), '2026-12-24'), expense('nov', kr(300), '2026-11-11'), expense('jan', kr(50), '2027-01-02')];
    expect(settledSpendingChange({ currentMonthKey: '2027-01', expenses })).toMatchObject({
      latest: { monthKey: '2026-12', settledSpending: kr(700) },
      previous: { monthKey: '2026-11', settledSpending: kr(300) },
      direction: 'higher',
    });
    expect(settledSpendingChange({ currentMonthKey: '2027-02', expenses })).toMatchObject({
      latest: { monthKey: '2027-01', settledSpending: kr(50) },
      previous: { monthKey: '2026-12', settledSpending: kr(700) },
      direction: 'lower',
    });
  });

  it('fails closed on an invalid month with the period service code', () => {
    expect(() => settledSpendingChange({ currentMonthKey: '2026-13', expenses: [] })).toThrow(BudgetPeriodError);
  });

  it('is deterministic and does not touch its input', () => {
    const expenses = Object.freeze([expense('a', kr(1_000), '2026-08-05'), expense('j', kr(800), '2026-07-05')].map((e) => Object.freeze(e)));
    const snapshot = JSON.stringify(expenses);
    const first = settledSpendingChange({ currentMonthKey: CURRENT, expenses });
    for (let i = 0; i < 5; i += 1) expect(settledSpendingChange({ currentMonthKey: CURRENT, expenses })).toEqual(first);
    expect(JSON.stringify(expenses)).toBe(snapshot);
  });

  it('does not read the clock: the same input gives the same fact at any instant', () => {
    const input = { currentMonthKey: CURRENT, expenses: [expense('a', kr(1_000), '2026-08-05')] };
    jest.useFakeTimers({ now: new Date('2026-09-01T00:00:00Z') });
    const early = settledSpendingChange(input);
    jest.setSystemTime(new Date('2031-03-30T01:30:00Z'));
    const late = settledSpendingChange(input);
    jest.useRealTimers();
    expect(late).toEqual(early);
  });

  it('states its source, coverage and sync freshness as typed facts', () => {
    const fact = settledSpendingChange({ currentMonthKey: CURRENT, expenses: [expense('a', kr(1_000), '2026-08-05')] });
    // Production: the user's registered records, no bank source (APP-041).
    expect(fact.source).toEqual({ kind: 'registered-economy-records', bankInputs: 'none' });
    expect(fact.coverage).toEqual({
      basis: 'completed-budget-months', timeZone: 'Europe/Copenhagen', openMonthKey: CURRENT, records: 'as-registered',
    });
    // No authoritative sync time exists, so none is invented.
    expect(fact.syncFreshness).toEqual({ status: 'not-available', reason: 'no-authoritative-sync-time' });
    expect(JSON.stringify(fact)).not.toMatch(/\d{4}-\d{2}-\d{2}T|syncedAt|updatedAt|createdAt/);
  });

  it('says so when bank inputs were supplied, and not otherwise', () => {
    const withBank = settledSpendingChange({
      currentMonthKey: CURRENT, expenses: [], bank: [bank('b', 'debit', kr(-10), '2026-08-01')],
    });
    expect(withBank.source).toEqual({ kind: 'registered-economy-records', bankInputs: 'supplied' });
    expect(settledSpendingChange({ currentMonthKey: CURRENT, expenses: [], bank: [] }).source.bankInputs).toBe('none');
  });
});

describe('APP-046 consumes APP-039, not another sum', () => {
  it('asks the APP-039 facade for exactly the two completed months, without income', () => {
    const facade = jest.spyOn(monthlyTotals, 'economyTotalsForMonth');
    const expenses = [expense('a', kr(1_000), '2026-08-05')];
    settledSpendingChange({ currentMonthKey: CURRENT, expenses });
    expect(facade.mock.calls).toEqual([
      [expenses, {}, '2026-08', []],
      [expenses, {}, '2026-07', []],
    ]);
  });

  it('reports exactly what the facade computed', () => {
    jest.spyOn(monthlyTotals, 'economyTotalsForMonth')
      .mockReturnValueOnce({ settledIncome: m(0), settledSpending: m(-12_345), balance: m(12_345), hasIncome: false, expenseCount: 7 })
      .mockReturnValueOnce({ settledIncome: m(0), settledSpending: m(4_321), balance: m(-4_321), hasIncome: false, expenseCount: 3 });
    // The raw Expenses would sum to something else entirely.
    const fact = change(settledSpendingChange({ currentMonthKey: CURRENT, expenses: [expense('a', kr(1), '2026-08-05')] }));
    expect(fact).toMatchObject({
      latest: { settledSpending: m(-12_345), expenseCount: 7 },
      previous: { settledSpending: m(4_321), expenseCount: 3 },
      absoluteDelta: m(16_666),
      direction: 'lower',
    });
  });

  /** Each case: the fact equals APP-039's own totals for both months, from the same sources. */
  const expectSameAsFacade = (expenses: Expense[], bankInputs: BankFinancialInput[]) => {
    const fact = settledSpendingChange({ currentMonthKey: CURRENT, expenses, bank: bankInputs });
    for (const month of [fact.latest, fact.previous]) {
      const totals = monthlyTotals.economyTotalsForMonth(expenses, {}, month.monthKey, bankInputs);
      expect(month).toEqual({ monthKey: month.monthKey, settledSpending: totals.settledSpending, expenseCount: totals.expenseCount });
    }
    return fact;
  };

  it('booked expenses count, from both sources', () => {
    const fact = expectSameAsFacade([expense('a', kr(1_000), '2026-08-05')], [bank('d', 'debit', kr(-250), '2026-08-06')]);
    expect(fact.latest).toMatchObject({ settledSpending: kr(1_250), expenseCount: 2 });
  });

  it('a refund reduces spending, and a refund-only month is negative, not silent', () => {
    const reduced = expectSameAsFacade([expense('a', kr(1_000), '2026-08-05')], [bank('r', 'refund', kr(300), '2026-08-09')]);
    expect(reduced.latest).toMatchObject({ settledSpending: kr(700), expenseCount: 1 });
    const refundOnly = expectSameAsFacade([], [bank('r', 'refund', kr(500), '2026-08-09')]);
    expect(refundOnly).toMatchObject({ kind: 'settled-spending-change', latest: { settledSpending: kr(-500), expenseCount: 0 }, direction: 'lower' });
  });

  it('a transfer is neutral', () => {
    const fact = expectSameAsFacade([expense('a', kr(1_000), '2026-08-05')], [bank('t', 'transfer', kr(-5_000), '2026-08-10')]);
    expect(fact.latest).toMatchObject({ settledSpending: kr(1_000), expenseCount: 1 });
  });

  it('a pending entry does not count until it is booked, and then counts once', () => {
    const pending = expectSameAsFacade([], [bank('p', 'debit', kr(-400), '2026-08-12', 'pending')]);
    expect(pending.kind).toBe('no-registered-spending');
    const booked = expectSameAsFacade([], [
      bank('p', 'debit', kr(-400), '2026-08-12', 'pending'), bank('p', 'debit', kr(-400), '2026-08-12', 'booked'),
    ]);
    expect(booked.latest).toMatchObject({ settledSpending: kr(400), expenseCount: 1 });
  });

  it('a repeated identity counts once', () => {
    const duplicate = expense('dup', kr(600), '2026-07-15');
    const fact = expectSameAsFacade([duplicate, duplicate, expense('a', kr(600), '2026-08-15')], []);
    expect(fact).toMatchObject({ previous: { settledSpending: kr(600), expenseCount: 1 }, direction: 'unchanged' });
  });

  it('no amount or date matching: an unlinked bank debit and an equal manual expense both count', () => {
    const fact = expectSameAsFacade([expense('m', kr(250), '2026-08-06')], [bank('d', 'debit', kr(-250), '2026-08-06')]);
    expect(fact.latest).toMatchObject({ settledSpending: kr(500), expenseCount: 2 });
  });

  it('explicit link evidence survives snapshots of one bank ID, which counts once, in its booked month', () => {
    // APP-046 takes Expenses, and the manual adapter never infers a link, so a
    // manual/bank pair cannot be expressed at this boundary (APP-039 covers it).
    const fact = expectSameAsFacade([], [
      bank('d', 'debit', kr(-250), '2026-07-30', 'pending', 'link-1'), bank('d', 'debit', kr(-250), '2026-08-01', 'booked'),
    ]);
    expect(fact).toMatchObject({ latest: { settledSpending: kr(250), expenseCount: 1 }, previous: { expenseCount: 0 } });
  });

  it("inherits APP-039's fail-closed validation", () => {
    expect(() => settledSpendingChange({
      currentMonthKey: CURRENT, expenses: [], bank: [{ ...bank('x', 'debit', kr(-1), '2026-08-01'), currency: 'EUR' }],
    })).toThrow('financial_currency_unsupported');
  });
});

describe('APP-046 purity', () => {
  const SOURCE = 'features/economy/explainableInsights.ts';
  const localImports = (file: string): string[] => {
    const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    return [...text.matchAll(/(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  };
  const resolve = (from: string, specifier: string): string | null => {
    const base = specifier.startsWith('@/') ? specifier.slice(2)
      : specifier.startsWith('.') ? path.join(path.dirname(from), specifier) : null;
    if (base === null) return null;
    return ['.ts', '.tsx', '/index.ts'].map((ext) => `${base}${ext}`).find((file) => fs.existsSync(path.join(REPO_ROOT, file))) ?? base;
  };

  it('imports only the period service, money, the APP-039 facade and types', () => {
    expect(localImports(SOURCE).sort()).toEqual([
      './financialSources', './monthlyTotals', '@/core/dates/budgetPeriod', '@/core/money/minorUnits', '@/types/expense',
    ]);
  });

  it('reaches no store, clock-dependent helper, storage, network, i18n or AI through its imports', () => {
    const seen = new Set<string>();
    const external = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const specifier of localImports(file)) {
        const target = resolve(file, specifier);
        if (target === null) external.add(specifier);
        else visit(target);
      }
    };
    visit(SOURCE);
    expect([...seen].sort()).toEqual([
      'core/dates/budgetPeriod.ts', 'core/economy/recurrence.ts', 'core/money/minorUnits.ts',
      'features/economy/explainableInsights.ts', 'features/economy/financialReadModel.ts',
      'features/economy/financialSources.ts', 'features/economy/monthlyTotals.ts',
      'types/attachment.ts', 'types/expense.ts', 'utils/shared/localDate.ts',
    ]);
    expect([...external]).toEqual([]);
  });

  it('has no clock, randomness, float parsing, logging or unchecked money arithmetic of its own', () => {
    const code = fs.readFileSync(path.join(REPO_ROOT, SOURCE), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const forbidden of [/\bDate\b/, /Math\./, /parseFloat|parseInt|Number\(/, /console\./, /toFixed/, /fetch\(/, /\bawait\b|\basync\b/]) {
      expect(code).not.toMatch(forbidden);
    }
  });
});

describe('APP-046 copy', () => {
  type Tree = { [key: string]: string | Tree };
  const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
    Object.fromEntries(Object.entries(tree).flatMap(([key, value]) =>
      typeof value === 'string' ? [[`${prefix}${key}`, value]] : Object.entries(flatten(value, `${prefix}${key}.`))));
  const insights = {
    da: flatten((daEconomy as unknown as { insights: Tree }).insights),
    en: flatten((enEconomy as unknown as { insights: Tree }).insights),
  };
  const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

  it('Danish and English have the same keys and placeholders', () => {
    expect(Object.keys(insights.da).sort()).toEqual(Object.keys(insights.en).sort());
    for (const key of Object.keys(insights.da)) expect([key, placeholders(insights.da[key])]).toEqual([key, placeholders(insights.en[key])]);
  });

  /** Whole words or phrases, with Unicode-aware edges so "Datagrundlag" is not "grund". */
  const phrase = (words: string) => new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'iu');
  const REJECTED: Record<string, RegExp[]> = {
    // Cause and inference.
    cause: ['because', 'caused', 'cause', 'due to', 'reason', 'why', 'driven by', 'fordi', 'skyldes', 'årsag\\p{L}*', 'grund(?:en)?', 'på grund af', 'derfor'].map(phrase),
    // Judgement.
    judgement: ['better', 'worse', 'good', 'bad', 'great', 'well done', 'healthy', 'unhealthy', 'overspend\\p{L}*', 'too much', 'bedre', 'værre', 'godt', 'dårlig\\p{L}*', 'flot', 'sund', 'usund', 'overforbrug', 'for meget'].map(phrase),
    // Advice and affordability.
    advice: ['should', 'need to', 'must', 'try', 'recommend\\p{L}*', 'advice', 'afford\\p{L}*', 'consider', 'bør', 'skal', 'prøv', 'anbefal\\p{L}*', 'råd', 'overvej', 'husk'].map(phrase),
    // Forecasts and ratios.
    forecast: ['forecast', 'predict\\p{L}*', 'next month', 'will', 'percent', 'prognose', 'forudsig\\p{L}*', 'næste måned', 'procent'].map(phrase).concat([/%/]),
    // Claims this data cannot back: live bank data, a sync time, "through today".
    claims: ['bank\\p{L}*', 'live', 'just now', 'up to date', 'synced \\d', 'today', 'so far', 'to date', 'lige nu', 'opdateret', 'i dag', 'indtil nu', 'til dato', 'hidtil'].map(phrase),
  };

  it.each(['da', 'en'] as const)('%s APP-046 copy states facts: no cause, judgement, advice, forecast or unbacked claim', (language) => {
    const offences = Object.entries(insights[language]).flatMap(([key, text]) =>
      Object.entries(REJECTED).flatMap(([kind, patterns]) =>
        patterns.filter((pattern) => pattern.test(text)).map((pattern) => `${key} (${kind}): ${pattern.source}`)));
    expect(offences).toEqual([]);
  });

  it('the guard is live: it catches a cause or a piece of advice slipped into the copy', () => {
    const catches = (text: string) => Object.values(REJECTED).flat().some((pattern) => pattern.test(text));
    expect(catches('Du brugte mere, fordi du havde flere udgifter.')).toBe(true);
    expect(catches('You should spend less next month.')).toBe(true);
    expect(catches('Datagrundlag')).toBe(false);
    expect(catches('1.200 kr. højere end i juli 2026')).toBe(false);
  });
});
