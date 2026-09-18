import { parseModuleFlags, resolveModuleAvailability } from '@/core/feature-flags/moduleFlags';
import { evaluateModuleAccess } from '@/core/modules/moduleAvailability';
import { getModule } from '@/core/modules/moduleRegistry';
import { isWriteRoute, moduleForPath } from '@/core/modules/moduleRoutes';
import { minorUnits } from '@/core/money/minorUnits';
import type { BankFinancialInput } from '@/features/economy/financialSources';
import { economyHomeSnapshot } from '@/features/economy/homeSnapshot';
import { economyMonthlyReview } from '@/features/economy/monthlyReview';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import { supabase } from '@/lib/supabase';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';

/**
 * APP-041: manual Economy is the baseline mode; banking is optional.
 * See docs/app-041-manual-economy.md.
 */
const m = minorUnits;
const MONTH = '2026-09';
const plain = (text: string | undefined) => text?.replace(/[\u00a0\u202f]/g, ' ');
const input = { name: 'Synthetic expense', amount: m(50_000), category: 'other', nextPaymentDate: '2026-09-10', isRecurring: false, recurrenceFrequency: null };
/** Current Economy routes covered by the manual-mode regression. */
const MANUAL_ECONOMY_ROUTES = [
  '/economy', '/economy/insights', '/expenses', '/expenses/new', '/expenses/edit/synthetic', '/expenses/income',
  '/expenses/upcoming', '/savings', '/savings/new', '/savings/synthetic', '/savings/allocate',
];

/** The same decision the route overlay (components/ModuleGate.tsx) makes. */
function blockedRoutes(serverRows: unknown): string[] {
  const overrides = parseModuleFlags(serverRows);
  return MANUAL_ECONOMY_ROUTES.filter((route) => {
    const access = evaluateModuleAccess(resolveModuleAvailability(moduleForPath(route), overrides));
    return !access.canOpenModule || (!access.canCreate && isWriteRoute(route));
  });
}

function totals(bank?: readonly BankFinancialInput[]) {
  const { expenses } = useExpensesStore.getState();
  const { incomeByMonth } = useIncomeStore.getState();
  return bank === undefined
    ? economyTotalsForMonth(expenses, incomeByMonth, MONTH)
    : economyTotalsForMonth(expenses, incomeByMonth, MONTH, bank);
}

