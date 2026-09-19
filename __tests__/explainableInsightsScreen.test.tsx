import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

import i18n from '@/localization/i18n';

/**
 * APP-046 on screen: /economy/insights words the approved spending-change fact
 * for the two latest completed months, shows its data basis, and keeps the
 * three existing trends. See docs/app-046-explainable-insights.md.
 */

const mockWrites: { table: string; payload: unknown }[] = [];
jest.mock('@/lib/supabase', () => {
  const from = jest.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain, eq: () => chain, in: () => chain, delete: () => chain,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject),
      upsert: (payload: unknown) => { mockWrites.push({ table, payload }); return Promise.resolve({ error: null }); },
      insert: (payload: unknown) => { mockWrites.push({ table, payload }); return Promise.resolve({ error: null }); },
    });
    return chain;
  });
  // Signed in, so the materialization's upsert is really attempted.
  return { supabase: { from, auth: { getUser: () => Promise.resolve({ data: { user: { id: 'synthetic-user' } } }) } } };
});
jest.mock('@/utils/shared/attachmentSync', () => ({
  uploadAttachment: jest.fn(() => Promise.resolve(null)),
  deleteAttachmentRemote: jest.fn(() => Promise.resolve()),
  fetchAttachmentsFor: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
// The chart's data is what matters here; its SVG is not.
jest.mock('@/components/TrendLineChart', () => (props: object) => require('react').createElement('TrendLineChartMock', props));

import EconomyInsightsScreen from '@/app/economy/insights';
import type { RecurrenceFrequency } from '@/core/economy/recurrence';
import { minorUnits } from '@/core/money/minorUnits';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import type { Expense } from '@/types/expense';
import type { MonthlyPoint } from '@/utils/expense/economyInsights';

const m = minorUnits;
const kr = (amount: number) => m(amount * 100);
/** Wednesday 16 September 2026: the open month is September; July and August are compared. */
const NOW = '2026-09-16T12:00:00Z';

const oneTime = (id: string, amountKr: number, date: string): Expense => ({
  id, seriesId: id, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null,
  name: `Synthetic ${id}`, amount: kr(amountKr), category: 'other', nextPaymentDate: date,
  attachments: [], createdAt: `${date}T00:00:00.000Z`,
});
const recurring = (id: string, amountKr: number, date: string, frequency: RecurrenceFrequency): Expense => ({
  ...oneTime(id, amountKr, date), category: 'bill', isRecurring: true, recurrenceFrequency: frequency,
  recurrenceAnchorDay: Number(date.slice(8)),
});
/** August 5.200 kr. in two entries, July 4.000 kr. in one, and an open-month entry that must not be compared. */
const COMPARED = [
  oneTime('a1', 3_000, '2026-08-02'), oneTime('a2', 2_200, '2026-08-20'),
  oneTime('j1', 4_000, '2026-07-10'), oneTime('s1', 9_999, '2026-09-03'),
];

let tree: TestRenderer.ReactTestRenderer | undefined;
const plain = (value: string) => value.replace(/[  ]/g, ' ');
const t = (key: string) => plain(i18n.t(key));
const texts = () => tree!.root.findAllByType(Text).map((node) => plain([node.props.children].flat().join('')));
const SECTION_KEYS = ['economy.insights.changeTitle', 'economy.insights.basisTitle', 'economy.expenseTrendLabel',
  'economy.incomeTrendLabel', 'economy.savingsTrendLabel'];
/** The texts under one section label, up to the next; null when the section is absent. */
const sectionOf = (all: string[], key: string): string[] | null => {
  const labels = SECTION_KEYS.map(t);
  const start = all.indexOf(t(key));
  if (start < 0) return null;
  const end = all.findIndex((text, index) => index > start && labels.includes(text));
  return all.slice(start + 1, end < 0 ? undefined : end);
};
const section = (key: string) => sectionOf(texts(), key);
const charts = () => tree!.root.findAll((node) => (node.type as unknown) === 'TrendLineChartMock')
  .map((node) => node.props.data as MonthlyPoint[]);
/** A store or language change while a screen may be mounted. */
const update = (change: () => unknown) => act(async () => { await change(); });
const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function open() {
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(<EconomyInsightsScreen />); });
  await settle();
}
/** Like `open`, and records the visible texts of every commit, the first one included. */
async function openRecordingCommits(): Promise<string[][]> {
  const commits: string[][] = [];
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(<></>); });
  await act(async () => {
    tree!.update(<React.Profiler id="commits" onRender={() => { commits.push(texts()); }}><EconomyInsightsScreen /></React.Profiler>);
  });
  await settle();
  return commits;
}
const instancesIn = (month: string, seriesId: string) =>
  useExpensesStore.getState().expenses.filter((expense) => expense.seriesId === seriesId && expense.nextPaymentDate.startsWith(month));

