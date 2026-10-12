import { decodeBackupGifts, decodeStoredGifts } from '@/core/gifts/persistedGift';
import { newEntityId } from '@/core/ids';
import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import {
  applyGiftEdit,
  createGift,
  validateGiftInput,
  type GiftErrors,
  type GiftInput,
} from '@/features/gifts/domain/gift';
import type { Gift } from '@/types/gift';
import { todayIso } from '@/utils/shared/localDate';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type GiftWriteResult = { ok: true; id: string } | { ok: false; errors: GiftErrors };

/**
 * APP-069 — the Gift planner's store. LOCAL-ONLY, Profile A, plain AsyncStorage.
 *
 * It has no network code at all: no Supabase client, no table, no outbox, no revision, no tombstone.
 * Gifts live on this device and in a backup file the user keeps (backup format 14), and nowhere
 * else. Cloud sync is deliberately not built here (ADR-0056); a future story would have to bring
 * stable mutation ids, revisions, tombstones and a conflict policy with it.
 *
 * Writes go through the Gifts domain: nothing reaches state without validation, the id comes from
 * `newEntityId()`, and `id` / `createdAt` never change after creation. What comes back from disk
 * is decoded, never trusted: an unrecognisable row is not rendered.
 *
 * Marking a gift purchased changes this store and nothing else. It never creates an expense.
 */
interface GiftsState {
  gifts: Gift[];
  addGift: (input: GiftInput) => GiftWriteResult;
  updateGift: (id: string, input: GiftInput) => GiftWriteResult;
  removeGift: (id: string) => void;
  /** The backup payload: an explicit whitelist, never the whole state. */
  exportBackup: () => { gifts: Gift[] };
  /**
   * Replaces the gifts with a backup's. The backup parser has already validated the file; the rows
   * are decoded again here so that nothing but canonical gifts can ever enter state.
   */
  restoreBackup: (partial: { gifts?: unknown }) => void;
  clearLocal: () => void;
}

export const useGiftsStore = create<GiftsState>()(
  persist(
    (set, get) => ({
      gifts: [],

      addGift: (input) => {
        const result = validateGiftInput(input, { today: todayIso() });
        if (!result.ok) return result;
        const gift = createGift(result.value, { id: newEntityId(), createdAt: new Date().toISOString() });
        set((state) => ({ gifts: [...state.gifts, gift] }));
        return { ok: true, id: gift.id };
      },

      updateGift: (id, input) => {
        const original = get().gifts.find((gift) => gift.id === id);
        if (!original) return { ok: false, errors: {} };
        const result = validateGiftInput(input, { today: todayIso(), existing: original });
        if (!result.ok) return result;
        const edited = applyGiftEdit(original, result.value);
        set((state) => ({ gifts: state.gifts.map((gift) => (gift.id === id ? edited : gift)) }));
        return { ok: true, id };
      },

      removeGift: (id) => {
        set((state) => ({ gifts: state.gifts.filter((gift) => gift.id !== id) }));
      },

      exportBackup: () => ({ gifts: get().gifts }),

      restoreBackup: (partial) => {
        const gifts = decodeBackupGifts(partial.gifts);
        // Unreachable after the parser, and then refused rather than half-applied.
        if (gifts) set({ gifts });
      },

      clearLocal: () => set({ gifts: [] }),
    }),
    {
      name: 'lifesort-gifts',
      storage: createJSONStorage(() => migrationGatedStorage(AsyncStorage)),
      partialize: (state) => ({ gifts: state.gifts }),
      merge: (persisted, current) => ({
        ...current,
        gifts: decodeStoredGifts((persisted as { gifts?: unknown } | null | undefined)?.gifts),
      }),
    },
  ),
);
