import {
  addMinorUnits,
  isMinorUnits,
  subtractMinorUnits,
  ZERO_MINOR_UNITS,
  type MinorUnits,
} from '@/core/money/minorUnits';

/** APP-039: derived, account-scoped inputs only. Never persist these entries. */
export type FinancialSource =
  | { readonly kind: 'manual'; readonly representation: 'transaction'; readonly id: string }
  | { readonly kind: 'manual'; readonly representation: 'monthly-aggregate'; readonly monthKey: string }
  | { readonly kind: 'bank'; readonly representation: 'transaction'; readonly id: string };

export type FinancialSemantic = 'expense' | 'income' | 'transfer' | 'refund';

export type FinancialTransaction = {
  readonly source: Extract<FinancialSource, { representation: 'transaction' }>;
  readonly semantic: FinancialSemantic;
  /** DKK MinorUnits (APP-040). Expenses retain existing manual sign semantics. */
  readonly amount: MinorUnits;
  readonly currency: 'DKK';
  readonly date: string;
  readonly status: 'pending' | 'booked';
  /** Explicit one-to-one manual/bank economic identity, supplied by the caller. */
  readonly correlationId?: string;
};

export type ManualMonthlyIncome = {
  readonly source: Extract<FinancialSource, { representation: 'monthly-aggregate' }>;
  readonly semantic: 'income';
  /** DKK MinorUnits (APP-040). */
  readonly amount: MinorUnits;
  readonly currency: 'DKK';
  // A monthly aggregate cannot identify an individual bank credit.
  readonly correlationId?: never;
};

export type FinancialEntry = FinancialTransaction | ManualMonthlyIncome;

/** All money fields are DKK MinorUnits, summed with checked integer arithmetic. */
export type FinancialMonthlyTotals = {
  readonly settledIncome: MinorUnits;
  readonly settledSpending: MinorUnits;
  readonly balance: MinorUnits;
  readonly hasIncome: boolean;
  readonly expenseCount: number;
};

function isTransaction(entry: FinancialEntry): entry is FinancialTransaction {
  return entry.source.representation === 'transaction';
}

function stableIdentity(entry: FinancialEntry): string {
  const source = entry.source;
  // Tuple encoding keeps both source and representation namespaces separate.
  return source.representation === 'transaction'
    ? JSON.stringify([source.kind, source.representation, source.id])
    : JSON.stringify([source.kind, source.representation, source.monthKey]);
}

function sameFacts(a: FinancialEntry, b: FinancialEntry): boolean {
  if (a.amount !== b.amount || a.semantic !== b.semantic) return false;
  if (isTransaction(a) && isTransaction(b)) return a.date === b.date && a.status === b.status;
  return !isTransaction(a) && !isTransaction(b);
}

function resolveIdentity(copies: readonly FinancialEntry[]): FinancialEntry {
  const booked = copies.filter((entry) => isTransaction(entry) && entry.status === 'booked');
  // Consider all copies before resolving conflicts: obsolete pending snapshots
  // must not cause an order-dependent failure when a booked snapshot is present.
  const candidates = booked.length > 0 ? booked : copies;
  const selected = candidates[0];
  if (candidates.some((entry) => !sameFacts(selected, entry))) {
    // No revisions exist at this boundary. Do not guess which conflicting copy is newer.
    throw new Error('financial_identity_conflict');
  }
  const links = new Set(copies.flatMap((entry) => entry.correlationId === undefined ? [] : [entry.correlationId]));
  if (links.size > 1) throw new Error('financial_identity_conflict');
  // Keep explicit link evidence across snapshots of the same stable identity.
  return isTransaction(selected) ? { ...selected, correlationId: [...links][0] } : selected;
}

function reconcile(entries: readonly FinancialEntry[]): FinancialEntry[] {
  const identities = new Map<string, FinancialEntry[]>();
  for (const entry of entries) {
    if (entry.currency !== 'DKK') throw new Error('financial_currency_unsupported');
    if (!isMinorUnits(entry.amount)) throw new Error('financial_amount_invalid');
    if (entry.semantic === 'refund' && entry.amount < 0) throw new Error('financial_amount_invalid');
    if (entry.correlationId !== undefined && entry.correlationId.trim().length === 0) {
      throw new Error('financial_correlation_invalid');
    }
    const key = stableIdentity(entry);
    const copies = identities.get(key) ?? [];
    copies.push(entry);
    identities.set(key, copies);
  }

  const uniqueEntries = [...identities.values()].map(resolveIdentity);
  const correlations = new Map<string, { manual: FinancialTransaction[]; bank: FinancialTransaction[] }>();
  for (const entry of uniqueEntries) {
    if (!isTransaction(entry) || entry.correlationId === undefined) continue;
    const group = correlations.get(entry.correlationId) ?? { manual: [], bank: [] };
    group[entry.source.kind].push(entry);
    correlations.set(entry.correlationId, group);
  }
  const replacedManual = new Set<FinancialEntry>();
  for (const group of correlations.values()) {
    // Correlation alone does not collapse different IDs within one source.
    if (group.manual.length === 0 || group.bank.length === 0) continue;
    if (group.manual.length !== 1 || group.bank.length !== 1) {
      throw new Error('financial_correlation_ambiguous');
    }
    // Bank facts are authoritative, including a pending status or a different date.
    replacedManual.add(group.manual[0]);
  }
  return uniqueEntries.filter((entry) => !replacedManual.has(entry));
}

/**
 * Reconcile before selecting the month so a pending or manually dated copy cannot
 * reappear in another month. Uses Economy's existing ISO-prefix month semantics.
 * Caller supplies one account's current snapshots; no auth, storage or clock reads.
 */
export function financialTotalsForMonth(
  entries: readonly FinancialEntry[],
  monthKey: string,
): FinancialMonthlyTotals {
  let settledIncome = ZERO_MINOR_UNITS;
  let settledSpending = ZERO_MINOR_UNITS;
  let hasIncome = false;
  let expenseCount = 0;

  for (const entry of reconcile(entries)) {
    if (isTransaction(entry)) {
      if (entry.status !== 'booked' || entry.date.slice(0, 7) !== monthKey) continue;
    } else if (entry.source.monthKey !== monthKey) continue;

    switch (entry.semantic) {
      case 'income':
        settledIncome = addMinorUnits(settledIncome, entry.amount);
        hasIncome = true;
        break;
      case 'expense':
        settledSpending = addMinorUnits(settledSpending, entry.amount);
        expenseCount += 1;
        break;
      case 'refund':
        settledSpending = subtractMinorUnits(settledSpending, entry.amount);
        break;
      case 'transfer':
        break;
    }
  }
  return {
    settledIncome,
    settledSpending,
    balance: subtractMinorUnits(settledIncome, settledSpending),
    hasIncome,
    expenseCount,
  };
}