beforeEach(async () => {
  await Promise.all([useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate(), useSavingsGoalsStore.persist.rehydrate()]);
  useExpensesStore.setState({ expenses: [], categoryBudgets: {}, seriesStoppedAt: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-13T12:00:00Z'));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('APP-041 the Economy module is not a bank capability', () => {
  it('is available with full create/edit access and no bank_sync entitlement', () => {
    const economy = getModule('economy');
    expect(economy.availability).toBe('available');
    expect(economy.requiredEntitlements ?? []).not.toContain('bank_sync');
    expect(evaluateModuleAccess(economy.availability)).toMatchObject({ canOpenModule: true, canCreate: true, canEdit: true, status: 'active' });
    expect(blockedRoutes([])).toEqual([]);
  });

  it('unknown bank-specific module rows cannot close manual Economy in this app version', () => {
    // These IDs are intentionally unknown to the current module registry.
    // This guards module-level independence; it is not an OB-004 kill-switch test.
    const bankingRows = ['bank_sync', 'bank', 'banking', 'open-banking'].flatMap((id) =>
      ['hidden', 'maintenance', 'retired'].map((availability) => ({ module_id: id, availability })),
    );
    expect(blockedRoutes(bankingRows)).toEqual([]);
    expect(resolveModuleAvailability('economy', parseModuleFlags(bankingRows))).toBe('available');
  });

  it('control: the economy module switch is module-wide, so it must never be used as the bank switch', () => {
    // Proves the checks above can fail: this is what reusing `economy` for banking would do.
    expect(blockedRoutes([{ module_id: 'economy', availability: 'hidden' }])).toEqual(MANUAL_ECONOMY_ROUTES);
    expect(blockedRoutes([{ module_id: 'economy', availability: 'maintenance' }])).toEqual(
      MANUAL_ECONOMY_ROUTES.filter(isWriteRoute),
    );
  });
});

describe('APP-041 the read model treats zero bank inputs as a complete production state', () => {
  const bankOnly: BankFinancialInput[] = [
    { id: 'synthetic-debit', kind: 'debit', amountMinor: m(-7_500), currency: 'DKK', date: '2026-09-05', status: 'booked' },
    { id: 'synthetic-credit', kind: 'credit', amountMinor: m(12_000), currency: 'DKK', date: '2026-09-06', status: 'booked' },
  ];

  it('an omitted bank argument equals an explicitly empty bank source', () => {
    useExpensesStore.getState().addExpense(input);
    useIncomeStore.getState().setIncomeForMonth(MONTH, m(200_000));
    expect(totals()).toEqual(totals([]));
    expect(totals()).toMatchObject({ settledSpending: 50_000, settledIncome: 200_000, balance: 150_000, expenseCount: 1 });
  });

  it('turning an unavailable bank source off removes only bank facts; manual facts stay exactly as they were', () => {
    useExpensesStore.getState().addExpense(input);
    useIncomeStore.getState().setIncomeForMonth(MONTH, m(200_000));
    const manualOnly = totals();
    expect(totals(bankOnly)).toMatchObject({ settledSpending: 57_500, settledIncome: 212_000 });
    // Bank disabled → the source supplies nothing, and Economy is back to its manual baseline.
    expect(totals([])).toEqual(manualOnly);
  });
});

describe('APP-041 manual Economy flow with no bank, no session and no server', () => {
  it('create, edit, delete, income and savings all work and feed Home and the monthly review', async () => {
    const from = jest.spyOn(supabase, 'from');
    // Before any data: consumers initialise without a bank source or connection state.
    expect(plain((await economyHomeSnapshot())?.value)).toBe('0 kr.');
    expect(await economyMonthlyReview(MONTH)).toEqual([]);

    const id = useExpensesStore.getState().addExpense(input);
    expect(totals()).toMatchObject({ settledSpending: 50_000, balance: -50_000 });
    useExpensesStore.getState().updateExpense(id, { amount: m(20_050) });
    expect(totals()).toMatchObject({ settledSpending: 20_050, balance: -20_050 });
    useIncomeStore.getState().setIncomeForMonth(MONTH, m(200_000));
    expect(totals()).toMatchObject({ settledIncome: 200_000, balance: 179_950 });

    // Savings: goals, contributions, transfers and extra savings stay outside income/spending.
    const g1 = useSavingsGoalsStore.getState().addGoal({ name: 'Synthetic reserve', icon: 'other', targetAmount: m(100_000) });
    const g2 = useSavingsGoalsStore.getState().addGoal({ name: 'Synthetic goal', icon: 'other', targetAmount: m(100_000) });
    useSavingsGoalsStore.getState().addContribution(g1, m(30_000));
    useSavingsGoalsStore.getState().transferBetweenGoals(g1, g2, m(10_000));
    useSavingsGoalsStore.getState().addExtraSavings(m(5_000));
    expect(useSavingsGoalsStore.getState().goals.map((goal) => goal.savedAmount)).toEqual([20_000, 10_000]);
    expect(useSavingsGoalsStore.getState().extraSavings).toBe(5_000);
    expect(totals()).toMatchObject({ settledSpending: 20_050, settledIncome: 200_000, balance: 179_950, expenseCount: 1 });

    expect(await economyHomeSnapshot()).toMatchObject({ helperParams: { percent: 15 }, moduleId: 'economy' });
    expect(plain((await economyHomeSnapshot())?.value)).toBe('1.799,50 kr.');
    expect((await economyMonthlyReview(MONTH)).map((fact) => [fact.labelKey, plain(fact.params?.amount as string)])).toEqual([
      ['review.economySpent', '200,50 kr.'],
      ['review.economyIncome', '2.000 kr.'],
      ['review.economySaved', '300 kr.'],
    ]);

    useExpensesStore.getState().removeExpense(id);
    expect(totals()).toMatchObject({ settledSpending: 0, expenseCount: 0, balance: 200_000 });
    expect(plain((await economyHomeSnapshot())?.value)).toBe('2.000 kr.');

    // Signed out: nothing above needed a server request, let alone a bank or provider one.
    expect(from).not.toHaveBeenCalled();
  });
});
