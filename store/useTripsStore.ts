import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import { legacyMajorUnitsToMinorUnits } from '@/core/money/legacyMajorUnits';
import { minorUnitsToServerNumeric, serverNumericToMinorUnits } from '@/core/money/serverNumeric';
import { supportedMoney } from '@/core/money/supportedMoney';
import type { MinorUnits } from '@/core/money/minorUnits';
import {
  economyReferencesAttachment,
  fetchTripFinancialProjection,
  handOffLegacyAttachments,
  linkTripExpense,
} from '@/features/economy/travelFinancialBridge';
import { canResolveLegacyTripExpense } from '@/features/travel/financialReadContract';
import { registerEconomyMutationInvalidation } from '@/features/travel/economyMutationInvalidation';
import {
  copyPackingTemplate,
  isPackingTemplateApplied,
  type PackingTemplateIdentity,
  type ResolvedPackingTemplate,
} from '@/features/travel/packingTemplates';
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { documentMetadataEncryptedStorage } from "@/core/storage/documentCacheStorage";
import { supabase } from "@/lib/supabase";
import { trackSync } from '@/store/useSyncStatusStore';
import { Attachment } from "@/types/attachment";
import {
  AppliedPackingTemplate,
  PackingCategory,
  PackingItem,
  Trip,
  TripExpense,
  TripExpenseCategory,
  TripFinancialProjection,
  PendingTripExpenseDraft,
  TripParticipant,
} from "@/types/trip";
import { normalizeDestination, tripProblem } from "@/utils/trip/tripDomain";
import { deleteTripRemote, fetchTripDeletionPreview, type TripDeleteResult, type TripDependencyCounts } from "@/utils/trip/tripRemote";
import { isTripGone, markTripGone, runInTripLane } from "@/utils/trip/tripWriteLane";
import { cleanupAttachments, deleteCachedAttachmentFile } from "@/utils/shared/attachmentStorage";
import {
  cancelTripPackingReminder,
  scheduleTripPackingReminder,
} from "@/utils/trip/tripReminder";
import { parseCalendarDate } from '@/utils/shared/localDate';

/** How one explicit legacy resolution ended (APP-059). */
export type LegacyResolutionResult =
  /** The server resolved it and Economy durably owns its attachments; the legacy row is gone. */
  | 'resolved'
  /**
   * The server resolved it, so the canonical Economy expense exists and counts, but the
   * attachment handoff is not confirmed durable yet. The legacy row and its attachments
   * stay until a later refresh or retry completes it.
   */
  | 'attachments-pending'
  /** Nothing is known to have been saved: refused, invalid, unreachable, or other details. */
  | 'failed';

interface TripsState {
  trips: Trip[];
  expenses: TripExpense[];
  packingItems: PackingItem[];
  appliedPackingTemplates: AppliedPackingTemplate[];
  participants: TripParticipant[];
  myUserId: string | null;
  financialProjections: TripFinancialProjection[];
  /** When the trip's saved snapshot was last confirmed by the server; absent = no snapshot. */
  financialProjectionFreshAt: Record<string, string>;
  /**
   * 'fresh' only for a snapshot the server confirmed during THIS app session. It is
   * never persisted as 'fresh' and everything read back from disk is 'stale'.
   */
  financialProjectionStatus: Record<string, 'fresh' | 'stale'>;
  /** Narrow restart-safe identities for new Travel expenses whose RPC outcome is not yet settled. */
  pendingExpenseDrafts: Record<string, PendingTripExpenseDraft>;

  /**
   * A new trip must name a destination and have ordered calendar dates (APP-058).
   * Returns the new id, or null when the trip breaks a rule — nothing is stored.
   */
  addTrip: (
    input: {
      name: string;
      destination: string;
      startDate: string;
      endDate: string;
      budget: MinorUnits | null;
    },
    initialPackingItems: { label: string; category: PackingCategory }[],
    copyFromTripId?: string | null,
    appliedTemplate?: PackingTemplateIdentity | null,
  ) => string | null;
  /**
   * false when the trip is unknown or the change breaks a rule. A trip that predates
   * destinations may stay without one; once it has one it cannot be blanked.
   */
  updateTrip: (
    id: string,
    updates: Partial<Pick<Trip, "name" | "destination" | "startDate" | "endDate" | "budget">>,
  ) => boolean;
  /**
   * Deletes the canonical trip on the server — only if its dependencies are still exactly
   * `confirmed`, the counts the user was shown; otherwise nothing is deleted and the result
   * is `changed` with the fresh counts. The database cascades every child and link. Local
   * state, files and the reminder are cleared ONLY after the server confirmed — on any
   * failure everything stays exactly as it was.
   */
  deleteTrip: (id: string, confirmed: TripDependencyCounts) => Promise<TripDeleteResult>;
  /** Removes this device's copy only, for a trip the server confirms it does not have. */
  removeTripFromDevice: (id: string) => void;
  addTripDocument: (tripId: string, attachment: Attachment) => void;
  removeTripDocument: (tripId: string, attachmentId: string) => void;

  /**
   * Creates one canonical Economy expense linked to the trip. `expenseId` belongs to
   * the caller's draft: the same draft sends the same id on every retry, so an
   * attempt that committed but lost its answer is recognised, never duplicated. A new
   * draft gets a new id. Resolves the id once the server has confirmed it, else null.
   */
  addTripExpense: (input: {
    expenseId: string;
    tripId: string;
    name: string;
    amount: MinorUnits;
    category: TripExpenseCategory;
    transactionDate: string;
  }) => Promise<string | null>;
  /** Explicitly abandons only this account's unconfirmed draft. */
  abandonPendingTripExpenseDraft: (expenseId: string) => Promise<boolean>;
  /**
   * A server-confirmed resolution is never reported as a failed save. Whether the
   * attachment handoff is complete is a separate part of the result. The legacy row is
   * kept until Economy durably owns its attachments.
   */
  resolveLegacyTripExpense: (input: {
    id: string;
    name: string;
    amount: MinorUnits;
    category: TripExpenseCategory;
    transactionDate: string;
  }) => Promise<LegacyResolutionResult>;
  updateTripExpense: (
    id: string,
    updates: Partial<Pick<TripExpense, "name" | "amount" | "category">>,
  ) => void;
  removeTripExpense: (id: string) => void;
  addExpenseAttachment: (expenseId: string, attachment: Attachment) => void;
  removeExpenseAttachment: (expenseId: string, attachmentId: string) => void;
  /**
   * Asks the server for the trip's projection. The answer lands only if, when it
   * arrives, it is still this trip's latest request, for the same account, in the
   * same local dataset (no account cleanup or backup restore since), and the trip is
   * still here. Resolves true when a fresh snapshot was applied.
   */
  refreshTripFinancialProjection: (tripId: string) => Promise<boolean>;

  addPackingItem: (tripId: string, label: string, category: PackingCategory) => void;
  updatePackingItem: (id: string, label: string, category: PackingCategory) => boolean;
  applyPackingTemplate: (
    tripId: string,
    template: ResolvedPackingTemplate,
  ) => Promise<{ ok: true; added: number } | { ok: false; reason: 'failed' | 'stale' }>;
  togglePackingItem: (id: string) => void;
  removePackingItem: (id: string) => void;