beforeEach(async () => {
  jest.useFakeTimers({
    now: new Date(NOW),
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
      'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
      'hrtime', 'performance'],
  });
  await Promise.all([useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate(), useSavingsGoalsStore.persist.rehydrate()]);
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
  await i18n.changeLanguage('da');
  await settle();
  mockWrites.length = 0;
});
afterEach(async () => {
  act(() => { tree?.unmount(); });
  tree = undefined;
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  await settle();
  jest.useRealTimers();
});

describe('APP-046 spending change', () => {
  it('compares the two latest completed months, never the open one (da)', async () => {
    await update(() => useExpensesStore.setState({ expenses: COMPARED }));
    await open();
    expect(section('economy.insights.changeTitle')).toEqual([
      'Udgifter i august 2026',
      '5.200 kr.',
      '1.200 kr. højere end i juli 2026',
      'Udgifter i juli 2026',
      '4.000 kr.',
      '2 registrerede udgiftsposter i august 2026',
      '1 registreret udgiftspost i juli 2026',
    ]);
    // September, the open month, is not in the headline comparison.
    expect(section('economy.insights.changeTitle')!.join(' ')).not.toMatch(/september|9\.999/);
  });

  it('words the same facts in English', async () => {
    await update(() => useExpensesStore.setState({ expenses: COMPARED }));
    await update(() => i18n.changeLanguage('en'));
    await open();
    expect(section('economy.insights.changeTitle')).toEqual([
      'Spending in August 2026',
      'DKK 5,200',
      'DKK 1,200 higher than in July 2026',
      'Spending in July 2026',
      'DKK 4,000',
      '2 registered expense entries in August 2026',
      '1 registered expense entry in July 2026',
    ]);
  });

  it('says lower and unchanged in words', async () => {
    await update(() => useExpensesStore.setState({ expenses: [oneTime('a', 1_000, '2026-08-05'), oneTime('j', 1_750, '2026-07-05')] }));
    await open();
    expect(section('economy.insights.changeTitle')).toContain('750 kr. lavere end i juli 2026');

    await update(() => useExpensesStore.setState({ expenses: [oneTime('a', 900, '2026-08-05'), oneTime('j', 900, '2026-07-05')] }));
    await update(() => i18n.changeLanguage('en'));
    await open();
    expect(section('economy.insights.changeTitle')).toContain('Unchanged from July 2026');
  });

  it('carries direction in text only: higher and lower share one style, in the ordinary text colour', async () => {
    const styleOf = (text: string) => StyleSheet.flatten(
      tree!.root.findAllByType(Text).find((candidate) => plain([candidate.props.children].flat().join('')) === text)!.props.style);
    await update(() => useExpensesStore.setState({ expenses: [oneTime('a', 2_000, '2026-08-05'), oneTime('j', 1_000, '2026-07-05')] }));
    await open();
    const higher = styleOf('1.000 kr. højere end i juli 2026');
    const ordinary = styleOf('Udgifter i august 2026').color;
    await update(() => useExpensesStore.setState({ expenses: [oneTime('a', 1_000, '2026-08-05'), oneTime('j', 2_000, '2026-07-05')] }));
    await open();
    const lower = styleOf('1.000 kr. lavere end i juli 2026');
    expect(higher).toEqual(lower);
    expect(higher.color).toBe(ordinary);
  });

  it('shows an absolute difference from a month with nothing registered, and no percentage', async () => {
    await update(() => useExpensesStore.setState({ expenses: [oneTime('a', 1_000, '2026-08-05')] }));
    await open();
    expect(section('economy.insights.changeTitle')).toEqual([
      'Udgifter i august 2026',
      '1.000 kr.',
      '1.000 kr. højere end i juli 2026',
      'Udgifter i juli 2026',
      '0 kr.',
      '1 registreret udgiftspost i august 2026',
      '0 registrerede udgiftsposter i juli 2026',
    ]);
    expect(texts().join(' ')).not.toMatch(/%|procent|percent/i);
  });

  it('says there is no registered spending, not that nothing was spent', async () => {
    await update(() => useExpensesStore.setState({ expenses: [oneTime('open', 400, '2026-09-02')] }));
    await open();
    expect(section('economy.insights.changeTitle')).toEqual(['Ingen registrerede udgifter i juli 2026 eller august 2026.']);

    await update(() => i18n.changeLanguage('en'));
    await open();
    expect(section('economy.insights.changeTitle')).toEqual(['No registered spending in July 2026 or August 2026.']);
    // The data basis still explains what was looked at.
    expect(section('economy.insights.basisTitle')).toContain('July 2026 → August 2026');
  });

  it('is unaffected by income, missing or present', async () => {
    await update(() => useExpensesStore.setState({ expenses: COMPARED }));
    await open();
    const withoutIncome = [section('economy.insights.changeTitle'), section('economy.insights.basisTitle')];
    await update(() => useIncomeStore.setState({ incomeByMonth: { '2026-07': kr(30_000), '2026-08': kr(0), '2026-09': kr(31_000) } }));
    await open();
    expect([section('economy.insights.changeTitle'), section('economy.insights.basisTitle')]).toEqual(withoutIncome);
  });

  it('crosses the year boundary', async () => {
    jest.setSystemTime(new Date('2027-01-10T09:00:00Z'));
    await update(() => useExpensesStore.setState({ expenses: [oneTime('dec', 700, '2026-12-24'), oneTime('nov', 300, '2026-11-11')] }));
    await open();
    expect(section('economy.insights.changeTitle')!.slice(0, 3))
      .toEqual(['Udgifter i december 2026', '700 kr.', '400 kr. højere end i november 2026']);
    expect(section('economy.insights.basisTitle')).toContain('november 2026 → december 2026');
  });

  it('takes the open month from Copenhagen, not UTC', async () => {
    // 22:30 UTC on 31 August is 00:30 on 1 September in Copenhagen.
    jest.setSystemTime(new Date('2026-08-31T22:30:00Z'));
    await update(() => useExpensesStore.setState({ expenses: COMPARED }));
    await open();
    expect(section('economy.insights.changeTitle')![0]).toBe('Udgifter i august 2026');
  });
});

