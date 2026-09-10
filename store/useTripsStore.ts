import { newEntityId } from '@/core/ids';
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { documentMetadataEncryptedStorage } from "@/core/storage/documentCacheStorage";
import { supabase } from "@/lib/supabase";
import { trackSync } from '@/store/useSyncStatusStore';
import {
  PackingCategory,
  PackingItem,
  Trip,
  TripAttachment,
  TripExpense,
  TripExpenseCategory,
  TripParticipant,
} from "@/types/trip";
import { fetchExchangeRate } from "@/utils/trip/currencyConversion";
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

  addTrip: (
    input: {
      name: string;
      startDate: string;
      endDate: string;
      budget: number | null;
    },
    defaultPackingItems: { label: string; category: PackingCategory }[],
    copyFromTripId?: string | null,
  ) => string;
  updateTrip: (
    id: string,
    updates: Partial<Pick<Trip, "name" | "startDate" | "endDate" | "budget">>,
  ) => void;
  removeTrip: (id: string) => void;
  addTripDocument: (tripId: string, attachment: TripAttachment) => void;
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
  addExpenseAttachment: (expenseId: string, attachment: TripAttachment) => void;
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

async function syncUpsertTrip(trip: Trip) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from("trips").upsert(tripToRow(userId, trip));
}

async function syncDeleteTrip(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from("trips").delete().eq("user_id", userId).eq("id", id);
  await supabase.from("trip_expenses").delete().eq("user_id", userId).eq("trip_id", id);
  await supabase.from("trip_packing_items").delete().eq("user_id", userId).eq("trip_id", id);
  await supabase.from("trip_participants").delete().eq("trip_id", id);
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
        const id = newEntityId();
        const newTrip: Trip = {
          id,
          documents: [],
          createdAt: new Date().toISOString(),
          ...input,
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
        syncUpsertTrip(newTrip);
        syncUpsertPackingItems(newPackingItems);
        return id;
      },

      updateTrip: (id, updates) => {
        set((state) => {
          const updated = state.trips.map((tr) =>
            tr.id === id ? { ...tr, ...updates } : tr,
          );
          const target = updated.find((tr) => tr.id === id);
          if (target)
            scheduleTripPackingReminder(id, target.name, target.startDate);
          return { trips: updated };
        });
        const target = get().trips.find((tr) => tr.id === id);
        if (target) syncUpsertTrip(target);
      },

      removeTrip: (id) => {
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
        syncDeleteTrip(id);
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
          supabase.from("trips").select("id, name, start_date, end_date, budget, created_at").eq("user_id", userId),
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
            supabase.from("trips").select("id, name, start_date, end_date, budget, created_at").in("id", acceptedTripIds),
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
            .filter((row) => !existingTripIds.has(row.id))
            .map((row) => ({
              id: row.id,
              name: row.name,
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
            .filter((row) => !existingPackingIds.has(row.id))
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
            .filter((row) => !existingExpenseIds.has(row.id))
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
            .filter((row) => !existingParticipantKeys.has(`${row.trip_id}-${row.user_id}`))
            .map((row) => ({
              tripId: row.trip_id,
              ownerId: row.owner_id,
              userId: row.user_id,
              invitedEmail: row.invited_email,
              status: row.status as TripParticipant['status'],
              invitedAt: row.invited_at,
            }));

          return {
            trips: [...state.trips, ...fetchedTrips],
            packingItems: [...state.packingItems, ...fetchedPackingItems],
            expenses: [...state.expenses, ...fetchedExpenses],
            participants: [...state.participants, ...fetchedParticipants],
          };
        });
      },
    }),
    {
      name: "lifesort-trips",
      storage: createJSONStorage(() => documentMetadataEncryptedStorage),
    },
  ),
);
