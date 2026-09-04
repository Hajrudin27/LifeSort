import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { supabase } from "@/lib/supabase";
import { Attachment } from "@/types/attachment";
import { Warranty, WarrantyType } from "@/types/warranty";
import { deleteAttachmentRemote, fetchAttachmentsFor, uploadAttachment } from "@/utils/shared/attachmentSync";
import {
  cancelWarrantyReminder,
  scheduleWarrantyReminder,
} from "@/utils/warranty/warrantyReminder";

function addOneYear(dateStr: string): string {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split("T")[0];
}

interface WarrantiesState {
  warranties: Warranty[];
  addWarranty: (input: {
    name: string;
    type: WarrantyType;
    expiryDate: string;
    notes?: string;
  }) => string
  updateWarranty: (
    id: string,
    updates: Partial<Omit<Warranty, "id" | "createdAt" | "attachments">>,
  ) => void;
  renewWarranty: (id: string) => string | null; // returnerer den nye dato, eller null hvis garantien ikke findes
  removeWarranty: (id: string) => void;
  addAttachment: (warrantyId: string, attachment: Attachment) => void;
  removeAttachment: (warrantyId: string, attachmentId: string) => void;
  fetchFromSupabase: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

// Bemærk: "attachments" sendes ALDRIG med i selve warranty-raden — de synkroniseres
// separat til den delte `attachments`-tabel + Storage-bucket (se utils/shared/attachmentSync.ts).
function toRow(userId: string, w: Warranty) {
  return {
    id: w.id,
    user_id: userId,
    name: w.name,
    type: w.type,
    expiry_date: w.expiryDate,
    notes: w.notes ?? null,
    created_at: w.createdAt,
  };
}

async function syncUpsertWarranty(warranty: Warranty) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from("warranties").upsert(toRow(userId, warranty));
}

async function syncDeleteWarranty(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from("warranties").delete().eq("user_id", userId).eq("id", id);
}

export const useWarrantiesStore = create<WarrantiesState>()(
  persist(
    (set, get) => ({
      warranties: [],
      addWarranty: (input) => {
        const id = Date.now().toString();
        const newWarranty: Warranty = {
          id,
          attachments: [],
          createdAt: new Date().toISOString(),
          ...input,
        };
        set((state) => ({
          warranties: [...state.warranties, newWarranty],
        }));
        scheduleWarrantyReminder(id, input.name, input.expiryDate);
        syncUpsertWarranty(newWarranty);
        return id;
      },
      updateWarranty: (id, updates) => {
        set((state) => {
          const updated = state.warranties.map((w) =>
            w.id === id ? { ...w, ...updates } : w,
          );
          const target = updated.find((w) => w.id === id);
          if (target)
            scheduleWarrantyReminder(id, target.name, target.expiryDate);
          return { warranties: updated };
        });
        const target = get().warranties.find((w) => w.id === id);
        if (target) syncUpsertWarranty(target);
      },
      renewWarranty: (id) => {
        const target = get().warranties.find((w) => w.id === id);
        if (!target) return null;
        const newExpiry = addOneYear(target.expiryDate);
        set((state) => ({
          warranties: state.warranties.map((w) =>
            w.id === id ? { ...w, expiryDate: newExpiry } : w,
          ),
        }));
        scheduleWarrantyReminder(id, target.name, newExpiry);
        const updated = get().warranties.find((w) => w.id === id);
        if (updated) syncUpsertWarranty(updated);
        return newExpiry;
      },
      removeWarranty: (id) => {
        cancelWarrantyReminder(id);
        set((state) => ({
          warranties: state.warranties.filter((w) => w.id !== id),
        }));
        syncDeleteWarranty(id);
      },
      addAttachment: (warrantyId, attachment) => {
        set((state) => ({
          warranties: state.warranties.map((w) =>
            w.id === warrantyId
              ? { ...w, attachments: [...w.attachments, attachment] }
              : w,
          ),
        }));
        // Upload sker i baggrunden — brugeren ser billedet med det samme lokalt.
        uploadAttachment("warranty", warrantyId, attachment).then((result) => {
          if (!result) return;
          set((state) => ({
            warranties: state.warranties.map((w) =>
              w.id === warrantyId
                ? {
                    ...w,
                    attachments: w.attachments.map((a) =>
                      a.id === attachment.id ? { ...a, storagePath: result.storagePath } : a,
                    ),
                  }
                : w,
            ),
          }));
        });
      },
      removeAttachment: (warrantyId, attachmentId) => {
        const warranty = get().warranties.find((w) => w.id === warrantyId);
        const attachment = warranty?.attachments.find((a) => a.id === attachmentId);
        set((state) => ({
          warranties: state.warranties.map((w) =>
            w.id === warrantyId
              ? {
                  ...w,
                  attachments: w.attachments.filter(
                    (a) => a.id !== attachmentId,
                  ),
                }
              : w,
          ),
        }));
        deleteAttachmentRemote(attachmentId, attachment?.storagePath);
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const { data, error } = await supabase
          .from("warranties")
          .select("id, name, type, expiry_date, notes, created_at")
          .eq("user_id", userId);

        if (error || !data) return;

        const existingIds = new Set(get().warranties.map((w) => w.id));
        const newRows = data.filter((row) => !existingIds.has(row.id));

        // Hent vedhæftninger for de NYE garantier (fx på et andet device) —
        // sker efter set() nedenfor, så listen viser sig med det samme uden billeder,
        // og billederne popper ind, når de signerede URL'er er hentet.
        const fetched: Warranty[] = newRows.map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type as WarrantyType,
          expiryDate: row.expiry_date,
          notes: row.notes ?? undefined,
          attachments: [],
          createdAt: row.created_at,
        }));

        for (const w of fetched) {
          scheduleWarrantyReminder(w.id, w.name, w.expiryDate);
        }

        set((state) => ({ warranties: [...state.warranties, ...fetched] }));

        for (const row of newRows) {
          fetchAttachmentsFor("warranty", row.id).then((attachments) => {
            if (attachments.length === 0) return;
            set((state) => ({
              warranties: state.warranties.map((w) =>
                w.id === row.id ? { ...w, attachments } : w,
              ),
            }));
          });
        }
      },
    }),
    {
      name: "lifesort-warranties",
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.warranties = state.warranties.map((w) => ({
          ...w,
          attachments: w.attachments ?? [],
        }));
      },
    },
  ),
);