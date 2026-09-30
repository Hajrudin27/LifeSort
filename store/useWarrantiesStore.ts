import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { documentMetadataEncryptedStorage } from "@/core/storage/documentCacheStorage";
import { supabase } from "@/lib/supabase";
import { trackSync } from '@/store/useSyncStatusStore';
import { Attachment } from "@/types/attachment";
import { Warranty, WarrantyType } from "@/types/warranty";
import { cleanupAttachments, deleteCachedAttachmentFile } from "@/utils/shared/attachmentStorage";
import { deleteAttachmentRemote, fetchAttachmentsFor, uploadAttachment } from "@/utils/shared/attachmentSync";
import {
  isWarrantyReceiptReference,
  normalizeWarrantySeller,
  warrantyDateProblem,
} from "@/utils/warranty/warrantyDomain";
import {
  cancelWarrantyReminder,
  refreshWarrantyReminders,
  scheduleWarrantyReminder,
} from "@/utils/warranty/warrantyReminder";

// Regner i UTC, så resultatet ikke afhænger af enhedens tidszone.
// Bemærk: 29. februar + 1 år lander på 1. marts, som i JavaScript i øvrigt.
function addOneYear(dateStr: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split("-").map(Number);
  const d = new Date(Date.UTC(year + 1, month - 1, day));
  return d.toISOString().slice(0, 10);
}