describe('APP-046 data basis', () => {
  it('shows the compared months, the source and that sync freshness is not available (da)', async () => {
    await update(() => useExpensesStore.setState({ expenses: COMPARED }));
    await open();
    expect(section('economy.insights.basisTitle')).toEqual([
      'Sammenligning', 'juli 2026 → august 2026',
      'Kilde', 'Registrerede økonomidata i LifeSort',
      'Synkronisering', 'Ikke tilgængelig endnu',
      'Hele kalendermåneder i dansk tid. Den igangværende måned, september 2026, indgår ikke.',
      'Tallene bygger på de udgifter, der er registreret for de to måneder.',
      'LifeSort kan endnu ikke vise, hvornår dine økonomidata sidst blev synkroniseret.',
    ]);
  });

  it('shows the same in English', async () => {
    await update(() => useExpensesStore.setState({ expenses: COMPARED }));
    await update(() => i18n.changeLanguage('en'));
    await open();
    expect(section('economy.insights.basisTitle')).toEqual([
      'Comparison', 'July 2026 → August 2026',
      'Source', 'Registered Economy data in LifeSort',
      'Sync freshness', 'Not available yet',
      'Whole calendar months in Danish time. The current month, September 2026, is not included.',
      'The figures are based on the expenses registered for these two months.',
      "LifeSort can't yet show when your Economy data was last synced.",
    ]);
  });

  it('claims no bank data, no sync time and no "through today" anywhere on the screen', async () => {
    for (const language of ['da', 'en']) {
      await update(() => useExpensesStore.setState({ expenses: COMPARED }));
      await update(() => i18n.changeLanguage(language));
      await open();
      expect(texts().join(' ')).not.toMatch(/bank|live|just now|lige nu|up to date|opdateret|i dag|today|so far|indtil nu|til dato/i);
    }
  });
});

