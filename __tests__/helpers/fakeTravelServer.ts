/**
 * APP-059 review #1 test helper: a hand-written stand-in for the Travel/Economy
 * server boundary.
 *
 * It keeps the rows the Travel bridge touches and implements the APP-059 RPCs with
 * the migration's own rules. `link_trip_economy_expense` creates Economy plus link
 * once per (owner, expense id): an identical replay is the same expense, a changed
 * one is refused. `trip_financial_projection` answers only owners and accepted
 * participants. The real PostgreSQL behaviour, concurrent replays included, is
 * proved in tests/db/app059.test.cjs. This helper lets a Jest test drive the client
 * through answers that are lost AFTER the server committed, held back, or failed —
 * things a real socket cannot do on demand.
 *
 * Synthetic data only. Use it from a jest.mock factory:
 *   jest.mock('@/lib/supabase', () => ({ supabase: require('@/__tests__/helpers/fakeTravelServer').fakeSupabase }));
 */

type Row = Record<string, any>;
type Answer = { data: unknown; error: { message: string } | null };

const CATEGORIES = ['flight', 'accommodation', 'transport', 'food', 'activities', 'shopping', 'other'];

export type HeldProjection = {
  tripId: string;
  /** Delivers the answer the server computed when the request arrived. */
  deliver: () => void;
  /** The answer never makes it back: the client sees a network failure. */
  fail: () => void;
};

function freshServer() {
  return {
    /** The account the client's session belongs to; null = signed out. */
    user: null as string | null,
    trips: [] as Row[],
    participants: [] as Row[],
    /** Legacy `trip_expenses`. */
    tripExpenses: [] as Row[],
    packing: [] as Row[],
    /** Canonical `public.expenses`. */
    expenses: [] as Row[],
    /** Server-only `trip_expense_links`. */
    links: [] as Row[],
    /** Shared `attachments` rows (uploaded files). */
    attachments: [] as Row[],
    rpcCalls: [] as { name: string; args: Row }[],
    /** The next N link calls commit, then their answer is lost on the way back. */
    lostLinkAnswers: 0,
    /** The next N link calls commit, then the client call throws (a dropped connection). */
    thrownLinkAnswers: 0,
    /** Reads of these tables answer with an error (offline / refused). */
    failingTables: new Set<string>(),
    /** Reads of these tables throw. */
    throwingTables: new Set<string>(),
    /** Mutations of these tables answer with an error instead of committing. */
    failingWrites: new Set<string>(),
    /** Per-table mutation gates; the request identity is captured before waiting. */
    writeGates: new Map<string, Promise<void>>(),
    tableMutationCalls: [] as { table: string; operation: 'upsert' | 'delete'; user: string | null }[],
    /** Rows a read must not return yet (e.g. a replica that has not caught up). */
    hiddenRowIds: new Set<string>(),
    failProjection: false,
    /** When true, projection answers are computed on arrival and held until released. */
    holdProjections: false,
    heldProjections: [] as HeldProjection[],
    /** When set, every table read waits for it before answering. */
    readGate: null as Promise<void> | null,
    /** Per-table read gates: a read of that table waits for its gate. */
    tableGates: new Map<string, Promise<void>>(),
  };
}

export const server = freshServer();

type AuthListener = (event: string, session: unknown) => void;
const authListeners = new Set<AuthListener>();

export function resetServer(): void {
  Object.assign(server, freshServer());
  authListeners.clear();
}

/** A synthetic password-recovery access token for `userId` (see `auth.setSession`). */
export const recoveryAccessToken = (userId: string) => `synthetic-recovery-access:${userId}`;

const sessionFor = (userId: string | null) => (userId ? { access_token: 'synthetic', user: { id: userId } } : null);

const failure = (message: string): Answer => ({ data: null, error: { message } });

