import { minorUnitsToServerNumeric, serverNumericToMinorUnits } from '@/core/money/serverNumeric';
import { supportedMoney } from '@/core/money/supportedMoney';
import { supabase } from '@/lib/supabase';
import { useExpensesStore } from '@/store/useExpensesStore';
import type { Attachment } from '@/types/attachment';
import type { TripExpenseCategory, TripFinancialProjection } from '@/types/trip';
import { parseCalendarDate } from '@/utils/shared/localDate';
import type { MinorUnits } from '@/core/money/minorUnits';

const CATEGORIES: ReadonlySet<string> = new Set([
  'flight', 'accommodation', 'transport', 'food', 'activities', 'shopping', 'other',
]);

type ProjectionRow = Record<string, unknown>;

function projectionFromRow(row: ProjectionRow): TripFinancialProjection {
  const category = row.travel_category;
  const semantic = row.semantic;
  const status = row.status;
  if (typeof row.trip_id !== 'string'
    || typeof row.expense_owner_id !== 'string'
    || typeof row.expense_id !== 'string'
    || typeof row.name !== 'string'
    || typeof row.transaction_date !== 'string'
    || parseCalendarDate(row.transaction_date) === null
    || typeof category !== 'string' || !CATEGORIES.has(category)
    || !['expense', 'income', 'transfer', 'refund'].includes(String(semantic))
    || !['pending', 'booked'].includes(String(status))) {
    throw new Error('travel_projection_invalid');
  }
  return {
    tripId: row.trip_id,
    expenseOwnerId: row.expense_owner_id,
    expenseId: row.expense_id,
    name: row.name,
    amount: supportedMoney(serverNumericToMinorUnits(row.amount)),
    category: category as TripExpenseCategory,
    transactionDate: row.transaction_date,
    semantic: semantic as TripFinancialProjection['semantic'],
    status: status as TripFinancialProjection['status'],
    ...(typeof row.legacy_trip_expense_id === 'string' ? { legacyTripExpenseId: row.legacy_trip_expense_id } : {}),
    ...(typeof row.currency === 'string' ? { currency: row.currency } : {}),
    ...(typeof row.original_amount === 'number' && Number.isFinite(row.original_amount)
      ? { originalAmount: row.original_amount } : {}),
    ...(typeof row.exchange_rate === 'number' && Number.isFinite(row.exchange_rate)
      ? { exchangeRate: row.exchange_rate } : {}),
  };
}

/** A complete authorized snapshot, or null. Partial/malformed answers are never cached. */
export async function fetchTripFinancialProjection(tripId: string): Promise<TripFinancialProjection[] | null> {
  try {
    const { data, error } = await supabase.rpc('trip_financial_projection', { p_trip_id: tripId });
    if (error || !Array.isArray(data)) return null;
    const result = data.map((row) => projectionFromRow(row as ProjectionRow));
    return result.every((row) => row.tripId === tripId) ? result : null;
  } catch {
    return null;
  }
}

export type LinkTripExpenseInput = {
  tripId: string;
  /** Account that owned the durable draft when this attempt began. */
  expectedAccountId: string;
  /**
   * The identity of ONE logical expense. Every retry of the same submission must
   * send the same id: the server treats an identical replay as the expense it
   * already has, so a lost answer can never turn into a second Economy expense.
   */
  expenseId: string;
  name: string;
  amount: MinorUnits;
  category: TripExpenseCategory;
  transactionDate: string;
  legacyTripExpenseId?: string;
  currency?: string;
  originalAmount?: number;
  exchangeRate?: number;
};

export type LinkTripExpenseResult = 'linked' | 'invalid' | 'failed';

/**
 * One RPC transaction creates the canonical Economy row and relationship, and
 * (for a resolved legacy row) removes only that matching legacy server row.
 * Legacy attachments are NOT part of it: see `handOffLegacyAttachments`.
 */