describe('APP-046 keeps the existing trends', () => {
  it('still shows the expense, income and savings trends, each ending at the open month', async () => {
    await update(() => useExpensesStore.setState({ expenses: COMPARED }));
    await update(() => useIncomeStore.setState({ incomeByMonth: { '2026-09': kr(20_000) } }));
    await open();
    for (const key of ['economy.expenseTrendLabel', 'economy.incomeTrendLabel', 'economy.savingsTrendLabel']) {
      expect(section(key)).not.toBeNull();
    }
    const [expenseTrend, incomeTrend, savingsTrend] = charts();
    expect(charts()).toHaveLength(3);
    for (const trend of [expenseTrend, incomeTrend, savingsTrend]) {
      expect(trend.map((point) => point.monthKey)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    }
    const expenses = useExpensesStore.getState().expenses;
    expect(expenseTrend.map((point) => point.value)).toEqual(
      expenseTrend.map((point) => economyTotalsForMonth(expenses, {}, point.monthKey).settledSpending));
    expect(section('economy.incomeTrendLabel')).toEqual(['20.000 kr.']);
    expect(section('economy.savingsTrendLabel')).toEqual(['0 kr.']);
  });

  it("describes the open month's point as what is registered for it", async () => {
    await update(() => useExpensesStore.setState({ expenses: COMPARED }));
    await open();
    expect(section('economy.expenseTrendLabel')).toEqual(['9.999 kr. registreret for september 2026 (indeværende måned)']);
    await update(() => i18n.changeLanguage('en'));
    await open();
    expect(section('economy.expenseTrendLabel')).toEqual(['DKK 9,999 registered for September 2026 (current month)']);
  });
});

describe('APP-046 prepares the open month before showing its trend point', () => {
  const preparingTrend = () => [t('economy.preparingMonth')];
  const loadingChange = () => [t('economy.insights.loading')];

  it('a direct visit never shows the open month without its due recurring cost, and adds exactly one instance', async () => {
    // Rent was last materialized in July; neither August nor September has an instance.
    await update(() => useExpensesStore.setState({ expenses: [recurring('rent', 8_000, '2026-07-01', 'monthly'), oneTime('g', 500, '2026-08-12')] }));
    await update(() => useIncomeStore.setState({ incomeByMonth: { '2026-09': kr(20_000) } }));
    const commits = await openRecordingCommits();

    const ready = ['8.000 kr. registreret for september 2026 (indeværende måned)'];
    expect(sectionOf(commits[0], 'economy.expenseTrendLabel')).toEqual(preparingTrend());
    // An unread or unprepared store is never shown as "no registered spending".
    expect(sectionOf(commits[0], 'economy.insights.changeTitle')).toEqual(loadingChange());
    // Income needs no preparation and is shown from the first commit.
    expect(sectionOf(commits[0], 'economy.incomeTrendLabel')).toEqual(['20.000 kr.']);
    for (const commit of commits) {
      expect([preparingTrend(), ready]).toContainEqual(sectionOf(commit, 'economy.expenseTrendLabel'));
      expect(sectionOf(commit, 'economy.insights.changeTitle')!.join(' ')).not.toMatch(/Ingen registrerede/);
    }

    // One September instance; August, a compared month, is not reconstructed.
    expect(instancesIn('2026-09', 'rent').map((expense) => expense.nextPaymentDate)).toEqual(['2026-09-01']);
    expect(instancesIn('2026-08', 'rent')).toEqual([]);
    expect(section('economy.expenseTrendLabel')).toEqual(ready);
    expect(section('economy.insights.changeTitle')).toEqual([
      'Udgifter i august 2026', '500 kr.', '7.500 kr. lavere end i juli 2026', 'Udgifter i juli 2026', '8.000 kr.',
      '1 registreret udgiftspost i august 2026', '1 registreret udgiftspost i juli 2026',
    ]);
    // The only write is APP-042's upsert of that one instance.
    expect(mockWrites.filter((write) => write.table === 'expenses')).toHaveLength(1);
    expect(JSON.stringify(mockWrites[0].payload)).toContain('"next_payment_date":"2026-09-01"');

    // Settled: no further commit, pass or instance.
    commits.length = 0;
    await settle();
    expect(commits).toEqual([]);
    expect(instancesIn('2026-09', 'rent')).toHaveLength(1);
  });

  it('a later Expenses snapshot is prepared again before the open month is shown; income changes are not', async () => {
    await update(() => useExpensesStore.setState({ expenses: [oneTime('g', 500, '2026-09-05')] }));
    const commits = await openRecordingCommits();
    expect(section('economy.expenseTrendLabel')).toEqual(['500 kr. registreret for september 2026 (indeværende måned)']);

    // Such as the startup fetch bringing in an older series.
    commits.length = 0;
    await act(async () => {
      useExpensesStore.setState((state) => ({ expenses: [...state.expenses, recurring('gym', 300, '2026-06-15', 'monthly')] }));
    });
    await settle();
    expect(sectionOf(commits[0], 'economy.expenseTrendLabel')).toEqual(preparingTrend());
    expect(commits.map((commit) => sectionOf(commit, 'economy.expenseTrendLabel')![0]))
      .not.toContain('500 kr. registreret for september 2026 (indeværende måned)');
    expect(instancesIn('2026-09', 'gym')).toHaveLength(1);
    expect(section('economy.expenseTrendLabel')).toEqual(['800 kr. registreret for september 2026 (indeværende måned)']);

    commits.length = 0;
    await act(async () => { useIncomeStore.setState({ incomeByMonth: { '2026-09': kr(21_000) } }); });
    await settle();
    expect(commits.filter((commit) => commit.includes(t('economy.preparingMonth')))).toEqual([]);
    expect(section('economy.incomeTrendLabel')).toEqual(['21.000 kr.']);
  });
});