function cents(decimal: string): number {
  const [whole, fraction = ''] = decimal.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function canReadTrip(userId: string | null, tripId: string): boolean {
  const trip = server.trips.find((candidate) => candidate.id === tripId);
  if (!trip || !userId) return false;
  return trip.user_id === userId || server.participants.some((participant) =>
    participant.trip_id === tripId && participant.owner_id === trip.user_id
    && participant.user_id === userId && participant.status === 'accepted');
}

function linkTripEconomyExpense(args: Row): Answer {
  const uid = server.user;
  if (!uid) return failure('not_authenticated');
  if (args.p_expected_account_id !== uid) return failure('account_mismatch');
  const expenseId: unknown = args.p_expense_id;
  const legacyId: string | null = args.p_legacy_trip_expense_id ?? null;
  if (typeof expenseId !== 'string' || expenseId.trim() === '') return failure('expense_id_invalid');
  if (typeof args.p_name !== 'string' || args.p_name.trim() === '') return failure('expense_name_invalid');
  if (!args.p_transaction_date) return failure('transaction_date_required');
  if (typeof args.p_amount !== 'string' || !/^\d+(\.\d{1,2})?$/.test(args.p_amount)) return failure('money_unsupported_amount');
  if (!CATEGORIES.includes(args.p_travel_category)) return failure('travel_category_invalid');
  const fx = [args.p_currency, args.p_original_amount, args.p_exchange_rate].map((value) => value === null || value === undefined);
  if (fx.some((missing) => missing !== fx[0])) return failure('fx_metadata_invalid');
  if (legacyId !== null && legacyId !== expenseId) return failure('legacy_identity_mismatch');
  if (!canReadTrip(uid, args.p_trip_id)) return failure('trip_access_denied');
  if (legacyId !== null
    && server.tripExpenses.some((row) => row.trip_id === args.p_trip_id && row.id === legacyId && row.user_id !== uid)
    && !server.tripExpenses.some((row) => row.trip_id === args.p_trip_id && row.id === legacyId && row.user_id === uid)) {
    return failure('legacy_author_mismatch');
  }

  // Every check runs before any write, so a refusal changes nothing — like the transaction.
  const name = args.p_name.trim();
  const existing = server.expenses.find((row) => row.user_id === uid && row.id === expenseId);
  if (existing && (existing.name !== name || cents(existing.amount) !== cents(args.p_amount)
    || existing.category !== args.p_travel_category || existing.next_payment_date !== args.p_transaction_date)) {
    return failure('expense_identity_conflict');
  }
  const link = server.links.find((row) => row.expense_owner_id === uid && row.expense_id === expenseId);
  if (link && (link.trip_id !== args.p_trip_id || link.travel_category !== args.p_travel_category
    || link.legacy_trip_expense_id !== legacyId)) {
    return failure('expense_link_conflict');
  }
  if (!existing) {
    server.expenses.push({
      id: expenseId, user_id: uid, series_id: expenseId, is_recurring: false, recurrence_frequency: null,
      recurrence_anchor_day: null, name, amount: args.p_amount, category: args.p_travel_category,
      next_payment_date: args.p_transaction_date, created_at: '2026-10-05T10:00:00.000Z',
    });
  }
  if (!link) {
    server.links.push({
      trip_id: args.p_trip_id, expense_owner_id: uid, expense_id: expenseId, travel_category: args.p_travel_category,
      legacy_trip_expense_id: legacyId, currency: args.p_currency ?? null,
      original_amount: args.p_original_amount ?? null, exchange_rate: args.p_exchange_rate ?? null,
    });
  }
  if (legacyId !== null) {
    server.tripExpenses = server.tripExpenses.filter((row) =>
      !(row.user_id === uid && row.id === legacyId && row.trip_id === args.p_trip_id));
  }
  return { data: 'linked', error: null };
}

function projectionAnswer(tripId: string): Answer {
  if (!server.user) return failure('not_authenticated');
  if (!canReadTrip(server.user, tripId)) return { data: [], error: null };
  const rows = server.links.filter((link) => link.trip_id === tripId).flatMap((link) => {
    const expense = server.expenses.find((row) => row.user_id === link.expense_owner_id && row.id === link.expense_id);
    if (!expense) return [];
    return [{
      trip_id: link.trip_id, expense_owner_id: link.expense_owner_id, expense_id: link.expense_id,
      name: expense.name,
      // PostgREST renders numeric as a JSON number (APP-040).
      amount: Number(expense.amount),
      travel_category: link.travel_category, transaction_date: expense.next_payment_date,
      semantic: 'expense', status: 'booked', legacy_trip_expense_id: link.legacy_trip_expense_id,
      currency: link.currency, original_amount: link.original_amount, exchange_rate: link.exchange_rate,
    }];
  });
  return { data: rows, error: null };
}

/** The Economy expense is deleted by its owner; its link cascades (APP-059 FK). */
export function deleteEconomyExpense(userId: string, expenseId: string): void {
  server.expenses = server.expenses.filter((row) => !(row.user_id === userId && row.id === expenseId));
  server.links = server.links.filter((row) => !(row.expense_owner_id === userId && row.expense_id === expenseId));
}

function dependencyCounts(tripId: string) {
  return {
    expenses: server.tripExpenses.filter((row) => row.trip_id === tripId).length
      + server.links.filter((row) => row.trip_id === tripId).length,
    packing_items: server.packing.filter((row) => row.trip_id === tripId).length,
    participants: server.participants.filter((row) => row.trip_id === tripId).length,
    documents: 0,
  };
}

function rpc(name: string, args: Row): Promise<Answer> {
  server.rpcCalls.push({ name, args });
  if (name === 'link_trip_economy_expense') {
    const answer = linkTripEconomyExpense(args);
    if (answer.error === null && server.thrownLinkAnswers > 0) {
      server.thrownLinkAnswers -= 1;
      return Promise.reject(new Error('Network request failed'));
    }
    if (answer.error === null && server.lostLinkAnswers > 0) {
      server.lostLinkAnswers -= 1;
      return Promise.resolve(failure('Network request failed'));
    }
    return Promise.resolve(answer);
  }
  if (name === 'trip_financial_projection') {
    const answer = server.failProjection ? failure('offline') : projectionAnswer(args.p_trip_id);
    if (!server.holdProjections) return Promise.resolve(answer);
    return new Promise((resolve) => {
      server.heldProjections.push({
        tripId: args.p_trip_id,
        deliver: () => resolve(answer),
        fail: () => resolve(failure('Network request failed')),
      });
    });
  }
  if (name === 'trip_deletion_preview') {
    const trip = server.trips.find((row) => row.id === args.p_trip_id);
    if (!trip) return Promise.resolve({ data: { status: 'not-found' }, error: null });
    return Promise.resolve({ data: { status: 'ok', ...dependencyCounts(args.p_trip_id) }, error: null });
  }
  if (name === 'delete_trip_if_dependencies_match') {
    const tripId = args.p_trip_id;
    if (!server.trips.some((row) => row.id === tripId && row.user_id === server.user)) {
      return Promise.resolve({ data: { status: 'not-found' }, error: null });
    }
    const counts = dependencyCounts(tripId);
    if (counts.expenses !== args.p_expenses || counts.packing_items !== args.p_packing_items
      || counts.participants !== args.p_participants || counts.documents !== args.p_documents) {
      return Promise.resolve({ data: { status: 'changed', ...counts }, error: null });
    }
    server.trips = server.trips.filter((row) => row.id !== tripId);
    server.links = server.links.filter((row) => row.trip_id !== tripId);
    server.tripExpenses = server.tripExpenses.filter((row) => row.trip_id !== tripId);
    server.packing = server.packing.filter((row) => row.trip_id !== tripId);
    server.participants = server.participants.filter((row) => row.trip_id !== tripId);
    return Promise.resolve({ data: { status: 'deleted' }, error: null });
  }
  return Promise.resolve(failure(`unknown rpc ${name}`));
}

/** What the signed-in account may read from a table (the RLS policies, simplified). */
function readable(table: string, uid = server.user): Row[] {
  if (!uid) return [];
  switch (table) {
    case 'trips': return server.trips.filter((row) => canReadTrip(uid, row.id));
    case 'trip_participants': return server.participants.filter((row) => row.user_id === uid || row.owner_id === uid);
    case 'trip_expenses': return server.tripExpenses.filter((row) => canReadTrip(uid, row.trip_id));
    case 'trip_packing_items': return server.packing.filter((row) => canReadTrip(uid, row.trip_id));
    case 'expenses': return server.expenses.filter((row) => row.user_id === uid);
    case 'attachments': return server.attachments.filter((row) => row.user_id === uid);
    default: return [];
  }
}

const TABLE_ROWS: Record<string, 'trips' | 'participants' | 'tripExpenses' | 'packing' | 'expenses' | 'attachments'> = {
  trips: 'trips', trip_participants: 'participants', trip_expenses: 'tripExpenses',
  trip_packing_items: 'packing', expenses: 'expenses', attachments: 'attachments',
};

function from(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  let removing = false;
  const run = async (): Promise<Answer> => {
    const requestUser = server.user;
    if (removing) server.tableMutationCalls.push({ table, operation: 'delete', user: requestUser });
    if (server.readGate) await server.readGate;
    await (removing ? server.writeGates.get(table) : server.tableGates.get(table));
    if (server.throwingTables.has(table)) throw new Error('Network request failed');
    if (server.failingTables.has(table) || (removing && server.failingWrites.has(table))) return failure('offline');
    const matching = readable(table, requestUser).filter((row) => !server.hiddenRowIds.has(row.id) && filters.every((test) => test(row)));
    if (removing) {
      const key = TABLE_ROWS[table];
      if (key) server[key] = server[key].filter((row: Row) => !matching.includes(row));
      return { data: null, error: null };
    }
    return { data: matching.map((row) => ({ ...row })), error: null };
  };
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
    in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
    order: () => builder,
    then: <T>(resolve: (answer: Answer) => T, reject?: (error: unknown) => T) => run().then(resolve, reject),
  };
  return {
    select: () => builder,
    delete: () => { removing = true; return builder; },
    upsert: async (value: Row | Row[]) => {
      const requestUser = server.user;
      server.tableMutationCalls.push({ table, operation: 'upsert', user: requestUser });
      await server.writeGates.get(table);
      if (server.failingWrites.has(table)) return Promise.resolve(failure('offline'));
      const key = TABLE_ROWS[table];
      if (key) {
        for (const row of Array.isArray(value) ? value : [value]) {
          if (table === 'expenses' && row.user_id !== requestUser) return failure('row_level_security');
          server[key] = [...server[key].filter((existing: Row) => table === 'expenses'
            ? !(existing.id === row.id && existing.user_id === row.user_id)
            : existing.id !== row.id), { ...row }];
        }
      }
      return { data: null, error: null };
    },
  };
}