  inviteParticipant: (tripId: string, email: string) => Promise<{ error: string | null }>;
  removeParticipant: (tripId: string, userId: string) => Promise<void>;
  respondToInvitation: (tripId: string, accept: boolean) => Promise<void>;
  fetchParticipants: (tripId: string) => Promise<void>;

  fetchFromSupabase: () => Promise<void>;

  /** Restores validated backup data. The restored trips never inherit the projection cache. */
  restoreBackup: (data: Partial<Pick<TripsState, 'trips' | 'expenses' | 'packingItems' | 'appliedPackingTemplates' | 'participants'>>) => void;
  /** Logout / account switch (APP-021): every trace, including the projection cache. */
  clearLocal: () => void;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

/** The signed-in account, or null when there is none or it cannot be confirmed. Never throws. */
async function signedInUserId(): Promise<string | null> {
  try { return await getUserId(); } catch { return null; }
}

function tripToRow(userId: string, tr: Trip) {
  return {
    id: tr.id,
    user_id: userId,
    name: tr.name,
    destination: tr.destination ?? null,
    start_date: tr.startDate,
    end_date: tr.endDate,
    ...(tr.legacyBudgetMajor === undefined
      ? { budget: tr.budget === null ? null : minorUnitsToServerNumeric(tr.budget) }
      : {}),
    created_at: tr.createdAt,
  };
}

function legacyAmountMinor(value: unknown): MinorUnits | undefined {
  try { return supportedMoney(legacyMajorUnitsToMinorUnits(value)); } catch { return undefined; }
}

function remoteBudget(value: unknown): Pick<Trip, 'budget' | 'legacyBudgetMajor'> {
  if (value === null) return { budget: null };
  try { return { budget: supportedMoney(serverNumericToMinorUnits(value)) }; } catch {
    return { budget: null, ...(typeof value === 'number' && Number.isFinite(value) ? { legacyBudgetMajor: value } : {}) };
  }
}

function packingItemToRow(userId: string, p: PackingItem) {
  return {
    id: p.id,
    user_id: p.authorId ?? userId,
    trip_id: p.tripId,
    label: p.label,
    checked: p.checked,
    category: p.category,
  };
}

function expenseToRow(userId: string, e: TripExpense) {
  return {
    id: e.id,
    user_id: userId,
    trip_id: e.tripId,
    name: e.name,
    amount: e.amount,
    category: e.category,
    currency: e.currency ?? null,
    original_amount: e.originalAmount ?? null,
    exchange_rate: e.exchangeRate ?? null,
  };
}

/**
 * Sends the trip row, in order with every other remote write of this trip.
 *
 * It sends the LATEST local state when its turn comes rather than the state it was
 * asked about, skips entirely if the trip has been deleted meanwhile (a queued upsert
 * must never recreate a deleted trip), and — because the trip row is the parent —
 * runs `afterSaved` inside the same turn, so a packing list can only follow a trip the
 * server accepted. Resolves true when the server accepted the row.
 *
 * A row the server accepted under my user id is proof that I own the trip, so an
 * unknown owner is recorded from it.
 */
function syncTrip(tripId: string, afterSaved?: (accountId: string) => Promise<void>, expectedAccountId?: string): Promise<boolean> {
  return runInTripLane(tripId, async () => {
    if (isTripGone(tripId)) return false;
    const trip = useTripsStore.getState().trips.find((tr) => tr.id === tripId);
    if (!trip) return false;
    const userId = await getUserId();
    if (!userId || (expectedAccountId !== undefined && userId !== expectedAccountId)) return false;
    const result = await supabase.from("trips").upsert(tripToRow(userId, trip));
    if (result?.error) return false;
    useTripsStore.setState((state) => ({
      trips: state.trips.map((tr) => (tr.id === tripId && !tr.ownerId ? { ...tr, ownerId: userId } : tr)),
    }));
    if (afterSaved) await afterSaved(userId);
    return true;
  }).catch(() => false);
}

async function syncUpsertPackingItems(items: PackingItem[]) {
  const userId = await getUserId();
  if (!userId || items.length === 0) return;
  await supabase.from("trip_packing_items").upsert(items.map((p) => packingItemToRow(userId, p)));
}

async function syncPackingTemplateApplication(
  accountId: string,
  tripId: string,
  packingTemplate: PackingTemplateIdentity,
  items: readonly PackingItem[],
): Promise<'applied' | 'already-applied' | 'failed'> {
  if (await signedInUserId() !== accountId) return 'failed';
  try {
    const { data, error } = await supabase.rpc('apply_trip_packing_template', {
      p_trip_id: tripId,
      p_expected_account_id: accountId,
      p_template_id: packingTemplate.id,
      p_template_version: packingTemplate.version,
      p_items: items.map((item) => ({ id: item.id, label: item.label, category: item.category })),
    });
    return !error && (data === 'applied' || data === 'already-applied') ? data : 'failed';
  } catch {
    return 'failed';
  }
}

function isCurrentTemplateApplicationDataset(epoch: number, accountId: string, tripId: string): boolean {
  const state = useTripsStore.getState();
  return epoch === datasetEpoch
    && state.myUserId === accountId
    && state.trips.some((trip) => trip.id === tripId)
    && !isTripGone(tripId);
}

function tripPackingTemplateApplicationKey(application: Pick<AppliedPackingTemplate, 'tripId' | 'templateId' | 'templateVersion'>): string {
  return `${application.tripId}\u0000${application.templateId}\u0000${application.templateVersion}`;
}

/**
 * Commits only rows the server has already accepted. The caller must have received
 * `applied` from the atomic APP-060 RPC; nothing provisional enters persisted state.
 */
function commitConfirmedPackingTemplateApplication(input: {
  epoch: number;
  accountId: string;
  tripId: string;
  template: PackingTemplateIdentity;
  items: readonly PackingItem[];
}): boolean {
  if (!isCurrentTemplateApplicationDataset(input.epoch, input.accountId, input.tripId)) return false;
  const application: AppliedPackingTemplate = {
    tripId: input.tripId,
    templateId: input.template.id,
    templateVersion: input.template.version,
    appliedBy: input.accountId,
    appliedAt: new Date().toISOString(),
  };
  useTripsStore.setState((state) => {
    if (input.epoch !== datasetEpoch || state.myUserId !== input.accountId
      || !state.trips.some((trip) => trip.id === input.tripId) || isTripGone(input.tripId)) return state;
    const existingItemIds = new Set(state.packingItems.map((item) => item.id));
    const applicationExists = isPackingTemplateApplied(
      input.tripId,
      input.template,
      state.appliedPackingTemplates,
    );
    return {
      packingItems: [
        ...state.packingItems,
        ...input.items.filter((item) => !existingItemIds.has(item.id)),
      ],
      appliedPackingTemplates: applicationExists
        ? state.appliedPackingTemplates
        : [...state.appliedPackingTemplates, application],
    };
  });
  return true;
}

/**
 * Recovers the canonical winner after `already-applied` or a lost response. Packing
 * rows are merged by server id so ordinary local rows are never removed; markers for
 * this Trip are replaced only after both authoritative reads succeed.
 */
async function reconcileConfirmedTripPackingState(
  epoch: number,
  accountId: string,
  tripId: string,
): Promise<boolean> {
  if (!isCurrentTemplateApplicationDataset(epoch, accountId, tripId)
    || await signedInUserId() !== accountId) return false;
  const applicationKeysAtRequest = new Set(useTripsStore.getState().appliedPackingTemplates
    .filter((application) => application.tripId === tripId)
    .map(tripPackingTemplateApplicationKey));
  try {
    const [packingResult, applicationResult] = await Promise.all([
      supabase.from('trip_packing_items')
        .select('id, user_id, trip_id, label, checked, category')
        .eq('trip_id', tripId),
      supabase.rpc('list_trip_packing_template_applications', { p_trip_id: tripId }),
    ]);
    if (packingResult.error || applicationResult.error || !Array.isArray(applicationResult.data)) return false;
    if (await signedInUserId() !== accountId
      || !isCurrentTemplateApplicationDataset(epoch, accountId, tripId)) return false;

    const packingItems: PackingItem[] = (packingResult.data ?? [])
      .filter((row) => row.trip_id === tripId)
      .map((row) => ({
        id: row.id,
        tripId: row.trip_id,
        authorId: row.user_id ?? undefined,
        label: row.label,
        checked: row.checked,
        isDefault: false,
        category: (row.category as PackingCategory) ?? 'other',
      }));
    const applications: AppliedPackingTemplate[] = applicationResult.data.map((row) => ({
      tripId,
      templateId: row.template_id,
      templateVersion: Number(row.template_version),
      ...(typeof row.applied_by === 'string' ? { appliedBy: row.applied_by } : {}),
      ...(typeof row.applied_at === 'string' ? { appliedAt: row.applied_at } : {}),
    }));

    useTripsStore.setState((state) => {
      if (epoch !== datasetEpoch || state.myUserId !== accountId
        || !state.trips.some((trip) => trip.id === tripId) || isTripGone(tripId)) return state;
      const existingItemIds = new Set(state.packingItems.map((item) => item.id));
      const preservedApplications = state.appliedPackingTemplates.filter((application) =>
        application.tripId !== tripId
        || !applicationKeysAtRequest.has(tripPackingTemplateApplicationKey(application)));
      const preservedApplicationKeys = new Set(preservedApplications.map(tripPackingTemplateApplicationKey));
      return {
        packingItems: [
          ...state.packingItems,
          ...packingItems.filter((item) => !existingItemIds.has(item.id)),
        ],
        appliedPackingTemplates: [
          ...preservedApplications,
          ...applications.filter((application) => !preservedApplicationKeys.has(
            tripPackingTemplateApplicationKey(application),
          )),
        ],
      };
    });
    return true;
  } catch {
    return false;
  }
}

async function syncUpsertPackingItem(item: PackingItem) {
  await syncUpsertPackingItems([item]);
}

async function syncDeletePackingItem(id: string) {
  await supabase.from("trip_packing_items").delete().eq("id", id);
}

async function syncUpsertExpense(expense: TripExpense) {
  const userId = await getUserId();
  if (!userId || (expense.authorId !== undefined && expense.authorId !== userId)) return;
  await supabase.from("trip_expenses").upsert(expenseToRow(userId, expense));
}

async function syncDeleteExpense(id: string) {
  await supabase.from("trip_expenses").delete().eq("id", id);
}

/**
 * Which local dataset an asynchronous answer was requested for (APP-059 review #1).
 *
 * The module-choice store's epoch mechanism: every account cleanup (log out, and
 * before every log in) and every backup restore moves the epoch, so an answer that
 * was in flight belongs to a dataset that is no longer here and changes nothing.
 * Each trip also remembers its latest projection request, so an older answer can
 * never overwrite a newer one, and a projection answer must be for the account that
 * is still signed in (checked like every remote write here, via `getUserId`).
 * In memory only; it dies with the process.
 */
let datasetEpoch = 0;
let projectionSequence = 0;
const latestProjectionRequest = new Map<string, number>();

/** Freshness describes this session's server answer, so it is never written to disk as 'fresh'. */
function staleStatuses(status: Record<string, 'fresh' | 'stale'>): Record<string, 'fresh' | 'stale'> {
  return Object.fromEntries(Object.keys(status).map((tripId) => [tripId, 'stale' as const]));
}

function samePendingDraft(
  draft: PendingTripExpenseDraft,
  input: Omit<PendingTripExpenseDraft, 'accountId' | 'status'>,
): boolean {
  return draft.expenseId === input.expenseId
    && draft.tripId === input.tripId
    && draft.name === input.name
    && draft.amount === input.amount
    && draft.category === input.category
    && draft.transactionDate === input.transactionDate;
}

/** Await the existing store's real persistence adapter, including its per-key barrier. */
async function persistTripsStateNow(): Promise<boolean> {
  const options = useTripsStore.persist.getOptions();
  if (!options.storage || !options.name) return false;
  try {
    const state = useTripsStore.getState();
    const persisted = options.partialize ? options.partialize(state) : state;
    await options.storage.setItem(options.name, { state: persisted, version: options.version });
    return true;
  } catch {
    return false;
  }
}

/** Legacy Travel files that Economy now references belong to Economy and must survive. */
function releasableAttachments(attachments: readonly Attachment[] | undefined): Attachment[] {
  return (attachments ?? []).filter((attachment) => !economyReferencesAttachment(attachment));
}

/**
 * Lets go of a legacy expense that the server has resolved into the canonical
 * Economy expense with the same id (APP-059 review #1).
 *
 * The legacy row is the only record of its attachments until Economy holds them
 * durably, so it is removed ONLY after `handOffLegacyAttachments` says 'durable'.
 * Until then it stays exactly as it was: still reachable, still excluded from spend.
 * The next refresh tries again. An attachment added to the legacy row meanwhile
 * keeps the row until that attachment has been handed over as well.
 */
async function settleResolvedLegacyExpense(expenseId: string): Promise<void> {
  const legacy = useTripsStore.getState().expenses.find((item) => item.id === expenseId);
  if (!legacy) return;
  if (legacy.attachments.length > 0 && await handOffLegacyAttachments(expenseId, legacy.attachments) !== 'durable') return;
  const handedOver = new Set(legacy.attachments.map((attachment) => attachment.id));
  useTripsStore.setState((state) => ({
    expenses: state.expenses.filter((item) => item.id !== expenseId
      || item.attachments.some((attachment) => !handedOver.has(attachment.id))),
  }));
}

/**
 * Whether the server's own record shows exactly THIS submission resolved: a projection
 * confirmed in this session lists the legacy identity as canonical for this account,
 * with the submitted details. It decides the result when the resolution's own answer
 * was lost. A retry whose details differ from what the server holds was not saved.
 */
function serverRecordsResolution(
  state: TripsState,
  expense: TripExpense,
  accountId: string,
  input: { name: string; amount: MinorUnits; category: TripExpenseCategory; transactionDate: string },
): boolean {
  if (state.financialProjectionStatus[expense.tripId] !== 'fresh') return false;
  return state.financialProjections.some((projection) => projection.tripId === expense.tripId
    && projection.expenseId === expense.id && projection.legacyTripExpenseId === expense.id
    && projection.expenseOwnerId === accountId && projection.name === input.name.trim()
    && projection.amount === input.amount && projection.category === input.category
    && projection.transactionDate === input.transactionDate);
}

export const useTripsStore = create<TripsState>()(
  persist(
    (set, get) => ({
      trips: [],
      expenses: [],
      packingItems: [],
      appliedPackingTemplates: [],
      participants: [],
      myUserId: null,
      financialProjections: [],
      financialProjectionFreshAt: {},
      financialProjectionStatus: {},
      pendingExpenseDrafts: {},

      addTrip: (input, initialPackingItems, copyFromTripId, appliedTemplate) => {
        if (tripProblem(input, { destinationRequired: true }) !== null) return null;
        const creatingAccountId = get().myUserId;
        const creatingEpoch = datasetEpoch;
        const id = newEntityId();
        const newTrip: Trip = {
          id,
          documents: [],
          createdAt: new Date().toISOString(),
          ...input,
          destination: normalizeDestination(input.destination),
          // Known only if a session was already established on this device; otherwise it
          // is recorded when the server accepts the trip. Never guessed.
          ...(creatingAccountId ? { ownerId: creatingAccountId } : {}),
        };
        set((state) => ({ trips: [...state.trips, newTrip] }));

        const itemsToCreate = copyFromTripId
          ? get()
              .packingItems.filter((p) => p.tripId === copyFromTripId)
              .map((p) => ({ label: p.label, category: p.category }))
          : initialPackingItems;

        const newPackingItems: PackingItem[] = itemsToCreate.map(({ label, category }) => ({
          id: newEntityId(),
          tripId: id,
          ...(creatingAccountId ? { authorId: creatingAccountId } : {}),
          label,
          checked: false,
          // Initial suggestions and Trip-to-Trip copies are immediately ordinary,
          // independently editable user rows; no live source identity survives.
          isDefault: false,
          category,
        }));

        set((state) => ({
          // A template application is remote-confirmed, not an offline mutation.
          // Trip-to-Trip copies keep their existing local-first behavior.
          packingItems: appliedTemplate
            ? state.packingItems
            : [...state.packingItems, ...newPackingItems],
        }));

        scheduleTripPackingReminder(id, input.name, input.startDate);
        // The trip row first: its children reference it, so a packing list that
        // reached the server before its trip would be refused by the foreign key.
        void syncTrip(id, async (savedAccountId) => {
          if (appliedTemplate) {
            const result = await syncPackingTemplateApplication(savedAccountId, id, appliedTemplate, newPackingItems);
            if (await signedInUserId() !== savedAccountId
              || !isCurrentTemplateApplicationDataset(creatingEpoch, savedAccountId, id)) return;
            if (result === 'applied') {
              commitConfirmedPackingTemplateApplication({
                epoch: creatingEpoch,
                accountId: savedAccountId,
                tripId: id,
                template: appliedTemplate,
                items: newPackingItems,
              });
            } else if (result === 'already-applied') {
              await reconcileConfirmedTripPackingState(creatingEpoch, savedAccountId, id);
            }
            return;
          }
          await syncUpsertPackingItems(newPackingItems);
        }, creatingAccountId ?? undefined);
        return id;
      },

      updateTrip: (id, updates) => {
        const current = get().trips.find((tr) => tr.id === id);
        if (!current) return false;
        const next = { ...current, ...updates };
        const problem = tripProblem(next, { destinationRequired: normalizeDestination(current.destination) !== undefined });
        if (problem !== null) return false;
        const target: Trip = { ...next, destination: normalizeDestination(next.destination) };
        if (Object.prototype.hasOwnProperty.call(updates, 'budget')) delete target.legacyBudgetMajor;
        set((state) => ({ trips: state.trips.map((tr) => (tr.id === id ? target : tr)) }));
        scheduleTripPackingReminder(id, target.name, target.startDate);
        void syncTrip(id);
        return true;
      },

      deleteTrip: (id, confirmed) =>
        // Behind every earlier write of this trip, so none of them can land after the delete.
        runInTripLane(id, async () => {
          let result = await deleteTripRemote(id, confirmed);
          // The server may have committed the delete while the answer was lost, or the trip
          // may already be gone (another device, an earlier attempt). "No row matched" and a
          // failed call are then indistinguishable from a real failure, so ask the server.
          // Only a definite "there is no such trip for you" turns a failure into success;
          // anything else — still there, not yours, or no answer — stays a failure.
          if (!result.ok && (result.reason === 'failed' || result.reason === 'not-confirmed')) {
            const recheck = await fetchTripDeletionPreview(id);
            if (recheck.ok && recheck.preview.status === 'not-found') result = { ok: true };
          }
          if (!result.ok) return result;
          get().removeTripFromDevice(id);
          return result;
        }),

      removeTripFromDevice: (id) => {
        // Before anything else: a write still waiting for this trip must not run,
        // and a projection answer still in flight for it must not land.
        markTripGone(id);
        latestProjectionRequest.delete(id);
        const targetTrip = get().trips.find((tr) => tr.id === id);
        const removedExpenses = get().expenses.filter((e) => e.tripId === id);
        cancelTripPackingReminder(id);
        set((state) => ({
          trips: state.trips.filter((tr) => tr.id !== id),
          expenses: state.expenses.filter((e) => e.tripId !== id),
          packingItems: state.packingItems.filter((p) => p.tripId !== id),
          appliedPackingTemplates: state.appliedPackingTemplates.filter((application) => application.tripId !== id),
          participants: state.participants.filter((p) => p.tripId !== id),
          financialProjections: state.financialProjections.filter((projection) => projection.tripId !== id),
          financialProjectionFreshAt: Object.fromEntries(
            Object.entries(state.financialProjectionFreshAt).filter(([tripId]) => tripId !== id),
          ),
          financialProjectionStatus: Object.fromEntries(
            Object.entries(state.financialProjectionStatus).filter(([tripId]) => tripId !== id),
          ),
          pendingExpenseDrafts: Object.fromEntries(
            Object.entries(state.pendingExpenseDrafts).filter(([, draft]) => draft.tripId !== id),
          ),
        }));
        cleanupAttachments(targetTrip?.documents);
        for (const expense of removedExpenses) cleanupAttachments(releasableAttachments(expense.attachments));
      },

      addTripDocument: (tripId, attachment) =>
        set((state) => ({
          trips: state.trips.map((tr) =>
            tr.id === tripId
              ? { ...tr, documents: [...tr.documents, attachment] }
              : tr,
          ),
        })),
      removeTripDocument: (tripId, attachmentId) => {
        const attachment = get().trips.find((tr) => tr.id === tripId)?.documents.find((a) => a.id === attachmentId);
        set((state) => ({
          trips: state.trips.map((tr) =>
            tr.id === tripId
              ? {
                  ...tr,
                  documents: tr.documents.filter((a) => a.id !== attachmentId),
                }
              : tr,
          ),
        }));
        if (attachment?.uri) deleteCachedAttachmentFile(attachment.uri);
      },

      addTripExpense: async (input) => {
        if (typeof input.expenseId !== 'string' || input.expenseId.trim().length === 0
          || input.name.trim().length === 0 || input.amount < 0 || parseCalendarDate(input.transactionDate) === null) {
          return null;
        }
        try { supportedMoney(input.amount); } catch { return null; }
        const accountId = await signedInUserId();
        if (!accountId || (get().myUserId !== null && get().myUserId !== accountId)) return null;
        const payload = {
          expenseId: input.expenseId,
          tripId: input.tripId,
          name: input.name.trim(),
          amount: input.amount,
          category: input.category,
          transactionDate: input.transactionDate,
        };
        const existing = get().pendingExpenseDrafts[input.expenseId];
        // An id belongs forever to the account and exact payload that first persisted it.
        if (existing && (existing.accountId !== accountId || !samePendingDraft(existing, payload))) return null;
        // The screen must recover an unresolved draft for this account/trip instead of
        // quietly creating a second UUID after a restart.
        if (!existing && Object.values(get().pendingExpenseDrafts).some((draft) =>
          draft.accountId === accountId && draft.tripId === input.tripId && draft.status !== 'confirmed')) return null;
        if (existing?.status === 'confirmed') {
          set((state) => {
            const pendingExpenseDrafts = { ...state.pendingExpenseDrafts };
            delete pendingExpenseDrafts[input.expenseId];
            return { pendingExpenseDrafts };
          });
          await persistTripsStateNow();
          return input.expenseId;
        }
        set((state) => ({
          pendingExpenseDrafts: {
            ...state.pendingExpenseDrafts,
            [input.expenseId]: { ...payload, accountId, status: 'pending' },
          },
        }));
        // No server mutation is allowed until the identity and exact retry payload are
        // durably readable from the same storage path used during app hydration.
        if (!await persistTripsStateNow()) return null;
        // Persistence is an await boundary: a recovery link can replace the session
        // while the draft write is in flight. Keep the draft for its original account,
        // but never let the replacement account submit it.
        if (await signedInUserId() !== accountId
          || (get().myUserId !== null && get().myUserId !== accountId)) return null;
        const result = await linkTripExpense({
          ...payload,
          expectedAccountId: accountId,
        });
        // The RPC is also an await boundary. Its transaction may have committed for A,
        // but B must not settle, refresh or rewrite A's local draft.
        if (await signedInUserId() !== accountId
          || (get().myUserId !== null && get().myUserId !== accountId)) return null;
        if (result !== 'linked') {
          set((state) => ({
            pendingExpenseDrafts: {
              ...state.pendingExpenseDrafts,
              [input.expenseId]: { ...payload, accountId, status: 'ambiguous' },
            },
          }));
          await persistTripsStateNow();
          return null;
        }
        await get().refreshTripFinancialProjection(input.tripId);
        set((state) => ({
          pendingExpenseDrafts: {
            ...state.pendingExpenseDrafts,
            [input.expenseId]: { ...payload, accountId, status: 'confirmed' },
          },
        }));
        if (!await persistTripsStateNow()) {
          set((state) => ({
            pendingExpenseDrafts: {
              ...state.pendingExpenseDrafts,
              [input.expenseId]: { ...payload, accountId, status: 'ambiguous' },
            },
          }));
          return null;
        }
        set((state) => {
          const pendingExpenseDrafts = { ...state.pendingExpenseDrafts };
          delete pendingExpenseDrafts[input.expenseId];
          return { pendingExpenseDrafts };
        });
        await persistTripsStateNow();
        return input.expenseId;
      },
      abandonPendingTripExpenseDraft: async (expenseId) => {
        const accountId = await signedInUserId();
        const draft = get().pendingExpenseDrafts[expenseId];
        if (!accountId || !draft || draft.accountId !== accountId || draft.status === 'confirmed') return false;
        set((state) => {
          const pendingExpenseDrafts = { ...state.pendingExpenseDrafts };
          delete pendingExpenseDrafts[expenseId];
          return { pendingExpenseDrafts };
        });
        return persistTripsStateNow();
      },
      resolveLegacyTripExpense: async (input) => {
        const userId = await signedInUserId();
        const expense = get().expenses.find((item) => item.id === input.id);
        if (!expense) return 'failed';
        const trip = get().trips.find((candidate) => candidate.id === expense.tripId);
        // Fail closed: nothing is sent unless this account is shown to be the author.
        if (!userId || !canResolveLegacyTripExpense(expense, trip, userId)
          || input.name.trim().length === 0 || input.amount < 0
          || parseCalendarDate(input.transactionDate) === null) return 'failed';
        try { supportedMoney(input.amount); } catch { return 'failed'; }
        if (await signedInUserId() !== userId
          || (get().myUserId !== null && get().myUserId !== userId)) return 'failed';
        const result = await linkTripExpense({
          tripId: expense.tripId,
          expectedAccountId: userId,
          expenseId: expense.id,
          legacyTripExpenseId: expense.id,
          name: input.name,
          amount: input.amount,
          category: input.category,
          transactionDate: input.transactionDate,
          currency: expense.currency,
          originalAmount: expense.originalAmount,
          exchangeRate: expense.exchangeRate,
        });
        if (await signedInUserId() !== userId
          || (get().myUserId !== null && get().myUserId !== userId)) return 'failed';
        // The server now holds the canonical expense, but the legacy row keeps its
        // attachments until Economy durably does. If the answer was lost, the refresh
        // below finds the server's record of the resolution and settles it the same way.
        if (result === 'linked') await settleResolvedLegacyExpense(expense.id);
        await get().refreshTripFinancialProjection(expense.tripId);
        // Saved: the server said so, or — when that answer was lost — its own record shows
        // exactly this submission resolved. A saved resolution is never a failed save.
        if (result !== 'linked' && !serverRecordsResolution(get(), expense, userId, input)) return 'failed';
        // The legacy row (and its attachments) stays until Economy durably owns them.
        return get().expenses.some((item) => item.id === expense.id) ? 'attachments-pending' : 'resolved';
      },
      updateTripExpense: (id, updates) => {
        set((state) => ({
          expenses: state.expenses.map((e) =>
            e.id === id ? { ...e, ...updates } : e,
          ),
        }));
        const target = get().expenses.find((e) => e.id === id);
        if (target) syncUpsertExpense(target);
      },
      removeTripExpense: (id) => {
        const target = get().expenses.find((e) => e.id === id);
        set((state) => ({
          expenses: state.expenses.filter((e) => e.id !== id),
        }));
        cleanupAttachments(releasableAttachments(target?.attachments));
        syncDeleteExpense(id);
      },

      addExpenseAttachment: (expenseId, attachment) =>
        set((state) => ({
          expenses: state.expenses.map((e) =>
            e.id === expenseId
              ? { ...e, attachments: [...e.attachments, attachment] }
              : e,
          ),
        })),
      removeExpenseAttachment: (expenseId, attachmentId) => {
        const attachment = get().expenses.find((e) => e.id === expenseId)?.attachments.find((a) => a.id === attachmentId);
        set((state) => ({
          expenses: state.expenses.map((e) =>
            e.id === expenseId
              ? {
                  ...e,
                  attachments: e.attachments.filter(
                    (a) => a.id !== attachmentId,
                  ),
                }
              : e,
          ),
        }));
        if (attachment?.uri && !economyReferencesAttachment(attachment)) deleteCachedAttachmentFile(attachment.uri);
      },

      refreshTripFinancialProjection: async (tripId) => {
        // What the answer must still match is fixed when the request starts.
        const epoch = datasetEpoch;
        const request = ++projectionSequence;
        latestProjectionRequest.set(tripId, request);
        const stillCurrent = () => epoch === datasetEpoch
          && latestProjectionRequest.get(tripId) === request
          && !isTripGone(tripId)
          && get().trips.some((trip) => trip.id === tripId);

        // The account this request is made for. Without one no answer could be tied to
        // an account, so the cached snapshot simply stays unconfirmed.
        const accountId = await signedInUserId();
        // Answers land only in a Travel dataset that belongs to the same account. After a
        // session switch without a cleanup, the local data is still the previous account's
        // until the new account's trip fetch takes it over.
        const ownDataset = () => accountId !== null && get().myUserId === accountId;
        const projections = accountId && stillCurrent() && ownDataset() ? await fetchTripFinancialProjection(tripId) : null;
        if (!stillCurrent()) return false;
        if (accountId !== null && !ownDataset()) return false;
        if (projections === null) {
          set((state) => ({
            financialProjectionStatus: { ...state.financialProjectionStatus, [tripId]: 'stale' },
          }));
          return false;
        }
        // The session can change without a cleanup (another account's recovery link).
        // An answer made for a different account than the current one never lands.
        if (await signedInUserId() !== accountId || !stillCurrent() || !ownDataset()) return false;
        set((state) => ({
          financialProjections: [
            ...state.financialProjections.filter((projection) => projection.tripId !== tripId),
            ...projections,
          ],
          financialProjectionFreshAt: {
            ...state.financialProjectionFreshAt,
            [tripId]: new Date().toISOString(),
          },
          financialProjectionStatus: { ...state.financialProjectionStatus, [tripId]: 'fresh' },
        }));

        // The server's own record that this account resolved a legacy row: finish the
        // attachment handoff for any such row still here. This is what recovers a lost
        // answer, a failed Economy refresh, or a restart in the middle of a resolution.
        const resolved = new Set(projections
          .filter((projection) => projection.legacyTripExpenseId === projection.expenseId
            && projection.expenseOwnerId === accountId)
          .map((projection) => projection.expenseId));
        const pending = get().expenses.filter((expense) => expense.tripId === tripId && resolved.has(expense.id));
        for (const expense of pending) {
          if (epoch !== datasetEpoch) break;
          await settleResolvedLegacyExpense(expense.id);
        }
        return true;
      },

      addPackingItem: (tripId, label, category) => {
        const trimmed = label.trim();
        if (trimmed.length === 0 || !get().trips.some((trip) => trip.id === tripId)) return;
        const newItem: PackingItem = {
          id: newEntityId(), tripId,
          ...(get().myUserId ? { authorId: get().myUserId as string } : {}),
          label: trimmed, checked: false, isDefault: false, category,
        };
        set((state) => ({
          packingItems: [...state.packingItems, newItem],
        }));
        void syncUpsertPackingItem(newItem);
      },
      updatePackingItem: (id, label, category) => {
        const trimmed = label.trim();
        const current = get().packingItems.find((item) => item.id === id);
        if (!current || trimmed.length === 0) return false;
        const updated = { ...current, label: trimmed, category };
        set((state) => ({
          packingItems: state.packingItems.map((item) => (item.id === id ? updated : item)),
        }));
        void syncUpsertPackingItem(updated);
        return true;
      },
      applyPackingTemplate: async (tripId, packingTemplate) => {
        const epoch = datasetEpoch;
        const accountId = await signedInUserId();
        if (!accountId || epoch !== datasetEpoch || get().myUserId !== accountId
          || !get().trips.some((trip) => trip.id === tripId)) return { ok: false, reason: 'failed' };
        if (isPackingTemplateApplied(tripId, packingTemplate, get().appliedPackingTemplates)) {
          return { ok: true, added: 0 };
        }

        const copies = copyPackingTemplate({
          tripId,
          template: packingTemplate,
          existingItems: get().packingItems,
          authorId: accountId,
        });
        // Copies live only on this async stack until the atomic server operation is
        // confirmed. Zustand persistence and backup therefore never see provisional data.
        const result = await syncPackingTemplateApplication(accountId, tripId, packingTemplate, copies);
        if (await signedInUserId() !== accountId
          || !isCurrentTemplateApplicationDataset(epoch, accountId, tripId)) {
          return { ok: false, reason: 'stale' };
        }
        if (result === 'applied') {
          return commitConfirmedPackingTemplateApplication({
            epoch, accountId, tripId, template: packingTemplate, items: copies,
          }) ? { ok: true, added: copies.length } : { ok: false, reason: 'stale' };
        }
        if (result === 'already-applied') {
          return await reconcileConfirmedTripPackingState(epoch, accountId, tripId)
            ? { ok: true, added: 0 }
            : { ok: false, reason: 'failed' };
        }
        return { ok: false, reason: 'failed' };
      },
      togglePackingItem: (id) => {
        set((state) => ({
          packingItems: state.packingItems.map((p) =>
            p.id === id ? { ...p, checked: !p.checked } : p,
          ),
        }));
        const target = get().packingItems.find((p) => p.id === id);
        if (target) syncUpsertPackingItem(target);
      },
      removePackingItem: (id) => {
        set((state) => ({
          packingItems: state.packingItems.filter((p) => p.id !== id),
        }));
        syncDeletePackingItem(id);
      },

      inviteParticipant: async (tripId, email) => {
        const { error } = await supabase.rpc('invite_trip_participant', {
          p_trip_id: tripId,
          p_email: email.trim().toLowerCase(),
        });

        if (error) {
          if (error.message.includes('no_account_found')) {
            return { error: 'no_account_found' };
          }
          if (error.message.includes('cannot_invite_self')) {
            return { error: 'cannot_invite_self' };
          }
          // Turen findes ikke i Supabase under din egen bruger — enten fordi den ikke er
          // synket endnu, eller fordi nogen forsøger at invitere til en fremmed tur.
          if (error.message.includes('trip_not_found')) {
            return { error: 'trip_not_found' };
          }
          return { error: error.message };
        }

        await get().fetchParticipants(tripId);
        return { error: null };
      },

      removeParticipant: async (tripId, userId) => {
        set((state) => ({
          participants: state.participants.filter(
            (p) => !(p.tripId === tripId && p.userId === userId),
          ),
        }));
        await supabase.from('trip_participants').delete().eq('trip_id', tripId).eq('user_id', userId);
      },

      respondToInvitation: async (tripId, accept) => {
        const userId = await getUserId();
        if (!userId) return;

        const status = accept ? 'accepted' : 'declined';
        set((state) => ({
          participants: state.participants.map((p) =>
            p.tripId === tripId && p.userId === userId ? { ...p, status } : p,
          ),
        }));
        await supabase.from('trip_participants').update({ status }).eq('trip_id', tripId).eq('user_id', userId);

        if (accept) {
          await get().fetchFromSupabase();
        }
      },

      fetchParticipants: async (tripId) => {
        const { data, error } = await supabase
          .from('trip_participants')
          .select('trip_id, owner_id, user_id, invited_email, status, invited_at')
          .eq('trip_id', tripId);

        if (!trackSync('trips', 'fetchParticipants', { error })) return;
        if (!data) return;
        // The trip may have been deleted while this request was in flight.
        if (isTripGone(tripId)) return;

        set((state) => {
          const others = state.participants.filter((p) => p.tripId !== tripId);
          const fetched: TripParticipant[] = data.map((row) => ({
            tripId: row.trip_id,
            ownerId: row.owner_id,
            userId: row.user_id,
            invitedEmail: row.invited_email,
            status: row.status as TripParticipant['status'],
            invitedAt: row.invited_at,
          }));
          return { participants: [...others, ...fetched] };
        });
      },

      fetchFromSupabase: async () => {
        // An account cleanup while this is in flight means its answers belong to the
        // previous account: none of them, nor the projection refreshes they would start,
        // may be written into the next account's store (APP-059 review #1).
        let epoch = datasetEpoch;
        const userId = await getUserId();
        if (!userId || epoch !== datasetEpoch) return;
        const previousAccount = get().myUserId;
        if (previousAccount !== null && previousAccount !== userId) {
          // The session switched accounts without the normal local cleanup (another
          // account's password-recovery link calls setSession in place). Every Travel
          // row is the previous account's local dataset, including packing copies; drop
          // all of it before fetching B so no A content can render under B. The normal
          // auth path still performs the broader all-store/file sweep.
          const previousTrips = get().trips;
          const previousExpenses = get().expenses;
          for (const trip of previousTrips) {
            cancelTripPackingReminder(trip.id);
            cleanupAttachments(trip.documents);
          }
          for (const expense of previousExpenses) cleanupAttachments(releasableAttachments(expense.attachments));
          datasetEpoch += 1;
          latestProjectionRequest.clear();
          epoch = datasetEpoch;
          set({
            trips: [],
            expenses: [],
            packingItems: [],
            appliedPackingTemplates: [],
            participants: [],
            myUserId: userId,
            financialProjections: [],
            financialProjectionFreshAt: {},
            financialProjectionStatus: {},
            pendingExpenseDrafts: {},
          });
        } else {
          set({ myUserId: userId });
        }

        const [tripsResult, packingResult, expensesResult, myInvitationsResult] = await Promise.all([
          supabase.from("trips").select("id, user_id, name, destination, start_date, end_date, budget, created_at").eq("user_id", userId),
          supabase.from("trip_packing_items").select("id, user_id, trip_id, label, checked, category").eq("user_id", userId),
          supabase.from("trip_expenses").select("id, user_id, trip_id, name, amount, category, currency, original_amount, exchange_rate").eq("user_id", userId),
          supabase.from("trip_participants").select("trip_id, owner_id, user_id, invited_email, status, invited_at").eq("user_id", userId),
        ]);

        const acceptedTripIds = (myInvitationsResult.data ?? [])
          .filter((row) => row.status === 'accepted')
          .map((row) => row.trip_id);

        let sharedTripsData: any[] = [];
        let sharedExpensesData: any[] = [];
        let sharedPackingData: any[] = [];

        if (acceptedTripIds.length > 0) {
          const [sharedTrips, sharedExpenses, sharedPacking] = await Promise.all([
            supabase.from("trips").select("id, user_id, name, destination, start_date, end_date, budget, created_at").in("id", acceptedTripIds),
            supabase.from("trip_expenses").select("id, user_id, trip_id, name, amount, category, currency, original_amount, exchange_rate").in("trip_id", acceptedTripIds),
            supabase.from("trip_packing_items").select("id, user_id, trip_id, label, checked, category").in("trip_id", acceptedTripIds),
          ]);
          sharedTripsData = sharedTrips.data ?? [];
          sharedExpensesData = sharedExpenses.data ?? [];
          sharedPackingData = sharedPacking.data ?? [];
        }

        if (epoch !== datasetEpoch) return;
        set((state) => {
          const allTripRows = [...(tripsResult.data ?? []), ...sharedTripsData];
          const existingTripIds = new Set(state.trips.map((tr) => tr.id));
          const fetchedTrips: Trip[] = allTripRows
            // A response that was already in flight when a trip was deleted must not bring it back.
            .filter((row) => !existingTripIds.has(row.id) && !isTripGone(row.id))
            .map((row) => ({
              id: row.id,
              // The canonical owner, from the server. Only a positive answer from here (or
              // from a row the server accepted under my id) ever makes someone an owner.
              ownerId: row.user_id ?? undefined,
              name: row.name,
              // APP-058: trips from before destinations stay without one.
              destination: row.destination ?? undefined,
              startDate: row.start_date,
              endDate: row.end_date,
              ...remoteBudget(row.budget),
              documents: [],
              createdAt: row.created_at,
            }));

          for (const tr of fetchedTrips) {
            scheduleTripPackingReminder(tr.id, tr.name, tr.startDate);
          }

          const allPackingRows = [...(packingResult.data ?? []), ...sharedPackingData];
          const existingPackingIds = new Set(state.packingItems.map((p) => p.id));
          const fetchedPackingItems: PackingItem[] = allPackingRows
            // A stale response must not put back what a delete just removed.
            .filter((row) => !existingPackingIds.has(row.id) && !isTripGone(row.trip_id))
            .map((row) => ({
              id: row.id,
              tripId: row.trip_id,
              authorId: row.user_id ?? undefined,
              label: row.label,
              checked: row.checked,
              isDefault: false,
              category: (row.category as PackingCategory) ?? 'other',
            }));

          const allExpenseRows = [...(expensesResult.data ?? []), ...sharedExpensesData];
          const existingExpenseIds = new Set(state.expenses.map((e) => e.id));
          // `trip_expenses.user_id` is the row's author, and the server never changes it
          // (APP-058). Who may resolve a legacy row depends on it (APP-059 review #1).
          const serverAuthors = new Map<string, string>(allExpenseRows
            .filter((row) => typeof row.user_id === 'string')
            .map((row) => [row.id, row.user_id]));
          const fetchedExpenses: TripExpense[] = allExpenseRows
            .filter((row) => !existingExpenseIds.has(row.id) && !isTripGone(row.trip_id))
            .map((row) => ({
              id: row.id,
              tripId: row.trip_id,
              ...(typeof row.user_id === 'string' ? { authorId: row.user_id } : {}),
              name: row.name,
              amount: Number(row.amount),
              amountMinor: legacyAmountMinor(Number(row.amount)),
              category: row.category as TripExpenseCategory,
              currency: row.currency ?? undefined,
              originalAmount: row.original_amount !== null ? Number(row.original_amount) : undefined,
              exchangeRate: row.exchange_rate !== null ? Number(row.exchange_rate) : undefined,
              attachments: [],
              resolutionStatus: 'requires-transaction-date',
            }));

          const existingParticipantKeys = new Set(state.participants.map((p) => `${p.tripId}-${p.userId}`));
          const fetchedParticipants: TripParticipant[] = (myInvitationsResult.data ?? [])
            .filter((row) => !existingParticipantKeys.has(`${row.trip_id}-${row.user_id}`) && !isTripGone(row.trip_id))
            .map((row) => ({
              tripId: row.trip_id,
              ownerId: row.owner_id,
              userId: row.user_id,
              invitedEmail: row.invited_email,
              status: row.status as TripParticipant['status'],
              invitedAt: row.invited_at,
            }));

          return {
            // Trips kept from before the owner was recorded learn it here; nothing else about a
            // known trip changes (the merge stays append-only).
            trips: [
              ...state.trips.map((tr) => {
                if (tr.ownerId) return tr;
                const ownerId = allTripRows.find((row) => row.id === tr.id)?.user_id;
                return ownerId ? { ...tr, ownerId } : tr;
              }),
              ...fetchedTrips,
            ],
            packingItems: [...state.packingItems, ...fetchedPackingItems],
            // A known legacy row learns its author from the server, which is the authority
            // on it; a row the server did not return keeps whatever it had locally.
            expenses: [
              ...state.expenses.map((expense) => {
                const authorId = serverAuthors.get(expense.id);
                return authorId !== undefined && authorId !== expense.authorId ? { ...expense, authorId } : expense;
              }),
              ...fetchedExpenses,
            ],
            participants: [...state.participants, ...fetchedParticipants],
          };
        });

        const applicationKeysAtRequest = new Set(get().appliedPackingTemplates
          .map(tripPackingTemplateApplicationKey));
        const applicationResults = await Promise.all(get().trips.map(async (trip) => {
          try {
            const { data, error } = await supabase.rpc('list_trip_packing_template_applications', {
              p_trip_id: trip.id,
            });
            if (error || !Array.isArray(data)) return { tripId: trip.id, ok: false as const, applications: [] };
            return {
              tripId: trip.id,
              ok: true as const,
              applications: data.map((row): AppliedPackingTemplate => ({
                tripId: trip.id,
                templateId: row.template_id,
                templateVersion: Number(row.template_version),
                ...(typeof row.applied_by === 'string' ? { appliedBy: row.applied_by } : {}),
                ...(typeof row.applied_at === 'string' ? { appliedAt: row.applied_at } : {}),
              })),
            };
          } catch {
            return { tripId: trip.id, ok: false as const, applications: [] };
          }
        }));
        if (epoch !== datasetEpoch || await signedInUserId() !== userId || get().myUserId !== userId) return;
        const successfulTripIds = new Set(applicationResults
          .filter((result) => result.ok)
          .map((result) => result.tripId));
        const fetchedApplications = applicationResults.flatMap((result) => result.applications);
        set((state) => {
          const currentTripIds = new Set(state.trips
            .filter((trip) => !isTripGone(trip.id))
            .map((trip) => trip.id));
          const replaceableTripIds = new Set([...successfulTripIds]
            .filter((tripId) => currentTripIds.has(tripId)));
          const preservedApplications = state.appliedPackingTemplates.filter((application) =>
            !replaceableTripIds.has(application.tripId)
            || !applicationKeysAtRequest.has(tripPackingTemplateApplicationKey(application)));
          const preservedApplicationKeys = new Set(preservedApplications.map(tripPackingTemplateApplicationKey));
          return {
            appliedPackingTemplates: [
              ...preservedApplications,
              ...fetchedApplications.filter((application) => replaceableTripIds.has(application.tripId)
                && !preservedApplicationKeys.has(tripPackingTemplateApplicationKey(application))),
            ],
          };
        });
        await Promise.all(get().trips.map((trip) => get().refreshTripFinancialProjection(trip.id)));
      },

      // APP-059 review #1: the restored trips start without any projection cache — not
      // even as stale data — and nothing requested before the restore may land. One
      // write, so no moment ever holds restored trips beside the old projections.
      restoreBackup: (data) => {
        datasetEpoch += 1;
        latestProjectionRequest.clear();
        set({
          ...data,
          appliedPackingTemplates: data.appliedPackingTemplates ?? [],
          financialProjections: [],
          financialProjectionFreshAt: {},
          financialProjectionStatus: {},
          pendingExpenseDrafts: {},
        });
      },

      // APP-021: the epoch moves BEFORE the state is cleared, so an answer still in
      // flight cannot write the previous account's trips or projections back.
      clearLocal: () => {
        datasetEpoch += 1;
        latestProjectionRequest.clear();
        set({
          trips: [], expenses: [], packingItems: [], appliedPackingTemplates: [], participants: [], myUserId: null,
          financialProjections: [], financialProjectionFreshAt: {}, financialProjectionStatus: {}, pendingExpenseDrafts: {},
        });
      },
    }),
    {
      name: "lifesort-trips",
      version: 2,
      storage: createJSONStorage(() => migrationGatedStorage(documentMetadataEncryptedStorage)),
      // APP-059 review #1: freshness is never persisted, and nothing read back from disk
      // is current until the server confirms it again in this session.
      partialize: (state) => ({ ...state, financialProjectionStatus: staleStatuses(state.financialProjectionStatus) }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<TripsState> | undefined) };
        return {
          ...merged,
          appliedPackingTemplates: merged.appliedPackingTemplates ?? [],
          financialProjectionStatus: staleStatuses(merged.financialProjectionStatus ?? {}),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.financialProjections ??= [];
        state.financialProjectionFreshAt ??= {};
        state.financialProjectionStatus ??= {};
        state.pendingExpenseDrafts ??= {};
        state.appliedPackingTemplates ??= [];
        state.expenses = state.expenses.map((expense) => ({
          ...expense,
          resolutionStatus: 'requires-transaction-date',
          ...(expense.amountMinor === undefined && legacyAmountMinor(expense.amount) !== undefined
            ? { amountMinor: legacyAmountMinor(expense.amount) }
            : {}),
        }));
      },
    },
  ),
);