interface WarrantiesState {
  warranties: Warranty[];
  /** Returnerer det nye id, eller null hvis felterne bryder garantiens regler (APP-057). */
  addWarranty: (input: {
    name: string;
    type: WarrantyType;
    expiryDate: string;
    notes?: string;
    purchaseDate?: string;
    seller?: string;
    receiptDocumentId?: string;
  }) => string | null;
  /** false når garantien ikke findes, eller når ændringen ville bryde dens regler (APP-057). */
  updateWarranty: (
    id: string,
    updates: Partial<Omit<Warranty, "id" | "createdAt" | "attachments">>,
  ) => boolean;
  renewWarranty: (id: string) => string | null; // returnerer den nye dato, eller null hvis garantien ikke findes
  removeWarranty: (id: string) => void;
  addAttachment: (warrantyId: string, attachment: Attachment) => void;
  removeAttachment: (warrantyId: string, attachmentId: string) => void;
  fetchFromSupabase: () => Promise<void>;
  /**
   * APP-057: erstatter påmindelser fra tidligere versioner med de generiske, ud fra
   * den lokale liste. Spørger aldrig om tilladelse og kaster aldrig.
   */
  refreshReminders: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

/**
 * APP-057: felterne en garanti må skrives med, eller null hvis de bryder dens
 * regler — en dato der ikke er en kanonisk kalenderdato, et køb efter
 * dækningens slutning, eller en kvitteringsreference der ikke er et dokument-id.
 * Intet repareres; en ugyldig ændring afvises og intet gemmes.
 */
function acceptWarrantyFields<T extends Pick<Warranty, "expiryDate" | "purchaseDate" | "seller" | "receiptDocumentId">>(
  fields: T,
): T | null {
  if (warrantyDateProblem(fields) !== null) return null;
  if (fields.receiptDocumentId !== undefined && !isWarrantyReceiptReference(fields.receiptDocumentId)) return null;
  return { ...fields, seller: normalizeWarrantySeller(fields.seller) };
}

// Bemærk: "attachments" sendes ALDRIG med i selve warranty-raden — de synkroniseres
// separat til den delte `attachments`-tabel + Storage-bucket (se utils/shared/attachmentSync.ts).
// `name` er produktet og `expiry_date` dækningens slutdato; kolonnenavnene er
// bevaret af hensyn til ældre klienter (APP-057, ADR-0045).
function toRow(userId: string, w: Warranty) {
  return {
    id: w.id,
    user_id: userId,
    name: w.name,
    type: w.type,
    expiry_date: w.expiryDate,
    notes: w.notes ?? null,
    purchase_date: w.purchaseDate ?? null,
    seller: w.seller ?? null,
    receipt_document_id: w.receiptDocumentId ?? null,
    created_at: w.createdAt,
  };
}

const RECEIPT_REFERENCE_CONSTRAINT = "warranties_receipt_document_fkey";

/** Databasen kender ikke (længere) det dokument, kvitteringsreferencen peger på. */
function isStaleReceiptReference(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "23503" && typeof message === "string" && message.includes(RECEIPT_REFERENCE_CONSTRAINT);
}

async function syncUpsertWarranty(warranty: Warranty) {
  const userId = await getUserId();
  if (!userId) return;
  const result = await supabase.from("warranties").upsert(toRow(userId, warranty));
  if (!warranty.receiptDocumentId || !isStaleReceiptReference(result?.error)) return;

  // APP-057: dokumentet findes ikke længere for denne konto — slettet her eller på
  // en anden enhed, hvor databasen allerede har ryddet referencen. Den lokale kopi
  // ryddes også, og garantien sendes igen uden den, så resten af ændringen ikke
  // går tabt. Kun den reference der fejlede fjernes, og kun hvis den stadig er den.
  const staleId = warranty.receiptDocumentId;
  useWarrantiesStore.setState((state) => ({
    warranties: state.warranties.map((w) =>
      w.id === warranty.id && w.receiptDocumentId === staleId ? { ...w, receiptDocumentId: undefined } : w,
    ),
  }));
  const healed = useWarrantiesStore.getState().warranties.find((w) => w.id === warranty.id);
  if (healed && healed.receiptDocumentId === undefined) {
    await supabase.from("warranties").upsert(toRow(userId, healed));
  }
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
        const accepted = acceptWarrantyFields(input);
        if (!accepted) return null;
        const id = newEntityId();
        const newWarranty: Warranty = {
          id,
          attachments: [],
          createdAt: new Date().toISOString(),
          ...accepted,
        };
        set((state) => ({
          warranties: [...state.warranties, newWarranty],
        }));
        scheduleWarrantyReminder(id, newWarranty.expiryDate);
        syncUpsertWarranty(newWarranty);
        return id;
      },
      updateWarranty: (id, updates) => {
        const current = get().warranties.find((w) => w.id === id);
        if (!current) return false;
        const target = acceptWarrantyFields({ ...current, ...updates });
        if (!target) return false;
        set((state) => ({
          warranties: state.warranties.map((w) => (w.id === id ? target : w)),
        }));
        scheduleWarrantyReminder(id, target.expiryDate);
        syncUpsertWarranty(target);
        return true;
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
        scheduleWarrantyReminder(id, newExpiry);
        const updated = get().warranties.find((w) => w.id === id);
        if (updated) syncUpsertWarranty(updated);
        return newExpiry;
      },
      removeWarranty: (id) => {
        const target = get().warranties.find((w) => w.id === id);
        cancelWarrantyReminder(id);
        set((state) => ({
          warranties: state.warranties.filter((w) => w.id !== id),
        }));
        cleanupAttachments(target?.attachments);
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
        if (attachment?.uri) deleteCachedAttachmentFile(attachment.uri);
        deleteAttachmentRemote(attachmentId, attachment?.storagePath);
      },

      refreshReminders: async () => {
        await refreshWarrantyReminders(() => get().warranties);
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const { data, error } = await supabase
          .from("warranties")
          .select("id, name, type, expiry_date, notes, purchase_date, seller, receipt_document_id, created_at")
          .eq("user_id", userId);

        if (!trackSync('warranties', 'fetch', { error })) return;
        if (!data) return;

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
          // APP-057: tomme felter på ældre rækker forbliver tomme — intet opfindes.
          purchaseDate: row.purchase_date ?? undefined,
          seller: row.seller ?? undefined,
          receiptDocumentId: row.receipt_document_id ?? undefined,
          attachments: [],
          createdAt: row.created_at,
        }));

        for (const w of fetched) {
          scheduleWarrantyReminder(w.id, w.expiryDate);
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
      storage: createJSONStorage(() => migrationGatedStorage(documentMetadataEncryptedStorage)),
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
