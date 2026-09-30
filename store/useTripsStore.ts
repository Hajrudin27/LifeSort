import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { documentMetadataEncryptedStorage } from "@/core/storage/documentCacheStorage";
import { supabase } from "@/lib/supabase";
import { trackSync } from '@/store/useSyncStatusStore';
import { Attachment } from "@/types/attachment";
import {
  PackingCategory,
  PackingItem,
  Trip,
  TripExpense,
  TripExpenseCategory,
  TripParticipant,
} from "@/types/trip";
import { fetchExchangeRate } from "@/utils/trip/currencyConversion";
import { normalizeDestination, tripProblem } from "@/utils/trip/tripDomain";
import { deleteTripRemote, fetchTripDeletionPreview, type TripDeleteResult, type TripDependencyCounts } from "@/utils/trip/tripRemote";
import { isTripGone, markTripGone, runInTripLane } from "@/utils/trip/tripWriteLane";
import { cleanupAttachments, deleteCachedAttachmentFile } from "@/utils/shared/attachmentStorage";
import {
  cancelTripPackingReminder,
  scheduleTripPackingReminder,
} from "@/utils/trip/tripReminder";

interface TripsState {
  trips: Trip[];
  expenses: TripExpense[];
  packingItems: PackingItem[];
  participants: TripParticipant[];
  myUserId: string | null;

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
      budget: number | null;
    },
    defaultPackingItems: { label: string; category: PackingCategory }[],
    copyFromTripId?: string | null,
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

  addTripExpense: (input: {
    tripId: string;
    name: string;
    amount: number;
    category: TripExpenseCategory;
    currency?: string;
  }) => Promise<string>;
  updateTripExpense: (
    id: string,
    updates: Partial<Pick<TripExpense, "name" | "amount" | "category">>,
  ) => void;
  removeTripExpense: (id: string) => void;
  addExpenseAttachment: (expenseId: string, attachment: Attachment) => void;
  removeExpenseAttachment: (expenseId: string, attachmentId: string) => void;

  addPackingItem: (tripId: string, label: string, category: PackingCategory) => void;
  togglePackingItem: (id: string) => void;
  removePackingItem: (id: string) => void;

  inviteParticipant: (tripId: string, email: string) => Promise<{ error: string | null }>;
  removeParticipant: (tripId: string, userId: string) => Promise<void>;
  respondToInvitation: (tripId: string, accept: boolean) => Promise<void>;
  fetchParticipants: (tripId: string) => Promise<void>;

  fetchFromSupabase: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

function tripToRow(userId: string, tr: Trip) {
  return {
    id: tr.id,
    user_id: userId,
    name: tr.name,
    destination: tr.destination ?? null,
    start_date: tr.startDate,
    end_date: tr.endDate,
    budget: tr.budget,
    created_at: tr.createdAt,
  };
}

