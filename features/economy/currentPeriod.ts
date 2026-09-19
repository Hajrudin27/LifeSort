import { useEffect, useState } from 'react';

import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import type { Expense } from '@/types/expense';

/**
 * APP-045: the one path by which a current Economy surface prepares its month.
 *
 * A recurring cost due this month is an Expense only once APP-042's
 * `rollForwardMonth` has materialized the month, so the current total must not
 * depend on which screen the user happened to open first. The Economy tab,
 * Home's Economy card, APP-044 and the Insights screen (APP-046) prepare
 * through here. The totals themselves
 * stay the pure APP-039 read model, and historical month browsing (the Expenses
 * overview) keeps its own call.
 *
 * Nothing here is new recurrence logic: current month only, idempotent, and the
 * APP-042 cadence, anchor and stop rules apply unchanged.
 */

/**
 * Waits until Expenses and Income are read from disk (APP-014), then
 * materializes `monthKey`, unless `stillWanted` says the caller moved on.
 * Resolves with the Expenses array that pass left behind, or null when it did
 * not run.
 */
async function prepareMonthSnapshot(monthKey: string, stillWanted: () => boolean): Promise<readonly Expense[] | null> {
  await whenStoresHydrated([useExpensesStore, useIncomeStore]);
  if (!stillWanted()) return null;
  useExpensesStore.getState().rollForwardMonth(monthKey);
  // Read in the same tick: a pass that creates an instance leaves a new array,
  // and a no-op pass leaves the one it was given.
  return useExpensesStore.getState().expenses;
}

/** Resolves true when the month was prepared. */
export async function prepareEconomyMonth(monthKey: string, stillWanted: () => boolean = () => true): Promise<boolean> {
  return (await prepareMonthSnapshot(monthKey, stillWanted)) !== null;
}

type PreparedSnapshot = { readonly monthKey: string; readonly expenses: readonly Expense[] };

/**
 * For a mounted screen: prepares `monthKey`, and again whenever the Expenses
 * change, because the startup fetch is not awaited and can bring a series in
 * later (APP-044). Nothing else is a dependency, so income changes and unrelated
 * state such as a typed amount never trigger a pass.
 *
 * True only while the Expenses the screen currently reads are exactly the array
 * a pass for `monthKey` produced. A new month or a new Expenses array is not
 * ready on the very render that observes it, before any effect has run, so a
 * plan that may still lack a due instance is never presented as final.
 */
export function usePreparedEconomyMonth(monthKey: string): boolean {
  const expenses = useExpensesStore((s) => s.expenses);
  const [prepared, setPrepared] = useState<PreparedSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    void prepareMonthSnapshot(monthKey, () => active).then((result) => {
      if (result === null) return;
      // Keep the same object when nothing changed, so a no-op pass settles.
      setPrepared((current) =>
        current?.monthKey === monthKey && current.expenses === result ? current : { monthKey, expenses: result });
    });
    return () => {
      active = false;
    };
  }, [monthKey, expenses]);

  return prepared?.monthKey === monthKey && prepared.expenses === expenses;
}