export const fakeSupabase = {
  auth: {
    getUser: () => Promise.resolve({ data: { user: server.user ? { id: server.user } : null }, error: null }),
    getSession: () => Promise.resolve({ data: { session: sessionFor(server.user) }, error: null }),
    onAuthStateChange: (listener: AuthListener) => {
      authListeners.add(listener);
      return { data: { subscription: { unsubscribe: () => authListeners.delete(listener) } } };
    },
    /**
     * Like supabase-js: switches the client to the session the tokens belong to and
     * tells every auth listener — without any local cleanup. A password-recovery link
     * for ANOTHER account therefore changes the signed-in account in place.
     */
    setSession: ({ access_token }: { access_token: string; refresh_token: string }) => {
      const userId = access_token.startsWith('synthetic-recovery-access:')
        ? access_token.slice('synthetic-recovery-access:'.length) : null;
      if (!userId) return Promise.resolve({ data: { session: null }, error: { message: 'invalid_token' } });
      server.user = userId;
      for (const listener of [...authListeners]) listener('SIGNED_IN', sessionFor(userId));
      return Promise.resolve({ data: { session: sessionFor(userId) }, error: null });
    },
  },
  rpc,
  from,
};

/** Lets every queued promise callback and timer-free continuation run. */
export async function settle(rounds = 25): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}