function packingItemToRow(userId: string, p: PackingItem) {
  return {
    id: p.id,
    user_id: userId,
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
function syncTrip(tripId: string, afterSaved?: () => Promise<void>): Promise<boolean> {
  return runInTripLane(tripId, async () => {
    if (isTripGone(tripId)) return false;
    const trip = useTripsStore.getState().trips.find((tr) => tr.id === tripId);
    if (!trip) return false;
    const userId = await getUserId();
    if (!userId) return false;
    const result = await supabase.from("trips").upsert(tripToRow(userId, trip));
    if (result?.error) return false;
    useTripsStore.setState((state) => ({
      trips: state.trips.map((tr) => (tr.id === tripId && !tr.ownerId ? { ...tr, ownerId: userId } : tr)),
    }));
    if (afterSaved) await afterSaved();
    return true;
  }).catch(() => false);
}

async function syncUpsertPackingItems(items: PackingItem[]) {
  const userId = await getUserId();
  if (!userId || items.length === 0) return;
  await supabase.from("trip_packing_items").upsert(items.map((p) => packingItemToRow(userId, p)));
}

async function syncUpsertPackingItem(item: PackingItem) {
  await syncUpsertPackingItems([item]);
}

async function syncDeletePackingItem(id: string) {
  await supabase.from("trip_packing_items").delete().eq("id", id);
}

async function syncUpsertExpense(expense: TripExpense) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from("trip_expenses").upsert(expenseToRow(userId, expense));
}

async function syncDeleteExpense(id: string) {
  await supabase.from("trip_expenses").delete().eq("id", id);
}

export const useTripsStore = create<TripsState>()(
  persist(
    (set, get) => ({
      trips: [],
      expenses: [],
      packingItems: [],
      participants: [],
      myUserId: null,

      addTrip: (input, defaultPackingItems, copyFromTripId) => {
        if (tripProblem(input, { destinationRequired: true }) !== null) return null;
        const id = newEntityId();
        const newTrip: Trip = {
          id,
          documents: [],
          createdAt: new Date().toISOString(),
          ...input,
          destination: normalizeDestination(input.destination),
          // Known only if a session was already established on this device; otherwise it
          // is recorded when the server accepts the trip. Never guessed.
          ...(get().myUserId ? { ownerId: get().myUserId as string } : {}),
        };
        set((state) => ({ trips: [...state.trips, newTrip] }));

        const itemsToCreate = copyFromTripId
          ? get()
              .packingItems.filter((p) => p.tripId === copyFromTripId)
              .map((p) => ({ label: p.label, category: p.category }))
          : defaultPackingItems;

        const newPackingItems: PackingItem[] = itemsToCreate.map(({ label, category }) => ({
          id: newEntityId(),
          tripId: id,
          label,
          checked: false,
          isDefault: !copyFromTripId,
          category,
        }));

        set((state) => ({
          packingItems: [...state.packingItems, ...newPackingItems],
        }));

        scheduleTripPackingReminder(id, input.name, input.startDate);
        // The trip row first: its children reference it, so a packing list that
        // reached the server before its trip would be refused by the foreign key.
        void syncTrip(id, () => syncUpsertPackingItems(newPackingItems));
        return id;
      },

      updateTrip: (id, updates) => {
        const current = get().trips.find((tr) => tr.id === id);
        if (!current) return false;
        const next = { ...current, ...updates };
        const problem = tripProblem(next, { destinationRequired: normalizeDestination(current.destination) !== undefined });
        if (problem !== null) return false;
        const target: Trip = { ...next, destination: normalizeDestination(next.destination) };
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
        // Before anything else: a write still waiting for this trip must not run.
        markTripGone(id);
        const targetTrip = get().trips.find((tr) => tr.id === id);
        const removedExpenses = get().expenses.filter((e) => e.tripId === id);
        cancelTripPackingReminder(id);
        set((state) => ({
          trips: state.trips.filter((tr) => tr.id !== id),
          expenses: state.expenses.filter((e) => e.tripId !== id),
          packingItems: state.packingItems.filter((p) => p.tripId !== id),
          participants: state.participants.filter((p) => p.tripId !== id),
        }));
        cleanupAttachments(targetTrip?.documents);
        for (const expense of removedExpenses) cleanupAttachments(expense.attachments);
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
        const { currency, amount, ...rest } = input;
        const id = newEntityId();

        let finalAmount = amount;
        let originalAmount: number | undefined;
        let exchangeRate: number | undefined;
        let resolvedCurrency: string | undefined;

        if (currency && currency !== 'DKK') {
          const rate = await fetchExchangeRate(currency, 'DKK');
          if (rate !== null) {
            originalAmount = amount;
            exchangeRate = rate;
            finalAmount = Math.round(amount * rate * 100) / 100;
            resolvedCurrency = currency;
          }
        }

        const newExpense: TripExpense = {
          id,
          attachments: [],
          createdAt: new Date().toISOString(),
          amount: finalAmount,
          currency: resolvedCurrency,
          originalAmount,
          exchangeRate,
          ...rest,
        };
        set((state) => ({ expenses: [...state.expenses, newExpense] }));
        syncUpsertExpense(newExpense);
        return id;
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
        cleanupAttachments(target?.attachments);
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
        if (attachment?.uri) deleteCachedAttachmentFile(attachment.uri);
      },

      addPackingItem: (tripId, label, category) => {
        const newItem: PackingItem = { id: newEntityId(), tripId, label, checked: false, isDefault: false, category };
        set((state) => ({
          packingItems: [...state.packingItems, newItem],
        }));
        syncUpsertPackingItem(newItem);
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
        const userId = await getUserId();
        if (!userId) return;
        set({ myUserId: userId });

        const [tripsResult, packingResult, expensesResult, myInvitationsResult] = await Promise.all([
          supabase.from("trips").select("id, user_id, name, destination, start_date, end_date, budget, created_at").eq("user_id", userId),
          supabase.from("trip_packing_items").select("id, trip_id, label, checked, category").eq("user_id", userId),
          supabase.from("trip_expenses").select("id, trip_id, name, amount, category, currency, original_amount, exchange_rate").eq("user_id", userId),
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
            supabase.from("trip_expenses").select("id, trip_id, name, amount, category, currency, original_amount, exchange_rate").in("trip_id", acceptedTripIds),
            supabase.from("trip_packing_items").select("id, trip_id, label, checked, category").in("trip_id", acceptedTripIds),
          ]);
          sharedTripsData = sharedTrips.data ?? [];
          sharedExpensesData = sharedExpenses.data ?? [];
          sharedPackingData = sharedPacking.data ?? [];
        }

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
              budget: row.budget !== null ? Number(row.budget) : null,
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
              label: row.label,
              checked: row.checked,
              isDefault: false,
              category: (row.category as PackingCategory) ?? 'other',
            }));

          const allExpenseRows = [...(expensesResult.data ?? []), ...sharedExpensesData];
          const existingExpenseIds = new Set(state.expenses.map((e) => e.id));
          const fetchedExpenses: TripExpense[] = allExpenseRows
            .filter((row) => !existingExpenseIds.has(row.id) && !isTripGone(row.trip_id))
            .map((row) => ({
              id: row.id,
              tripId: row.trip_id,
              name: row.name,
              amount: Number(row.amount),
              category: row.category as TripExpenseCategory,
              currency: row.currency ?? undefined,
              originalAmount: row.original_amount !== null ? Number(row.original_amount) : undefined,
              exchangeRate: row.exchange_rate !== null ? Number(row.exchange_rate) : undefined,
              attachments: [],
              createdAt: new Date().toISOString(),
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
            expenses: [...state.expenses, ...fetchedExpenses],
            participants: [...state.participants, ...fetchedParticipants],
          };
        });
      },
    }),
    {
      name: "lifesort-trips",
      storage: createJSONStorage(() => migrationGatedStorage(documentMetadataEncryptedStorage)),
    },
  ),
);