export async function linkTripExpense(input: LinkTripExpenseInput): Promise<LinkTripExpenseResult> {
  if (input.name.trim().length === 0 || parseCalendarDate(input.transactionDate) === null || input.amount < 0) {
    return 'invalid';
  }
  let amount: MinorUnits;
  try { amount = supportedMoney(input.amount); } catch { return 'invalid'; }
  try {
    const { data, error } = await supabase.rpc('link_trip_economy_expense', {
      p_trip_id: input.tripId,
      p_expected_account_id: input.expectedAccountId,
      p_expense_id: input.expenseId,
      p_name: input.name.trim(),
      p_amount: minorUnitsToServerNumeric(amount),
      p_travel_category: input.category,
      p_transaction_date: input.transactionDate,
      p_legacy_trip_expense_id: input.legacyTripExpenseId ?? null,
      p_currency: input.currency ?? null,
      p_original_amount: input.originalAmount ?? null,
      p_exchange_rate: input.exchangeRate ?? null,
    });
    if (error || data !== 'linked') return 'failed';

    // Economy owns its private records. Travel never writes into that store; this
    // adapter refreshes the canonical owner view after the server commit.
    try {
      await useExpensesStore.getState().fetchFromSupabase();
    } catch {
      // The server commit is authoritative. A failed private Economy refresh does
      // not turn that committed transaction into a failed Travel write.
    }
    return 'linked';
  } catch {
    return 'failed';
  }
}

/** True while an Economy record references this attachment; its file must not be deleted. */
export function economyReferencesAttachment(attachment: Pick<Attachment, 'id' | 'uri'>): boolean {
  return useExpensesStore.getState().expenses.some((expense) => expense.attachments.some((owned) =>
    owned.id === attachment.id || (!!attachment.uri && owned.uri === attachment.uri)));
}

export type LegacyAttachmentHandoff = 'durable' | 'pending';

/**
 * Hands a resolved legacy Travel expense's attachments to the canonical Economy
 * expense with the same id (APP-059 review #1).
 *
 * The legacy Travel row is the only record of those attachments until this returns
 * 'durable'. That needs four things in order: Economy has loaded, it holds the
 * resolved expense (refreshed from the server if not), every attachment is on that
 * expense, and Economy's own encrypted store has been written and read back with
 * them. Anything less returns 'pending', and the caller must keep the legacy row
 * exactly as it is. Calling it again is harmless: an attachment Economy already has
 * (by id) is never added twice.
 */
export async function handOffLegacyAttachments(
  expenseId: string,
  attachments: readonly Attachment[],
): Promise<LegacyAttachmentHandoff> {
  try {
    // A write into a store that has not finished loading would persist its empty
    // initial state. Not waiting: a failed hydration never finishes, and the next
    // refresh simply tries again.
    if (!useExpensesStore.persist.hasHydrated()) return 'pending';
    const holdsExpense = () => useExpensesStore.getState().expenses.some((expense) => expense.id === expenseId);
    if (!holdsExpense()) await useExpensesStore.getState().fetchFromSupabase();
    if (!holdsExpense()) return 'pending';
    useExpensesStore.setState((state) => ({
      expenses: state.expenses.map((expense) => expense.id === expenseId
        ? { ...expense, attachments: withAttachments(expense.attachments, attachments) }
        : expense),
    }));
    return (await persistedWithAttachments(expenseId, attachments)) ? 'durable' : 'pending';
  } catch {
    return 'pending';
  }
}

function withAttachments(owned: readonly Attachment[], incoming: readonly Attachment[]): Attachment[] {
  const ownedIds = new Set(owned.map((attachment) => attachment.id));
  return [...owned, ...incoming.filter((attachment) => !ownedIds.has(attachment.id))];
}

/**
 * Persist middleware writes are fire-and-forget, so their completion cannot be
 * awaited directly. This makes one awaited write of Economy's current state through
 * the store's own storage. Its migration-gated adapter serializes this key, so the
 * read-back is after every older snapshot and cannot later be overwritten by one.
 */
async function persistedWithAttachments(expenseId: string, attachments: readonly Attachment[]): Promise<boolean> {
  const { name, storage, version, partialize } = useExpensesStore.persist.getOptions();
  if (!name || !storage) return false;
  const state = useExpensesStore.getState();
  await storage.setItem(name, { state: partialize ? partialize(state) : state, version });
  const stored = await storage.getItem(name);
  const expenses: unknown = (stored?.state as { expenses?: unknown } | undefined)?.expenses;
  if (!Array.isArray(expenses)) return false;
  const saved = expenses.find((expense) => expense?.id === expenseId) as { attachments?: unknown } | undefined;
  const savedIds = new Set(Array.isArray(saved?.attachments)
    ? saved.attachments.map((attachment: { id?: unknown }) => attachment?.id)
    : []);
  return attachments.every((attachment) => savedIds.has(attachment.id));
}