registerEconomyMutationInvalidation({
  invalidateExpense(expenseId, accountId) {
    const state = useTripsStore.getState();
    if (accountId === null || state.myUserId !== accountId) {
      return { accountId, tripIds: [], requestTokens: {} };
    }
    const projectedTripIds = state.financialProjections
      .filter((projection) => projection.expenseId === expenseId
        && projection.expenseOwnerId === accountId)
      .map((projection) => projection.tripId);
    // With no cached row there is no reverse index from Economy id to trip. Invalidate
    // every trip in this account's currently loaded dataset so an older in-flight
    // answer cannot become current and the successful write gets an authoritative read.
    const tripIds = [...new Set(projectedTripIds.length > 0
      ? projectedTripIds
      : state.trips.map((trip) => trip.id))];
    const requestTokens: Record<string, number> = {};
    for (const tripId of tripIds) {
      const token = ++projectionSequence;
      latestProjectionRequest.set(tripId, token);
      requestTokens[tripId] = token;
    }
    if (tripIds.length > 0) {
      useTripsStore.setState((current) => ({
        financialProjectionStatus: {
          ...current.financialProjectionStatus,
          ...Object.fromEntries(tripIds.map((tripId) => [tripId, 'stale' as const])),
        },
      }));
    }
    return { accountId, tripIds, requestTokens };
  },
  async refreshAfterCommit({ accountId, tripIds, requestTokens }) {
    if (accountId === null || useTripsStore.getState().myUserId !== accountId) return;
    await Promise.all(tripIds
      .filter((tripId) => latestProjectionRequest.get(tripId) === requestTokens[tripId])
      .map((tripId) => useTripsStore.getState().refreshTripFinancialProjection(tripId)));
  },
});
